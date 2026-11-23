/**
 * The pages a reader meets before the app: sign in, a guest link's
 * passcode, approving an agent's device or connecting an app, and short messages (a link that
 * no longer works, a sign-in that failed). They are brand surfaces: the
 * blueprint field with the logo's shapes on one side, the task on the
 * other. On a phone only the task shows.
 */
import { escapeHtml, page } from './html.ts';
import { BRAND_BASE, LOCKUP, MARK } from './look.ts';
import { ico } from './icons.ts';


function frame(title: string, task: string, nonce: string): string {
  const art = `<aside class="auth-art" aria-hidden="true"><img src="${BRAND_BASE}vantage-lockup-color-paper.svg" alt=""><div class="auth-shapes"><i></i><i></i><i></i></div><div><h2>Draw it once. Share it everywhere.</h2><p>Your diagrams are files you own. Free to share, edit together and keep.</p></div></aside>`;
  return page(title, `<div class="auth">${art}<main class="auth-task"><div class="auth-box"><a class="brand auth-small" href="/">${LOCKUP}</a>${task}</div></main></div>`, nonce);
}

const alert = (text: string): string => `<div class="banner bad" role="alert">${ico('error')}<span>${escapeHtml(text)}</span></div>`;

/** Sign in with the organization's identity provider; `returnTo` is where the reader was going. */
export function signInHtml(nonce: string, returnTo: string, error?: string): string {
  const href = `/auth/login${returnTo !== '/' ? `?return=${encodeURIComponent(returnTo)}` : ''}`;
  return frame('Sign in', `<div><h1>Welcome back</h1><p class="lede">Sign in with your work account to see your team's diagrams.</p></div>
${error ? alert(error) : ''}
<a class="btn primary lg" href="${escapeHtml(href)}">${ico('out')}Continue with single sign-on</a>
<p class="auth-note">Got a guest link? Open it directly. No account needed.</p>`, nonce);
}

export function passcodeHtml(action: string, nonce: string, wrong: boolean): string {
  return frame('Passcode', `<span class="auth-tile" aria-hidden="true">${MARK}</span>
<div><h1>Someone shared a diagram with you</h1><p class="lede">This link asks for a passcode. The person who shared it should have sent it separately.</p></div>
<form method="post" action="${escapeHtml(action)}"><label for="passcode">Passcode</label><input class="field code" id="passcode" type="password" name="passcode" autocomplete="off" autofocus required${wrong ? ' aria-invalid="true" aria-describedby="pc-error"' : ''}>${wrong ? `<span class="f-error" id="pc-error" role="alert">${ico('error', 13)}That passcode did not match. Check for a typo and try again.</span>` : ''}<button class="btn primary lg">Open the diagram</button></form>
<p class="auth-note">You can look and walk through. Editing needs an account.</p>`, nonce);
}

export function deviceApproveHtml(nonce: string, state: 'form' | 'approved' | 'unknown', code = ''): string {
  if (state === 'approved') {
    return frame('Approved', `<span class="auth-tile" aria-hidden="true">${MARK}</span><div><h1>Device approved</h1><p class="lede">You can close this tab. The device gets its token the next time it checks in.</p></div>`, nonce);
  }
  return frame('Approve a device', `<div><h1>Approve a device</h1><p class="lede">Enter the code the device shows. Approving gives it a token that acts as you.</p></div>
${state === 'unknown' ? alert('That code is unknown or expired. Start again on the device.') : ''}
<form method="post" action="/auth/device/approve"><label for="code">Code</label><input class="field code" id="code" name="code" value="${escapeHtml(code)}" autocomplete="off" autofocus required><button class="btn primary lg">Approve</button></form>`, nonce);
}

/** An agent asks to act as the reader: who it is, where the answer goes, and what it may do. Allow and Deny post the request back. */
export function oauthApproveHtml(nonce: string, a: { clientName: string; redirectHost: string; fields: Record<string, string> }): string {
  const hidden = Object.entries(a.fields).map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`).join('');
  return frame('Connect an app', `<span class="auth-tile" aria-hidden="true">${MARK}</span>
<div><h1>Connect ${escapeHtml(a.clientName)}?</h1><p class="lede">It asks to use Vantage as you. It can read and change every diagram you can, until you disconnect it on your Account page.</p></div>
<p class="auth-note">Your answer goes to <b>${escapeHtml(a.redirectHost)}</b>. Only allow it if you started this from that app just now.</p>
<form method="post" action="/oauth/authorize">${hidden}<button class="btn primary lg" name="decision" value="allow">Allow</button><button class="btn lg" name="decision" value="deny">Deny</button></form>`, nonce);
}

export function messageHtml(title: string, text: string, nonce: string): string {
  return frame(title, `<div><h1>${escapeHtml(title)}</h1><p class="lede">${escapeHtml(text)}</p></div><a class="btn lg" href="/">Go to your diagrams</a>`, nonce);
}
