import { invoke } from "@tauri-apps/api/core";
import type { SecretId } from "../lib/types";

const SECRET_IDS: SecretId[] = [
  "github_token",
  "anthropic_key",
  "openai_key",
  "exa_key",
  "brave_key",
];

export async function getSecret(id: SecretId): Promise<string | null> {
  try {
    const value = await invoke<string | null>("secret_get", { id });
    return value?.trim() || null;
  } catch (error) {
    throw new Error(
      typeof error === "string"
        ? error
        : "Radar could not read the system keychain; unlock it and try again.",
    );
  }
}

export async function hasSecret(id: SecretId): Promise<boolean> {
  try {
    return await invoke<boolean>("secret_has", { id });
  } catch (error) {
    throw new Error(
      typeof error === "string"
        ? error
        : "Radar could not read the system keychain; unlock it and try again.",
    );
  }
}

export async function setSecret(id: SecretId, value: string): Promise<void> {
  try {
    await invoke("secret_set", { id, value });
  } catch (error) {
    throw new Error(
      typeof error === "string"
        ? error
        : "Radar could not save the key in the system keychain; unlock it and try again.",
    );
  }
}

export async function deleteSecret(id: SecretId): Promise<void> {
  try {
    await invoke("secret_delete", { id });
  } catch (error) {
    throw new Error(
      typeof error === "string"
        ? error
        : "Radar could not remove the key from the system keychain; unlock it and try again.",
    );
  }
}

export async function loadPresence(): Promise<Record<SecretId, boolean>> {
  const entries = await Promise.all(
    SECRET_IDS.map(async (id) => [id, await hasSecret(id)] as const),
  );
  return Object.fromEntries(entries) as Record<SecretId, boolean>;
}
