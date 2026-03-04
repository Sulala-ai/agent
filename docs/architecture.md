# Architecture — Local AI orchestration

This document maps the Sulala Agent to the local AI orchestration design: gateway, file watcher, task engine, AI layer, plugins, and optional dashboard.

## Diagram reference

The project includes an architecture diagram that shows:

- **Sulala Gateway (127.0.0.1:2026)**  
  API Server (REST/WS) → Auth & Security → Task Scheduler (Cron/Queue) → AI Orchestration Engine → Plugin Manager

- **Inputs:** User devices, CLI, API clients, and **Watched Folders** (local files, docs, media, cloud-synced dirs).

- **File Watcher** → Event Trigger → **Task Queue** → **Worker Scripts** (which call AI Orchestration, Plugin Manager, Automation Scripts, and AI Providers).

- **Database (SQLite/PostgreSQL)** for Tasks, Logs, File States, AI Results.

- **AI Providers:** OpenAI, Claude, Llama, Custom AI.

- **Automation Scripts:** Python, Node.js, Bash, Workflows.

- **Plugin Manager:** AI models, Notion, Asana, Slack, X, GitHub, Custom APIs.

- **External Services:** Email, cloud storage, APIs, webhooks.

Sulala Agent implements the same **logical components**; the diagram is the single source of truth for how they connect.

---

## 1. Core architecture

### a. Local gateway / service

- **Role:** Single entry point on the user’s machine.
- **Implementation:** Node.js + Express (REST) + WebSocket server.
- **Behaviour:** Serves front-end and AI agents; all traffic stays on `127.0.0.1` unless explicitly configured otherwise.

### b. File / folder watcher

- **Role:** Real-time detection of file/folder changes.
- **Implementation:** `chokidar` (Node.js).
- **Behaviour:** Configurable watched roots (local, docs, media, cloud-sync paths). Events: add, change, unlink. Events feed into the **Event Trigger** and can update **File States** in the DB.

### c. Task scheduler / automation engine

- **Role:** Time-based and event-driven execution.
- **Implementation:** Cron-like scheduler + in-memory/persisted task queue (e.g. BullMQ or a simple queue with SQLite).
- **Behaviour:** Queue management to avoid conflicts; retries and failure handling; tasks and logs stored in DB.

### d. AI orchestration layer

- **Role:** One interface for multiple AI providers.
- **Implementation:** Adapter layer (OpenAI, Claude, Llama, custom HTTP).
- **Behaviour:** Route by capability or config; handle rate limits, retries, and logging; store **AI Results** in DB.

### e. Plugin / integration system

- **Role:** Third-party services and scripts hook into the platform.
- **Implementation:** Plugin directory + defined lifecycle (load, events, tasks).
- **Behaviour:** Plugins can subscribe to file events, scheduled tasks, or message queues; can call AI and external APIs.

### f. UI / dashboard (optional)

- **Role:** Monitor tasks, file sync, and AI actions; view logs.
- **Implementation:** Separate app (e.g. React or Vue) talking to the gateway via REST/WebSockets.

---

## 2. Security

- Gateway and workers bind to **localhost**; no public exposure by default.
- Credentials in `.env`; never in repo.
- Optional sandboxing for plugin and automation script execution.

---

## 3. Persistence

- **SQLite** by default (tasks, logs, file states, AI results).
- Schema and access live under `src/db/`. Optional migration path to PostgreSQL for multi-user.

---

## 4. Networking and sync

- File watcher can watch **local** and **cloud-synced** directories (e.g. Drive/Dropbox). Sync and conflict handling are the responsibility of the sync client; the watcher only reacts to changes.
- Cross-device can be added later (e.g. LAN sync or cloud APIs).

---

## 5. Stack summary

- **Languages:** Node.js (gateway, watcher, scheduler, queue, plugins), Python/Bash for heavy AI or automation scripts.
- **Libraries:** chokidar, Express, ws, better-sqlite3, AI SDKs per provider.
- **Containers:** Optional Docker for packaging.
- **Version control:** Git for app and user scripts/plugins.

---

## Optional advanced features

- AI-driven next actions based on prior results.
- Webhooks for external apps.
- Multi-user and permissions (with PostgreSQL or similar).

This architecture aligns the codebase with the diagram and written breakdown so we can implement and extend components consistently.
