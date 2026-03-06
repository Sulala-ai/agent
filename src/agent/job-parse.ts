import cron from 'node-cron';
import { complete } from '../ai/orchestrator.js';
import { getChannelConfig } from '../db/index.js';

const JOB_PARSE_SYSTEM = `You are a job scheduler assistant. The user will describe a task they want to run on a schedule. Reply with ONLY a single JSON object (no markdown, no code fence, no explanation) with exactly these keys:
- "prompt": string — the agent task in plain language (what to do). Use the user's words; keep it clear and actionable.
- "cron_expression": string — standard 5-field cron: minute hour day month weekday. Examples: "0 9 * * *" = every day 9:00 AM, "0 * * * *" = every hour, "0 8 * * 1-5" = weekdays 8:00 AM, "*/30 * * * *" = every 30 minutes.
- "name": string — short label for the job (e.g. "Morning news", "Hourly sync"). One to four words.

If the user does not specify a schedule, use "0 9 * * *" (daily at 9 AM). Extract the schedule from phrases like "every day at X", "every hour", "weekdays at 8am", "every 30 minutes".`;

const DEFAULT_CRON = '0 9 * * *';

export type ParseJobOptions = {
  provider?: string | null;
  model?: string | null;
};

export type ParseJobResult = {
  prompt: string;
  cron_expression: string;
  name: string;
};

function resolveJobDefaultProvider(): { provider?: string; model?: string } {
  const raw = getChannelConfig('job_default');
  if (!raw?.trim()) return {};
  try {
    const o = JSON.parse(raw) as { defaultProvider?: string; defaultModel?: string };
    return {
      provider: o.defaultProvider?.trim() || undefined,
      model: o.defaultModel?.trim() || undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Parse natural language into job prompt + schedule using the LLM.
 * Uses job default provider/model from settings when not passed.
 */
export async function parseJobFromMessage(
  message: string,
  options?: ParseJobOptions
): Promise<ParseJobResult> {
  const userMessage = message.trim();
  if (!userMessage) throw new Error('message is required');

  let provider = options?.provider ?? undefined;
  let model = options?.model ?? undefined;
  if (!provider) {
    const jobDefault = resolveJobDefaultProvider();
    if (jobDefault.provider) provider = jobDefault.provider;
    if (jobDefault.model) model = jobDefault.model;
  }

  const result = await complete({
    provider: provider ?? undefined,
    model: model ?? undefined,
    messages: [
      { role: 'system', content: JOB_PARSE_SYSTEM },
      { role: 'user', content: userMessage },
    ],
    max_tokens: 512,
  });

  let raw = (result.content || '').trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) raw = jsonMatch[0];
  const parsed = JSON.parse(raw) as { prompt?: string; cron_expression?: string; name?: string };
  const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : userMessage;
  let cronExpression = typeof parsed.cron_expression === 'string' ? parsed.cron_expression.trim() : DEFAULT_CRON;
  if (!cron.validate(cronExpression)) cronExpression = DEFAULT_CRON;
  const name = typeof parsed.name === 'string' ? parsed.name.trim() : 'Scheduled job';
  return { prompt, cron_expression: cronExpression, name };
}
