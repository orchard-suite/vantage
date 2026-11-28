/** Who is calling, resolved once per request from a token, a session, or a trusted header. */
import type { Surface } from '../audit.ts';

export type TokenKind = 'personal' | 'automation';
export type Role = 'viewer' | 'author';

export interface TokenScope {
  /** Automation tokens: the one workspace they may touch, at this role. */
  readonly workspaceId?: string;
  readonly role?: Role;
}

export interface Principal {
  readonly userId: string;
  readonly orgId: string;
  readonly subject: string;
  readonly admin: boolean;
  readonly teamIds: readonly string[];
  readonly surface: Surface;
  /** issuer: an access token the OIDC issuer signed for this hub, acting as the person. connector: an app-only token a connector's own client got from the issuer. */
  readonly via: 'session' | 'proxy' | 'token' | 'issuer' | 'connector' | 'none';
  readonly token?: { readonly id: string; readonly kind: TokenKind; readonly scope: TokenScope };
  /** A connector's OAuth client: it may read and push to the connectors registered with this client id, and nothing else. With pool, the shared runner pool's own app: it leases runs and acts as no connector. */
  readonly connector?: { readonly clientId: string; readonly pool?: true };
  /** A module's own app, working the kinds an admin registered for its client: no person, no workspace role, never a move a lifecycle gives a person. */
  readonly module?: { readonly clientId: string };
  /** For a person who signed in through another app's client (a module acting for them): that client, recorded on what they change. */
  readonly client?: string;
  /** The agent acting for this person (VAN-2009): its token or grant names it. Absent for a person's own act. */
  readonly agent?: { readonly id: string; readonly label: string };
  /** The run the call belongs to, as the caller sent it in the run header (RUN_HEADER in @vantage/mcp): one working session of one agent. */
  readonly run?: string;
  /** A person's pick of light or dark, read with the rest of their row; absent follows their system. */
  readonly theme?: 'light' | 'dark';
}

export function describe(p: Principal): string {
  if (p.connector) return `connector-client:${p.connector.clientId}`;
  return p.token ? `user:${p.userId} token:${p.token.id}` : `user:${p.userId}`;
}

/**
 * The run a call belongs to (VAN-2009): the run the caller named; with
 * none, its agent; with no agent either, the person. A claim belongs to one
 * run, so two runs for one person never both hold an item.
 */
export function runOf(p: Pick<Principal, 'run' | 'agent' | 'userId'>): string {
  return p.run ?? (p.agent ? `agent:${p.agent.id}` : `user:${p.userId}`);
}

/** Whether an agent makes the call: its token names one, or it came through the agent door with a token an issuer signed. */
export function isAgent(p: Pick<Principal, 'agent' | 'surface'>): boolean {
  return !!p.agent || p.surface === 'mcp';
}
