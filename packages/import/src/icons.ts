/**
 * Vendor icons in foreign drawings. A reader turns a library reference (a
 * draw.io stencil name or library image path, an Ilograph icon path) into
 * a hint, `<Vendor>/<category>/<Name>`; the matcher finds the icon id whose
 * name has the same words.
 */
import type { MxStyle } from './mx-style.ts';

const VENDOR_PACK: readonly (readonly [RegExp, string])[] = [
  [/^(azure|mscae|microsoft)/i, 'azure'],
  [/^(aws|amazon)/i, 'aws'],
  [/^(kubernetes|k8s)/i, 'k8s'],
];

const STOP = new Set(['icon', 'icons', 'the', 'and', 'of', 'for', 'azure', 'aws', 'amazon', 'microsoft']);

function singular(w: string): string {
  if (w.length > 3 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** The words of a name, lowercased, singular, without vendor names and filler. */
export function iconWords(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
    .map(singular);
}

/**
 * The icon id for a hint: the id itself when the hint is one, else, for a
 * vendor hint, the name with the same words, else the closest name that
 * holds every hint word or whose words the hint holds, sharing at
 * least half of all the words. Ties go to the name that starts with the
 * hint's first word, then to the shorter name.
 */
export function matchIconId(hint: string, ids: readonly string[]): string | undefined {
  const parts = hint.replace(/\\/g, '/').split('/');
  const name = (parts[parts.length - 1] ?? hint).replace(/\.(svg|png)$/i, '');
  if (parts.length === 2 && ids.includes(hint)) return hint;
  const pack = VENDOR_PACK.find(([re]) => re.test(parts[0] ?? ''))?.[1];
  if (pack === undefined) return undefined;
  const wanted = iconWords(name);
  const want = new Set(wanted);
  if (!want.size) return undefined;
  let best: { id: string; score: number } | undefined;
  for (const id of ids) {
    const slash = id.indexOf('/');
    if (id.slice(0, slash) !== pack) continue;
    const named = iconWords(id.slice(slash + 1));
    const have = new Set(named);
    const shared = [...want].filter((w) => have.has(w)).length;
    if (!shared) continue;
    const nested = shared === want.size || shared === have.size;
    // The leading word breaks ties without outweighing a better overlap.
    const score = shared / new Set([...want, ...have]).size + (named[0] === wanted[0] ? 0.001 : 0);
    if (!nested || score < 0.5) continue;
    if (!best || score > best.score || (score === best.score && id.length < best.id.length)) best = { id, score };
  }
  return best?.id;
}

const words = (s: string): string => s.replace(/_/g, ' ').trim();

/**
 * A draw.io icon as a hint: the id our own export wrote (`vantageIcon`), a
 * library image path such as `img/lib/azure2/compute/App_Services.svg`, or
 * a stencil such as `mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda`
 * or `mxgraph.kubernetes.icon;prIcon=deploy`.
 */
export function drawioIconHint(style: MxStyle): string | undefined {
  const own = style['vantageIcon'];
  if (own !== undefined && own !== '') return own;
  const image = style['image'];
  if (image !== undefined && !image.startsWith('data:')) {
    const m = /img\/lib\/([a-z0-9_]+)\/(.+?)\.(svg|png)$/i.exec(image);
    const vendor = m ? VENDOR_PACK.find(([re]) => re.test(m[1]!))?.[1] : undefined;
    if (m && vendor) return `${vendor}/${words(m[2]!)}`;
  }
  const shape = style['shape'];
  if (shape === undefined) return undefined;
  const stencil = /^mxgraph\.(aws\d*|azure|mscae|kubernetes)\.(.+)$/i.exec(shape);
  if (!stencil) return undefined;
  const vendor = VENDOR_PACK.find(([re]) => re.test(stencil[1]!))![1];
  const inner = style['resIcon'] ?? style['prIcon'] ?? style['grIcon'];
  const leaf = (s: string): string => words(s.replace(/^mxgraph\.[a-z0-9]+\./i, '').split('.').pop() ?? s);
  if (/^(resourceIcon|productIcon|group|groupCenter|icon)$/i.test(stencil[2]!)) return inner !== undefined ? `${vendor}/${leaf(inner)}` : undefined;
  return `${vendor}/${leaf(stencil[2]!)}`;
}
