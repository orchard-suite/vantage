/**
 * What an edition of a scope's standard holds (VAN-3018): its lines, the
 * packs that check them, the exceptions in force, and the procedure pages
 * that cite them. The body is what the hash covers; the manifest says
 * where it sits and what it was built on, and never moves the hash.
 */
import { z } from 'zod';
import type { Position } from '../decisions/types.ts';

/** The whole estate, as an address names it: `standard/estate`. Stored as the empty scope key. */
export const ESTATE = 'estate';

/** A scope's key in the editions table: its id, or '' for the whole estate. */
export type ScopeKey = string;

export const scopeName = (key: ScopeKey): string => (key === '' ? ESTATE : key);
export const scopeKey = (name: string): ScopeKey => (name === ESTATE ? '' : name);

/** Joins a workspace's owner and the program it serves in the key of the edition that binds it (VAN-3017). */
export const PAIR = '+';

/** The key of the edition that binds a workspace: its owner's, or its owner and program's. */
export const bindingKey = (owner: ScopeKey, program: string | null): ScopeKey => (program === null ? owner : `${scopeName(owner)}${PAIR}${program}`);

/** The same, as an address names it after standard/. */
export const bindingName = (owner: string | null, program: string | null): string => scopeName(bindingKey(owner ?? '', program));

/** One line of a standard: a record's position, where it came from, and how it reached this scope. */
export interface StandardLine {
  /** The record's id, which survives a move. */
  readonly record: string;
  /** Its citation when the edition was built. */
  readonly ref: string;
  readonly title: string;
  /** The record's category name: a scope's areas are its registries' categories. */
  readonly area: string;
  /** The workspace that holds the record. */
  readonly workspace: string;
  /** The scope the line belongs to. */
  readonly from: ScopeKey;
  /** The scopes it came down through, nearest first, ending at `from`; empty for the scope's own line. */
  readonly path: readonly ScopeKey[];
  /** The facet that brought it in from elsewhere in the tree, when one did. */
  readonly facet?: string;
  readonly position: Position;
  /** The lines its record departs from, by record id; absent when none (VAN-3019). */
  readonly departs?: readonly string[];
  /** The open conflict that holds this line back here under the clash rule, by number; absent while it is in force. */
  readonly held?: number;
  /** The program it binds a workspace through, in an owner and program edition; absent when it came through the owner. */
  readonly program?: ScopeKey;
}

export const PACK_ORIGINS = ['starter', 'estate'] as const;

/** A pack a scope adopts, as its steward writes it in the estate's settings. */
export const PackSchema = z
  .object({
    pack: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]*$/, 'a pack id is lower case: letters, digits, dot, dash, underscore'),
    version: z.string().trim().min(1).max(40),
    hash: z.string().trim().regex(/^sha256:[0-9a-f]{64}$/, 'a pack is pinned by sha256:<64 hex>'),
    origin: z.enum(PACK_ORIGINS).describe("starter: a judge's built-in set the scope adopted; estate: the estate's own"),
    parameters: z.record(z.string(), z.unknown()).default({}),
    on: z.boolean().default(true),
  })
  .strict();
export type Pack = z.output<typeof PackSchema>;

/** A pack an edition carries: the pin the judge installs by version and hash, and the scope that adopted it. */
export interface PackPin extends Pack {
  readonly from: ScopeKey;
}

/** A page that explains a line, carried by its address; its text stays its document's. */
export interface PagePin {
  /** workspace/document/file */
  readonly page: string;
  readonly title: string;
  /** The citations of the lines it cites. */
  readonly cites: readonly string[];
}

/** An exception in force (VAN-3020). None is granted until exceptions are records. */
export type ExceptionPin = never;

/** An open conflict between two lines of an edition, and which one holds under the clash rule. */
export interface ConflictPin {
  readonly conflict: number;
  /** The two lines' citations. */
  readonly lines: readonly [string, string];
  /** The citation of the line that holds, or both while the ruling waits. */
  readonly holds: string;
}

export const BOTH = 'both';

export interface EditionBody {
  readonly lines: readonly StandardLine[];
  readonly packs: readonly PackPin[];
  readonly exceptions: readonly ExceptionPin[];
  readonly pages: readonly PagePin[];
  /** Present only when a conflict is open, so an edition with none keeps its hash. */
  readonly conflicts?: readonly ConflictPin[];
}

export const EMPTY_BODY: EditionBody = { lines: [], packs: [], exceptions: [], pages: [] };

export interface Manifest {
  readonly scope: string;
  readonly name: string;
  readonly kind: string;
  readonly steward?: string;
  /** The editions of the scopes it took lines from, as they stood when it was built. */
  readonly builds_on: readonly { readonly scope: string; readonly version: number }[];
}

export type Change =
  | { readonly what: 'line'; readonly change: 'added' | 'removed' | 'changed'; readonly ref: string; readonly line: string }
  | { readonly what: 'pack'; readonly change: 'added' | 'removed' | 'changed'; readonly pack: string; readonly version: string }
  | { readonly what: 'page'; readonly change: 'added' | 'removed'; readonly page: string };

export type EditionState = 'published' | 'pending' | 'refused';

export interface Edition {
  readonly scope: ScopeKey;
  readonly version: number;
  readonly state: EditionState;
  /** sha256:<hex> over the body. */
  readonly hash: string;
  readonly body: EditionBody;
  readonly manifest: Manifest;
  readonly changes: readonly Change[];
  readonly problems: readonly string[];
  readonly builtAt: Date;
  readonly publishedAt: Date | null;
  readonly publishedBy: string | null;
}
