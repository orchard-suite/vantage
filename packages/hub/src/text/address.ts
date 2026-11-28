/**
 * An address names one thing in the hub: a workspace, a document, a page,
 * a registry, a decision record, a kind, an item, the scope tree, the
 * estate's standard settings, one scope's built standard, the guide, or
 * the schema.
 * A part after `#` names a piece of it. Prefixes are upper case and
 * workspace slugs lower case, so an address needs no type beside it; a
 * prefix is a registry's or a kind's, never both, and placeAddress asks the
 * hub which.
 */
import { PREFIX_PATTERN, isUlid } from '@vantage/model';
import { badRequest } from '../http.ts';

export type Address =
  | { readonly kind: 'root' }
  | { readonly kind: 'guide' | 'schema'; readonly part?: string }
  /** The organization's tree of owner scopes, and the workspace each one owns. */
  | { readonly kind: 'scopes'; readonly part?: string }
  /** The estate's standard settings, and the root of every scope's standard. */
  | { readonly kind: 'standards'; readonly part?: string }
  /** One scope's built standard, `estate` for the whole estate, with `@<n>` for one edition. */
  | { readonly kind: 'standard'; readonly scope: string; readonly part?: string }
  | { readonly kind: 'workspace'; readonly workspace: string }
  | { readonly kind: 'document'; readonly workspace: string; readonly document: string; readonly part?: string }
  | { readonly kind: 'page'; readonly workspace: string; readonly document: string; readonly page: string; readonly part?: string }
  | { readonly kind: 'registry'; readonly prefix: string; readonly part?: string }
  | { readonly kind: 'record'; readonly ref: string; readonly part?: string }
  /** A kind's prefix, once the hub knows it names a kind and not a registry. */
  | { readonly kind: 'kind'; readonly prefix: string; readonly part?: string }
  /** An item's key, once the hub knows its prefix names a kind. */
  | { readonly kind: 'item'; readonly key: string; readonly part?: string };

/** The person's own workspace, in an address. */
export const PERSONAL = '~';

/** A record's citation or an item's key: they share one namespace of prefixes, and the hub tells them apart by the prefix. */
const RECORD = /^[A-Z][A-Z0-9]{1,11}-\d{1,9}$/;

export function parseAddress(text: string | undefined): Address {
  const raw = (text ?? '').trim();
  if (raw === '' || raw === '/') return { kind: 'root' };
  const hash = raw.indexOf('#');
  const head = (hash < 0 ? raw : raw.slice(0, hash)).replace(/^\/+|\/+$/g, '');
  const part = hash < 0 ? undefined : raw.slice(hash + 1).trim() || undefined;
  const withPart = part === undefined ? {} : { part };
  if (head === 'guide' || head === 'schema') return { kind: head, ...withPart };
  if (head === 'scopes') return { kind: 'scopes', ...withPart };
  if (head === 'standard') return { kind: 'standards', ...withPart };
  if (head.startsWith('standard/')) return { kind: 'standard', scope: head.slice('standard/'.length), ...withPart };
  if (head.startsWith('adr:') && isUlid(head.slice(4))) return { kind: 'record', ref: head, ...withPart };
  if (RECORD.test(head)) return { kind: 'record', ref: head, ...withPart };
  if (PREFIX_PATTERN.test(head)) return { kind: 'registry', prefix: head, ...withPart };
  const [workspace, document, ...rest] = head.split('/');
  if (!workspace) throw badRequest(`${raw} is not an address`);
  if (document === undefined) {
    if (part !== undefined) throw badRequest(`a workspace has no parts; name a document: ${workspace}/<document>#${part}`);
    return { kind: 'workspace', workspace };
  }
  if (!document) throw badRequest(`${raw} is not an address`);
  if (rest.length) return { kind: 'page', workspace, document, page: rest.join('/'), ...withPart };
  return { kind: 'document', workspace, document, ...withPart };
}

/** An address as text, without its part. */
export function thingAddress(a: Address): string {
  switch (a.kind) {
    case 'root':
      return '';
    case 'guide':
    case 'schema':
    case 'scopes':
      return a.kind;
    case 'standards':
      return 'standard';
    case 'standard':
      return `standard/${a.scope}`;
    case 'workspace':
      return a.workspace;
    case 'document':
      return `${a.workspace}/${a.document}`;
    case 'page':
      return `${a.workspace}/${a.document}/${a.page}`;
    case 'registry':
      return a.prefix;
    case 'record':
      return a.ref;
    case 'kind':
      return a.prefix;
    case 'item':
      return a.key;
  }
}

export function partOf(a: Address): string | undefined {
  return 'part' in a ? a.part : undefined;
}
