import Database from "@tauri-apps/plugin-sql";
import { parseSettings } from "../lib/settings";
import type {
  Category,
  Competitor,
  PreviousTheme,
  RepoAnalysis,
  RunRecord,
  RunResult,
  RunSummary,
  Settings,
} from "../lib/types";
import { canonicalRepoKey } from "../lib/urls";

let databasePromise: Promise<Database> | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

function serializeWrite<T>(task: () => Promise<T>): Promise<T> {
  const result = writeChain.then(task, task);
  writeChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function getDatabase(): Promise<Database> {
  if (!databasePromise) {
    databasePromise = (async () => {
      let db: Database;
      try {
        db = await Database.load("sqlite:radar.db");
        await createSchema(db);
      } catch {
        databasePromise = null;
        throw new Error("Radar could not open its database; restart the app and try again.");
      }
      return db;
    })();
  }
  return databasePromise;
}

async function createSchema(db: Database): Promise<void> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    )`,
  );
  await db.execute(
    `CREATE TABLE IF NOT EXISTS analyses (
      repo TEXT PRIMARY KEY,
      repo_url TEXT NOT NULL,
      default_branch TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      analyzed_at TEXT NOT NULL,
      product_context TEXT NOT NULL,
      competitors TEXT NOT NULL,
      confirmed_at TEXT,
      context_edited INTEGER NOT NULL DEFAULT 0,
      competitors_edited INTEGER NOT NULL DEFAULT 0,
      draft TEXT
    )`,
  );
  await db.execute(
    `CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      date TEXT NOT NULL,
      lookback_days INTEGER NOT NULL,
      lookback_label TEXT NOT NULL,
      item_count INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      digest_rel TEXT NOT NULL,
      vault_path TEXT NOT NULL,
      markdown TEXT NOT NULL
    )`,
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_runs_repo_finished ON runs(repo, finished_at DESC)`,
  );
  await db.execute(
    `CREATE TABLE IF NOT EXISTS seen_urls (
      repo TEXT NOT NULL,
      url TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      PRIMARY KEY (repo, url)
    )`,
  );
  await db.execute(
    `CREATE TABLE IF NOT EXISTS themes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      summary TEXT NOT NULL,
      category TEXT NOT NULL,
      competitor TEXT NOT NULL,
      first_run_at TEXT NOT NULL,
      last_run_at TEXT NOT NULL,
      run_count INTEGER NOT NULL,
      last_score REAL,
      UNIQUE (repo, key)
    )`,
  );
  await db.execute(
    `CREATE TABLE IF NOT EXISTS theme_scores (
      theme_id INTEGER NOT NULL,
      run_id INTEGER NOT NULL,
      frequency INTEGER NOT NULL,
      pain INTEGER NOT NULL,
      money INTEGER NOT NULL,
      fit INTEGER NOT NULL,
      effort INTEGER NOT NULL,
      score REAL NOT NULL,
      bucket TEXT NOT NULL,
      PRIMARY KEY (theme_id, run_id)
    )`,
  );
  await db.execute(
    `CREATE TABLE IF NOT EXISTS theme_sources (
      theme_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      published_at TEXT,
      author TEXT,
      PRIMARY KEY (theme_id, url)
    )`,
  );
  await db.execute(
    `CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL,
      run_id INTEGER NOT NULL,
      theme_id INTEGER,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      competitor TEXT NOT NULL,
      category TEXT NOT NULL,
      money TEXT NOT NULL,
      summary TEXT NOT NULL,
      quote TEXT NOT NULL,
      author TEXT,
      published_at TEXT,
      source TEXT NOT NULL
    )`,
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_items_repo_run ON items(repo, run_id)`,
  );
  await db.execute(
    `DELETE FROM seen_urls WHERE repo NOT IN (SELECT DISTINCT repo FROM runs)`,
  );
}

export async function loadSettings(): Promise<Settings> {
  const db = await getDatabase();
  const rows = await db.select<Array<{ data: string }>>(
    "SELECT data FROM settings WHERE id = 1",
  );
  return parseSettings(rows[0]?.data ?? null);
}

export function saveSettings(settings: Settings): Promise<void> {
  return serializeWrite(async () => {
    const db = await getDatabase();
    try {
      await db.execute(
        `INSERT INTO settings (id, data) VALUES (1, $1)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
        [JSON.stringify(settings)],
      );
    } catch {
      throw new Error("Radar could not save its settings; restart the app and try again.");
    }
  });
}

interface AnalysisRow {
  repo: string;
  repo_url: string;
  default_branch: string;
  commit_sha: string;
  analyzed_at: string;
  product_context: string;
  competitors: string;
  confirmed_at: string | null;
  context_edited: number;
  competitors_edited: number;
  draft: string | null;
}

export async function loadAnalysis(repoUrl: string): Promise<RepoAnalysis | null> {
  const key = canonicalRepoKey(repoUrl);
  if (!key) return null;
  const db = await getDatabase();
  const rows = await db.select<AnalysisRow[]>(
    "SELECT * FROM analyses WHERE repo = $1",
    [key],
  );
  const row = rows[0];
  if (!row) return null;
  try {
    const competitors = JSON.parse(row.competitors) as Competitor[];
    const draft = row.draft ? JSON.parse(row.draft) : null;
    return {
      repoUrl: row.repo_url,
      defaultBranch: row.default_branch,
      commitSha: row.commit_sha,
      analyzedAt: row.analyzed_at,
      productContext: row.product_context,
      competitors: Array.isArray(competitors) ? competitors : [],
      confirmedAt: row.confirmed_at,
      contextEdited: row.context_edited === 1,
      competitorsEdited: row.competitors_edited === 1,
      draft: draft && typeof draft === "object" ? draft : null,
    };
  } catch {
    throw new Error("Radar could not read its saved analysis; re-analyze the repository.");
  }
}

export function saveAnalysis(analysis: RepoAnalysis): Promise<void> {
  const key = canonicalRepoKey(analysis.repoUrl);
  if (!key) return Promise.reject(new Error("Enter a valid GitHub repository URL in Settings."));
  return serializeWrite(async () => {
    const db = await getDatabase();
    try {
      await db.execute(
        `INSERT INTO analyses
          (repo, repo_url, default_branch, commit_sha, analyzed_at, product_context, competitors,
           confirmed_at, context_edited, competitors_edited, draft)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT(repo) DO UPDATE SET
           repo_url = excluded.repo_url,
           default_branch = excluded.default_branch,
           commit_sha = excluded.commit_sha,
           analyzed_at = excluded.analyzed_at,
           product_context = excluded.product_context,
           competitors = excluded.competitors,
           confirmed_at = excluded.confirmed_at,
           context_edited = excluded.context_edited,
           competitors_edited = excluded.competitors_edited,
           draft = excluded.draft`,
        [
          key,
          analysis.repoUrl,
          analysis.defaultBranch,
          analysis.commitSha,
          analysis.analyzedAt,
          analysis.productContext,
          JSON.stringify(analysis.competitors),
          analysis.confirmedAt,
          analysis.contextEdited ? 1 : 0,
          analysis.competitorsEdited ? 1 : 0,
          analysis.draft ? JSON.stringify(analysis.draft) : null,
        ],
      );
    } catch {
      throw new Error("Radar could not save the analysis; restart the app and try again.");
    }
  });
}

export async function loadPreviousThemes(repoUrl: string): Promise<PreviousTheme[]> {
  const key = canonicalRepoKey(repoUrl);
  if (!key) return [];
  const db = await getDatabase();
  const rows = await db.select<
    Array<{
      id: number;
      key: string;
      name: string;
      summary: string;
      category: string;
      run_count: number;
      last_score: number | null;
    }>
  >(
    `SELECT id, key, name, summary, category, run_count, last_score
     FROM themes WHERE repo = $1 ORDER BY last_run_at DESC`,
    [key],
  );
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    summary: row.summary,
    category: row.category as Category,
    runCount: row.run_count,
    lastScore: row.last_score,
  }));
}

export async function loadSeenUrls(repoUrl: string): Promise<string[]> {
  const key = canonicalRepoKey(repoUrl);
  if (!key) return [];
  const db = await getDatabase();
  const rows = await db.select<Array<{ url: string }>>(
    "SELECT url FROM seen_urls WHERE repo = $1",
    [key],
  );
  return rows.map((row) => row.url);
}

export async function markSeen(repoUrl: string, urls: string[]): Promise<void> {
  const key = canonicalRepoKey(repoUrl);
  if (!key || urls.length === 0) return;
  const db = await getDatabase();
  const at = new Date().toISOString();
  try {
    for (const url of urls) {
      await db.execute(
        "INSERT OR IGNORE INTO seen_urls (repo, url, first_seen_at) VALUES ($1, $2, $3)",
        [key, url, at],
      );
    }
  } catch {
    throw new Error("Radar could not save its progress; restart the app and try again.");
  }
}

interface RunRow {
  id: number;
  repo: string;
  started_at: string;
  finished_at: string;
  date: string;
  lookback_days: number;
  lookback_label: string;
  item_count: number;
  cost_usd: number;
  digest_rel: string;
  vault_path: string;
  markdown: string;
}

export async function listRuns(repoUrl: string): Promise<RunSummary[]> {
  const key = canonicalRepoKey(repoUrl);
  if (!key) return [];
  const db = await getDatabase();
  const rows = await db.select<
    Array<{
      id: number;
      date: string;
      finished_at: string;
      item_count: number;
      cost_usd: number;
      digest_rel: string;
    }>
  >(
    `SELECT id, date, finished_at, item_count, cost_usd, digest_rel
     FROM runs WHERE repo = $1 ORDER BY finished_at DESC, id DESC`,
    [key],
  );
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    finishedAt: row.finished_at,
    itemCount: row.item_count,
    costUsd: row.cost_usd,
    digestRel: row.digest_rel,
  }));
}

export async function loadRun(id: number): Promise<RunRecord | null> {
  const db = await getDatabase();
  const rows = await db.select<RunRow[]>("SELECT * FROM runs WHERE id = $1", [id]);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    repoUrl: row.repo,
    date: row.date,
    finishedAt: row.finished_at,
    itemCount: row.item_count,
    costUsd: row.cost_usd,
    digestRel: row.digest_rel,
    vaultPath: row.vault_path,
    markdown: row.markdown,
  };
}

export async function persistRun(input: {
  repoUrl: string;
  vaultPath: string;
  startedAt: string;
  finishedAt: string;
  result: RunResult;
}): Promise<RunSummary> {
  const key = canonicalRepoKey(input.repoUrl);
  if (!key) throw new Error("Enter a valid GitHub repository URL in Settings.");
  const db = await getDatabase();
  const result = input.result;
  try {
    const runInsert = await db.execute(
      `INSERT INTO runs
        (repo, started_at, finished_at, date, lookback_days, lookback_label, item_count,
         cost_usd, digest_rel, vault_path, markdown)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        key,
        input.startedAt,
        input.finishedAt,
        result.date,
        result.lookbackDays,
        result.lookbackLabel,
        result.itemCount,
        result.costUsd,
        result.digestRel,
        input.vaultPath,
        result.markdown,
      ],
    );
    const runId = runInsert.lastInsertId;
    if (!runId) throw new Error("missing run id");

    const themeIds = new Map<string, number>();
    for (const theme of result.themes) {
      const existing = await db.select<Array<{ id: number }>>(
        "SELECT id FROM themes WHERE repo = $1 AND key = $2",
        [key, theme.key],
      );
      let themeId: number | undefined = existing[0]?.id;
      if (themeId === undefined) {
        const inserted = await db.execute(
          `INSERT INTO themes
            (repo, key, name, summary, category, competitor, first_run_at, last_run_at,
             run_count, last_score)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            key,
            theme.key,
            theme.name,
            theme.summary,
            theme.category,
            theme.competitor,
            input.finishedAt,
            input.finishedAt,
            theme.runCount,
            theme.score,
          ],
        );
        themeId = inserted.lastInsertId;
        if (!themeId) throw new Error("missing theme id");
      } else {
        await db.execute(
          `UPDATE themes
           SET name = $1, summary = $2, category = $3, competitor = $4,
               last_run_at = $5, run_count = $6, last_score = $7
           WHERE id = $8`,
          [
            theme.name,
            theme.summary,
            theme.category,
            theme.competitor,
            input.finishedAt,
            theme.runCount,
            theme.score,
            themeId,
          ],
        );
      }
      themeIds.set(theme.key, themeId);
      await db.execute(
        `INSERT OR REPLACE INTO theme_scores
          (theme_id, run_id, frequency, pain, money, fit, effort, score, bucket)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          themeId,
          runId,
          theme.frequency,
          theme.pain,
          theme.money,
          theme.fit,
          theme.effort,
          theme.score,
          theme.bucket,
        ],
      );
      for (const source of theme.sources) {
        await db.execute(
          `INSERT OR IGNORE INTO theme_sources (theme_id, url, title, published_at, author)
           VALUES ($1, $2, $3, $4, $5)`,
          [themeId, source.url, source.title, source.publishedAt, source.author],
        );
      }
    }

    for (const item of result.items) {
      const themeId = item.themeKey ? themeIds.get(item.themeKey) : undefined;
      await db.execute(
        `INSERT INTO items
          (repo, run_id, theme_id, url, title, competitor, category, money, summary, quote,
           author, published_at, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          key,
          runId,
          themeId ?? null,
          item.url,
          item.title,
          item.competitor,
          item.category,
          item.money,
          item.summary,
          item.quote,
          item.author,
          item.publishedAt,
          item.source,
        ],
      );
    }

    return {
      id: runId,
      date: result.date,
      finishedAt: input.finishedAt,
      itemCount: result.itemCount,
      costUsd: result.costUsd,
      digestRel: result.digestRel,
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Radar ")) throw error;
    throw new Error("Radar could not save the run; restart the app and try again.");
  }
}
