import { describe, it, expect } from 'vitest';
import { config } from './config.js';

describe('config', () => {
  it('has required Config shape', () => {
    expect(config).toBeDefined();
    expect(typeof config.port).toBe('number');
    expect(config.port).toBeGreaterThan(0);
    expect(typeof config.host).toBe('string');
    expect(Array.isArray(config.watchFolders)).toBe(true);
    expect(typeof config.debug).toBe('boolean');
    expect(Array.isArray(config.webhookUrls)).toBe(true);
    expect(typeof config.rateLimitMax).toBe('number');
    expect(typeof config.rateLimitWindowMs).toBe('number');
  });
});
