import { describe, expect, test } from 'bun:test';
import { DocumentSchema, type NodeOutput, type RelationView } from '@vantage/model';
import { expandObserved } from './observe.ts';
import { emptyObserved, mergeObserved } from './observed.ts';

// One namespace fully covered, one half covered, one bare, and a
// cluster-wide egress policy over everything outside kube-system.
const model = mergeObserved(emptyObserved(), {
  source: 'k8s',
  observed: '2026-10-31T10:00:00Z',
  entities: [
    { id: 'ns:app', type: 'ns', name: 'app', facts: {} },
    { id: 'ns:db', type: 'ns', name: 'db', facts: {} },
    { id: 'ns:kube-system', type: 'ns', name: 'kube-system', facts: {} },
    { id: 'wl:app/web', type: 'wl', name: 'web', parent: 'ns:app', facts: {} },
    { id: 'wl:db/pg', type: 'wl', name: 'pg', parent: 'ns:db', facts: {} },
    { id: 'wl:db/dump', type: 'wl', name: 'dump', parent: 'ns:db', facts: {} },
    { id: 'wl:kube-system/dns', type: 'wl', name: 'dns', parent: 'ns:kube-system', facts: {} },
    { id: 'np:app/web', type: 'np', name: 'web-from-traefik', facts: { types: ['Ingress'] } },
    { id: 'np:db/pg', type: 'np', name: 'pg-from-app', facts: { types: ['Ingress'] } },
    { id: 'np:lan', type: 'np', name: 'lan-egress', facts: { types: ['Egress'] } },
  ],
  relations: [
    { from: 'np:app/web', to: 'wl:app/web', label: 'workloads' },
    { from: 'np:db/pg', to: 'wl:db/pg', label: 'workloads' },
    { from: 'np:lan', to: 'wl:app/web', label: 'workloads' },
    { from: 'np:lan', to: 'wl:db/pg', label: 'workloads' },
    { from: 'np:lan', to: 'wl:db/dump', label: 'workloads' },
  ],
}).model;

const out = expandObserved(
  DocumentSchema.parse({
    nodes: [{ id: 'net', name: 'Network', observe: { source: 'k8s', types: ['ns', 'wl'], group: 'Live', boundary: { policy: 'np', relation: 'workloads', fact: 'types', guard: 'Ingress', title: 'Network boundaries' } } }],
  }),
  model,
);
const box = (id: string): NodeOutput | undefined => {
  const walk = (ns: readonly NodeOutput[]): NodeOutput | undefined => {
    for (const n of ns) {
      if (n.id === id) return n;
      const hit = walk(n.children ?? []);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(out.nodes);
};

describe('boundaries', () => {
  test('a member without a policy for the guarded direction is red and says so; a covered one names its policies', () => {
    expect(box('net.wl.db.dump')).toMatchObject({ color: 'red', subtitle: 'no Ingress policy' });
    expect(box('net.wl.app.web')?.color).toBeUndefined();
    expect(box('net.wl.app.web')?.subtitle).toBe('lan-egress, web-from-traefik');
  });

  test('a container is amber when some members are bare, red when all are, plain when none are', () => {
    expect(box('net.ns.app')).toMatchObject({ subtitle: '1 covered' });
    expect(box('net.ns.app')?.color).toBeUndefined();
    expect(box('net.ns.db')).toMatchObject({ color: 'amber', subtitle: '1 of 2 with no Ingress policy' });
    expect(box('net.ns.kube-system')).toMatchObject({ color: 'red', subtitle: '1 of 1 with no Ingress policy' });
  });

  test('the boundaries view lists the gaps for every direction the policies govern', () => {
    const v = out.views.find((x) => x.id === 'net-boundaries') as RelationView;
    expect(v.title).toBe('Network boundaries');
    expect(v.group).toBe('Live');
    expect(out.views.map((x) => x.id)).toEqual(['net-boundaries']);
    expect(v.annotations?.map((a) => a.text)).toEqual(['2 of 4 have no Ingress policy: dns, dump.', '1 of 4 have no Egress policy: dns.']);
  });
});
