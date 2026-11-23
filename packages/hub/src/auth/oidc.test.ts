import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClientMetadata, ServerMetadata } from 'openid-client';
import * as oidc from 'openid-client';
import { assertionAuth, oidcProviderFrom } from './oidc.ts';
import { silentLogger } from '../log.ts';
import { ConfigError, loadConfig } from '../config.ts';
import { TEST_ENV } from '../testing.ts';

describe('oidc client authentication', () => {
  test('a token file signs the client in, read again on every request so a rotated token is used', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'vantage-oidc-')), 'token');
    const auth = assertionAuth(file);
    const send = (): URLSearchParams => {
      const body = new URLSearchParams();
      auth({ issuer: 'https://issuer.example' } as ServerMetadata, { client_id: 'vantage' } as ClientMetadata, body, new Headers());
      return body;
    };
    writeFileSync(file, 'first.jwt\n');
    expect(Object.fromEntries(send())).toEqual({ client_id: 'vantage', client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: 'first.jwt' });
    writeFileSync(file, 'second.jwt');
    expect(send().get('client_assertion')).toBe('second.jwt');
  });

  test('oidc mode takes exactly one of a client secret and a token file', () => {
    const oidc = { ...TEST_ENV, AUTH_MODE: 'oidc', OIDC_ISSUER: 'https://issuer.example/', OIDC_CLIENT_ID: 'vantage' };
    expect(loadConfig({ ...oidc, OIDC_CLIENT_SECRET: 's' }).OIDC_CLIENT_SECRET).toBe('s');
    expect(loadConfig({ ...oidc, OIDC_CLIENT_ASSERTION_FILE: '/var/run/token' }).OIDC_CLIENT_ASSERTION_FILE).toBe('/var/run/token');
    expect(() => loadConfig(oidc)).toThrow(ConfigError);
    expect(() => loadConfig({ ...oidc, OIDC_CLIENT_SECRET: 's', OIDC_CLIENT_ASSERTION_FILE: '/var/run/token' })).toThrow(ConfigError);
  });
});

describe('oidc callback', () => {
  test('the code is redeemed with the redirect URI the sign-in began with, whatever address the callback arrived on', async () => {
    const config = loadConfig({ ...TEST_ENV, PUBLIC_URL: 'https://hub.example', AUTH_MODE: 'oidc', OIDC_ISSUER: 'https://issuer.example/', OIDC_CLIENT_ID: 'vantage', OIDC_CLIENT_SECRET: 's' });
    const client = new oidc.Configuration({ issuer: 'https://issuer.example/', authorization_endpoint: 'https://issuer.example/authorize', token_endpoint: 'https://issuer.example/token' }, 'vantage', 's');
    const sent: URLSearchParams[] = [];
    client[oidc.customFetch] = async (_url, init) => {
      sent.push(new URLSearchParams(String(init.body)));
      return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: { 'content-type': 'application/json' } });
    };
    const provider = oidcProviderFrom(client, config, silentLogger, 'https://hub.example/auth/callback');
    const { url, flowCookie } = await provider.begin('/');
    const state = new URL(url).searchParams.get('state')!;
    expect(new URL(url).searchParams.get('redirect_uri')).toBe('https://hub.example/auth/callback');
    await expect(provider.complete(`?code=abc&state=${state}`, flowCookie)).rejects.toThrow();
    expect(sent[0]!.get('redirect_uri')).toBe('https://hub.example/auth/callback');
    expect(sent[0]!.get('code')).toBe('abc');
  });
});
