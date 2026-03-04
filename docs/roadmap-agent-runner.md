# Roadmap: Sulala Agent Runner

This doc outlines how to evolve Sulala Agent into a **powerful agent runner**: multi-turn conversations, tool use, sessions, and streaming.

## Target capabilities

| Capability | Target | Sulala today | Next step |
|------------|----------|--------------|-----------|
| **Agent loop** | Intake → context → model → **tools** → stream → persist | One-shot `/api/complete` | Session + turn loop with tool execution |
| **Sessions** | Per-session history, write lock, workspace | None | Session store + conversation history |
| **Tools** | Registry, execution, tool_calls round-trip | None | Tool registry + execute + inject results |
| **Streaming** | Assistant deltas, tool events, lifecycle | None | SSE or WS stream from agent run |
| **Hooks** | session_start/end, before_tool_call, agent_end, etc. | onFileEvent, onTask | Extend plugin API with agent hooks |
| **Queue/concurrency** | Per-session lane, global lane | Task queue (no session lanes) | Optional per-session serialization |
| **System prompt** | Bootstrap files, skills, workspace | None | Configurable system prompt + context |

## Implementation order

### Phase 1: Sessions + Tool registry + Agent loop (this PR)
- **Sessions:** DB tables `agent_sessions`, `agent_messages`; create/get session, append messages (role, content, tool_calls, tool_results).
- **Tools:** Tool type (name, description, parameters JSON Schema), registry, `execute(toolName, args)`. One built-in tool, e.g. `run_task` (enqueue a task).
- **Agent loop:** `runAgentTurn(sessionId, userMessage?)` → load history → build messages → `complete()` → if tool_calls: execute tools, append results, repeat (max_turns) → persist final message → return.
- **Gateway:** `POST /api/agent/sessions`, `GET /api/agent/sessions/:id`, `POST /api/agent/sessions/:id/messages` (body: `{ message }` → run turn, return full response).

### Phase 2: Streaming + lifecycle ✅
- **Done:** Stream assistant tokens via SSE; `completeStream()` in orchestrator (OpenAI); `runAgentTurnStream()` in agent loop; `POST /api/agent/sessions/:id/messages/stream` returns SSE events (`assistant`, `tool_call`, `done`, `error`). Dashboard chat uses stream when provider is OpenAI (deltas append in real time).
- Optional later: `POST /api/agent` returning `{ runId }` and WS subscription for stream.

### Phase 3: Hooks + system prompt ✅
- **Done:** Plugin hooks: `onAgentSessionStart`, `onAgentSessionEnd`, `onAgentBeforePromptBuild` (return new system prompt), `onAgentBeforeToolCall` (return modified args), `onAgentAfterToolCall`, `onAgentEnd`. Wired in both `runAgentTurn` and `runAgentTurnStream`.
- **Done:** Configurable system prompt: `AGENT_SYSTEM_PROMPT` in env; per-request `system_prompt` still overrides. Order: options.systemPrompt ?? config.agentSystemPrompt ?? DEFAULT_SYSTEM, then hooks can override via `onAgentBeforePromptBuild`.
- **Done:** Bootstrap/context: `AGENT_CONTEXT_PATH` (file or directory); `.md`/`.txt` contents are appended to the system prompt before hooks. See [docs/agent-api.md](agent-api.md).

### Phase 4: Concurrency + polish ✅
- **Done:** Per-session queue: `withSessionLock(sessionId, fn)` serializes agent runs per session (gateway wraps both `/messages` and `/messages/stream`).
- **Done:** Timeout: `AGENT_TIMEOUT_MS` in env; per-request `timeout_ms` in body. Run aborts when exceeded; effective signal combines timeout + client disconnect.
- **Done:** Cancel: `AbortSignal` from request (client close) and optional per-request signal; passed to `complete`/`completeStream` (OpenAI). AbortError returns 499 or stream `error` event.
- Optional later: compaction/retry.

### Phase 5: More tools + robustness ✅

- **Done:** **read_file** (workspace-scoped when `AGENT_WORKSPACE_ROOT` is set); **write_file** (same scope).
- **Done:** **run_command** (exec) when `ALLOW_SHELL_TOOL=1`, allowlist via `ALLOWED_BINARIES`.
- **Done:** **Tool safety:** `AGENT_TOOL_ALLOWLIST` (comma-separated names); `AGENT_TOOL_PROFILE` = `full` | `messaging` | `coding` | `minimal`. Filter applied at list and execute.
- **Done:** **Message compaction:** `AGENT_MAX_HISTORY_MESSAGES` (drop older messages); `AGENT_MAX_CONTEXT_TOKENS` (estimate ~4 chars/token, truncate from front).
- **Done:** **runId + WebSocket:** Stream endpoint sends `event: start` with `runId`; all events broadcast on WS as `{ type: 'agent_stream', runId, event, data }`. **POST /api/agent/run** accepts `session_id` or `session_key`, `message`, etc.; returns `202 { runId, sessionId }` and runs in background, streaming only via WS.
- **Done:** **run_agent** tool: `session_key`, `message`, optional `timeout_ms`; runs a sub-agent in a new or existing session (one level only; nested run_agent blocked).
- **Done:** **Retry:** `AGENT_TOOL_RETRY_COUNT` (default 2); failed tool calls retried with 500ms backoff before returning error to the model.

## Files to add/change

- `src/db/schema.sql` — add `agent_sessions`, `agent_messages`.
- `src/db/index.ts` — session/message CRUD.
- `src/agent/tools.ts` — tool type, registry, execute.
- `src/agent/loop.ts` — runAgentTurn (context build, complete, tool loop, persist).
- `src/gateway/server.ts` — `/api/agent/sessions`, `/api/agent/sessions/:id`, `/api/agent/sessions/:id/messages`.
- `docs/roadmap-agent-runner.md` — this file.
