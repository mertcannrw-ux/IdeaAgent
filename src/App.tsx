import { useEffect, useRef, useState } from "react";
import { analyzeRepository } from "./lib/analysis";
import { buildAnalysisCorpus, fetchRepoSnapshot } from "./lib/github";
import { createLlmClient } from "./lib/llm";
import { parseSettings, cheapModel, llmKeyId, searchKeyId, smartModel } from "./lib/settings";
import { newSessionId } from "./lib/text";
import type {
  RepoAnalysis,
  RunRecord,
  RunSummary,
  SecretId,
  Settings,
} from "./lib/types";
import { canonicalRepoKey, parseRepoUrl } from "./lib/urls";
import {
  loadAnalysis,
  loadRun,
  listRuns,
  loadSettings,
  saveAnalysis,
  saveSettings,
} from "./platform/db";
import {
  ensurePromptFiles,
  loadPrompts,
  openExternalUrl,
  openInObsidian,
} from "./platform/files";
import { allowHttpOrigin, baseUrlOrigin, http } from "./platform/network";
import { branchMoved, loadLlmModels, runRadar, validateGithubToken, validateSearchKey } from "./platform/operations";
import { getSecret, loadPresence } from "./platform/secrets";
import { RunView } from "./ui/RunView";
import { SettingsView } from "./ui/SettingsView";

type View = "run" | "settings";

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => parseSettings(null));
  const [analysis, setAnalysis] = useState<RepoAnalysis | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeRun, setActiveRun] = useState<RunRecord | null>(null);
  const [keys, setKeys] = useState<Record<SecretId, boolean>>({
    github_token: false,
    anthropic_key: false,
    openai_key: false,
    exa_key: false,
    brave_key: false,
  });
  const [view, setView] = useState<View>("run");
  const [booted, setBooted] = useState(false);
  const [bootError, setBootError] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [analysisError, setAnalysisError] = useState("");
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string[]>([]);
  const [runError, setRunError] = useState("");
  const [branchHint, setBranchHint] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [modelsRefreshToken, setModelsRefreshToken] = useState(0);
  const analysisToken = useRef(0);
  const analysisInFlight = useRef(false);
  const repoLoadToken = useRef(0);
  const modelsToken = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const loaded = await loadSettings();
        await ensurePromptFiles();
        const presence = await loadPresence();
        if (cancelled) return;
        setSettings(loaded);
        setKeys(presence);
        if (loaded.llmProvider === "openai" && loaded.openaiBaseUrl) {
          await allowHttpOrigin(loaded.openaiBaseUrl).catch(() => undefined);
        }
        let loadedAnalysis: RepoAnalysis | null = null;
        let loadedRuns: RunSummary[] = [];
        let latest: RunRecord | null = null;
        if (loaded.repoUrl) {
          [loadedAnalysis, loadedRuns] = await Promise.all([
            loadAnalysis(loaded.repoUrl),
            listRuns(loaded.repoUrl),
          ]);
          if (loadedRuns[0]) latest = await loadRun(loadedRuns[0].id);
        }
        if (cancelled) return;
        setAnalysis(loadedAnalysis);
        setRuns(loadedRuns);
        setActiveRun(latest);
        setView(loaded.repoUrl && loadedAnalysis ? "run" : "settings");
        setBooted(true);
      } catch (error) {
        if (!cancelled) {
          setBootError(
            error instanceof Error
              ? error.message
              : "Radar could not start; restart the app and try again.",
          );
        }
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!booted || !analysis || !settings.repoUrl) {
      setBranchHint(false);
      return;
    }
    let cancelled = false;
    branchMoved(settings, analysis)
      .then((moved) => {
        if (!cancelled) setBranchHint(moved);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [booted, analysis?.commitSha, settings.repoUrl]);

  useEffect(() => {
    if (!booted) return;
    const token = modelsToken.current + 1;
    modelsToken.current = token;
    const keyId = llmKeyId(settings);
    if (!keys[keyId]) {
      setModels([]);
      setModelsError("");
      setModelsBusy(false);
      return;
    }
    if (settings.llmProvider === "openai" && !baseUrlOrigin(settings.openaiBaseUrl)) {
      setModels([]);
      setModelsError("Add a valid base URL to load models.");
      setModelsBusy(false);
      return;
    }
    setModelsBusy(true);
    setModelsError("");
    void (async () => {
      try {
        const key = await getSecret(keyId);
        if (!key) throw new Error("Save a key to load models.");
        if (settings.llmProvider === "openai") {
          await allowHttpOrigin(settings.openaiBaseUrl);
        }
        const list = await loadLlmModels(settings, key);
        if (token !== modelsToken.current) return;
        setModels(list);
        const cheap =
          settings.llmProvider === "anthropic"
            ? settings.anthropicCheapModel
            : settings.openaiCheapModel;
        const smart =
          settings.llmProvider === "anthropic"
            ? settings.anthropicSmartModel
            : settings.openaiSmartModel;
        const clearCheap = Boolean(cheap && !list.includes(cheap));
        const clearSmart = Boolean(smart && !list.includes(smart));
        if (clearCheap || clearSmart) {
          const next: Settings =
            settings.llmProvider === "anthropic"
              ? {
                  ...settings,
                  anthropicCheapModel: clearCheap ? "" : settings.anthropicCheapModel,
                  anthropicSmartModel: clearSmart ? "" : settings.anthropicSmartModel,
                }
              : {
                  ...settings,
                  openaiCheapModel: clearCheap ? "" : settings.openaiCheapModel,
                  openaiSmartModel: clearSmart ? "" : settings.openaiSmartModel,
                };
          setSettings(next);
          void saveSettings(next);
        }
      } catch (error) {
        if (token !== modelsToken.current) return;
        setModels([]);
        setModelsError(
          error instanceof Error ? error.message : "Radar could not load models from the endpoint.",
        );
      } finally {
        if (token === modelsToken.current) setModelsBusy(false);
      }
    })();
  }, [booted, settings.llmProvider, keys.anthropic_key, keys.openai_key, modelsRefreshToken]);

  const persistSettings = async (next: Settings): Promise<boolean> => {
    setSettings(next);
    try {
      await saveSettings(next);
      setSettingsError("");
      return true;
    } catch (error) {
      setSettingsError(
        error instanceof Error ? error.message : "Radar could not save its settings.",
      );
      return false;
    }
  };

  const updateSettings = (next: Settings, persist: boolean) => {
    if (
      next.llmProvider !== settings.llmProvider ||
      (next.llmProvider === "openai" && next.openaiBaseUrl !== settings.openaiBaseUrl)
    ) {
      setModels([]);
      setModelsError("");
      setModelsBusy(false);
    }
    setSettings(next);
    if (persist) void persistSettings(next);
  };

  const updateAnalysis = async (next: RepoAnalysis, persist: boolean) => {
    setAnalysis(next);
    if (!persist) return;
    try {
      await saveAnalysis(next);
      setAnalysisError("");
    } catch (error) {
      setAnalysisError(
        error instanceof Error ? error.message : "Radar could not save the analysis.",
      );
    }
  };

  const canAnalyze = (candidate: Settings, presence: Record<SecretId, boolean>) => {
    const selected = smartModel(candidate);
    return Boolean(
      parseRepoUrl(candidate.repoUrl) &&
        presence[llmKeyId(candidate)] &&
        selected &&
        models.includes(selected) &&
        (candidate.llmProvider === "anthropic" || candidate.openaiBaseUrl.trim()),
    );
  };

  const startAnalysis = async (candidate: Settings, existing: RepoAnalysis | null) => {
    if (analysisInFlight.current || running) return;
    const ref = parseRepoUrl(candidate.repoUrl);
    if (!ref) {
      setAnalysisError("Enter a GitHub repository URL like https://github.com/owner/repo.");
      return;
    }
    if (!models.includes(smartModel(candidate))) {
      setAnalysisError("Choose a smart model in Settings before analyzing.");
      return;
    }
    const token = analysisToken.current + 1;
    analysisToken.current = token;
    analysisInFlight.current = true;
    setAnalysisBusy(true);
    setAnalysisError("");
    setAnalysisStatus("Reading the repository…");
    try {
      const llmKey = await getSecret(llmKeyId(candidate));
      if (!llmKey) throw new Error("Add your LLM key in Settings before analyzing.");
      if (candidate.llmProvider === "openai") await allowHttpOrigin(candidate.openaiBaseUrl);
      const githubToken = await getSecret("github_token").catch(() => null);
      const snapshot = await fetchRepoSnapshot(ref, http, githubToken ?? undefined);
      if (token !== analysisToken.current) return;
      setAnalysisStatus("Analyzing the repository…");
      const prompts = await loadPrompts();
      const llm = createLlmClient({
        provider: candidate.llmProvider,
        apiKey: llmKey,
        baseUrl: candidate.openaiBaseUrl,
        sessionId: newSessionId(),
        http,
      });
      const generated = await analyzeRepository(
        llm,
        prompts.repoAnalysis,
        buildAnalysisCorpus(snapshot),
        smartModel(candidate),
      );
      if (token !== analysisToken.current) return;
      const base = existing ?? (await loadAnalysis(candidate.repoUrl));
      const analyzedAt = new Date().toISOString();
      const draft = {
        ...generated,
        analyzedAt,
        commitSha: snapshot.commitSha,
        defaultBranch: snapshot.repo.defaultBranch,
      };
      const keepEdits = Boolean(base && (base.contextEdited || base.competitorsEdited));
      let next: RepoAnalysis;
      if (base) {
        const sameCompetitors =
          JSON.stringify(base.competitors) === JSON.stringify(generated.competitors);
        next = keepEdits
          ? {
              ...base,
              defaultBranch: snapshot.repo.defaultBranch,
              commitSha: snapshot.commitSha,
              analyzedAt,
              draft,
            }
          : {
              ...base,
              defaultBranch: snapshot.repo.defaultBranch,
              commitSha: snapshot.commitSha,
              analyzedAt,
              productContext: generated.productContext,
              competitors: generated.competitors,
              confirmedAt: sameCompetitors ? base.confirmedAt : null,
              contextEdited: false,
              competitorsEdited: false,
              draft: null,
            };
      } else {
        next = {
          repoUrl: ref.canonicalUrl,
          defaultBranch: snapshot.repo.defaultBranch,
          commitSha: snapshot.commitSha,
          analyzedAt,
          productContext: generated.productContext,
          competitors: generated.competitors,
          confirmedAt: null,
          contextEdited: false,
          competitorsEdited: false,
          draft: null,
        };
      }
      await saveAnalysis(next);
      if (token !== analysisToken.current) return;
      setAnalysis(next);
      setAnalysisStatus("");
      setBranchHint(false);
    } catch (error) {
      if (token !== analysisToken.current) return;
      setAnalysisError(
        error instanceof Error
          ? error.message
          : "Radar could not analyze the repository; try again.",
      );
      setAnalysisStatus("");
    } finally {
      if (token === analysisToken.current) {
        analysisInFlight.current = false;
        setAnalysisBusy(false);
      }
    }
  };

  const handleRepoCommit = async (url: string) => {
    const trimmed = url.trim();
    const oldKey = canonicalRepoKey(settings.repoUrl);
    if (!trimmed) {
      repoLoadToken.current += 1;
      analysisToken.current += 1;
      analysisInFlight.current = false;
      setAnalysisBusy(false);
      setAnalysisStatus("");
      setAnalysisError("");
      setAnalysis(null);
      setRuns([]);
      setActiveRun(null);
      setBranchHint(false);
      await persistSettings({ ...settings, repoUrl: "" });
      return;
    }
    const ref = parseRepoUrl(trimmed);
    if (!ref) {
      setSettingsError("Enter a GitHub repository URL like https://github.com/owner/repo.");
      return;
    }
    const next = { ...settings, repoUrl: ref.canonicalUrl };
    if (!(await persistSettings(next))) return;
    if (canonicalRepoKey(ref.canonicalUrl) === oldKey) return;
    const loadToken = repoLoadToken.current + 1;
    repoLoadToken.current = loadToken;
    analysisToken.current += 1;
    analysisInFlight.current = false;
    setAnalysisBusy(false);
    setAnalysisStatus("");
    setAnalysisError("");
    setAnalysis(null);
    setRuns([]);
    setActiveRun(null);
    setBranchHint(false);
    try {
      const loaded = await loadAnalysis(ref.canonicalUrl);
      const nextRuns = await listRuns(ref.canonicalUrl);
      if (loadToken !== repoLoadToken.current) return;
      setRuns(nextRuns);
      if (loaded) setAnalysis(loaded);
      if (nextRuns[0]) {
        const latest = await loadRun(nextRuns[0].id);
        if (loadToken !== repoLoadToken.current) return;
        setActiveRun(latest);
      }
      if (!loaded && canAnalyze(next, keys)) void startAnalysis(next, null);
    } catch (error) {
      if (loadToken !== repoLoadToken.current) return;
      setSettingsError(
        error instanceof Error ? error.message : "Radar could not load that repository; try again.",
      );
    }
  };

  const handleRun = async () => {
    if (!analysis || running) return;
    setRunning(true);
    setRunError("");
    setAnalysisError("");
    setStatus([]);
    try {
      const outcome = await runRadar(settings, analysis, (line) =>
        setStatus((current) => [...current, line]),
      );
      const record: RunRecord = {
        ...outcome.summary,
        repoUrl: settings.repoUrl,
        vaultPath: settings.vaultPath,
        markdown: outcome.markdown,
      };
      setRuns((current) => [outcome.summary, ...current]);
      setActiveRun(record);
      setStatus([]);
    } catch (error) {
      setRunError(
        error instanceof Error ? error.message : "Radar could not complete the run; try again.",
      );
      setStatus([]);
    } finally {
      setRunning(false);
    }
  };

  const handleOpenPast = async (id: number) => {
    setRunError("");
    try {
      const record = await loadRun(id);
      if (!record) {
        setRunError("Radar could not open that digest; run again.");
        return;
      }
      setActiveRun(record);
    } catch {
      setRunError("Radar could not open that digest; run again.");
    }
  };

  const handleSecretSaved = (id: SecretId) => {
    setKeys((current) => ({ ...current, [id]: true }));
  };

  const handleSecretRemoved = (id: SecretId) => {
    setKeys((current) => ({ ...current, [id]: false }));
  };

  const validateKey = async (id: SecretId, value: string) => {
    if (id === "github_token") return validateGithubToken(value);
    if (id === "anthropic_key" || id === "openai_key") {
      const list = await loadLlmModels(settings, value);
      setModels(list);
      setModelsError("");
      return;
    }
    return validateSearchKey(id === "exa_key" ? "exa" : "brave", value);
  };

  const refreshModels = () => setModelsRefreshToken((current) => current + 1);

  const handleModelChange = (next: Settings) => {
    void persistSettings(next);
  };

  const disabledReason = (() => {
    if (running) return "";
    if (analysisBusy) return "Analyzing the repository…";
    if (!settings.repoUrl) return "Add a repository in Settings.";
    if (!parseRepoUrl(settings.repoUrl)) {
      return "Enter a valid GitHub repository URL in Settings.";
    }
    if (!analysis) return "Analyze the repository in Settings.";
    if (!analysis.confirmedAt) return "Confirm competitors in Settings.";
    if (!settings.vaultPath) return "Choose an Obsidian vault folder in Settings.";
    if (!keys[llmKeyId(settings)]) return "Add your LLM key in Settings.";
    if (settings.llmProvider === "openai" && !settings.openaiBaseUrl.trim()) {
      return "Add a base URL in Settings.";
    }
    const searchKey = searchKeyId(settings);
    if (searchKey && !keys[searchKey]) {
      return "Add your search key in Settings, or use Hacker News.";
    }
    if (modelsBusy) return "Loading models in Settings.";
    if (modelsError) return "Load models in Settings.";
    if (
      !models.includes(cheapModel(settings)) ||
      !models.includes(smartModel(settings))
    ) {
      return "Choose models in Settings.";
    }
    return "";
  })();

  if (bootError) {
    return (
      <div className="app boot">
        <div className="brand">Radar</div>
        <p className="error">{bootError}</p>
      </div>
    );
  }

  if (!booted) {
    return (
      <div className="app boot">
        <div className="brand">Radar</div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <span className="brand">Radar</span>
        <div className="toggle" role="group" aria-label="View">
          <button
            type="button"
            aria-pressed={view === "run"}
            onClick={() => {
              setView("run");
              window.scrollTo(0, 0);
            }}
          >
            Run
          </button>
          <button
            type="button"
            aria-pressed={view === "settings"}
            onClick={() => {
              setView("settings");
              window.scrollTo(0, 0);
            }}
          >
            Settings
          </button>
        </div>
      </header>

      {view === "run" ? (
        <RunView
          settings={settings}
          analysis={analysis}
          runs={runs}
          activeRun={activeRun}
          running={running}
          status={status}
          error={runError || analysisError || settingsError}
          analysisBusy={analysisBusy}
          analysisStatus={analysisStatus}
          branchHint={branchHint}
          disabledReason={disabledReason}
          onRun={() => void handleRun()}
          onLookback={(lookback) => void persistSettings({ ...settings, lookback })}
          onOpenPast={(id) => void handleOpenPast(id)}
          onOpenObsidian={(record) => {
            openInObsidian(record.vaultPath, record.digestRel).catch((error: unknown) =>
              setRunError(
                error instanceof Error ? error.message : "Radar could not open Obsidian; check that it is installed.",
              ),
            );
          }}
          onOpenUrl={(url) => {
            openExternalUrl(url).catch((error: unknown) =>
              setRunError(
                error instanceof Error ? error.message : "Radar could not open that link; check the default browser.",
              ),
            );
          }}
          onReanalyze={() => void startAnalysis(settings, analysis)}
        />
      ) : (
        <SettingsView
          settings={settings}
          analysis={analysis}
          keys={keys}
          busy={analysisBusy}
          status={analysisStatus}
          error={analysisError}
          settingsError={settingsError}
          onSettingsChange={updateSettings}
          onRepoCommit={(url) => void handleRepoCommit(url)}
          onAnalyze={() => void startAnalysis(settings, analysis)}
          onApplyDraft={() => {
            if (!analysis?.draft) return;
            void updateAnalysis(
              {
                ...analysis,
                productContext: analysis.draft.productContext,
                competitors: analysis.draft.competitors,
                contextEdited: false,
                competitorsEdited: false,
                confirmedAt: null,
                draft: null,
              },
              true,
            );
          }}
          onAnalysisChange={(next, persist) => void updateAnalysis(next, persist)}
          onSecretSaved={handleSecretSaved}
          onSecretRemoved={handleSecretRemoved}
          validateSecret={validateKey}
          models={models}
          modelsBusy={modelsBusy}
          modelsError={modelsError}
          onModelChange={handleModelChange}
          onRefreshModels={refreshModels}
          running={running}
        />
      )}
    </div>
  );
}
