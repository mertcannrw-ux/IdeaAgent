const TRACKING_PARAMS: Record<string, true> = {
  fbclid: true,
  gclid: true,
  mc_cid: true,
  mc_eid: true,
  igshid: true,
  mkt_tok: true,
  ref_src: true,
};

export interface RepoRef {
  owner: string;
  repo: string;
  slug: string;
  canonicalUrl: string;
}

export function parseRepoUrl(input: string): RepoRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  const segments = url.pathname
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .split("/")
    .filter(Boolean);
  if (segments.length !== 2) return null;
  const [owner, repo] = segments;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,38})$/.test(owner)) return null;
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(repo) || repo === "." || repo === "..") return null;
  return {
    owner,
    repo,
    slug: `${owner}/${repo}`,
    canonicalUrl: `https://github.com/${owner}/${repo}`,
  };
}

export function normalizeUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS[key.toLowerCase()] === true) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  if (url.pathname === "/") url.pathname = "";
  return url.toString();
}

export function canonicalRepoKey(input: string): string | null {
  const ref = parseRepoUrl(input);
  return ref ? ref.slug.toLowerCase() : null;
}
