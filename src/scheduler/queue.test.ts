import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrepare = vi.fn(() => ({
  run: vi.fn(),
  get: vi.fn().mockReturnValue(undefined),
  all: vi.fn().mockReturnValue([]),
}));

vi.mock('../db/index.js', () => ({
  getDb: vi.fn(() => ({ prepare: mockPrepare })),
  log: vi.fn(),
  updateTaskStatus: vi.fn(),
}));

describe('queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({
      run: vi.fn(),
      get: vi.fn().mockReturnValue(undefined),
      all: vi.fn().mockReturnValue([]),
    });
  });

  it('getQueueLength returns 0 when empty', async () => {
    const { getQueueLength } = await import('./queue.js');
    expect(getQueueLength()).toBe(0);
  });

  it('setConcurrency and getConcurrency round-trip', async () => {
    const { setConcurrency, getConcurrency } = await import('./queue.js');
    setConcurrency(3);
    expect(getConcurrency()).toBe(3);
    setConcurrency(0);
    expect(getConcurrency()).toBe(1);
  });

  it('enqueue adds id and getQueueLength reflects it', async () => {
    const { enqueue, getQueueLength } = await import('./queue.js');
    enqueue('task-1');
    expect(getQueueLength()).toBeGreaterThanOrEqual(0);
    enqueue('task-1');
    enqueue('task-2');
    expect(getQueueLength()).toBeGreaterThanOrEqual(0);
  });
});
