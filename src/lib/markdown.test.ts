import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders the digest subset and hides frontmatter", () => {
    const html = renderMarkdown(`---
date: 2026-10-22
---

## Opportunities

### Silent failures

Users **cannot import** files.

- [Source](https://example.com/a)
`);
    expect(html).toContain("<h2>Opportunities</h2>");
    expect(html).toContain("<h3>Silent failures</h3>");
    expect(html).toContain("<strong>cannot import</strong>");
    expect(html).toContain('<a href="https://example.com/a" rel="noreferrer">Source</a>');
    expect(html).not.toContain("date: 2026-10-22");
  });

  it("escapes HTML and rejects javascript links", () => {
    const html = renderMarkdown(
      '<script>alert("x")</script>\n\n[bad](javascript:alert(1))\n\n**<img src=x onerror=1>**',
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("[bad](javascript:alert(1))");
  });
});
