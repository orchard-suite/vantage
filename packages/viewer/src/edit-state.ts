/**
 * The editor's bookkeeping, apart from the page: the version its text
 * started from, the text it had then, and the versions this browser saved,
 * so a save heard from the live stream is told apart from someone else's.
 */

/** What to do when the live stream brings a head version. */
export type Arrival = 'ours' | 'current' | 'reload' | 'offer';

export class EditState {
  private readonly own = new Set<string>();

  constructor(
    /** The version the text was loaded from or last saved as. */
    public base: string,
    /** The text of `base`; undefined when the editor holds a merge not yet saved. */
    public baseText: string | undefined,
  ) {}

  /** The text differs from what is saved, or holds a merge that is not. */
  dirty(text: string): boolean {
    return this.baseText === undefined || text !== this.baseText;
  }

  /** This browser saved `version` with this text; it is the new base. */
  saved(version: string, text: string): void {
    this.own.add(version);
    this.base = version;
    this.baseText = text;
  }

  /** The text was loaded fresh from `version`. */
  loaded(version: string, text: string): void {
    this.base = version;
    this.baseText = text;
  }

  /** The text now holds an edit merged over `head`, not yet saved. */
  merged(head: string): void {
    this.base = head;
    this.baseText = undefined;
  }

  /** A head came in: our own save, the version we hold, someone else's with nothing of ours to lose, or someone else's over our changes. */
  arrival(version: string, text: string): Arrival {
    if (this.own.has(version)) return 'ours';
    if (version === this.base) return 'current';
    return this.dirty(text) ? 'offer' : 'reload';
  }
}
