/**
 * The brand files the hub serves by url: the color mark and the two color
 * lockups (ink for light grounds, paper for dark). The wordmark is outlined
 * in these files and never retyped.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BRAND_DIR = join(import.meta.dir, '..', 'assets', 'brand');
const FILES = new Set(['vantage-mark-color.svg', 'vantage-lockup-color-ink.svg', 'vantage-lockup-color-paper.svg']);

/** The bytes of a brand file, or undefined when the name is not one of ours. */
export function brandAsset(name: string): Uint8Array | undefined {
  if (!FILES.has(name)) return undefined;
  return readFileSync(join(BRAND_DIR, name));
}
