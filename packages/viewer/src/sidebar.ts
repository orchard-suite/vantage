/** The sidebar: the search box, the overview link, the view list, and the parts switch. The document's name lives in the app bar; its description, on the overview. */
import type { Bundle, BundleView } from './bundle.ts';
import { Picker, type PickerState } from './picker.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import { wirePicker } from './a11y.ts';

/** "2026-10-27" reads as a date in the reader's own format; anything else is shown as written. */
function readableDate(s: string | undefined): string | undefined {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** "Ada Example · Updated Oct 26, 2026": who wrote the document and when, for the app bar. */
export function docMeta(bundle: Bundle): string {
  return [bundle.author, bundle.updated ? `Updated ${readableDate(bundle.updated)}` : undefined].filter(Boolean).join(' · ');
}

export class Sidebar {
  readonly el: HTMLElement;
  readonly search: HTMLInputElement;
  readonly picker: Picker;
  private readonly partsRow: HTMLElement;
  private readonly partsBox: HTMLInputElement;
  private readonly home: HTMLAnchorElement;

  constructor(
    bundle: Bundle,
    /** The search text or the parts switch changed; the caller rebuilds the list. */
    private readonly onChange: (parts: boolean) => void,
    onPick: (view: BundleView, node?: string) => void,
    onHome: () => void,
  ) {
    this.el = h('aside', 'v-side');
    this.el.setAttribute('aria-label', 'Document');
    const box = h('label', 'v-searchbox');
    const search = h('input', 'v-search');
    search.type = 'search';
    search.placeholder = 'Find a view, box, or page';
    search.setAttribute('aria-label', 'Find a view, box, or page');
    const list = h('nav', 'v-picker');
    list.setAttribute('aria-label', 'Views');
    wirePicker(list);
    search.addEventListener('input', () => {
      box.classList.toggle('has', search.value.length > 0);
      this.onChange(this.partsBox.checked);
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && search.value) {
        e.stopPropagation();
        search.value = '';
        box.classList.remove('has');
        this.onChange(this.partsBox.checked);
      }
      if (e.key === 'Enter') list.querySelector<HTMLElement>('.v-item')?.click();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        list.querySelector<HTMLElement>('.v-item')?.focus();
      }
    });
    this.search = search;
    box.append(icon('search'), search, h('kbd', 'v-search-key', '/'));
    this.picker = new Picker(list, `vantage:folds:${bundle.title}`, onPick);
    this.partsRow = h('label', 'v-parts');
    this.partsBox = document.createElement('input');
    this.partsBox.type = 'checkbox';
    this.partsBox.setAttribute('role', 'switch');
    this.partsBox.addEventListener('change', () => this.onChange(this.partsBox.checked));
    this.partsRow.append(this.partsBox, h('span', undefined, 'Show parts'));
    this.partsRow.title = 'Parts are views other views build on. They stay out of the list until you turn this on.';
    this.home = h('a', 'v-item v-item-home');
    this.home.href = '#';
    this.home.append(icon('gallery'), h('span', 'v-item-title', 'Overview'));
    this.home.hidden = true;
    this.home.addEventListener('click', (e) => {
      e.preventDefault();
      onHome();
    });
    this.el.append(box, this.home, list, this.partsRow);
  }

  /** Shows the overview link when the document has an overview, and marks it while the overview is open. */
  setHome(available: boolean, open: boolean, currentId: string | undefined): void {
    this.home.hidden = !available;
    this.home.classList.toggle('active', open);
    if (open) this.home.setAttribute('aria-current', 'page');
    else this.home.removeAttribute('aria-current');
    this.picker.setActive(open ? undefined : currentId);
  }

  render(views: readonly BundleView[], state: Omit<PickerState, 'filter'>): void {
    this.partsRow.hidden = !views.some((v) => v.hidden);
    this.partsBox.checked = state.parts;
    this.picker.render(views, { ...state, filter: this.search.value });
  }
}
