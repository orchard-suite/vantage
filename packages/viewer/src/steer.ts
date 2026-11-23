/**
 * The Steer panel: controls for the selected container or node, and for
 * the view itself. Every control builds one action and hands it to the
 * hub; the server writes the YAML hint and saves a version.
 */
import type { ViewerContext } from './app.ts';
import type { BundleBox } from './bundle.ts';
import { button, h } from './dom.ts';
import { arrange, bind, childrenOf, collapse, DIRECTIONS, expand, GESTURES, hide, isDirection, isGesture, moveInOrder, note, question, reorder, ROOT, type SteerAction } from './steer-actions.ts';

export interface SteerHost {
  readonly canEdit: boolean;
  /** Sends one action; resolves when the hub accepted it. The host reports success and failure. */
  readonly send: (action: SteerAction) => Promise<void>;
}

function field(host: HTMLElement, label: string): HTMLElement {
  const f = h('div', 'v-field');
  f.appendChild(h('label', undefined, label));
  host.appendChild(f);
  return f;
}

function select(options: readonly string[], value: string, empty: string): HTMLSelectElement {
  const s = h('select', 'v-select');
  const none = h('option', undefined, empty);
  none.value = '';
  s.appendChild(none);
  for (const o of options) {
    const opt = h('option', undefined, o);
    opt.value = o;
    s.appendChild(opt);
  }
  s.value = value;
  return s;
}

function textarea(placeholder: string, value = ''): HTMLTextAreaElement {
  const t = h('textarea', 'v-text');
  t.placeholder = placeholder;
  t.value = value;
  t.rows = 2;
  return t;
}

export class SteerPanel {
  readonly el = h('div', 'v-steer');
  /** The child order being edited, kept across re-renders until it is saved or the selection changes. */
  private order: { node: string; ids: string[] } | undefined;

  constructor(private readonly host: SteerHost) {}

  render(ctx: ViewerContext): void {
    this.el.replaceChildren();
    const view = ctx.view;
    if (!this.host.canEdit) {
      this.el.appendChild(h('p', 'v-muted', 'Authors can steer this view. You have read access.'));
      return;
    }
    if (!view || !ctx.drawn) return;
    if (view.kind !== 'relation') {
      this.el.appendChild(h('p', 'v-muted', `Steering applies to relation views. This is a ${view.kind} view.`));
      return;
    }
    const node = ctx.node;
    if (node && this.order?.node !== node.id) this.order = undefined;
    if (node) this.renderNode(ctx, node);
    else this.el.appendChild(h('p', 'v-muted', 'Select a box to reorder, collapse, hide, or arrange it. The controls below steer the whole view.'));
    this.renderView(ctx);
  }

  private renderNode(ctx: ViewerContext, b: BundleBox): void {
    const view = ctx.view!;
    const drawn = ctx.drawn!;
    const head = h('div', 'v-steer-head');
    head.appendChild(h('h3', undefined, b.name));
    head.appendChild(h('span', 'v-muted', b.kind === 'collapsed' ? 'collapsed container' : b.kind));
    this.el.appendChild(head);

    const row = h('div', 'v-row');
    if (b.kind !== 'leaf') {
      const c = button('Collapse', () => void this.host.send(collapse(view.id, b.id)), `Show ${b.name} as one box in this view`);
      const e = button('Expand', () => void this.host.send(expand(view.id, b.id)), `Always open ${b.name} in this view`);
      if (b.kind === 'collapsed') c.disabled = true;
      row.append(c, e);
    }
    row.appendChild(button('Hide', () => void this.host.send(hide(view.id, b.id)), `Remove ${b.name} from this view`));
    this.el.appendChild(row);

    const kids = childrenOf(drawn, b.id);
    if (kids.length > 1) {
      const ids = this.order?.ids ?? kids.map((k) => k.id);
      this.order = { node: b.id, ids };
      const f = field(this.el, 'Order of children');
      const list = h('ol', 'v-order');
      ids.forEach((id, i) => {
        const li = h('li');
        li.appendChild(h('span', undefined, kids.find((k) => k.id === id)?.name ?? id));
        const up = button('▲', () => this.shift(ctx, id, -1), 'Move up');
        const down = button('▼', () => this.shift(ctx, id, 1), 'Move down');
        up.disabled = i === 0;
        down.disabled = i === ids.length - 1;
        li.append(up, down);
        list.appendChild(li);
      });
      f.appendChild(list);
      const save = button('Save order', () => void this.host.send(reorder(view.id, b.id, ids)).then(() => (this.order = undefined)), 'Write arrange.order for this container');
      save.disabled = ids.join() === kids.map((k) => k.id).join();
      f.appendChild(save);
    }
    if (b.kind !== 'leaf') this.renderArrange(view.id, b.id, `Arrange inside ${b.name}`);

    const n = field(this.el, 'Note on this box');
    const text = textarea('A callout pinned to this box');
    n.append(text, button('Add note', () => this.sendText(note(view.id, text.value, b.id)), 'Add an annotation at this box'));

    const bf = field(this.el, 'Bind to an observed entity');
    const input = h('input', 'v-input');
    input.placeholder = 'source:id';
    bf.append(input, button('Bind', () => void this.host.send(bind(b.id, input.value)), 'Set bind on this node; empty removes it'));
  }

  private renderView(ctx: ViewerContext): void {
    const view = ctx.view!;
    this.el.appendChild(h('h3', 'v-steer-h', 'This view'));
    const q = field(this.el, 'Question this view answers');
    const text = textarea('What should a reader learn here?', view.question ?? '');
    q.append(text, button('Save question', () => void this.host.send(question(view.id, text.value)), 'Write the view question'));
    const n = field(this.el, 'Note under the view');
    const noteText = textarea('A paragraph shown under the diagram');
    n.append(noteText, button('Add note', () => this.sendText(note(view.id, noteText.value)), 'Add a paragraph under the diagram'));
    this.renderArrange(view.id, ROOT, 'Arrange the canvas');
  }

  private renderArrange(view: string, node: string, label: string): void {
    const f = field(this.el, label);
    const row = h('div', 'v-row');
    const as = select(GESTURES, '', 'gesture');
    as.setAttribute('aria-label', 'Gesture');
    const dir = select(DIRECTIONS, '', 'direction');
    dir.setAttribute('aria-label', 'Direction');
    row.append(as, dir, button('Apply', () => {
      const action = arrange(view, node, { as: isGesture(as.value) ? as.value : '', direction: isDirection(dir.value) ? dir.value : '' });
      if (action) void this.host.send(action);
    }, 'Write the arrange hint'));
    f.appendChild(row);
  }

  private shift(ctx: ViewerContext, id: string, delta: number): void {
    if (!this.order) return;
    this.order = { node: this.order.node, ids: moveInOrder(this.order.ids, id, delta) };
    this.render(ctx);
  }

  private sendText(action: SteerAction | undefined): void {
    if (action) void this.host.send(action);
  }
}
