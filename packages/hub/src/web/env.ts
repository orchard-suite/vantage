/** The Hono environment: what middleware sets on a request for routes to read. */
import type { Principal } from '../auth/principal.ts';

export interface HubVariables {
  principal?: Principal;
  csrf?: string;
  requestId: string;
  nonce: string;
}

export type HubEnv = { Variables: HubVariables };
