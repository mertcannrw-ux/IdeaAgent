import { fetchWithTimeout, networkError, type HttpClient } from "./http";
import { limitChars } from "./text";
import type { RepoRef } from "./urls";

const API = "https://api.github.com";

export interface RepoSnapshot {
  repo: {
    slug: string;
    description: string;
    topics: string[];
    language: string | null;
    stars: number;
    homepage: string | null;
    license: string | null;
    archived: boolean;
    defaultBranch: string;
    pushedAt: string | null;
  };
  commitSha: string;
  readme: string;
  topDocs: Array<{ path: string; content: string }>;
  docs: Array<{ path: string; content: string }>;
  manifests: Array<{ path: string; content: string }>;
  pullRequests: Array<{ number: number; title: string; body: string; mergedAt: string | null }>;
  issues: Array<{ number: number; title: string; body: string; createdAt: string }>;
}

class GitHubRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubRequestError";
  }
}

function githubError(response: Response): GitHubRequestError {
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (response.status === 401) {
    return new GitHubRequestError(
      "GitHub rejected the token; check it in Settings.",
      response.status,
    );
  }
  if (response.status === 403 || response.status === 429) {
    return remaining === "0"
      ? new GitHubRequestError(
          "GitHub rate limit reached; add a token in Settings or try again later.",
          response.status,
        )
      : new GitHubRequestError(
          "GitHub denied access; check that the repository is public.",
          response.status,
        );
  }
  if (response.status === 404) {
    return new GitHubRequestError(
      "GitHub could not find that repository; check the URL and that it is public.",
      response.status,
    );
  }
  if (response.status === 409) {
    return new GitHubRequestError(
      "GitHub says the repository is empty; add a commit and re-analyze.",
      response.status,
    );
  }
  if (response.status >= 500) {
    return new GitHubRequestError(
      "GitHub is unavailable; try again in a few minutes.",
      response.status,
    );
  }
  return new GitHubRequestError(
    `GitHub returned an error (${response.status}); check the repository URL.`,
    response.status,
  );
}

async function request(
  http: HttpClient,
  path: string,
  token: string | undefined,
  accept: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    accept,
    "x-github-api-version": "2022-11-28",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetchWithTimeout(
      http,
      path.startsWith("http") ? path : `${API}${path}`,
      { method: "GET", headers },
      25_000,
    );
  } catch (error) {
    throw networkError("GitHub", error);
  }
  if (!response.ok) throw githubError(response);
  return response;
}

async function optionalRaw(
  http: HttpClient,
  path: string,
  token: string | undefined,
): Promise<string | null> {
  try {
    const response = await request(http, path, token, "application/vnd.github.raw");
    return limitChars(await response.text(), 20_000);
  } catch (error) {
    if (error instanceof GitHubRequestError && error.status === 404) return null;
    throw error;
  }
}

function encodedPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

interface ContentEntry {
  name?: string;
  path?: string;
  type?: string;
  size?: number;
}

interface RepoResponse {
  description?: string | null;
  topics?: string[];
  language?: string | null;
  stargazers_count?: number;
  homepage?: string | null;
  license?: { spdx_id?: string | null } | null;
  archived?: boolean;
  default_branch?: string;
  pushed_at?: string | null;
}

interface CommitResponse {
  sha?: string;
}

interface PullResponse {
  number?: number;
  title?: string;
  body?: string | null;
  merged_at?: string | null;
}

interface IssueResponse {
  number?: number;
  title?: string;
  body?: string | null;
  created_at?: string;
  pull_request?: unknown;
}

export async function fetchRepoSnapshot(
  ref: RepoRef,
  http: HttpClient,
  token?: string,
): Promise<RepoSnapshot> {
  const base = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  const repoResponse = await request(http, base, token, "application/vnd.github+json");
  const repo = (await repoResponse.json().catch(() => null)) as RepoResponse | null;
  if (!repo || !repo.default_branch) {
    throw new Error("GitHub returned an unreadable repository response; try again.");
  }
  const branch = repo.default_branch;

  const [commit, readme, rootResponse, pulls, issues] = await Promise.all([
    request(
      http,
      `${base}/commits/${encodeURIComponent(branch)}`,
      token,
      "application/vnd.github+json",
    ),
    optionalRaw(http, `${base}/readme`, token),
    request(http, `${base}/contents/`, token, "application/vnd.github+json"),
    fetchPullRequests(http, base, token),
    fetchOpenIssues(http, base, token),
  ]);
  const commitData = (await commit.json().catch(() => null)) as CommitResponse | null;
  if (!commitData?.sha) {
    throw new Error("GitHub did not return a commit SHA; try again.");
  }

  const root = (await rootResponse.json().catch(() => null)) as ContentEntry[] | null;
  const rootEntries = Array.isArray(root) ? root : [];
  const rootFiles = rootEntries.filter((entry) => entry.type === "file");
  const topDocs = rootFiles
    .filter(
      (entry) =>
        entry.name &&
        entry.name.toLowerCase().endsWith(".md") &&
        !entry.name.toLowerCase().startsWith("readme") &&
        (entry.size ?? 0) <= 150_000,
    )
    .slice(0, 4)
    .map((entry) => entry.path)
    .filter((path): path is string => Boolean(path));

  const manifestNames = [
    "package.json",
    "Cargo.toml",
    "pyproject.toml",
    "go.mod",
    "composer.json",
    "Gemfile",
    "requirements.txt",
    "pom.xml",
    "build.gradle",
    "mix.exs",
  ];
  const manifestsPresent = manifestNames
    .filter((name) => rootFiles.some((entry) => entry.name === name))
    .slice(0, 3);

  let docsFiles: string[] = [];
  if (rootEntries.some((entry) => entry.name === "docs" && entry.type === "dir")) {
    try {
      const docsResponse = await request(
        http,
        `${base}/contents/${encodedPath("docs")}`,
        token,
        "application/vnd.github+json",
      );
      const docsList = (await docsResponse.json().catch(() => null)) as ContentEntry[] | null;
      docsFiles = Array.isArray(docsList)
        ? docsList
            .filter(
              (entry) =>
                entry.type === "file" &&
                entry.name?.toLowerCase().endsWith(".md") &&
                (entry.size ?? 0) <= 150_000,
            )
            .slice(0, 4)
            .map((entry) => entry.path)
            .filter((path): path is string => Boolean(path))
        : [];
    } catch (error) {
      if (!(error instanceof GitHubRequestError && error.status === 404)) throw error;
    }
  }

  const rawPaths = [
    ...topDocs,
    ...docsFiles,
    ...manifestsPresent.map((name) => name),
  ];
  const rawContents = await Promise.all(
    rawPaths.map((path) => optionalRaw(http, `${base}/contents/${encodedPath(path)}`, token)),
  );
  const contentsByPath = new Map<string, string>();
  rawPaths.forEach((path, index) => {
    const content = rawContents[index];
    if (content !== null) contentsByPath.set(path, content);
  });

  return {
    repo: {
      slug: ref.slug,
      description: limitChars(repo.description ?? "", 600),
      topics: Array.isArray(repo.topics) ? repo.topics.slice(0, 20) : [],
      language: repo.language ?? null,
      stars: repo.stargazers_count ?? 0,
      homepage: repo.homepage ?? null,
      license: repo.license?.spdx_id ?? null,
      archived: repo.archived === true,
      defaultBranch: branch,
      pushedAt: repo.pushed_at ?? null,
    },
    commitSha: commitData.sha,
    readme: readme ?? "",
    topDocs: topDocs.flatMap((path) => {
      const content = contentsByPath.get(path);
      return content === undefined ? [] : [{ path, content }];
    }),
    docs: docsFiles.flatMap((path) => {
      const content = contentsByPath.get(path);
      return content === undefined ? [] : [{ path, content }];
    }),
    manifests: manifestsPresent.flatMap((path) => {
      const content = contentsByPath.get(path);
      return content === undefined ? [] : [{ path, content: limitChars(content, 6_000) }];
    }),
    pullRequests: pulls,
    issues,
  };
}

async function fetchPullRequests(
  http: HttpClient,
  base: string,
  token: string | undefined,
): Promise<RepoSnapshot["pullRequests"]> {
  const merged: RepoSnapshot["pullRequests"] = [];
  const seen = new Set<number>();
  for (let page = 1; page <= 2 && merged.length < 30; page += 1) {
    const response = await request(
      http,
      `${base}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`,
      token,
      "application/vnd.github+json",
    );
    const pulls = (await response.json().catch(() => null)) as PullResponse[] | null;
    if (!Array.isArray(pulls) || pulls.length === 0) break;
    for (const pull of pulls) {
      if (!pull.merged_at || pull.number === undefined || seen.has(pull.number)) continue;
      seen.add(pull.number);
      merged.push({
        number: pull.number,
        title: limitChars(pull.title ?? "", 300),
        body: limitChars(pull.body ?? "", 2_000),
        mergedAt: pull.merged_at,
      });
      if (merged.length >= 30) break;
    }
  }
  return merged;
}

async function fetchOpenIssues(
  http: HttpClient,
  base: string,
  token: string | undefined,
): Promise<RepoSnapshot["issues"]> {
  const response = await request(
    http,
    `${base}/issues?state=open&sort=updated&direction=desc&per_page=50`,
    token,
    "application/vnd.github+json",
  );
  const issues = (await response.json().catch(() => null)) as IssueResponse[] | null;
  if (!Array.isArray(issues)) return [];
  return issues
    .filter((issue) => !issue.pull_request && issue.number !== undefined)
    .slice(0, 30)
    .map((issue) => ({
      number: issue.number as number,
      title: limitChars(issue.title ?? "", 300),
      body: limitChars(issue.body ?? "", 2_000),
      createdAt: issue.created_at ?? "",
    }));
}

export async function fetchBranchHead(
  ref: RepoRef,
  branch: string,
  http: HttpClient,
  token?: string,
): Promise<string> {
  const base = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  const response = await request(
    http,
    `${base}/commits/${encodeURIComponent(branch)}`,
    token,
    "application/vnd.github+json",
  );
  const data = (await response.json().catch(() => null)) as CommitResponse | null;
  if (!data?.sha) throw new Error("GitHub did not return a commit SHA; try again.");
  return data.sha;
}

export function buildAnalysisCorpus(snapshot: RepoSnapshot, maxChars = 60_000): string {
  const parts: string[] = [];
  let remaining = maxChars;
  const push = (text: string, cap: number) => {
    if (remaining <= 0) return;
    const body = limitChars(text, Math.min(cap, remaining));
    if (!body) return;
    parts.push(body);
    remaining -= body.length + 2;
  };

  push(
    [
      `REPOSITORY: ${snapshot.repo.slug}`,
      `DESCRIPTION: ${snapshot.repo.description || "(none)"}`,
      `TOPICS: ${snapshot.repo.topics.join(", ") || "(none)"}`,
      `LANGUAGE: ${snapshot.repo.language || "(unknown)"}`,
      `STARS: ${snapshot.repo.stars}`,
      `HOMEPAGE: ${snapshot.repo.homepage || "(none)"}`,
      `LICENSE: ${snapshot.repo.license || "(none)"}`,
      `ARCHIVED: ${snapshot.repo.archived ? "yes" : "no"}`,
      `DEFAULT BRANCH: ${snapshot.repo.defaultBranch}`,
      `LAST PUSH: ${snapshot.repo.pushedAt || "(unknown)"}`,
      `COMMIT: ${snapshot.commitSha}`,
    ].join("\n"),
    2_000,
  );

  if (snapshot.readme) {
    push(`README\n${snapshot.readme}`, 12_000);
  }

  for (const doc of snapshot.topDocs) {
    push(`TOP-LEVEL DOCUMENT: ${doc.path}\n${doc.content}`, 4_000);
  }
  for (const doc of snapshot.docs) {
    push(`DOCS: ${doc.path}\n${doc.content}`, 4_000);
  }
  for (const manifest of snapshot.manifests) {
    push(`MANIFEST: ${manifest.path}\n${manifest.content}`, 3_000);
  }

  const pullText = snapshot.pullRequests
    .map(
      (pull) =>
        `PR #${pull.number} (merged ${pull.mergedAt ?? "unknown"}): ${pull.title}\n${pull.body}`.trim(),
    )
    .join("\n\n");
  if (pullText) push(`MERGED PULL REQUESTS\n${pullText}`, 12_000);

  const issueText = snapshot.issues
    .map(
      (issue) =>
        `ISSUE #${issue.number} (${issue.createdAt}): ${issue.title}\n${issue.body}`.trim(),
    )
    .join("\n\n");
  if (issueText) push(`OPEN ISSUES\n${issueText}`, 12_000);

  return parts.join("\n\n").slice(0, maxChars);
}
