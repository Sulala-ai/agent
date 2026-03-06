import { log, saveAiResult, getChannelConfig } from '../db/index.js';
import { getSulalaEnvKey } from '../config.js';
import type { AIAdapter, CompleteOptions } from '../types.js';

const providers = new Map<string, AIAdapter>();

/** Resolve default provider: Settings job default → AI_DEFAULT_PROVIDER → OpenRouter/OpenAI if key set. Never returns Ollama unless user chose it. */
function getDefaultProvider(): string | null {
  try {
    const raw = getChannelConfig('job_default');
    if (raw?.trim()) {
      const o = JSON.parse(raw) as { defaultProvider?: string };
      if (o.defaultProvider?.trim()) return o.defaultProvider.trim();
    }
  } catch {
    // ignore
  }
  const env = (process.env.AI_DEFAULT_PROVIDER || '').trim();
  if (env) return env;
  if ((getSulalaEnvKey('OPENROUTER_API_KEY') || '').trim()) return 'openrouter';
  if ((getSulalaEnvKey('OPENAI_API_KEY') || '').trim()) return 'openai';
  return null;
}

export function registerProvider(name: string, adapter: AIAdapter): void {
  providers.set(name, adapter);
}

export function getProvider(name?: string | null): AIAdapter {
  const key = name ?? getDefaultProvider();
  if (!key) {
    throw new Error(
      'No AI provider configured. Set Job default in Settings → AI Providers, or set AI_DEFAULT_PROVIDER and add OPENROUTER_API_KEY or OPENAI_API_KEY.'
    );
  }
  const p = providers.get(key);
  if (!p) throw new Error(`Unknown AI provider: ${key}. Registered: ${[...providers.keys()].join(', ')}`);
  return p;
}

/** Format messages as a single prompt for the v1/completions endpoint (non-chat models). */
function messagesToPrompt(
  messages: Array<{ role: string; content?: string | null }>
): string {
  return (messages ?? [])
    .map((m) => {
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
      const role = m.role === 'system' ? 'System' : m.role === 'assistant' ? 'Assistant' : 'User';
      return `${role}:\n${text}`;
    })
    .join('\n\n');
}

function isNotChatModelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('not a chat model') ||
    msg.includes('v1/completions') ||
    msg.includes('chat/completions')
  );
}

export type StreamChunkEvent =
  | { type: 'delta'; content: string }
  | { type: 'thinking'; delta: string }
  | { type: 'finish'; content: string; tool_calls?: Array<{ id: string; name: string; arguments: string }>; usage?: Record<string, number> };

/** Stream completion (OpenAI, OpenRouter, Ollama). Falls back to non-streaming for other providers. */
export async function completeStream(
  options: CompleteOptions,
  onChunk: (ev: StreamChunkEvent) => void
): Promise<{ content: string; tool_calls?: Array<{ id: string; name: string; arguments: string }>; usage?: Record<string, number> }> {
  const provider = options.provider ?? getDefaultProvider();
  if (!provider) {
    throw new Error(
      'No AI provider configured. Set Job default in Settings → AI Providers, or set AI_DEFAULT_PROVIDER and add OPENROUTER_API_KEY or OPENAI_API_KEY.'
    );
  }
  const messages = options.messages ?? [];
  const model = options.model;
  const max_tokens = options.max_tokens ?? 1024;
  const tools = options.tools;
  if (provider === 'ollama' || provider === 'llama') {
    // Tool calling: use non-streaming so tool_calls.arguments are complete (streaming can truncate and cause JSON.parse errors).
    if (tools?.length) {
      const result = await complete({ ...options, provider, messages, model, max_tokens, tools, signal: options.signal });
      onChunk({ type: 'finish', content: result.content ?? '', tool_calls: result.tool_calls, usage: result.usage });
      return { content: result.content ?? '', tool_calls: result.tool_calls, usage: result.usage };
    }
    const think = options.think !== false && ollamaSupportsThinking(model);
    const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const OLLAMA_DEFAULT = process.env.AI_OLLAMA_DEFAULT_MODEL || 'llama3.2';
    const url = `${OLLAMA_BASE}/api/chat`;
    const ollamaMessages = toOllamaMessages(messages);
    const body: Record<string, unknown> = {
      model: model || OLLAMA_DEFAULT,
      messages: ollamaMessages,
      stream: true,
      think,
      options: { num_predict: max_tokens || 1024 },
    };
    if (tools?.length) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters ?? {} },
      }));
    }
    let res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (!res.ok) {
      const errText = await res.text();
      let didRetryStream = false;
      if (res.status === 400 && errText.includes('does not support tools') && body.tools) {
        delete body.tools;
        console.log('[Ollama] Model does not support tools; retrying without tools');
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: options.signal,
        });
        didRetryStream = true;
      }
      if (!res.ok) {
        const retryErrText = didRetryStream ? await res.text() : errText;
        if (res.status === 404 && (retryErrText.includes('not found') || retryErrText.includes('model'))) {
          const { pullOllamaModel } = await import('../ollama-setup.js');
          pullOllamaModel(model || OLLAMA_DEFAULT);
          throw new Error(`Model "${model || OLLAMA_DEFAULT}" not found. Pulling now; try again in 1–2 min.`);
        }
        throw new Error(`Ollama: ${res.status} ${retryErrText}`);
      }
    }
    const reader = res.body?.getReader();
    if (!reader) {
      const result = await complete({ ...options, provider, messages, model, max_tokens, tools, signal: options.signal });
      onChunk({ type: 'finish', content: result.content ?? '', tool_calls: result.tool_calls, usage: result.usage });
      return { content: result.content ?? '', tool_calls: result.tool_calls, usage: result.usage };
    }
    const dec = new TextDecoder();
    let buffer = '';
    let content = '';
    let usage: Record<string, number> | undefined;
    let tool_calls: Array<{ id: string; name: string; arguments: string }> | undefined;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line) as {
              message?: { content?: string; thinking?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }> };
              done?: boolean;
              eval_count?: number;
            };
            if (obj.message?.thinking) {
              onChunk({ type: 'thinking', delta: obj.message.thinking });
            }
            if (obj.message?.content) {
              content += obj.message.content;
              onChunk({ type: 'delta', content: obj.message.content });
            }
            if (obj.message?.tool_calls?.length) {
              tool_calls = fromOllamaToolCalls(obj.message.tool_calls);
            }
            if (obj.done) {
              if (obj.eval_count != null) usage = { completion_tokens: obj.eval_count };
            }
          } catch {
            // skip malformed line
          }
        }
      }
      if (buffer.trim()) {
        try {
          const obj = JSON.parse(buffer) as {
            message?: { content?: string; thinking?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }> };
            done?: boolean;
            eval_count?: number;
          };
          if (obj.message?.thinking) onChunk({ type: 'thinking', delta: obj.message.thinking });
          if (obj.message?.content) {
            content += obj.message.content;
            onChunk({ type: 'delta', content: obj.message.content });
          }
          if (obj.message?.tool_calls?.length) tool_calls = fromOllamaToolCalls(obj.message.tool_calls);
          if (obj.done && obj.eval_count != null) usage = { completion_tokens: obj.eval_count };
        } catch {
          // ignore
        }
      }
    } finally {
      reader.releaseLock();
    }
    onChunk({ type: 'finish', content, tool_calls, usage });
    return { content, tool_calls, usage };
  }

  const streamFactory = provider === 'openai' ? openAiStreamClient : provider === 'openrouter' ? openRouterStreamClient : null;
  const streamDefaultModel = provider === 'openai' ? OPENAI_DEFAULT : provider === 'openrouter' ? OPENROUTER_DEFAULT : '';
  const envKeyName = provider === 'openai' ? 'OPENAI_API_KEY' : provider === 'openrouter' ? 'OPENROUTER_API_KEY' : '';
  const rawKey = envKeyName ? getSulalaEnvKey(envKeyName) : undefined;
  const apiKey = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (!streamFactory || !streamDefaultModel || !('_create' in streamFactory)) {
    const result = await complete({ ...options, provider, messages, model, max_tokens, tools, signal: options.signal });
    onChunk({ type: 'finish', content: result.content ?? '', tool_calls: result.tool_calls, usage: result.usage });
    return { content: result.content ?? '', tool_calls: result.tool_calls, usage: result.usage };
  }
  if (!apiKey) {
    throw new Error(
      `${envKeyName} not set. Add it in Settings or ~/.sulala/.env and try again.`
    );
  }

  // Tool calling: use non-streaming so tool_calls.arguments are complete JSON (streaming can truncate and cause JSON.parse errors).
  if (tools?.length) {
    const result = await complete({ ...options, provider, messages, model, max_tokens, tools, signal: options.signal });
    onChunk({ type: 'finish', content: result.content ?? '', tool_calls: result.tool_calls, usage: result.usage });
    return { content: result.content ?? '', tool_calls: result.tool_calls, usage: result.usage };
  }

  const streamClient = (streamFactory as OpenAiStreamClientFactory)._create(apiKey);
  const openAiMessages = messages.map((m) => {
    if (!m.tool_calls?.length) return m;
    return {
      ...m,
      tool_calls: m.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments ?? '' },
      })),
    };
  });
  const createOpts: Record<string, unknown> = {
    model: model || streamDefaultModel,
    messages: openAiMessages,
    max_completion_tokens: max_tokens,
    stream: true,
  };
  if (tools?.length) {
    createOpts.tools = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters ?? {} },
    }));
  }

  const createOptions = options.signal ? { signal: options.signal } : {};
  let stream: AsyncIterable<{
    choices?: { delta?: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string }[];
    usage?: Record<string, number>;
  }>;
  try {
    stream = await (streamClient.chat.completions.create as (opts: unknown, opts2?: { signal?: AbortSignal }) => Promise<AsyncIterable<unknown>>)(createOpts, createOptions) as AsyncIterable<{
      choices?: { delta?: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string }[];
      usage?: Record<string, number>;
    }>;
  } catch (streamErr) {
    const status = (streamErr as { status?: number }).status;
    if (status === 401) {
      const keyName = provider === 'openai' ? 'OPENAI_API_KEY' : provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'API key';
      throw new Error(`${keyName} invalid or missing. Check Settings or ~/.sulala/.env and try again.`);
    }
    const useCompletionsFallback =
      provider === 'openrouter' &&
      (isNotChatModelError(streamErr) || status === 404 || (status === 400 && isNotChatModelError(streamErr)));
    if (useCompletionsFallback) {
      const result = await complete({ ...options, provider, messages, model, max_tokens, tools, signal: options.signal });
      onChunk({ type: 'finish', content: result.content ?? '', tool_calls: result.tool_calls, usage: result.usage });
      return { content: result.content ?? '', tool_calls: result.tool_calls, usage: result.usage };
    }
    throw streamErr;
  }
  let content = '';
  const toolCallByIndex: Record<number, { id: string; name: string; arguments: string }> = {};
  let usage: Record<string, number> | undefined;

  for await (const chunk of stream) {
    const choice = chunk.choices?.[0];
    const delta = choice?.delta;
    if ((chunk as { usage?: Record<string, number> }).usage) usage = (chunk as { usage: Record<string, number> }).usage;
    if (delta?.content) {
      content += delta.content;
      onChunk({ type: 'delta', content: delta.content });
    }
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index;
        if (!toolCallByIndex[idx]) toolCallByIndex[idx] = { id: tc.id ?? `tc_${idx}`, name: '', arguments: '' };
        if (tc.id) toolCallByIndex[idx].id = tc.id;
        if (tc.function?.name) toolCallByIndex[idx].name += tc.function.name;
        if (tc.function?.arguments) toolCallByIndex[idx].arguments += tc.function.arguments;
      }
    }
  }
  const orderedToolCalls = Object.keys(toolCallByIndex)
    .map(Number)
    .sort((a, b) => a - b)
    .map((i) => toolCallByIndex[i]);
  onChunk({ type: 'finish', content, tool_calls: orderedToolCalls.length ? orderedToolCalls : undefined, usage });
  return { content, tool_calls: orderedToolCalls.length ? orderedToolCalls : undefined, usage };
}

type OpenAiStreamClient = { chat: { completions: { create(opts: unknown): Promise<AsyncIterable<unknown>> } } };
type OpenAiStreamClientFactory = { _create: (apiKey: string) => OpenAiStreamClient };
let openAiStreamClient: OpenAiStreamClient | OpenAiStreamClientFactory | null = null;
let openRouterStreamClient: OpenAiStreamClient | OpenAiStreamClientFactory | null = null;

export async function complete(options: CompleteOptions = {}): Promise<{
  id: string;
  content: string;
  usage?: Record<string, number>;
  meta?: Record<string, unknown>;
  tool_calls?: Array<{ id: string; name: string; arguments: string }>;
}> {
  const {
    provider: optionProvider,
    model,
    messages,
    max_tokens = 1024,
    task_id = null,
    tools,
    signal,
  } = options;
  const provider = optionProvider ?? getDefaultProvider();
  if (!provider) {
    throw new Error(
      'No AI provider configured. Set Job default in Settings → AI Providers, or set AI_DEFAULT_PROVIDER and add OPENROUTER_API_KEY or OPENAI_API_KEY.'
    );
  }
  const start = Date.now();
  const adapter = getProvider(provider);
  const id = `ai_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  let result;
  try {
    result = await adapter.complete({ model, messages: messages ?? [], max_tokens, tools, signal });
  } catch (err) {
    const errObj = err as { status?: number; error?: unknown; message?: string };
    const detail =
      errObj?.status && errObj?.error != null
        ? `${errObj.status} ${typeof errObj.error === 'object' && errObj.error && 'message' in errObj.error ? (errObj.error as { message?: string }).message : JSON.stringify(errObj.error)}`
        : err instanceof Error ? err.message : String(err);
    log('ai', 'error', `Completion failed: ${detail}`, {
      provider,
      model: model || adapter.defaultModel,
      status: errObj?.status,
      stack: err instanceof Error ? err.stack : undefined,
    });
    throw err;
  }
  const meta = { provider, model, latency_ms: Date.now() - start };
  saveAiResult({
    id,
    provider,
    model: model || adapter.defaultModel,
    task_id,
    request_meta: { messages_count: messages?.length },
    response_meta: meta,
  });
  log('ai', 'info', 'Completion done', meta);
  return { id, ...result, meta };
}

function stubAdapter(defaultModel = 'stub'): AIAdapter {
  return {
    defaultModel,
    async complete({ messages }) {
      const last = messages?.[messages.length - 1];
      const content = typeof last?.content === 'string' ? last.content : '';
      return {
        content: `[stub] You said: ${content.slice(0, 80)}...`,
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      };
    },
  };
}

const OLLAMA_DEFAULT = process.env.AI_OLLAMA_DEFAULT_MODEL || 'llama3.2';
const OLLAMA_THINKING_MODELS = ['deepseek-r1', 'qwen3', 'deepseek-v3.1', 'gpt-oss'];
function ollamaSupportsThinking(model: string | undefined): boolean {
  const m = (model || OLLAMA_DEFAULT).toLowerCase();
  return OLLAMA_THINKING_MODELS.some((t) => m === t || m.startsWith(t + ':'));
}

/** Convert agent messages to Ollama format (tool_calls use index/object args; tool results use tool_name). */
function toOllamaMessages(
  messages: Array<{ role: string; content?: string | null; tool_calls?: Array<{ id: string; name: string; arguments?: string }>; tool_call_id?: string; name?: string }>
): Array<{ role: string; content: string; tool_calls?: Array<{ type: string; function: { index: number; name: string; arguments: Record<string, unknown> } }>; tool_name?: string }> {
  return messages.map((m) => {
    const base: Record<string, unknown> = {
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
    };
    if (m.role === 'assistant' && m.tool_calls?.length) {
      (base as { tool_calls: unknown[] }).tool_calls = m.tool_calls.map((tc, i) => ({
        type: 'function',
        function: {
          index: i,
          name: tc.name,
          arguments: (() => {
            try {
              return typeof tc.arguments === 'string' ? (JSON.parse(tc.arguments) as Record<string, unknown>) : (tc.arguments ?? {});
            } catch {
              return {};
            }
          })(),
        },
      }));
    }
    if (m.role === 'tool') {
      (base as { tool_name?: string }).tool_name = m.name ?? '';
    }
    return base as { role: string; content: string; tool_calls?: Array<{ type: string; function: { index: number; name: string; arguments: Record<string, unknown> } }>; tool_name?: string };
  });
}

/** Parse Ollama tool_calls (arguments may be object or string) into agent format. */
function fromOllamaToolCalls(
  toolCalls: Array<{ function?: { name?: string; arguments?: unknown } }> | undefined
): Array<{ id: string; name: string; arguments: string }> | undefined {
  if (!toolCalls?.length) return undefined;
  return toolCalls.map((tc, i) => {
    const fn = tc.function;
    const name = fn?.name ?? '';
    const args = fn?.arguments;
    const argsStr = typeof args === 'string' ? args : JSON.stringify(args ?? {});
    return { id: `ollama_${i}_${Date.now()}`, name, arguments: argsStr };
  });
}

const OPENAI_DEFAULT = process.env.AI_OPENAI_DEFAULT_MODEL || 'gpt-4o-mini';
const OPENROUTER_DEFAULT = process.env.AI_OPENROUTER_DEFAULT_MODEL || 'openai/gpt-4o-mini';

async function registerAllProviders(): Promise<void> {
  providers.clear();
  registerProvider('stub', stubAdapter('stub'));
  try {
    const mod = await import('openai').catch(() => ({}));
    const OpenAI = (mod as { OpenAI?: new (opts: { apiKey: string }) => { chat: { completions: { create(opts: unknown): Promise<{ choices?: { message?: { content?: string } }[]; usage?: Record<string, number> }> } } } }).OpenAI;
    if (OpenAI) {
      openAiStreamClient = { _create: (apiKey: string) => new OpenAI({ apiKey }) } as unknown as OpenAiStreamClient;
      registerProvider('openai', {
        defaultModel: OPENAI_DEFAULT,
        async complete({ model, messages, max_tokens, tools: toolsOpt, signal }) {
          const raw = getSulalaEnvKey('OPENAI_API_KEY');
          const apiKey = typeof raw === 'string' ? raw.trim() : '';
          if (!apiKey) throw new Error('OPENAI_API_KEY not set. Add it in Settings or ~/.sulala/.env and try again.');
          const client = new OpenAI({ apiKey });
          const openAiMessages = (messages ?? []).map((m) => {
            if (!m.tool_calls?.length) return m;
            return {
              ...m,
              tool_calls: m.tool_calls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: tc.arguments ?? '' },
              })),
            };
          });
          const createOpts: Record<string, unknown> = {
            model: model || OPENAI_DEFAULT,
            messages: openAiMessages,
            max_completion_tokens: max_tokens || 1024,
          };
          if (toolsOpt?.length) {
            createOpts.tools = toolsOpt.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.parameters ?? {} },
            }));
          }
          try {
            const res = await (client.chat.completions.create as (opts: unknown, opts2?: { signal?: AbortSignal }) => Promise<unknown>)(createOpts, signal ? { signal } : undefined) as { choices?: { message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }[]; usage?: Record<string, number> };
            const choice = res.choices?.[0];
            const msg = choice?.message;
            const tool_calls = msg?.tool_calls?.map((tc) => ({
              id: tc.id,
              name: tc.function?.name ?? '',
              arguments: tc.function?.arguments ?? '',
            }));
            return {
              content: msg?.content ?? '',
              usage: res.usage ?? {},
              ...(tool_calls?.length ? { tool_calls } : {}),
            };
          } catch (err) {
            const status = (err as { status?: number }).status;
            if (status === 401) {
              throw new Error('OPENAI_API_KEY invalid or missing. Check Settings or ~/.sulala/.env and try again.');
            }
            throw err;
          }
        },
      });
    }
  } catch {
    // import failed
  }

  try {
    const mod = await import('openai').catch(() => ({}));
    const OpenAI = (mod as { OpenAI?: new (opts: { apiKey: string; baseURL?: string }) => { chat: { completions: { create(opts: unknown): Promise<{ choices?: { message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }[]; usage?: Record<string, number> }> } } } }).OpenAI;
    if (OpenAI) {
      openRouterStreamClient = { _create: (apiKey: string) => new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' }) } as unknown as OpenAiStreamClient;
      registerProvider('openrouter', {
        defaultModel: OPENROUTER_DEFAULT,
        async complete({ model, messages, max_tokens, tools: toolsOpt, signal }) {
          const raw = getSulalaEnvKey('OPENROUTER_API_KEY');
          const apiKey = typeof raw === 'string' ? raw.trim() : '';
          if (!apiKey) throw new Error('OPENROUTER_API_KEY not set. Add it in Settings or ~/.sulala/.env and try again.');
          const client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' });
          const openAiMessages = (messages ?? []).map((m) => {
            if (!m.tool_calls?.length) return m;
            return {
              ...m,
              tool_calls: m.tool_calls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: tc.arguments ?? '' },
              })),
            };
          });
          const createOpts: Record<string, unknown> = {
            model: model || OPENROUTER_DEFAULT,
            messages: openAiMessages,
            max_completion_tokens: max_tokens || 1024,
          };
          if (toolsOpt?.length) {
            createOpts.tools = toolsOpt.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.parameters ?? {} },
            }));
          }
          try {
            const res = await (client.chat.completions.create as (opts: unknown, opts2?: { signal?: AbortSignal }) => Promise<unknown>)(createOpts, signal ? { signal } : undefined) as { choices?: { message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }[]; usage?: Record<string, number> };
            const choice = res.choices?.[0];
            const msg = choice?.message;
            const tool_calls = msg?.tool_calls?.map((tc) => ({
              id: tc.id,
              name: tc.function?.name ?? '',
              arguments: tc.function?.arguments ?? '',
            }));
            return {
              content: msg?.content ?? '',
              usage: res.usage ?? {},
              ...(tool_calls?.length ? { tool_calls } : {}),
            };
          } catch (chatErr) {
            const errAny = chatErr as { status?: number; response?: { status?: number } };
            const status = errAny?.status ?? errAny?.response?.status;
            if (status === 401) {
              throw new Error('OPENROUTER_API_KEY invalid or missing. Check Settings or ~/.sulala/.env and try again.');
            }
            const msg = chatErr instanceof Error ? chatErr.message : String(chatErr);
            const isCompletionsModel =
              isNotChatModelError(chatErr) ||
              status === 404 ||
              (status === 400 && msg.includes('completions'));
            if (!isCompletionsModel) throw chatErr;
            // Fallback: non-chat model — use v1/completions with a single prompt (no tools).
            const prompt = messagesToPrompt(messages ?? []);
            const body = {
              model: model || OPENROUTER_DEFAULT,
              prompt,
              max_tokens: max_tokens || 1024,
            };
            const compRes = await fetch('https://openrouter.ai/api/v1/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify(body),
              signal,
            });
            if (!compRes.ok) {
              const errText = await compRes.text();
              throw new Error(`OpenRouter completions: ${compRes.status} ${errText}`);
            }
            const compData = (await compRes.json()) as {
              choices?: { text?: string }[];
              usage?: Record<string, number>;
            };
            const text = compData.choices?.[0]?.text ?? '';
            return { content: text, usage: compData.usage ?? {} };
          }
        },
      });
    }
  } catch {
    // import failed
  }

if (!providers.has('openai')) {
  registerProvider('openai', stubAdapter(OPENAI_DEFAULT));
}

const CLAUDE_DEFAULT = process.env.AI_CLAUDE_DEFAULT_MODEL || 'claude-sonnet-4-6';
registerProvider('claude', {
  defaultModel: CLAUDE_DEFAULT,
  async complete({ model, messages, max_tokens }) {
    const key = getSulalaEnvKey('ANTHROPIC_API_KEY');
    if (!key) throw new Error('ANTHROPIC_API_KEY not set. Add it in Settings or ~/.sulala/.env and try again.');
      const systemMsg = messages.find((m) => m.role === 'system');
      const chatMessages = messages.filter((m) => m.role !== 'system').map((m) => ({
        role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      }));
      const body = {
        model: model || CLAUDE_DEFAULT,
        max_tokens: max_tokens || 1024,
        messages: chatMessages,
        ...(systemMsg && { system: typeof systemMsg.content === 'string' ? systemMsg.content : JSON.stringify(systemMsg.content) }),
      };
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Anthropic API: ${res.status} ${err}`);
      }
      const data = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
      const content = data.content?.find((c) => c.type === 'text')?.text || '';
      const usage = data.usage || {};
      return { content, usage: { prompt_tokens: usage.input_tokens ?? 0, completion_tokens: usage.output_tokens ?? 0 } };
    },
});

const GEMINI_DEFAULT = process.env.AI_GEMINI_DEFAULT_MODEL || 'gemini-2.5-flash';
registerProvider('gemini', {
  defaultModel: GEMINI_DEFAULT,
  async complete({ model, messages, max_tokens }) {
    const key = getSulalaEnvKey('GOOGLE_GEMINI_API_KEY') || getSulalaEnvKey('GEMINI_API_KEY');
    if (!key) throw new Error('GOOGLE_GEMINI_API_KEY or GEMINI_API_KEY not set. Add one in Settings or ~/.sulala/.env and try again.');
    const modelId = model || GEMINI_DEFAULT;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${key}`;
      const contents = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
          parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
        }));
      const systemInstruction = messages.find((m) => m.role === 'system');
      const body = {
        contents: contents.length ? contents : [{ role: 'user' as const, parts: [{ text: '' }] }],
        generationConfig: { maxOutputTokens: max_tokens || 1024 },
        ...(systemInstruction && {
          systemInstruction: { parts: [{ text: typeof systemInstruction.content === 'string' ? systemInstruction.content : JSON.stringify(systemInstruction.content) }] },
        }),
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Gemini API: ${res.status} ${err}`);
      }
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const usage = data.usageMetadata || {};
      return {
        content: text,
        usage: { prompt_tokens: usage.promptTokenCount ?? 0, completion_tokens: usage.candidatesTokenCount ?? 0 },
      };
    },
});

const OLLAMA_DEFAULT = process.env.AI_OLLAMA_DEFAULT_MODEL || 'llama3.2';
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_THINKING_MODELS = ['deepseek-r1', 'qwen3', 'deepseek-v3.1', 'gpt-oss'];
function ollamaSupportsThinking(model: string | undefined): boolean {
  const m = (model || OLLAMA_DEFAULT).toLowerCase();
  return OLLAMA_THINKING_MODELS.some((t) => m === t || m.startsWith(t + ':'));
}

/** Convert agent messages to Ollama format (tool_calls use index/object args; tool results use tool_name). */
function toOllamaMessages(
  messages: Array<{ role: string; content?: string | null; tool_calls?: Array<{ id: string; name: string; arguments?: string }>; tool_call_id?: string; name?: string }>
): Array<{ role: string; content: string; tool_calls?: Array<{ type: string; function: { index: number; name: string; arguments: Record<string, unknown> } }>; tool_name?: string }> {
  return messages.map((m) => {
    const base: Record<string, unknown> = {
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
    };
    if (m.role === 'assistant' && m.tool_calls?.length) {
      (base as { tool_calls: unknown[] }).tool_calls = m.tool_calls.map((tc, i) => ({
        type: 'function',
        function: {
          index: i,
          name: tc.name,
          arguments: (() => {
            try {
              return typeof tc.arguments === 'string' ? (JSON.parse(tc.arguments) as Record<string, unknown>) : (tc.arguments ?? {});
            } catch {
              return {};
            }
          })(),
        },
      }));
    }
    if (m.role === 'tool') {
      (base as { tool_name?: string }).tool_name = m.name ?? '';
    }
    return base as { role: string; content: string; tool_calls?: Array<{ type: string; function: { index: number; name: string; arguments: Record<string, unknown> } }>; tool_name?: string };
  });
}

/** Parse Ollama tool_calls (arguments may be object or string) into agent format. */
function fromOllamaToolCalls(
  toolCalls: Array<{ function?: { name?: string; arguments?: unknown } }> | undefined
): Array<{ id: string; name: string; arguments: string }> | undefined {
  if (!toolCalls?.length) return undefined;
  return toolCalls.map((tc, i) => {
    const fn = tc.function;
    const name = fn?.name ?? '';
    const args = fn?.arguments;
    const argsStr = typeof args === 'string' ? args : JSON.stringify(args ?? {});
    return { id: `ollama_${i}_${Date.now()}`, name, arguments: argsStr };
  });
}

registerProvider('ollama', {
  defaultModel: OLLAMA_DEFAULT,
  async complete({ model, messages, max_tokens, think, tools: toolsOpt }) {
    const url = `${OLLAMA_BASE}/api/chat`;
    const ollamaMessages = toOllamaMessages(messages ?? []);
    const body: Record<string, unknown> = {
      model: model || OLLAMA_DEFAULT,
      messages: ollamaMessages,
      options: { num_predict: max_tokens || 1024 },
      stream: false,
      think: think !== false && ollamaSupportsThinking(model),
    };
    if (toolsOpt?.length) {
      body.tools = toolsOpt.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters ?? {} },
      }));
    }
    console.log('[Ollama] POST', url, 'model:', model || OLLAMA_DEFAULT, toolsOpt?.length ? `tools=${toolsOpt.length}` : '');
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      console.error('[Ollama] fetch failed:', e);
      const cause = (e as { cause?: { code?: string } })?.cause;
      if (cause?.code === 'ECONNREFUSED') {
        throw new Error('Ollama is not running. Start it with: ollama serve  (or open the Ollama app).');
      }
      throw e;
    }
    if (!res.ok) {
      const errText = await res.text();
      let didRetry = false;
      if (res.status === 400 && errText.includes('does not support tools') && body.tools) {
        delete body.tools;
        console.log('[Ollama] Model does not support tools; retrying without tools');
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        didRetry = true;
      }
      if (!res.ok) {
        const err = didRetry ? await res.text() : errText;
        const modelName = model || OLLAMA_DEFAULT;
        if (res.status === 404 && (err.includes('not found') || err.includes('model'))) {
          const { pullOllamaModel } = await import('../ollama-setup.js');
          pullOllamaModel(modelName);
          throw new Error(`Model "${modelName}" not found. Pulling it now (see terminal); try again in 1–2 min. Or run: ollama pull ${modelName}`);
        }
        console.error('[Ollama]', res.status, err);
        throw new Error(`Ollama: ${res.status} ${err}`);
      }
    }
    const data = (await res.json()) as {
      message?: { content?: string; thinking?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }> };
      eval_count?: number;
    };
    const msg = data.message;
    const thinking = msg?.thinking ?? '';
    const content = msg?.content ?? '';
    const fullContent = thinking ? thinking + (content ? '\n\n' + content : '') : content;
    const tool_calls = fromOllamaToolCalls(msg?.tool_calls);
    return {
      content: fullContent,
      usage: data.eval_count != null ? { completion_tokens: data.eval_count } : undefined,
      ...(tool_calls?.length ? { tool_calls } : {}),
    };
  },
});
  if (!providers.has('llama')) registerProvider('llama', getProvider('ollama'));
}

await registerAllProviders();

/** Reload AI providers from current process.env (e.g. after onboarding saves new API keys). No restart needed. */
export async function reloadProviders(): Promise<void> {
  await registerAllProviders();
}
