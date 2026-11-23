/**
 * Reads a Kubernetes cluster two ways: through `kubectl get -o json` with
 * the current (or a named) kubeconfig context, or in-cluster through the
 * API server with the service account token and CA. Both paths produce the
 * same objects; `resources.ts` turns them into entities and relations.
 */
import { z } from 'zod';
import type { Batch, BatchEntity } from '../../batch.ts';
import { fetchJson, type Connector, type ConnectorContext } from '../../connector.ts';
import { clusterId, deriveRelations, KUBECTL_RESOURCES, RESOURCE_ROUTES, toEntity, type K8sList, type K8sObject, type KubectlResource } from './resources.ts';

export const KubectlConfigSchema = z
  .object({
    mode: z.enum(['kubeconfig', 'in-cluster']).default('kubeconfig'),
    context: z.string().optional().describe('kubeconfig context; default the current one'),
    kubeconfig: z.string().optional().describe('kubeconfig path; default the kubectl default'),
    server: z.string().url().default('https://kubernetes.default.svc').describe('In-cluster API server'),
    tokenPath: z.string().default('/var/run/secrets/kubernetes.io/serviceaccount/token'),
    caPath: z.string().default('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt'),
    namespaces: z.array(z.string()).optional().describe('Namespaces to read; default all'),
    resources: z.array(z.enum(KUBECTL_RESOURCES)).default([...KUBECTL_RESOURCES]),
    cluster: z.string().optional().describe('Name of the synthesized cluster entity; default the context or the server host'),
  })
  .strict();

export type KubectlConfig = z.output<typeof KubectlConfigSchema>;

export interface KubectlDeps {
  /** Runs kubectl with the given arguments and returns stdout. */
  readonly exec: (args: readonly string[], signal: AbortSignal) => Promise<string>;
  readonly readFile: (path: string) => Promise<string>;
}

export const defaultKubectlDeps: KubectlDeps = {
  exec: async (args, signal) => {
    const proc = Bun.spawn(['kubectl', ...args], { stdout: 'pipe', stderr: 'pipe' });
    const onAbort = (): void => proc.kill();
    signal.addEventListener('abort', onAbort, { once: true });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    signal.removeEventListener('abort', onAbort);
    if (code !== 0) throw new Error(`kubectl ${args.join(' ')} exited ${code}: ${err.trim().slice(0, 300)}`);
    return out;
  },
  readFile: (path) => Bun.file(path).text(),
};

interface Reader {
  (resource: KubectlResource, namespace: string | undefined): Promise<K8sObject[]>;
}

function kubeconfigReader(ctx: ConnectorContext<KubectlConfig>, deps: KubectlDeps): Reader {
  const { config } = ctx;
  return async (resource, namespace) => {
    const route = RESOURCE_ROUTES[resource];
    const args = ['get', route.plural, '-o', 'json'];
    if (route.namespaced) args.push(...(namespace !== undefined ? ['-n', namespace] : ['--all-namespaces']));
    if (config.context !== undefined) args.push('--context', config.context);
    if (config.kubeconfig !== undefined) args.push('--kubeconfig', config.kubeconfig);
    ctx.log.debug('kubectl exec', { args });
    const text = await deps.exec(args, ctx.signal);
    return (JSON.parse(text) as K8sList).items;
  };
}

async function inClusterReader(ctx: ConnectorContext<KubectlConfig>, deps: KubectlDeps): Promise<Reader> {
  const { config } = ctx;
  const token = (await deps.readFile(config.tokenPath)).trim();
  const ca = await deps.readFile(config.caPath);
  ctx.log.debug('in-cluster credentials read', { tokenPath: config.tokenPath, caPath: config.caPath, caBytes: ca.length });
  const base = config.server.replace(/\/$/, '');
  return async (resource, namespace) => {
    const route = RESOURCE_ROUTES[resource];
    const scope = route.namespaced && namespace !== undefined ? `/namespaces/${encodeURIComponent(namespace)}` : '';
    const url = `${base}/${route.api}${scope}/${route.plural}`;
    const list = await fetchJson<K8sList>(ctx, url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, tls: { ca } });
    return list.items;
  };
}

export function createKubectlConnector(deps: KubectlDeps = defaultKubectlDeps): Connector<KubectlConfig> {
  return {
    id: 'kubectl',
    configSchema: KubectlConfigSchema,
    // In-cluster it reads with the pod's own service account, and a kubeconfig is the machine's.
    hostIdentity: true,
    async *discover(ctx: ConnectorContext<KubectlConfig>): AsyncIterable<Batch> {
      const { config, log } = ctx;
      log.info('kubectl discover start', { mode: config.mode, resources: config.resources, namespaces: config.namespaces ?? 'all' });
      const read = config.mode === 'in-cluster' ? await inClusterReader(ctx, deps) : kubeconfigReader(ctx, deps);
      const cluster = config.cluster ?? config.context ?? new URL(config.server).hostname;
      const objects = new Map<KubectlResource, K8sObject[]>();
      for (const resource of config.resources) {
        const route = RESOURCE_ROUTES[resource];
        const scopes: (string | undefined)[] = route.namespaced && config.namespaces ? config.namespaces : [undefined];
        const items: K8sObject[] = [];
        for (const ns of scopes) {
          const got = await read(resource, ns);
          items.push(...got);
          log.debug('kubectl resource page', { resource, namespace: ns ?? 'all', items: got.length });
        }
        objects.set(resource, items);
        log.info('kubectl resource read', { resource, items: items.length });
      }
      const entities: BatchEntity[] = [{ id: clusterId(cluster), type: 'cluster', name: cluster, facts: { server: config.mode === 'in-cluster' ? config.server : config.context ?? 'current-context' }, tags: ['cluster'] }];
      for (const [resource, items] of objects) for (const o of items) entities.push(toEntity(resource, o, cluster));
      const derived = deriveRelations(objects);
      entities.push(...derived.entities);
      log.info('kubectl discover end', { entities: entities.length, synthesized: derived.entities.length, relations: derived.relations.length });
      yield { source: 'kubectl', observed: ctx.now().toISOString(), entities, relations: derived.relations };
    },
  };
}

export const kubectlConnector: Connector<KubectlConfig> = createKubectlConnector();
