import { useState } from "react";
import type { Competitor, PromptSet, RepoAnalysis, SecretId, Settings } from "../lib/types";
import { PROMPT_FILES } from "../lib/prompts";
import { llmKeyId, smartModel } from "../lib/settings";
import {
  chooseVaultFolder,
  ensureVault,
  resetPromptFile,
  showPromptsFolder,
} from "../platform/files";
import { deleteSecret, setSecret } from "../platform/secrets";

interface SettingsViewProps {
  settings: Settings;
  analysis: RepoAnalysis | null;
  keys: Record<SecretId, boolean>;
  busy: boolean;
  status: string;
  error: string;
  settingsError: string;
  onSettingsChange: (next: Settings, persist: boolean) => void;
  onRepoCommit: (url: string) => void;
  onAnalyze: () => void;
  onApplyDraft: () => void;
  onAnalysisChange: (next: RepoAnalysis, persist: boolean) => void;
  onSecretSaved: (id: SecretId) => void;
  onSecretRemoved: (id: SecretId) => void;
  validateSecret: (id: SecretId, value: string) => Promise<void>;
  models: string[];
  modelsBusy: boolean;
  modelsError: string;
  onModelChange: (next: Settings) => void;
  onRefreshModels: () => void;
  running: boolean;
}

export function SettingsView(props: SettingsViewProps) {
  const { settings, analysis } = props;
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultError, setVaultError] = useState("");
  const [promptMessage, setPromptMessage] = useState("");
  const [promptError, setPromptError] = useState("");
  const [newCompetitor, setNewCompetitor] = useState("");
  const providerKey = llmKeyId(settings);
  const hasProviderKey = props.keys[providerKey];
  const analyzeDisabled =
    props.busy ||
    props.modelsBusy ||
    props.running ||
    !settings.repoUrl ||
    !hasProviderKey ||
    !props.models.includes(smartModel(settings)) ||
    (settings.llmProvider === "openai" && !settings.openaiBaseUrl.trim());

  const commit = () => props.onSettingsChange(settings, true);

  const setModel = (kind: "cheap" | "smart", value: string) => {
    const next: Settings =
      settings.llmProvider === "anthropic"
        ? {
            ...settings,
            anthropicCheapModel:
              kind === "cheap" ? value : settings.anthropicCheapModel,
            anthropicSmartModel:
              kind === "smart" ? value : settings.anthropicSmartModel,
          }
        : {
            ...settings,
            openaiCheapModel: kind === "cheap" ? value : settings.openaiCheapModel,
            openaiSmartModel: kind === "smart" ? value : settings.openaiSmartModel,
          };
    props.onModelChange(next);
  };

  const updateCompetitors = (competitors: Competitor[]) => {
    if (!analysis) return;
    props.onAnalysisChange(
      {
        ...analysis,
        competitors,
        competitorsEdited: true,
        confirmedAt: null,
      },
      true,
    );
  };

  const handleVault = async () => {
    setVaultBusy(true);
    setVaultError("");
    try {
      const selected = await chooseVaultFolder();
      if (!selected) return;
      await ensureVault(selected);
      props.onSettingsChange({ ...settings, vaultPath: selected }, true);
    } catch (error) {
      setVaultError(
        error instanceof Error ? error.message : "Radar could not use that folder; choose another.",
      );
    } finally {
      setVaultBusy(false);
    }
  };

  const handleResetPrompt = async (id: keyof PromptSet) => {
    setPromptError("");
    setPromptMessage("");
    try {
      await resetPromptFile(id);
      setPromptMessage("Prompt reset.");
    } catch (error) {
      setPromptError(
        error instanceof Error ? error.message : "Radar could not reset that prompt.",
      );
    }
  };

  return (
    <main className="settings">
      {props.settingsError ? (
        <p className="error" role="alert">
          {props.settingsError}
        </p>
      ) : null}

      <section className="section">
        <h2>Repository</h2>
        <div className="field">
          <label htmlFor="repo-url">GitHub repository</label>
          <input
            id="repo-url"
            type="url"
            spellCheck={false}
            placeholder="https://github.com/owner/repo"
            value={settings.repoUrl}
            disabled={props.busy || props.running}
            onChange={(event) =>
              props.onSettingsChange({ ...settings, repoUrl: event.target.value }, false)
            }
            onBlur={() => props.onRepoCommit(settings.repoUrl)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          {settings.repoUrl && !props.keys[providerKey] && !props.busy && !props.running ? (
            <span className="status">
              Add {settings.llmProvider === "anthropic" ? "an Anthropic" : "an OpenAI-compatible"} key
              to {analysis ? "re-analyze" : "analyze"} this repository.
            </span>
          ) : null}
        </div>

        <div className="row action-row">
          <button
            type="button"
            className="btn"
            disabled={analyzeDisabled}
            onClick={props.onAnalyze}
          >
            {props.busy ? "Analyzing…" : analysis ? "Re-analyze" : "Analyze repo"}
          </button>
          {props.status ? <span className="status">{props.status}</span> : null}
        </div>
        {props.error ? (
          <p className="error" role="alert">
            {props.error}
          </p>
        ) : null}

        {analysis?.draft ? (
          <div className="notice">
            <span>New analysis ready. Your edits were kept.</span>
            <button type="button" className="text" onClick={props.onApplyDraft}>
              Use generated version
            </button>
          </div>
        ) : null}

        {analysis ? (
          <>
            <div className="field">
              <h3>Product context</h3>
              <textarea
                aria-label="Product context"
                rows={9}
                disabled={props.busy}
                value={analysis.productContext}
                onChange={(event) =>
                  props.onAnalysisChange(
                    {
                      ...analysis,
                      productContext: event.target.value,
                      contextEdited: true,
                    },
                    false,
                  )
                }
                onBlur={() => props.onAnalysisChange(analysis, true)}
              />
            </div>

            <div className="field">
              <h3>Competitors</h3>
              {analysis.competitors.length === 0 ? (
                <p className="status">No competitors found. Add at least one.</p>
              ) : null}
              <ul className="competitors">
                {analysis.competitors.map((competitor, index) => (
                  <li key={`${competitor.name}-${index}`}>
                    <label className="competitor">
                      <input
                        type="checkbox"
                        checked={competitor.enabled}
                        disabled={props.busy}
                        onChange={(event) =>
                          updateCompetitors(
                            analysis.competitors.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, enabled: event.target.checked }
                                : item,
                            ),
                          )
                        }
                      />
                      <span>
                        <span>{competitor.name}</span>
                        {competitor.reason ? (
                          <span className="meta">{competitor.reason}</span>
                        ) : null}
                      </span>
                    </label>
                    <button
                      type="button"
                      className="text"
                      disabled={props.busy}
                      onClick={() =>
                        updateCompetitors(
                          analysis.competitors.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>

              <form
                className="row add-competitor"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = newCompetitor.trim();
                  if (!name) return;
                  updateCompetitors([
                    ...analysis.competitors,
                    { name, aliases: [], reason: "", enabled: true },
                  ]);
                  setNewCompetitor("");
                }}
              >
                <input
                  type="text"
                  aria-label="Add a competitor"
                  placeholder="Add a competitor"
                  value={newCompetitor}
                  disabled={props.busy}
                  onChange={(event) => setNewCompetitor(event.target.value)}
                />
                <button
                  type="submit"
                  className="btn"
                  disabled={props.busy || !newCompetitor.trim()}
                >
                  Add
                </button>
              </form>

              {analysis.confirmedAt ? (
                <p className="status">Competitors confirmed.</p>
              ) : (
                <button
                  type="button"
                  className="btn"
                  disabled={
                    props.busy || !analysis.competitors.some((item) => item.enabled)
                  }
                  onClick={() =>
                    props.onAnalysisChange(
                      { ...analysis, confirmedAt: new Date().toISOString() },
                      true,
                    )
                  }
                >
                  Confirm competitors
                </button>
              )}
            </div>

            <div className="field">
              <label htmlFor="roadmap">Roadmap / anything not in the repo</label>
              <textarea
                id="roadmap"
                rows={4}
                value={settings.roadmap}
                placeholder="Work you have planned that is not documented in the repository."
                onChange={(event) =>
                  props.onSettingsChange({ ...settings, roadmap: event.target.value }, false)
                }
                onBlur={commit}
              />
            </div>
          </>
        ) : null}
      </section>

      <section className="section">
        <h2>Providers</h2>
        <div className="field">
          <label htmlFor="llm-provider">LLM provider</label>
          <select
            id="llm-provider"
            value={settings.llmProvider}
            onChange={(event) =>
              props.onSettingsChange(
                {
                  ...settings,
                  llmProvider: event.target.value === "openai" ? "openai" : "anthropic",
                },
                true,
              )
            }
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI-compatible</option>
          </select>
        </div>

        {settings.llmProvider === "anthropic" ? (
          <KeyField
            key="anthropic-key"
            id="anthropic_key"
            label="Anthropic key"
            saved={props.keys.anthropic_key}
            validate={props.validateSecret}
            onSaved={props.onSecretSaved}
            onRemoved={props.onSecretRemoved}
          />
        ) : (
          <>
            <div className="field">
              <label htmlFor="openai-base-url">Base URL</label>
              <input
                id="openai-base-url"
                type="url"
                spellCheck={false}
                value={settings.openaiBaseUrl}
                onChange={(event) =>
                  props.onSettingsChange(
                    { ...settings, openaiBaseUrl: event.target.value },
                    false,
                  )
                }
                onBlur={() => {
                  commit();
                  props.onRefreshModels();
                }}
              />
            </div>
            <KeyField
              key="openai-key"
              id="openai_key"
              label="OpenAI-compatible key"
              saved={props.keys.openai_key}
              validate={props.validateSecret}
              onSaved={props.onSecretSaved}
              onRemoved={props.onSecretRemoved}
            />
          </>
        )}

        <div className="grid">
          <div className="field">
            <label htmlFor="cheap-model">Cheap model (extraction)</label>
            <select
              id="cheap-model"
              value={
                settings.llmProvider === "anthropic"
                  ? settings.anthropicCheapModel
                  : settings.openaiCheapModel
              }
              disabled={!hasProviderKey || props.modelsBusy || props.models.length === 0}
              onChange={(event) => setModel("cheap", event.target.value)}
            >
              <option value="">
                {!hasProviderKey
                  ? "Save a key first"
                  : props.modelsBusy
                    ? "Loading models…"
                    : props.models.length
                      ? "Select model"
                      : "No models loaded"}
              </option>
              {props.models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="smart-model">Smart model (analysis and scoring)</label>
            <select
              id="smart-model"
              value={
                settings.llmProvider === "anthropic"
                  ? settings.anthropicSmartModel
                  : settings.openaiSmartModel
              }
              disabled={!hasProviderKey || props.modelsBusy || props.models.length === 0}
              onChange={(event) => setModel("smart", event.target.value)}
            >
              <option value="">
                {!hasProviderKey
                  ? "Save a key first"
                  : props.modelsBusy
                    ? "Loading models…"
                    : props.models.length
                      ? "Select model"
                      : "No models loaded"}
              </option>
              {props.models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="row model-status">
          <span className="status">
            {props.modelsError
              ? ""
              : !hasProviderKey
                ? "Save a key to load models."
                : props.modelsBusy
                  ? "Loading models from the endpoint…"
                  : props.models.length
                    ? `${props.models.length} model${props.models.length === 1 ? "" : "s"} available.`
                    : "No models loaded."}
          </span>
          {hasProviderKey ? (
            <button
              type="button"
              className="text"
              disabled={props.modelsBusy}
              onClick={props.onRefreshModels}
            >
              Refresh models
            </button>
          ) : null}
        </div>
        {props.modelsError ? (
          <p className="error" role="alert">
            {props.modelsError}
          </p>
        ) : null}

        <div className="field">
          <label htmlFor="search-provider">Search provider</label>
          <select
            id="search-provider"
            value={settings.searchProvider}
            onChange={(event) =>
              props.onSettingsChange(
                {
                  ...settings,
                  searchProvider:
                    event.target.value === "brave"
                      ? "brave"
                      : event.target.value === "hn"
                        ? "hn"
                        : "exa",
                },
                true,
              )
            }
          >
            <option value="exa">Exa</option>
            <option value="brave">Brave</option>
            <option value="hn">Hacker News (no key)</option>
          </select>
        </div>

        {settings.searchProvider === "exa" ? (
          <KeyField
            key="exa-key"
            id="exa_key"
            label="Exa key"
            saved={props.keys.exa_key}
            validate={props.validateSecret}
            onSaved={props.onSecretSaved}
            onRemoved={props.onSecretRemoved}
          />
        ) : settings.searchProvider === "brave" ? (
          <KeyField
            key="brave-key"
            id="brave_key"
            label="Brave key"
            saved={props.keys.brave_key}
            validate={props.validateSecret}
            onSaved={props.onSecretSaved}
            onRemoved={props.onSecretRemoved}
          />
        ) : null}
        <p className="status">
          {settings.searchProvider === "hn"
            ? "Hacker News needs no key, but coverage is limited without Exa or Brave."
            : "Hacker News is also searched automatically and needs no key."}
        </p>

        <KeyField
          key="github-token"
          id="github_token"
          label="GitHub token (optional)"
          placeholder="Only raises rate limits"
          saved={props.keys.github_token}
          validate={props.validateSecret}
          onSaved={props.onSecretSaved}
          onRemoved={props.onSecretRemoved}
        />
      </section>

      <section className="section">
        <h2>Vault</h2>
        <div className="field">
          <span className="label">Obsidian vault folder</span>
          <div className="vault-row">
            <span className="path">{settings.vaultPath || "Not set."}</span>
            <button
              type="button"
              className="btn"
              disabled={vaultBusy || props.running}
              onClick={() => void handleVault()}
            >
              {vaultBusy ? "Choosing…" : "Choose folder"}
            </button>
          </div>
          {vaultError ? <span className="error">{vaultError}</span> : null}
        </div>
      </section>

      {analysis ? (
        <>
          <section className="section">
            <h2>Limits</h2>
            <div className="grid three">
              <NumberField
                id="max-queries"
                label="Max queries per run"
                value={settings.limits.maxQueries}
                min={1}
                max={100}
                integer
                onCommit={(value) =>
                  props.onSettingsChange(
                    { ...settings, limits: { ...settings.limits, maxQueries: value } },
                    true,
                  )
                }
              />
              <NumberField
                id="max-calls"
                label="Max LLM calls per run"
                value={settings.limits.maxLlmCalls}
                min={1}
                max={200}
                integer
                onCommit={(value) =>
                  props.onSettingsChange(
                    { ...settings, limits: { ...settings.limits, maxLlmCalls: value } },
                    true,
                  )
                }
              />
              <NumberField
                id="max-spend"
                label="Max spend per run (USD)"
                value={settings.limits.maxSpendUsd}
                min={0.01}
                max={100}
                step={0.01}
                onCommit={(value) =>
                  props.onSettingsChange(
                    { ...settings, limits: { ...settings.limits, maxSpendUsd: value } },
                    true,
                  )
                }
              />
            </div>
          </section>

          <section className="section">
            <h2>Prompts</h2>
            <p className="status">
              Files live in the app data folder and apply on the next run.
            </p>
            <ul className="prompts">
              {PROMPT_FILES.map((file) => (
                <li key={file.id}>
                  <span>{file.label}</span>
                  <button
                    type="button"
                    className="text"
                    onClick={() => void handleResetPrompt(file.id)}
                  >
                    Reset to default
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void showPromptsFolder().catch((error: unknown) =>
                  setPromptError(
                    error instanceof Error
                      ? error.message
                      : "Radar could not open the prompts folder.",
                  ),
                )
              }
            >
              Show folder
            </button>
            {promptMessage ? <p className="status">{promptMessage}</p> : null}
            {promptError ? <p className="error">{promptError}</p> : null}
          </section>
        </>
      ) : null}
    </main>
  );
}

function NumberField(props: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  integer?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(props.value));
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        type="number"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const parsed = Number(draft);
          if (!Number.isFinite(parsed) || draft.trim() === "") {
            setDraft(String(props.value));
            return;
          }
          const rounded = props.integer ? Math.round(parsed) : parsed;
          const next = Math.min(props.max, Math.max(props.min, rounded));
          setDraft(String(next));
          if (next !== props.value) props.onCommit(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </div>
  );
}

function KeyField(props: {
  id: SecretId;
  label: string;
  placeholder?: string;
  saved: boolean;
  validate: (id: SecretId, value: string) => Promise<void>;
  onSaved: (id: SecretId) => void;
  onRemoved: (id: SecretId) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const save = async () => {
    const secret = value.trim();
    if (!secret) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      await props.validate(props.id, secret);
      await setSecret(props.id, secret);
      setValue("");
      setNote("Saved.");
      props.onSaved(props.id);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Radar could not save the key; try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await deleteSecret(props.id);
      props.onRemoved(props.id);
      setNote("Removed.");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Radar could not remove the key; try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field key-field">
      <label htmlFor={`${props.id}-key`}>{props.label}</label>
      <div className="keyrow">
        <input
          id={`${props.id}-key`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={props.saved ? "Saved" : props.placeholder ?? "Paste key"}
          value={value}
          disabled={busy}
          onChange={(event) => {
            setValue(event.target.value);
            setNote("");
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
        />
        {value.trim() ? (
          <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
            {busy ? "Checking…" : "Save"}
          </button>
        ) : props.saved ? (
          <button type="button" className="text" disabled={busy} onClick={() => void remove()}>
            Remove
          </button>
        ) : null}
      </div>
      {error ? <span className="error">{error}</span> : null}
      {!error && note ? <span className="status">{note}</span> : null}
    </div>
  );
}
