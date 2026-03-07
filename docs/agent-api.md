# Agent API & Hooks

Sulala’s agent runner exposes a session-based API and plugin hooks for multi-turn conversations with optional tool use (e.g. `run_task`).

## REST API

Base URL: gateway origin (e.g. `http://127.0.0.1:2026`). Optional auth: `X-Api-Key` or `?api_key=` when `GATEWAY_API_KEY` is set.

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| **GET** | `/api/agent/sessions` | List sessions (query: `limit`, default 50). Returns `{ sessions: [{ id, session_key, meta, created_at, updated_at }] }`. |
| **POST** | `/api/agent/sessions` | Create or get session. Body: `{ "session_key": "my-chat", "meta": {} }`. Returns session row. Same `session_key` returns existing session. |
| **GET** | `/api/agent/sessions/:id` | Get session and message history. Returns `{ id, session_key, meta, created_at, updated_at, messages: [{ role, content, tool_calls?, tool_call_id?, name?, created_at }] }`. |

### Messages (run agent turn)

| Method | Path | Description |
|--------|------|-------------|
| **POST** | `/api/agent/sessions/:id/messages` | Send a user message and run the agent turn (model may call tools; loop runs until no tool calls or max turns). Body: `{ "message", "system_prompt?", "provider?", "model?", "max_tokens?", "timeout_ms?", "use_pi?" }`. Pi coding-agent runtime is used by default when available; set `AGENT_USE_PI=0` or `use_pi: false` to use the default loop. Returns `{ sessionId, messages, finalContent, turnCount }`. |
| **POST** | `/api/agent/sessions/:id/messages/stream` | Same as above but streams the assistant reply. First event: `start` (data: `{ runId }`). Then: `assistant` (data: `{ delta }`), `tool_call` (data: `{ name, result? }`), `done` (data: `{ finalContent, turnCount }`), `error` (data: `{ message }`). All events are also broadcast on WebSocket as `{ type: 'agent_stream', runId, event, data }`. |
| **POST** | `/api/agent/run` | Start an agent run in the background. Body: `{ "session_id" or "session_key", "message", "system_prompt?", "provider?", "model?", "max_tokens?", "timeout_ms?" }`. Returns **202** `{ runId, sessionId }`. Stream events are broadcast only via WebSocket (`type: 'agent_stream'`, `runId`, `event`, `data`). |

### Behaviour

- **Per-session queue:** Only one turn runs per session at a time; further requests for the same session wait.
- **Timeout:** Set `AGENT_TIMEOUT_MS` in env or `timeout_ms` in the request body. When exceeded (or client disconnect), the run is aborted. Non-stream responds with **499**; stream sends an `error` event.
- **Models:** Use `provider` (e.g. `openai`, `openrouter`, `claude`, `gemini`, `ollama`) and optional `model`. See [models.md](models.md).
- **Context compaction:** `AGENT_MAX_HISTORY_MESSAGES` (max messages in context; older dropped). `AGENT_MAX_CONTEXT_TOKENS` (estimated token cap; oldest messages dropped until under).
- **Tool safety:** `AGENT_TOOL_ALLOWLIST` (comma-separated tool names; only these are available). `AGENT_TOOL_PROFILE`: `full` | `messaging` | `coding` | `minimal` (messaging = run_task only; coding = run_task, read_file, write_file, run_command; minimal = run_task).
- **Tool retry:** `AGENT_TOOL_RETRY_COUNT` (default 2); failed tool calls are retried with backoff before returning error to the model.
- **Tool flow:** For where tools come from, how the model uses them, and how they are executed (including hooks), see [tools.md](tools.md).
- **Pi path:** Pi coding-agent runtime is used by default when available. Set `AGENT_USE_PI=0` or body `use_pi: false` to use the default loop. If Pi is requested but optional deps are not installed, the gateway falls back to the default loop (no 503). See [tools.md](tools.md) §7.

### Models list

| Method | Path | Description |
|--------|------|-------------|
| **GET** | `/api/agent/models?provider=openrouter` | List models for OpenRouter (proxies OpenRouter API). Returns `{ models: [{ id, name }] }`. Other providers return `{ models: [] }`. |

---

## Skills

Skills are **documentation-only** and **dynamic**; there is no per-skill tool code.

### Locations and precedence

Skills load from: user (`~/.sulala/workspace/skills/<name>/README.md` or `SKILL.md`) > installed (workspace/hub) > workspace (`AGENT_CONTEXT_PATH`) > managed (`~/.sulala/skills`) > extra (`SKILLS_EXTRA_DIRS`). There are no built-in bundled skills; use the hub. User skills are safe from project updates.

### Add skills (non-manual)

**CLI:** `sulala skill list` | `sulala skill install <slug> [--global]` | `sulala skill update [--all]`  
**Dashboard:** Skills page → Add skill from registry, Update all  
**API:** `GET /api/agent/skills`, `GET /api/agent/skills/registry`, `POST /api/agent/skills/install` (body: `{ slug, target? }`), `POST /api/agent/skills/uninstall` (body: `{ slug, target? }`), `POST /api/agent/skills/publish` (body: `{ slug, priceIntent?, intendedPriceCents? }` — submits a user skill to the store), `POST /api/agent/skills/update`

**Config:** One JSON file (no DB). Path: `SULALA_CONFIG_PATH` > `.sulala/config.json` in cwd (if exists) > `~/.sulala/config.json`. Use `skills.entries.<name>.enabled: false` to disable a skill. See [config.md](config.md) for how the path is chosen and how read/write work (including using a config file in this project).  
**Registry:** `SKILLS_REGISTRY_URL` fetches registry from URL; skills with `url` in registry are fetched remotely.  
**Publish to store:** Dashboard “Publish to store” on My skills sends the skill to the store’s `POST /api/submissions`. Store URL is derived from `SKILLS_REGISTRY_URL` (same as the hub). No API key required by default; set `STORE_PUBLISH_API_KEY` in the agent .env if your store requires auth.  
**Watcher:** `SKILLS_WATCH=1` (default) watches skill dirs and emits `skills_changed` via WebSocket.

### Format

- **Load:** Context files under `AGENT_CONTEXT_PATH` (directory or file) are loaded at prompt-build time. `.md` files can have YAML frontmatter (`---` … `---`) with `name:` and `description:`.
- **Prompt:** The agent gets (1) a short **Available skills** list (name + description from frontmatter) so it knows when a skill applies, and (2) the full body of each skill doc. So the model sees “when to use” and “how to do it” from the same context.
- **Tools:** **Generic** tools: `run_task`; `read_file` / `write_file` (when `AGENT_WORKSPACE_ROOT` is set); `run_command`; `run_agent` (sub-agent in another session, one level only). Skills describe which commands to run; the agent follows the doc and calls these tools. No per-skill tool code—add skills by adding or editing `.md` files under the context path.

---

## Plugin hooks (agent)

Plugins in the `plugins/` directory can implement these optional hooks. They are invoked during `runAgentTurn` and `runAgentTurnStream`.

| Hook | Signature | When |
|------|-----------|------|
| **onAgentSessionStart** | `(sessionId: string) => void \| Promise<void>` | At the start of a turn, before loading history. |
| **onAgentSessionEnd** | `(sessionId: string) => void \| Promise<void>` | After the turn finishes (success or abort). |
| **onAgentBeforePromptBuild** | `(sessionId, context: { systemPrompt, messageCount }) => string \| void \| Promise<string \| void>` | Before building the prompt sent to the model. Return a string to override the system prompt. |
| **onAgentBeforeToolCall** | `(sessionId, toolName, args) => Record \| void \| Promise<Record \| void>` | Before executing a tool. Return modified `args` to override. |
| **onAgentAfterToolCall** | `(sessionId, toolName, args, result) => void \| Promise<void>` | After a tool execution. |
| **onAgentEnd** | `(sessionId, result: { finalContent, turnCount }) => void \| Promise<void>` | After the turn, with final assistant content and turn count. |

### System prompt order

1. Per-request `system_prompt` (body), else  
2. `AGENT_SYSTEM_PROMPT` from env, else  
3. Default: *"You are a helpful assistant. You have access to tools; use them when appropriate."*  
4. If `AGENT_CONTEXT_PATH` is set (file or directory), its contents (`.md`/`.txt` files in a directory) are appended under a "## Context" section.  
5. **onAgentBeforePromptBuild** can override the final system prompt (e.g. inject more context or skills).

### Example plugin (agent hooks)

```js
// plugins/my-agent/index.js
export default {
  async onAgentBeforePromptBuild(sessionId, context) {
    return context.systemPrompt + '\n\nYou are in session ' + sessionId + '.';
  },
  async onAgentAfterToolCall(sessionId, toolName, args, result) {
    console.log('Tool called', toolName, result);
  },
};
```

---

## Built-in tools

- **run_task** — Enqueues a background task. Params: `type` (string), `payload` (object, optional). Returns `{ taskId, type, status }`.
- **read_file** — Reads a file from the workspace (only registered when `AGENT_WORKSPACE_ROOT` is set). Params: `path` (string, relative to workspace root). Returns `{ path, content }` or `{ error }`. Paths outside the workspace are rejected.
- **run_command** — Run a single binary with args. Params: `binary` (string), `args` (array of strings). Skills are **docs only**: put markdown in `AGENT_CONTEXT_PATH` that describes which commands to run (e.g. memo for list/search, osascript for adding Apple Notes); the agent uses this single generic tool. No per-skill tool code—add new skills by adding or editing .md files.

See `src/agent/tools.ts` for the registry and how to add more tools.
