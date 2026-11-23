import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { GOLDEN_SETS, layoutView, signature } from '@vantage/layout';
import { loadModelFromFile, type Model, type ModelNode } from '@vantage/model';
import { ViewDigests, namedNodes, nodesRead } from './view-digest.ts';

const root = join(import.meta.dir, '..', '..', '..', '..');
const ctx = { shared: 'test', document: 'doc', thresholdDays: 7, now: new Date('2026-11-01T00:00:00Z') };

/** The model with one node changed the way an edit would change it. */
function edited(model: Model, id: string, change: (n: ModelNode) => ModelNode): Model {
  const nodes = new Map(model.nodes);
  nodes.set(id, change(model.nodes.get(id)!));
  return { ...model, nodes };
}

describe('view digests', () => {
  for (const set of GOLDEN_SETS) {
    test(`${set}: a view whose digest stays the same draws the same picture`, () => {
      const { model } = loadModelFromFile(join(root, 'examples', set));
      const views = model!.views.filter((v) => v.kind !== 'walkthrough' || model!.views.find((b) => b.id === v.view)?.kind === 'relation');
      const before = new ViewDigests(model!, ctx);
      const digests = new Map(views.map((v) => [v.id, before.digest(v, undefined)]));
      const pictures = new Map(views.map((v) => [v.id, signature(layoutView(model!, v))]));
      // A sample of nodes spread over the example, so a large one stays quick: renamed, then given a new fact.
      const all = [...model!.nodes.keys()];
      const step = Math.max(1, Math.floor(all.length / 25));
      const ids = all.filter((_, i) => i % step === 0);
      for (const id of ids) {
        for (const change of [(n: ModelNode): ModelNode => ({ ...n, name: `${n.name} renamed` }), (n: ModelNode): ModelNode => ({ ...n, facts: [...n.facts, { label: 'added', value: 'a much longer value' }] })]) {
          const after = edited(model!, id, change);
          const digests2 = new ViewDigests(after, ctx);
          for (const v of views) {
            const same = digests2.digest(v, undefined) === digests.get(v.id);
            if (same) expect(signature(layoutView(after, v))).toBe(pictures.get(v.id)!);
            // A node the view reads always moves its digest.
            if (v.kind === 'relation' && nodesRead(model!, v).has(id)) expect(same).toBe(false);
            if ((v.kind === 'sequence' || v.kind === 'flow' || v.kind === 'timeline') && namedNodes(model!, v).has(id)) expect(same).toBe(false);
          }
        }
      }
    }, 60_000);
  }

  test('a sequence, flow, timeline, or page keeps its digest when another view changes', () => {
    for (const set of GOLDEN_SETS) {
      const { model } = loadModelFromFile(join(root, 'examples', set));
      const others = model!.views.filter((v) => v.kind === 'sequence' || v.kind === 'flow' || v.kind === 'timeline' || v.kind === 'page');
      const relation = model!.views.find((v) => v.kind === 'relation' && !others.some((o) => o.kind === 'page' && o.panels.some((p) => p.view === v.id)));
      if (!others.length || !relation) continue;
      const before = new ViewDigests(model!, ctx);
      const retitled = { ...model!, views: model!.views.map((v) => (v === relation ? { ...v, title: `${v.title} renamed` } : v)) };
      // The whole document's digest moves with any edit; these views no longer follow it.
      const after = new ViewDigests(retitled, { ...ctx, document: 'edited' });
      for (const v of others) expect(after.digest(v, undefined)).toBe(before.digest(v, undefined));
    }
  });

  test('anchors count only on the nodes the view reads', () => {
    const { model } = loadModelFromFile(join(root, 'examples', GOLDEN_SETS[0]));
    const view = model!.views.find((v) => v.kind === 'relation')!;
    if (view.kind !== 'relation') throw new Error('expected a relation view');
    const read = [...nodesRead(model!, view)];
    const digests = new ViewDigests(model!, ctx);
    const base = digests.digest(view, new Map([[read[0]!, { x: 1, y: 1 }]]));
    expect(digests.digest(view, new Map([[read[0]!, { x: 1, y: 1 }], ['not-in-this-view', { x: 9, y: 9 }]]))).toBe(base);
    expect(digests.digest(view, new Map([[read[0]!, { x: 2, y: 1 }]]))).not.toBe(base);
  });
});
