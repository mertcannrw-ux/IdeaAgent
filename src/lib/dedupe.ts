import type { SearchResult } from "./types";
import { normalizeUrl } from "./urls";

export function dedupeResults(
  results: SearchResult[],
  seenUrls: string[],
  cutoff: Date,
  maxResults: number,
): SearchResult[] {
  const seen = new Set(seenUrls.map((url) => normalizeUrl(url) ?? url));
  const output: SearchResult[] = [];
  for (const result of results) {
    if (output.length >= maxResults) break;
    const normalized = normalizeUrl(result.url);
    if (!normalized || seen.has(normalized)) continue;
    if (result.publishedAt) {
      const time = new Date(result.publishedAt);
      if (!Number.isNaN(time.getTime()) && time < cutoff) continue;
    }
    seen.add(normalized);
    output.push({ ...result, url: normalized });
  }
  return output;
}
