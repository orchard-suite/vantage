/**
 * The faces. Inter is embedded in every picture and measured by the layout
 * package; the brand faces (Bricolage Grotesque for the voice, JetBrains
 * Mono for things you might copy) are chrome only, served by the hub and
 * never measured.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FONT_DIR = join(import.meta.dir, '..', 'assets', 'fonts');
const FACES = [
  { file: 'Inter-Regular.woff2', ttf: 'Inter-Regular.ttf', weight: 400 },
  { file: 'Inter-Medium.woff2', ttf: 'Inter-Medium.ttf', weight: 500 },
  { file: 'Inter-SemiBold.woff2', ttf: 'Inter-SemiBold.ttf', weight: 600 },
] as const;

/** TTF paths for resvg, which does not read woff2. */
export function fontFiles(): string[] {
  return FACES.map((f) => join(FONT_DIR, f.ttf));
}

let cached: string | undefined;

/** @font-face rules with the faces inlined as data urls. */
export function fontCss(): string {
  if (cached) return cached;
  cached = FACES.map((f) => {
    const b64 = readFileSync(join(FONT_DIR, f.file)).toString('base64');
    return `@font-face{font-family:Inter;font-style:normal;font-weight:${f.weight};font-display:swap;src:url(data:font/woff2;base64,${b64}) format("woff2");}`;
  }).join('');
  return cached;
}

/** The chrome's own faces, beside Inter: variable fonts, one file each. */
const CHROME_FACES = [
  { family: 'Bricolage Grotesque', file: 'BricolageGrotesque-Variable.woff2', weight: '200 800' },
  { family: 'JetBrains Mono', file: 'JetBrainsMono-Variable.woff2', weight: '100 800' },
] as const;

/** Every file a page may load by url, by name; anything else is unknown. */
const SERVED = new Set<string>([...FACES.map((f) => f.file), ...CHROME_FACES.map((f) => f.file)]);

/** The bytes of a served font file, or undefined when the name is not one of ours. */
export function fontAsset(name: string): Uint8Array | undefined {
  if (!SERVED.has(name)) return undefined;
  return readFileSync(join(FONT_DIR, name));
}

/** @font-face rules for Inter and the chrome faces, loaded from `base` (for example `/assets/fonts/`). */
export function chromeFontCss(base: string): string {
  const inter = FACES.map((f) => `@font-face{font-family:Inter;font-style:normal;font-weight:${f.weight};font-display:swap;src:url(${base}${f.file}) format("woff2");}`);
  const brand = CHROME_FACES.map((f) => `@font-face{font-family:"${f.family}";font-style:normal;font-weight:${f.weight};font-display:swap;src:url(${base}${f.file}) format("woff2");}`);
  return [...inter, ...brand].join('');
}
