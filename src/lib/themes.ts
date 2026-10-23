import { CATEGORIES } from "./types";
import type {
  Category,
  ExtractedItem,
  PreviousTheme,
  SourceRef,
  ThemeCandidate,
  ThemeCluster,
} from "./types";
import { normalizeUrl } from "./urls";
import { collapseWhitespace, limitChars } from "./text";

const CATEGORY_LABELS: Record<Category, string> = {
  reliability: "Reliability complaints",
  "missing feature": "Missing feature complaints",
  pricing: "Pricing complaints",
  workflow: "Workflow complaints",
  "lock-in": "Lock-in complaints",
  other: "Other complaints",
};

function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

export function themeKey(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .replace(/\s+/g, "-") || "untitled"
  );
}

export function parseThemeClusters(
  value: unknown,
  items: ExtractedItem[],
): ThemeCluster[] {
  const data = value as { themes?: unknown } | null;
  if (!data || !Array.isArray(data.themes)) {
    throw new Error("The model returned malformed themes; run again or reset the prompt files.");
  }
  const clusters: ThemeCluster[] = [];
  const assigned = new Set<number>();
  for (const raw of data.themes) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as {
      existingId?: unknown;
      name?: unknown;
      summary?: unknown;
      category?: unknown;
      items?: unknown;
    };
    const name =
      typeof entry.name === "string" ? limitChars(collapseWhitespace(entry.name), 120) : "";
    const indexes = Array.isArray(entry.items)
      ? entry.items.filter(
          (index): index is number =>
            Number.isInteger(index) && index >= 0 && index < items.length,
        )
      : [];
    const usable = indexes.filter((index) => !assigned.has(index));
    if (!name || usable.length === 0) continue;
    for (const index of usable) assigned.add(index);
    clusters.push({
      existingId:
        typeof entry.existingId === "number" && Number.isInteger(entry.existingId)
          ? entry.existingId
          : null,
      name,
      summary:
        typeof entry.summary === "string"
          ? limitChars(collapseWhitespace(entry.summary), 300)
          : "",
      category: isCategory(entry.category) ? entry.category : "other",
      itemIndexes: usable,
    });
  }

  const unassigned = items
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => !assigned.has(index));
  if (unassigned.length > 0) {
    const byGroup = new Map<string, { category: Category; competitor: string; indexes: number[] }>();
    for (const { item, index } of unassigned) {
      const key = `${item.category}|${item.competitor.toLowerCase()}`;
      const group = byGroup.get(key) ?? {
        category: item.category,
        competitor: item.competitor,
        indexes: [],
      };
      group.indexes.push(index);
      byGroup.set(key, group);
    }
    for (const group of byGroup.values()) {
      clusters.push({
        existingId: null,
        name: `${CATEGORY_LABELS[group.category]} · ${group.competitor}`,
        summary: "Unclustered complaints from this run.",
        category: group.category,
        itemIndexes: group.indexes,
      });
    }
  }

  if (clusters.length === 0) {
    throw new Error("The model returned no themes; run again or reset the prompt files.");
  }
  return clusters;
}

export function resolveClusterKey(
  previous: PreviousTheme[],
  cluster: ThemeCluster,
): string {
  const byId =
    cluster.existingId !== null
      ? previous.find((theme) => theme.id === cluster.existingId)
      : undefined;
  const existing = byId ?? previous.find((theme) => theme.key === themeKey(cluster.name));
  return existing?.key ?? themeKey(cluster.name);
}

export function mergeThemes(
  previous: PreviousTheme[],
  clusters: ThemeCluster[],
  items: ExtractedItem[],
): ThemeCandidate[] {
  const previousById = new Map(previous.map((theme) => [theme.id, theme]));
  const previousByKey = new Map(previous.map((theme) => [theme.key, theme]));
  const merged = new Map<string, ThemeCandidate>();

  for (const cluster of clusters) {
    const byId =
      cluster.existingId !== null ? previousById.get(cluster.existingId) : undefined;
    const existing = byId ?? previousByKey.get(themeKey(cluster.name));
    const key = existing?.key ?? themeKey(cluster.name);
    const existingMerge = merged.get(key);
    const clusterItems = cluster.itemIndexes
      .map((index) => items[index])
      .filter((item): item is ExtractedItem => Boolean(item));
    const sources = uniqueSources(
      clusterItems.map((item) => ({
        url: normalizeUrl(item.url) ?? item.url,
        title: item.title,
        publishedAt: item.publishedAt,
        author: item.author,
      })),
    );
    if (sources.length === 0) continue;

    if (existingMerge) {
      existingMerge.sources = uniqueSources([...existingMerge.sources, ...sources]);
      existingMerge.itemCount += cluster.itemIndexes.length;
      if (cluster.summary) existingMerge.summary = cluster.summary;
      continue;
    }

    merged.set(key, {
      id: existing?.id ?? null,
      key,
      name: existing?.name ?? cluster.name,
      summary: cluster.summary || existing?.summary || "",
      category: cluster.category || existing?.category || "other",
      competitor: dominantCompetitor(clusterItems),
      sources,
      runCount: (existing?.runCount ?? 0) + 1,
      lastScore: existing?.lastScore ?? null,
      itemCount: cluster.itemIndexes.length,
    });
  }

  return [...merged.values()];
}

function uniqueSources(sources: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  const result: SourceRef[] = [];
  for (const source of sources) {
    if (seen.has(source.url)) continue;
    seen.add(source.url);
    result.push(source);
  }
  return result;
}

function dominantCompetitor(items: ExtractedItem[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.competitor, (counts.get(item.competitor) ?? 0) + 1);
  }
  let best = items[0]?.competitor ?? "";
  let bestCount = 0;
  for (const [competitor, count] of counts) {
    if (count > bestCount) {
      best = competitor;
      bestCount = count;
    }
  }
  return best;
}
