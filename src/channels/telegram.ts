/**
 * Telegram channel: connect the Sulala agent to Telegram via a bot.
 * Config can be set from env or from the dashboard (stored in DB); DB overrides env.
 */
import { Bot, InlineKeyboard } from 'grammy';
import { config } from '../config.js';
import { log, getChannelConfig, setChannelConfig, appendAgentMessage, updateAgentMessageToolResult } from '../db/index.js';
import { getOrCreateAgentSession } from '../db/index.js';
import { runAgentTurn, runAgentTurnStream } from '../agent/loop.js';
import { withSessionLock } from '../agent/session-queue.js';
import { executeTool } from '../agent/tools.js';
import {
  getPendingActionForReplay,
  getPendingAction,
  setPendingActionApproved,
  setPendingActionRejected,
} from '../agent/pending-actions.js';

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const CHANNEL_KEY = 'telegram';
/** Throttle streaming edits to avoid Telegram rate limits. */
const STREAM_EDIT_THROTTLE_MS = 450;
/** Delay before auto-reconnecting after the bot stops or fails (e.g. 409 Conflict). */
const TELEGRAM_RECONNECT_DELAY_MS = 15000;

let telegramReconnectTimeout: ReturnType<typeof setTimeout> | null = null;

/** Pending approval per Telegram chat: chatId -> { pendingActionId, sessionId }. Cleared after approve/reject. */
const telegramPendingByChat = new Map<number, { pendingActionId: string; sessionId: string }>();

/**
 * Resolve provider and model for Telegram when not set in channel config.
 * Prefers OpenRouter or OpenAI when the user has connected (API key set), instead of defaulting to Ollama.
 */
function resolveTelegramProviderAndModel(c: TelegramConfig): { provider: string; model: string | undefined } {
  const provider =
    c.defaultProvider?.trim() ||
    process.env.AI_DEFAULT_PROVIDER?.trim() ||
    (process.env.OPENROUTER_API_KEY?.trim() ? 'openrouter' : null) ||
    (process.env.OPENAI_API_KEY?.trim() ? 'openai' : null) ||
    'ollama';
  let model = c.defaultModel?.trim() || undefined;
  if (!model) {
    if (provider === 'ollama' || provider === 'llama') model = process.env.AI_OLLAMA_DEFAULT_MODEL?.trim() || 'llama3.2';
    else if (provider === 'openrouter') model = process.env.AI_OPENROUTER_DEFAULT_MODEL?.trim() || 'openai/gpt-4o-mini';
    else if (provider === 'openai') model = process.env.AI_OPENAI_DEFAULT_MODEL?.trim() || 'gpt-4o-mini';
  }
  return { provider, model: model || undefined };
}

/**
 * Resolve default AI provider and model (env only, no channel config).
 * Prefers OpenRouter or OpenAI when API keys are set, same as Telegram.
 * Used for scheduled jobs when provider/model are not specified.
 */
export function resolveDefaultProviderAndModel(overrides?: {
  provider?: string | null;
  model?: string | null;
}): { provider: string; model: string | undefined } {
  const provider =
    overrides?.provider?.trim() ||
    process.env.AI_DEFAULT_PROVIDER?.trim() ||
    (process.env.OPENROUTER_API_KEY?.trim() ? 'openrouter' : null) ||
    (process.env.OPENAI_API_KEY?.trim() ? 'openai' : null) ||
    'ollama';
  let model = overrides?.model?.trim() || undefined;
  if (!model) {
    if (provider === 'ollama' || provider === 'llama') model = process.env.AI_OLLAMA_DEFAULT_MODEL?.trim() || 'llama3.2';
    else if (provider === 'openrouter') model = process.env.AI_OPENROUTER_DEFAULT_MODEL?.trim() || 'openai/gpt-4o-mini';
    else if (provider === 'openai') model = process.env.AI_OPENAI_DEFAULT_MODEL?.trim() || 'gpt-4o-mini';
  }
  return { provider, model: model || undefined };
}

export type TelegramConfig = {
  enabled: boolean;
  botToken: string | null;
  dmPolicy: 'open' | 'allowlist' | 'disabled';
  allowFrom: number[];
  /** Chat ID to send job result notifications (e.g. from scheduled agent jobs). */
  notificationChatId: number | null;
  /** Optional: AI provider for Telegram messages (e.g. "ollama"). Falls back to AI_DEFAULT_PROVIDER. */
  defaultProvider?: string | null;
  /** Optional: AI model for Telegram messages (e.g. "llama3.2:1b"). For Ollama falls back to AI_OLLAMA_DEFAULT_MODEL. */
  defaultModel?: string | null;
};

export type TelegramChannelState = {
  enabled: boolean;
  configured: boolean;
  dmPolicy: string;
  allowFrom: number[];
  status: 'connected' | 'not_configured' | 'error';
  botUsername?: string | null;
  error?: string | null;
  /** AI provider for Telegram messages (e.g. "ollama", "openrouter"). Empty = use app default. */
  defaultProvider?: string | null;
  /** AI model for Telegram messages (e.g. "llama3.2", "openai/gpt-4o-mini"). Empty = use provider default. */
  defaultModel?: string | null;
};

let currentBot: Bot | null = null;
let currentBotUsername: string | null = null;
/** Set when bot.start() fails (e.g. invalid token); cleared on successful start. */
let lastStartError: string | null = null;

function parseTelegramConfig(raw: string | null): TelegramConfig | null {
  if (!raw?.trim()) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const enabled = !!o.enabled;
    const botToken = typeof o.botToken === 'string' ? o.botToken.trim() || null : null;
    const dmPolicy = (o.dmPolicy === 'allowlist' || o.dmPolicy === 'disabled' ? o.dmPolicy : 'open') as TelegramConfig['dmPolicy'];
    const allowFrom = Array.isArray(o.allowFrom)
      ? (o.allowFrom as unknown[]).map((x) => (typeof x === 'number' ? x : parseInt(String(x), 10))).filter((n) => !Number.isNaN(n))
      : [];
    const notificationChatId =
      typeof o.notificationChatId === 'number'
        ? o.notificationChatId
        : typeof o.notificationChatId === 'string'
          ? parseInt(o.notificationChatId, 10)
          : null;
    const defaultProvider = typeof o.defaultProvider === 'string' ? o.defaultProvider.trim() || null : null;
    const defaultModel = typeof o.defaultModel === 'string' ? o.defaultModel.trim() || null : null;
    return {
      enabled,
      botToken,
      dmPolicy,
      allowFrom,
      notificationChatId: typeof notificationChatId === 'number' && !Number.isNaN(notificationChatId) ? notificationChatId : null,
      defaultProvider: defaultProvider ?? undefined,
      defaultModel: defaultModel ?? undefined,
    };
  } catch {
    return null;
  }
}

/** Effective config: DB overrides env. */
export function getEffectiveTelegramConfig(): TelegramConfig {
  const fromDb = parseTelegramConfig(getChannelConfig(CHANNEL_KEY));
  if (fromDb) return fromDb;
  return {
    enabled: config.telegram.enabled,
    botToken: config.telegram.botToken,
    dmPolicy: config.telegram.dmPolicy,
    allowFrom: [...config.telegram.allowFrom],
    notificationChatId: null,
    defaultProvider: config.telegram.defaultProvider ?? undefined,
    defaultModel: config.telegram.defaultModel ?? undefined,
  };
}

/** State for API (no token). */
export function getTelegramChannelState(): TelegramChannelState {
  const c = getEffectiveTelegramConfig();
  const configured = !!c.botToken?.trim();
  let status: TelegramChannelState['status'] = 'not_configured';
  if (configured && (currentBotUsername || currentBot)) {
    status = 'connected';
  } else if (configured && c.enabled && lastStartError) {
    status = 'error';
  } else if (configured) {
    status = 'not_configured';
  }
  return {
    enabled: c.enabled,
    configured,
    dmPolicy: c.dmPolicy,
    allowFrom: c.allowFrom,
    status,
    botUsername: currentBotUsername ?? undefined,
    error: lastStartError ?? undefined,
    defaultProvider: c.defaultProvider ?? undefined,
    defaultModel: c.defaultModel ?? undefined,
  };
}

/** Save config to DB and restart the channel. */
export async function setTelegramChannelConfig(body: {
  enabled?: boolean;
  botToken?: string | null;
  dmPolicy?: 'open' | 'allowlist' | 'disabled';
  allowFrom?: number[];
  notificationChatId?: number | null;
  defaultProvider?: string | null;
  defaultModel?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const c = getEffectiveTelegramConfig();
  const enabled = body.enabled !== undefined ? body.enabled : c.enabled;
  let botToken = body.botToken !== undefined ? (body.botToken?.trim() || null) : c.botToken;
  const dmPolicy = body.dmPolicy ?? c.dmPolicy;
  const allowFrom = body.allowFrom ?? c.allowFrom;
  const notificationChatId = body.notificationChatId !== undefined ? body.notificationChatId : c.notificationChatId;
  const defaultProvider = body.defaultProvider !== undefined ? (typeof body.defaultProvider === 'string' ? body.defaultProvider.trim() || null : null) : c.defaultProvider ?? null;
  const defaultModel = body.defaultModel !== undefined ? (typeof body.defaultModel === 'string' ? body.defaultModel.trim() || null : null) : c.defaultModel ?? null;

  if (typeof body.botToken === 'string' && body.botToken.trim() === '') {
    botToken = null;
  }

  if (enabled && botToken) {
    try {
      const testBot = new Bot(botToken);
      const me = await testBot.api.getMe();
      if (!me?.username) throw new Error('getMe returned no username');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Invalid bot token: ${msg}` };
    }
  }

  const next: TelegramConfig = {
    enabled,
    botToken,
    dmPolicy,
    allowFrom,
    notificationChatId: notificationChatId ?? null,
    defaultProvider: defaultProvider ?? undefined,
    defaultModel: defaultModel ?? undefined,
  };
  setChannelConfig(CHANNEL_KEY, JSON.stringify(next));
  await restartTelegramChannel();
  return { ok: true };
}

/** Send a notification message to the configured Telegram chat (job results, etc.). Returns true if sent. */
export async function sendTelegramNotification(text: string): Promise<boolean> {
  const c = getEffectiveTelegramConfig();
  const chatId = c.notificationChatId ?? null;
  if (!currentBot || chatId === null) return false;
  const chunks = splitMessage(text);
  try {
    for (const chunk of chunks) {
      await currentBot.api.sendMessage(chatId, chunk, { parse_mode: undefined });
    }
    return true;
  } catch (err) {
    log('telegram', 'error', (err as Error).message, { notificationChatId: chatId });
    return false;
  }
}

export async function stopTelegramChannel(): Promise<void> {
  if (telegramReconnectTimeout != null) {
    clearTimeout(telegramReconnectTimeout);
    telegramReconnectTimeout = null;
  }
  if (currentBot) {
    const bot = currentBot;
    currentBot = null;
    currentBotUsername = null;
    try {
      await bot.stop();
    } catch (err) {
      const code = (err as { error_code?: number })?.error_code;
      if (code === 409) {
        log('telegram', 'info', 'Telegram bot stop: 409 Conflict (another getUpdates in progress or another instance); ignoring.');
      } else {
        log('telegram', 'warn', 'Telegram bot stop error', { error: (err as Error).message });
      }
    }
  }
}

export async function restartTelegramChannel(): Promise<void> {
  await stopTelegramChannel();
  startTelegramChannel();
}

function canAcceptDm(userId: number, c: TelegramConfig): boolean {
  if (c.dmPolicy === 'disabled') return false;
  if (c.dmPolicy === 'open') return true;
  if (c.dmPolicy === 'allowlist') return c.allowFrom.length > 0 && c.allowFrom.includes(userId);
  return false;
}

const sessionKeyByChat = new Map<number, string>();

function sessionKey(chatId: number, forceNew = false): string {
  if (!forceNew) {
    const existing = sessionKeyByChat.get(chatId);
    if (existing) return existing;
  }
  const key = `telegram_${chatId}${forceNew ? `_${Date.now()}` : ''}`;
  if (forceNew) sessionKeyByChat.set(chatId, key);
  return key;
}

function splitMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_MESSAGE_LENGTH) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    if (rest.length <= TELEGRAM_MAX_MESSAGE_LENGTH) {
      chunks.push(rest);
      break;
    }
    const slice = rest.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH);
    const lastNewline = slice.lastIndexOf('\n');
    const breakAt = lastNewline > TELEGRAM_MAX_MESSAGE_LENGTH / 2 ? lastNewline + 1 : TELEGRAM_MAX_MESSAGE_LENGTH;
    chunks.push(rest.slice(0, breakAt));
    rest = rest.slice(breakAt);
  }
  return chunks;
}

export function startTelegramChannel(): void {
  if (telegramReconnectTimeout != null) {
    clearTimeout(telegramReconnectTimeout);
    telegramReconnectTimeout = null;
  }
  const c = getEffectiveTelegramConfig();
  if (!c.enabled || !c.botToken?.trim()) return;

  const bot = new Bot(c.botToken);
  currentBot = bot;

  bot.command('start', async (ctx) => {
    const fromId = ctx.from?.id;
    if (ctx.chat?.type !== 'private') return;
    if (fromId !== undefined && !canAcceptDm(fromId, c)) {
      await ctx.reply('This bot is not accepting DMs from you. Contact the bot admin to get access.');
      return;
    }
    await ctx.reply(
      "Hi! I'm connected to Sulala Agent. Send me a message and I'll run the agent and reply. Commands: /new — new conversation, /status — session info."
    );
  });

  bot.command('new', async (ctx) => {
    if (ctx.chat?.type !== 'private') return;
    const fromId = ctx.from?.id;
    if (fromId !== undefined && !canAcceptDm(fromId, c)) return;
    const key = sessionKey(ctx.chat.id, true);
    const session = getOrCreateAgentSession(key, { telegram_chat_id: ctx.chat.id });
    await ctx.reply(`Started a new conversation. Session: ${session.id.slice(0, 12)}…`);
  });

  bot.command('status', async (ctx) => {
    if (ctx.chat?.type !== 'private') return;
    const fromId = ctx.from?.id;
    if (fromId !== undefined && !canAcceptDm(fromId, c)) return;
    const key = sessionKey(ctx.chat.id);
    const session = getOrCreateAgentSession(key, { telegram_chat_id: ctx.chat.id });
    await ctx.reply(`Session: ${session.id}\nKey: ${key}`);
  });

  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat?.id;
    const fromId = ctx.from?.id;
    const text = ctx.message.text?.trim();
    if (chatId === undefined || !text) return;

    const configNow = getEffectiveTelegramConfig();
    if (ctx.chat.type === 'private') {
      if (fromId !== undefined && !canAcceptDm(fromId, configNow)) {
        await ctx.reply('This bot is not accepting DMs from you.');
        return;
      }
    }

    const key = sessionKey(chatId);
    const session = getOrCreateAgentSession(key, {
      telegram_chat_id: chatId,
      telegram_user_id: fromId,
      telegram_username: ctx.from?.username ?? undefined,
    });

    // Use this chat for job notifications if none set yet
    const cNow = getEffectiveTelegramConfig();
    if (cNow.notificationChatId == null && ctx.chat?.id != null) {
      setChannelConfig(CHANNEL_KEY, JSON.stringify({ ...cNow, notificationChatId: ctx.chat.id }));
    }

    try {
      await ctx.api.sendChatAction(chatId, 'typing');
      const { provider, model } = resolveTelegramProviderAndModel(cNow);

      let streamMessageId: number | null = null;
      let streamContent = '';
      let throttleTimer: ReturnType<typeof setTimeout> | null = null;

      const doStreamEdit = (): void => {
        if (streamMessageId == null) return;
        const toShow =
          streamContent.length <= TELEGRAM_MAX_MESSAGE_LENGTH
            ? streamContent || '…'
            : '…\n' + streamContent.slice(-(TELEGRAM_MAX_MESSAGE_LENGTH - 2));
        ctx.api.editMessageText(chatId, streamMessageId, toShow).catch(() => {});
      };

      const sent = await ctx.reply('…', { parse_mode: undefined });
      streamMessageId = sent.message_id;

      const result = await withSessionLock(session.id, () =>
        runAgentTurnStream(
          {
            sessionId: session.id,
            userMessage: text,
            provider: provider || undefined,
            model: model || undefined,
          },
          (ev) => {
            if (ev.type === 'assistant') {
              streamContent += ev.delta;
              if (throttleTimer == null) {
                throttleTimer = setTimeout(() => {
                  throttleTimer = null;
                  doStreamEdit();
                }, STREAM_EDIT_THROTTLE_MS);
              }
            }
            if (ev.type === 'thinking') {
              streamContent += ev.delta;
              if (throttleTimer == null) {
                throttleTimer = setTimeout(() => {
                  throttleTimer = null;
                  doStreamEdit();
                }, STREAM_EDIT_THROTTLE_MS);
              }
            }
            if (ev.type === 'tool_call') {
              if (throttleTimer != null) {
                clearTimeout(throttleTimer);
                throttleTimer = null;
              }
              streamContent += `\n\n(Running ${ev.name}…)`;
              doStreamEdit();
            }
            if (ev.type === 'error') {
              if (throttleTimer != null) {
                clearTimeout(throttleTimer);
                throttleTimer = null;
              }
              if (streamMessageId != null) {
                ctx.api.editMessageText(chatId, streamMessageId, `Error: ${ev.message.slice(0, 500)}`).catch(() => {});
              }
            }
          }
        )
      );

      if (throttleTimer != null) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }

      const reply = result.finalContent?.trim() || '';
      const hasMeaningfulReply = reply.length > 0 && reply !== '(No response.)';

      if (streamMessageId != null) {
        const finalText = result.pendingActionId && !hasMeaningfulReply
          ? 'The agent is waiting to perform an action. Approve or reject below.'
          : reply || '(No response.)';
        const chunks = splitMessage(finalText);
        await ctx.api.editMessageText(chatId, streamMessageId, chunks[0] || '…').catch(() => {});
        for (let i = 1; i < chunks.length; i++) {
          await ctx.api.sendMessage(chatId, chunks[i], { parse_mode: undefined });
        }
      }

      if (result.pendingActionId) {
        telegramPendingByChat.set(chatId, { pendingActionId: result.pendingActionId, sessionId: session.id });
        const keyboard = new InlineKeyboard()
          .text('✅ Approve', `approve:${result.pendingActionId}`)
          .text('❌ Reject', `reject:${result.pendingActionId}`);
        const approvalText = hasMeaningfulReply
          ? 'Approve or reject this action:'
          : 'Approve or reject:';
        await ctx.reply(approvalText, { reply_markup: keyboard });
      } else if (!hasMeaningfulReply && streamMessageId == null) {
        await ctx.reply('(No response.)', { parse_mode: undefined });
      }
    } catch (err) {
      const message = (err as Error).message;
      log('telegram', 'error', message, { chatId, sessionId: session.id });
      await ctx.reply(`Error: ${message.slice(0, 500)}`);
    }
  });

  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery?.data;
    const chatId = ctx.callbackQuery?.message?.chat?.id;
    if (!data || chatId === undefined) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }
    const isApprove = data.startsWith('approve:');
    const isReject = data.startsWith('reject:');
    if (!isApprove && !isReject) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }
    const actionId = data.slice(isApprove ? 8 : 7);
    const pending = telegramPendingByChat.get(chatId);
    if (!pending || pending.pendingActionId !== actionId) {
      await ctx.answerCallbackQuery({ text: 'This approval has expired or was already handled.' }).catch(() => {});
      return;
    }
    telegramPendingByChat.delete(chatId);
    await ctx.answerCallbackQuery().catch(() => {});

    const cNow = getEffectiveTelegramConfig();
    const { provider, model } = resolveTelegramProviderAndModel(cNow);

    if (isApprove) {
      const forReplay = getPendingActionForReplay(actionId);
      if (!forReplay) {
        await ctx.reply('This action was already handled or has expired.');
        return;
      }
      let result: unknown;
      try {
        result = await executeTool(forReplay.toolName, forReplay.args, {
          sessionId: forReplay.sessionId,
          toolCallId: forReplay.toolCallId,
          skipApproval: true,
        });
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      const resultContent = typeof result === 'string' ? result : JSON.stringify(result);
      const updated = updateAgentMessageToolResult(forReplay.sessionId, forReplay.toolCallId, resultContent);
      if (!updated) {
        appendAgentMessage({
          session_id: forReplay.sessionId,
          role: 'tool',
          tool_call_id: forReplay.toolCallId,
          name: forReplay.toolName,
          content: resultContent,
        });
      }
      setPendingActionApproved(actionId, result);

      const continueResult = await withSessionLock(forReplay.sessionId, () =>
        runAgentTurn({
          sessionId: forReplay.sessionId,
          userMessage: null,
          provider: provider || undefined,
          model: model || undefined,
        })
      );
      const reply = continueResult.finalContent?.trim() || '(Done.)';
      const chunks = splitMessage(reply);
      for (let i = 0; i < chunks.length; i++) {
        await ctx.api.sendMessage(chatId, chunks[i], { parse_mode: undefined });
      }
      if (continueResult.pendingActionId) {
        telegramPendingByChat.set(chatId, { pendingActionId: continueResult.pendingActionId, sessionId: forReplay.sessionId });
        const keyboard = new InlineKeyboard()
          .text('✅ Approve', `approve:${continueResult.pendingActionId}`)
          .text('❌ Reject', `reject:${continueResult.pendingActionId}`);
        await ctx.api.sendMessage(chatId, 'This action needs your approval. Approve or reject:', { reply_markup: keyboard });
      }
    } else {
      const pendingAction = getPendingAction(actionId);
      if (!pendingAction || pendingAction.status !== 'pending') {
        await ctx.reply('This action was already handled or has expired.');
        return;
      }
      setPendingActionRejected(actionId);
      const rejectedContent = JSON.stringify({ error: 'User rejected this action.' });
      const updated = updateAgentMessageToolResult(pendingAction.sessionId, pendingAction.toolCallId, rejectedContent);
      if (!updated) {
        appendAgentMessage({
          session_id: pendingAction.sessionId,
          role: 'tool',
          tool_call_id: pendingAction.toolCallId,
          name: pendingAction.toolName,
          content: rejectedContent,
        });
      }
      const continueResult = await withSessionLock(pendingAction.sessionId, () =>
        runAgentTurn({
          sessionId: pendingAction.sessionId,
          userMessage: null,
          provider: provider || undefined,
          model: model || undefined,
        })
      );
      const reply = continueResult.finalContent?.trim() || 'Action rejected.';
      const chunks = splitMessage(reply);
      for (let i = 0; i < chunks.length; i++) {
        await ctx.api.sendMessage(chatId, chunks[i], { parse_mode: undefined });
      }
      if (continueResult.pendingActionId) {
        telegramPendingByChat.set(chatId, { pendingActionId: continueResult.pendingActionId, sessionId: pendingAction.sessionId });
        const keyboard = new InlineKeyboard()
          .text('✅ Approve', `approve:${continueResult.pendingActionId}`)
          .text('❌ Reject', `reject:${continueResult.pendingActionId}`);
        await ctx.api.sendMessage(chatId, 'This action needs your approval. Approve or reject:', { reply_markup: keyboard });
      }
    }
  });

  bot.catch((err) => {
    const msg = err.error instanceof Error ? err.error.message : String(err.error ?? err);
    log('telegram', 'error', msg, {});
  });

  lastStartError = null;
  bot
    .start({
      onStart: (info) => {
        currentBotUsername = info.username ?? null;
        lastStartError = null;
        log('telegram', 'info', 'Telegram bot started', { username: info.username });
      },
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      lastStartError = msg;
      log('telegram', 'warn', 'Telegram channel failed to start', { error: msg });
      currentBot = null;
      currentBotUsername = null;
      if (telegramReconnectTimeout) return;
      const c = getEffectiveTelegramConfig();
      if (!c.enabled || !c.botToken?.trim()) return;
      log('telegram', 'info', `Auto-reconnecting in ${TELEGRAM_RECONNECT_DELAY_MS / 1000}s…`);
      telegramReconnectTimeout = setTimeout(() => {
        telegramReconnectTimeout = null;
        startTelegramChannel();
      }, TELEGRAM_RECONNECT_DELAY_MS);
    });
}
