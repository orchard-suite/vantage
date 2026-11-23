/**
 * The header band above a picture: title and subtitle on the left, the
 * provenance facts (author, updated, version, link, published stamp) on the
 * right. Height depends on which facts are present so the band stays tight.
 */
import type { Theme } from './theme.ts';
import { esc } from './svg.ts';

export interface TitleBlock {
  readonly title?: string;
  readonly subtitle?: string;
  readonly author?: string;
  readonly updated?: string;
  readonly version?: string;
  /** Link to the live diagram; rendered as a clickable anchor in SVG and PDF. */
  readonly link?: string;
  /** Date of publication; rendered as "published <date>". */
  readonly published?: string;
}

const PAD = 20;
const TITLE_SIZE = 18;
const SUBTITLE_SIZE = 12;
const META_SIZE = 11;
const META_LINE = 16;

function metaLines(tb: TitleBlock): { text: string; href?: string }[] {
  const lines: { text: string; href?: string }[] = [];
  if (tb.author) lines.push({ text: tb.author });
  if (tb.updated) lines.push({ text: `updated ${tb.updated}` });
  if (tb.version) lines.push({ text: `version ${tb.version}` });
  if (tb.link) lines.push({ text: tb.link, href: tb.link });
  if (tb.published) lines.push({ text: `published ${tb.published}` });
  return lines;
}

/** Height of the band in pixels, zero when the block has nothing to say. */
export function titleBlockHeight(tb: TitleBlock): number {
  const left = (tb.title ? TITLE_SIZE + 6 : 0) + (tb.subtitle ? SUBTITLE_SIZE + 6 : 0);
  const right = metaLines(tb).length * META_LINE;
  const body = Math.max(left, right);
  return body === 0 ? 0 : body + PAD * 2 - 4;
}

export function titleBlockSvg(tb: TitleBlock, width: number, theme: Theme): string {
  const height = titleBlockHeight(tb);
  if (height === 0) return '';
  const parts: string[] = [];
  let y = PAD;
  if (tb.title) {
    y += TITLE_SIZE * 0.9;
    parts.push(`<text class="v-tb-title" x="${PAD}" y="${y}" font-size="${TITLE_SIZE}" font-weight="600" fill="${theme.containerTitle}">${esc(tb.title)}</text>`);
    y += 6;
  }
  if (tb.subtitle) {
    y += SUBTITLE_SIZE * 0.9;
    parts.push(`<text class="v-tb-subtitle" x="${PAD}" y="${y}" font-size="${SUBTITLE_SIZE}" fill="${theme.muted}">${esc(tb.subtitle)}</text>`);
  }
  let my = PAD + META_SIZE * 0.9;
  for (const line of metaLines(tb)) {
    const t = `<text class="v-tb-meta" x="${width - PAD}" y="${my}" font-size="${META_SIZE}" text-anchor="end" fill="${line.href ? theme.families.blue.stroke : theme.muted}">${esc(line.text)}</text>`;
    parts.push(line.href ? `<a href="${esc(line.href)}">${t}</a>` : t);
    my += META_LINE;
  }
  parts.push(`<line x1="${PAD}" y1="${height - 0.5}" x2="${width - PAD}" y2="${height - 0.5}" stroke="${theme.containerStroke}" stroke-width="1"/>`);
  return `<g class="v-title-block">${parts.join('')}</g>`;
}
