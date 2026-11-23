import { describe, expect, test } from 'bun:test';
import { testApp, SAMPLE_YAML } from '../testing.ts';
import { agent } from './testing.ts';

describe('what a person has, and where a new diagram goes', () => {
  test('the outline with no address lists every workspace the person may see, shared ones too, and each workspace its documents', async () => {
    const t = await testApp();
    const me = await t.bearer('author', { admin: true });
    const team = await t.json('/api/v1/workspaces', { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'Team' }) });
    const teamSlug = String(team.body['slug']);
    const a = await agent(t, me.headers);
    await a.call('vantage_write', { writes: [{ address: '~/mine', text: SAMPLE_YAML }] });
    await a.call('vantage_write', { writes: [{ address: `${teamSlug}/shared`, text: SAMPLE_YAML }] });

    const all = await a.call('vantage_outline', {});
    expect(all).toMatch(/\(personal, \S+\)  1 document\n/);
    expect(all).toMatch(new RegExp(`${teamSlug}  Team  \\(team, \\S+\\)  1 document`));
    const one = await a.call('vantage_outline', { address: teamSlug });
    expect(one).toContain(`${teamSlug}/shared  Sample`);
    expect(one).not.toContain('/mine');
    await t.ctx.db.close();
  });

  test('a write to ~ goes in the personal workspace, named after its title, and never over another', async () => {
    const t = await testApp();
    const me = await t.bearer('author', { admin: true });
    await t.json('/api/v1/workspaces', { method: 'POST', headers: me.headers, body: JSON.stringify({ name: 'Team' }) });
    const a = await agent(t, me.headers);
    const saved = await a.call('vantage_write', { writes: [{ address: '~', text: SAMPLE_YAML }] });
    const personal = /saved (\S+)\/sample version/.exec(saved)![1]!;
    expect(saved).toContain(`http://hub.test/w/${personal}/sample`);
    expect((await a.call('vantage_outline', {})).split('\n').find((l) => l.includes('(personal'))).toContain(`${personal}  `);
    // A second new diagram with the same title gets its own slug and never overwrites the first.
    expect(await a.call('vantage_write', { writes: [{ address: '~', text: SAMPLE_YAML }] })).toContain(`http://hub.test/w/${personal}/sample-2`);
    await t.ctx.db.close();
  });

  test('validate by address checks the pages and notes how well they cover the model', async () => {
    const t = await testApp();
    const me = await t.bearer('author', { admin: true });
    const a = await agent(t, me.headers);
    const yaml = `${SAMPLE_YAML}  - id: guide\n    kind: doc\n    title: Guide\n    file: pages/guide.md\n`;
    await a.call('vantage_write', { writes: [{ address: '~/paged', text: yaml }, { address: '~/paged/pages/guide.md', text: '## Buy\n\nThe [[shop-api]] takes the order.\n' }] });
    const checked = await a.call('vantage_validate', { address: '~/paged' });
    expect(checked).toContain('note doc-box-unmentioned: no page names 2 boxes: shoppers, orders-db');
    expect(checked).toContain('ok: ');
    await t.ctx.db.close();
  });
});
