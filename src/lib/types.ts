export const CATEGORIES = [
  "reliability",
  "missing feature",
  "pricing",
  "workflow",
  "lock-in",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const MONEY_SIGNALS = ["none", "weak", "strong"] as const;
export type MoneySignal = (typeof MONEY_SIGNALS)[number];

export const BUCKETS = ["have it", "planned", "new", "ignore"] as const;
export type Bucket = (typeof BUCKETS)[number];

export type LlmProviderId = "anthropic" | "openai";
export type SearchProviderId = "exa" | "brave" | "hn";
export type Lookback = "since" | "7" | "30";

export interface Limits {
  maxQueries: number;
  maxLlmCalls: number;
  maxSpendUsd: number;
}

export interface Settings {
  repoUrl: string;
  llmProvider: LlmProviderId;
  anthropicCheapModel: string;
  anthropicSmartModel: string;
  openaiBaseUrl: string;
  openaiCheapModel: string;
  openaiSmartModel: string;
  searchProvider: SearchProviderId;
  vaultPath: string;
  roadmap: string;
  limits: Limits;
  lookback: Lookback;
}

export interface Competitor {
  name: string;
  aliases: string[];
  reason: string;
  enabled: boolean;
}

export interface GeneratedAnalysis {
  productContext: string;
  competitors: Competitor[];
}

export interface AnalysisDraft extends GeneratedAnalysis {
  analyzedAt: string;
  commitSha: string;
  defaultBranch: string;
}

export interface RepoAnalysis {
  repoUrl: string;
  defaultBranch: string;
  commitSha: string;
  analyzedAt: string;
  productContext: string;
  competitors: Competitor[];
  confirmedAt: string | null;
  contextEdited: boolean;
  competitorsEdited: boolean;
  draft: AnalysisDraft | null;
}

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  publishedAt: string | null;
  author: string | null;
  competitor: string;
  source: string;
  query: string;
}

export interface ExtractedItem {
  url: string;
  title: string;
  competitor: string;
  category: Category;
  money: MoneySignal;
  summary: string;
  quote: string;
  author: string | null;
  publishedAt: string | null;
  source: string;
  themeKey?: string;
}

export interface SourceRef {
  url: string;
  title: string;
  publishedAt: string | null;
  author: string | null;
}

export interface PreviousTheme {
  id: number;
  key: string;
  name: string;
  summary: string;
  category: Category;
  runCount: number;
  lastScore: number | null;
}

export interface ThemeCandidate {
  id: number | null;
  key: string;
  name: string;
  summary: string;
  category: Category;
  competitor: string;
  sources: SourceRef[];
  runCount: number;
  lastScore: number | null;
  itemCount: number;
}

export interface Theme extends ThemeCandidate {
  bucket: Bucket;
  trend: "new" | "rising" | "seen";
  score: number;
  frequency: number;
  pain: number;
  money: number;
  fit: number;
  effort: number;
}

export interface ThemeCluster {
  existingId: number | null;
  name: string;
  summary: string;
  category: Category;
  itemIndexes: number[];
}

export interface ThemeScore {
  pain: number;
  money: number;
  fit: number;
  effort: number;
  bucket: Bucket;
}

export interface RunSummary {
  id: number;
  date: string;
  finishedAt: string;
  itemCount: number;
  costUsd: number;
  digestRel: string;
}

export interface RunRecord extends RunSummary {
  repoUrl: string;
  vaultPath: string;
  markdown: string;
}

export interface RunResult {
  markdown: string;
  date: string;
  lookbackDays: number;
  lookbackLabel: string;
  itemCount: number;
  costUsd: number;
  summary: string;
  themes: Theme[];
  items: ExtractedItem[];
  processedUrls: string[];
  digestRel: string;
}

export interface PromptSet {
  repoAnalysis: string;
  extract: string;
  cluster: string;
  score: string;
  summary: string;
}

export type SecretId =
  | "github_token"
  | "anthropic_key"
  | "openai_key"
  | "exa_key"
  | "brave_key";
