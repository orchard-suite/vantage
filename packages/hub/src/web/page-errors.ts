/**
 * What a person in a browser meets when a page cannot be shown: never JSON.
 * Not signed in goes through sign-in and comes back to the same address. No
 * access, a missing diagram, or a fault shows a short page they can act on.
 * Scripts, API clients, and agents keep the JSON answer.
 */
import type { Context } from 'hono';
import type { HubEnv } from './env.ts';
import type { Config } from '../config.ts';
import { messageHtml } from './auth-pages.ts';

/** The sign-in page, coming back to `back` (a path and its query) afterwards. */
export function signInUrl(back: string): string {
  return back === '/' ? '/signin' : `/signin?return=${encodeURIComponent(back)}`;
}

/** A browser opening a page, as opposed to a script's fetch, an image, or an API or MCP client. */
export function isPageRequest(c: Context<HubEnv>): boolean {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return false;
  const path = c.req.path;
  if (path.startsWith('/api/') || path.startsWith('/mcp') || path.includes('/api/')) return false;
  const dest = c.req.header('sec-fetch-dest');
  if (dest && dest !== 'document') return false;
  return (c.req.header('accept') ?? '').includes('text/html');
}

const MESSAGES: Record<number, { readonly title: string; readonly text: string }> = {
  401: { title: 'Sign in to continue', text: 'You are not signed in to this hub. Sign in, then open the link again.' },
  403: { title: 'No access', text: 'You are signed in, but you do not have access to this. Ask the owner of the workspace to add you.' },
  404: { title: 'Not found', text: 'This diagram or workspace does not exist, or you do not have access to it. Ask the person who shared the link to add you to the workspace.' },
  429: { title: 'Too many requests', text: 'This hub is getting a lot of requests from you. Wait a minute, then try again.' },
  503: { title: 'Busy', text: 'The hub is busy drawing. Try again in a few seconds.' },
};
const FAULT = { title: 'Something went wrong', text: 'The hub could not open this page. Try again in a moment.' };

/** The page a browser gets for an error status: sign-in for 401 under OIDC, otherwise a message. */
export function pageError(c: Context<HubEnv>, config: Pick<Config, 'AUTH_MODE'>, status: number): Response {
  if (status === 401 && config.AUTH_MODE === 'oidc') {
    const url = new URL(c.req.url);
    return c.redirect(signInUrl(`${url.pathname}${url.search}`));
  }
  const { title, text } = MESSAGES[status] ?? FAULT;
  return c.html(messageHtml(title, text, c.get('nonce')), status as 400);
}
