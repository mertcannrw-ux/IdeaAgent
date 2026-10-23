import { describe, expect, it } from "vitest";
import {
  computeScore,
  distinctVoices,
  frequencyScore,
  parseThemeScores,
  scoreTheme,
  trendFor,
} from "./scoring";
import type { SourceRef, ThemeCandidate } from "./types";

function source(overrides: Partial<SourceRef>): SourceRef {
  return {
    url: "https://example.com/1",
    title: "Source",
    publishedAt: null,
    author: null,
    ...overrides,
  };
}

function candidate(overrides: Partial<ThemeCandidate> = {}): ThemeCandidate {
  return {
    id: 1,
    key: "crashes",
    name: "Crashes",
    summary: "It crashes.",
    category: "reliability",
    competitor: "Acme",
    sources: [source({ author: "a" }), source({ url: "https://example.com/2", author: "b" })],
    runCount: 1,
    lastScore: null,
    itemCount: 2,
    ...overrides,
  };
}

describe("frequency", () => {
  it("counts distinct authors, falling back to distinct URLs", () => {
    expect(
      distinctVoices([
        source({ author: "Alice" }),
        source({ url: "https://example.com/2", author: "alice" }),
        source({ url: "https://example.com/3" }),
        source({ url: "https://example.com/4" }),
      ]),
    ).toBe(3);
    expect(frequencyScore(1)).toBe(1);
    expect(frequencyScore(2)).toBe(2);
    expect(frequencyScore(3)).toBe(3);
    expect(frequencyScore(4)).toBe(4);
    expect(frequencyScore(5)).toBe(5);
    expect(frequencyScore(6)).toBe(5);
  });
});

describe("computeScore", () => {
  it("uses frequency x pain x fit / effort", () => {
    expect(computeScore({ frequency: 4, pain: 5, money: 3, fit: 4, effort: 2 })).toBe(40);
  });

  it("adds a bonus for a strong money signal", () => {
    expect(computeScore({ frequency: 4, pain: 5, money: 4, fit: 4, effort: 2 })).toBe(48);
  });

  it("clamps dimensions to 1-5 and never divides by zero", () => {
    expect(computeScore({ frequency: 9, pain: 9, money: 9, fit: 9, effort: 0 })).toBe(150);
  });
});

describe("trendFor", () => {
  it("reports new, rising and seen themes", () => {
    expect(trendFor(0, null, 10)).toBe("new");
    expect(trendFor(2, 10, 12)).toBe("rising");
    expect(trendFor(3, 10, 10.5)).toBe("seen");
  });
});

describe("scoreTheme", () => {
  it("scores a theme and keeps its previous run count for the trend", () => {
    const theme = scoreTheme(candidate({ runCount: 2, lastScore: 10 }), {
      pain: 5,
      money: 3,
      fit: 4,
      effort: 2,
      bucket: "planned",
    });
    expect(theme.score).toBe(20);
    expect(theme.frequency).toBe(2);
    expect(theme.trend).toBe("rising");
    expect(theme.bucket).toBe("planned");
  });
});

describe("parseThemeScores", () => {
  it("validates scores and fills missing themes conservatively", () => {
    const scores = parseThemeScores(
      {
        themes: [
          { index: 0, pain: 9, money: 4, fit: 0, effort: 2.4, bucket: "have it" },
          { index: 3, pain: 5, money: 5, fit: 5, effort: 1, bucket: "ignore" },
        ],
      },
      2,
    );
    expect(scores[0]).toEqual({ pain: 5, money: 4, fit: 1, effort: 2, bucket: "have it" });
    expect(scores[1]).toEqual({ pain: 3, money: 2, fit: 3, effort: 3, bucket: "new" });
  });

  it("rejects malformed output", () => {
    expect(() => parseThemeScores({}, 2)).toThrow(/malformed/);
  });
});
