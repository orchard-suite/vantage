/**
 * Fills the scope tree from the catalog. The catalog connector the setting
 * names reads the organization's kinds like any other entities: a parent
 * by its containment relation, a steward by the relation the setting
 * names per kind, and facets from one field. Each run that stores what it
 * read folds that connector's observed entities of those kinds into the
 * hub's copy, which no edit changes.
 */
import type { ObservedModel } from '@vantage/connectors';
import type { AppContext } from '../context.ts';
import { connectorIn, observedModel, type SourceRow } from '../sources/repo.ts';
import { workspaceBySlug } from '../authz.ts';
import { replaceScopes, type Scope } from './repo.ts';
import { scopeSetting, type CatalogSetting } from './setting.ts';

/** The kind of an observed entity among the kinds that are scopes: its type, or the tag its connector gave it. */
function kindOf(tags: readonly string[], type: string, kinds: readonly string[]): string | undefined {
  return kinds.find((k) => k === type) ?? kinds.find((k) => tags.includes(k));
}

function facetsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
  if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean);
  return [];
}

/** The scopes an observed model holds, by the setting: present entities of its kinds only. */
export function scopesFromCatalog(model: ObservedModel, setting: CatalogSetting): Scope[] {
  const present = Object.values(model.entities).filter((e) => e.missingSince === undefined);
  const picked = present.flatMap((e) => {
    const kind = kindOf(e.tags, e.type, setting.kinds);
    return kind ? [{ e, kind }] : [];
  });
  const ids = new Set(picked.map((x) => x.e.id));
  const relations = Object.values(model.relations).filter((r) => r.missingSince === undefined);
  return picked.map(({ e, kind }): Scope => {
    const via = setting.steward[kind];
    const steward = via === undefined ? undefined : relations.find((r) => r.from === e.id && r.label === via)?.to;
    return {
      id: e.id,
      name: e.name,
      kind,
      ...(e.parent !== undefined && ids.has(e.parent) ? { parent: e.parent } : {}),
      ...(steward !== undefined ? { steward } : {}),
      facets: facetsOf(e.facts[setting.facets]),
      ...(e.url !== undefined ? { url: e.url } : {}),
    };
  });
}

/** The connector a catalog setting names, when it is there. */
export async function catalogConnector(ctx: AppContext, orgId: string, setting: CatalogSetting): Promise<SourceRow | undefined> {
  const [workspace, connector] = setting.connector.split('/') as [string, string];
  const ws = await workspaceBySlug(ctx.db, orgId, workspace);
  return ws ? connectorIn(ctx.db, ws.id, connector) : undefined;
}

/** Refills the organization's tree from its catalog connector; a no-op unless the setting names `only` (when given) as that connector. */
export async function fillFromCatalog(ctx: AppContext, orgId: string, only?: SourceRow): Promise<{ scopes: number } | undefined> {
  const setting = await scopeSetting(ctx.db, orgId);
  if (setting.source !== 'catalog') return undefined;
  const source = await catalogConnector(ctx, orgId, setting.catalog);
  if (!source || (only && only.id !== source.id)) return undefined;
  const scopes = scopesFromCatalog((await observedModel(ctx.db, source.id)).model, setting.catalog);
  const counts = await replaceScopes(ctx.db, orgId, 'catalog', scopes);
  ctx.log.info('scopes.catalog.filled', { orgId, source: setting.catalog.connector, scopes: scopes.length, ...counts });
  return { scopes: scopes.length };
}
