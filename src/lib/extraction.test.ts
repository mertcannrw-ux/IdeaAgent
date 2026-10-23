import { describe, expect, it } from "vitest";
import { parseExtraction } from "./extraction";
import type { SearchResult } from "./types";

const batch: SearchResult[] = [
  {
    url: "https://example.com/complaint?utm_source=x",
    title: "Import pain",
    snippet: "The importer dies every time I upload a large CSV file and support is silent.",
    publishedAt: "2026-10-01T00:00:00Z",
    author: "alice",
    competitor: "Acme",
    source: "Hacker News",
    query: "Acme crashing",
  },
  {
    url: "https://example.com/tutorial",
    title: "How to use Acme",
    snippet: "A tutorial.",
    publishedAt: "2026-10-01T00:00:00Z",
    author: null,
    competitor: "Acme",
    source: "Exa",
    query: "Acme crashing",
  },
];

describe("parseExtraction", () => {
  it("keeps complaints, attaches real URLs and caps quotes at 20 words", () => {
    const items = parseExtraction(
      {
        items: [
          {
            index: 0,
            isComplaint: true,
            category: "reliability",
            money: "strong",
            summary: "Large imports fail.",
            quote:
              "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone",
            url: "https://invented.example/bad",
          },
          { index: 1, isComplaint: false },
        ],
      },
      batch,
    );
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe("https://example.com/complaint");
    expect(items[0].summary).toBe("Large imports fail.");
    expect(items[0].quote.split(/\s+/)).toHaveLength(20);
    expect(items[0].author).toBe("alice");
  });

  it("falls back to the result snippet when no quote is returned", () => {
    const items = parseExtraction(
      {
        items: [
          {
            index: 0,
            isComplaint: true,
            category: "not-a-category",
            money: "not-a-signal",
            summary: "Imports fail.",
          },
        ],
      },
      batch,
    );
    expect(items[0].category).toBe("other");
    expect(items[0].money).toBe("none");
    expect(items[0].quote.length).toBeGreaterThan(0);
  });
});
