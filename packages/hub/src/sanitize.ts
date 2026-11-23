/**
 * A small allowlist sanitizer for the markdown strings that reach the
 * viewer (descriptions, notes, questions). Markdown stays markdown; any
 * raw HTML in it is reduced to a short list of harmless inline tags, and
 * every URL scheme other than http, https, and mailto is removed.
 */
const ALLOWED_TAGS = new Set(['b', 'i', 'em', 'strong', 'code', 'pre', 'br', 'p', 'ul', 'ol', 'li', 'a', 'sub', 'sup']);
const SAFE_URL = /^(https?:|mailto:|\/|#)/i;

export function sanitizeMarkdown(text: string): string {
  let out = text.replace(/<!--[\s\S]*?-->/g, '');
  out = out.replace(/<\s*(script|style)\b[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi, '');
  out = out.replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g, (_m, close: string, tag: string, attrs: string) => {
    const name = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return '';
    if (close) return `</${name}>`;
    if (name === 'a') {
      const href = /href\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1]?.trim();
      return href && SAFE_URL.test(href) ? `<a href="${href.replace(/"/g, '&quot;')}" rel="noopener noreferrer">` : '<a>';
    }
    return `<${name}>`;
  });
  out = out.replace(/\]\(\s*(javascript|data|vbscript):[^)]*\)+/gi, '](#)');
  return out;
}

const MARKDOWN_FIELDS = new Set(['description', 'notes', 'question', 'note']);

/** Walks a bundle and sanitizes every markdown-bearing string field in place. */
export function sanitizeBundle<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => sanitizeBundle(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = MARKDOWN_FIELDS.has(k) && typeof v === 'string' ? sanitizeMarkdown(v) : sanitizeBundle(v);
    }
    return out as T;
  }
  return value;
}
