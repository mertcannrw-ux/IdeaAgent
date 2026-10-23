import type { Limits, LlmProviderId } from "./types";
import { formatUsd } from "./text";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

interface Pricing {
  input: number;
  output: number;
}

const PRICING: Record<LlmProviderId, Record<string, Pricing>> = {
  anthropic: {
    "claude-opus-4": { input: 15, output: 75 },
    "claude-sonnet-4": { input: 3, output: 15 },
    "claude-haiku-4": { input: 1, output: 5 },
    "claude-3-7-sonnet": { input: 3, output: 15 },
    "claude-3-5-sonnet": { input: 3, output: 15 },
    "claude-3-5-haiku": { input: 0.8, output: 4 },
    "claude-3-opus": { input: 15, output: 75 },
  },
  openai: {
    "gpt-4.1-mini": { input: 0.4, output: 1.6 },
    "gpt-4.1-nano": { input: 0.1, output: 0.4 },
    "gpt-4.1": { input: 2, output: 8 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4o": { input: 2.5, output: 10 },
    "o4-mini": { input: 1.1, output: 4.4 },
    "o3-mini": { input: 1.1, output: 4.4 },
    o3: { input: 2, output: 8 },
  },
};

const FALLBACK_PRICING: Record<LlmProviderId, Pricing> = {
  anthropic: { input: 3, output: 15 },
  openai: { input: 2, output: 8 },
};

export const SEARCH_COST_USD: Record<string, number> = {
  exa: 0.005,
  brave: 0.005,
  hn: 0,
};

function pricingFor(provider: LlmProviderId, model: string): Pricing {
  const table = PRICING[provider];
  const match = Object.keys(table)
    .sort((a, b) => b.length - a.length)
    .find((prefix) => model.toLowerCase().startsWith(prefix));
  return match ? table[match] : FALLBACK_PRICING[provider];
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3));
}

export function estimateLlmCost(
  provider: LlmProviderId,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = pricingFor(provider, model);
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

export function costFromUsage(provider: LlmProviderId, model: string, usage: Usage): number {
  return estimateLlmCost(provider, model, usage.inputTokens, usage.outputTokens);
}

export function estimateCallCost(
  provider: LlmProviderId,
  model: string,
  inputText: string,
  maxOutputTokens: number,
): number {
  return estimateLlmCost(provider, model, estimateTokens(inputText), maxOutputTokens);
}

export class CostMeter {
  totalUsd = 0;
  llmCalls = 0;
  searchQueries = 0;

  constructor(
    private readonly limits: Limits,
    private readonly provider: LlmProviderId,
  ) {}

  beforeLlm(inputText: string, model: string, maxOutputTokens: number): void {
    if (this.llmCalls + 1 > this.limits.maxLlmCalls) {
      throw new Error(
        `Run stopped at your ${this.limits.maxLlmCalls}-call limit; raise it in Settings or shorten the lookback.`,
      );
    }
    const estimate = estimateCallCost(this.provider, model, inputText, maxOutputTokens);
    if (this.totalUsd + estimate > this.limits.maxSpendUsd) {
      throw new Error(
        `Run stopped at your ${formatUsd(this.limits.maxSpendUsd)} spend limit; raise it in Settings or shorten the lookback.`,
      );
    }
    this.llmCalls += 1;
  }

  addLlm(usage: Usage, model: string): void {
    this.totalUsd += costFromUsage(this.provider, model, usage);
  }

  beforeSearch(provider: string): void {
    if (this.searchQueries + 1 > this.limits.maxQueries) {
      throw new Error(
        `Run stopped at your ${this.limits.maxQueries}-query limit; raise it in Settings or shorten the lookback.`,
      );
    }
    const estimate = SEARCH_COST_USD[provider] ?? 0.005;
    if (this.totalUsd + estimate > this.limits.maxSpendUsd) {
      throw new Error(
        `Run stopped at your ${formatUsd(this.limits.maxSpendUsd)} spend limit; raise it in Settings or shorten the lookback.`,
      );
    }
    this.searchQueries += 1;
    this.totalUsd += estimate;
  }
}
