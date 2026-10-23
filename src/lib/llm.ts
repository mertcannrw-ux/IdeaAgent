import { estimateTokens, type Usage } from "./cost";
import {
  apiError,
  fetchWithTimeout,
  networkError,
  parseJsonLoose,
  type HttpClient,
} from "./http";
import type { LlmProviderId } from "./types";

export interface LlmRequest {
  system: string;
  input: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
}

export interface LlmResponse {
  text: string;
  usage: Usage;
}

export interface LlmClient {
  readonly provider: LlmProviderId;
  complete(request: LlmRequest): Promise<LlmResponse>;
  listModels(): Promise<string[]>;
}

export interface LlmConfig {
  provider: LlmProviderId;
  apiKey: string;
  baseUrl?: string;
  sessionId?: string;
  http: HttpClient;
}

export function createLlmClient(config: LlmConfig): LlmClient {
  return config.provider === "anthropic"
    ? new AnthropicClient(config.apiKey, config.http)
    : new OpenAiCompatibleClient(
        config.apiKey,
        config.baseUrl ?? "",
        config.sessionId,
        config.http,
      );
}

class AnthropicClient implements LlmClient {
  readonly provider = "anthropic" as const;

  constructor(
    private readonly apiKey: string,
    private readonly http: HttpClient,
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.post(
      {
        model: request.model,
        max_tokens: request.maxTokens ?? 64_000,
        temperature: request.temperature ?? 0.2,
        system: request.system,
        messages: [{ role: "user", content: request.input }],
      },
      90_000,
    );
    const data = (await response.json().catch(() => null)) as AnthropicResponse | null;
    if (!data || !Array.isArray(data.content)) {
      throw new Error("Anthropic returned an unreadable response; try again.");
    }
    const text = data.content
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!text) throw new Error("Anthropic returned an empty response; try again.");
    return {
      text,
      usage: {
        inputTokens: data.usage?.input_tokens ?? estimateTokens(request.system + request.input),
        outputTokens: data.usage?.output_tokens ?? estimateTokens(text),
      },
    };
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = [];
    const seen = new Set<string>();
    let after: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const params = new URLSearchParams({ limit: "100" });
      if (after) params.set("after_id", after);
      let response: Response;
      try {
        response = await fetchWithTimeout(
          this.http,
          `https://api.anthropic.com/v1/models?${params.toString()}`,
          {
            method: "GET",
            headers: {
              accept: "application/json",
              "user-agent": "Radar/0.1.0",
              "x-api-key": this.apiKey,
              "anthropic-version": "2023-06-01",
            },
          },
          25_000,
        );
      } catch (error) {
        throw networkError("Anthropic", error);
      }
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        if (response.status === 404) {
          throw new Error("Anthropic did not return a models list; try again.");
        }
        throw apiError("Anthropic", response.status, body);
      }
      const data = (await response.json().catch(() => null)) as AnthropicModelsResponse | null;
      if (!data || !Array.isArray(data.data)) {
        throw new Error("Anthropic returned an unreadable models list; try again.");
      }
      for (const model of data.data) {
        if (typeof model.id !== "string" || !model.id || seen.has(model.id)) continue;
        seen.add(model.id);
        ids.push(model.id);
      }
      if (!data.has_more || typeof data.last_id !== "string" || !data.last_id) break;
      after = data.last_id;
    }
    if (ids.length === 0) {
      throw new Error("Anthropic returned no models; check the key and try again.");
    }
    return ids;
  }

  private async post(body: unknown, timeoutMs: number): Promise<Response> {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        this.http,
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "Radar/0.1.0",
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
        },
        timeoutMs,
      );
    } catch (error) {
      throw networkError("Anthropic", error);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      if (response.status === 404) {
        throw new Error("Anthropic did not find the model; check the model name in Settings.");
      }
      throw apiError("Anthropic", response.status, body);
    }
    return response;
  }
}

class OpenAiCompatibleClient implements LlmClient {
  readonly provider = "openai" as const;
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    baseUrl: string,
    private readonly sessionId: string | undefined,
    private readonly http: HttpClient,
  ) {
    this.baseUrl = baseUrl.trim().replace(/\/+$/, "");
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    return this.completeWithRetry(request, false);
  }

  private async completeWithRetry(
    request: LlmRequest,
    retried: boolean,
  ): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model: request.model,
      temperature: request.temperature ?? 0.2,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.input },
      ],
    };
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    if (request.json) body.response_format = { type: "json_object" };
    const response = await this.post(body, 90_000, Boolean(request.json));
    const data = (await response.json().catch(() => null)) as OpenAiResponse | null;
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      if (!retried) {
        return this.completeWithRetry(
          request.maxTokens === undefined
            ? request
            : { ...request, maxTokens: Math.min(8_000, request.maxTokens * 2) },
          true,
        );
      }
      throw new Error(
        "The LLM endpoint returned an empty response; try again or choose a different model.",
      );
    }
    return {
      text,
      usage: {
        inputTokens:
          data?.usage?.prompt_tokens ?? estimateTokens(request.system + request.input),
        outputTokens: data?.usage?.completion_tokens ?? estimateTokens(text),
      },
    };
  }

  async listModels(): Promise<string[]> {
    if (!this.baseUrl) {
      throw new Error("Add a base URL for the OpenAI-compatible provider in Settings.");
    }
    let response: Response;
    try {
      response = await fetchWithTimeout(
        this.http,
        `${this.baseUrl}/models`,
        {
          method: "GET",
          headers: {
            ...this.requestHeaders(),
            accept: "application/json",
          },
        },
        25_000,
      );
    } catch (error) {
      throw networkError("The LLM endpoint", error);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      if (response.status === 404) {
        throw new Error(
          "The LLM endpoint did not find /models; check the base URL in Settings.",
        );
      }
      throw apiError("The LLM endpoint", response.status, body);
    }
    const data = (await response.json().catch(() => null)) as OpenAiModelsResponse | null;
    if (!data || !Array.isArray(data.data)) {
      throw new Error("The LLM endpoint returned an unreadable models list; try again.");
    }
    const ids = [
      ...new Set(
        data.data
          .map((model) => (typeof model.id === "string" ? model.id.trim() : ""))
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b));
    if (ids.length === 0) {
      throw new Error("The LLM endpoint returned no models; check the base URL and key.");
    }
    return ids;
  }

  private async post(
    body: Record<string, unknown>,
    timeoutMs: number,
    jsonMode = false,
  ): Promise<Response> {
    if (!this.baseUrl) {
      throw new Error("Add a base URL for the OpenAI-compatible provider in Settings.");
    }
    let response: Response;
    try {
      response = await fetchWithTimeout(
        this.http,
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            ...this.requestHeaders(),
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
        timeoutMs,
      );
    } catch (error) {
      throw networkError("The LLM endpoint", error);
    }
    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      if (
        jsonMode &&
        (response.status === 400 || response.status === 422) &&
        /response_format|json[_ ]?object|json mode/i.test(errorBody)
      ) {
        const retryBody = { ...body };
        delete retryBody.response_format;
        return this.post(retryBody, timeoutMs, false);
      }
      if (response.status === 404) {
        throw new Error(
          "The LLM endpoint did not find the chat completions path; check the base URL in Settings.",
        );
      }
      throw apiError("The LLM endpoint", response.status, errorBody);
    }
    return response;
  }

  private requestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "user-agent": "Radar/0.1.0",
      authorization: `Bearer ${this.apiKey}`,
    };
    if (this.sessionId) headers["x-opencode-session"] = this.sessionId;
    return headers;
  }
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface AnthropicModelsResponse {
  data?: Array<{ id?: string }>;
  has_more?: boolean;
  last_id?: string | null;
}

interface OpenAiResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface OpenAiModelsResponse {
  data?: Array<{ id?: string }>;
}

export function parseModelJson(text: string): unknown {
  const parsed = parseJsonLoose(text);
  if (parsed === null) {
    throw new Error("The model returned malformed JSON; run again or reset the prompt files.");
  }
  return parsed;
}
