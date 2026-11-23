/**
 * Types for boxes a drawing did not type: read from the label and the
 * shape the author drew. A guess is a starting point the reader can
 * change before saving; a box with no clear signal keeps no type.
 */
import type { NodeInput } from '@vantage/model';

/** Label words to a type, first match wins: specific before general. */
const WORDS: readonly [RegExp, string][] = [
  [/\b(users?|customers?|shoppers?|visitors?|people|clients?)\b/i, 'users'],
  [/\b(admin|operator|engineer|developer|analyst|person|actor|ops team|support)\b/i, 'actor'],
  [/\b(redis|memcached?|cache)\b/i, 'cache'],
  [/\b(kafka|event ?hubs?|topic|pub ?sub|sns)\b/i, 'topic'],
  [/\b(queue|service ?bus|sqs|rabbit ?mq|mq)\b/i, 'queue'],
  [/\b(elastic(search)?|opensearch|solr|search index)\b/i, 'search'],
  [/\b(blob|bucket|s3|storage|file share|data ?lake)\b/i, 'storage'],
  [/\b(db|database|sql|postgres(ql)?|mysql|mongo(db)?|cosmos|dynamo(db)?|oracle|mariadb|warehouse|snowflake)\b/i, 'database'],
  [/\b(key ?vault|secrets?|vault)\b/i, 'secret'],
  [/\b(entra|active directory|ad|okta|auth0?|identity|sso|idp|login)\b/i, 'identity'],
  [/\b(grafana|prometheus|datadog|monitor(ing)?|logs?|logging|app insights|observability)\b/i, 'monitoring'],
  [/\b(cdn|front ?door|cloudfront|akamai)\b/i, 'cdn'],
  [/\b(dns|route ?53)\b/i, 'dns'],
  [/\b(firewall|waf|nsg)\b/i, 'firewall'],
  [/\b(load ?balancer|lb|alb|nlb|app gateway|application gateway)\b/i, 'loadbalancer'],
  [/\b(gateway|api ?management|apim|ingress|proxy)\b/i, 'gateway'],
  [/\b(vpn|tunnel|express ?route)\b/i, 'tunnel'],
  [/\b(function|lambda|serverless)\b/i, 'function'],
  [/\b(worker|consumer|processor)\b/i, 'worker'],
  [/\b(job|cron|batch|scheduler)\b/i, 'job'],
  [/\b(pipeline|ci|cd|github actions|azure devops|jenkins)\b/i, 'pipeline'],
  [/\b(repo(sitory)?|github|gitlab|bitbucket)\b/i, 'repo'],
  [/\b(registry|acr|ecr|harbor|ghcr)\b/i, 'registry'],
  [/\b(llm|openai|gpt|claude|model)\b/i, 'model'],
  [/\b(mobile|ios|android|phone)\b/i, 'mobile'],
  [/\b(web ?app|website|web|frontend|front end|portal|spa|browser|ui)\b/i, 'web'],
  [/\b(api|rest|graphql|endpoint|backend)\b/i, 'api'],
  [/\b(vm|virtual machine|server|host)\b/i, 'vm'],
  [/\b(stripe|paypal|twilio|sendgrid|salesforce|third[- ]party|external|partner|vendor|saas)\b/i, 'external'],
  [/\b(service|svc|microservice)\b/i, 'service'],
];

/** Boundary words for boxes that hold others. */
const BOUNDARIES: readonly [RegExp, string][] = [
  [/\b(subnet)\b/i, 'subnet'],
  [/\b(vnet|vpc|virtual network|network|dmz)\b/i, 'network'],
  [/\b(aks|eks|gke|k8s|kubernetes|cluster)\b/i, 'cluster'],
  [/\b(namespace)\b/i, 'namespace'],
  [/\b(resource group|rg-)/i, 'resourcegroup'],
  [/\b(subscription|sub-|account)\b/i, 'subscription'],
  [/\b(region|east ?us|west ?us|eu[- ]west|us[- ]east)\b/i, 'region'],
  [/\b(azure|aws|gcp|google cloud|cloud)\b/i, 'cloud'],
];

/** What a drawn shape says when the label says nothing. */
const SHAPES: Readonly<Record<string, string>> = { cylinder: 'database', person: 'actor', cloud: 'cloud', document: 'file' };

/** The default shape of each guessable type: a drawn shape equal to it is dropped so the type draws itself. */
const NATIVE: Readonly<Record<string, string>> = { database: 'cylinder', cache: 'cylinder', storage: 'cylinder', search: 'cylinder', queue: 'queue', topic: 'queue', actor: 'person', users: 'person', cloud: 'cloud', cdn: 'cloud', file: 'document' };

export function guessType(name: string, shape: string | undefined, container: boolean): string | undefined {
  const table = container ? BOUNDARIES : WORDS;
  for (const [re, type] of table) if (re.test(name)) return type;
  return shape ? SHAPES[shape] : undefined;
}

export interface Guess {
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

/**
 * Types every untyped box in place; `overrides` (box id to type, empty to
 * leave untyped) wins over the guess. Returns what was typed and why.
 */
export function applyTypes(nodes: NodeInput[], overrides: Readonly<Record<string, string>> = {}): Guess[] {
  const out: Guess[] = [];
  const walk = (list: NodeInput[]): void => {
    for (const n of list) {
      const kids = (n.children ?? []) as NodeInput[];
      const id = String(n.id ?? '');
      if (n.type === undefined && n.icon === undefined) {
        const asked = id in overrides ? overrides[id] : undefined;
        const type = asked !== undefined ? asked || undefined : guessType(String(n.name ?? ''), typeof n.shape === 'string' ? n.shape : undefined, kids.length > 0);
        if (type) {
          n.type = type;
          if (typeof n.shape === 'string' && NATIVE[type] === n.shape) delete n.shape;
          out.push({ id, name: String(n.name ?? id), type });
        }
      }
      if (kids.length) walk(kids);
    }
  };
  walk(nodes);
  return out;
}
