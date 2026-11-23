/**
 * A synthetic fleet for scale benchmarks: regions hold clusters, clusters
 * hold nodes, nodes hold pods. Each tick replaces a share of the pods, the
 * way job pods churn in a real cluster, so vanished entities pile up the
 * way they do in production.
 */
import type { BatchInput } from '../../packages/connectors/src/index.ts';

export interface FleetShape {
  readonly regions: number;
  readonly clusters: number;
  readonly nodes: number;
  readonly pods: number;
}

/** A shape near `entities` total, three regions and wide pods first. */
export function shapeFor(entities: number): FleetShape {
  const regions = 3;
  const clusters = Math.max(1, Math.round(Math.cbrt(entities / 400)));
  const nodes = Math.max(3, Math.round(Math.sqrt(entities / (regions * clusters * 20))));
  const pods = Math.max(1, Math.round(entities / (regions * clusters * nodes)) - 1);
  return { regions, clusters, nodes, pods };
}

export function entityCount(s: FleetShape): number {
  return s.regions * (1 + s.clusters * (1 + s.nodes * (1 + s.pods)));
}

/** One observation of the fleet at `tick`; `churn` is the share of pods replaced per tick. */
export function fleetBatch(source: string, s: FleetShape, tick: number, churn = 0.05): BatchInput {
  const entities: BatchInput['entities'] = [];
  const relations: NonNullable<BatchInput['relations']> = [];
  const replaced = Math.round(s.pods * churn);
  for (let r = 0; r < s.regions; r++) {
    const region = `region-${r}`;
    entities.push({ id: region, type: 'region', name: `Region ${r}` });
    for (let c = 0; c < s.clusters; c++) {
      const cluster = `${region}.cluster-${c}`;
      entities.push({ id: cluster, type: 'cluster', name: `Cluster ${r}-${c}`, parent: region, facts: { version: '1.31', health: 'ok' } });
      for (let n = 0; n < s.nodes; n++) {
        const node = `${cluster}.node-${n}`;
        entities.push({ id: node, type: 'fleet_node', name: `node-${r}-${c}-${n}`, parent: cluster, facts: { roles: n < 3 ? 'etcd,control-plane' : 'worker', health: (n + tick) % 17 === 0 ? 'amber' : 'ok', cpu: 8, memory: '32Gi' } });
        for (let p = 0; p < s.pods; p++) {
          // The first `replaced` pods of a node get a new name every tick.
          const generation = p < replaced ? tick : 0;
          const pod = `${node}.pod-${p}-g${generation}`;
          entities.push({ id: pod, type: 'pod', name: `pod-${p}-${generation}`, parent: node, facts: { image: `app-${p % 40}:1.0`, health: (p * 7 + tick) % 53 === 0 ? 'red' : 'ok', restarts: Math.floor((p + tick) / 50) % 5 } });
          if (p > 0 && p % 4 === 0) relations.push({ from: pod, to: `${node}.pod-${p - 1}-g${p - 1 < replaced ? tick : 0}`, label: 'calls', kind: 'sync' });
        }
      }
    }
  }
  return { source, observed: new Date(Date.UTC(2026, 0, 1) + tick * 600_000).toISOString(), entities, relations };
}

/** A document whose live block draws the whole fleet, with a failure view per region. */
export function fleetDocument(source: string, title = 'Fleet'): string {
  return `title: ${title}
nodes:
  - id: users
    name: Users
    type: users
  - id: edge
    name: Edge
    type: gateway
  - id: fleet
    name: The fleet, live
    observe:
      source: ${source}
      types: [region, cluster, fleet_node, pod]
      names: { pod: pod, fleet_node: node }
      health: health
      closed: [fleet_node]
      group: Live
      view: { title: Where everything runs }
      failure:
        domains: [region]
        quorum: { type: fleet_node, fact: roles, contains: etcd, name: etcd }
relations:
  - { from: users, to: edge, label: HTTPS }
  - { from: edge, to: fleet, label: routes }
views:
  - id: context
    title: Context
    include: { nodes: [users, edge, fleet] }
`;
}

/** A small hand-drawn document with a few boxes bound to fleet entities. */
export function boundDocument(source: string, i: number): string {
  return `title: Service ${i}
nodes:
  - id: client
    name: Client
    type: users
  - id: api
    name: API ${i}
    type: service
    bind: ${source}:region-${i % 3}.cluster-0
  - id: db
    name: Database
    type: database
relations:
  - { from: client, to: api, label: calls }
  - { from: api, to: db, label: reads }
views:
  - id: main
    title: Service ${i}
    include: { nodes: [client, api, db] }
`;
}
