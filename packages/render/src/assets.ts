/**
 * The files a document draws from by path: pictures and custom icons. On a
 * laptop they are read from disk; the hub serves them from the version's
 * attachments. Pictures reach the SVG as data URLs so every export stays
 * self-contained.
 */
import { readFileSync } from 'node:fs';
import { assetRefs, docRefs, type Diagnostic, type Model } from '@vantage/model';
import { LayeredIconSource, MapIconSource, type IconSource } from './icons/source.ts';
import { assetHref, type AssetSource, type Resources } from './hrefs.ts';
import { docDiagnostics } from './doc-pages.ts';

export class FileAssetSource implements AssetSource {
  read(ref: string): Uint8Array | undefined {
    try {
      return new Uint8Array(readFileSync(ref));
    } catch {
      return undefined;
    }
  }
}

/**
 * A custom icon as a 24 unit symbol holding the picture as an `<image>`.
 * A picture inside `<image>` runs no script and loads nothing, so an
 * uploaded SVG is safe to inline without a sanitizer, and its ids cannot
 * collide with the page.
 */
export function pictureIcon(href: string): string {
  const safe = href.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><image href="${safe}" width="24" height="24" preserveAspectRatio="xMidYMid meet"/></svg>`;
}

/** The model's `icons:` block as an icon source; ids whose file is missing are left out (validation reports them). */
export function documentIcons(model: Model, assets: AssetSource): IconSource {
  const out: Record<string, string> = {};
  for (const [id, ref] of model.icons) {
    const href = assetHref(ref, assets);
    if (href !== undefined) out[id] = pictureIcon(href);
  }
  return new MapIconSource(out);
}

/** Icons and pictures for one model: its own icons first, then the given packs. */
export function modelResources(model: Model, base: IconSource, assets: AssetSource): Required<Resources> {
  return { icons: model.icons.size ? new LayeredIconSource([documentIcons(model, assets), base]) : base, assets };
}

/** Icons no source draws and files no source holds: the picture renders without them, so say so. */
export function resourceDiagnostics(model: Model, res: Required<Resources>): Diagnostic[] {
  const out: Diagnostic[] = [];
  const unknown = new Map<string, string[]>();
  for (const n of model.nodes.values()) {
    if (n.icon !== undefined && !res.icons.has(n.icon)) unknown.set(n.icon, [...(unknown.get(n.icon) ?? []), n.id]);
  }
  for (const [id, nodes] of unknown) {
    const shown = nodes.slice(0, 3).join(', ') + (nodes.length > 3 ? ` and ${nodes.length - 3} more` : '');
    out.push({ severity: 'warning', code: 'unknown-icon', message: `icon ${id} is not in any icon pack (${shown})`, hint: 'Search the packs with the icon search, or declare it under `icons:` with a file' });
  }
  const pages = new Set(docRefs(model));
  const artifacts = new Set(model.artifacts.map((a) => a.file));
  for (const ref of assetRefs(model)) {
    // A missing page is an error the page checks report.
    if (pages.has(ref)) continue;
    if (artifacts.has(ref)) {
      if (res.assets.read(ref) === undefined) out.push({ severity: 'error', code: 'artifact-missing', message: `artifact ${ref} is not attached to the document`, hint: 'Send the file with the save, fix the path in artifacts, or take the entry out' });
      continue;
    }
    if (res.assets.read(ref) === undefined) out.push({ severity: 'warning', code: 'missing-asset', message: `file ${ref} is missing`, hint: 'Pictures and icon files are paths relative to the document; check the path or attach the file' });
  }
  return [...out, ...docDiagnostics(model, res.assets)];
}
