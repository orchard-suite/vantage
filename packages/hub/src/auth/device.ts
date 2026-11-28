/**
 * Device code flow for agents and CLIs: the client asks for a code, the
 * person approves it in the browser, the client polls and receives a
 * personal token once. The token waits sealed with SECRETS_KEY until it
 * is picked up, then the row is deleted. Approving makes the agent the
 * token signs in (VAN-2009): named by the client, on its host.
 */
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import { open, randomId, seal } from '../crypto.ts';
import { createToken } from './tokens.ts';
import { createAgent } from './agents.ts';
import type { Logger } from '../log.ts';

const DEVICE_MINUTES = 15;

export interface DeviceStart {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly expiresIn: number;
}

/** What a device says about itself: the token's name, and the agent's client and host. */
export interface DeviceAsk {
  readonly name: string;
  readonly client?: string | undefined;
  readonly host?: string | undefined;
}

export async function startDevice(db: Db, orgId: string, ask: DeviceAsk): Promise<DeviceStart> {
  const deviceCode = randomId(24);
  const userCode = randomId(4).replace(/[^a-zA-Z0-9]/g, 'x').slice(0, 6).toUpperCase();
  await db.query("insert into device_codes (device_code, user_code, org_id, name, client, host, expires_at) values ($1, $2, $3, $4, $5, $6, now() + ($7 || ' minutes')::interval)", [deviceCode, userCode, orgId, ask.name.slice(0, 200), ask.client?.slice(0, 200) ?? null, ask.host?.slice(0, 120) ?? null, String(DEVICE_MINUTES)]);
  return { deviceCode, userCode, expiresIn: DEVICE_MINUTES * 60 };
}

export async function approveDevice(db: Db, log: Logger, secretsKey: string, orgId: string, userCode: string, userId: string): Promise<boolean> {
  const row = await maybe<{ device_code: string; name: string; client: string | null; host: string | null }>(db, 'select device_code, name, client, host from device_codes where org_id = $1 and user_code = $2 and approved_by is null and expires_at > now()', [orgId, userCode.toUpperCase()]);
  if (!row) {
    log.warn('device.approve.unknown', { userCode });
    return false;
  }
  // The agent goes by its client's name; a device that names no client is known by the token's name.
  const agent = await createAgent(db, { orgId, userId, name: row.client ?? row.name, client: row.client ?? 'device', host: row.host });
  const { plaintext, row: token } = await createToken(db, { orgId, userId, kind: 'personal', name: row.name, agentId: agent.id });
  await db.query('update device_codes set approved_by = $2, sealed_token = $3 where device_code = $1', [row.device_code, userId, await seal(secretsKey, plaintext)]);
  log.info('device.approved', { userId, tokenId: token.id, agentId: agent.id });
  return true;
}

export type DevicePoll = { status: 'pending' } | { status: 'expired' } | { status: 'approved'; token: string };

export async function pollDevice(db: Db, secretsKey: string, deviceCode: string): Promise<DevicePoll> {
  const row = await maybe<{ sealed_token: string | null; expires_at: Date }>(db, 'select sealed_token, expires_at from device_codes where device_code = $1', [deviceCode]);
  if (!row || row.expires_at.getTime() < Date.now()) return { status: 'expired' };
  if (!row.sealed_token) return { status: 'pending' };
  const token = await open(secretsKey, row.sealed_token);
  await db.query('delete from device_codes where device_code = $1', [deviceCode]);
  return token ? { status: 'approved', token } : { status: 'expired' };
}
