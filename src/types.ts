/** App config (env + config file) */
export interface Config {
  port: number;
  host: string;
  dbPath: string;
  watchFolders: string[];
  debug: boolean;
  gatewayApiKey: string | null;
  webhookUrls: string[];
  webhookSecret: string | null;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  /** Default system prompt for agent (env AGENT_SYSTEM_PROMPT). */
  agentSystemPrompt: string | null;
  /** Default agent run timeout in ms (env AGENT_TIMEOUT_MS). 0 = no timeout. */
  agentTimeoutMs: number;
  /** Optional path to file or directory; contents are appended to the agent system prompt (env AGENT_CONTEXT_PATH). */
  agentContextPath: string | null;
  /** If set, read_file tool can only read paths under this directory (env AGENT_WORKSPACE_ROOT). */
  agentWorkspaceRoot: string | null;
  /** Max messages to include in agent context; older messages are dropped (env AGENT_MAX_HISTORY_MESSAGES). 0 = no limit. */
  agentMaxHistoryMessages: number;
  /** Max estimated context tokens; older content truncated to stay under (env AGENT_MAX_CONTEXT_TOKENS). 0 = no limit. */
  agentMaxContextTokens: number;
  /** Optional allowlist of tool names; if set, only these tools are available (env AGENT_TOOL_ALLOWLIST, comma-separated). */
  agentToolAllowlist: string[] | null;
  /** Tool profile: full | messaging | coding | minimal (env AGENT_TOOL_PROFILE). */
  agentToolProfile: 'full' | 'messaging' | 'coding' | 'minimal';
  /** Retry failed tool calls up to this many times with backoff (env AGENT_TOOL_RETRY_COUNT). Default 2. */
  agentToolRetryCount: number;
  /** When true, high-risk tools (write_file, run_command, register_automation) require user approval before running (env AGENT_EXECUTION_PREVIEW=1). */
  agentExecutionPreview: boolean;
  /** Use Pi coding-agent runtime when true (env AGENT_USE_PI). Requires optional deps. Default false. */
  agentUsePi: boolean;
  /** Optional key for shared (cross-session) memory. When set, all sessions use this key for shared scope; when unset, session_key is used per identity (env AGENT_SHARED_MEMORY_KEY). */
  agentSharedMemoryKey: string | null;
  /** Integrations service URL (e.g. http://localhost:1717) for OAuth connections. When set, github_repos and other connection-backed tools are available. Ignored when portal gateway is set. */
  integrationsUrl: string | null;
  /** Portal gateway base URL (e.g. http://localhost:2026). When set with portalApiKey, agent uses Portal → API Keys for connections instead of INTEGRATIONS_URL. */
  portalGatewayUrl: string | null;
  /** Portal API key (from Portal → API Keys). Use with portalGatewayUrl. Sent as Authorization: Bearer <key>. */
  portalApiKey: string | null;
  /** Optional Discord bot token (env DISCORD_BOT_TOKEN). When set, discord_list_guilds, discord_list_channels, discord_send_message are available. */
  discordBotToken: string | null;
  /** Optional Stripe secret key (env STRIPE_SECRET_KEY). When set, stripe_* tools are available. Can override via Settings → Channels (Stripe). */
  stripeSecretKey: string | null;
  /** Bundled skills dir, e.g. <project>/context. */
  skillsBundledDir: string;
  /** Workspace root: ~/.sulala/workspace (env SULALA_WORKSPACE_DIR). Contains skills/, scripts/, .env, automations.json. Agent can write scripts and credentials here. */
  workspaceDir: string;
  /** Workspace skills dir: ~/.sulala/workspace/skills/<skill-name>/SKILL.md (env SULALA_WORKSPACE_SKILLS_DIR). User-created skills here are not overwritten by project updates. */
  skillsWorkspaceDir: string;
  /** Managed skills dir, e.g. ~/.sulala/skills (env SULALA_SKILLS_DIR). Flat .md files for registry installs. */
  skillsManagedDir: string;
  /** Extra skill dirs (env SKILLS_EXTRA_DIRS). */
  skillsExtraDirs: string[];
  /** Plugin skill dirs (plugins/name/skills). */
  skillsPluginDirs: string[];
  /** Watch skill dirs (env SKILLS_WATCH). */
  skillsWatch: boolean;
  /** Telegram channel: enable bot, token, DM policy. */
  telegram: {
    enabled: boolean;
    botToken: string | null;
    /** Who can DM the bot: "open" (anyone), "allowlist" (only allowFrom), "disabled". */
    dmPolicy: 'open' | 'allowlist' | 'disabled';
    /** Numeric Telegram user IDs allowed when dmPolicy is "allowlist". Comma-separated in env. */
    allowFrom: number[];
    /** Optional: AI provider for Telegram (e.g. "ollama"). Env: TELEGRAM_DEFAULT_PROVIDER. */
    defaultProvider?: string | null;
    /** Optional: AI model for Telegram (e.g. "llama3.2:1b"). Env: TELEGRAM_DEFAULT_MODEL. */
    defaultModel?: string | null;
  };
}

/** Task row from DB */
export interface TaskRow {
  id: string;
  type: string;
  payload: string | null;
  status: string;
  scheduled_at: number | null;
  started_at: number | null;
  finished_at: number | null;
  retry_count: number;
  max_retries: number;
  error: string | null;
  created_at: number;
  updated_at: number;
}

/** Insert task payload */
export interface InsertTaskPayload {
  id: string;
  type: string;
  payload?: unknown;
  scheduled_at?: number | null;
  max_retries?: number;
}

/** Tool call from model */
export interface ToolCallSpec {
  id: string;
  name: string;
  arguments: string;
}

/** AI adapter: one provider */
export interface AIAdapter {
  defaultModel: string;
  complete(opts: {
    model?: string;
    messages: Array<{ role: string; content?: string | null; tool_calls?: ToolCallSpec[]; tool_call_id?: string; name?: string }>;
    max_tokens?: number;
    tools?: Array<{ name: string; description: string; parameters?: Record<string, unknown> }>;
    signal?: AbortSignal;
    think?: boolean;
  }): Promise<{ content: string; usage?: Record<string, number>; tool_calls?: ToolCallSpec[] }>;
}

/** Complete options for orchestrator */
export interface CompleteOptions {
  provider?: string;
  model?: string;
  messages?: Array<{ role: string; content?: string | null; tool_calls?: ToolCallSpec[]; tool_call_id?: string; name?: string }>;
  max_tokens?: number;
  task_id?: string | null;
  tools?: Array<{ name: string; description: string; parameters?: Record<string, unknown> }>;
  signal?: AbortSignal;
  /** Enable reasoning trace for thinking-capable models (e.g. Ollama deepseek-r1, qwen3). */
  think?: boolean;
}

/** Ollama pull progress for UI */
export interface OllamaPullState {
  inProgress: boolean;
  model: string;
  lastLine: string;
  percent: number;
}

/** Express app with optional locals */
export interface AppLocals {
  wsBroadcast?: (data: unknown) => void;
  enqueueTaskId?: (id: string) => void;
  ollamaPullState?: OllamaPullState;
}

/** Agent session (DB row) */
export interface AgentSessionRow {
  id: string;
  session_key: string;
  meta: string | null;
  created_at: number;
  updated_at: number;
}

/** Agent message (DB row or in-memory) */
export interface AgentMessageRow {
  id?: number;
  session_id: string;
  role: string;
  content: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  name: string | null;
  created_at: number;
  usage?: string | null;
  cost_usd?: number | null;
}

/** Message format for AI / agent loop */
export interface AgentTurnMessage {
  role: string;
  content?: string | null;
  tool_calls?: Array<{ id: string; name: string; arguments: string }>;
  tool_call_id?: string;
  name?: string;
}

/** Context passed when executing a tool (abort signal, tool call id, session for memory). */
export interface ToolExecuteContext {
  /** Tool call id from the model (e.g. for logging or idempotency). */
  toolCallId?: string;
  /** Abort signal so long-running tools can respect cancellation. */
  signal?: AbortSignal;
  /** Optional callback for streaming partial results (future use). */
  onUpdate?: (chunk: unknown) => void;
  /** Session id (for memory tools: session-scoped and shared scope_key resolution). */
  sessionId?: string;
}

/** Tool definition for registry. execute may accept optional context (signal, toolCallId). */
export interface ToolDef {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute: (
    args: Record<string, unknown>,
    context?: ToolExecuteContext,
  ) => Promise<unknown> | unknown;
  /** Optional profile hint: which profile includes this tool (default 'full'). */
  profile?: 'full' | 'messaging' | 'coding' | 'minimal';
  /** If true, only available when explicitly allowed (e.g. plugin allowlist). */
  ownerOnly?: boolean;
}
