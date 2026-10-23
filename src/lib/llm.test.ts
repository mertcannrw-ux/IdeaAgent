import { describe, expect, it } from "vitest";
import { createLlmClient } from "./llm";
import type { HttpClient } from "./http";

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("model discovery", () => {
  it("lists Anthropic models across pages without duplicates", async () => {
    const calls: string[] = [];
    const http: HttpClient = async (url) => {
      calls.push(url);
      if (url.includes("after_id=")) {
        return response({
          data: [{ id: "claude-a" }, { id: "claude-c" }],
          has_more: false,
          last_id: "claude-c",
        });
      }
      return response({
        data: [{ id: "claude-b" }, { id: "claude-a" }],
        has_more: true,
        last_id: "claude-a",
      });
    };
    const client = createLlmClient({
      provider: "anthropic",
      apiKey: "test-key",
      http,
    });
    await expect(client.listModels()).resolves.toEqual([
      "claude-b",
      "claude-a",
      "claude-c",
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("/v1/models");
  });

  it("lists and sorts OpenAI-compatible models", async () => {
    let seenUrl = "";
    let seenAuth = "";
    const http: HttpClient = async (url, init) => {
      seenUrl = url;
      const headers = init?.headers as Record<string, string>;
      seenAuth = headers.authorization;
      return response({ data: [{ id: "zeta" }, { id: "alpha" }] });
    };
    const client = createLlmClient({
      provider: "openai",
      apiKey: "local",
      baseUrl: "https://models.example/v1/",
      http,
    });
    await expect(client.listModels()).resolves.toEqual(["alpha", "zeta"]);
    expect(seenUrl).toBe("https://models.example/v1/models");
    expect(seenAuth).toBe("Bearer local");
  });

  it("sends an OpenCode session ID and client user agent with chat requests", async () => {
    let headers: Record<string, string> = {};
    const http: HttpClient = async (_url, init) => {
      headers = init?.headers as Record<string, string>;
      return response({
        choices: [{ message: { content: "OK" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    };
    const client = createLlmClient({
      provider: "openai",
      apiKey: "local",
      baseUrl: "https://opencode.ai/inference/go/v1",
      sessionId: "session-1",
      http,
    });
    await client.complete({
      system: "System",
      input: "Input",
      model: "deepseek-v4.1-flash",
      maxTokens: 16,
    });
    expect(headers["x-opencode-session"]).toBe("session-1");
    expect(headers["user-agent"]).toBe("Radar/0.1.0");
  });

  it("surfaces the provider's error message without URLs", async () => {
    const http: HttpClient = async () =>
      new Response(
        JSON.stringify({
          type: "error",
          error: {
            type: "MissingSessionID",
            message:
              "Request is missing x-opencode-session and cannot be routed efficiently. Please see https://opencode.ai/docs/go/",
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    const client = createLlmClient({
      provider: "openai",
      apiKey: "local",
      baseUrl: "https://opencode.ai/inference/go/v1",
      http,
    });
    await expect(
      client.complete({
        system: "System",
        input: "Input",
        model: "deepseek-v4.1-flash",
        maxTokens: 16,
      }),
    ).rejects.toThrow(/missing x-opencode-session/);
  });

  it("retries once with a larger output budget when the model returns no content", async () => {
    const budgets: number[] = [];
    const http: HttpClient = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { max_tokens: number };
      budgets.push(body.max_tokens);
      if (budgets.length === 1) {
        return response({
          choices: [{ message: { content: "" }, finish_reason: "length" }],
          usage: { prompt_tokens: 10, completion_tokens: 32 },
        });
      }
      return response({
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      });
    };
    const client = createLlmClient({
      provider: "openai",
      apiKey: "local",
      baseUrl: "https://models.example/v1",
      http,
    });
    await expect(
      client.complete({
        system: "System",
        input: "Input",
        model: "model-a",
        maxTokens: 32,
      }),
    ).resolves.toMatchObject({ text: "OK" });
    expect(budgets).toEqual([32, 64]);
  });

  it("requests JSON mode and retries without it when the endpoint rejects it", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const http: HttpClient = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if (bodies.length === 1) {
        return new Response(
          JSON.stringify({ error: { message: "response_format is not supported" } }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      return response({
        choices: [{ message: { content: "{\"ok\":true}" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    };
    const client = createLlmClient({
      provider: "openai",
      apiKey: "local",
      baseUrl: "https://models.example/v1",
      http,
    });
    const result = await client.complete({
      system: "System",
      input: "Input",
      model: "model-a",
      maxTokens: 32,
      json: true,
    });
    expect(result.text).toBe('{"ok":true}');
    expect(bodies).toHaveLength(2);
    expect(bodies[0].response_format).toEqual({ type: "json_object" });
    expect(bodies[1].response_format).toBeUndefined();
  });

  it("keeps model versions intact in provider errors", async () => {
    const http: HttpClient = async () =>
      new Response(
        JSON.stringify({
          error: { message: "Model deepseek-v4.1-flash is unavailable. Try another." },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    const client = createLlmClient({
      provider: "openai",
      apiKey: "local",
      baseUrl: "https://opencode.ai/inference/go/v1",
      http,
    });
    await expect(
      client.complete({
        system: "System",
        input: "Input",
        model: "deepseek-v4.1-flash",
        maxTokens: 16,
      }),
    ).rejects.toThrow(/deepseek-v4\.1-flash is unavailable\./);
  });

  it("fails clearly when the endpoint returns no models", async () => {
    const http: HttpClient = async () => response({ data: [] });
    const client = createLlmClient({
      provider: "openai",
      apiKey: "local",
      baseUrl: "http://localhost:11434/v1",
      http,
    });
    await expect(client.listModels()).rejects.toThrow(/no models/);
  });
});
