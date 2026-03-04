/**
 * Per-million-token pricing for common models. Used to estimate cost per message.
 * Prices in USD. Extend as needed for new models.
 */
const PRICING_PER_1M: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4-turbo-preview': { input: 10, output: 30 },
  'gpt-4': { input: 30, output: 60 },
  'gpt-4-1106-preview': { input: 10, output: 30 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'gpt-3.5-turbo-0125': { input: 0.5, output: 1.5 },
  'o1-mini': { input: 3, output: 12 },
  'o1': { input: 15, output: 60 },
  // OpenRouter often maps to these; add openrouter/ prefix variants if needed
  'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
  'openai/gpt-4o': { input: 2.5, output: 10 },
  // Anthropic (approx)
  'claude-3-5-sonnet': { input: 3, output: 15 },
  'claude-3-5-haiku': { input: 0.8, output: 4 },
  'claude-3-opus': { input: 15, output: 75 },
  'claude-3-sonnet': { input: 3, output: 15 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
};

/** Estimate cost in USD from usage and model. Returns null if model not in pricing table. */
export function estimateCostUsd(
  usage: { prompt_tokens?: number; completion_tokens?: number } | null | undefined,
  model: string | null | undefined
): number | null {
  if (!usage || !model) return null;
  const p = PRICING_PER_1M[model] ?? PRICING_PER_1M[model.split('/').pop() ?? ''];
  if (!p) return null;
  const inTokens = usage.prompt_tokens ?? 0;
  const outTokens = usage.completion_tokens ?? 0;
  const cost = (inTokens * p.input + outTokens * p.output) / 1_000_000;
  return cost > 0 ? cost : null;
}
