/**
 * The tiny template language shared by the http connector and mappings.
 * `{{a.b[0].c}}` reads a dotted path from a context object. Mappings also
 * accept the single brace form `{resourceGroup}` for a plain path, so the
 * spec's `azure:resourcegroup:{subscriptionId}/{resourceGroup}` reads as
 * written. Missing values render empty and are reported.
 */

export interface RenderResult {
  readonly text: string;
  /** Paths that resolved to nothing. */
  readonly missing: readonly string[];
}

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}|\{([A-Za-z0-9_$][A-Za-z0-9_.$:\-]*(?:\[\d+\])*)\}/g;

/** Splits `a.b[0].c` into ['a', 'b', '0', 'c']. A leading `$.` is the root and is dropped. */
export function splitPath(path: string): string[] {
  const trimmed = path.trim().replace(/^\$\.?/, '');
  if (!trimmed) return [];
  return trimmed
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((s) => s.length > 0);
}

export function getPath(value: unknown, path: string | readonly string[]): unknown {
  const parts = typeof path === 'string' ? splitPath(path) : path;
  let cur: unknown = value;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const i = Number(part);
      cur = Number.isInteger(i) ? cur[i] : undefined;
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

export function stringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function placeholders(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(PLACEHOLDER)) out.push((m[1] ?? m[2] ?? '').trim());
  return out;
}

export function render(template: string, context: unknown): RenderResult {
  const missing: string[] = [];
  const text = template.replace(PLACEHOLDER, (_whole, double: string | undefined, single: string | undefined) => {
    const path = (double ?? single ?? '').trim();
    const value = getPath(context, path);
    if (value === undefined || value === null || value === '') {
      missing.push(path);
      return '';
    }
    return stringify(value);
  });
  return { text, missing };
}

/** Renders and returns undefined when any placeholder was missing: for ids and parents, half an id is worse than none. */
export function renderStrict(template: string, context: unknown): string | undefined {
  const r = render(template, context);
  return r.missing.length === 0 ? r.text : undefined;
}
