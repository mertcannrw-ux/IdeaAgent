import type { LlmClient } from "./llm";
import { parseModelJson } from "./llm";
import type { SearchProvider } from "./search";
import { buildQueryPlan } from "./search";
import type {
  Competitor,
  ExtractedItem,
  Limits,
  PreviousTheme,
  PromptSet,
  RunResult,
  SearchResult,
  Theme,
  ThemeScore,
} from "./types";
import { CostMeter } from "./cost";
import { parseExtraction } from "./extraction";
import { mergeThemes, parseThemeClusters, resolveClusterKey } from "./themes";
import { parseThemeScores, scoreTheme } from "./scoring";
import { digestRelativePath, renderDigest, selectDigestThemes } from "./digest";
import { limitChars, localDate } from "./text";
import { dedupeResults } from "./dedupe";

const EXTRACTION_BATCH = 8;
const MAX_RESULTS = 80;

function parseStageJson(text: string, stage: string): unknown {
  try {
    return parseModelJson(text);
  } catch {
    throw new Error(`The ${stage} model returned malformed JSON; run again.`);
  }
}

export interface PipelineInput {
  repoSlug: string;
  productContext: string;
  roadmap: string;
  competitors: Competitor[];
  prompts: PromptSet;
  llm: LlmClient;
  cheapModel: string;
  smartModel: string;
  searchProviders: SearchProvider[];
  limits: Limits;
  lookbackDays: number;
  lookbackLabel: string;
  previousThemes: PreviousTheme[];
  seenUrls: string[];
  existingDigestFiles: string[];
  now: Date;
  onStatus: (line: string) => void;
}

export async function runPipeline(input: PipelineInput): Promise<RunResult> {
  const { limits, llm, cheapModel, smartModel, prompts, now } = input;
  const meter = new CostMeter(limits, llm.provider);
  const cutoff = new Date(now.getTime() - input.lookbackDays * 86_400_000);
  const activeCompetitors = input.competitors.filter(
    (competitor) => competitor.enabled && competitor.name.trim(),
  );
  if (activeCompetitors.length === 0) {
    throw new Error("Add at least one competitor in Settings and confirm the list before running.");
  }

  const providers = new Map<string, SearchProvider>(
    input.searchProviders.map((provider) => [provider.id, provider]),
  );
  const plan = buildQueryPlan(
    activeCompetitors,
    [...providers.keys()] as SearchProvider["id"][],
    limits.maxQueries,
  );
  input.onStatus(`Searching ${plan.length} queries for ${activeCompetitors.length} competitors…`);

  const rawResults: SearchResult[] = [];
  let failures = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < plan.length) {
      const item = plan[cursor];
      cursor += 1;
      const provider = providers.get(item.providerId);
      if (!provider) continue;
      meter.beforeSearch(provider.id);
      try {
        const results = await provider.search(item.query, {
          since: cutoff,
          competitor: item.competitor,
        });
        rawResults.push(...results);
      } catch {
        failures += 1;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(3, Math.max(1, plan.length)) }, () => worker()),
  );
  if (failures === plan.length && plan.length > 0) {
    throw new Error("All searches failed; check your search key and connection and try again.");
  }
  if (failures > 0) {
    input.onStatus(`${failures} of ${plan.length} searches failed; continuing with what returned.`);
  }

  const results = dedupeResults(rawResults, input.seenUrls, cutoff, MAX_RESULTS);
  if (results.length === 0) {
    throw new Error(
      "No new complaints found in this window; widen the lookback or add competitors and run again.",
    );
  }
  input.onStatus(`Found ${results.length} new results.`);

  const items: ExtractedItem[] = [];
  const processedUrls = new Set<string>();
  for (let start = 0; start < results.length; start += EXTRACTION_BATCH) {
    const batch = results.slice(start, start + EXTRACTION_BATCH);
    const payload = batch.map((result, index) => ({
      index,
      competitor: result.competitor,
      title: result.title,
      url: result.url,
      date: result.publishedAt,
      text: result.snippet,
    }));
    const extractionInput = JSON.stringify(payload);
    meter.beforeLlm(`${prompts.extract}\n${extractionInput}`, cheapModel, 0);
    const response = await llm.complete({
      system: prompts.extract,
      input: extractionInput,
      model: cheapModel,
      temperature: 0.1,
      json: true,
    });
    meter.addLlm(response.usage, cheapModel);
    const parsed = parseExtraction(parseStageJson(response.text, "extraction"), batch);
    items.push(...parsed);
    for (const result of batch) processedUrls.add(result.url);
  }
  if (items.length === 0) {
    throw new Error(
      "No complaints found in this window; widen the lookback or add competitors and run again.",
    );
  }
  input.onStatus(`Extracted ${items.length} complaints.`);

  input.onStatus("Grouping complaints into themes…");
  const clusterInput = JSON.stringify({
    previousThemes: input.previousThemes.slice(0, 60).map((theme) => ({
      id: theme.id,
      name: theme.name,
      summary: theme.summary,
      category: theme.category,
      runs: theme.runCount,
    })),
    items: items.map((item, index) => ({
      index,
      competitor: item.competitor,
      category: item.category,
      summary: item.summary,
      quote: item.quote,
    })),
  });
  meter.beforeLlm(`${prompts.cluster}\n${clusterInput}`, smartModel, 0);
  const clusterResponse = await llm.complete({
    system: prompts.cluster,
    input: clusterInput,
    model: smartModel,
    temperature: 0.1,
    json: true,
  });
  meter.addLlm(clusterResponse.usage, smartModel);
  const clusters = parseThemeClusters(
    parseStageJson(clusterResponse.text, "clustering"),
    items,
  );
  const candidates = mergeThemes(input.previousThemes, clusters, items);
  for (const cluster of clusters) {
    const key = resolveClusterKey(input.previousThemes, cluster);
    for (const index of cluster.itemIndexes) {
      if (items[index]) items[index].themeKey = key;
    }
  }

  input.onStatus(`Scoring ${candidates.length} themes…`);
  const evidence = new Map<string, string[]>();
  for (const item of items) {
    if (!item.themeKey) continue;
    const list = evidence.get(item.themeKey) ?? [];
    if (list.length < 3) list.push(item.quote);
    evidence.set(item.themeKey, list);
  }
  const scoreInput = JSON.stringify({
    productContext: input.productContext,
    roadmap: input.roadmap,
    themes: candidates.map((theme, index) => ({
      index,
      name: theme.name,
      summary: theme.summary,
      category: theme.category,
      competitor: theme.competitor,
      sources: theme.sources.slice(0, 8).map((source) => ({
        title: source.title,
        url: source.url,
        date: source.publishedAt,
      })),
      evidence: evidence.get(theme.key) ?? [],
    })),
  });
  meter.beforeLlm(`${prompts.score}\n${scoreInput}`, smartModel, 0);
  const scoreResponse = await llm.complete({
    system: prompts.score,
    input: scoreInput,
    model: smartModel,
    temperature: 0.1,
    json: true,
  });
  meter.addLlm(scoreResponse.usage, smartModel);
  const scores = parseThemeScores(
    parseStageJson(scoreResponse.text, "scoring"),
    candidates.length,
  );
  const themes: Theme[] = candidates.map((candidate, index) =>
    scoreTheme(candidate, scores[index] as ThemeScore),
  );

  const selected = selectDigestThemes(themes);
  if (selected.length === 0) {
    throw new Error(
      "No actionable complaints were found; widen the lookback or add competitors and run again.",
    );
  }

  let summary = "";
  try {
    const summaryInput = JSON.stringify({
      repo: input.repoSlug,
      lookback: input.lookbackLabel,
      themes: selected.map((theme) => ({
        name: theme.name,
        competitor: theme.competitor,
        bucket: theme.bucket,
        score: theme.score,
        summary: theme.summary,
      })),
    });
    meter.beforeLlm(`${prompts.summary}\n${summaryInput}`, smartModel, 0);
    const summaryResponse = await llm.complete({
      system: prompts.summary,
      input: summaryInput,
      model: smartModel,
      temperature: 0.2,
      json: true,
    });
    meter.addLlm(summaryResponse.usage, smartModel);
    const parsed = parseModelJson(summaryResponse.text) as { summary?: unknown } | null;
    if (parsed && typeof parsed.summary === "string") {
      summary = limitChars(parsed.summary.trim(), 300);
    }
  } catch {
    summary = "";
  }

  input.onStatus("Writing digest…");
  const date = localDate(now);
  const markdown = renderDigest({
    date,
    repo: input.repoSlug,
    lookbackLabel: input.lookbackLabel,
    costUsd: meter.totalUsd,
    summary,
    themes,
  });

  return {
    markdown,
    date,
    lookbackDays: input.lookbackDays,
    lookbackLabel: input.lookbackLabel,
    itemCount: selected.length,
    costUsd: meter.totalUsd,
    summary,
    themes,
    items,
    processedUrls: [...processedUrls],
    digestRel: digestRelativePath(date, input.existingDigestFiles),
  };
}
