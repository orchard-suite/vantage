import { describe, expect, test } from 'bun:test';
import { kitCss, markSvg } from './kit.ts';
import { DARK, LIGHT, tokenCss } from './tokens.ts';
import { THEMES } from './theme.ts';
import { chromeFontCss, fontAsset } from './fonts.ts';
import { brandAsset } from './brand.ts';

describe('interface kit', () => {
  test('carries every color family in both themes, under the same dark switch as the tokens', () => {
    const attr = kitCss('attribute');
    const sys = kitCss('system');
    for (const f of ['slate', 'blue', 'violet', 'emerald', 'amber', 'red', 'teal', 'pink'] as const) {
      expect(attr).toContain(`--${f}-fill:${THEMES.light.families[f].fill}`);
      expect(attr).toContain(`--${f}-stroke:${THEMES.dark.families[f].stroke}`);
      expect(attr).toContain(`.fam-${f}{`);
    }
    expect(attr).toContain('[data-theme=dark]{');
    // The hub follows the system unless the page names the reader's pick.
    expect(sys).toContain('@media (prefers-color-scheme:dark){:root:not([data-theme=light]){');
    expect(sys).toContain(':root[data-theme=dark]{');
  });

  test('reads control state from ARIA, so accessible markup is styled markup', () => {
    const css = kitCss('system');
    for (const sel of ['.switch[aria-checked=true]', '.seg>button[aria-pressed=true]', '.chip[aria-pressed=true]', '.tabs>[aria-selected=true]', '.nav>[aria-current=page]', '.field[aria-invalid=true]']) expect(css).toContain(sel);
  });

  test('the color mark keeps its gradient ids apart when two share a page', () => {
    const a = markSvg(24, 'a');
    const b = markSvg(24, 'b');
    expect(a).toContain('id="aL"');
    expect(b).toContain('url(#bD)');
    expect(b).not.toContain('#aL');
  });
});

describe('tokens', () => {
  test('carry the brand faces, the grid tile, and the shared radii', () => {
    const css = tokenCss('system');
    expect(css).toContain('--display:"Bricolage Grotesque"');
    expect(css).toContain('--mono:"JetBrains Mono"');
    expect(css).toContain('--plus:url("data:image/svg+xml,');
    expect(css).toContain('--r-node:10px');
    expect(css).toContain('--blueprint:#16264a');
  });

  test('faint clears 4.5:1 on the light sunken well', () => {
    expect(contrast(LIGHT.faint, LIGHT.sunken)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(DARK.faint, DARK.panel)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('served files', () => {
  test('fonts and brand files are served by known name only', () => {
    expect(fontAsset('JetBrainsMono-Variable.woff2')?.length).toBeGreaterThan(10_000);
    expect(fontAsset('BricolageGrotesque-Variable.woff2')?.length).toBeGreaterThan(10_000);
    expect(fontAsset('Inter-Regular.ttf')).toBeUndefined();
    expect(fontAsset('../fonts.ts')).toBeUndefined();
    expect(new TextDecoder().decode(brandAsset('vantage-mark-color.svg'))).toContain('<svg');
    expect(brandAsset('../../package.json')).toBeUndefined();
    expect(chromeFontCss('/assets/fonts/')).toContain('url(/assets/fonts/BricolageGrotesque-Variable.woff2)');
  });
});

function contrast(a: string, b: string): number {
  const lum = (hex: string): number => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
