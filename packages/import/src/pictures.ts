/**
 * The pictures an import keeps. A vendor library icon becomes one of our
 * icon ids; an embedded picture becomes a file beside the document, used
 * as an icon (declared under `icons:`) or as a picture node. Pictures that
 * no browser draws (Windows metafiles) are reported, never silently lost.
 */
import { createHash } from 'node:crypto';
import { slug } from '@vantage/model';
import type { RawShape } from './drawing.ts';

const EXT: Readonly<Record<string, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp' };

/** Pictures no larger than this on both sides read as icons, not illustrations. */
export const ICON_MAX = 96;

export class Pictures {
  /** Path to bytes: the files to write beside the document. */
  readonly files: Record<string, Uint8Array> = {};
  /** The document's `icons:` block. */
  readonly icons: Record<string, string> = {};
  readonly matched: string[] = [];
  readonly kept: string[] = [];
  readonly missed: string[] = [];
  private readonly byHash = new Map<string, string>();
  private readonly iconByPath = new Map<string, string>();

  constructor(private readonly resolver: ((hint: string) => string | undefined) | undefined) {}

  /** True when the shape carries something this import can draw or match. */
  static has(s: RawShape): boolean {
    return s.image !== undefined || s.iconHint !== undefined;
  }

  /** The icon id for a shape's picture: the vendor icon it names, else its embedded picture as a document icon. */
  icon(s: RawShape, label: string): string | undefined {
    if (s.iconHint !== undefined) {
      const id = this.resolver?.(s.iconHint);
      if (id !== undefined) {
        this.matched.push(`${s.iconHint} as ${id}`);
        return id;
      }
      if (s.image === undefined) this.missed.push(`no icon matched ${s.iconHint} (${label || s.id})`);
    }
    const path = this.file(s, label);
    if (path === undefined) return undefined;
    let id = this.iconByPath.get(path);
    if (id === undefined) {
      id = `imported/${path.slice(path.lastIndexOf('/') + 1, path.lastIndexOf('.'))}`;
      this.iconByPath.set(path, id);
      this.icons[id] = path;
    }
    return id;
  }

  /** The file path for a shape's embedded picture, written once per distinct picture. */
  file(s: RawShape, label: string): string | undefined {
    if (s.image === undefined) return undefined;
    const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(s.image);
    const mime = m?.[1]?.toLowerCase();
    const ext = mime ? EXT[mime] : undefined;
    if (!m || !ext) {
      this.missed.push(`picture ${s.id} is ${mime ?? 'unreadable'}, which no browser draws`);
      return undefined;
    }
    const bytes = m[2] ? new Uint8Array(Buffer.from(m[3]!, 'base64')) : new TextEncoder().encode(decodeURIComponent(m[3]!));
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
    const known = this.byHash.get(hash);
    if (known !== undefined) return known;
    const path = `assets/${(slug(label) || 'picture').slice(0, 32).replace(/-+$/, '')}-${hash}.${ext}`;
    this.byHash.set(hash, path);
    this.files[path] = bytes;
    this.kept.push(`${path} (${label || s.id})`);
    return path;
  }
}
