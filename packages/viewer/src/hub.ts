/** The viewer's client for the hub: every call carries the session's CSRF token and the expected version. */
import type { BundleHub, BundleView } from './bundle.ts';
import type { SteerAction } from './steer-actions.ts';
import type { DraftDiagnostic } from './editor/marks.ts';

export interface HubComment {
  readonly id: string;
  readonly view: string | null;
  /** The boxes of the view the comment points at; empty for the whole view. */
  readonly targets: readonly string[];
  /** May hold mentions as `<@id>`; `mentionLabels` names each id. */
  readonly text: string;
  readonly mentionLabels?: Readonly<Record<string, string>>;
  readonly author: string | null;
  readonly authorLabel: string | null;
  readonly resolvedBy: string | null;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
}

/** Someone who can read the document, so a comment can mention them. */
export interface HubPerson {
  readonly id: string;
  readonly label: string;
}

export type ReactionKind = 'up' | 'wrong' | 'question';

export interface KindTally {
  readonly count: number;
  readonly people: readonly HubPerson[];
  /** Whether the reader holds this one. */
  readonly mine: boolean;
}

/** The reactions on one box in one view; orphaned when the box is no longer in the view. */
export interface BoxReactions {
  readonly view: string;
  readonly box: string;
  readonly orphaned: boolean;
  readonly total: number;
  readonly kinds: Readonly<Record<ReactionKind, KindTally>>;
}

/** An item that adds, changes, or retires boxes or views of the document, as the reader may see it. */
export interface HubPlanItem {
  readonly key: string;
  readonly title: string;
  readonly state: string;
  readonly stateText: string;
  readonly class: 'not-started' | 'in-progress' | 'done' | 'parked';
  readonly horizon: string | null;
  readonly workspace: string;
  readonly effects: readonly { readonly rel: 'adds' | 'changes' | 'retires'; readonly id: string }[];
}

/** A decision record that governs boxes or views of the document, or that its YAML or pages cite. */
export interface HubDecision {
  readonly id: string;
  /** SHOP-2001 */
  readonly ref: string;
  readonly title: string;
  readonly status: 'proposed' | 'accepted' | 'deprecated' | 'superseded';
  /** The record's page on the hub. */
  readonly url: string;
  readonly boxes: readonly string[];
  readonly views: readonly string[];
}

export interface OpenCounts {
  readonly total: number;
  readonly byView: Readonly<Record<string, number>>;
  readonly byNode: Readonly<Record<string, number>>;
}

export interface HubVersion {
  readonly id: string;
  readonly message: string;
  readonly author: string | null;
  readonly authorLabel: string | null;
  readonly parent: string | null;
  readonly scores: Readonly<Record<string, number>>;
  readonly createdAt: string;
}

export interface SaveResponse {
  readonly status: 'saved' | 'unchanged';
  readonly version: { readonly id: string; readonly message: string };
  readonly message?: string;
}

export interface DiffChange {
  readonly kind: string;
  readonly id: string;
  readonly text: string;
}

export interface GuestLink {
  readonly id: string;
  readonly viewId: string | null;
  readonly expiresAt: string;
  readonly passcode: boolean;
  readonly opens: number;
  readonly createdAt: string;
  /** Only on the answer to a create: the link itself, which the hub does not keep. */
  readonly url?: string;
}

export interface ShareInfo {
  readonly canShare: boolean;
  readonly guestLinksAllowed: boolean;
  /** False when the hub turned guest links off everywhere; the dialog then offers no guest link tab at all. */
  readonly guestLinksOnHub: boolean;
  readonly guestLinks: readonly GuestLink[];
  readonly embedBase: string;
  readonly workspace: { readonly slug: string; readonly name: string; readonly kind: string; readonly url: string };
}

export type ExportFormat = 'png' | 'svg' | 'pdf' | 'html' | 'drawio' | 'vsdx';

export interface ExportOptions {
  readonly format: ExportFormat;
  /** View ids; omit for every view. */
  readonly views?: readonly string[];
  readonly theme: 'light' | 'dark' | 'print' | 'colorblind';
  readonly titleBlock: boolean;
}

export type RevisionState = 'queued' | 'running' | 'ready' | 'failed' | 'accepted' | 'rejected';

export interface HubRevision {
  readonly id: string;
  readonly state: RevisionState;
  readonly model: string;
  readonly comments: readonly string[];
  readonly summary: string | null;
  readonly addressed: readonly string[];
  readonly error: string | null;
  readonly tokens: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number };
}

/** What the reader has spent against each limit that applies to them; a null limit is none. Days and months are UTC. */
export interface Allowance {
  readonly blocked: boolean;
  readonly today: number;
  readonly daily: number | null;
  readonly month: number;
  readonly monthly: number | null;
  readonly orgMonth: number;
  readonly orgMonthly: number | null;
  /** The hub's time zone, in which a day starts at midnight and a month on the first. */
  readonly timeZone: string;
}

/** Whether this hub revises from comments, and what the reader may do with it. */
export type ReviseStatus =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly canRevise: boolean; readonly models: readonly string[]; readonly defaultModel: string; readonly allowance: Allowance; readonly latest: HubRevision | null };

/** Unsaved YAML drawn for the editor: the view as the stage takes it, its score, and the checker's problems with their lines. */
export interface DraftPicture {
  readonly view: string | null;
  readonly views: readonly { readonly id: string; readonly title: string }[];
  readonly diagnostics: readonly DraftDiagnostic[];
  readonly metrics: { readonly score: number; readonly notes: readonly string[] } | null;
  readonly entry: BundleView | null;
}

/** A save from the editor: saved (with the merged text when the head had moved), unchanged, or a conflict to resolve. */
export type SourceSave =
  | { readonly status: 'saved' | 'unchanged'; readonly version: { readonly id: string }; readonly merged?: boolean; readonly yaml?: string }
  | { readonly status: 'conflict'; readonly head: { readonly id: string }; readonly preview: string; readonly conflicts: number };

/** An edit merged over the head without saving. */
export interface SourceMerge {
  readonly status: 'current' | 'merged' | 'conflict';
  readonly head: string;
  readonly yaml: string;
  readonly conflicts: number;
}

export class HubError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: Record<string, unknown> | undefined,
  ) {
    super(message);
    this.name = 'HubError';
  }
}

export class HubClient {
  /** The head version the stage shows; writes name it so a stale panel gets a 409 instead of clobbering. */
  version: string;
  readonly canEdit: boolean;
  private readonly base: string;
  private readonly api: string;
  private readonly csrf: string | undefined;

  constructor(hub: BundleHub) {
    this.version = hub.version;
    this.canEdit = hub.canEdit;
    this.base = `${hub.apiBase}/documents/${encodeURIComponent(hub.documentId)}`;
    this.api = hub.apiBase;
    this.csrf = hub.csrf;
  }

  steer(action: SteerAction): Promise<SaveResponse> {
    return this.call<SaveResponse>('/steer', { action, expectedVersion: this.version });
  }

  restore(version: string): Promise<SaveResponse> {
    return this.call<SaveResponse>('/restore', { version, expectedVersion: this.version });
  }

  comments(): Promise<{ comments: HubComment[]; counts: OpenCounts }> {
    return this.call('/comments');
  }

  addComment(view: string, targets: readonly string[], text: string): Promise<HubComment> {
    return this.call<HubComment>('/comments', { text, view, targets });
  }

  resolveComment(id: string, resolved: boolean): Promise<HubComment> {
    return this.call<HubComment>(`/comments/${encodeURIComponent(id)}/resolve`, { resolved });
  }

  people(): Promise<{ people: HubPerson[] }> {
    return this.call('/people');
  }

  reactions(): Promise<{ reactions: BoxReactions[] }> {
    return this.call('/reactions');
  }

  addReaction(view: string, box: string, kind: ReactionKind, text?: string): Promise<unknown> {
    return this.call('/reactions', { view, box, kind, ...(text ? { text } : {}) });
  }

  removeReaction(view: string, box: string, kind: ReactionKind): Promise<unknown> {
    return this.call('/reactions', { view, box, kind }, 'DELETE');
  }

  /** The records that govern this document, and what each citation in `cite` names (citation to record id). */
  decisions(cite: readonly string[]): Promise<{ decisions: HubDecision[]; cited: Record<string, string> }> {
    return this.call(`/decisions${cite.length ? `?cite=${encodeURIComponent(cite.join(','))}` : ''}`);
  }

  /** The items the reader may see that add, change, or retire this document's boxes and views. */
  plan(): Promise<{ items: HubPlanItem[]; lifecycle?: { view: string; prefix: string; counts: Record<string, number> } }> {
    return this.call('/plan');
  }

  /** Items by key, as cards, for a page that names them; one the reader may not see answers an error in its place. */
  async items(keys: readonly string[]): Promise<{ items: ({ card: { key: string; title: string; state: string; stateText: string; class: string } } | { key: string; error: string })[] }> {
    const res = await fetch(`${this.api}/items?keys=${encodeURIComponent(keys.join(','))}`, { headers: { accept: 'application/json' }, credentials: 'same-origin' });
    if (!res.ok) throw new HubError(res.status, `request failed (${res.status})`, undefined);
    return (await res.json()) as { items: ({ card: { key: string; title: string; state: string; stateText: string; class: string } } | { key: string; error: string })[] };
  }

  /** The page of an item on the hub. */
  itemUrl(workspace: string, key: string): string {
    return `${this.api.replace(/\/api\/v1$/, '')}/w/${encodeURIComponent(workspace)}/work/${encodeURIComponent(key)}`;
  }

  versions(): Promise<{ head: string; versions: HubVersion[] }> {
    return this.call('/versions');
  }

  diffSvgUrl(a: string, b: string, view: string, theme: string): string {
    return `${this.base}/diff/${encodeURIComponent(a)}/${encodeURIComponent(b)}/${encodeURIComponent(view)}.svg?theme=${theme}`;
  }

  diffChanges(a: string, b: string, view: string): Promise<{ changes: DiffChange[] }> {
    return this.call(`/diff/${encodeURIComponent(a)}/${encodeURIComponent(b)}/${encodeURIComponent(view)}.json`);
  }

  reviseStatus(): Promise<ReviseStatus> {
    return this.call('/revise');
  }

  requestRevision(comments: readonly string[], model: string): Promise<HubRevision> {
    return this.call<HubRevision>('/revisions', { comments, model });
  }

  revision(id: string): Promise<HubRevision> {
    return this.call(`/revisions/${encodeURIComponent(id)}`);
  }

  revisionDiffSvgUrl(id: string, view: string, theme: string): string {
    return `${this.base}/revisions/${encodeURIComponent(id)}/diff/${encodeURIComponent(view)}.svg?theme=${theme}`;
  }

  acceptRevision(id: string): Promise<SaveResponse> {
    return this.call<SaveResponse>(`/revisions/${encodeURIComponent(id)}/accept`, {});
  }

  rejectRevision(id: string): Promise<HubRevision> {
    return this.call<HubRevision>(`/revisions/${encodeURIComponent(id)}/reject`, {});
  }

  source(): Promise<{ version: string; yaml: string }> {
    return this.call('/source');
  }

  draft(yaml: string, view: string | undefined, theme: 'light' | 'dark'): Promise<DraftPicture> {
    return this.call<DraftPicture>('/preview', { yaml, theme, ...(view ? { view } : {}) });
  }

  saveSource(yaml: string, message: string, expectedVersion: string): Promise<SourceSave> {
    return this.call<SourceSave>('/source', { yaml, message, expectedVersion }, undefined, [409]);
  }

  mergeSource(yaml: string, base: string): Promise<SourceMerge> {
    return this.call<SourceMerge>('/merge', { yaml, base });
  }

  share(): Promise<ShareInfo> {
    return this.call('/share');
  }

  createGuestLink(input: { expiresInHours: number; passcode?: string; view?: string }): Promise<GuestLink> {
    return this.call<GuestLink>('/guest-links', input);
  }

  revokeGuestLink(id: string): Promise<unknown> {
    return this.call(`/guest-links/${encodeURIComponent(id)}`, undefined, 'DELETE');
  }

  /** Deletes the document for good. */
  deleteDocument(): Promise<unknown> {
    return this.call('', undefined, 'DELETE');
  }

  /** A download address: the hub renders the file the way a publication would and names it. */
  exportUrl(o: ExportOptions): string {
    const q = new URLSearchParams({ format: o.format, theme: o.theme, titleBlock: String(o.titleBlock) });
    if (o.views?.length) q.set('views', o.views.join(','));
    return `${this.base}/export?${q.toString()}`;
  }

  /** GET without a body, POST with one (or the method given); JSON both ways, errors as HubError with the server's message unless `answers` lists the status. */
  private async call<T>(path: string, body?: Record<string, unknown>, method?: 'DELETE', answers: readonly number[] = []): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.csrf !== undefined) headers['x-csrf-token'] = this.csrf;
    const res = await fetch(`${this.base}${path}`, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers, credentials: 'same-origin', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok && !answers.includes(res.status)) throw new HubError(res.status, typeof json['error'] === 'string' ? json['error'] : `request failed (${res.status})`, json['details'] as Record<string, unknown> | undefined);
    return json as T;
  }
}

/** A short relative time for history and comments: "just now", "5m ago", "3d ago", or the date. */
export function ago(iso: string, now = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d}d ago`;
  return iso.slice(0, 10);
}
