/**
 * Icon lookup. Ids are `pack/name`. The file source reads the packs shipped
 * with this package; a bundled source serves a prebuilt map in the browser.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface IconSource {
  get(id: string): string | undefined;
  has(id: string): boolean;
  list(pack?: string): string[];
}

interface IconIndex {
  packs: Record<string, string[]>;
  aliases: Record<string, string>;
}

const ICON_ROOT = join(import.meta.dir, '..', '..', 'icons');

export class FileIconSource implements IconSource {
  private readonly cache = new Map<string, string | undefined>();
  private readonly index: IconIndex;

  constructor(private readonly root: string = ICON_ROOT) {
    const indexPath = join(import.meta.dir, 'index.json');
    this.index = existsSync(indexPath) ? (JSON.parse(readFileSync(indexPath, 'utf8')) as IconIndex) : { packs: {}, aliases: {} };
  }

  private resolveId(id: string): string {
    return this.index.aliases[id] ?? id;
  }

  has(id: string): boolean {
    return this.get(id) !== undefined;
  }

  get(id: string): string | undefined {
    const real = this.resolveId(id);
    if (this.cache.has(real)) return this.cache.get(real);
    const [pack, name] = real.split('/');
    let svg: string | undefined;
    if (pack && name && /^[a-z0-9-]+$/i.test(pack) && /^[a-z0-9-]+$/i.test(name)) {
      const file = join(this.root, pack, `${name}.svg`);
      if (existsSync(file)) svg = readFileSync(file, 'utf8');
    }
    this.cache.set(real, svg);
    return svg;
  }

  list(pack?: string): string[] {
    const packs = pack ? [pack] : Object.keys(this.index.packs);
    const real = packs.flatMap((p) => (this.index.packs[p] ?? []).map((n) => `${p}/${n}`));
    const aliases = Object.keys(this.index.aliases).filter((a) => !pack || a.startsWith(`${pack}/`));
    return [...new Set([...real, ...aliases])].sort();
  }
}

export class MapIconSource implements IconSource {
  constructor(private readonly icons: Record<string, string>) {}
  get(id: string): string | undefined {
    return this.icons[id];
  }
  has(id: string): boolean {
    return id in this.icons;
  }
  list(pack?: string): string[] {
    return Object.keys(this.icons).filter((k) => !pack || k.startsWith(`${pack}/`));
  }
}

/** Several sources as one: the first that has an id wins. */
export class LayeredIconSource implements IconSource {
  constructor(private readonly layers: readonly IconSource[]) {}
  get(id: string): string | undefined {
    for (const l of this.layers) {
      const svg = l.get(id);
      if (svg !== undefined) return svg;
    }
    return undefined;
  }
  has(id: string): boolean {
    return this.layers.some((l) => l.has(id));
  }
  list(pack?: string): string[] {
    return [...new Set(this.layers.flatMap((l) => l.list(pack)))].sort();
  }
}
