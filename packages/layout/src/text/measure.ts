/**
 * Text measurement from Inter's advance widths. Measuring here, not in a
 * browser, is what makes layouts deterministic and the same in every
 * export. The viewer embeds the same font so the numbers hold on screen.
 */
import metrics from './inter-metrics.json' with { type: 'json' };

export type FontWeight = 'regular' | 'medium' | 'semibold';

const tables = metrics as Record<FontWeight, Record<string, number>>;
const FALLBACK = 0.6;

export function textWidth(text: string, size: number, weight: FontWeight = 'regular'): number {
  const table = tables[weight];
  let w = 0;
  for (const ch of text) w += table[ch] ?? FALLBACK;
  return w * size;
}

export interface WrappedText {
  readonly lines: readonly string[];
  readonly width: number;
  readonly height: number;
  readonly lineHeight: number;
}

/** Greedy word wrap to a maximum width; a single word longer than the width is kept whole. */
export function wrapText(text: string, size: number, weight: FontWeight, maxWidth: number, maxLines = 3, lineHeightFactor = 1.25): WrappedText {
  const lineHeight = Math.round(size * lineHeightFactor * 100) / 100;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, size, weight) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1]!;
    while (last.length > 1 && textWidth(`${last}…`, size, weight) > maxWidth) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}…`;
    return finish(kept, size, weight, lineHeight);
  }
  return finish(lines.length ? lines : [''], size, weight, lineHeight);
}

function finish(lines: string[], size: number, weight: FontWeight, lineHeight: number): WrappedText {
  const width = Math.max(...lines.map((l) => textWidth(l, size, weight)));
  return { lines, width: Math.round(width * 100) / 100, height: lineHeight * lines.length, lineHeight };
}
