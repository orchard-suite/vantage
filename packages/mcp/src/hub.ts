/**
 * The laptop's link to a hub: where it is and the bearer token that signs
 * this machine in. `vantage login <url>` writes it with the hub's device
 * code flow; VANTAGE_HUB_URL and VANTAGE_HUB_TOKEN override the file.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';

export interface HubLink {
  readonly url: string;
  readonly token: string;
}

const LinkSchema = z.object({ url: z.string().url(), token: z.string().min(1) });

export function hubConfigPath(env: Record<string, string | undefined> = process.env): string {
  const base = env['XDG_CONFIG_HOME'] || join(homedir(), '.config');
  return join(base, 'vantage', 'hub.json');
}

/** The hub this machine is signed in to, or undefined when it works locally only. */
export function readHubLink(env: Record<string, string | undefined> = process.env): HubLink | undefined {
  const url = env['VANTAGE_HUB_URL'];
  const token = env['VANTAGE_HUB_TOKEN'];
  if (url && token) return { url: trimSlash(url), token };
  const path = hubConfigPath(env);
  if (!existsSync(path)) return undefined;
  const parsed = LinkSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) throw new Error(`${path} is not a hub link: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  return { url: trimSlash(parsed.data.url), token: parsed.data.token };
}

export function writeHubLink(link: HubLink, env: Record<string, string | undefined> = process.env): string {
  const path = hubConfigPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify({ url: trimSlash(link.url), token: link.token }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

export function removeHubLink(env: Record<string, string | undefined> = process.env): boolean {
  const path = hubConfigPath(env);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

export interface DeviceStart {
  readonly device_code: string;
  readonly user_code: string;
  readonly verification_uri_complete: string;
  readonly expires_in: number;
  readonly interval: number;
}

export interface LoginOptions {
  /** Shows the person the page to open and the code to check. */
  readonly prompt: (start: DeviceStart) => void;
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Runs the device code flow against `url` and returns the approved link. */
export async function loginToHub(url: string, opts: LoginOptions): Promise<HubLink> {
  const base = trimSlash(url);
  const f = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const res = await f(`${base}/auth/device`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `vantage on ${hostname()}` }) });
  if (!res.ok) throw new Error(`${base}/auth/device answered ${res.status}: ${await res.text()}`);
  const start = (await res.json()) as DeviceStart;
  opts.prompt(start);
  const deadline = Date.now() + start.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(start.interval * 1000);
    const poll = await f(`${base}/auth/device/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device_code: start.device_code }) });
    const body = (await poll.json().catch(() => ({}))) as { access_token?: string; error?: string };
    if (poll.ok && body.access_token) return { url: base, token: body.access_token };
    if (body.error !== 'authorization_pending') throw new Error(`sign-in failed: ${body.error ?? `status ${poll.status}`}`);
  }
  throw new Error('sign-in timed out; run vantage login again');
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
