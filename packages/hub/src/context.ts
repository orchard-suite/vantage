/** Everything a request handler or a job needs, built once at start. */
import type { Tracer } from '@opentelemetry/api';
import type { ConnectorRegistry } from '@vantage/connectors';
import type { TargetRegistry } from '@vantage/publish';
import type { Config } from './config.ts';
import type { Db } from './db/db.ts';
import type { BlobStore } from './blob/blob.ts';
import type { Logger } from './log.ts';
import type { HubMetrics } from './metrics.ts';
import type { RenderPool } from './render/pool.ts';
import type { IssuerTokens } from './auth/issuer-token.ts';
import type { ConnectorTokens } from './auth/connector-token.ts';
import type { ModelProvider } from './revise/provider.ts';

export interface AppContext {
  readonly config: Config;
  readonly db: Db;
  /**
   * Where reads that tolerate a moment of replication lag go: page lists,
   * search, the bundle. The primary when no replica is
   * configured. Writes, jobs, and anything read right after a write use db.
   */
  readonly dbRead: Db;
  readonly blob: BlobStore;
  readonly log: Logger;
  readonly tracer: Tracer;
  readonly metrics: HubMetrics;
  /** The connectors a source may name. */
  readonly connectors: ConnectorRegistry;
  /** The targets a publication may name. */
  readonly targets: TargetRegistry;
  /** What connectors and targets reach the network with; tests hand in a recorded one. */
  readonly fetch: typeof fetch;
  /** Where drawing runs, off the event loop. */
  readonly render: RenderPool;
  /** The model API the organization pays for, when AI_BASE_URL is set; revisions call it. */
  readonly ai?: ModelProvider | undefined;
  /** Access tokens the OIDC issuer signs for this hub, when OIDC_API_SCOPE is set. */
  readonly issuerTokens?: IssuerTokens | undefined;
  /** App-only access tokens connectors' own clients get from the issuer, when the hub has an issuer and an audience for them. */
  readonly connectorTokens?: ConnectorTokens | undefined;
}
