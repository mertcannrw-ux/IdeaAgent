import type { Lookback, Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  repoUrl: "",
  llmProvider: "anthropic",
  anthropicCheapModel: "",
  anthropicSmartModel: "",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiCheapModel: "",
  openaiSmartModel: "",
  searchProvider: "exa",
  vaultPath: "",
  roadmap: "",
  limits: {
    maxQueries: 18,
    maxLlmCalls: 24,
    maxSpendUsd: 0.5,
  },
  lookback: "since",
};

const LOOKBACKS: Lookback[] = ["since", "7", "30"];

function cloneDefaults(): Settings {
  return { ...DEFAULT_SETTINGS, limits: { ...DEFAULT_SETTINGS.limits } };
}

export function parseSettings(raw: string | null | undefined): Settings {
  if (!raw) return cloneDefaults();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return cloneDefaults();
  }
  if (!value || typeof value !== "object") return cloneDefaults();
  const v = value as Partial<Settings>;
  const limits = (v.limits ?? {}) as Partial<Settings["limits"]>;
  const boundedInt = (input: unknown, fallback: number, min: number, max: number) =>
    typeof input === "number" && Number.isFinite(input)
      ? Math.min(max, Math.max(min, Math.round(input)))
      : fallback;
  const boundedNumber = (input: unknown, fallback: number, min: number, max: number) =>
    typeof input === "number" && Number.isFinite(input)
      ? Math.min(max, Math.max(min, input))
      : fallback;
  return {
    repoUrl: typeof v.repoUrl === "string" ? v.repoUrl : "",
    llmProvider: v.llmProvider === "openai" ? "openai" : "anthropic",
    anthropicCheapModel:
      typeof v.anthropicCheapModel === "string"
        ? v.anthropicCheapModel
        : DEFAULT_SETTINGS.anthropicCheapModel,
    anthropicSmartModel:
      typeof v.anthropicSmartModel === "string"
        ? v.anthropicSmartModel
        : DEFAULT_SETTINGS.anthropicSmartModel,
    openaiBaseUrl:
      typeof v.openaiBaseUrl === "string" ? v.openaiBaseUrl : DEFAULT_SETTINGS.openaiBaseUrl,
    openaiCheapModel:
      typeof v.openaiCheapModel === "string"
        ? v.openaiCheapModel
        : DEFAULT_SETTINGS.openaiCheapModel,
    openaiSmartModel:
      typeof v.openaiSmartModel === "string"
        ? v.openaiSmartModel
        : DEFAULT_SETTINGS.openaiSmartModel,
    searchProvider:
      v.searchProvider === "brave" ? "brave" : v.searchProvider === "hn" ? "hn" : "exa",
    vaultPath: typeof v.vaultPath === "string" ? v.vaultPath : "",
    roadmap: typeof v.roadmap === "string" ? v.roadmap : "",
    limits: {
      maxQueries: boundedInt(limits.maxQueries, DEFAULT_SETTINGS.limits.maxQueries, 1, 100),
      maxLlmCalls: boundedInt(limits.maxLlmCalls, DEFAULT_SETTINGS.limits.maxLlmCalls, 1, 200),
      maxSpendUsd: boundedNumber(
        limits.maxSpendUsd,
        DEFAULT_SETTINGS.limits.maxSpendUsd,
        0.01,
        100,
      ),
    },
    lookback: LOOKBACKS.includes(v.lookback as Lookback)
      ? (v.lookback as Lookback)
      : DEFAULT_SETTINGS.lookback,
  };
}

export function cheapModel(settings: Settings): string {
  return settings.llmProvider === "anthropic"
    ? settings.anthropicCheapModel.trim()
    : settings.openaiCheapModel.trim();
}

export function smartModel(settings: Settings): string {
  return settings.llmProvider === "anthropic"
    ? settings.anthropicSmartModel.trim()
    : settings.openaiSmartModel.trim();
}

export function llmKeyId(settings: Settings): "anthropic_key" | "openai_key" {
  return settings.llmProvider === "anthropic" ? "anthropic_key" : "openai_key";
}

export function searchKeyId(settings: Settings): "exa_key" | "brave_key" | null {
  if (settings.searchProvider === "hn") return null;
  return settings.searchProvider === "exa" ? "exa_key" : "brave_key";
}
