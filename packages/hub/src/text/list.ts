/**
 * What sits under an address, as the files a working copy holds: each
 * thing with its address, its version, and the path it takes in the
 * folder. The layout is decided here, so the laptop holds no knowledge of
 * any kind of content.
 */
import { slug } from '@vantage/model';
import type { AppContext } from '../context.ts';
import type { Principal } from '../auth/principal.ts';
import { listDocuments } from '../documents/repo.ts';
import { listDecisions, listRegistries } from '../decisions/read.ts';
import { revisionsOf } from '../decisions/repo.ts';
import { formatNumber } from '@vantage/model';
import { badRequest } from '../http.ts';
import { sha256 } from '../crypto.ts';
import type { Address } from './address.ts';
import { recordAt, requireDocumentAt, workspaceAt } from './things.ts';
import { itemThing, placeAddress } from './items.ts';
import { find as findItems } from '../tracking/read.ts';

export interface Listed {
  readonly address: string;
  /** Where it sits in a working copy, relative to the folder. */
  readonly path: string;
  readonly version: string;
  /** The sha256 of its bytes, when the hub has it, so a reader can tell a file it already holds. */
  readonly hash?: string;
  /** A picture or another file that is not text; read with the file route. */
  readonly binary?: true;
  /** A file the document imports; kept so the folder draws, and never written back. */
  readonly readonly?: true;
}

const recordPath = (prefix: string, number: number, title: string): string => `decisions/${prefix}/${formatNumber(number)}-${slug(title) || 'record'}.md`;

async function documentThings(ctx: AppContext, p: Principal, a: { workspace: string; document: string }): Promise<Listed[]> {
  const { ws, doc, head } = await requireDocumentAt(ctx, p, a, 'viewer');
  const base = `${ws.slug}/${doc.slug}`;
  const out: Listed[] = [{ address: base, path: `${base}/${doc.slug}.vantage.yaml`, version: head.id, hash: await sha256(head.yaml) }];
  for (const f of head.attachments) out.push({ address: `${base}/${f.path}`, path: `${base}/${f.path}`, version: head.id, hash: f.hash, ...(/\.md$/i.test(f.path) ? {} : { binary: true as const }) });
  for (const path of Object.keys(head.imports ?? {})) out.push({ address: `${base}/${path}`, path: `${base}/${path.replace(/^\.\//, '')}`, version: head.id, readonly: true });
  return out;
}

async function registryThings(ctx: AppContext, p: Principal, prefix: string): Promise<Listed[]> {
  const out: Listed[] = [];
  for (const d of await listDecisions(ctx, p, prefix)) out.push({ address: d.ref, path: recordPath(d.registry, d.number, d.title), version: (await revisionsOf(ctx.db, d.id))[0]?.id ?? 'none' });
  return out;
}

const itemPath = (prefix: string, key: string, title: string): string => `work/${prefix}/${key}-${slug(title).slice(0, 60) || 'item'}.md`;

/** A kind's items as files, the newest first, up to a working copy's worth. */
async function kindThings(ctx: AppContext, p: Principal, prefix: string): Promise<Listed[]> {
  const page = await findItems(ctx, p, { kinds: [prefix], limit: 100 });
  const out: Listed[] = [];
  for (const r of page.rows) {
    const t = await itemThing(ctx, p, r.key);
    out.push({ address: r.key, path: itemPath(prefix, r.key, r.title), version: t.version, hash: await sha256(t.text) });
  }
  return out;
}

export async function listThings(ctx: AppContext, p: Principal, given: Address): Promise<Listed[]> {
  const a = await placeAddress(ctx, p, given);
  switch (a.kind) {
    case 'kind':
      return kindThings(ctx, p, a.prefix);
    case 'item': {
      const t = await itemThing(ctx, p, a.key);
      const title = /^title: (.*)$/m.exec(t.text)?.[1] ?? 'item';
      return [{ address: t.address, path: itemPath(a.key.slice(0, a.key.lastIndexOf('-')), t.address, title), version: t.version, hash: await sha256(t.text) }];
    }
    case 'document':
      return documentThings(ctx, p, a);
    case 'page':
      return (await documentThings(ctx, p, a)).filter((x) => x.address.endsWith(`/${a.page}`));
    case 'record': {
      const { decision: d, version } = await recordAt(ctx, p, a.ref);
      return [{ address: d.ref, path: recordPath(d.registry, d.number, d.title), version }];
    }
    case 'registry':
      return registryThings(ctx, p, a.prefix);
    case 'workspace': {
      const ws = await workspaceAt(ctx, p, a.workspace, 'viewer');
      const out: Listed[] = [];
      for (const d of await listDocuments(ctx.db, ws.id)) if (d.head_version_id) out.push(...(await documentThings(ctx, p, { workspace: ws.slug, document: d.slug })));
      for (const r of await listRegistries(ctx, p, ws.slug)) out.push(...(await registryThings(ctx, p, r.prefix)));
      return out;
    }
    default:
      throw badRequest('a working copy holds a document, a registry, a record, a kind, an item, or a workspace');
  }
}

/** The path a record's file takes, for one a write just made. */
export { recordPath };
