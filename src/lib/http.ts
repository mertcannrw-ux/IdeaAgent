export type HttpClient = (input: string, init?: RequestInit) => Promise<Response>;

export class TransportError extends Error {
  constructor(readonly kind: "network" | "timeout") {
    super(kind === "timeout" ? "The request timed out." : "The request could not be completed.");
    this.name = "TransportError";
  }
}

export async function fetchWithTimeout(
  client: HttpClient,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await client(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new TransportError("timeout");
    throw new TransportError("network");
  } finally {
    clearTimeout(timer);
  }
}


export function apiError(service: string, status: number, body = ""): Error {
  if (status === 401 || status === 403) {
    return new Error(`${service} rejected the key; check it in Settings.`);
  }
  if (status === 404) {
    return new Error(
      `${service} did not find the endpoint or model; check the model and base URL in Settings.`,
    );
  }
  if (status === 429) {
    return new Error(`${service} is rate limiting requests; wait a minute and try again.`);
  }
  if (status >= 500) {
    return new Error(`${service} is unavailable; try again in a few minutes.`);
  }
  if (status === 400 || status === 422) {
    const detail = providerErrorDetail(body);
    if (detail) return new Error(`${service} rejected the request: ${detail}`);
    return new Error(`${service} rejected the request; check the model and endpoint settings.`);
  }
  return new Error(`${service} returned an error (${status}); check the provider settings.`);
}

function providerErrorDetail(body: string): string {
  if (!body) return "";
  let message = "";
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    if (typeof parsed?.error?.message === "string") {
      message = parsed.error.message;
    } else if (typeof parsed?.message === "string") {
      message = parsed.message;
    }
  } catch {
    return "";
  }
  message = message
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\b(?:sk|key|ghp|gho|ghs|ghu)_[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .trim();
  if (!message) return "";
  const sentence = message.split(/(?<=[.!?])\s+/)[0]?.trim() || message;
  return sentence.length > 220 ? `${sentence.slice(0, 217)}...` : sentence;
}

export function networkError(service: string, error: unknown): Error {
  if (error instanceof TransportError && error.kind === "timeout") {
    return new Error(`${service} took too long to respond; try again.`);
  }
  return new Error(`Could not reach ${service}; check your connection and try again.`);
}

export function parseJsonLoose(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const objectStart = cleaned.indexOf("{");
    const arrayStart = cleaned.indexOf("[");
    const start =
      objectStart === -1
        ? arrayStart
        : arrayStart === -1
          ? objectStart
          : Math.min(objectStart, arrayStart);
    if (start === -1) return null;
    const opening = cleaned[start];
    const closing = opening === "{" ? "}" : "]";
    const end = cleaned.lastIndexOf(closing);
    if (end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
