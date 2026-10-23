import { CATEGORIES, MONEY_SIGNALS } from "./types";
import type { Category, ExtractedItem, MoneySignal, SearchResult } from "./types";
import { collapseWhitespace, limitChars, limitWords } from "./text";
import { normalizeUrl } from "./urls";

export function parseExtraction(value: unknown, batch: SearchResult[]): ExtractedItem[] {
  const data = value as { items?: unknown } | null;
  if (!data || !Array.isArray(data.items)) {
    throw new Error("The model returned malformed complaints; run again or reset the prompt files.");
  }
  const resultByIndex = new Map(batch.map((result, index) => [index, result]));
  const seen = new Set<string>();
  const items: ExtractedItem[] = [];
  for (const raw of data.items) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as {
      index?: unknown;
      isComplaint?: unknown;
      category?: unknown;
      money?: unknown;
      summary?: unknown;
      quote?: unknown;
    };
    if (
      entry.isComplaint !== true ||
      typeof entry.index !== "number" ||
      !Number.isInteger(entry.index)
    ) {
      continue;
    }
    const result = resultByIndex.get(entry.index);
    if (!result) continue;
    const url = normalizeUrl(result.url);
    if (!url || seen.has(url)) continue;
    const summary = collapseWhitespace(
      typeof entry.summary === "string" ? entry.summary : "",
    );
    if (!summary) continue;
    const quote = limitWords(
      collapseWhitespace(typeof entry.quote === "string" ? entry.quote : "") ||
        result.snippet,
      20,
    );
    if (!quote) continue;
    seen.add(url);
    items.push({
      url,
      title: limitChars(result.title, 200),
      competitor: result.competitor,
      category: isCategory(entry.category) ? entry.category : "other",
      money: isMoney(entry.money) ? entry.money : "none",
      summary: limitChars(summary, 300),
      quote,
      author: result.author,
      publishedAt: result.publishedAt,
      source: result.source,
    });
  }
  return items;
}

function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

function isMoney(value: unknown): value is MoneySignal {
  return typeof value === "string" && (MONEY_SIGNALS as readonly string[]).includes(value);
}
