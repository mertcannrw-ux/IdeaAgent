import { stripFrontmatter } from "./text";

export function renderMarkdown(markdown: string): string {
  const lines = stripFrontmatter(markdown).split(/\r?\n/);
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length === 0) return;
    html.push(`<ul>${list.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
    list = [];
  };
  const flush = () => {
    flushParagraph();
    flushList();
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }
    if (trimmed === "---" || trimmed === "***") {
      flush();
      html.push("<hr />");
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      flush();
      html.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }
  flush();
  return html.join("");
}

function renderInline(text: string): string {
  const token =
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;
  let output = "";
  let lastIndex = 0;
  for (const match of text.matchAll(token)) {
    const index = match.index ?? 0;
    output += escapeHtml(text.slice(lastIndex, index));
    if (match[1] !== undefined && match[2] !== undefined) {
      const href = safeHref(match[2]);
      const label = escapeHtml(match[1]);
      output += href
        ? `<a href="${escapeHtml(href)}" rel="noreferrer">${label}</a>`
        : label;
    } else if (match[3] !== undefined) {
      output += `<strong>${escapeHtml(match[3])}</strong>`;
    } else if (match[4] !== undefined) {
      output += `<code>${escapeHtml(match[4])}</code>`;
    }
    lastIndex = index + match[0].length;
  }
  output += escapeHtml(text.slice(lastIndex));
  return output;
}

function safeHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
