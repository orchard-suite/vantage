import { describe, expect, mock, test } from 'bun:test';
import * as model from '@vantage/model';

// Counts each parse of a document's text that runs outside a render task: on the thread that answers requests.
const real = { ...model };
let inTask = false;
const outside: string[] = [];
mock.module('@vantage/model', () => ({
  ...real,
  parseDocumentText: (text: string, file?: string) => {
    if (!inTask) outside.push(text);
    return real.parseDocumentText(text, file);
  },
}));

const { testContext, testUser, SAMPLE_YAML } = await import('../testing.ts');
const { saveDocument } = await import('./save.ts');
const { accessibleWorkspaces } = await import('../authz.ts');
const { runTask } = await import('../render/tasks.ts');

describe('a save parses its text', () => {
  test('only on a render thread, never on the thread that answers requests', async () => {
    const base = await testContext();
    // The pool runs in this process in tests; mark what runs as one of its tasks.
    const render = {
      ...base.render,
      run: async (kind: Parameters<typeof runTask>[0], input: never) => {
        inTask = true;
        try {
          return await runTask(kind, input);
        } finally {
          inTask = false;
        }
      },
    } as typeof base.render;
    const ctx = { ...base, render };
    const { principal } = await testUser(ctx, 'author');
    const ws = (await accessibleWorkspaces(ctx.db, principal))[0]!;
    const input = { orgId: 'default', workspaceId: ws.id, authorUserId: principal.userId, who: principal.userId, surface: 'api' as const };
    const first = await saveDocument(ctx, { ...input, yaml: SAMPLE_YAML });
    if (first.status !== 'saved') throw new Error(first.status);
    const edited = SAMPLE_YAML.replace('title: Sample', 'title: Edited');
    expect((await saveDocument(ctx, { ...input, documentId: first.document.id, yaml: edited, expectedVersionId: first.version.id })).status).toBe('saved');
    expect(outside.filter((t) => t === SAMPLE_YAML || t === edited)).toEqual([]);
    expect((await ctx.db.query<{ name: string }>('select name from documents where id = $1', [first.document.id]))[0]!.name).toBe('Edited');
  });
});
