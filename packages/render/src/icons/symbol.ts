/** Strips the outer svg element so the body can live inside a `<symbol>`. */
export function symbolBody(svg: string): { body: string; viewBox: string } {
  const open = svg.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  const vb = open.match(/viewBox="([^"]+)"/i)?.[1] ?? '0 0 24 24';
  const inner = svg.replace(/^[\s\S]*?<svg\b[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
  // Presentation attributes on the root (Lucide puts fill="none" stroke="currentColor" there) must survive.
  const keep = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'color']
    .map((a) => open.match(new RegExp(`\\s${a}="([^"]*)"`, 'i')))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[0].trim())
    .join(' ');
  const body = keep ? `<g ${keep}>${inner}</g>` : inner;
  return { body, viewBox: vb };
}
