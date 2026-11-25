import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { GOLDEN_SETS, layoutView } from '@vantage/layout';
import { loadModelFromFile, type Model, type ModelNode, type ResolvedView } from '@vantage/model';
import { bundleDraw, viewBundle } from '@vantage/render';
import { ViewDigests, namedNodes, nodesDrawn, nodesRead } from './view-digest.ts';

const root = join(import.meta.dir, '..', '..', '..', '..');
const ctx = { shared: 'test', document: 'doc', thresholdDays: 7, now: new Date('2026-11-01T00:00:00Z') };

/** A view's whole entry as a render stores it, picture included; drawn fresh, never from the layout cache. */
function entryOf(model: Model, view: ResolvedView): string {
  const layout = layoutView(model, view, undefined, new Map());
  return JSON.stringify(viewBundle(model, view, layout, bundleDraw(model)(layout)));
}

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
      const pictures = new Map(views.map((v) => [v.id, entryOf(model!, v)]));
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
            if (same) expect(entryOf(after, v)).toBe(pictures.get(v.id)!);
            // A node the view draws always moves its digest.
            if (v.kind === 'relation' && nodesDrawn(model!, v).has(id)) expect(same).toBe(false);
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

  test('a box a relation view holds but does not draw changes neither its digest nor its picture', () => {
    let checked = 0;
    for (const set of GOLDEN_SETS) {
      const { model } = loadModelFromFile(join(root, 'examples', set));
      for (const v of model!.views) {
        if (v.kind !== 'relation') continue;
        const drawn = nodesDrawn(model!, v);
        const unseen = [...nodesRead(model!, v)].filter((id) => !drawn.has(id)).slice(0, 3);
        if (!unseen.length) continue;
        const before = new ViewDigests(model!, ctx).digest(v, undefined);
        const picture = entryOf(model!, v);
        for (const id of unseen) {
          // A connector refresh: a new fact and a new subtitle on a box inside a container the view shows.
          const after = edited(model!, id, (n) => ({ ...n, subtitle: 'observed just now', facts: [...n.facts, { label: 'restarts', value: '42' }] }));
          expect(new ViewDigests(after, ctx).digest(v, undefined)).toBe(before);
          expect(entryOf(after, v)).toBe(picture);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 60_000);

  test('a box a relation view does not draw still moves its digest when it moves in the tree', () => {
    const { model } = loadModelFromFile(join(root, 'examples', GOLDEN_SETS[0]));
    for (const v of model!.views) {
      if (v.kind !== 'relation') continue;
      const drawn = nodesDrawn(model!, v);
      const id = [...nodesRead(model!, v)].find((n) => !drawn.has(n) && model!.nodes.get(n)!.childIds.length === 0);
      if (id === undefined) continue;
      const parent = model!.nodes.get(id)!.parentId!;
      // A box that vanished: its container counts one fewer inside.
      const nodes = new Map(model!.nodes);
      nodes.delete(id);
      nodes.set(parent, { ...nodes.get(parent)!, childIds: nodes.get(parent)!.childIds.filter((c) => c !== id) });
      expect(new ViewDigests({ ...model!, nodes }, ctx).digest(v, undefined)).not.toBe(new ViewDigests(model!, ctx).digest(v, undefined));
      return;
    }
    throw new Error('no relation view holds a box it does not draw');
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
