import type { Connector } from '../connector.ts';
import { createRegistry, type ConnectorRegistry } from '../connector.ts';
import { orreryConnector } from './orrery/orrery.ts';
import { kubectlConnector } from './kubectl/kubectl.ts';
import { cloudflareConnector } from './cloudflare/cloudflare.ts';
import { azureResourceGraphConnector } from './azure-resource-graph/azure-resource-graph.ts';
import { httpConnector } from './http/http.ts';
import { jiraConnector } from './jira/jira.ts';
import { githubConnector } from './github/github.ts';
import { gitConnector } from './git/git.ts';

export * from './orrery/orrery.ts';
export * from './kubectl/kubectl.ts';
export * from './cloudflare/cloudflare.ts';
export * from './azure-resource-graph/azure-resource-graph.ts';
export * from './http/http.ts';
export * from './jira/jira.ts';
export * from './github/github.ts';
export * from './git/git.ts';

/** Every built-in connector with its default dependencies. */
export function builtinConnectors(): Connector[] {
  return [orreryConnector, kubectlConnector, cloudflareConnector, azureResourceGraphConnector, httpConnector, jiraConnector, githubConnector, gitConnector] as Connector[];
}

export function defaultRegistry(): ConnectorRegistry {
  return createRegistry(builtinConnectors());
}
