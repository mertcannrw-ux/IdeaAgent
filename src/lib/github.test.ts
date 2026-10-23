import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAnalysisCorpus, fetchBranchHead, fetchRepoSnapshot } from "./github";
import type { HttpClient } from "./http";
import { parseRepoUrl } from "./urls";

const fixture = JSON.parse(
  readFileSync(new URL("../../tests/fixtures/github.json", import.meta.url), "utf8"),
) as {
  repo: unknown;
  commit: unknown;
  readme: string;
  root: unknown;
  docs: unknown;
  fileContents: Record<string, string>;
  pulls: unknown;
  issues: unknown;
};

function mockGitHub(): { http: HttpClient; calls: string[] } {
  const calls: string[] = [];
  const http: HttpClient = async (url) => {
    calls.push(url);
    const path = url.replace("https://api.github.com", "").split("?")[0];
    const base = "/repos/octo/radar";
    if (path === base) return json(fixture.repo);
    if (path === `${base}/commits/main`) return json(fixture.commit);
    if (path === `${base}/readme`) return text(fixture.readme);
    if (path === `${base}/contents/`) return json(fixture.root);
    if (path === `${base}/contents/docs`) return json(fixture.docs);
    if (path.startsWith(`${base}/pulls`)) return json(fixture.pulls);
    if (path.startsWith(`${base}/issues`)) return json(fixture.issues);
    if (path.startsWith(`${base}/contents/`)) {
      const file = decodeURIComponent(path.slice(`${base}/contents/`.length));
      const body = fixture.fileContents[file];
      return body === undefined ? new Response("missing", { status: 404 }) : text(body);
    }
    return new Response("missing", { status: 404 });
  };
  return { http, calls };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function text(value: string): Response {
  return new Response(value, { status: 200, headers: { "content-type": "text/plain" } });
}

describe("fetchRepoSnapshot", () => {
  it("reads metadata, docs, manifests, merged PRs and open issues without source code", async () => {
    const ref = parseRepoUrl("https://github.com/octo/radar");
    if (!ref) throw new Error("fixture URL invalid");
    const { http, calls } = mockGitHub();
    const snapshot = await fetchRepoSnapshot(ref, http, "token");
    expect(snapshot.commitSha).toBe("abc123def456");
    expect(snapshot.repo.defaultBranch).toBe("main");
    expect(snapshot.readme).toContain("Acme tracks");
    expect(snapshot.docs.map((doc) => doc.path)).toEqual(["docs/setup.md"]);
    expect(snapshot.topDocs.map((doc) => doc.path)).toEqual(["ARCHITECTURE.md"]);
    expect(snapshot.manifests.map((doc) => doc.path)).toEqual(["package.json"]);
    expect(snapshot.pullRequests.map((pull) => pull.number)).toEqual([42]);
    expect(snapshot.issues.map((issue) => issue.number)).toEqual([7]);
    expect(calls.some((call) => call.includes("/contents/src"))).toBe(false);
    expect(calls.some((call) => call.includes("/contents/screenshots"))).toBe(false);
  });

  it("caps the analysis corpus", async () => {
    const ref = parseRepoUrl("https://github.com/octo/radar");
    if (!ref) throw new Error("fixture URL invalid");
    const { http } = mockGitHub();
    const snapshot = await fetchRepoSnapshot(ref, http);
    const corpus = buildAnalysisCorpus(snapshot, 300);
    expect(corpus.length).toBeLessThanOrEqual(300);
    expect(corpus).toContain("REPOSITORY: octo/radar");
  });

  it("reads the default branch head", async () => {
    const ref = parseRepoUrl("https://github.com/octo/radar");
    if (!ref) throw new Error("fixture URL invalid");
    const { http } = mockGitHub();
    await expect(fetchBranchHead(ref, "main", http)).resolves.toBe("abc123def456");
  });
});
