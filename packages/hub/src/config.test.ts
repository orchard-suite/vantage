import { describe, expect, test } from 'bun:test';
import { availableCores, ConfigError, loadConfig } from './config.ts';

const base = {
  DATABASE_URL: 'postgres://x/y',
  PUBLIC_URL: 'http://localhost:4848/',
  AUTH_MODE: 'none',
  SESSION_SECRET: 's'.repeat(32),
  SECRETS_KEY: 'k'.repeat(32),
};

describe('config', () => {
  test('parses a minimal none-mode environment with defaults', () => {
    const c = loadConfig(base);
    expect(c.PORT).toBe(4848);
    expect(c.PUBLIC_URL).toBe('http://localhost:4848');
    expect(c.BLOB_DRIVER).toBe('fs');
    expect(c.WORKER_EMBEDDED).toBe(false);
    expect(c.DATABASE_AUTH).toBe('password');
    expect(loadConfig({ ...base, DATABASE_AUTH: 'azure' }).DATABASE_AUTH).toBe('azure');
  });

  test('names every missing or malformed variable', () => {
    try {
      loadConfig({ ...base, PORT: 'abc', SESSION_SECRET: 'short' });
      throw new Error('expected failure');
    } catch (err) {
      const e = err as ConfigError;
      expect(e).toBeInstanceOf(ConfigError);
      expect(e.problems.join('\n')).toContain('PORT');
      expect(e.problems.join('\n')).toContain('SESSION_SECRET');
    }
    expect(() => loadConfig({ ...base, AUTH_MODE: 'oidc' })).toThrow(/OIDC_ISSUER/);
    expect(() => loadConfig({ ...base, BLOB_DRIVER: 'azure' })).toThrow(/AZURE_BLOB_URL/);
    expect(() => loadConfig({ ...base, DATABASE_AUTH: 'kerberos' })).toThrow(/DATABASE_AUTH/);
  });
});

describe('available cores', () => {
  test('a container limit caps the machine', () => {
    expect(availableCores('200000 100000\n', 16)).toBe(2);
    expect(availableCores('150000 100000', 16)).toBe(2);
    expect(availableCores('max 100000', 16)).toBe(16);
    expect(availableCores(undefined, 6)).toBe(6);
    expect(availableCores('5000 100000', 16)).toBe(1);
  });
});
