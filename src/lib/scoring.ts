import { BUCKETS } from "./types";
import type {
  Bucket,
  SourceRef,
  Theme,
  ThemeCandidate,
  ThemeScore,
} from "./types";

export function distinctVoices(sources: SourceRef[]): number {
  const voices = new Set<string>();
  for (const source of sources) {
    const author = source.author?.trim().toLowerCase();
    voices.add(author ? `author:${author}` : `url:${source.url}`);
  }
  return voices.size;
}

export function frequencyScore(voices: number): number {
  return Math.min(5, Math.max(1, voices));
}

export function computeScore(input: {
  frequency: number;
  pain: number;
  money: number;
  fit: number;
  effort: number;
}): number {
  const clamp = (value: number) => Math.min(5, Math.max(1, Math.round(value)));
  const frequency = clamp(input.frequency);
  const pain = clamp(input.pain);
  const money = clamp(input.money);
  const fit = clamp(input.fit);
  const effort = clamp(input.effort);
  const base = (frequency * pain * fit) / effort;
  return Math.round(base * (money >= 4 ? 1.2 : 1) * 100) / 100;
}

export function trendFor(
  previousRuns: number,
  lastScore: number | null,
  score: number,
): Theme["trend"] {
  if (previousRuns === 0) return "new";
  if (lastScore !== null && score >= lastScore * 1.15) return "rising";
  return "seen";
}

export function scoreTheme(candidate: ThemeCandidate, score: ThemeScore): Theme {
  const frequency = frequencyScore(distinctVoices(candidate.sources));
  const pain = clampScore(score.pain);
  const money = clampScore(score.money);
  const fit = clampScore(score.fit);
  const effort = clampScore(score.effort);
  const total = computeScore({ frequency, pain, money, fit, effort });
  return {
    ...candidate,
    bucket: score.bucket,
    trend: trendFor(candidate.runCount - 1, candidate.lastScore, total),
    score: total,
    frequency,
    pain,
    money,
    fit,
    effort,
  };
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 3;
  return Math.min(5, Math.max(1, Math.round(value)));
}

export function parseThemeScores(value: unknown, themeCount: number): ThemeScore[] {
  const data = value as { themes?: unknown } | null;
  if (!data || !Array.isArray(data.themes)) {
    throw new Error("The model returned malformed scores; run again or reset the prompt files.");
  }
  const scores: ThemeScore[] = Array.from({ length: themeCount }, () => ({
    pain: 3,
    money: 2,
    fit: 3,
    effort: 3,
    bucket: "new" as Bucket,
  }));
  for (const raw of data.themes) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as {
      index?: unknown;
      pain?: unknown;
      money?: unknown;
      fit?: unknown;
      effort?: unknown;
      bucket?: unknown;
    };
    if (
      typeof entry.index !== "number" ||
      !Number.isInteger(entry.index) ||
      entry.index < 0 ||
      entry.index >= themeCount
    ) {
      continue;
    }
    scores[entry.index] = {
      pain: numericScore(entry.pain),
      money: numericScore(entry.money),
      fit: numericScore(entry.fit),
      effort: numericScore(entry.effort),
      bucket:
        typeof entry.bucket === "string" && (BUCKETS as readonly string[]).includes(entry.bucket)
          ? (entry.bucket as Bucket)
          : "new",
    };
  }
  return scores;
}

function numericScore(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(5, Math.max(1, Math.round(value)))
    : 3;
}
