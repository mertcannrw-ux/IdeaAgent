import { parseModelJson, type LlmClient } from "./llm";
import { collapseWhitespace, limitChars } from "./text";
import type { Competitor, GeneratedAnalysis } from "./types";

export async function analyzeRepository(
  llm: LlmClient,
  prompt: string,
  corpus: string,
  model: string,
): Promise<GeneratedAnalysis> {
  const response = await llm.complete({
    system: prompt,
    input: `${corpus}\n\nEnd of repository snapshot. Return the JSON object now.`,
    model,
    temperature: 0.1,
    json: true,
  });
  let parsed: unknown;
  try {
    parsed = parseModelJson(response.text);
  } catch {
    throw new Error("The repo analysis model returned malformed JSON; run Re-analyze.");
  }
  return parseGeneratedAnalysis(parsed);
}

export function parseGeneratedAnalysis(value: unknown): GeneratedAnalysis {
  const data = value as {
    product?: unknown;
    competitors?: unknown;
  } | null;
  if (!data || typeof data !== "object" || data.product == null) {
    throw new Error("The model returned an incomplete analysis; run Re-analyze or reset the prompt files.");
  }

  let productContext = "";
  if (typeof data.product === "string") {
    productContext = limitChars(data.product.trim(), 12_000);
  } else if (typeof data.product === "object") {
    const product = data.product as {
      what?: unknown;
      users?: unknown;
      features?: unknown;
      planned?: unknown;
    };
    const what =
      typeof product.what === "string" ? limitChars(collapseWhitespace(product.what), 2_000) : "";
    const users =
      typeof product.users === "string" ? limitChars(collapseWhitespace(product.users), 1_000) : "";
    const features = stringList(product.features);
    const planned = stringList(product.planned);
    productContext = [
      `What it is: ${what || "(not found in the repository)"}`,
      `Target users: ${users || "(not found in the repository)"}`,
      "Current features:",
      ...(features.length ? features.map((item) => `- ${item}`) : ["- None found in the repository."]),
      "Planned work:",
      ...(planned.length ? planned.map((item) => `- ${item}`) : ["- None found in the repository."]),
    ].join("\n");
  }

  if (!productContext) {
    throw new Error("The model returned an incomplete analysis; run Re-analyze or reset the prompt files.");
  }

  const competitors: Competitor[] = [];
  const seen = new Set<string>();
  if (Array.isArray(data.competitors)) {
    for (const raw of data.competitors) {
      if (!raw || typeof raw !== "object") continue;
      const entry = raw as { name?: unknown; aliases?: unknown; reason?: unknown };
      const name =
        typeof entry.name === "string"
          ? limitChars(collapseWhitespace(entry.name), 120)
          : "";
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const aliases = stringList(entry.aliases)
        .map((alias) => limitChars(alias, 80))
        .filter((alias) => alias.toLowerCase() !== name.toLowerCase());
      competitors.push({
        name,
        aliases,
        reason:
          typeof entry.reason === "string"
            ? limitChars(collapseWhitespace(entry.reason), 300)
            : "",
        enabled: true,
      });
      if (competitors.length >= 6) break;
    }
  }

  return { productContext, competitors };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => limitChars(collapseWhitespace(item), 240))
    .filter(Boolean)
    .slice(0, 30);
}
