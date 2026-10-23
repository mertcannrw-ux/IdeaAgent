import { describe, expect, it } from "vitest";
import { mergeThemes, parseThemeClusters, themeKey } from "./themes";
import type { ExtractedItem, PreviousTheme } from "./types";

function item(overrides: Partial<ExtractedItem>): ExtractedItem {
  return {
    url: "https://example.com/1",
    title: "One",
    competitor: "Acme",
    category: "reliability",
    money: "weak",
    summary: "It crashes.",
    quote: "It crashes.",
    author: "alice",
    publishedAt: "2026-10-01T00:00:00Z",
    source: "Exa",
    ...overrides,
  };
}

const previous: PreviousTheme[] = [
  {
    id: 7,
    key: "silent-import-failures",
    name: "Silent import failures",
    summary: "Imports fail.",
    category: "reliability",
    runCount: 2,
    lastScore: 20,
  },
];

describe("parseThemeClusters", () => {
  it("assigns every complaint to exactly one theme", () => {
    const items = [
      item({ url: "https://example.com/1" }),
      item({ url: "https://example.com/2" }),
      item({ url: "https://example.com/3", category: "pricing" }),
    ];
    const clusters = parseThemeClusters(
      {
        themes: [
          {
            existingId: 7,
            name: "Silent import failures",
            summary: "Imports fail.",
            category: "reliability",
            items: [0, 1],
          },
        ],
      },
      items,
    );
    expect(clusters[0].itemIndexes).toEqual([0, 1]);
    expect(clusters[1].name).toContain("Pricing");
    expect(clusters[1].itemIndexes).toEqual([2]);
  });

  it("throws when the model returns no themes and there is nothing to fall back to", () => {
    expect(() => parseThemeClusters({ themes: [] }, [])).toThrow(/no themes/);
  });
});

describe("mergeThemes", () => {
  it("merges an existing theme and keeps its run history", () => {
    const items = [item({ url: "https://example.com/1" }), item({ url: "https://example.com/2" })];
    const clusters = parseThemeClusters(
      {
        themes: [
          {
            existingId: 7,
            name: "Silent import failures",
            summary: "Imports fail silently.",
            category: "reliability",
            items: [0, 1],
          },
        ],
      },
      items,
    );
    const merged = mergeThemes(previous, clusters, items);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 7,
      key: "silent-import-failures",
      name: "Silent import failures",
      summary: "Imports fail silently.",
      runCount: 3,
      lastScore: 20,
      itemCount: 2,
    });
    expect(merged[0].sources).toHaveLength(2);
    expect(merged[0].sources[0].author).toBe("alice");
  });

  it("merges a new cluster into an existing theme with the same name", () => {
    const items = [item({ url: "https://example.com/1" })];
    const clusters = parseThemeClusters(
      {
        themes: [
          {
            existingId: null,
            name: "Silent import failures",
            summary: "Still happening.",
            category: "reliability",
            items: [0],
          },
        ],
      },
      items,
    );
    const merged = mergeThemes(previous, clusters, items);
    expect(merged[0].id).toBe(7);
    expect(merged[0].runCount).toBe(3);
  });

  it("deduplicates source URLs across clusters that map to the same theme", () => {
    const items = [item({ url: "https://example.com/1" }), item({ url: "https://example.com/1" })];
    const clusters = [
      {
        existingId: 7,
        name: "Silent import failures",
        summary: "A",
        category: "reliability" as const,
        itemIndexes: [0],
      },
      {
        existingId: 7,
        name: "Silent import failures",
        summary: "B",
        category: "reliability" as const,
        itemIndexes: [1],
      },
    ];
    const merged = mergeThemes(previous, clusters, items);
    expect(merged).toHaveLength(1);
    expect(merged[0].sources).toHaveLength(1);
  });
});

describe("themeKey", () => {
  it("normalises names for matching", () => {
    expect(themeKey("Silent import failures")).toBe("silent-import-failures");
    expect(themeKey("Crashes & retries!")).toBe("crashes-retries");
  });
});
