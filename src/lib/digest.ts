import type { SourceRef, Theme } from "./types";
import { collapseWhitespace } from "./text";

export const MAX_DIGEST_ITEMS = 10;

export interface DigestInput {
  date: string;
  repo: string;
  lookbackLabel: string;
  costUsd: number;
  summary: string;
  themes: Theme[];
}

export function selectDigestThemes(themes: Theme[]): Theme[] {
  return themes
    .filter(
      (theme) =>
        theme.bucket !== "ignore" &&
        theme.sources.some((source) => validHttpUrl(source.url) !== ""),
    )
    .sort((a, b) => b.score - a.score || b.itemCount - a.itemCount || a.name.localeCompare(b.name))
    .slice(0, MAX_DIGEST_ITEMS);
}

export function renderDigest(input: DigestInput): string {
  const selected = selectDigestThemes(input.themes);
  if (selected.length === 0) {
    throw new Error(
      "No actionable complaints were found; widen the lookback or add competitors and run again.",
    );
  }
  const opportunities = selected.filter((theme) => theme.bucket !== "have it");
  const ammo = selected.filter((theme) => theme.bucket === "have it");
  const summary = ensureSentence(input.summary, fallbackSummary(selected));

  const lines: string[] = [
    "---",
    `date: ${input.date}`,
    `repo: ${input.repo}`,
    `lookback: ${input.lookbackLabel}`,
    `items: ${selected.length}`,
    `cost: ${input.costUsd.toFixed(4)}`,
    "---",
    "",
    summary,
    "",
  ];

  if (opportunities.length > 0) {
    lines.push("## Opportunities", "");
    for (const theme of opportunities) lines.push(...renderTheme(theme), "");
  }
  if (ammo.length > 0) {
    lines.push("## Marketing ammo", "");
    for (const theme of ammo) lines.push(...renderTheme(theme), "");
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function renderTheme(theme: Theme): string[] {
  const sources = theme.sources
    .filter((source) => validHttpUrl(source.url) !== "")
    .slice(0, 3);
  const trend =
    theme.trend === "new"
      ? "new"
      : theme.trend === "rising"
        ? "rising"
        : `seen in ${theme.runCount} runs`;
  const scoreLine = [
    `**Score ${formatScore(theme.score)}**`,
    `trend ${trend}`,
    `bucket ${theme.bucket}`,
    `freq ${theme.frequency}`,
    `pain ${theme.pain}`,
    `money ${theme.money}`,
    `fit ${theme.fit}`,
    `effort ${theme.effort}`,
  ].join(" · ");
  return [
    `### ${collapseWhitespace(theme.name)}`,
    "",
    ensureSentence(theme.summary, "No summary available."),
    "",
    scoreLine,
    "",
    ...sources.map((source) => `- ${sourceLine(source)}`),
  ];
}

function sourceLine(source: SourceRef): string {
  const url = validHttpUrl(source.url);
  const title = escapeLinkText(source.title) || hostOf(url) || "Source";
  const date = source.publishedAt?.slice(0, 10);
  const destination = url.replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `[${title}](${destination})${date ? ` · ${date}` : ""}`;
}

function validHttpUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function hostOf(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function escapeLinkText(value: string): string {
  return collapseWhitespace(value).replace(/[[\]]/g, "");
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function ensureSentence(value: string, fallback: string): string {
  const clean = collapseWhitespace(value);
  if (!clean) return fallback;
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function fallbackSummary(themes: Theme[]): string {
  const competitors = new Set(themes.map((theme) => theme.competitor).filter(Boolean));
  return `${themes.length} theme${themes.length === 1 ? "" : "s"} across ${competitors.size} competitor${competitors.size === 1 ? "" : "s"} stood out in this run.`;
}

export function digestRelativePath(date: string, existingFiles: string[]): string {
  const existing = new Set(
    existingFiles.map((file) => file.replace(/\\/g, "/").toLowerCase()),
  );
  let suffix = "";
  let counter = 1;
  while (existing.has(`radar/${date}${suffix}.md`)) {
    counter += 1;
    suffix = `-${counter}`;
  }
  return `Radar/${date}${suffix}.md`;
}
