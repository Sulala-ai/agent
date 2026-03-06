const GATEWAY_URL =
  import.meta.env.VITE_GATEWAY_URL ||
  (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:2026");

/** Optional: fetch hub registry from this URL (e.g. http://localhost:3002 for local store). If set, From Hub tab uses this; install requests pass it to the gateway. */
const HUB_REGISTRY_URL = (import.meta.env.VITE_SKILLS_REGISTRY_URL as string)?.trim?.() || null;
/** Integrations service (OAuth connections). Fallback when agent config does not provide integrationsUrl. */
const DEFAULT_INTEGRATIONS_URL = (import.meta.env.VITE_INTEGRATIONS_URL as string)?.trim?.() || "http://localhost:1717";
const API_KEY = import.meta.env.VITE_GATEWAY_API_KEY || "";

function headers(extra: HeadersInit = {}): HeadersInit {
  const h: HeadersInit = { "Content-Type": "application/json", ...extra };
  if (API_KEY) (h as Record<string, string>)["X-Api-Key"] = API_KEY;
  return h;
}

export type Task = {
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
};

export type Log = {
  id: number;
  source: string;
  level: string;
  message: string;
  meta: string | null;
  created_at: number;
};

export type FileState = {
  path: string;
  mtime_ms: number;
  size: number | null;
  hash: string | null;
  last_seen: number;
  meta: string | null;
};

export type Schedule = {
  id: string;
  name: string;
  description: string;
  cron_expression: string;
  task_type: string;
  payload: string | null;
  prompt: string | null;
  delivery: string | null;
  provider: string | null;
  model: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
};

export async function fetchSchedules(): Promise<{ schedules: Schedule[] }> {
  const res = await fetch(`${GATEWAY_URL}/api/schedules`, { headers: headers() });
  if (!res.ok) throw new Error(`Failed to fetch schedules: ${res.status}`);
  return res.json();
}

export async function createSchedule(body: {
  name?: string;
  description?: string;
  cron_expression: string;
  task_type?: string;
  payload?: unknown;
  prompt?: string;
  delivery?: { channel: string; target?: string }[];
  provider?: string | null;
  model?: string | null;
}): Promise<Schedule> {
  const res = await fetch(`${GATEWAY_URL}/api/schedules`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Create schedule failed: ${res.status}`);
  }
  return res.json();
}

export async function updateSchedule(
  id: string,
  body: {
    name?: string;
    description?: string;
    cron_expression?: string;
    task_type?: string;
    payload?: unknown;
    prompt?: string | null;
    delivery?: { channel: string; target?: string }[] | null;
    provider?: string | null;
    model?: string | null;
    enabled?: boolean;
  }
): Promise<Schedule> {
  const res = await fetch(`${GATEWAY_URL}/api/schedules/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Update schedule failed: ${res.status}`);
  }
  return res.json();
}

export async function deleteSchedule(id: string): Promise<void> {
  const res = await fetch(`${GATEWAY_URL}/api/schedules/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Delete schedule failed: ${res.status}`);
  }
}

export async function runScheduleJob(id: string): Promise<{ id: string; type: string; status: string }> {
  const res = await fetch(`${GATEWAY_URL}/api/schedules/${encodeURIComponent(id)}/run`, {
    method: "POST",
    headers: headers(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Run job failed: ${res.status}`);
  }
  return res.json();
}

export type ScheduleRun = {
  id: string;
  type: string;
  payload: string | null;
  status: string;
  scheduled_at: number | null;
  started_at: number | null;
  finished_at: number | null;
  retry_count: number;
  error: string | null;
  created_at: number;
  updated_at: number;
};

export type TelegramChannelState = {
  enabled: boolean;
  configured: boolean;
  dmPolicy: string;
  allowFrom: number[];
  status: "connected" | "not_configured" | "error";
  botUsername?: string | null;
  error?: string | null;
  defaultProvider?: string | null;
  defaultModel?: string | null;
};

export async function fetchChannelsTelegram(): Promise<TelegramChannelState> {
  const res = await fetch(`${GATEWAY_URL}/api/channels/telegram`, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Fetch Telegram channel failed: ${res.status}`);
  }
  return res.json();
}

export async function updateChannelsTelegram(body: {
  enabled: boolean;
  botToken?: string | null;
  dmPolicy: "open" | "allowlist" | "disabled";
  allowFrom: number[];
  defaultProvider?: string | null;
  defaultModel?: string | null;
}): Promise<TelegramChannelState> {
  const res = await fetch(`${GATEWAY_URL}/api/channels/telegram`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Update Telegram channel failed: ${res.status}`);
  }
  return res.json();
}

export type DiscordChannelState = { configured: boolean };

export async function fetchChannelsDiscord(): Promise<DiscordChannelState> {
  const res = await fetch(`${GATEWAY_URL}/api/channels/discord`, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Fetch Discord channel failed: ${res.status}`);
  }
  return res.json();
}

export async function updateChannelsDiscord(body: { botToken?: string | null }): Promise<DiscordChannelState> {
  const res = await fetch(`${GATEWAY_URL}/api/channels/discord`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Update Discord channel failed: ${res.status}`);
  }
  return res.json();
}

export type StripeChannelState = { configured: boolean };

export async function fetchChannelsStripe(): Promise<StripeChannelState> {
  const res = await fetch(`${GATEWAY_URL}/api/channels/stripe`, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Fetch Stripe channel failed: ${res.status}`);
  }
  return res.json();
}

export async function updateChannelsStripe(body: { secretKey?: string | null }): Promise<StripeChannelState> {
  const res = await fetch(`${GATEWAY_URL}/api/channels/stripe`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Update Stripe channel failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchScheduleRuns(
  id: string,
  limit = 30
): Promise<{ runs: ScheduleRun[] }> {
  const res = await fetch(
    `${GATEWAY_URL}/api/schedules/${encodeURIComponent(id)}/runs?limit=${limit}`,
    { headers: headers() }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Fetch runs failed: ${res.status}`);
  }
  return res.json();
}

export type OnboardStatus = { complete: boolean };
export async function fetchOnboardStatus(): Promise<OnboardStatus> {
  const res = await fetch(`${GATEWAY_URL}/api/onboard/status`, { headers: headers() });
  if (!res.ok) return { complete: false };
  return res.json();
}

export async function putOnboardComplete(): Promise<{ ok: boolean; complete: boolean }> {
  const res = await fetch(`${GATEWAY_URL}/api/onboard/complete`, {
    method: "PUT",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Failed to complete onboarding: ${res.status}`);
  return res.json();
}

export type OnboardEnvKeys = Record<string, "set" | "unset">;
export async function fetchOnboardEnv(): Promise<{ envPath?: string; keys: OnboardEnvKeys }> {
  const res = await fetch(`${GATEWAY_URL}/api/onboard/env`, { headers: headers() });
  if (!res.ok) return { keys: {} };
  return res.json();
}

export async function putOnboardEnv(body: Record<string, string>): Promise<{ ok: boolean; keys: OnboardEnvKeys }> {
  const res = await fetch(`${GATEWAY_URL}/api/onboard/env`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to save API keys: ${res.status}`);
  return res.json();
}

export type RecommendedOllamaModel = { id: string; name: string; size: string; ram: string; cpu: string; gpu: string; description: string };
export async function fetchRecommendedModels(): Promise<{ models: RecommendedOllamaModel[] }> {
  const res = await fetch(`${GATEWAY_URL}/api/onboard/recommended-models`, { headers: headers() });
  if (!res.ok) return { models: [] };
  return res.json();
}

export async function postOllamaPull(model: string): Promise<{ ok: boolean; model: string }> {
  const res = await fetch(`${GATEWAY_URL}/api/ollama/pull`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ model }),
  });
  if (!res.ok) throw new Error(`Failed to pull model: ${res.status}`);
  return res.json();
}

export async function fetchHealth(): Promise<{ status: string }> {
  const res = await fetch(`${GATEWAY_URL}/health`, { headers: headers() });
  if (!res.ok) throw new Error(`Gateway health check failed: ${res.status}`);
  return res.json();
}

export async function fetchTasks(limit = 50): Promise<{ tasks: Task[] }> {
  const res = await fetch(`${GATEWAY_URL}/api/tasks?limit=${limit}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Failed to fetch tasks: ${res.status}`);
  return res.json();
}

export async function fetchLogs(limit = 100): Promise<{ logs: Log[] }> {
  const res = await fetch(`${GATEWAY_URL}/api/logs?limit=${limit}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Failed to fetch logs: ${res.status}`);
  return res.json();
}

export async function fetchFileStates(
  limit = 200
): Promise<{ fileStates: FileState[] }> {
  const res = await fetch(
    `${GATEWAY_URL}/api/file-states?limit=${limit}`,
    { headers: headers() }
  );
  if (!res.ok) throw new Error(`Failed to fetch file states: ${res.status}`);
  return res.json();
}

export async function enqueueTask(body: {
  type: string;
  payload?: unknown;
  scheduled_at?: number | null;
}): Promise<{ id: string; type: string; status: string }> {
  const res = await fetch(`${GATEWAY_URL}/api/tasks`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to enqueue task: ${res.status}`);
  }
  return res.json();
}

export function wsUrl(): string {
  const base = new URL(GATEWAY_URL);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  return `${base.origin}/ws`;
}

export type Config = {
  watchFolders: string[];
  aiProviders: { id: string; label: string; defaultModel: string }[];
  /** From agent INTEGRATIONS_URL; dashboard uses this for Integrations page when set. */
  integrationsUrl?: string | null;
  /** 'portal' = agent uses Portal; 'direct' = agent uses INTEGRATIONS_URL; null = neither. */
  integrationsMode?: "portal" | "direct" | null;
  /** Portal base URL when integrationsMode === 'portal'. */
  portalGatewayUrl?: string | null;
  /** When true, agent has PORTAL_OAUTH_CLIENT_ID set; dashboard can show "Connect with Sulala (OAuth)". */
  portalOAuthConnectAvailable?: boolean;
  /** ChatGPT Apps SDK / MCP OAuth 2.1 config (onboarding and settings). */
  chatgptOAuth?: {
    enabled: boolean;
    resourceUrl: string | null;
    authorizationServer: string | null;
    scopesSupported: string[];
    redirectUrisHint: string[];
  };
};

export type AgentModel = { id: string; name: string };

export async function fetchAgentModels(provider: string): Promise<{ models: AgentModel[] }> {
  const res = await fetch(
    `${GATEWAY_URL}/api/agent/models?provider=${encodeURIComponent(provider)}`,
    { headers: headers() }
  );
  if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`);
  return res.json();
}

export type PendingAction = {
  id: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
};

export async function fetchPendingActions(sessionId?: string): Promise<{ pendingActions: PendingAction[] }> {
  const q = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
  const res = await fetch(`${GATEWAY_URL}/api/agent/pending-actions${q}`, { headers: headers() });
  if (!res.ok) throw new Error(`Failed to fetch pending actions: ${res.status}`);
  return res.json();
}

export async function approvePendingAction(id: string): Promise<{ ok: boolean; result?: unknown }> {
  const res = await fetch(`${GATEWAY_URL}/api/agent/pending-actions/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Failed to approve: ${res.status}`);
  return res.json();
}

export async function rejectPendingAction(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${GATEWAY_URL}/api/agent/pending-actions/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Failed to reject: ${res.status}`);
  return res.json();
}

// --- Integrations service (OAuth connections) ---

export type IntegrationConnection = {
  id: string;
  provider: string;
  scopes: string[];
  createdAt: number;
  updatedAt?: number;
};

export type IntegrationProviderMeta = { id: string; name: string; iconUrl: string };

/** One integration from GET /integrations: provider meta + connections (no merge needed). */
export type IntegrationItem = {
  id: string;
  name: string;
  iconUrl: string;
  description: string;
  connections: IntegrationConnection[];
  /** When true, app uses a bot/token in agent .env (e.g. Discord). No OAuth Connect. */
  tokenOnly?: boolean;
};

/** Base URL for integrations API. Prefer from agent config (fetchConfig().integrationsUrl) so agent .env is single source. */
function getIntegrationsBaseUrl(override?: string | null): string {
  return (override?.trim() || DEFAULT_INTEGRATIONS_URL).replace(/\/$/, "");
}

/** Fetch full integrations list (providers + connections). No merge needed. */
export async function fetchIntegrations(baseUrl?: string | null): Promise<{ integrations: IntegrationItem[] }> {
  const base = getIntegrationsBaseUrl(baseUrl);
  const res = await fetch(`${base}/integrations`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch integrations: ${res.status}`);
  const data = (await res.json()) as { integrations?: unknown[] };
  const raw = data.integrations ?? [];
  const integrations: IntegrationItem[] = raw.map((item: unknown) => {
    if (typeof item !== "object" || item === null || !("id" in item) || typeof (item as { id: string }).id !== "string") {
      return {
        id: "unknown",
        name: "Unknown",
        iconUrl: "",
        description: "",
        connections: [],
      };
    }
    const o = item as { id: string; name?: string; iconUrl?: string; description?: string; connections?: unknown[] };
    const conns = Array.isArray(o.connections)
      ? o.connections.map((c: unknown) => {
          const x = c as Record<string, unknown>;
          return {
            id: String(x?.id ?? ""),
            provider: String(x?.provider ?? ""),
            scopes: Array.isArray(x?.scopes) ? (x.scopes as string[]) : [],
            createdAt: Number(x?.createdAt ?? 0),
            updatedAt: x?.updatedAt != null ? Number(x.updatedAt) : undefined,
          };
        })
      : [];
    return {
      id: o.id,
      name: typeof o.name === "string" ? o.name : o.id,
      iconUrl: typeof o.iconUrl === "string" ? o.iconUrl : "",
      description: typeof o.description === "string" ? o.description : "",
      connections: conns,
    };
  });
  return { integrations };
}

export async function fetchIntegrationsProviders(baseUrl?: string | null): Promise<{
  providers: IntegrationProviderMeta[];
}> {
  const base = getIntegrationsBaseUrl(baseUrl);
  const res = await fetch(`${base}/providers`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch providers: ${res.status}`);
  const data = (await res.json()) as { providers?: unknown[] };
  const raw = data.providers ?? [];
  const providers: IntegrationProviderMeta[] = raw.map((p: unknown) => {
    if (typeof p === "object" && p !== null && "id" in p && typeof (p as { id: string }).id === "string") {
      const o = p as { id: string; name?: string; iconUrl?: string };
      return { id: o.id, name: typeof o.name === "string" ? o.name : o.id, iconUrl: typeof o.iconUrl === "string" ? o.iconUrl : "" };
    }
    const s = String(p);
    return { id: s, name: s, iconUrl: "" };
  });
  return { providers };
}

export async function fetchIntegrationsConnections(
  provider?: string,
  baseUrl?: string | null
): Promise<{ connections: IntegrationConnection[] }> {
  const base = getIntegrationsBaseUrl(baseUrl);
  const q = provider ? `?provider=${encodeURIComponent(provider)}` : "";
  const res = await fetch(`${base}/connections${q}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch connections: ${res.status}`);
  return res.json();
}

export async function startIntegrationsConnect(
  provider: string,
  redirectSuccess: string,
  baseUrl?: string | null
): Promise<{ authUrl: string; state: string; connectionId: string }> {
  const base = getIntegrationsBaseUrl(baseUrl);
  const res = await fetch(`${base}/connect/${encodeURIComponent(provider)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_success: redirectSuccess }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Connect failed: ${res.status}`);
  }
  return res.json();
}

export async function deleteIntegrationsConnection(id: string, baseUrl?: string | null): Promise<{ ok: boolean }> {
  const base = getIntegrationsBaseUrl(baseUrl);
  const res = await fetch(`${base}/connections/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to disconnect: ${res.status}`);
  return res.json();
}

export async function fetchConfig(): Promise<Config> {
  const res = await fetch(`${GATEWAY_URL}/api/config`, { headers: headers(), cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch config: ${res.status}`);
  return res.json();
}

/** MCP server entry (env values redacted as "***" when from GET). */
export type McpServerEntry = {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export async function fetchMcpConfig(): Promise<{ servers: McpServerEntry[] }> {
  const res = await fetch(`${GATEWAY_URL}/api/mcp/config`, { headers: headers(), cache: "no-store" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Failed to fetch MCP config: ${res.status}`);
  }
  return res.json();
}

export async function updateMcpConfig(servers: McpServerEntry[]): Promise<{ servers: McpServerEntry[] }> {
  const res = await fetch(`${GATEWAY_URL}/api/mcp/config`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({ servers }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Failed to save MCP config: ${res.status}`);
  }
  return res.json();
}

/** Get Portal "Connect with Sulala" OAuth URL. Redirect user to this URL to start the flow. Optional return_to (e.g. onboarding_step_3) is passed back after callback. */
export async function fetchOAuthConnectUrl(return_to?: string): Promise<{ url: string }> {
  const q = return_to?.trim() ? `?return_to=${encodeURIComponent(return_to.trim())}` : "";
  const res = await fetch(`${GATEWAY_URL}/api/oauth/connect-url${q}`, { headers: headers(), cache: "no-store" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Failed to get Connect URL: ${res.status}`);
  }
  return res.json();
}

/** Fetch connections from Portal via agent (when integrationsMode === "portal"). Agent uses PORTAL_API_KEY. */
export async function fetchPortalConnections(): Promise<{ connections: IntegrationConnection[] }> {
  const res = await fetch(`${GATEWAY_URL}/api/integrations/connections`, { headers: headers(), cache: "no-store" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Failed to fetch Portal connections: ${res.status}`);
  }
  const data = (await res.json()) as { connections?: IntegrationConnection[] };
  return { connections: data.connections ?? [] };
}

/** Start OAuth connect via Portal (agent proxies with API key). Use when integrationsMode === "portal". */
export async function startPortalConnect(
  provider: string,
  redirectSuccess: string
): Promise<{ authUrl: string; connectionId: string | null }> {
  const res = await fetch(`${GATEWAY_URL}/api/integrations/connect`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ provider, redirect_success: redirectSuccess }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Connect failed: ${res.status}`);
  }
  const data = (await res.json()) as { authUrl?: string; connectionId?: string | null };
  if (!data.authUrl) throw new Error("No authUrl from agent");
  return { authUrl: data.authUrl, connectionId: data.connectionId ?? null };
}

/** Disconnect via Portal (agent proxies with API key). Use when integrationsMode === "portal". */
export async function deletePortalConnection(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${GATEWAY_URL}/api/integrations/connections/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Disconnect failed: ${res.status}`);
  }
  return res.json();
}

export type JobDefault = { defaultProvider: string | null; defaultModel: string | null };
export async function fetchJobDefault(): Promise<JobDefault> {
  const res = await fetch(`${GATEWAY_URL}/api/settings/job-default`, { headers: headers() });
  if (!res.ok) throw new Error(`Failed to fetch job default: ${res.status}`);
  return res.json();
}
export async function updateJobDefault(body: {
  defaultProvider?: string | null;
  defaultModel?: string | null;
}): Promise<JobDefault> {
  const res = await fetch(`${GATEWAY_URL}/api/settings/job-default`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to update job default: ${res.status}`);
  return res.json();
}

export type OllamaStatus = { running: boolean; baseUrl?: string };
export async function fetchOllamaStatus(): Promise<OllamaStatus> {
  const res = await fetch(`${GATEWAY_URL}/api/ollama/status`, { headers: headers() });
  if (!res.ok) return { running: false };
  return res.json();
}

export type SystemCapabilities = {
  storageFreeBytes: number | null;
  isCloudOrContainer: boolean;
  cloudReason: string;
  ollamaSuitable: boolean;
  ollamaSuitableReason: string;
};
export async function fetchSystemCapabilities(): Promise<SystemCapabilities> {
  const res = await fetch(`${GATEWAY_URL}/api/system/capabilities`, { headers: headers() });
  if (!res.ok) return {
    storageFreeBytes: null,
    isCloudOrContainer: false,
    cloudReason: "",
    ollamaSuitable: true,
    ollamaSuitableReason: "Check unavailable",
  };
  return res.json();
}

export async function postOllamaInstall(): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(`${GATEWAY_URL}/api/ollama/install`, { method: "POST", headers: headers() });
  if (!res.ok) throw new Error(`Install failed: ${res.status}`);
  return res.json();
}

export type OllamaPullState = { inProgress: boolean; model: string; lastLine: string; percent: number };
export async function fetchOllamaPullStatus(): Promise<OllamaPullState> {
  const res = await fetch(`${GATEWAY_URL}/api/ollama/pull-status`, { headers: headers() });
  if (!res.ok) return { inProgress: false, model: "", lastLine: "", percent: 0 };
  return res.json();
}

export type CompleteMessage = { role: string; content: string };

export async function fetchComplete(body: {
  provider?: string;
  model?: string;
  messages: CompleteMessage[];
  max_tokens?: number;
}): Promise<{ id: string; content: string; usage?: unknown; meta?: unknown }> {
  const res = await fetch(`${GATEWAY_URL}/api/complete`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Completion failed: ${res.status}`);
  }
  return res.json();
}

export async function taskCancel(id: string): Promise<{ id: string; status: string }> {
  const res = await fetch(`${GATEWAY_URL}/api/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ action: "cancel" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Cancel failed: ${res.status}`);
  }
  return res.json();
}

export async function taskRetry(id: string): Promise<{ id: string; status: string }> {
  const res = await fetch(`${GATEWAY_URL}/api/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ action: "retry" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Retry failed: ${res.status}`);
  }
  return res.json();
}

// --- Agent runner (sessions + tools) ---

export type AgentSession = {
  id: string;
  session_key: string;
  meta: string | null;
  created_at: number;
  updated_at: number;
};

export type AgentSkillEntry = { enabled?: boolean; handle?: string; apiKey?: string; [key: string]: unknown };

export type AgentSkillsConfig = {
  entries?: Record<string, AgentSkillEntry>;
};

export async function fetchAgentSkillsConfig(): Promise<{
  skills: AgentSkillsConfig;
  configPath?: string;
}> {
  const res = await fetch(`${GATEWAY_URL}/api/agent/skills/config`, { headers: headers() });
  if (!res.ok) throw new Error(`Failed to fetch skills config: ${res.status}`);
  return res.json();
}

export async function fetchAgentSkillsConfigSave(
  config: AgentSkillsConfig
): Promise<{ skills: AgentSkillsConfig; configPath?: string }> {
  const res = await fetch(`${GATEWAY_URL}/api/agent/skills/config`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({ skills: config }),
  });
  if (!res.ok) throw new Error(`Failed to save skills config: ${res.status}`);
  return res.json();
}

export async function fetchAgentSkillConfigRemove(
  slug: string
): Promise<{ removed: string; skills: AgentSkillsConfig; configPath?: string }> {
  const res = await fetch(`${GATEWAY_URL}/api/agent/skills/config/remove`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ slug }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to remove skill config: ${res.status}`);
  }
  return res.json();
}

export type AgentSkill = {
  name: string;
  description: string;
  filePath: string;
  /** Filename without .md, used for install/uninstall. */
  slug?: string;
  status: "eligible" | "blocked" | "unknown";
  missing?: string[];
  /** Required env vars from skill metadata (e.g. BSKY_HANDLE, BSKY_APP_PASSWORD). Config stored by env key. */
  env?: string[];
  source?: "user" | "installed" | "workspace" | "managed" | "bundled" | "plugin" | "extra";
  category?: string;
  version?: string;
  tags?: string[];
};

export type AgentRegistrySkill = {
  slug: string;
  name: string;
  description: string;
  version?: string;
  category?: string;
  tags?: string[];
  priceCents?: number;
  /** Clerk user ID when skill was submitted by a creator. Omitted for legacy/synced skills. */
  creatorId?: string;
  /** Display name for creator, if provided by hub. */
  creatorName?: string;
};

export type SkillUpdateInfo = {
  slug: string;
  installedVersion?: string;
  registryVersion?: string;
  updateAvailable: boolean;
};

export async function fetchAgentSkillsUpdates(): Promise<{ updates: SkillUpdateInfo[] }> {
  const res = await fetch(`${GATEWAY_URL}/api/agent/skills/updates`, { headers: headers() });
  if (!res.ok) throw new Error(`Failed to fetch updates: ${res.status}`);
  return res.json();
}

/** Base URL for the hub (set VITE_SKILLS_REGISTRY_URL to domain only, e.g. https://hub.sulala.ai). */
export function getHubBaseUrl(): string | null {
  if (!HUB_REGISTRY_URL) return null;
  return HUB_REGISTRY_URL.replace(/\/$/, "");
}

/** URL to use for the hub registry. */
export function getHubRegistryUrl(): string | null {
  const base = getHubBaseUrl();
  return base ? `${base}/api/sulalahub/registry` : null;
}

/** URL for system skills registry (hub store). Used when installing system skills so gateway fetches from this registry. */
export function getHubSystemRegistryUrl(): string | null {
  const base = getHubBaseUrl();
  return base ? `${base}/api/sulalahub/system/registry` : null;
}

/** Install URL for a skill (use with `sulala skill install --from-url=URL`). */
export function getHubSkillContentUrl(slug: string): string | null {
  const base = getHubBaseUrl();
  if (!base) return null;
  return `${base}/api/sulalahub/skills/${slug}`;
}

export async function fetchAgentSkillsRegistry(): Promise<{ skills: AgentRegistrySkill[] }> {
  const hubUrl = getHubRegistryUrl();
  const url = hubUrl
    ? `${GATEWAY_URL}/api/agent/skills/registry?url=${encodeURIComponent(hubUrl)}`
    : `${GATEWAY_URL}/api/agent/skills/registry`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch registry: ${res.status}`);
  }
  return res.json();
}

/** Fetches system skills from the hub store (GET /api/sulalahub/system/registry). Used by Skills page "From Hub" tab to show system skills. */
export async function fetchAgentSkillsSystemRegistry(): Promise<{ skills: AgentRegistrySkill[] }> {
  const systemUrl = getHubSystemRegistryUrl();
  if (!systemUrl) return { skills: [] };
  const res = await fetch(systemUrl);
  if (!res.ok) throw new Error(`Failed to fetch system registry: ${res.status}`);
  return res.json();
}

export async function fetchAgentSkillsUpdate(): Promise<{
  updated: string[];
  failed: { slug: string; error: string }[];
}> {
  const res = await fetch(`${GATEWAY_URL}/api/agent/skills/update`, {
    method: "POST",
    headers: headers(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Update failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchAgentSkillUninstall(
  slug: string,
  target: "user" | "managed" | "workspace"
): Promise<{ uninstalled: string; path: string; target: string }> {
  const res = await fetch(`${GATEWAY_URL}/api/agent/skills/uninstall`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ slug, target }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Uninstall failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchAgentSkillInstall(
  slug: string,
  target: "managed" | "workspace",
  opts?: { registryUrl?: string; system?: boolean }
): Promise<{ installed: string; path: string; target: string }> {
  const body: { slug: string; target: string; registryUrl?: string } = { slug, target };
  const registryUrl =
    opts?.registryUrl ??
    (opts?.system ? getHubSystemRegistryUrl() : null) ??
    getHubRegistryUrl() ??
    undefined;
  if (registryUrl) body.registryUrl = registryUrl;
  const res = await fetch(`${GATEWAY_URL}/api/agent/skills/install`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Install failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchAgentSkills(): Promise<{ skills: AgentSkill[] }> {
  const res = await fetch(`${GATEWAY_URL}/api/agent/skills`, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch skills: ${res.status}`);
  }
  return res.json();
}

export type PublishSkillOptions = {
  priceIntent?: "free" | "paid";
  intendedPriceCents?: number;
};

export type PublishStatusItem = { slug: string; status: "pending" | "approved"; submittedAt?: string };

export async function fetchAgentSkillsPublishStatus(): Promise<{ submissions: PublishStatusItem[] }> {
  const res = await fetch(`${GATEWAY_URL}/api/agent/skills/publish-status`, { headers: headers() });
  const data = await res.json().catch(() => ({}));
  return { submissions: Array.isArray(data.submissions) ? data.submissions : [] };
}

export async function fetchAgentSkillPublish(
  slug: string,
  options?: PublishSkillOptions
): Promise<{ published: boolean; slug: string; id?: string; message: string }> {
  const res = await fetch(`${GATEWAY_URL}/api/agent/skills/publish`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      slug,
      priceIntent: options?.priceIntent ?? "free",
      intendedPriceCents: options?.intendedPriceCents,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Publish failed: ${res.status}`);
  }
  return data;
}

export type SkillWizardApp = { id: string; label: string; envHint: string };
export type SkillWizardTrigger = { id: string; label: string };
export type SkillSpec = {
  name: string;
  description: string;
  slug: string;
  frontmatter: string;
  body: string;
  requiredEnv: string[];
};

export async function fetchAgentSkillWizardApps(): Promise<{
  apps: SkillWizardApp[];
  triggers: SkillWizardTrigger[];
}> {
  const res = await fetch(`${GATEWAY_URL}/api/agent/skills/wizard-apps`, { headers: headers() });
  if (!res.ok) throw new Error(`Failed to fetch wizard options: ${res.status}`);
  return res.json();
}

export async function fetchAgentSkillGenerate(
  body: { goal?: string; app?: string; trigger?: string; write?: boolean }
): Promise<{ spec: SkillSpec; path?: string; slug?: string; written: boolean }> {
  const res = await fetch(`${GATEWAY_URL}/api/agent/skills/generate`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Generate failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchAgentSessions(limit = 50): Promise<{ sessions: AgentSession[] }> {
  const res = await fetch(
    `${GATEWAY_URL}/api/agent/sessions?limit=${encodeURIComponent(String(limit))}`,
    { headers: headers() }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to list sessions: ${res.status}`);
  }
  return res.json();
}

export async function fetchAgentSessionCreate(body?: {
  session_key?: string;
  meta?: Record<string, unknown>;
}): Promise<AgentSession> {
  const res = await fetch(`${GATEWAY_URL}/api/agent/sessions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to create session: ${res.status}`);
  }
  return res.json();
}

export type AgentMemoryScopeKeys = { session: string[]; shared: string[] };

export async function fetchAgentMemoryScopeKeys(): Promise<AgentMemoryScopeKeys> {
  const res = await fetch(`${GATEWAY_URL}/api/agent/memory/scope-keys`, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Failed to fetch memory scope keys: ${res.status}`);
  }
  return res.json();
}

export type AgentMemoryEntry = {
  id: number;
  scope: string;
  scope_key: string;
  content: string;
  created_at: number;
};

export async function fetchAgentMemory(params: {
  scope: "session" | "shared";
  scope_key: string;
  limit?: number;
}): Promise<{ entries: AgentMemoryEntry[] }> {
  const sp = new URLSearchParams();
  sp.set("scope", params.scope);
  sp.set("scope_key", params.scope_key);
  if (params.limit != null) sp.set("limit", String(params.limit));
  const res = await fetch(`${GATEWAY_URL}/api/agent/memory?${sp.toString()}`, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Failed to fetch memory: ${res.status}`);
  }
  return res.json();
}

export type AgentMessage = {
  role: string;
  content: string | null;
  /** Reasoning trace from thinking-capable models (e.g. Ollama deepseek-r1). */
  thinking?: string | null;
  tool_calls?: Array<{ id: string; name: string; arguments: string }>;
  tool_call_id?: string | null;
  name?: string | null;
  created_at?: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  cost_usd?: number | null;
};

export async function fetchAgentSession(
  id: string
): Promise<AgentSession & { messages: AgentMessage[] }> {
  const res = await fetch(`${GATEWAY_URL}/api/agent/sessions/${encodeURIComponent(id)}`, {
    headers: headers(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to load session: ${res.status}`);
  }
  return res.json();
}

export type AgentTurnResult = {
  sessionId: string;
  messages: { role: string; content?: string | null }[];
  finalContent: string;
  turnCount: number;
  pendingActionId?: string;
};

/** Upload a file for chat attachments (e.g. post to Facebook). Returns URL the agent can use. */
export async function fetchUploadFile(file: File): Promise<{ url: string; name: string }> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const dataUrl = r.result as string;
      const base64 = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
      resolve(base64);
    };
    r.onerror = () => reject(new Error("Failed to read file"));
    r.readAsDataURL(file);
  });
  const res = await fetch(`${GATEWAY_URL}/api/upload`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      filename: file.name,
      content_type: file.type,
      data: base64,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Upload failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchAgentSendMessage(
  sessionId: string,
  body: {
    message: string;
    system_prompt?: string;
    provider?: string;
    model?: string;
    max_tokens?: number;
    required_integrations?: string[];
    attachment_urls?: string[];
  }
): Promise<AgentTurnResult> {
  const url = `${GATEWAY_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as {
        error?: string;
        type?: string;
        missing?: string[];
      };
      if (res.status === 422 && err.type === "missing_integrations" && Array.isArray(err.missing)) {
        const e = new Error(err.error || "Missing required integrations") as Error & {
          missing?: string[];
        };
        e.missing = err.missing;
        throw e;
      }
      const msg = err.error || `Agent request failed: ${res.status}`;
      console.error("[chat] fetchAgentSendMessage failed:", res.status, url, msg);
      throw new Error(msg);
    }
    return res.json();
  } catch (e) {
    console.error("[chat] fetchAgentSendMessage fetch error:", url, e);
    throw e;
  }
}

/** Stream agent response via SSE. When continue is true, no user message is sent; the agent continues from the last tool result (e.g. after approve). */
export async function fetchAgentSendMessageStream(
  sessionId: string,
  body: {
    message?: string;
    continue?: boolean;
    system_prompt?: string;
    provider?: string;
    model?: string;
    max_tokens?: number;
    required_integrations?: string[];
    attachment_urls?: string[];
  },
  callbacks: {
    onDelta: (delta: string) => void;
    onThinking?: (delta: string) => void;
    onDone: (finalContent: string) => void;
    onPendingApproval?: (pendingActionId: string) => void;
    onError: (message: string) => void;
    onMissingIntegrations?: (missing: string[]) => void;
  }
): Promise<void> {
  const url = `${GATEWAY_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}/messages/stream`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error("[chat] fetchAgentSendMessageStream fetch error:", url, e);
    callbacks.onError(e instanceof Error ? e.message : "Fetch failed");
    return;
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: string;
      type?: string;
      missing?: string[];
    };
    if (
      res.status === 422 &&
      err.type === "missing_integrations" &&
      Array.isArray(err.missing)
    ) {
      callbacks.onMissingIntegrations?.(err.missing);
    }
    const msg = err.error || `Stream failed: ${res.status}`;
    console.error("[chat] fetchAgentSendMessageStream failed:", res.status, url, msg);
    callbacks.onError(msg);
    return;
  }
  const reader = res.body?.getReader();
  if (!reader) {
    callbacks.onError("No response body");
    return;
  }
  const dec = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
        else if (line.startsWith("data:") && currentEvent) {
          try {
            const data = JSON.parse(line.slice(5).trim()) as { delta?: string; finalContent?: string; message?: string; pendingActionId?: string };
            if (currentEvent === "assistant" && data.delta) callbacks.onDelta(data.delta);
            else if (currentEvent === "thinking" && data.delta) callbacks.onThinking?.(data.delta);
            else if (currentEvent === "done" && data.finalContent != null) callbacks.onDone(data.finalContent);
            else if (currentEvent === "pending_approval" && data.pendingActionId) callbacks.onPendingApproval?.(data.pendingActionId);
            else if (currentEvent === "error" && data.message) callbacks.onError(data.message);
          } catch {
            // ignore parse
          }
          currentEvent = "";
        }
      }
    }
    if (buffer.trim() && currentEvent && buffer.startsWith("data:")) {
      try {
        const data = JSON.parse(buffer.slice(5).trim());
        if (currentEvent === "done" && data.finalContent != null) callbacks.onDone(data.finalContent);
      } catch {
        // ignore
      }
    }
  } finally {
    reader.releaseLock();
  }
}
