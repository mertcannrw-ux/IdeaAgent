export function limitChars(text: string, max: number): string {
  if (text.length <= max) return text;
  const suffix = "\n[truncated]";
  if (max <= suffix.length) return text.slice(0, Math.max(0, max));
  const budget = Math.max(0, max - suffix.length);
  const sliced = text.slice(0, budget);
  const boundary = Math.max(sliced.lastIndexOf("\n"), sliced.lastIndexOf(" "));
  return `${boundary > budget * 0.6 ? sliced.slice(0, boundary) : sliced}${suffix}`;
}

export function limitWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(" ");
  return words.slice(0, max).join(" ");
}

export function stripHtml(input: string): string {
  return decodeEntities(
    input
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\s*\/p\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(input: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    mdash: "—",
    ndash: "–",
    hellip: "…",
    rsquo: "'",
    lsquo: "'",
    rdquo: '"',
    ldquo: '"',
  };
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => named[name.toLowerCase()] ?? whole);
}

function safeCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

export function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---\n")) return markdown;
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return markdown;
  return markdown.slice(end + 4).replace(/^\s*\n/, "");
}

export function formatUsd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function localDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function newSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}
