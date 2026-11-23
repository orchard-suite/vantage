/**
 * Labels to lines, lines to the parts of a node. draw.io labels are HTML;
 * Visio text is plain with newlines. Both end up as trimmed lines, then the
 * first line names the node, a short second line is the subtitle, and
 * later lines become facts, bullets, or description.
 */
import { decodeEntities } from './xml.ts';

const BULLETS = /^[•‣◦·⁃∙*\-–]\s+/;
const SUBTITLE_MAX = 48;

/** HTML label text to plain lines: block ends and <br> become line breaks, tags go, entities resolve. */
export function htmlToLines(html: string): string[] {
  // A styled first block is one heading even when it wraps onto several lines.
  const heading = /^\s*<font[^>]*>([\s\S]*?)<\/font>/i.exec(html);
  const withHeading = heading ? html.replace(heading[0], heading[0].replace(/<br\s*\/?>/gi, ' ')) : html;
  const broken = withHeading
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '');
  return splitLines(decodeEntities(broken));
}

export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/ /g, ' ').trim())
    .filter((l) => l.length > 0);
}

export interface TextParts {
  readonly name: string;
  readonly subtitle?: string;
  readonly facts: readonly string[];
  readonly bullets: readonly string[];
  readonly description?: string;
}

function isFact(line: string): boolean {
  const i = line.indexOf(':');
  if (i <= 0 || i > 40) return false;
  const label = line.slice(0, i).trim();
  const value = line.slice(i + 1).trim();
  return label.length > 0 && value.length > 0 && !/^\/\//.test(value) && !label.includes(' ', 24);
}

/** The node parts of a shape's lines. The caller guarantees at least one line. */
export function partsOf(lines: readonly string[]): TextParts {
  const [first = '', ...rest] = lines;
  const facts: string[] = [];
  const bullets: string[] = [];
  const prose: string[] = [];
  let subtitle: string | undefined;
  rest.forEach((line, i) => {
    if (BULLETS.test(line)) bullets.push(line.replace(BULLETS, '').trim());
    else if (isFact(line)) facts.push(line);
    else if (i === 0 && line.length <= SUBTITLE_MAX) subtitle = line;
    else prose.push(line);
  });
  return {
    name: first,
    ...(subtitle !== undefined ? { subtitle } : {}),
    facts,
    bullets,
    ...(prose.length ? { description: prose.join('\n') } : {}),
  };
}

/** A short label is a caption, not a name: a few words, no sentence punctuation. */
export function isShortLabel(lines: readonly string[]): boolean {
  if (lines.length !== 1) return false;
  const l = lines[0]!;
  return l.length <= 32 && l.split(/\s+/).length <= 4;
}
