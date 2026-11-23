/**
 * Built-in node types. A type carries the defaults an author usually wants:
 * the icon, the color family, the shape, and a layout role.
 *
 * Roles drive the flow arrangement when relations alone cannot decide a
 * rank: actors sit at the start, edges next, then compute, then data, with
 * platform services beside and external systems at the far end.
 */
export type NodeRole =
  | 'actor'
  | 'edge'
  | 'compute'
  | 'data'
  | 'platform'
  | 'external'
  | 'boundary';

export type NodeShape = 'box' | 'rounded' | 'cylinder' | 'person' | 'cloud' | 'hexagon' | 'pill' | 'document' | 'queue' | 'ellipse' | 'circle' | 'diamond' | 'parallelogram' | 'triangle';
export const NODE_SHAPES = ['box', 'rounded', 'cylinder', 'person', 'cloud', 'hexagon', 'pill', 'document', 'queue', 'ellipse', 'circle', 'diamond', 'parallelogram', 'triangle'] as const;

export interface NodeType {
  readonly name: string;
  readonly role: NodeRole;
  readonly shape: NodeShape;
  readonly color: string;
  readonly icon?: string;
  /** Default frame: `none` for text and images, which are content, not boxes. */
  readonly frame?: 'box' | 'dashed' | 'none';
  readonly description: string;
}

const t = (name: string, role: NodeRole, shape: NodeShape, color: string, icon: string | undefined, description: string): NodeType =>
  icon === undefined ? { name, role, shape, color, description } : { name, role, shape, color, icon, description };

/** The catalog, keyed by type name. Icon ids are `pack/name` resolved by the icon registry. */
export const BUILTIN_TYPES: ReadonlyMap<string, NodeType> = new Map(
  [
    t('actor', 'actor', 'person', 'slate', 'generic/user', 'A person or role that uses the system'),
    t('users', 'actor', 'person', 'slate', 'generic/users', 'A group of people'),
    t('system', 'compute', 'rounded', 'blue', 'generic/system', 'A software system'),
    t('service', 'compute', 'rounded', 'blue', 'generic/service', 'A deployable service'),
    t('app', 'compute', 'rounded', 'blue', 'generic/app', 'An application'),
    t('web', 'edge', 'rounded', 'blue', 'generic/browser', 'A web front end or browser'),
    t('mobile', 'edge', 'rounded', 'blue', 'generic/mobile', 'A mobile client'),
    t('desktop', 'edge', 'rounded', 'blue', 'generic/desktop', 'A desktop client'),
    t('cli', 'edge', 'rounded', 'slate', 'generic/terminal', 'A command line tool'),
    t('api', 'compute', 'rounded', 'blue', 'generic/api', 'An API surface'),
    t('gateway', 'edge', 'rounded', 'violet', 'generic/gateway', 'An API gateway or ingress'),
    t('loadbalancer', 'edge', 'rounded', 'violet', 'generic/loadbalancer', 'A load balancer'),
    t('cdn', 'edge', 'cloud', 'violet', 'generic/cdn', 'A content delivery network'),
    t('dns', 'edge', 'rounded', 'violet', 'generic/dns', 'A DNS zone or resolver'),
    t('firewall', 'edge', 'rounded', 'red', 'generic/firewall', 'A firewall or WAF'),
    t('tunnel', 'edge', 'rounded', 'violet', 'generic/tunnel', 'A tunnel or VPN'),
    t('function', 'compute', 'rounded', 'amber', 'generic/function', 'A serverless function'),
    t('job', 'compute', 'rounded', 'amber', 'generic/job', 'A batch or scheduled job'),
    t('worker', 'compute', 'rounded', 'amber', 'generic/worker', 'A background worker'),
    t('agent', 'compute', 'rounded', 'teal', 'generic/agent', 'An AI agent or model-driven process'),
    t('model', 'external', 'rounded', 'teal', 'generic/model', 'An LLM or ML model endpoint'),
    t('database', 'data', 'cylinder', 'emerald', 'generic/database', 'A relational or document database'),
    t('cache', 'data', 'cylinder', 'emerald', 'generic/cache', 'A cache'),
    t('storage', 'data', 'cylinder', 'emerald', 'generic/storage', 'Object or file storage'),
    t('queue', 'data', 'queue', 'amber', 'generic/queue', 'A message queue'),
    t('topic', 'data', 'queue', 'amber', 'generic/topic', 'A pub/sub topic or event stream'),
    t('search', 'data', 'cylinder', 'emerald', 'generic/search', 'A search index'),
    t('secret', 'platform', 'rounded', 'red', 'generic/key', 'A secret store or key vault'),
    t('identity', 'platform', 'rounded', 'red', 'generic/identity', 'An identity provider'),
    t('monitoring', 'platform', 'rounded', 'slate', 'generic/monitoring', 'Logs, metrics, traces'),
    t('config', 'platform', 'rounded', 'slate', 'generic/config', 'Configuration store'),
    t('registry', 'platform', 'rounded', 'slate', 'generic/registry', 'A container or package registry'),
    t('repo', 'platform', 'rounded', 'slate', 'generic/repo', 'A source repository'),
    t('pipeline', 'platform', 'rounded', 'slate', 'generic/pipeline', 'A CI/CD pipeline'),
    t('gitops', 'platform', 'rounded', 'slate', 'generic/gitops', 'A GitOps controller'),
    t('cloud', 'boundary', 'cloud', 'slate', 'generic/cloud', 'A cloud provider boundary'),
    t('subscription', 'boundary', 'box', 'slate', 'generic/subscription', 'A billing or account boundary'),
    t('resourcegroup', 'boundary', 'box', 'slate', 'generic/folder', 'A resource group'),
    t('region', 'boundary', 'box', 'slate', 'generic/region', 'A region or site'),
    t('zone', 'boundary', 'box', 'slate', 'generic/zone', 'An availability zone'),
    t('network', 'boundary', 'box', 'violet', 'generic/network', 'A virtual network or VPC'),
    t('subnet', 'boundary', 'box', 'violet', 'generic/subnet', 'A subnet'),
    t('cluster', 'boundary', 'box', 'blue', 'generic/cluster', 'A compute cluster'),
    t('namespace', 'boundary', 'box', 'blue', 'generic/namespace', 'A namespace'),
    t('pod', 'compute', 'rounded', 'blue', 'generic/pod', 'A pod or workload instance'),
    t('vm', 'compute', 'rounded', 'blue', 'generic/vm', 'A virtual machine'),
    t('host', 'compute', 'box', 'slate', 'generic/host', 'A physical host'),
    t('device', 'edge', 'rounded', 'slate', 'generic/device', 'A physical device'),
    t('container', 'compute', 'rounded', 'blue', 'generic/container', 'A container image or runtime'),
    t('package', 'compute', 'rounded', 'slate', 'generic/package', 'A code package or module'),
    t('component', 'compute', 'rounded', 'slate', 'generic/component', 'A code component'),
    t('class', 'compute', 'box', 'slate', 'generic/class', 'A class or struct'),
    t('interface', 'compute', 'pill', 'slate', 'generic/interface', 'An interface or contract'),
    t('file', 'data', 'document', 'slate', 'generic/file', 'A file or document'),
    t('socket', 'compute', 'pill', 'slate', 'generic/socket', 'A socket or port'),
    t('external', 'external', 'rounded', 'slate', 'generic/external', 'A third party system'),
    t('group', 'boundary', 'box', 'slate', undefined, 'A logical grouping with no runtime meaning'),
    t('note', 'boundary', 'document', 'amber', undefined, 'A free text note'),
    { ...t('text', 'external', 'box', 'slate', undefined, 'Free text on the canvas, no box'), frame: 'none' as const },
    { ...t('image', 'external', 'box', 'slate', undefined, 'A picture: a logo, a screenshot, a photo'), frame: 'none' as const },
  ].map((x) => [x.name, x] as const),
);

export const DEFAULT_TYPE: NodeType = t('node', 'compute', 'rounded', 'slate', undefined, 'An untyped node');
