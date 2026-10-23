import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { HttpClient } from "../lib/http";

export const http: HttpClient = (input, init) =>
  tauriFetch(input, {
    connectTimeout: 20_000,
    ...(init ?? {}),
  });

export function baseUrlOrigin(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function allowHttpOrigin(baseUrl: string): Promise<void> {
  const origin = baseUrlOrigin(baseUrl);
  if (!origin) {
    throw new Error("Enter a valid base URL for the OpenAI-compatible provider in Settings.");
  }
  try {
    await invoke("allow_http_origin", { origin });
  } catch (error) {
    throw new Error(
      typeof error === "string"
        ? error
        : "Radar could not allow that endpoint; use an HTTPS base URL or a localhost address.",
    );
  }
}
