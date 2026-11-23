/**
 * Publishing: the other half of connectors. A target takes rendered
 * artifacts and puts them where people already look: a storage account, a
 * git repository, a SharePoint library, a chat channel. Every target is the
 * same small interface, so a new destination is one file.
 */
import type { ZodType } from 'zod';

export type ArtifactKind = 'html' | 'png' | 'svg' | 'pdf' | 'drawio' | 'vsdx' | 'bundle';

/** What every published file says about itself, so a copy can point at the live one. */
export interface Stamp {
  readonly title: string;
  readonly version: string;
  readonly publishedAt: string;
  readonly liveUrl?: string;
}

export interface Artifact {
  readonly kind: ArtifactKind;
  /** View id, or undefined for a whole-document artifact such as the interactive HTML. */
  readonly viewId?: string;
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly stamp: Stamp;
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export interface TargetContext<C = unknown> {
  readonly config: C;
  /** Resolves a secret reference such as `sas` or `token` to its value; never log the result. */
  readonly secrets: (ref: string) => Promise<string>;
  readonly log: Logger;
  readonly now: () => Date;
  readonly fetch: typeof fetch;
  readonly signal?: AbortSignal;
}

export interface Written {
  readonly artifact: string;
  readonly location: string;
  readonly bytes: number;
}

export interface PublishResult {
  readonly target: string;
  readonly written: readonly Written[];
  readonly skipped: readonly { artifact: string; reason: string }[];
  readonly startedAt: string;
  readonly finishedAt: string;
}

export interface Target<C = unknown> {
  readonly id: string;
  readonly description: string;
  readonly configSchema: ZodType<C>;
  publish(ctx: TargetContext<C>, artifacts: readonly Artifact[]): Promise<PublishResult>;
}

export class TargetRegistry {
  private readonly targets = new Map<string, Target>();
  register<C>(t: Target<C>): this {
    this.targets.set(t.id, t as Target);
    return this;
  }
  get(id: string): Target | undefined {
    return this.targets.get(id);
  }
  list(): readonly { id: string; description: string }[] {
    return [...this.targets.values()].map((t) => ({ id: t.id, description: t.description }));
  }
}

/** Helper for targets: start and end times around a body that writes files. */
export async function timed(target: string, body: () => Promise<{ written: Written[]; skipped: { artifact: string; reason: string }[] }>, now: () => Date): Promise<PublishResult> {
  const startedAt = now().toISOString();
  const r = await body();
  return { target, ...r, startedAt, finishedAt: now().toISOString() };
}
