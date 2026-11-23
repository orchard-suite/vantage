/**
 * What the kubectl connector reads and how each Kubernetes object becomes
 * an entity. Relations are derived here from the objects of one namespace:
 * a Service selects workloads by label, an Ingress routes to Services, a
 * workload reads ConfigMaps and Secrets (which are synthesized from the
 * references, never listed, so no secret value is ever read).
 */
import type { BatchEntity, BatchRelation, FactValue } from '../../batch.ts';
import { getPath } from '../../template.ts';

export const KUBECTL_RESOURCES = ['Namespace', 'Node', 'Deployment', 'StatefulSet', 'DaemonSet', 'Service', 'Ingress', 'CronJob'] as const;
export type KubectlResource = (typeof KUBECTL_RESOURCES)[number];

export interface ResourceRoute {
  readonly kind: KubectlResource;
  readonly plural: string;
  /** API path prefix: `api/v1` for core, `apis/<group>/<version>` otherwise. */
  readonly api: string;
  readonly namespaced: boolean;
}

export const RESOURCE_ROUTES: Record<KubectlResource, ResourceRoute> = {
  Namespace: { kind: 'Namespace', plural: 'namespaces', api: 'api/v1', namespaced: false },
  Node: { kind: 'Node', plural: 'nodes', api: 'api/v1', namespaced: false },
  Deployment: { kind: 'Deployment', plural: 'deployments', api: 'apis/apps/v1', namespaced: true },
  StatefulSet: { kind: 'StatefulSet', plural: 'statefulsets', api: 'apis/apps/v1', namespaced: true },
  DaemonSet: { kind: 'DaemonSet', plural: 'daemonsets', api: 'apis/apps/v1', namespaced: true },
  Service: { kind: 'Service', plural: 'services', api: 'api/v1', namespaced: true },
  Ingress: { kind: 'Ingress', plural: 'ingresses', api: 'apis/networking.k8s.io/v1', namespaced: true },
  CronJob: { kind: 'CronJob', plural: 'cronjobs', api: 'apis/batch/v1', namespaced: true },
};

export interface K8sObject {
  readonly kind?: string;
  readonly metadata: {
    readonly name: string;
    readonly namespace?: string;
    readonly labels?: Record<string, string>;
    readonly annotations?: Record<string, string>;
    readonly creationTimestamp?: string;
  };
  readonly spec?: Record<string, unknown>;
  readonly status?: Record<string, unknown>;
}

export interface K8sList {
  readonly items: K8sObject[];
}

const WORKLOADS: ReadonlySet<string> = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'CronJob']);

export function objectId(kind: string, o: K8sObject): string {
  const k = kind.toLowerCase();
  return o.metadata.namespace !== undefined ? `${k}:${o.metadata.namespace}/${o.metadata.name}` : `${k}:${o.metadata.name}`;
}

export function clusterId(name: string): string {
  return `cluster:${name}`;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

function strings(list: unknown, path: string): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((x) => str(getPath(x, path))).filter((x): x is string => x !== undefined);
}

/** The pod template of a workload: `spec.template` for the apps kinds, one level deeper for a CronJob. */
function podSpec(kind: string, o: K8sObject): unknown {
  return kind === 'CronJob' ? getPath(o, 'spec.jobTemplate.spec.template.spec') : getPath(o, 'spec.template.spec');
}

function podLabels(o: K8sObject): Record<string, string> {
  const labels = getPath(o, 'spec.template.metadata.labels');
  return labels && typeof labels === 'object' ? (labels as Record<string, string>) : {};
}

function containers(spec: unknown): unknown[] {
  const main = getPath(spec, 'containers');
  const init = getPath(spec, 'initContainers');
  return [...(Array.isArray(main) ? main : []), ...(Array.isArray(init) ? init : [])];
}

function set(facts: Record<string, FactValue>, key: string, value: FactValue | undefined): void {
  if (value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)) facts[key] = value;
}

function workloadFacts(kind: string, o: K8sObject): Record<string, FactValue> {
  const facts: Record<string, FactValue> = {};
  const spec = podSpec(kind, o);
  set(facts, 'images', strings(containers(spec), 'image'));
  set(facts, 'serviceAccount', str(getPath(spec, 'serviceAccountName')));
  if (kind === 'DaemonSet') {
    set(facts, 'replicas', num(getPath(o, 'status.desiredNumberScheduled')));
    set(facts, 'ready', num(getPath(o, 'status.numberReady')));
  } else if (kind === 'CronJob') {
    set(facts, 'schedule', str(getPath(o, 'spec.schedule')));
    set(facts, 'suspend', getPath(o, 'spec.suspend') === true);
    set(facts, 'lastSchedule', str(getPath(o, 'status.lastScheduleTime')));
  } else {
    set(facts, 'replicas', num(getPath(o, 'spec.replicas')));
    set(facts, 'ready', num(getPath(o, 'status.readyReplicas')) ?? 0);
    set(facts, 'strategy', str(getPath(o, 'spec.strategy.type')) ?? str(getPath(o, 'spec.updateStrategy.type')));
  }
  return facts;
}

function serviceFacts(o: K8sObject): Record<string, FactValue> {
  const facts: Record<string, FactValue> = {};
  set(facts, 'type', str(getPath(o, 'spec.type')));
  set(facts, 'clusterIP', str(getPath(o, 'spec.clusterIP')));
  const ports = getPath(o, 'spec.ports');
  if (Array.isArray(ports)) {
    set(
      facts,
      'ports',
      ports.map((p) => `${str(getPath(p, 'port')) ?? '?'}/${str(getPath(p, 'protocol')) ?? 'TCP'}->${str(getPath(p, 'targetPort')) ?? str(getPath(p, 'port')) ?? '?'}`),
    );
  }
  return facts;
}

function ingressFacts(o: K8sObject): Record<string, FactValue> {
  const facts: Record<string, FactValue> = {};
  set(facts, 'class', str(getPath(o, 'spec.ingressClassName')));
  set(facts, 'hosts', strings(getPath(o, 'spec.rules'), 'host'));
  const tls = getPath(o, 'spec.tls');
  if (Array.isArray(tls)) set(facts, 'tls', tls.flatMap((t) => strings(getPath(t, 'hosts'), '')));
  return facts;
}

function nodeFacts(o: K8sObject): Record<string, FactValue> {
  const facts: Record<string, FactValue> = {};
  set(facts, 'kubelet', str(getPath(o, 'status.nodeInfo.kubeletVersion')));
  set(facts, 'os', str(getPath(o, 'status.nodeInfo.osImage')));
  set(facts, 'arch', str(getPath(o, 'status.nodeInfo.architecture')));
  set(facts, 'runtime', str(getPath(o, 'status.nodeInfo.containerRuntimeVersion')));
  set(facts, 'cpu', str(getPath(o, 'status.capacity.cpu')));
  set(facts, 'memory', str(getPath(o, 'status.capacity.memory')));
  const labels = o.metadata.labels ?? {};
  set(facts, 'instanceType', labels['node.kubernetes.io/instance-type']);
  set(
    facts,
    'roles',
    Object.keys(labels)
      .filter((k) => k.startsWith('node-role.kubernetes.io/'))
      .map((k) => k.slice('node-role.kubernetes.io/'.length)),
  );
  const conditions = getPath(o, 'status.conditions');
  if (Array.isArray(conditions)) {
    const ready = conditions.find((c) => getPath(c, 'type') === 'Ready');
    set(facts, 'ready', getPath(ready, 'status') === 'True');
  }
  const addresses = getPath(o, 'status.addresses');
  if (Array.isArray(addresses)) set(facts, 'internalIP', str(getPath(addresses.find((a) => getPath(a, 'type') === 'InternalIP'), 'address')));
  return facts;
}

function factsOf(kind: KubectlResource, o: K8sObject): Record<string, FactValue> {
  switch (kind) {
    case 'Namespace': {
      const facts: Record<string, FactValue> = {};
      set(facts, 'phase', str(getPath(o, 'status.phase')));
      return facts;
    }
    case 'Node':
      return nodeFacts(o);
    case 'Service':
      return serviceFacts(o);
    case 'Ingress':
      return ingressFacts(o);
    default:
      return workloadFacts(kind, o);
  }
}

export function toEntity(kind: KubectlResource, o: K8sObject, cluster: string): BatchEntity {
  const parent = o.metadata.namespace !== undefined ? `namespace:${o.metadata.namespace}` : clusterId(cluster);
  const facts = factsOf(kind, o);
  if (o.metadata.creationTimestamp !== undefined) facts.created = o.metadata.creationTimestamp;
  return {
    id: objectId(kind, o),
    type: kind.toLowerCase(),
    name: o.metadata.name,
    parent,
    facts,
    tags: [kind.toLowerCase(), ...(WORKLOADS.has(kind) ? ['workload'] : [])],
    ...(o.metadata.namespace !== undefined ? { subtitle: o.metadata.namespace } : {}),
  };
}

export interface ReferencedConfig {
  readonly kind: 'configmap' | 'secret';
  readonly name: string;
}

/** Every ConfigMap and Secret a pod spec reads: volumes, projected sources, envFrom, env valueFrom, and pull secrets. */
export function configReferences(spec: unknown): ReferencedConfig[] {
  const out = new Map<string, ReferencedConfig>();
  const add = (kind: ReferencedConfig['kind'], name: unknown): void => {
    const n = str(name);
    if (n !== undefined) out.set(`${kind}:${n}`, { kind, name: n });
  };
  const volumes = getPath(spec, 'volumes');
  for (const v of Array.isArray(volumes) ? volumes : []) {
    add('configmap', getPath(v, 'configMap.name'));
    add('secret', getPath(v, 'secret.secretName'));
    const sources = getPath(v, 'projected.sources');
    for (const s of Array.isArray(sources) ? sources : []) {
      add('configmap', getPath(s, 'configMap.name'));
      add('secret', getPath(s, 'secret.name'));
    }
  }
  for (const c of containers(spec)) {
    const envFrom = getPath(c, 'envFrom');
    for (const e of Array.isArray(envFrom) ? envFrom : []) {
      add('configmap', getPath(e, 'configMapRef.name'));
      add('secret', getPath(e, 'secretRef.name'));
    }
    const env = getPath(c, 'env');
    for (const e of Array.isArray(env) ? env : []) {
      add('configmap', getPath(e, 'valueFrom.configMapKeyRef.name'));
      add('secret', getPath(e, 'valueFrom.secretKeyRef.name'));
    }
  }
  const pull = getPath(spec, 'imagePullSecrets');
  for (const p of Array.isArray(pull) ? pull : []) add('secret', getPath(p, 'name'));
  return [...out.values()];
}

function selects(selector: Record<string, string>, labels: Record<string, string>): boolean {
  const pairs = Object.entries(selector);
  return pairs.length > 0 && pairs.every(([k, v]) => labels[k] === v);
}

export interface Derived {
  readonly entities: BatchEntity[];
  readonly relations: BatchRelation[];
}

/** Relations and synthesized config entities over every object read in one run. */
export function deriveRelations(objects: ReadonlyMap<KubectlResource, readonly K8sObject[]>): Derived {
  const relations: BatchRelation[] = [];
  const synthesized = new Map<string, BatchEntity>();
  const workloads = (['Deployment', 'StatefulSet', 'DaemonSet'] as const).flatMap((k) => (objects.get(k) ?? []).map((o) => ({ kind: k, o })));
  for (const svc of objects.get('Service') ?? []) {
    const selector = getPath(svc, 'spec.selector');
    if (!selector || typeof selector !== 'object') continue;
    for (const w of workloads) {
      if (w.o.metadata.namespace !== svc.metadata.namespace) continue;
      if (selects(selector as Record<string, string>, podLabels(w.o))) {
        relations.push({ from: objectId('Service', svc), to: objectId(w.kind, w.o), label: 'routes to', kind: 'sync', tags: ['selects'] });
      }
    }
  }
  for (const ing of objects.get('Ingress') ?? []) {
    const targets = new Set<string>();
    const rules = getPath(ing, 'spec.rules');
    for (const r of Array.isArray(rules) ? rules : []) {
      const paths = getPath(r, 'http.paths');
      for (const p of Array.isArray(paths) ? paths : []) {
        const name = str(getPath(p, 'backend.service.name'));
        if (name !== undefined) targets.add(name);
      }
    }
    const fallback = str(getPath(ing, 'spec.defaultBackend.service.name'));
    if (fallback !== undefined) targets.add(fallback);
    for (const name of targets) {
      relations.push({ from: objectId('Ingress', ing), to: `service:${ing.metadata.namespace}/${name}`, label: 'routes to', kind: 'sync', tags: ['ingress'] });
    }
  }
  for (const kind of ['Deployment', 'StatefulSet', 'DaemonSet', 'CronJob'] as const) {
    for (const o of objects.get(kind) ?? []) {
      const ns = o.metadata.namespace ?? 'default';
      for (const ref of configReferences(podSpec(kind, o))) {
        const id = `${ref.kind}:${ns}/${ref.name}`;
        if (!synthesized.has(id)) {
          synthesized.set(id, { id, type: ref.kind, name: ref.name, parent: `namespace:${ns}`, subtitle: ns, facts: {}, tags: [ref.kind, 'referenced'] });
        }
        relations.push({ from: objectId(kind, o), to: id, label: 'reads', kind: 'data', tags: ['config'] });
      }
    }
  }
  return { entities: [...synthesized.values()], relations };
}
