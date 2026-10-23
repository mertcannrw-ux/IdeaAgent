import { appDataDir, basename, join } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { DEFAULT_PROMPTS, PROMPT_FILES } from "../lib/prompts";
import type { PromptSet } from "../lib/types";

export async function promptsDirectory(): Promise<string> {
  return join(await appDataDir(), "prompts");
}

export async function ensurePromptFiles(): Promise<void> {
  try {
    const dir = await promptsDirectory();
    await mkdir(dir, { recursive: true });
    for (const file of PROMPT_FILES) {
      const path = await join(dir, file.filename);
      if (!(await exists(path))) {
        await writeTextFile(path, DEFAULT_PROMPTS[file.id]);
      }
    }
  } catch {
    throw new Error("Radar could not prepare its prompt files; check app data permissions.");
  }
}

export async function loadPrompts(): Promise<PromptSet> {
  await ensurePromptFiles();
  try {
    const dir = await promptsDirectory();
    const entries = await Promise.all(
      PROMPT_FILES.map(async (file) => {
        const path = await join(dir, file.filename);
        const content = await readTextFile(path);
        return [file.id, content] as const;
      }),
    );
    return Object.fromEntries(entries) as unknown as PromptSet;
  } catch {
    throw new Error("Radar could not read its prompt files; reset them in Settings.");
  }
}

export async function resetPromptFile(id: keyof PromptSet): Promise<void> {
  const file = PROMPT_FILES.find((entry) => entry.id === id);
  if (!file) return;
  try {
    const path = await join(await promptsDirectory(), file.filename);
    await writeTextFile(path, DEFAULT_PROMPTS[id]);
  } catch {
    throw new Error("Radar could not reset that prompt file; check app data permissions.");
  }
}

export async function showPromptsFolder(): Promise<void> {
  try {
    await openPath(await promptsDirectory());
  } catch {
    throw new Error("Radar could not open the prompts folder; check app data permissions.");
  }
}

export async function chooseVaultFolder(): Promise<string | null> {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      recursive: true,
      title: "Choose Obsidian vault",
    });
    return typeof selected === "string" ? selected : null;
  } catch {
    throw new Error("Radar could not open the folder picker; try again.");
  }
}

function radarFolder(vaultPath: string): string {
  return `${vaultPath.replace(/[\\/]+$/, "")}/Radar`;
}

export async function ensureVault(vaultPath: string): Promise<void> {
  if (!vaultPath.trim()) {
    throw new Error("Choose an Obsidian vault folder in Settings.");
  }
  try {
    await mkdir(radarFolder(vaultPath), { recursive: true });
  } catch {
    throw new Error("Radar cannot write to the vault; choose the folder again in Settings.");
  }
}

export async function listDigestFiles(vaultPath: string): Promise<string[]> {
  try {
    const entries = await readDir(radarFolder(vaultPath));
    return entries
      .filter((entry) => entry.isFile && entry.name.toLowerCase().endsWith(".md"))
      .map((entry) => `Radar/${entry.name}`);
  } catch {
    return [];
  }
}

export async function writeDigest(
  vaultPath: string,
  digestRel: string,
  markdown: string,
): Promise<void> {
  try {
    await ensureVault(vaultPath);
    const path = await join(vaultPath, ...digestRel.split("/"));
    if (await exists(path)) {
      throw new Error("Radar found an existing digest with that name; run again.");
    }
    await writeTextFile(path, markdown, { createNew: true });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Radar ")) throw error;
    throw new Error("Radar cannot write to the vault; choose the folder again in Settings.");
  }
}

export async function obsidianUri(vaultPath: string, digestRel: string): Promise<string> {
  const vaultName = await basename(vaultPath.replace(/[\\/]+$/, ""));
  const file = digestRel.replace(/\.md$/i, "").replace(/\\/g, "/");
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(file)}`;
}

export async function openInObsidian(vaultPath: string, digestRel: string): Promise<void> {
  try {
    await openUrl(await obsidianUri(vaultPath, digestRel));
  } catch {
    throw new Error("Radar could not open Obsidian; make sure it is installed.");
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
    await openUrl(parsed.toString());
  } catch {
    throw new Error("Radar could not open that link; check the default browser.");
  }
}
