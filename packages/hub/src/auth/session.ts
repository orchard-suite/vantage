/** Browser sessions: a sealed cookie (AES-GCM over SESSION_SECRET), nothing server side. */
import { open, seal, randomId } from '../crypto.ts';

export const SESSION_COOKIE = 'vantage_session';
export const FLOW_COOKIE = 'vantage_flow';
const SESSION_DAYS = 7;

export interface Session {
  readonly userId: string;
  readonly csrf: string;
  readonly exp: number;
}

export async function sealSession(secret: string, userId: string): Promise<string> {
  const s: Session = { userId, csrf: randomId(), exp: Date.now() + SESSION_DAYS * 86_400_000 };
  return seal(secret, JSON.stringify(s));
}

export async function openSession(secret: string, cookie: string | undefined): Promise<Session | undefined> {
  if (!cookie) return undefined;
  const plain = await open(secret, cookie);
  if (!plain) return undefined;
  const s = JSON.parse(plain) as Session;
  return s.exp > Date.now() ? s : undefined;
}

export function cookieHeader(name: string, value: string, opts: { maxAge: number; secure: boolean; path?: string }): string {
  return `${name}=${value}; Path=${opts.path ?? '/'}; HttpOnly; SameSite=Lax; Max-Age=${opts.maxAge}${opts.secure ? '; Secure' : ''}`;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return undefined;
}
