/**
 * Loads tool definitions from context/<name>/tools.yaml and registers them with a generic executor.
 * Auth is driven by a registry (add one entry per auth method); YAML references auth by key.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve, basename } from 'path';
import { parse as parseYaml } from 'yaml';
import type { ToolDef } from '../../types.js';
import { getEffectiveStripeSecretKey } from '../../channels/stripe.js';
import { getEffectiveDiscordBotToken } from '../../channels/discord.js';
import { getPortalGatewayBase, getEffectivePortalApiKey, getGatewayBaseUrl } from '../../config.js';
import type { Config } from '../../types.js';

type AuthResult =
  | { headers: Record<string, string>; baseUrl?: string; label?: string; invalidKeyMessage?: string }
  | { error: string };

const AUTH_REGISTRY: Record<
  string,
  {
    getCredentials: () => { headers: Record<string, string>; baseUrl?: string } | null;
    notConfiguredMessage: string;
    label?: string;
    invalidKeyMessage?: string;
  }
> = {
  none: {
    getCredentials: () => ({ headers: {} }),
    notConfiguredMessage: '',
  },
  stripe_secret_key: {
    getCredentials: () => {
      const key = getEffectiveStripeSecretKey();
      return key?.trim() ? { headers: { Authorization: `Bearer ${key}` } } : null;
    },
    notConfiguredMessage:
      'Stripe is not configured. Add a secret key in Settings → Payment or set STRIPE_SECRET_KEY.',
    label: 'Stripe',
    invalidKeyMessage: 'Invalid Stripe secret key (unauthorized)',
  },
  discord_bot_token: {
    getCredentials: () => {
      const token = getEffectiveDiscordBotToken();
      return token?.trim() ? { headers: { Authorization: `Bot ${token}` } } : null;
    },
    notConfiguredMessage:
      'Discord is not configured. Add a bot token in Settings → Channels (Discord) or set DISCORD_BOT_TOKEN.',
    label: 'Discord',
  },
  portal: {
    getCredentials: () => {
      const base = getPortalGatewayBase();
      const key = getEffectivePortalApiKey();
      if (!base?.trim() || !key?.trim()) return null;
      return { headers: { Authorization: `Bearer ${key}` }, baseUrl: base.replace(/\/$/, '') };
    },
    notConfiguredMessage: 'Set PORTAL_GATEWAY_URL and PORTAL_API_KEY (from Portal → API Keys)',
  },
  gateway: {
    getCredentials: () => {
      const base = getGatewayBaseUrl();
      return { headers: {}, baseUrl: base.replace(/\/$/, '') };
    },
    notConfiguredMessage: '',
  },
};

interface ToolParamSpec {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  default?: unknown;
}

interface RequestSpec {
  method?: 'GET' | 'POST';
  url?: string;
  queryParams?: Record<string, string>;
  bodyType?: 'json' | 'form';
  bodyKeys?: string[];
  body?: Record<string, string>;
}

/** One step in a multi-step flow. url/body values can use {{argName}} or {{step0.id}} (from previous step response). */
interface StepSpec {
  method: 'GET' | 'POST';
  url: string;
  bodyType?: 'form' | 'json';
  /** Form/body param name -> value source: arg name or "{{step0.id}}" */
  body?: Record<string, string>;
  /** Nested JSON body with {{placeholders}}; use for complex bodies (e.g. Bluesky). */
  bodyTemplate?: Record<string, unknown>;
  /** Path in response JSON to expose as stepN for next steps (e.g. "id"). Omit to expose full response. */
  responsePath?: string;
  /** Only run this step when this arg is truthy (e.g. "finalize"). */
  when?: string;
  /** Optional headers for this step (values can use {{step0.accessToken}} etc.). Merged over auth headers. */
  headers?: Record<string, string>;
}

interface ResponseSpec {
  listPath?: string;
  rootIsArray?: boolean;
  itemKeys?: string[];
  outputKey?: string;
  countKey?: string;
  singleKeys?: string[];
}

interface ToolSpec {
  name: string;
  description: string;
  profile?: 'full' | 'messaging' | 'coding' | 'minimal';
  auth: string;
  request?: RequestSpec;
  /** Multi-step flow: run in order; each step can use {{step0.id}} etc. from previous responses. */
  steps?: StepSpec[];
  /** Compute missing args before steps: e.g. { amount_cents: "amount_dollars * 100" }. */
  transformArgs?: Record<string, string>;
  parameters?: ToolParamSpec[];
  response?: ResponseSpec;
  /** Extra keys to merge into final response (e.g. { ok: true, message: "..." }). */
  responseExtra?: Record<string, unknown>;
}

interface ToolsYaml {
  tools: ToolSpec[];
}

/** Whether an error looks like an API key / auth problem (401 or message text). */
function isApiKeyRelatedError(status?: number, errMsg?: string | null): boolean {
  if (status === 401) return true;
  if (!errMsg || typeof errMsg !== 'string') return false;
  const lower = errMsg.toLowerCase();
  return (
    /invalid|incorrect|missing|unauthorized|expired|invalid key|api key|api_key|authentication failed/i.test(lower)
  );
}

/** Append instruction to add or fix API key in the Skills page. */
function withSkillPageHint(message: string, skillSlug?: string): string {
  const hint = skillSlug
    ? ` Add or update the API key in the Skills page (Dashboard → Skills → ${skillSlug}).`
    : ` Add or update the API key in the Skills page (Dashboard → Skills).`;
  return message + hint;
}

function getAuth(authType: string | undefined): AuthResult {
  const key = (authType ?? 'none').trim() || 'none';
  const entry = AUTH_REGISTRY[key];
  if (!entry) return { error: `Unknown auth type: ${authType ?? 'undefined'}` };
  const creds = entry.getCredentials();
  if (!creds) return { error: entry.notConfiguredMessage };
  return {
    ...creds,
    label: entry.label,
    invalidKeyMessage: entry.invalidKeyMessage,
  };
}

function buildUrl(urlTemplate: string, args: Record<string, unknown>): string {
  let url = urlTemplate;
  const re = /\{\{(\w+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(urlTemplate)) !== null) {
    const key = m[1];
    const val = args[key];
    const str = typeof val === 'string' ? val.trim() : val != null ? String(val) : '';
    url = url.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), encodeURIComponent(str));
  }
  return url;
}

function applyQueryParams(
  urlStr: string,
  queryParams: Record<string, string> | undefined,
  args: Record<string, unknown>,
): string {
  if (!queryParams || Object.keys(queryParams).length === 0) return urlStr;
  const url = new URL(urlStr);
  for (const [paramName, argName] of Object.entries(queryParams)) {
    const val = args[argName];
    if (val === undefined || val === null || val === '') continue;
    url.searchParams.set(paramName, typeof val === 'number' ? String(val) : String(val).trim());
  }
  return url.toString();
}

function specToParameters(spec: ToolSpec): Record<string, unknown> {
  const properties: Record<string, { type: string; description?: string }> = {};
  const required: string[] = [];
  for (const p of spec.parameters ?? []) {
    properties[p.name] = {
      type: p.type === 'number' ? 'number' : 'string',
      description: p.description,
    };
    if (p.required) required.push(p.name);
  }
  return {
    type: 'object',
    properties: Object.keys(properties).length ? properties : {},
    required,
  };
}

function applyDefaults(args: Record<string, unknown>, spec: ToolSpec): Record<string, unknown> {
  const out = { ...args };
  for (const p of spec.parameters ?? []) {
    if (p.default !== undefined && (out[p.name] === undefined || out[p.name] === null)) {
      out[p.name] = p.default;
    }
  }
  return out;
}

function clampLimit(value: unknown, defaultVal: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultVal;
  return Math.min(Math.max(1, Math.floor(value)), max);
}

function normalizeList(
  data: unknown,
  listPath: string | undefined,
  rootIsArray: boolean | undefined,
  itemKeys: string[] | undefined,
): unknown[] {
  let arr: unknown[];
  if (rootIsArray && Array.isArray(data)) {
    arr = data;
  } else if (listPath && typeof data === 'object' && data !== null && listPath in data) {
    const v = (data as Record<string, unknown>)[listPath];
    arr = Array.isArray(v) ? v : [];
  } else {
    return [];
  }
  if (!itemKeys?.length) return arr;
  return arr.map((item) => {
    if (typeof item !== 'object' || item === null) return item;
    const o = item as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of itemKeys) {
      if (k in o) out[k] = o[k];
    }
    return out;
  });
}

function normalizeSingle(
  data: unknown,
  singleKeys: string[] | undefined,
): Record<string, unknown> {
  if (typeof data !== 'object' || data === null) return {};
  const o = data as Record<string, unknown>;
  if (!singleKeys?.length) return o;
  const out: Record<string, unknown> = {};
  for (const k of singleKeys) {
    if (k in o) out[k] = o[k];
  }
  return out;
}

/** Get value from object by path "step0.id" or "step0". */
function getPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Replace {{x}}, {{step0.id}}, {{$now}} in string. scope = args + optional base; stepContext = { step0, step1, ... }. */
function interpolate(
  str: string,
  scope: Record<string, unknown>,
  stepContext: Record<string, unknown>,
): string {
  return str.replace(/\{\{(\$now|[^}]+)\}\}/g, (_, key) => {
    const k = key.trim();
    if (k === '$now') return new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');
    if (k.startsWith('step') && k.includes('.')) {
      const val = getPath(stepContext, k);
      return val != null ? String(val) : '';
    }
    if (k.startsWith('step') && k in stepContext) return String(stepContext[k] ?? '');
    return String(scope[k] ?? '');
  });
}

/** Recursively replace {{...}} placeholders in object/array/string. */
function interpolateDeep(
  val: unknown,
  scope: Record<string, unknown>,
  stepContext: Record<string, unknown>,
): unknown {
  if (typeof val === 'string') return interpolate(val, scope, stepContext);
  if (Array.isArray(val)) return val.map((v) => interpolateDeep(v, scope, stepContext));
  if (val && typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) out[k] = interpolateDeep(v, scope, stepContext);
    return out;
  }
  return val;
}

/** Apply transformArgs: e.g. amount_cents = amount_dollars * 100 when amount_cents missing. */
function applyTransformArgs(
  args: Record<string, unknown>,
  transformArgs: Record<string, string> | undefined,
): Record<string, unknown> {
  if (!transformArgs || Object.keys(transformArgs).length === 0) return args;
  const out = { ...args };
  for (const [target, expr] of Object.entries(transformArgs)) {
    if (out[target] !== undefined && out[target] !== null) continue;
    if (expr === 'amount_dollars * 100') {
      const d = Number((out.amount_dollars as number));
      if (Number.isFinite(d)) out[target] = Math.round(d * 100);
    }
  }
  return out;
}

async function executeSteps(
  spec: ToolSpec,
  args: Record<string, unknown>,
  skillSlug?: string,
): Promise<unknown> {
  for (const p of spec.parameters ?? []) {
    if (p.required) {
      const val = args[p.name];
      if (val === undefined || val === null || (typeof val === 'string' && !val.trim())) {
        return { error: `${p.name} is required` };
      }
    }
  }
  const auth = getAuth(spec.auth);
  if ('error' in auth) return { error: auth.error };

  let scope = applyDefaults(args, spec);
  scope = applyTransformArgs(scope, spec.transformArgs);

  if (auth.baseUrl) scope = { ...scope, base: auth.baseUrl };

  const stepContext: Record<string, unknown> = {};
  const headers: Record<string, string> = { ...auth.headers };
  let lastResponse: unknown = null;

  for (let i = 0; i < (spec.steps ?? []).length; i++) {
    const step = spec.steps![i];
    if (step.when) {
      const v = scope[step.when];
      if (v === false || v === 'false' || v === '' || v == null) continue;
    }

    const url = interpolate(step.url, scope, stepContext);
    const init: RequestInit = { method: step.method, headers: { ...headers } };
    if (step.headers && Object.keys(step.headers).length > 0) {
      for (const [k, v] of Object.entries(step.headers)) {
        const resolved = interpolate(v, scope, stepContext);
        if (resolved) (init.headers as Record<string, string>)[k] = resolved;
      }
    }

    if (step.method === 'POST') {
      if (step.bodyType === 'form') {
        init.headers = { ...init.headers, 'Content-Type': 'application/x-www-form-urlencoded' };
        if (step.body && Object.keys(step.body).length > 0) {
          const params: Record<string, string> = {};
          for (const [paramName, valueSource] of Object.entries(step.body)) {
            const resolved = interpolate(valueSource.startsWith('{{') ? valueSource : `{{${valueSource}}}`, scope, stepContext);
            if (resolved !== '' && resolved !== 'undefined') params[paramName] = resolved;
          }
          init.body = new URLSearchParams(params).toString();
        } else {
          init.body = '';
        }
      } else if ((step.bodyType === 'json' && step.bodyTemplate) || step.bodyTemplate) {
        const body = interpolateDeep(step.bodyTemplate, scope, stepContext) as object;
        init.headers = { ...init.headers, 'Content-Type': 'application/json' };
        init.body = JSON.stringify(body);
      }
    }

    try {
      const res = await fetch(url, init as RequestInit);
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text && text.trim() ? JSON.parse(text) : {};
      } catch (parseErr) {
        if (!res.ok) {
          return { error: `Step ${i + 1}: ${res.status}`, detail: text.slice(0, 300) };
        }
        return { error: (parseErr as Error).message, detail: text.slice(0, 300) };
      }

      if (!res.ok) {
        if (res.status === 401 && auth.invalidKeyMessage)
          return { error: withSkillPageHint(auth.invalidKeyMessage, skillSlug) };
        const stepErr = `Step ${i + 1}: ${res.status}`;
        return {
          error: isApiKeyRelatedError(res.status, stepErr) ? withSkillPageHint(stepErr, skillSlug) : stepErr,
          detail: text.slice(0, 200),
        };
      }

      const errMsg = typeof json === 'object' && json !== null && (json as Record<string, unknown>).error
        ? (typeof (json as Record<string, unknown>).error === 'object'
          ? (json as Record<string, unknown>).error && (json as Record<string, unknown>).error !== null && typeof ((json as Record<string, unknown>).error as Record<string, unknown>).message === 'string'
            ? ((json as Record<string, unknown>).error as Record<string, unknown>).message
            : 'API error'
          : String((json as Record<string, unknown>).error))
        : null;
      if (errMsg) {
        const errStr = typeof errMsg === 'string' ? errMsg : String(errMsg);
        return {
          error: isApiKeyRelatedError(undefined, errStr) ? withSkillPageHint(errStr, skillSlug) : errStr,
        };
      }

      lastResponse = json;
      const stepKey = `step${i}`;
      if (step.responsePath && typeof json === 'object' && json !== null) {
        stepContext[stepKey] = getPath(json as Record<string, unknown>, step.responsePath);
      } else {
        stepContext[stepKey] = json;
      }
    } catch (e) {
      const msg = (e as Error).message;
      return {
        error: isApiKeyRelatedError(undefined, msg) ? withSkillPageHint(msg, skillSlug) : msg,
      };
    }
  }

  const resp = spec.response;
  if (!resp && !spec.responseExtra) return lastResponse;
  let out: Record<string, unknown> = {};
  if (resp?.singleKeys?.length && typeof lastResponse === 'object' && lastResponse !== null) {
    const single = normalizeSingle(lastResponse, resp.singleKeys);
    if (resp.outputKey) out[resp.outputKey] = single;
    else out = single;
  } else if (lastResponse != null && typeof lastResponse === 'object') {
    out = { ...(lastResponse as Record<string, unknown>) };
  }
  if (spec.responseExtra) {
    for (const [k, v] of Object.entries(spec.responseExtra)) {
      out[k] = typeof v === 'string' && v.includes('{{') ? interpolate(v, scope, stepContext) : v;
    }
  }
  return Object.keys(out).length ? out : lastResponse;
}

function createExecutor(spec: ToolSpec, skillSlug?: string): ToolDef['execute'] {
  if (spec.steps?.length) {
    return (args) => executeSteps(spec, args as Record<string, unknown>, skillSlug);
  }

  return async (args: Record<string, unknown>) => {
    for (const p of spec.parameters ?? []) {
      if (p.required) {
        const val = args[p.name];
        if (val === undefined || val === null || (typeof val === 'string' && !val.trim())) {
          return { error: `${p.name} is required` };
        }
      }
    }

    const auth = getAuth(spec.auth);
    if ('error' in auth)
      return {
        error: isApiKeyRelatedError(undefined, auth.error) ? withSkillPageHint(auth.error, skillSlug) : auth.error,
      };

    const request = spec.request!;
    if (!request.url) return { error: 'Tool spec missing request.url' };

    let argsWithDefaults = applyDefaults(args, spec);
    if (spec.parameters) {
      for (const p of spec.parameters) {
        if (p.name === 'limit' && request.queryParams?.limit) {
          argsWithDefaults = {
            ...argsWithDefaults,
            limit: clampLimit(argsWithDefaults.limit, 10, 100),
          };
        }
      }
    }

    let url = buildUrl(request.url, argsWithDefaults);
    url = applyQueryParams(url, request.queryParams, argsWithDefaults);

    const init: RequestInit = {
      method: request.method ?? 'GET',
      headers: { ...auth.headers },
    };

    if (spec.name === 'discord_send_message') {
      const content = argsWithDefaults.content;
      if (typeof content === 'string' && content.length > 2000) {
        argsWithDefaults = { ...argsWithDefaults, content: content.slice(0, 2000) };
      }
    }

    if (request.method === 'POST' && request.bodyType === 'json' && request.bodyKeys?.length) {
      const body: Record<string, unknown> = {};
      for (const k of request.bodyKeys) {
        if (argsWithDefaults[k] !== undefined) body[k] = argsWithDefaults[k];
      }
      init.headers = { ...init.headers, 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    if (request.method === 'POST' && request.bodyType === 'form' && request.body && Object.keys(request.body).length > 0) {
      const params = new URLSearchParams();
      for (const [paramName, argName] of Object.entries(request.body)) {
        const v = argsWithDefaults[argName];
        if (v !== undefined && v !== null && v !== '') params.set(paramName, String(v).trim());
      }
      init.headers = { ...init.headers, 'Content-Type': 'application/x-www-form-urlencoded' };
      init.body = params.toString();
    }

    try {
      const res = await fetch(url, init);

      if (!res.ok) {
        if (res.status === 401 && auth.invalidKeyMessage)
          return { error: withSkillPageHint(auth.invalidKeyMessage, skillSlug) };
        const text = await res.text();
        const label = auth.label ?? 'API';
        const statusErr = `${label} API: ${res.status}`;
        return {
          error: isApiKeyRelatedError(res.status, statusErr) ? withSkillPageHint(statusErr, skillSlug) : statusErr,
          detail: text.slice(0, 200),
        };
      }

      const text = typeof (res as { text?: () => Promise<string> }).text === 'function'
        ? await (res as { text: () => Promise<string> }).text()
        : '';
      let json: unknown;
      try {
        json = (text ?? '').trim() ? JSON.parse(text) : {};
      } catch (e) {
        const msg = (e as Error).message;
        return {
          error: isApiKeyRelatedError(undefined, msg) ? withSkillPageHint(msg, skillSlug) : msg,
          detail: (text || msg).slice(0, 300),
        };
      }

      const apiError =
        typeof json === 'object' && json !== null && (json as Record<string, unknown>).error != null
          ? String((json as Record<string, unknown>).error)
          : null;
      if (apiError && isApiKeyRelatedError(undefined, apiError))
        return { error: withSkillPageHint(apiError, skillSlug) };
      if (apiError) return { error: apiError };

      const resp = spec.response;
      if (!resp) return json;

      if (resp.listPath !== undefined || resp.rootIsArray) {
        const list = normalizeList(json, resp.listPath, resp.rootIsArray, resp.itemKeys);
        const outputKey = resp.outputKey ?? 'data';
        const countKey = resp.countKey ?? 'count';
        return { [outputKey]: list, [countKey]: list.length };
      }

      if (resp.singleKeys?.length) {
        const single = normalizeSingle(json, resp.singleKeys);
        const outputKey = resp.outputKey;
        if (outputKey === 'message_id' && single.id != null) {
          return { ok: true, message_id: single.id };
        }
        if (outputKey) return { [outputKey]: single };
        return single;
      }

      return json;
    } catch (e) {
      return { error: (e as Error).message };
    }
  };
}

function loadToolsYaml(dir: string): ToolSpec[] {
  const toolsPath = join(dir, 'tools.yaml');
  if (!existsSync(toolsPath)) return [];
  try {
    const raw = readFileSync(toolsPath, 'utf8');
    const parsed = parseYaml(raw) as ToolsYaml;
    if (!parsed?.tools || !Array.isArray(parsed.tools)) return [];
    return parsed.tools;
  } catch {
    return [];
  }
}

/** Resolve context paths for tools.yaml: workspace skills (hub installs), agentContextPath/bundled, managed, then extra dirs. */
function getContextDirs(config: Config): string[] {
  const cwd = process.cwd();
  const dirs: string[] = [];
  if (config.skillsWorkspaceDir?.trim()) {
    dirs.push(config.skillsWorkspaceDir.trim());
  }
  if (config.skillsWorkspaceMyDir?.trim()) {
    dirs.push(config.skillsWorkspaceMyDir.trim());
  }
  if (config.agentContextPath?.trim()) {
    dirs.push(resolve(cwd, config.agentContextPath.trim()));
  } else if (config.skillsBundledDir?.trim()) {
    dirs.push(config.skillsBundledDir.trim());
  }
  if (config.skillsManagedDir?.trim()) {
    dirs.push(config.skillsManagedDir.trim());
  }
  for (const p of config.skillsExtraDirs ?? []) {
    const s = typeof p === 'string' ? p.trim() : '';
    if (s) dirs.push(resolve(cwd, s));
  }
  return dirs;
}

/**
 * Scan context dirs for subdirs that contain tools.yaml, load specs, and register one tool per spec.
 * Returns the list of tool names that were registered (for later unregister on skills refresh).
 */
export function registerSpecTools(
  registerTool: (tool: ToolDef) => void,
  config: Config,
): string[] {
  const registered: string[] = [];
  const contextDirs = getContextDirs(config);
  for (const base of contextDirs) {
    if (!existsSync(base) || !statSync(base).isDirectory()) continue;
    const subdirs = readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => join(base, d.name));
    for (const dir of subdirs) {
      const skillSlug = basename(dir);
      const specs = loadToolsYaml(dir);
      for (const spec of specs) {
        if (!spec.name || !spec.description) continue;
        if (!spec.steps?.length && !spec.request?.url) continue;
        registered.push(spec.name);
        registerTool({
          name: spec.name,
          description: spec.description,
          profile: spec.profile ?? 'full',
          parameters: specToParameters(spec),
          execute: createExecutor(spec, skillSlug),
        });
      }
    }
  }
  return registered;
}
