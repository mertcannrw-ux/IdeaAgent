import { describe, expect, it } from "vitest";
import { canonicalRepoKey, normalizeUrl, parseRepoUrl } from "./urls";

describe("parseRepoUrl", () => {
  it("accepts GitHub repository URLs", () => {
    expect(parseRepoUrl("https://github.com/acme/radar.git")).toEqual({
      owner: "acme",
      repo: "radar",
      slug: "acme/radar",
      canonicalUrl: "https://github.com/acme/radar",
    });
    expect(parseRepoUrl("http://www.github.com/acme/radar/")?.slug).toBe("acme/radar");
  });

  it("rejects anything that is not a repository root", () => {
    expect(parseRepoUrl("https://github.com/acme")).toBeNull();
    expect(parseRepoUrl("https://github.com/acme/radar/issues")).toBeNull();
    expect(parseRepoUrl("https://gitlab.com/acme/radar")).toBeNull();
    expect(parseRepoUrl("not a url")).toBeNull();
  });

  it("canonicalises the repository key", () => {
    expect(canonicalRepoKey("https://github.com/Acme/Radar")).toBe("acme/radar");
    expect(canonicalRepoKey("nope")).toBeNull();
  });
});

describe("normalizeUrl", () => {
  it("drops fragments, tracking parameters and trailing slashes", () => {
    expect(
      normalizeUrl("https://Example.com/post/?utm_source=x&b=2&a=1#comments"),
    ).toBe("https://example.com/post?a=1&b=2");
  });

  it("keeps meaningful query parameters", () => {
    expect(normalizeUrl("https://news.ycombinator.com/item?id=123")).toBe(
      "https://news.ycombinator.com/item?id=123",
    );
  });

  it("rejects non-http URLs", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("mailto:test@example.com")).toBeNull();
  });
});
