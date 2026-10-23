Radar turns a public GitHub repository into a competitor-complaint digest. Paste a repo, let it infer the product and 3–6 likely competitors from the README, docs, manifests, open issues and recent merged PRs, then run it on demand: Radar searches Exa or Brave plus Hacker News, or Hacker News alone with no key (limited coverage), extracts real complaints with a cheap model, clusters and scores them with a smart model, and writes one Markdown note into your Obsidian vault. It is BYOK, stores no telemetry, and never uses the Reddit API. Model choices are discovered from the configured LLM endpoint and selected from the returned list; the UI ships no preset model list.

## Development

Requirements: Node 20+, Rust stable, and the [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/) for your OS. Linux also needs a Secret Service provider such as GNOME Keyring or KWallet, plus libdbus development headers for `keyring`.

```sh
npm install
npm test
npm run tauri dev
```

Build a desktop bundle with `npm run tauri build`; `npm run build` type-checks and builds only the web frontend.

## Storage and security

- Keys and the optional GitHub token live in the OS credential store via `keyring` (Windows Credential Manager, macOS Keychain, Linux Secret Service), never in SQLite or config. Stronghold was the alternative; the OS keychain avoids a second master-password lock screen while keeping secrets outside the webview's files.
- SQLite (`radar.db`, Tauri app config dir) holds repo analyses with commit SHA, seen URLs, extracted items, themes, per-run scores and rendered digests. Prompt files live in the app data dir under `prompts/` and are reset individually from Settings.
- Digests are written only to `{vault}/Radar/`, using the folder granted by the native picker; `persisted-scope` restores that grant on later launches.
- No telemetry, logging of secrets, or provider response bodies in errors. Reddit content can only arrive as a search result.

## Capabilities

The capability file is intentionally small:

- `core:path:default` — app data and vault path helpers.
- `sql:default`, `sql:allow-execute` — local SQLite.
- `http:allow-fetch`, `http:allow-fetch-send` scoped to `api.github.com`, `hn.algolia.com`, `api.anthropic.com`, `api.openai.com`, `api.exa.ai`, `api.search.brave.com`; body/cancel commands are granted without extra origins. Redirects are scope-checked.
- `fs` read/write/mkdir/exists scoped to `$APPDATA/prompts`, plus `readDir` for the vault directory granted by the dialog plugin (restored by `persisted-scope`).
- `dialog:allow-open` — native folder picker only.
- `opener:allow-open-url` for `obsidian://`, `https://`, `http://` and `opener:allow-open-path` for the prompts folder.

A tiny Rust command, `allow_http_origin`, adds the configured OpenAI-compatible origin to the HTTP scope at runtime (HTTPS, or HTTP on localhost). It only grants fetch access for that origin; all pipeline and provider logic remains TypeScript.
