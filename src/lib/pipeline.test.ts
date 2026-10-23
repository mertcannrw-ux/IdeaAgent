import { describe, expect, it } from "vitest";
import type { LlmClient, LlmRequest, LlmResponse } from "./llm";
import type { SearchProvider } from "./search";
import { runPipeline } from "./pipeline";
import { DEFAULT_PROMPTS } from "./prompts";
import type { Competitor, SearchResult } from "./types";

const competitor: Competitor = {
  name: "Acme",
  aliases: [],
  reason: "Direct competitor",
  enabled: true,
};

function fakeSearch(
  id: "exa" | "hn",
  results: SearchResult[],
): SearchProvider & { queries: number } {
  return {
    id,
    name: id === "exa" ? "Exa" : "Hacker News",
    costPerQuery: 0,
    queries: 0,
    async search() {
      this.queries += 1;
      return results;
    },
  };
}

function jsonResponse(value: unknown): LlmResponse {
  return { text: JSON.stringify(value), usage: { inputTokens: 100, outputTokens: 50 } };
}

function fakeLlm(): LlmClient & { calls: string[] } {
  return {
    provider: "anthropic",
    calls: [],
    async complete(request: LlmRequest): Promise<LlmResponse> {
      if (request.system === DEFAULT_PROMPTS.extract) {
        this.calls.push("extract");
        return jsonResponse({
          items: [
            {
              index: 0,
              isComplaint: true,
              category: "reliability",
              money: "weak",
              summary: "Large imports fail silently.",
              quote: "The importer dies on large files.",
            },
            { index: 1, isComplaint: false },
          ],
        });
      }
      if (request.system === DEFAULT_PROMPTS.cluster) {
        this.calls.push("cluster");
        return jsonResponse({
          themes: [
            {
              existingId: null,
              name: "Silent import failures",
              summary: "Imports fail without an error.",
              category: "reliability",
              items: [0],
            },
          ],
        });
      }
      if (request.system === DEFAULT_PROMPTS.score) {
        this.calls.push("score");
        return jsonResponse({
          themes: [
            { index: 0, pain: 4, money: 3, fit: 4, effort: 2, bucket: "planned" },
          ],
        });
      }
      if (request.system === DEFAULT_PROMPTS.summary) {
        this.calls.push("summary");
        return jsonResponse({ summary: "Import failures dominate the week." });
      }
      throw new Error("unexpected prompt");
    },
    async listModels() {
      return ["cheap", "smart"];
    },
  };
}

const searchResult = (url: string, title: string): SearchResult => ({
  url,
  title,
  snippet: "The importer dies on large files and support is silent.",
  publishedAt: "2026-10-20T00:00:00Z",
  author: "alice",
  competitor: "Acme",
  source: "Exa",
  query: "Acme crashing",
});

describe("runPipeline", () => {
  it("searches, extracts, clusters, scores and renders a digest", async () => {
    const statuses: string[] = [];
    const llm = fakeLlm();
    const result = await runPipeline({
      repoSlug: "acme/radar",
      productContext: "Jobs observability.",
      roadmap: "SAML support.",
      competitors: [competitor],
      prompts: DEFAULT_PROMPTS,
      llm,
      cheapModel: "cheap",
      smartModel: "smart",
      searchProviders: [
        fakeSearch("exa", [
          searchResult("https://example.com/seen", "Seen"),
          searchResult("https://example.com/new", "New complaint"),
        ]),
        fakeSearch("hn", []),
      ],
      limits: { maxQueries: 4, maxLlmCalls: 10, maxSpendUsd: 1 },
      lookbackDays: 7,
      lookbackLabel: "7d",
      previousThemes: [],
      seenUrls: ["https://example.com/seen"],
      existingDigestFiles: [],
      now: new Date("2026-10-22T12:00:00Z"),
      onStatus: (line) => statuses.push(line),
    });
    expect(result.itemCount).toBe(1);
    expect(result.digestRel).toBe("Radar/2026-10-22.md");
    expect(result.markdown).toContain("https://example.com/new");
    expect(result.markdown).not.toContain("https://example.com/seen");
    expect(result.markdown).toContain("## Opportunities");
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.processedUrls).toEqual(["https://example.com/new"]);
    expect(llm.calls).toEqual(["extract", "cluster", "score", "summary"]);
    expect(statuses.some((line) => line.includes("Searching"))).toBe(true);
  });

  it("runs with Hacker News as the only provider", async () => {
    const result = await runPipeline({
      repoSlug: "acme/radar",
      productContext: "Jobs observability.",
      roadmap: "",
      competitors: [competitor],
      prompts: DEFAULT_PROMPTS,
      llm: fakeLlm(),
      cheapModel: "cheap",
      smartModel: "smart",
      searchProviders: [
        fakeSearch("hn", [
          {
            ...searchResult("https://news.ycombinator.com/item?id=1", "HN complaint"),
            source: "Hacker News",
          },
        ]),
      ],
      limits: { maxQueries: 4, maxLlmCalls: 10, maxSpendUsd: 1 },
      lookbackDays: 7,
      lookbackLabel: "7d",
      previousThemes: [],
      seenUrls: [],
      existingDigestFiles: [],
      now: new Date("2026-10-22T12:00:00Z"),
      onStatus: () => undefined,
    });
    expect(result.markdown).toContain("https://news.ycombinator.com/item?id=1");
    expect(result.itemCount).toBe(1);
  });

  it("stops at the LLM call limit", async () => {
    await expect(
      runPipeline({
        repoSlug: "acme/radar",
        productContext: "Jobs observability.",
        roadmap: "",
        competitors: [competitor],
        prompts: DEFAULT_PROMPTS,
        llm: fakeLlm(),
        cheapModel: "cheap",
        smartModel: "smart",
        searchProviders: [
          fakeSearch("exa", [searchResult("https://example.com/new", "New")]),
          fakeSearch("hn", []),
        ],
        limits: { maxQueries: 4, maxLlmCalls: 1, maxSpendUsd: 1 },
        lookbackDays: 7,
        lookbackLabel: "7d",
        previousThemes: [],
        seenUrls: [],
        existingDigestFiles: [],
        now: new Date("2026-10-22T12:00:00Z"),
        onStatus: () => undefined,
      }),
    ).rejects.toThrow(/1-call limit/);
  });
});
