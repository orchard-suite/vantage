import { describe, expect, test } from 'bun:test';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hubConfigPath, loginToHub, readHubLink, removeHubLink, writeHubLink } from './hub.ts';

describe('hub link', () => {
  test('the device flow waits while pending and returns the approved token', async () => {
    const calls: string[] = [];
    let polls = 0;
    const f = Object.assign(
      async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith('/auth/device')) return Response.json({ device_code: 'dc', user_code: 'ABCD-EFGH', verification_uri_complete: 'https://hub.test/auth/device/approve?code=ABCD-EFGH', expires_in: 600, interval: 5 });
        polls++;
        return polls < 3 ? Response.json({ error: 'authorization_pending' }, { status: 400 }) : Response.json({ access_token: 'vt_secret', token_type: 'bearer' });
      },
      { preconnect: () => undefined },
    );
    let shown = '';
    const link = await loginToHub('https://hub.test/', { fetch: f, sleep: async () => undefined, prompt: (s) => (shown = s.user_code) });
    expect(link).toEqual({ url: 'https://hub.test', token: 'vt_secret' });
    expect(shown).toBe('ABCD-EFGH');
    expect(polls).toBe(3);
    expect(calls[0]).toBe('https://hub.test/auth/device');
  });

  test('an expired code stops the flow', async () => {
    const f = Object.assign(
      async (input: string | URL | Request) =>
        String(input).endsWith('/auth/device') ? Response.json({ device_code: 'dc', user_code: 'X', verification_uri_complete: 'u', expires_in: 600, interval: 5 }) : Response.json({ error: 'expired_token' }, { status: 400 }),
      { preconnect: () => undefined },
    );
    await expect(loginToHub('https://hub.test', { fetch: f, sleep: async () => undefined, prompt: () => undefined })).rejects.toThrow('expired_token');
  });

  test('the link is kept private on disk, and the environment overrides it', () => {
    const env = { XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'vantage-hub-')) };
    expect(readHubLink(env)).toBeUndefined();
    const path = writeHubLink({ url: 'https://hub.test/', token: 'vt_1' }, env);
    expect(path).toBe(hubConfigPath(env));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readHubLink(env)).toEqual({ url: 'https://hub.test', token: 'vt_1' });
    expect(readHubLink({ ...env, VANTAGE_HUB_URL: 'https://other.test', VANTAGE_HUB_TOKEN: 'vt_2' })).toEqual({ url: 'https://other.test', token: 'vt_2' });
    expect(removeHubLink(env)).toBe(true);
    expect(readHubLink(env)).toBeUndefined();
  });
});
