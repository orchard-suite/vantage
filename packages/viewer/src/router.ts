/** Hash routes: `#view`, `#view/node`, `#view/node?open=container`. */
export interface Route {
  readonly view?: string;
  readonly node?: string;
  readonly open?: string;
}

export function parseRoute(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const q = raw.indexOf('?');
  const path = q >= 0 ? raw.slice(0, q) : raw;
  const params = new URLSearchParams(q >= 0 ? raw.slice(q + 1) : '');
  const [view, node] = path.split('/').map((s) => decodeURIComponent(s));
  const open = params.get('open');
  return {
    ...(view ? { view } : {}),
    ...(node ? { node } : {}),
    ...(open ? { open } : {}),
  };
}

export function formatRoute(r: Route): string {
  if (!r.view) return '#';
  let out = `#${encodeURIComponent(r.view)}`;
  if (r.node) out += `/${encodeURIComponent(r.node)}`;
  if (r.open) out += `?open=${encodeURIComponent(r.open)}`;
  return out;
}
