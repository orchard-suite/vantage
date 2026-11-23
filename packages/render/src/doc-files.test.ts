import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadModelFromFile, loadModelFromText, type Model } from '@vantage/model';
import { renderDoc } from './doc.ts';
import { docDiagnostics, docEntry, documentFiles } from './doc-pages.ts';
import { FileAssetSource, resourceDiagnostics } from './assets.ts';
import { MapIconSource } from './icons/source.ts';
import { MapAssetSource } from './hrefs.ts';
import { buildBundle } from './bundle.ts';
import { standaloneHtml } from './html.ts';

/** What the page checks find wrong; coverage notes are tested on their own. */
const problems = (...args: Parameters<typeof docDiagnostics>) => docDiagnostics(...args).filter((d) => d.severity !== 'info');

const YAML = `title: Runbook
nodes:
  - name: Web App
views:
  - id: guide
    kind: doc
    title: Guide
    file: pages/guide.md
`;

/** The smallest PNG: one transparent pixel. */
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
const PAGE = '## Sign in\n\n![The sign-in screen](assets/screen.png)\n\n![Again](./assets/screen.png)\n';

const files = (page: string, extra: Record<string, Uint8Array> = { 'assets/screen.png': PNG }): MapAssetSource => new MapAssetSource({ 'pages/guide.md': new TextEncoder().encode(page), ...extra });
const model = (): Model => loadModelFromText(YAML).model!;
const guide = (m: Model) => {
  const v = m.views.find((x) => x.id === 'guide')!;
  if (v.kind !== 'doc') throw new Error('expected a doc view');
  return v;
};

describe('pictures attached to a page', () => {
  test('a page lists the files it embeds, by their path inside the document', () => {
    const p = renderDoc('guide', PAGE);
    expect(p.files).toEqual(['assets/screen.png']);
    expect(p.refused).toEqual([]);
  });

  test('a path that leaves the document folder is refused and draws nothing', () => {
    const p = renderDoc('guide', '![a](../secret.png) ![b](/etc/x.png) ![c](%2e%2e/x.png) ![d](assets/../../x.png) ![e](file:x.png)', () => 'data:image/png;base64,AAAA');
    expect(p.files).toEqual([]);
    // A `file:` address is not a link at all, so it stays text.
    expect(p.refused).toEqual(['../secret.png', '/etc/x.png', '%2e%2e/x.png', 'assets/../../x.png']);
    expect(p.html).not.toContain('<img');
  });

  test('the viewer entry draws an attached picture from the document, as a data URL', () => {
    const entry = docEntry(guide(model()), files(PAGE)) as { doc: { html: string } };
    expect(entry.doc.html).toContain('<img class="v-file" src="data:image/png;base64,');
    expect(entry.doc.html).toContain('alt="The sign-in screen"');
    expect(entry.doc.html).toContain('data-file="assets/screen.png"');
  });

  test('an attached picture that is not there draws as missing', () => {
    const entry = docEntry(guide(model()), files(PAGE, {})) as { doc: { html: string } };
    expect(entry.doc.html).not.toContain('<img');
    expect(entry.doc.html).toContain('<span class="v-fig-missing">The sign-in screen</span>');
  });

  test('the interactive HTML export carries the picture inside the page', () => {
    const html = standaloneHtml(buildBundle(model(), { assets: files(PAGE) }) as Record<string, unknown>);
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('v-file');
  });

  test('the files a page embeds count as the document files', () => {
    expect(documentFiles(model(), files(PAGE))).toEqual(['assets/screen.png', 'pages/guide.md']);
  });

  test('a page that names a missing file, a page, or a path outside is an error', () => {
    expect(problems(model(), files(PAGE))).toEqual([]);
    const missing = problems(model(), files('![x](assets/gone.png) ![y](pages/guide.md)'));
    expect(missing.length).toBe(1);
    expect(missing[0]!.severity).toBe('error');
    expect(missing[0]!.message).toContain('file assets/gone.png');
    expect(missing[0]!.message).toContain('file pages/guide.md (not a picture');
    const outside = problems(model(), files('![x](../../etc/passwd.png)'));
    expect(outside.map((d) => [d.severity, d.code])).toEqual([['error', 'doc-file-outside']]);
    expect(outside[0]!.message).toContain('../../etc/passwd.png');
  });

  test('a doc view whose file the document does not carry is an error, not a missing-file warning', () => {
    const m = model();
    const gone = problems(m, new MapAssetSource({}));
    expect(gone.map((d) => [d.severity, d.code])).toEqual([['error', 'doc-file-missing']]);
    expect(gone[0]!.message).toContain('pages/guide.md');
    const all = resourceDiagnostics(m, { icons: new MapIconSource({}), assets: new MapAssetSource({}) });
    expect(all.filter((d) => d.message.includes('pages/guide.md')).map((d) => d.code)).toEqual(['doc-file-missing']);
  });

  test('on a laptop the files are read beside the document file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vantage-doc-files-'));
    mkdirSync(join(dir, 'pages'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'runbook.vantage.yaml'), YAML);
    writeFileSync(join(dir, 'pages', 'guide.md'), PAGE);
    writeFileSync(join(dir, 'assets', 'screen.png'), PNG);
    const m = loadModelFromFile(join(dir, 'runbook.vantage.yaml')).model!;
    const assets = new FileAssetSource();
    expect(problems(m, assets)).toEqual([]);
    expect((docEntry(guide(m), assets) as { doc: { html: string } }).doc.html).toContain('src="data:image/png;base64,');
    expect(documentFiles(m, assets)).toContain(join(dir, 'assets', 'screen.png'));
  });
});
