import {
  apiError,
  fetchWithTimeout,
  networkError,
  type HttpClient,
} from "./http";
import { SEARCH_COST_USD } from "./cost";
import { limitChars, stripHtml } from "./text";
import type { Competitor, SearchResult } from "./types";

export interface SearchOptions {
  since: Date;
  competitor: string;
}

export interface SearchProvider {
  readonly id: "exa" | "brave" | "hn";
  readonly name: string;
  readonly costPerQuery: number;
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
  test?(): Promise<void>;
}

export const COMPLAINT_PHRASES = [
  "crashing",
  "too expensive",
  '"doesn\'t work"',
  '"missing feature"',
  '"switching to"',
  "alternative",
];

export interface QueryPlanItem {
  query: string;
  competitor: string;
  providerId: SearchProvider["id"];
}

export function buildQueryPlan(
  competitors: Competitor[],
  providerIds: Array<SearchProvider["id"]>,
  maxQueries: number,
): QueryPlanItem[] {
  const plan: QueryPlanItem[] = [];
  const active = competitors.filter((competitor) => competitor.enabled && competitor.name.trim());
  for (const phrase of COMPLAINT_PHRASES) {
    for (const competitor of active) {
      const name = competitor.name.trim().replace(/"/g, "");
      if (!name) continue;
      for (const providerId of providerIds) {
        if (plan.length >= maxQueries) return plan;
        plan.push({
          query: `"${name}" ${phrase}`,
          competitor: competitor.name.trim(),
          providerId,
        });
      }
    }
  }
  return plan;
}

export class ExaSearchProvider implements SearchProvider {
  readonly id = "exa" as const;
  readonly name = "Exa";
  readonly costPerQuery = SEARCH_COST_USD.exa;

  constructor(
    private readonly apiKey: string,
    private readonly http: HttpClient,
  ) {}

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const response = await this.post({
      query,
      type: "auto",
      numResults: 8,
      startPublishedDate: options.since.toISOString(),
      contents: { text: { maxCharacters: 900 } },
    });
    const data = (await response.json().catch(() => null)) as ExaResponse | null;
    if (!data || !Array.isArray(data.results)) {
      throw new Error("Exa returned an unreadable response; try again.");
    }
    return data.results.flatMap((result) => {
      if (!result.url) return [];
      return [
        {
          url: result.url,
          title: limitChars(result.title?.trim() || result.url, 200),
          snippet: limitChars(stripHtml(result.text ?? ""), 900),
          publishedAt: isoOrNull(result.publishedDate),
          author: result.author?.trim() || null,
          competitor: options.competitor,
          source: "Exa",
          query,
        },
      ];
    });
  }

  async test(): Promise<void> {
    await this.post({
      query: "test",
      type: "auto",
      numResults: 1,
      contents: { text: { maxCharacters: 100 } },
    });
  }

  private async post(body: unknown): Promise<Response> {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        this.http,
        "https://api.exa.ai/search",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.apiKey,
          },
          body: JSON.stringify(body),
        },
        30_000,
      );
    } catch (error) {
      throw networkError("Exa", error);
    }
    if (!response.ok) throw apiError("Exa", response.status);
    return response;
  }
}

export class BraveSearchProvider implements SearchProvider {
  readonly id = "brave" as const;
  readonly name = "Brave";
  readonly costPerQuery = SEARCH_COST_USD.brave;

  constructor(
    private readonly apiKey: string,
    private readonly http: HttpClient,
  ) {}

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const response = await this.get(query, options.since);
    const data = (await response.json().catch(() => null)) as BraveResponse | null;
    const results = data?.web?.results;
    if (!Array.isArray(results)) {
      throw new Error("Brave returned an unreadable response; try again.");
    }
    return results.flatMap((result) => {
      if (!result.url) return [];
      return [
        {
          url: result.url,
          title: limitChars(stripHtml(result.title ?? "") || result.url, 200),
          snippet: limitChars(stripHtml(result.description ?? ""), 900),
          publishedAt: isoOrNull(result.page_age) ?? isoOrNull(result.age),
          author: null,
          competitor: options.competitor,
          source: "Brave",
          query,
        },
      ];
    });
  }

  async test(): Promise<void> {
    await this.get("test", new Date(Date.now() - 7 * 86_400_000));
  }

  private async get(query: string, since: Date): Promise<Response> {
    const from = since.toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const params = new URLSearchParams({
      q: query,
      count: "8",
      freshness: `${from}to${to}`,
      text_decorations: "0",
    });
    let response: Response;
    try {
      response = await fetchWithTimeout(
        this.http,
        `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
        {
          method: "GET",
          headers: {
            accept: "application/json",
            "x-subscription-token": this.apiKey,
          },
        },
        30_000,
      );
    } catch (error) {
      throw networkError("Brave", error);
    }
    if (!response.ok) throw apiError("Brave", response.status);
    return response;
  }
}

export class HackerNewsSearchProvider implements SearchProvider {
  readonly id = "hn" as const;
  readonly name = "Hacker News";
  readonly costPerQuery = SEARCH_COST_USD.hn;

  constructor(private readonly http: HttpClient) {}

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const sinceSeconds = Math.floor(options.since.getTime() / 1000);
    const params = new URLSearchParams({
      query,
      tags: "comment",
      hitsPerPage: "8",
      numericFilters: `created_at_i>${sinceSeconds}`,
    });
    let response: Response;
    try {
      response = await fetchWithTimeout(
        this.http,
        `https://hn.algolia.com/api/v1/search_by_date?${params.toString()}`,
        { method: "GET", headers: { accept: "application/json" } },
        30_000,
      );
    } catch (error) {
      throw networkError("Hacker News", error);
    }
    if (!response.ok) throw apiError("Hacker News", response.status);
    const data = (await response.json().catch(() => null)) as HnResponse | null;
    if (!data || !Array.isArray(data.hits)) {
      throw new Error("Hacker News returned an unreadable response; try again.");
    }
    return data.hits.flatMap((hit) => {
      if (!hit.objectID || !hit.comment_text) return [];
      return [
        {
          url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
          title: limitChars(stripHtml(hit.story_title ?? "") || "Hacker News comment", 200),
          snippet: limitChars(stripHtml(hit.comment_text), 900),
          publishedAt: isoOrNull(hit.created_at),
          author: hit.author?.trim() || null,
          competitor: options.competitor,
          source: "Hacker News",
          query,
        },
      ];
    });
  }
}

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time.toISOString();
}

interface ExaResponse {
  results?: Array<{
    title?: string;
    url?: string;
    publishedDate?: string;
    author?: string;
    text?: string;
  }>;
}

interface BraveResponse {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
      page_age?: string;
      age?: string;
    }>;
  };
}

interface HnResponse {
  hits?: Array<{
    objectID?: string;
    comment_text?: string;
    story_title?: string;
    author?: string;
    created_at?: string;
  }>;
}
