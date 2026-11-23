/**
 * Device code flow for agents and CLIs: the client asks for a code, the
 * person approves it in the browser, the client polls and receives a
 * personal token once. The token waits sealed with SECRETS_KEY until it
 * is picked up, then the row is deleted.
 */
import type { Db } from '../db/db.ts';
import { maybe } from '../db/db.ts';
import { open, randomId, seal } from '../crypto.ts';
import { createToken } from './tokens.ts';
import type { Logger } from '../log.ts';

const DEVICE_MINUTES = 15;

export interface DeviceStart {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly expiresIn: number;
}

export async function startDevice(db: Db, orgId: string, name: string): Promise<DeviceStart> {
  const deviceCode = randomId(24);
  const userCode = randomId(4).replace(/[^a-zA-Z0-9]/g, 'x').slice(0, 6).toUpperCase();
  await db.query("insert into device_codes (device_code, user_code, org_id, name, expires_at) values ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval)", [deviceCode, userCode, orgId, name, String(DEVICE_MINUTES)]);
  return { deviceCode, userCode, expiresIn: DEVICE_MINUTES * 60 };
}

export async function approveDevice(db: Db, log: Logger, secretsKey: string, orgId: string, userCode: string, userId: string): Promise<boolean> {
  const row = await maybe<{ device_code: string; name: string }>(db, 'select device_code, name from device_codes where org_id = $1 and user_code = $2 and approved_by is null and expires_at > now()', [orgId, userCode.toUpperCase()]);
  if (!row) {
    log.warn('device.approve.unknown', { userCode });
    return false;
  }
  const { plaintext, row: token } = await createToken(db, { orgId, userId, kind: 'personal', name: row.name });
  await db.query('update device_codes set approved_by = $2, sealed_token = $3 where device_code = $1', [row.device_code, userId, await seal(secretsKey, plaintext)]);
  log.info('device.approved', { userId, tokenId: token.id });
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
