import { fetchWithTimeout, networkError } from "../lib/http";
import { createLlmClient } from "../lib/llm";
import { BraveSearchProvider, ExaSearchProvider, HackerNewsSearchProvider } from "../lib/search";
import {
  cheapModel,
  llmKeyId,
  searchKeyId,
  smartModel,
} from "../lib/settings";
import type {
  RepoAnalysis,
  RunSummary,
  SearchProviderId,
  Settings,
} from "../lib/types";
import { parseRepoUrl } from "../lib/urls";
import { fetchBranchHead } from "../lib/github";
import { runPipeline } from "../lib/pipeline";
import { newSessionId } from "../lib/text";
import {
  loadPreviousThemes,
  loadSeenUrls,
  markSeen,
  persistRun,
  listRuns,
} from "./db";
import { ensureVault, listDigestFiles, loadPrompts, writeDigest } from "./files";
import { allowHttpOrigin, http } from "./network";
import { getSecret } from "./secrets";

export async function loadLlmModels(
  settings: Settings,
  apiKey: string,
): Promise<string[]> {
  if (!apiKey.trim()) throw new Error("Paste a key before saving.");
  if (settings.llmProvider === "openai") {
    if (!settings.openaiBaseUrl.trim()) {
      throw new Error("Add a base URL for the OpenAI-compatible provider in Settings.");
    }
    await allowHttpOrigin(settings.openaiBaseUrl);
  }
  const llm = createLlmClient({
    provider: settings.llmProvider,
    apiKey,
    baseUrl: settings.openaiBaseUrl,
    http,
  });
  return llm.listModels();
}

export async function validateSearchKey(
  provider: SearchProviderId,
  apiKey: string,
): Promise<void> {
  if (!apiKey.trim()) throw new Error("Paste a key before saving.");
  const search =
    provider === "exa"
      ? new ExaSearchProvider(apiKey, http)
      : new BraveSearchProvider(apiKey, http);
  await search.test?.();
}

export async function validateGithubToken(token: string): Promise<void> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      http,
      "https://api.github.com/user",
      {
        method: "GET",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
        },
      },
      20_000,
    );
  } catch (error) {
    throw networkError("GitHub", error);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("GitHub rejected the token; check it in Settings.");
    }
    if (response.status >= 500) {
      throw new Error("GitHub is unavailable; try again in a few minutes.");
    }
    throw new Error("GitHub could not validate the token; try again.");
  }
}

export async function branchMoved(
  settings: Settings,
  analysis: RepoAnalysis,
): Promise<boolean> {
  const ref = parseRepoUrl(settings.repoUrl);
  if (!ref || !analysis.defaultBranch) return false;
  const token = await getSecret("github_token").catch(() => null);
  try {
    const head = await fetchBranchHead(ref, analysis.defaultBranch, http, token ?? undefined);
    return head !== analysis.commitSha;
  } catch {
    return false;
  }
}

export interface RunOutcome {
  summary: RunSummary;
  markdown: string;
}

export async function runRadar(
  settings: Settings,
  analysis: RepoAnalysis,
  onStatus: (line: string) => void,
  now = new Date(),
): Promise<RunOutcome> {
  const ref = parseRepoUrl(settings.repoUrl);
  if (!ref) throw new Error("Enter a valid GitHub repository URL in Settings.");
  if (!analysis.confirmedAt) {
    throw new Error("Confirm the competitor list in Settings before running.");
  }
  if (!settings.vaultPath.trim()) {
    throw new Error("Choose an Obsidian vault folder in Settings.");
  }
  const cheap = cheapModel(settings);
  const smart = smartModel(settings);
  if (!cheap || !smart) {
    throw new Error("Add cheap and smart model names in Settings.");
  }

  const llmKey = await getSecret(llmKeyId(settings));
  if (!llmKey) {
    throw new Error(
      settings.llmProvider === "anthropic"
        ? "Add an Anthropic key in Settings."
        : "Add an OpenAI-compatible key in Settings.",
    );
  }
  const keyId = searchKeyId(settings);
  const searchKey = keyId ? await getSecret(keyId) : null;
  if (keyId && !searchKey) {
    const provider = settings.searchProvider === "exa" ? "an Exa" : "a Brave";
    throw new Error(`Add ${provider} key in Settings, or switch the search provider to Hacker News.`);
  }
  if (settings.llmProvider === "openai") {
    await allowHttpOrigin(settings.openaiBaseUrl);
  }

  await ensureVault(settings.vaultPath);
  const startedAt = now.toISOString();
  const prompts = await loadPrompts();
  const llm = createLlmClient({
    provider: settings.llmProvider,
    apiKey: llmKey,
    baseUrl: settings.openaiBaseUrl,
    sessionId: newSessionId(),
    http,
  });
  const hnSearch = new HackerNewsSearchProvider(http);
  const searchProviders =
    settings.searchProvider === "hn"
      ? [hnSearch]
      : [
          settings.searchProvider === "exa"
            ? new ExaSearchProvider(searchKey ?? "", http)
            : new BraveSearchProvider(searchKey ?? "", http),
          hnSearch,
        ];

  const priorRuns = await listRuns(settings.repoUrl);
  const lastRunTime = priorRuns[0] ? new Date(priorRuns[0].finishedAt).getTime() : NaN;
  const days =
    settings.lookback === "since"
      ? Number.isNaN(lastRunTime)
        ? 7
        : Math.min(365, Math.max(1, Math.ceil((now.getTime() - lastRunTime) / 86_400_000)))
      : Number(settings.lookback);
  const [previousThemes, seenUrls, existingDigestFiles] = await Promise.all([
    loadPreviousThemes(settings.repoUrl),
    loadSeenUrls(settings.repoUrl),
    listDigestFiles(settings.vaultPath),
  ]);

  let result;
  try {
    result = await runPipeline({
    repoSlug: ref.slug,
    productContext: analysis.productContext,
    roadmap: settings.roadmap,
    competitors: analysis.competitors,
    prompts,
    llm,
    cheapModel: cheap,
    smartModel: smart,
    searchProviders,
    limits: settings.limits,
    lookbackDays: days,
    lookbackLabel: `${days}d`,
    previousThemes,
    seenUrls,
    existingDigestFiles,
      now,
      onStatus,
    });
  } catch (error) {
    if (
      settings.searchProvider === "hn" &&
      error instanceof Error &&
      /No (new )?complaints found/.test(error.message)
    ) {
      throw new Error(
        "Hacker News returned no usable complaints; add an Exa or Brave key for broader coverage or widen the lookback.",
      );
    }
    throw error;
  }

  await writeDigest(settings.vaultPath, result.digestRel, result.markdown);
  const summary = await persistRun({
    repoUrl: settings.repoUrl,
    vaultPath: settings.vaultPath,
    startedAt,
    finishedAt: new Date().toISOString(),
    result,
  });
  await markSeen(settings.repoUrl, result.processedUrls);
  return { summary, markdown: result.markdown };
}
