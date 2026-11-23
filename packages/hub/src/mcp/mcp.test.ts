import { describe, expect, test } from 'bun:test';
import { BUDGET, CORE, GROUPS, INSTRUCTIONS_LEAD, TOOL_DOOR } from '@vantage/mcp';
import { testApp, SAMPLE_YAML } from '../testing.ts';
import { agent } from './testing.ts';

const WITH_PAGE = `${SAMPLE_YAML}  - id: guide
    kind: doc
    title: Guide
    file: pages/guide.md
    beside: context
`;
const GUIDE = '# Guide\n\n## Orders\n\nThe [[shop-api]] takes orders.\n\n## Refunds\n\nNot yet.\n';

describe('the agent door over http', () => {
  test('rejects without a bearer, lists the core and the tool door, and sends the climb', async () => {
    const t = await testApp();
    const me = await t.bearer('agent');
    expect((await t.app.request('/mcp', { method: 'POST', body: '{}' })).status).toBe(401);
    const a = await agent(t, me.headers);
    const tools = (await a.client.listTools()).tools.map((x) => x.name);
    expect(tools).toEqual([...CORE, TOOL_DOOR]);
    expect(a.client.getInstructions()).toStartWith(INSTRUCTIONS_LEAD);
    expect(INSTRUCTIONS_LEAD.length).toBeLessThanOrEqual(BUDGET.standing.instructionsLead);
    // A host that loads tools on demand itself asks for every tool, and gets no door.
    const all = (await (await agent(t, me.headers, '?tools=all')).client.listTools()).tools.map((x) => x.name);
    expect(all).toContain('vantage_history');
    expect(all).not.toContain(TOOL_DOOR);
    expect(all).toContain('vantage_export');
    // Every tool is in the core or in exactly one group, so none is listed under "other".
    const grouped = Object.values(GROUPS).flatMap((g) => g.tools);
    expect(all.filter((n) => !CORE.includes(n) && grouped.filter((g) => g === n).length !== 1)).toEqual([]);
    await t.ctx.db.close();
  });

  test('write, outline, find, read a part, patch, and the tools on demand', async () => {
    const t = await testApp();
    const me = await t.bearer('agent');
    const a = await agent(t, me.headers);
    const saved = await a.call('vantage_write', { writes: [{ address: '~/sample', text: WITH_PAGE }, { address: '~/sample/pages/guide.md', text: GUIDE }], message: 'from agent' });
    const ws = /saved (\S+)\/sample version/.exec(saved)![1]!;
    expect(saved).toContain(`http://hub.test/w/${ws}/sample`);

    const root = await a.call('vantage_outline', {});
    expect(root).toContain(`${ws}  `);
    expect(root).toContain('1 document');
    const doc = await a.call('vantage_outline', { address: `${ws}/sample` });
    expect(doc).toContain('views (2)');
    expect(doc).toContain('context  relation  Context');
    expect(doc).toContain('shoppers, shop-api, orders-db');
    expect(doc).toContain(`${ws}/sample/pages/guide.md`);
    expect(await a.call('vantage_outline', { address: `${ws}/sample/pages/guide.md` })).toContain('#refunds  Refunds  L7-9  20 chars');

    const found = await a.call('vantage_find', { query: 'takes orders' });
    expect(found).toContain(`${ws}/sample:8:`);
    expect(found).toContain(`${ws}/sample/pages/guide.md:5: The [[shop-api]] takes orders.`);

    const view = await a.call('vantage_read', { addresses: [`${ws}/sample#views.context`, `${ws}/sample/pages/guide.md#refunds`] });
    expect(view).toContain('question: Who talks to whom?');
    expect(view).not.toContain('Shoppers');
    expect(view).toContain('## Refunds\n\nNot yet.');
    expect(view).not.toContain('## Orders');
    const version = /version (\S+)/.exec(view)![1]!;
    expect(await a.call('vantage_read', { addresses: [`${ws}/sample`], held: { [`${ws}/sample`]: version } })).toContain('unchanged');

    // One call changes the YAML by text, the YAML by path, and the page; it is one version.
    const patched = await a.call('vantage_patch', {
      edits: [
        { address: `${ws}/sample`, old: 'subtitle: node service', new: 'subtitle: bun service' },
        { address: `${ws}/sample`, op: 'set', path: 'views.context.title', value: 'The context' },
        { address: `${ws}/sample/pages/guide.md`, old: 'Not yet.', new: 'Within a day.' },
      ],
      message: 'three small changes',
    });
    expect(patched).toMatch(new RegExp(`^saved ${ws}/sample version \\S+\\.`));
    const history = await a.call(TOOL_DOOR, { tool: 'vantage_history', arguments: { address: `${ws}/sample` } });
    expect(history.split('\n').length).toBe(2);
    const after = await a.call('vantage_read', { addresses: [`${ws}/sample#nodes.shop-api`, `${ws}/sample/pages/guide.md#refunds`] });
    expect(after).toContain('subtitle: bun service');
    expect(after).toContain('Within a day.');

    // Reading a thing and writing the same text back changes nothing: no new version.
    const whole = async (address: string): Promise<string> => (await a.call('vantage_read', { addresses: [address] })).replace(/^===[^\n]*\n/, '');
    const back = await a.call('vantage_write', { writes: [{ address: `${ws}/sample`, text: await whole(`${ws}/sample`) }, { address: `${ws}/sample/pages/guide.md`, text: await whole(`${ws}/sample/pages/guide.md`) }] });
    expect(back).toContain('unchanged');
    expect((await a.call(TOOL_DOOR, { tool: 'vantage_history', arguments: { address: `${ws}/sample` } })).split('\n').length).toBe(2);

    // A patch that misses or matches twice saves nothing and says why.
    const miss = await a.attempt('vantage_patch', { edits: [{ address: `${ws}/sample`, old: 'subtitle: go service', new: 'x' }] });
    expect(miss.isError).toBe(true);
    expect(miss.text).toContain('old was not found');
    expect(miss.text).toContain('Nearest lines: L7: subtitle: bun service');
    const twice = await a.attempt('vantage_patch', { edits: [{ address: `${ws}/sample`, old: 'type:', new: 'kind:' }] });
    expect(twice.text).toContain('3 times');
    expect((await a.call(TOOL_DOOR, { tool: 'vantage_history', arguments: { address: `${ws}/sample` } })).split('\n').length).toBe(2);

    // A write with errors saves nothing.
    const bad = await a.attempt('vantage_write', { writes: [{ address: `${ws}/sample`, text: WITH_PAGE.replace('type: api', 'type: phone') }] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('unknown-type');

    // The door lists the rest by group, describes one, and calls it.
    expect(await a.call(TOOL_DOOR, {})).toContain('review: vantage_comments');
    expect(await a.call(TOOL_DOOR, { group: 'documents' })).toContain('vantage_diff: Unified diff between two versions');
    expect(await a.call(TOOL_DOOR, { tool: 'vantage_diff' })).toContain('"workspace"');
    await a.call(TOOL_DOOR, { tool: 'vantage_comment', arguments: { workspace: ws, document: 'sample', text: 'check the label', view: 'context', targets: ['shop-api'] } });
    const listed = await a.call(TOOL_DOOR, { tool: 'vantage_comments', arguments: { workspace: ws, document: 'sample' } });
    expect(listed).toContain('view=context boxes=shop-api');
    // Through the door or by its own name, a tool answers the same.
    expect(await a.call('vantage_comments', { workspace: ws, document: 'sample' })).toBe(listed);

    // The tools that draw and check take the address; nothing is sent back to the hub.
    expect(await a.call('vantage_validate', { address: `${ws}/sample` })).toContain(`ok: ${ws}/sample version`);
    const drawn = await a.client.callTool({ name: 'vantage_render', arguments: { address: `${ws}/sample`, view: 'context' } });
    expect((drawn.content as { type: string }[]).map((c) => c.type)).toEqual(['image', 'text']);

    const surfaces = await t.ctx.db.query<{ surface: string }>("select distinct surface from audit where what = 'document.save'");
    expect(surfaces.map((s) => s.surface)).toEqual(['mcp']);
    await t.ctx.db.close();
  });

  test('the guide and the schema are read by part, never whole', async () => {
    const t = await testApp();
    const a = await agent(t, (await t.bearer('agent')).headers);
    const outline = await a.call('vantage_outline', { address: 'guide' });
    expect(outline).toContain('#relations  Relations');
    const topic = await a.call('vantage_read', { addresses: ['guide#relations'] });
    expect(topic).toContain('## Relations');
    expect(topic.length).toBeLessThan(8000);
    expect(await a.call('vantage_read', { addresses: ['guide'] })).toContain('read it by part');
    expect(await a.call('vantage_outline', { address: 'schema' })).toContain('#');
    await t.ctx.db.close();
  });
});
