import { describe, expect, it } from "vitest";
import { digestRelativePath, renderDigest, selectDigestThemes } from "./digest";
import type { Theme } from "./types";

function theme(index: number, overrides: Partial<Theme> = {}): Theme {
  return {
    id: index,
    key: `theme-${index}`,
    name: `Theme ${index}`,
    summary: "Users cannot finish the import.",
    category: "reliability",
    competitor: "Acme",
    bucket: "new",
    sources: [
      {
        url: `https://example.com/${index}`,
        title: `Source ${index}`,
        publishedAt: "2026-10-01T00:00:00Z",
        author: "alice",
      },
    ],
    runCount: 2,
    lastScore: 4,
    trend: "seen",
    score: 100 - index,
    frequency: 2,
    pain: 4,
    money: 3,
    fit: 4,
    effort: 2,
    itemCount: 2,
    ...overrides,
  };
}

describe("selectDigestThemes", () => {
  it("drops ignored and sourceless themes and caps at ten", () => {
    const themes = Array.from({ length: 12 }, (_, index) => theme(index));
    themes.push(theme(99, { bucket: "ignore" }));
    themes.push(theme(100, { sources: [] }));
    expect(selectDigestThemes(themes)).toHaveLength(10);
    expect(selectDigestThemes(themes)[0].name).toBe("Theme 0");
    expect(selectDigestThemes(themes).some((item) => item.name === "Theme 99")).toBe(false);
  });
});

describe("renderDigest", () => {
  it("writes frontmatter, sorted items, trend, bucket and source links", () => {
    const markdown = renderDigest({
      date: "2026-10-22",
      repo: "acme/radar",
      lookbackLabel: "7d",
      costUsd: 0.1234,
      summary: "Reliability complaints dominate the week.",
      themes: [
        theme(1, { trend: "rising", bucket: "planned" }),
        theme(2, {
          bucket: "have it",
          name: "Already covered",
          sources: [
            {
              url: "https://example.com/a",
              title: "A",
              publishedAt: null,
              author: null,
            },
            {
              url: "https://example.com/b",
              title: "B",
              publishedAt: null,
              author: null,
            },
          ],
        }),
      ],
    });
    expect(markdown).toContain("---\ndate: 2026-10-22\nrepo: acme/radar\nlookback: 7d\nitems: 2\ncost: 0.1234\n---");
    expect(markdown).toContain("Reliability complaints dominate the week.");
    expect(markdown).toContain("## Opportunities");
    expect(markdown).toContain("## Marketing ammo");
    expect(markdown).toContain("Users cannot finish the import.\n\n**Score");
    expect(markdown).toContain("trend rising · bucket planned");
    expect(markdown).toContain("trend seen in 2 runs");
    expect(markdown).toContain("[Source 1](https://example.com/1)");
    const opportunities = markdown.indexOf("## Opportunities");
    const ammo = markdown.indexOf("## Marketing ammo");
    expect(opportunities).toBeLessThan(ammo);
  });

  it("escapes parentheses in source URLs", () => {
    const markdown = renderDigest({
      date: "2026-10-22",
      repo: "acme/radar",
      lookbackLabel: "7d",
      costUsd: 0.01,
      summary: "Summary.",
      themes: [
        theme(1, {
          sources: [
            {
              url: "https://example.com/a(b)",
              title: "Parens",
              publishedAt: null,
              author: null,
            },
          ],
        }),
      ],
    });
    expect(markdown).toContain("[Parens](https://example.com/a%28b%29)");
  });

  it("falls back to a factual summary when the model gives none", () => {
    const markdown = renderDigest({
      date: "2026-10-22",
      repo: "acme/radar",
      lookbackLabel: "7d",
      costUsd: 0.01,
      summary: "",
      themes: [theme(1)],
    });
    expect(markdown).toContain("1 theme across 1 competitor stood out in this run.");
  });

  it("refuses to write an empty digest", () => {
    expect(() =>
      renderDigest({
        date: "2026-10-22",
        repo: "acme/radar",
        lookbackLabel: "7d",
        costUsd: 0.01,
        summary: "",
        themes: [theme(1, { bucket: "ignore" })],
      }),
    ).toThrow(/No actionable/);
  });
});

describe("digestRelativePath", () => {
  it("adds suffixes for additional runs on the same day", () => {
    expect(digestRelativePath("2026-10-22", [])).toBe("Radar/2026-10-22.md");
    expect(digestRelativePath("2026-10-22", ["Radar/2026-10-22.md"])).toBe(
      "Radar/2026-10-22-2.md",
    );
    expect(
      digestRelativePath("2026-10-22", ["Radar/2026-10-22.md", "Radar/2026-10-22-2.md"]),
    ).toBe("Radar/2026-10-22-3.md");
  });
});
