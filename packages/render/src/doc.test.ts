import { describe, expect, test } from 'bun:test';
import { loadModelFromText } from '@vantage/model';
import { renderDoc } from './doc.ts';
import { docDiagnostics, docEntry } from './doc-pages.ts';
import { MapAssetSource } from './hrefs.ts';
import { bundleOf } from './bundle.ts';

/** What the page checks find wrong; coverage notes are tested on their own. */
const problems = (...args: Parameters<typeof docDiagnostics>) => docDiagnostics(...args).filter((d) => d.severity !== 'info');

const YAML = `title: Shop
nodes:
  - name: Web App
  - name: Orders API
relations:
  - { from: web-app, to: orders-api, label: calls, tags: [requests] }
views:
  - id: requests
    title: Requests
    include: { tags: [requests] }
  - id: guide
    kind: doc
    title: Guide
    file: pages/guide.md
    beside: requests
  - id: notes
    kind: doc
    title: Notes
    text: "## Start {#start}\\n\\nSee [[web-app]]."
`;

const files = (guide: string): MapAssetSource => new MapAssetSource({ 'pages/guide.md': new TextEncoder().encode(guide) });

describe('doc pages', () => {
  test('a page names boxes, views, and headings by id and copies nothing from the model', () => {
    const p = renderDoc('guide', '### R-0019: Spoilage {#R-0019}\n\nThe [[orders-api]] and [the app](node:web-app). See [it](view:requests/web-app), [rule](view:notes#start), and [above](#R-0019).\n\n![How it flows](view:requests)\n');
    expect(p.headings).toEqual([{ id: 'R-0019', text: 'R-0019: Spoilage', level: 3 }]);
    expect(p.nodes).toEqual(['orders-api', 'web-app']);
    expect(p.figures).toEqual(['requests']);
    expect(p.links).toEqual([
      { view: 'requests', target: 'web-app', kind: 'node' },
      { view: 'notes', target: 'start', kind: 'anchor' },
      { view: 'guide', target: 'R-0019', kind: 'anchor' },
    ]);
    expect(p.html).toContain('<h3 data-anchor="R-0019">R-0019: Spoilage</h3>');
    expect(p.html).toContain('<a class="v-ref" data-node="orders-api"></a>');
    expect(p.html).toContain('href="#requests/web-app"');
    expect(p.html).toContain('href="#guide/R-0019"');
    expect(p.html).toContain('<span class="v-fig" data-view="requests" data-caption="How it flows"></span>');
  });

  test('a page names items, which a hub fills in with their live state', () => {
    const page = renderDoc('plan', 'The cache is [[item:PLAN-1]], and [the retirement](item:PLAN-2) follows [[item:PLAN-1|it]].');
    expect(page.items).toEqual(['PLAN-1', 'PLAN-2']);
    expect(page.html).toContain('<a class="v-work-ref" data-item="PLAN-1">PLAN-1</a>');
    expect(page.html).toContain('<a class="v-work-ref" data-item="PLAN-2">the retirement</a>');
    expect(page.html).toContain('<a class="v-work-ref" data-item="PLAN-1">it</a>');
  });

  test('a page cites decision records, which a hub turns into links', () => {
    const page = renderDoc('guide', 'We follow [[decision:SHOP-2001]] and [the vault rule](decision:ORG-0003), and [[decision:SHOP-2001|again]].');
    expect(page.decisions).toEqual(['SHOP-2001', 'ORG-0003']);
    expect(page.html).toContain('<a class="v-decision" data-decision="SHOP-2001">SHOP-2001</a>');
    expect(page.html).toContain('<a class="v-decision" data-decision="ORG-0003">the vault rule</a>');
    expect(page.html).toContain('data-decision="SHOP-2001">again</a>');
    expect(page.nodes).toEqual([]);
  });

  test('headings without an anchor take a slug, and a repeated one a number', () => {
    const p = renderDoc('guide', '## Set up\n\n## Set up\n');
    expect(p.headings.map((h) => h.id)).toEqual(['set-up', 'set-up-2']);
  });

  test('raw HTML and script links are shown as text, never run', () => {
    const p = renderDoc('guide', '<script>alert(1)</script>\n\n[x](javascript:alert(1)) <img src=x onerror=alert(1)>\n\n![p](pages/secret.png)\n');
    expect(p.html).not.toContain('<script');
    expect(p.html).not.toContain('<img');
    expect(p.html).not.toContain('href="javascript');
    expect(p.html).toContain('&lt;script&gt;');
  });

  test('a doc view entry carries the page and the view it is read beside', () => {
    const model = loadModelFromText(YAML).model!;
    const guide = model.views.find((v) => v.id === 'guide')!;
    if (guide.kind !== 'doc') throw new Error('expected a doc view');
    const entry = docEntry(guide, files('Hello [[web-app]].')) as { doc: { html: string; nodes: string[] }; beside: string };
    expect(entry.beside).toBe('requests');
    expect(entry.doc.nodes).toEqual(['web-app']);
    expect(entry.doc.html).toContain('Hello');
  });

  test('a page that points at nothing is an error, and a clean one is not', () => {
    const model = loadModelFromText(YAML).model!;
    expect(problems(model, files('The [[web-app]] in [the view](view:requests) and [start](view:notes#start).'))).toEqual([]);
    const bad = problems(model, files('[[gone]] ![x](view:nope) [y](view:notes#missing) [z](view:requests/ghost) ![d](view:notes)'));
    expect(bad.length).toBe(1);
    expect(bad[0]!.severity).toBe('error');
    for (const word of ['box gone', 'view nope as a figure', 'heading missing of notes', 'box ghost in view requests', 'view notes as a figure']) expect(bad[0]!.message).toContain(word);
  });

  test('a doc view needs one source and a real view beside it', () => {
    const d = loadModelFromText(YAML.replace('file: pages/guide.md', 'text: hi\n    file: pages/guide.md').replace('beside: requests', 'beside: notes')).diagnostics.map((x) => x.code);
    expect(d).toContain('doc-source');
    expect(d).toContain('unknown-view');
  });

  test('the document description reaches the viewer as Markdown rendered once, raw HTML shown as text', () => {
    const model = loadModelFromText(`description: "**Two hosts.** See [[web-app]]. <script>x</script>"\n${YAML}`).model!;
    const b = bundleOf(model, [], { embedFonts: false }) as { description?: string; descriptionHtml?: string };
    expect(b.description).toContain('**Two hosts.**');
    expect(b.descriptionHtml).toContain('<strong>Two hosts.</strong>');
    expect(b.descriptionHtml).toContain('data-node="web-app"');
    expect(b.descriptionHtml).not.toContain('<script>');
    expect(renderDoc('x', 'See README.md and https://example.com.').html).toBe('<p>See README.md and <a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a>.</p>\n');
  });
});
