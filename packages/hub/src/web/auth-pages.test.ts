import { describe, expect, test } from 'bun:test';
import { messageHtml, passcodeHtml, signInHtml } from './auth-pages.ts';
import { testApp } from '../testing.ts';

describe('auth pages', () => {
  test('sign in sends the reader to the identity provider and keeps where they were going', () => {
    const page = signInHtml('n', '/w/team/shop?view=context');
    expect(page).toContain('href="/auth/login?return=%2Fw%2Fteam%2Fshop%3Fview%3Dcontext"');
    expect(page).toContain('vantage-lockup-color-paper.svg');
    expect(signInHtml('n', '/')).toContain('href="/auth/login"');
    const failed = signInHtml('n', '/', 'Sign-in did not finish <b>x</b>');
    expect(failed).toContain('role="alert"');
    expect(failed).not.toContain('<b>x</b>');
  });

  test('a wrong passcode marks the field invalid and explains it', () => {
    expect(passcodeHtml('/g/x', 'n', false)).not.toContain('aria-invalid="true"');
    const wrong = passcodeHtml('/g/x', 'n', true);
    expect(wrong).toContain('aria-invalid="true"');
    expect(wrong).toContain('aria-describedby="pc-error"');
    expect(wrong).toContain('action="/g/x"');
    expect(messageHtml('<i>t</i>', 'x', 'n')).not.toContain('<i>t</i>');
  });

  test('the sign-in route explains itself outside OIDC mode', async () => {
    const t = await testApp();
    const res = await t.app.request('/signin?return=/w/a');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('proxy mode');
  });
});
