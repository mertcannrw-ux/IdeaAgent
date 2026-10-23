import { describe, expect, it } from "vitest";
import { dedupeResults } from "./dedupe";
import type { SearchResult } from "./types";

function result(overrides: Partial<SearchResult>): SearchResult {
  return {
    url: "https://example.com/a",
    title: "A",
    snippet: "Text",
    publishedAt: "2026-10-01T00:00:00Z",
    author: null,
    competitor: "Acme",
    source: "Exa",
    query: "Acme",
    ...overrides,
  };
}

describe("dedupeResults", () => {
  const cutoff = new Date("2026-09-22T00:00:00Z");

  it("deduplicates by normalised URL and removes seen and old results", () => {
    const output = dedupeResults(
      [
        result({ url: "https://example.com/a?utm_source=x" }),
        result({ url: "https://example.com/a" }),
        result({ url: "https://example.com/seen" }),
        result({ url: "https://example.com/old", publishedAt: "2026-08-01T00:00:00Z" }),
        result({ url: "https://example.com/undated", publishedAt: null }),
      ],
      ["https://example.com/seen?utm_campaign=y"],
      cutoff,
      10,
    );
    expect(output.map((item) => item.url)).toEqual([
      "https://example.com/a",
      "https://example.com/undated",
    ]);
  });

  it("caps the number of results", () => {
    const output = dedupeResults(
      [
        result({ url: "https://example.com/1" }),
        result({ url: "https://example.com/2" }),
        result({ url: "https://example.com/3" }),
      ],
      [],
      cutoff,
      2,
    );
    expect(output).toHaveLength(2);
  });
});
