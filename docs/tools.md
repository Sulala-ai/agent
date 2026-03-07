# Agent tools — where they come from and how they run

This document describes how tools are built, filtered, and executed in the Sulala agent: the same flow whether the trigger is chat (Gateway HTTP), streaming, scheduled jobs, **direct HTTP invoke**, or the `run_agent` sub-agent tool.

---

## 1. Where tools come from

Tools are built from three layers:

- **Core / built-in tools** — `registerBuiltInTools(enqueueTask)` in `agent/src/agent/tools.ts` registers core tools: `run_task`, `run_command`, `read_file` / `write_file` (when `AGENT_WORKSPACE_ROOT` is set), `run_agent`, and `list_mcp_servers`. Integration behavior (Gmail, Slack, GitHub, etc.) is **skill-driven** via run_command and MCP tools or skills with own OAuth; there are no dedicated provider tools. Optional tools are gated by config/env.
- **Plugin tools** — `getPluginTools(context)` in `agent/src/plugins/index.ts` calls each loaded plugin’s optional `tools?(context)` factory and merges the returned tools. Plugin tool names must not clash with core or other plugins. Plugins are loaded from the plugins directory; `tools()` is invoked at **list time** (when `listTools()` runs), not at plugin load time.
- **Policy** — Tools are filtered by **allowlist** (`config.agentToolAllowlist` / `AGENT_TOOL_ALLOWLIST`) and **profile** (`config.agentToolProfile` / `AGENT_TOOL_PROFILE`: `full` | `messaging` | `coding` | `minimal`) via `applyToolPolicyPipeline()`. Only the resulting list is exposed to the model and to `executeTool()`.

So for “all kinds of skill and work”: the same unified tool list (core + plugins, after policy) is what the model and the direct invoke API see.

### Tool registration and listing

- **Registration:** `registerTool(tool)` in `tools.ts` adds a `ToolDef` to an in-memory registry (keyed by `tool.name`). Used for core tools only.
- **Listing:** `listTools(options?)` merges registry tools with `getPluginTools(options?.pluginContext)`, then runs `applyToolPolicyPipeline(merged, { allowlist, profile })`. Defaults for allowlist/profile come from config.
- **Execution:** `executeTool(name, args, opts?)` resolves the tool from the **allowed** list (so plugin tools are found too), then runs `tool.execute(args, context)` where `context` includes `toolCallId` and `signal` when `opts` is provided.

### Tool execute signature

- `ToolDef.execute(args, context?)` — `context` is optional and has `toolCallId`, `signal`, and optional `onUpdate`. Long-running tools can respect `context.signal` for cancellation; the loop passes `toolCallId` and `signal` on every tool call.

---

## 2. How the model uses tools (normal “work”)

### Build tool list

For each agent turn:

- `listTools()` is called (optionally with `pluginContext: { sessionId }`). This returns core + plugin tools after policy.
- The result is mapped to the API shape: `{ name, description, parameters }` for each tool.

### Pass to AI

- `runAgentTurn()` and `runAgentTurnStream()` build `toolsForApi = listTools().map(...)` and pass it to `complete()` / `completeStream()` in the orchestrator.
- The orchestrator forwards `tools` to the provider in the provider’s expected format.

### Tool call loop

1. The model returns a response that may include `tool_calls`.
2. For each tool call, the loop:
   - Parses `tc.arguments` and runs **before_tool_call** hooks: `runAgentHooksBeforeToolCall(sessionId, tc.name, args)`.
   - Calls `executeToolWithRetry(...)` for each tool (no special-case short-circuits).
   - Calls `executeToolWithRetry(tc.name, args, { toolCallId: tc.id, signal })` → `executeTool(name, args, opts)` → `tool.execute(args, context)`.
   - Runs **after_tool_call** hooks: `runAgentHooksAfterToolCall(sessionId, tc.name, args, toolResult)`.
   - Appends a tool result message and persists it; then continues the loop.
3. The loop runs until the model returns no tool calls or `MAX_TOOL_TURNS` is reached.

So for any “work” the user asks for: **user message → system prompt (with skills/context) + tool list → model → tool_use → hooks (before) → executeTool(name, args, { toolCallId, signal }) → tool.execute(args, context) → hooks (after) → result back to model → next turn or reply.**

---

## 3. How skills affect tool use

- **Skills as instructions** — Skills are loaded and assembled into the system prompt via `loadContextFromPaths()` / `resolveSystemPrompt()`. The model uses the same tool list (core + plugins) according to the skill instructions.
- **No slash-command tool dispatch** — Sulala does not have slash commands or `command-dispatch: tool` that invokes a single tool by name without a model call. All tool use from chat goes through the model’s `tool_calls`.

---

## 4. Direct HTTP tool invocation

The gateway exposes **POST /api/tools/invoke** for automations or external callers.

- **Request:** `{ "tool": "<toolName>", "args": { ... } }`. Same auth as other API routes (e.g. `X-Api-Key` when `GATEWAY_API_KEY` is set).
- **Behaviour:** The server builds the same tool set via `listTools()`, finds the tool by name, and calls `executeTool(name, args)`. The same policy (allowlist + profile) applies; no session is required.
- **Response:** `{ "ok": true, "result": <tool return value> }` or `{ "error": "..." }` with an appropriate status code.

So the same tools and policy are used whether the call comes from the model, a scheduled job, or the HTTP invoke API.

---

## 5. Summary flow

| Trigger | Tool list source | Who calls tool.execute |
|--------|-------------------|-------------------------|
| User message (POST session messages) | `listTools()` in loop | Loop: before hook → `executeToolWithRetry(..., { toolCallId, signal })` → `executeTool` → after hook |
| User message (stream) | Same | Same (inside `runAgentTurnStream`) |
| Scheduled agent job / run_agent | Same | Same (same loop entry points) |
| **POST /api/tools/invoke** | `listTools()` in gateway | Gateway handler finds tool by name → `executeTool(name, args)` |

All execution goes through: **core + plugin tools → listTools() (policy) → … → executeTool(name, args, opts?) → tool.execute(args, context)**.

---

## 6. Main files involved

### Tool registration and creation

| File | Role |
|------|------|
| `agent/src/agent/tools.ts` | Registry, `registerTool` / `getTool` / `listTools` / `executeTool` / `applyToolPolicyPipeline`, `registerBuiltInTools`; merges plugin tools in `listTools()` |
| `agent/src/types.ts` | `ToolDef`, `ToolExecuteContext` (toolCallId, signal, onUpdate) |
| `agent/src/plugins/index.ts` | `Plugin.tools?(context)`, `getPluginTools(context)` — plugin tool factory |

### Policy

| File | Role |
|------|------|
| `agent/src/config.ts` | `agentToolAllowlist`, `agentToolProfile` (from env) |
| `agent/src/agent/tools.ts` | `applyToolPolicyPipeline()` (allowlist + profile); used inside `listTools()` |

### Agent run and tool wiring

| File | Role |
|------|------|
| `agent/src/agent/loop.ts` | `runAgentTurn`, `runAgentTurnStream`: `listTools()`, then for each tool call: before hook → `executeToolWithRetry(..., { toolCallId: tc.id, signal })` → after hook |
| `agent/src/ai/orchestrator.ts` | `complete`, `completeStream`: pass `tools` to provider adapters |

### System prompt and context (skills)

| File | Role |
|------|------|
| `agent/src/agent/loop.ts` | `loadContextFromPaths()`, `resolveSystemPrompt()`: skills/context into system prompt |

### Plugin hooks

| File | Role |
|------|------|
| `agent/src/plugins/index.ts` | `runAgentHooksBeforeToolCall`, `runAgentHooksAfterToolCall`; called from loop around each tool execution |

### Gateway

| File | Role |
|------|------|
| `agent/src/gateway/server.ts` | `POST /api/agent/sessions/:id/messages`, `POST /api/agent/sessions/:id/messages/stream`, `POST /api/agent/run`; **`POST /api/tools/invoke`** — direct tool execution (same listTools + executeTool) |

### Pi path (optional)

| File | Role |
|------|------|
| `agent/src/agent/pi-runner.ts` | `isPiAvailable()`, `runAgentTurnWithPi()`: Pi session, tool adapter, stream bridge to Sulala `complete()` |
| `agent/src/gateway/server.ts` | When `use_pi` or `config.agentUsePi`, call `runAgentTurnWithPi`; fall back to default loop if Pi not available |

### Startup

| File | Role |
|------|------|
| `agent/src/index.ts` | `registerBuiltInTools(enqueue)` at startup; plugins loaded via `loadAllPlugins()` |

---

## 7. Optional Pi (coding-agent) path

When **agentUsePi** is true (default; set env `AGENT_USE_PI=0` or body `use_pi: false` to disable) and Pi is available, the gateway runs the turn via the **Pi coding-agent** runtime. If Pi is requested but not installed, the gateway falls back to the default Sulala loop (no error).

- **Config:** `agentUsePi` (env `AGENT_USE_PI`, default true). **Request:** `POST /api/agent/sessions/:id/messages` with body `{ "message": "...", "use_pi": false }` to force the default loop.
- **Availability:** Pi requires optional dependencies: `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`. Install with `npm install` (optionalDependencies are installed by default; to skip them use `--omit=optional`). If Pi is requested but not available, the API returns **503** with a message to install the optional deps.
- **Flow:** `runAgentTurnWithPi()` in `agent/src/agent/pi-runner.ts` creates an in-memory Pi session, adapts Sulala tools to Pi `ToolDefinition`s, bridges the LLM call to Sulala’s `complete()` (orchestrator), runs `session.prompt(userMessage)`, then persists new messages back to the Sulala DB. The same tool list (core + plugins, after policy) is used; execution goes through Pi’s tool loop and our adapter.
- **Streaming:** The **stream** endpoint (`POST .../messages/stream`) always uses the default Sulala loop; Pi path is only used for non-stream `POST .../messages`.
- **API:** `GET /api/config` includes `agentUsePi` and `piAvailable` so the dashboard can show a Pi option.

---

## 8. Design summary

- **Layered tools** — Core (registry) + plugin tools (`Plugin.tools?()`), then policy (allowlist + profile).
- **Execute context** — `ToolDef.execute(args, context?)` with `toolCallId`, `signal`, `onUpdate`; the loop passes these so tools can respect abort and future streaming.
- **POST /api/tools/invoke** — Direct HTTP tool invocation with the same tool set and policy.
- **No Pi SDK** — Tools are plain `ToolDef`; no separate Pi `ToolDefinition` adapter or SDK session.
- **No slash-command dispatch** — All chat-driven tool use goes through the model.
- **Same hooks** — Before/after tool call hooks wrap each execution in the loop.

This gives a single, consistent path for “all kinds of skill and work”: **same tool list (core + plugins, after policy), same execution path (executeTool with optional context), whether the request comes from the dashboard, the REST API, POST /api/tools/invoke, or a scheduled job.**
