/**
 * Export, in the hub: pick a format, which views, the theme and the title
 * block, and download. The hub renders the file the way a publication
 * would, so what comes down is what a publication would send.
 */
import type { BundleView } from './bundle.ts';
import type { ExportFormat, ExportOptions, HubClient } from './hub.ts';
import { Dialog, segmented, switchRow } from './dialog.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';

interface FormatInfo {
  readonly id: ExportFormat;
  readonly name: string;
  readonly note: string;
  /** One file holds every chosen view; the others make a file per view. */
  readonly bundled: boolean;
  /** Always the whole document. */
  readonly whole?: boolean;
}

const FORMATS: readonly (readonly [string, readonly FormatInfo[]])[] = [
  ['Pictures', [
    { id: 'png', name: 'PNG', note: 'For slides, chat and docs', bundled: false },
    { id: 'svg', name: 'SVG', note: 'Sharp at any size', bundled: false },
    { id: 'pdf', name: 'PDF', note: 'Vector, one view per page', bundled: true },
  ]],
  ['Share it live', [{ id: 'html', name: 'Interactive page', note: 'Views, hover, walkthroughs, offline', bundled: true, whole: true }]],
  ['Other tools', [
    { id: 'drawio', name: 'draw.io', note: 'Keep editing by hand', bundled: true },
    { id: 'vsdx', name: 'Visio', note: 'Opens in Visio and Lucidchart', bundled: true },
  ]],
];
const ALL = FORMATS.flatMap(([, f]) => f);
const BADGE: Record<ExportFormat, string> = { png: 'PNG', svg: 'SVG', pdf: 'PDF', html: 'HTML', drawio: 'DIO', vsdx: 'VSDX' };
const EXT: Record<ExportFormat, string> = { png: 'PNG', svg: 'SVG', pdf: 'PDF', html: 'page', drawio: 'draw.io', vsdx: 'Visio' };

export class ExportDialog {
  private readonly dialog: Dialog;
  private format: ExportFormat = 'png';
  private scope: 'this' | 'all' = 'this';
  private theme: ExportOptions['theme'] = 'light';
  private titleBlock = false;
  private readonly cta: HTMLAnchorElement;
  private readonly note: HTMLElement;
  private readonly scopeRow: HTMLElement;
  private readonly formatButtons: HTMLButtonElement[] = [];

  constructor(private readonly hub: HubClient, private readonly current: () => BundleView | undefined, private readonly views: () => readonly BundleView[], docTitle: string) {
    this.dialog = new Dialog(`Export ${docTitle}`, 'Same layout in every format. The file is drawn from the latest version.');
    const grid = h('div', 'v-exp');
    const formats = h('div', 'v-exp-formats');
    formats.setAttribute('role', 'radiogroup');
    formats.setAttribute('aria-label', 'Format');
    for (const [group, list] of FORMATS) {
      formats.appendChild(h('div', 'caps v-exp-group', group));
      for (const f of list) {
        const b = h('button', 'v-exp-fmt');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.dataset['f'] = f.id;
        const words = h('span', 'v-exp-fmt-words');
        words.append(h('b', undefined, f.name), h('span', undefined, f.note));
        b.append(h('span', 'v-exp-ext', BADGE[f.id]), words);
        b.addEventListener('click', () => this.pick(f.id));
        this.formatButtons.push(b);
        formats.appendChild(b);
      }
    }
    const opts = h('div', 'v-exp-opts');
    const scope = segmented('Views', [['this', 'This view'], ['all', 'Every view']] as const, this.scope, (v) => {
      this.scope = v;
      this.sync();
    });
    this.scopeRow = this.field('Views', scope.el);
    const theme = segmented('Theme', [['light', 'Light'], ['dark', 'Dark'], ['print', 'Print'], ['colorblind', 'Colorblind']] as const, this.theme, (v) => {
      this.theme = v;
      this.sync();
    });
    opts.append(this.scopeRow, this.field('Theme', theme.el), switchRow('Title block', 'Name, view, version and date along the foot', this.titleBlock, (on) => {
      this.titleBlock = on;
      this.sync();
    }));
    this.note = h('p', 'v-exp-note');
    opts.appendChild(this.note);
    grid.append(formats, opts);
    this.dialog.body.appendChild(grid);
    this.cta = h('a', 'btn primary');
    this.cta.setAttribute('download', '');
    this.cta.dataset['autofocus'] = '';
    this.cta.addEventListener('click', () => setTimeout(() => this.dialog.close(), 150));
    const cancel = h('button', 'btn ghost', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.dialog.close());
    this.dialog.foot.append(h('span', 'f-hint v-dlg-foot-note', 'Big documents take a few seconds.'), cancel, this.cta);
  }

  open(): void {
    this.sync();
    this.dialog.open();
  }

  private field(label: string, control: HTMLElement): HTMLElement {
    const f = h('div', 'v-dlg-field');
    f.append(h('span', 'caps', label), control);
    return f;
  }

  private pick(f: ExportFormat): void {
    this.format = f;
    this.sync();
  }

  private sync(): void {
    const info = ALL.find((f) => f.id === this.format)!;
    for (const b of this.formatButtons) b.setAttribute('aria-checked', String(b.dataset['f'] === this.format));
    this.scopeRow.hidden = Boolean(info.whole);
    const view = this.current();
    const all = this.views().filter((v) => !v.hidden);
    const ids = info.whole || this.scope === 'all' || !view ? undefined : [view.id];
    this.cta.href = this.hub.exportUrl({ format: this.format, ...(ids ? { views: ids } : {}), theme: this.theme, titleBlock: this.titleBlock });
    this.cta.replaceChildren(icon('export'), h('span', undefined, `Download ${EXT[this.format]}`));
    const count = ids ? 1 : all.length;
    this.note.textContent = info.whole
      ? 'One page with every view, the picker, hover and walkthroughs. It works offline and asks the hub for a newer version when it opens.'
      : info.bundled
        ? `One file with ${count === 1 ? 'this view' : `${count} views`}.`
        : count === 1
          ? `One ${EXT[this.format]} of ${view?.title ?? 'this view'}.`
          : `A zip with one ${EXT[this.format]} per view, ${count} in all.`;
  }
}
