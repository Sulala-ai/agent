import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AIAdapter } from '../types.js';

vi.mock('../db/index.js', () => ({
  log: vi.fn(),
  saveAiResult: vi.fn(),
}));

describe('orchestrator', () => {
  beforeEach(async () => {
    const { registerProvider } = await import('./orchestrator.js');
    const stub: AIAdapter = {
      defaultModel: 'stub',
      async complete({ messages }) {
        return { content: messages?.[0]?.content as string || 'ok', usage: { completion_tokens: 0 } };
      },
    };
    registerProvider('test-provider', stub);
  });

  it('getProvider throws for unknown provider', async () => {
    const { getProvider: getProv } = await import('./orchestrator.js');
    expect(() => getProv('nonexistent')).toThrow(/Unknown AI provider/);
  });

  it('getProvider returns registered adapter', async () => {
    const { getProvider } = await import('./orchestrator.js');
    const adapter = getProvider('test-provider');
    expect(adapter.defaultModel).toBe('stub');
    const out = await adapter.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(out.content).toBe('hi');
  });
});
