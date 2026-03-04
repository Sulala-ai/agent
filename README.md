# Sulala Agent — Local AI Orchestration Platform

A local-first platform that combines **file monitoring**, **task scheduling**, **AI orchestration**, and a **plugin system**. Runs on `127.0.0.1` and stays on your machine.

## Contents

- [Architecture](#architecture-high-level)
- [Quick start](#quick-start)
- [Desktop app (Mac & Windows)](#desktop-app-mac--windows)
- [Hub & integrations](#hub--integrations)
- [Requirements](#requirements)
- [Project layout](#project-layout)
- [Security](#security)

## Architecture (high level)

| Layer | Role |
|-------|------|
| **Gateway** | REST + WebSocket API on `localhost:2026`; auth and request handling |
| **File watcher** | Real-time folder watch (add/change/delete) → event triggers |
| **Task scheduler** | Cron-like scheduling + queue with retries and failure handling |
| **AI orchestration** | Single interface to multiple providers (OpenAI, OpenRouter, Claude, Gemini, Ollama); routing and rate limits |
| **Plugins** | Scripts and integrations that hook into events, tasks, and AI |
| **Persistence** | SQLite for tasks, file state, logs, and AI results |

See [docs/architecture.md](docs/architecture.md) and the project diagram for full layout.

## Quick start

**One-line install:**

- **macOS / Linux (curl + bash):**
  ```bash
  curl -fsSL https://sulala.ai/install.sh | bash
  ```
- **Windows (PowerShell):**
  ```powershell
  irm https://sulala.ai/install.ps1 | iex
  ```
  Optional version: `irm https://sulala.ai/install.ps1 | iex -Args '--version=0.1.8'`

This installs the CLI, runs onboarding, installs the background daemon, and starts the agent. Dashboard: http://127.0.0.1:2026

(Install scripts are hosted by the landing site; source: `landing/public/install.sh`, `landing/public/install.ps1`.)

**Or install from npm:**

```bash
npm i -g @sulala/agent
sulala onboard
sulala onboard --install-daemon
sulala start
```

Then open http://127.0.0.1:2026 (dashboard and API). **Default LLM is Ollama** (local, no API key). On first run, if Ollama is not installed, the app will start the official installer for your OS (Mac/Linux/Windows). You can optionally add API keys at http://127.0.0.1:2026/onboard to use OpenAI, Claude, Gemini, or OpenRouter instead.

**Or run from source (clone this repo):**

```bash
# Install dependencies
npm install

# Configure (copy and edit)
cp .env.example .env

# Run gateway + watcher + scheduler (TypeScript via tsx)
npm start
```

**Development:** `npm run dev` runs with `tsx watch` (restarts on file changes). Production: `npm run build` then `node dist/index.js`. Tests: `npm test`; lint: `npm run lint`.

**Dashboard (React + Vite + shadcn/ui):**

- **Dev:** `npm run dashboard` — UI on its own port (e.g. 5173); gateway on 2026. Set `VITE_GATEWAY_URL=http://127.0.0.1:2026` in `dashboard/.env` if needed.
- **Production:** `npm run dashboard:build` then `npm start` — gateway serves the built dashboard and API at http://127.0.0.1:2026.

**Testing locally (gateway + dashboard + onboarding):**

1. From `agent/`: `npm install` then `cp .env.example .env` (edit if needed).
2. Build the dashboard and start the agent:
   ```bash
   npm run dashboard:build && npm start
   ```
3. Open **http://127.0.0.1:2026** (dashboard) or **http://127.0.0.1:2026/onboard** (step-by-step onboarding).
4. To see onboarding again: `npm run cli -- onboard --reset`, then reload the page.
5. Optional — test install script from repo root: `bash landing/public/install.sh` (installs from npm; for a true “from source” test, use `npm link` in `agent/` and run the script).

**CLI** (from project root):

```bash
# Via npm script
npm run cli -- status
npm run cli -- tasks --limit=20
npm run cli -- logs --limit=50
npm run cli -- enqueue --type=heartbeat --payload='{"x":1}'

# Or install globally from npm: npm i -g @sulala/agent (then use sulala from any directory)
sulala status
sulala tasks --limit=20
sulala skill list
sulala skill install apple-notes [--global]
sulala skill update
sulala skill uninstall apple-notes [--global]
```

**Skill commands:**

- `sulala skill list` — list registry skills
- `sulala skill install <slug> [--global]` — install to workspace (default) or `~/.sulala/skills`
- `sulala skill update` — refresh installed skills from the registry
- `sulala skill uninstall <slug> [--global]` — remove a skill
- `sulala init [dir]` — create config/context/registry and copy `.env.example` → `.env`

**Onboard & daemon (global install):** Run `sulala onboard` to create `~/.sulala` and a default `.env`; the browser opens to **http://127.0.0.1:2026/onboard** to add API keys (saved to `~/.sulala/.env`). Run `sulala onboard --install-daemon` to install a background service (launchd on macOS, systemd on Linux) so the agent runs at login. Logs: `~/.sulala/logs/`. Use `sulala stop` / `sulala start` to stop or start the daemon; `sulala onboard --uninstall-daemon` to remove it.

**Works on any device:** The published package includes the default skills registry and bundled skills (`registry/`, `context/`), so `sulala skill list` and the agent work out of the box. Optionally set `SKILLS_REGISTRY_URL` for a remote skills store.

**Hub & integrations**

- **Skills hub:** [hub.sulala.ai](https://hub.sulala.ai) — upload skills for the agent and share them with others; install via `sulala skill list` / `sulala skill install` when using that registry.
- **Integrations:** Add more integrations (Gmail, Slack, GitHub, Calendar, etc.) for the agent; use the dashboard Integrations area or the integrations catalog to connect and manage them.
- **Portal (testing):** [portal.sulala.ai](https://portal.sulala.ai) — connect OAuth apps for testing (Gmail, Calendar, Slack, GitHub, etc.). Set `PORTAL_GATEWAY_URL` and `PORTAL_API_KEY` in the agent (e.g. in dashboard Settings → Portal) so it can list connections and get tokens. See [docs/sulalahub.md](docs/sulalahub.md) and `context/portal-integrations.md`.

**Env for CLI/gateway:** Set `GATEWAY_URL` and optionally `GATEWAY_API_KEY` for gateway commands; `SULALA_SKILLS_DIR` and `AGENT_CONTEXT_PATH` for skill paths.

**Agent runner:** Multi-turn sessions with optional tool use. See [docs/roadmap-agent-runner.md](docs/roadmap-agent-runner.md) and [docs/agent-api.md](docs/agent-api.md).

- `GET /api/agent/sessions` — list sessions (query: `limit`)
- `POST /api/agent/sessions` — create or get session (body: `{ "session_key": "my-chat", "meta": {} }`)
- `GET /api/agent/sessions/:id` — get session and message history
- `POST /api/agent/sessions/:id/messages` — send a message and run the agent turn (body: `{ "message": "…", "system_prompt": "…", "provider": "openai", "timeout_ms": 300000 }`). Returns `{ finalContent, messages, turnCount }`. Runs are serialized per session; client disconnect or timeout aborts the run (`AGENT_TIMEOUT_MS` in env or `timeout_ms` in body).

**AI models:** OpenAI, OpenRouter, Claude, Gemini, Ollama (local). See [docs/models.md](docs/models.md) for model IDs and env vars.

**Config:** Watched folders: `.env` (`WATCH_FOLDERS`) or `config/watched.json` (array `folders`); both are merged. Gateway auth: `GATEWAY_API_KEY`; webhooks: `WEBHOOK_URL` or `WEBHOOK_URLS` (optional `WEBHOOK_SECRET`). Default AI is **Ollama** (no key; installs automatically if missing). Override with `AI_DEFAULT_PROVIDER=openai` (or `claude`, `gemini`, `openrouter`) and set the corresponding API keys. Optional: `OLLAMA_BASE_URL`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`. See `.env.example` and [docs/config.md](docs/config.md).

**Docker:** Dashboard is served from the gateway.

```bash
docker compose up --build
```

Open http://localhost:2026. Mount `./config` for watched folders; data is in a named volume.

**Desktop app (Mac & Windows):** Installable app that runs the gateway and opens the dashboard in a window.

- **Run locally:** `npm run build && npm run dashboard:build && npm run desktop` — requires [Node.js](https://nodejs.org/) on your PATH (the app spawns the agent process).
- **Build installers:**  
  - Mac (DMG): `npm run desktop:pack:mac` → `desktop/release/*.dmg`  
  - Windows (NSIS + portable): `npm run desktop:pack:win` → `desktop/release/*.exe`  
  - Both: `npm run desktop:pack`
- Config and data use the same paths as the CLI (`~/.sulala`, etc.). The app window loads http://127.0.0.1:2026; closing the window stops the agent.

## Requirements

- **Node.js** 18+
- **TypeScript** + **tsx** (dev; in package.json)
- **Python 3.10+** (optional, for AI/automation scripts)
- SQLite (included via `better-sqlite3`)

## Project layout

Backend is TypeScript (`src/**/*.ts`); runs with `tsx` or compile with `tsc` to `dist/`.

```
sulala_agent/
├── src/
│   ├── gateway/      # API server (REST/WS), auth
│   ├── watcher/      # File/folder watcher (chokidar)
│   ├── scheduler/    # Cron + task queue
│   ├── ai/           # AI orchestration (multi-provider)
│   ├── plugins/      # Plugin loader and hooks
│   └── db/           # SQLite schema and access
├── desktop/          # Electron app (main.cjs, pack scripts) for Mac/Windows
├── scripts/          # User and plugin automation (Python/Node/Bash)
├── config/           # Watched folders, cron rules, plugin config
├── docs/
└── dashboard/        # Web UI (React + Vite + Tailwind + shadcn/ui)
```

## Security

- Services bind to `127.0.0.1` only (no internet exposure by default).
- Store API keys and secrets in `.env`; never commit them.
- Plugins and automation scripts can be sandboxed (e.g. run in subprocess with limited permissions).

## License

MIT
