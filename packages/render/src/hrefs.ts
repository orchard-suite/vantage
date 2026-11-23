/**
 * Pictures as hrefs: URLs and data URLs pass through, files become data
 * URLs from an asset source. Nothing here touches a disk, so it runs in a
 * browser too.
 */
import type { IconSource } from './icons/source.ts';

export interface AssetSource {
  read(ref: string): Uint8Array | undefined;
}

export class MapAssetSource implements AssetSource {
  constructor(private readonly files: Readonly<Record<string, Uint8Array>>) {}
  read(ref: string): Uint8Array | undefined {
    return this.files[ref];
  }
}

/** What a render draws icons and pictures from. */
export interface Resources {
  readonly icons?: IconSource;
  readonly assets?: AssetSource;
}

const MIME: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

/** Content type from the file name; the picture formats a browser and the PNG renderer both draw. */
export function mimeOf(ref: string): string | undefined {
  return MIME[ref.slice(ref.lastIndexOf('.') + 1).toLowerCase()];
}

/** Content type of any file a document may carry: a picture, or the Markdown of a doc view. */
export function fileTypeOf(ref: string): string | undefined {
  return /\.md$/i.test(ref) ? 'text/markdown; charset=utf-8' : mimeOf(ref);
}

export const REMOTE = /^(https?:|data:)/;

export function dataUrl(mime: string, bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

/** A picture reference as an href: URLs and data URLs pass through, files are inlined. Undefined when the file is missing or not a picture. */
export function assetHref(ref: string, assets: AssetSource | undefined): string | undefined {
  if (REMOTE.test(ref)) return ref;
  const mime = mimeOf(ref);
  const bytes = mime ? assets?.read(ref) : undefined;
  return bytes && mime ? dataUrl(mime, bytes) : undefined;
}
