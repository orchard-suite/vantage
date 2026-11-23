import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { drain, fixtureFetch, testContext } from '../../testing.ts';
import { createKubectlConnector, KubectlConfigSchema, type KubectlDeps } from './kubectl.ts';
import { configReferences } from './resources.ts';

const dir = `${import.meta.dir}/fixtures`;
const PLURALS = ['namespaces', 'nodes', 'deployments', 'statefulsets', 'daemonsets', 'services', 'ingresses', 'cronjobs'];

function execDeps(): KubectlDeps & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    exec: async (args) => {
      calls.push([...args]);
      const plural = args[1] ?? '';
      if (!PLURALS.includes(plural)) throw new Error(`no fixture for kubectl ${args.join(' ')}`);
      return readFileSync(`${dir}/${plural}.json`, 'utf8');
    },
    readFile: async () => {
      throw new Error('kubeconfig mode reads no files');
    },
  };
}

describe('kubectl connector, kubeconfig mode', () => {
  const config = KubectlConfigSchema.parse({ mode: 'kubeconfig', context: 'home', cluster: 'home' });

  test('runs kubectl get per resource with the context and all namespaces', async () => {
    const deps = execDeps();
    const ctx = testContext(config, fetch);
    const [batch] = await drain(createKubectlConnector(deps).discover(ctx));
    expect(deps.calls).toHaveLength(8);
    expect(deps.calls[0]).toEqual(['get', 'namespaces', '-o', 'json', '--context', 'home']);
    expect(deps.calls[2]).toEqual(['get', 'deployments', '-o', 'json', '--all-namespaces', '--context', 'home']);
    expect(batch?.partial).toBeUndefined();
    expect(ctx.log.records.filter((r) => r.message === 'kubectl resource read')).toHaveLength(8);
  });

  test('scopes namespaced resources to the configured namespaces', async () => {
    const deps = execDeps();
    const ctx = testContext({ ...config, namespaces: ['relay', 'monitoring'] }, fetch);
    await drain(createKubectlConnector(deps).discover(ctx));
    expect(deps.calls.filter((c) => c[1] === 'deployments').map((c) => c[c.indexOf('-n') + 1])).toEqual(['relay', 'monitoring']);
    expect(deps.calls.filter((c) => c[1] === 'nodes')).toHaveLength(1);
  });

  test('produces entities with namespace parents, a cluster root, and facts per kind', async () => {
    const ctx = testContext(config, fetch);
    const [batch] = await drain(createKubectlConnector(execDeps()).discover(ctx));
    const byId = new Map(batch?.entities.map((e) => [e.id, e]));
    expect(byId.get('cluster:home')?.type).toBe('cluster');
    expect(byId.get('namespace:relay')).toMatchObject({ type: 'namespace', parent: 'cluster:home', facts: { phase: 'Active' } });
    expect(byId.get('node:worker-a')).toMatchObject({ parent: 'cluster:home', facts: { kubelet: 'v1.31.2', instanceType: 'Standard_D4s_v5', roles: ['worker'], ready: true, internalIP: '10.0.1.4' } });
    expect(byId.get('node:worker-b')?.facts?.ready).toBe(false);
    expect(byId.get('deployment:relay/relay')).toMatchObject({ type: 'deployment', parent: 'namespace:relay', subtitle: 'relay', tags: ['deployment', 'workload'], facts: { replicas: 2, ready: 2, strategy: 'RollingUpdate', images: ['registry.example.test/relay:1.4.2'], serviceAccount: 'relay' } });
    expect(byId.get('daemonset:monitoring/node-exporter')?.facts).toMatchObject({ replicas: 2, ready: 2 });
    expect(byId.get('service:relay/relay')?.facts).toMatchObject({ type: 'ClusterIP', clusterIP: '10.96.12.4', ports: ['443/TCP->8443'] });
    expect(byId.get('ingress:relay/relay')?.facts).toMatchObject({ class: 'nginx', hosts: ['relay.example.test'], tls: ['relay.example.test'] });
    expect(byId.get('cronjob:relay/backup')?.facts).toMatchObject({ schedule: '0 3 * * *', suspend: false, lastSchedule: '2026-10-28T03:00:00Z' });
  });

  test('derives service selection, ingress routing, and config reads with synthesized configmaps and secrets', async () => {
    const ctx = testContext(config, fetch);
    const [batch] = await drain(createKubectlConnector(execDeps()).discover(ctx));
    const rels = batch?.relations ?? [];
    const pairs = (label: string) => rels.filter((r) => r.label === label).map((r) => `${r.from}>${r.to}`).sort();
    expect(pairs('routes to')).toEqual([
      'ingress:monitoring/grafana>service:monitoring/grafana',
      'ingress:relay/relay>service:relay/relay',
      'service:monitoring/grafana>deployment:monitoring/grafana',
      'service:relay/postgres>statefulset:relay/postgres',
      'service:relay/relay>deployment:relay/relay',
    ]);
    expect(pairs('reads')).toContain('deployment:relay/relay>secret:relay/relay-db');
    expect(pairs('reads')).toContain('deployment:relay/relay>secret:relay/registry-pull');
    expect(pairs('reads')).toContain('deployment:monitoring/grafana>configmap:monitoring/grafana-datasources');
    expect(pairs('reads')).toContain('cronjob:relay/backup>configmap:relay/backup-config');
    const secret = batch?.entities.find((e) => e.id === 'secret:relay/relay-db');
    expect(secret).toMatchObject({ type: 'secret', parent: 'namespace:relay', tags: ['secret', 'referenced'], facts: {} });
    expect(rels.some((r) => r.from === 'service:default/kubernetes')).toBe(false);
  });
});

describe('kubectl connector, in-cluster mode', () => {
  const config = KubectlConfigSchema.parse({ mode: 'in-cluster', server: 'https://10.96.0.1', tokenPath: `${dir}/token`, caPath: `${dir}/ca.crt`, resources: ['Namespace', 'Deployment', 'Service'] });

  test('calls the API server with the service account token and CA', async () => {
    const f = fixtureFetch(dir, [
      { match: '/api/v1/namespaces', file: 'namespaces.json' },
      { match: '/apis/apps/v1/deployments', file: 'deployments.json' },
      { match: '/api/v1/services', file: 'services.json' },
    ]);
    const deps: KubectlDeps = { exec: async () => { throw new Error('in-cluster mode spawns nothing'); }, readFile: async (p) => readFileSync(p, 'utf8') };
    const ctx = testContext(config, f.fetch);
    const [batch] = await drain(createKubectlConnector(deps).discover(ctx));
    expect(f.calls.map((c) => c.url)).toEqual(['https://10.96.0.1/api/v1/namespaces', 'https://10.96.0.1/apis/apps/v1/deployments', 'https://10.96.0.1/api/v1/services']);
    expect(f.calls.every((c) => c.headers.authorization === 'Bearer sa-token-value')).toBe(true);
    const tls = (f.calls[0]?.init as { tls?: { ca?: string } } | undefined)?.tls;
    expect(tls?.ca).toContain('BEGIN CERTIFICATE');
    expect(batch?.entities.find((e) => e.id === 'cluster:10.96.0.1')).toBeDefined();
    expect(batch?.relations.filter((r) => r.label === 'routes to')).toHaveLength(2);
  });

  test('reads namespaced resources per configured namespace', async () => {
    const f = fixtureFetch(dir, [
      { match: '/api/v1/namespaces/relay/services', file: 'services.json' },
      { match: /\/api\/v1\/namespaces$/, file: 'namespaces.json' },
      { match: '/namespaces/relay/deployments', file: 'deployments.json' },
    ]);
    const deps: KubectlDeps = { exec: async () => '', readFile: async (p) => readFileSync(p, 'utf8') };
    await drain(createKubectlConnector(deps).discover(testContext({ ...config, namespaces: ['relay'] }, f.fetch)));
    expect(f.calls.map((c) => new URL(c.url).pathname)).toEqual(['/api/v1/namespaces', '/apis/apps/v1/namespaces/relay/deployments', '/api/v1/namespaces/relay/services']);
  });
});

describe('configReferences', () => {
  test('finds every reference shape and dedupes', () => {
    const spec = {
      volumes: [{ configMap: { name: 'a' } }, { secret: { secretName: 's' } }, { projected: { sources: [{ configMap: { name: 'a' } }, { secret: { name: 't' } }] } }],
      containers: [{ envFrom: [{ configMapRef: { name: 'b' } }], env: [{ valueFrom: { secretKeyRef: { name: 'u' } } }, { valueFrom: { configMapKeyRef: { name: 'c' } } }] }],
      initContainers: [{ envFrom: [{ secretRef: { name: 'v' } }] }],
      imagePullSecrets: [{ name: 'pull' }],
    };
    expect(configReferences(spec).map((r) => `${r.kind}:${r.name}`).sort()).toEqual(['configmap:a', 'configmap:b', 'configmap:c', 'secret:pull', 'secret:s', 'secret:t', 'secret:u', 'secret:v']);
  });
});
