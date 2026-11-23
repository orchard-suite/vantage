/**
 * The hub's voice walkthroughs, as the viewer reads and writes them.
 * Reading goes through the bundle's own addresses, so a guest link plays
 * what it may see; saving and deleting go to the REST API as the signed-in
 * author, with the session's CSRF token.
 */
import type { BundleHub } from './bundle.ts';
import type { TimelineEntry } from './recording.ts';
import type { Take } from './recorder.ts';

export interface HubRecording {
  readonly id: string;
  readonly view: string;
  readonly version: string;
  readonly authorLabel: string | null;
  readonly durationMs: number;
  readonly mimeType: string;
  readonly timeline: readonly TimelineEntry[];
  readonly createdAt: string;
}

export interface RecordingLimits {
  readonly maxSeconds: number;
  readonly maxBytes: number;
}

export interface RecordingList {
  readonly recordings: readonly HubRecording[];
  readonly limits: RecordingLimits;
}

export class TalkClient {
  constructor(
    /** An address beside the bundle's: `recordings` lists, `recordings/audio` streams. */
    private readonly beside: (leaf: string) => URL,
    private readonly hub: BundleHub | undefined,
  ) {}

  async list(): Promise<RecordingList> {
    const res = await fetch(this.beside('recordings'), { credentials: 'same-origin', headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`recordings answered ${res.status}`);
    return (await res.json()) as RecordingList;
  }

  audioUrl(id: string): string {
    const u = this.beside('recordings/audio');
    u.searchParams.set('id', id);
    return u.toString();
  }

  async save(take: Take, view: string, version: string): Promise<HubRecording> {
    const form = new FormData();
    form.set('audio', new File([take.blob], 'walkthrough', { type: take.type }));
    form.set('meta', JSON.stringify({ view, version, durationMs: take.durationMs, type: take.type, timeline: take.timeline }));
    return (await this.write('', 'POST', form)) as HubRecording;
  }

  async remove(id: string): Promise<void> {
    await this.write(`/${encodeURIComponent(id)}`, 'DELETE');
  }

  private async write(path: string, method: 'POST' | 'DELETE', body?: FormData): Promise<unknown> {
    if (!this.hub) throw new Error('sign in to save recordings');
    const headers: Record<string, string> = { accept: 'application/json', ...(this.hub.csrf ? { 'x-csrf-token': this.hub.csrf } : {}) };
    const res = await fetch(`${this.hub.apiBase}/documents/${encodeURIComponent(this.hub.documentId)}/recordings${path}`, { method, headers, credentials: 'same-origin', ...(body ? { body } : {}) });
    if (res.status === 204) return undefined;
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(typeof json['error'] === 'string' ? json['error'] : `the hub answered ${res.status}`);
    return json;
  }
}
