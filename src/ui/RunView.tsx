import type { Lookback, RepoAnalysis, RunRecord, RunSummary, Settings } from "../lib/types";
import { formatUsd } from "../lib/text";
import { Markdown } from "./Markdown";

interface RunViewProps {
  settings: Settings;
  analysis: RepoAnalysis | null;
  runs: RunSummary[];
  activeRun: RunRecord | null;
  running: boolean;
  status: string[];
  error: string;
  analysisBusy: boolean;
  analysisStatus: string;
  branchHint: boolean;
  disabledReason: string;
  onRun: () => void;
  onLookback: (lookback: Lookback) => void;
  onOpenPast: (id: number) => void;
  onOpenObsidian: (run: RunRecord) => void;
  onOpenUrl: (url: string) => void;
  onReanalyze: () => void;
}

export function RunView(props: RunViewProps) {
  const firstRun = props.settings.lookback === "since" && props.runs.length === 0;
  const busy = props.running || props.analysisBusy;
  const activeRun = props.activeRun;
  return (
    <main>
      <div className="runbar">
        <button
          type="button"
          className="btn primary"
          disabled={busy || Boolean(props.disabledReason)}
          onClick={props.onRun}
        >
          {props.running ? "Running" : "Run"}
        </button>
        <label className="lookback">
          <span>Lookback</span>
          <select
            value={props.settings.lookback}
            disabled={props.running}
            onChange={(event) => props.onLookback(event.target.value as Lookback)}
          >
            <option value="since">Since last run</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
          </select>
        </label>
      </div>

      {!props.running && !props.analysisBusy && props.disabledReason ? (
        <p className="hint">{props.disabledReason}</p>
      ) : null}
      {!props.running && !props.disabledReason && firstRun ? (
        <p className="hint">First run uses the last 7 days.</p>
      ) : null}

      {props.branchHint && props.analysis && !props.analysisBusy && !props.running ? (
        <div className="notice">
          <span>
            New commits on {props.analysis.defaultBranch} since the last analysis.
          </span>
          <button type="button" className="text" onClick={props.onReanalyze}>
            Re-analyze
          </button>
        </div>
      ) : null}

      {props.analysisBusy && props.analysisStatus ? (
        <div className="status" role="status" aria-live="polite">
          <div>{props.analysisStatus}</div>
        </div>
      ) : null}

      {props.status.length > 0 ? (
        <div className="status" role="log" aria-live="polite">
          {props.status.map((line, index) => (
            <div key={`${index}-${line}`}>{line}</div>
          ))}
        </div>
      ) : null}

      {props.error ? (
        <p className="error" role="alert">
          {props.error}
        </p>
      ) : null}

      {activeRun ? (
        <article className="digest">
          <div className="digest-meta">
            <span>
              {activeRun.date} · {activeRun.itemCount} item
              {activeRun.itemCount === 1 ? "" : "s"} · {formatUsd(activeRun.costUsd)}
            </span>
            <a
              href={obsidianHref(activeRun.vaultPath, activeRun.digestRel)}
              onClick={(event) => {
                event.preventDefault();
                props.onOpenObsidian(activeRun);
              }}
            >
              Open in Obsidian
            </a>
          </div>
          <Markdown markdown={activeRun.markdown} onOpenLink={props.onOpenUrl} />
        </article>
      ) : (
        <p className="empty">No digest yet.</p>
      )}

      {props.runs.length > 0 ? (
        <section className="past">
          <h2>Past digests</h2>
          <ul>
            {props.runs.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  className="pastrow"
                  aria-current={
                    activeRun?.id === run.id ? true : undefined
                  }
                  disabled={props.running}
                  onClick={() => props.onOpenPast(run.id)}
                >
                  <span>{formatRunDate(run.finishedAt)}</span>
                  <span>
                    {run.itemCount} item{run.itemCount === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

function obsidianHref(vaultPath: string, digestRel: string): string {
  const vaultName =
    vaultPath
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? "";
  const file = digestRel.replace(/\.md$/i, "").replace(/\\/g, "/");
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(file)}`;
}

function formatRunDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
