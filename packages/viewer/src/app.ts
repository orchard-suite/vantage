/** The viewer: the view list, the header, the stage with its inspector and story card, present mode. */
import { drawingNote, firstStepRect, firstView, pickerOrder, withPicture, type Bundle, type BundleBox, type BundleView } from './bundle.ts';
import { PanZoom } from './panzoom.ts';
import { ZOOM_STEP } from './wheel.ts';
import { Highlighter } from './highlight.ts';
import { morph } from './morph.ts';
import { STYLES } from './styles.ts';
import { downloadSvg, h } from './dom.ts';
import { Tip, wireEdgeTips } from './tip.ts';
import { aheadRequest, Reshaper } from './reshape.ts';
import type { EngineSource, LayoutEngine } from './engine.ts';
import { icon } from './icons.ts';
import { fillEmpty } from './empty.ts';
import { formatRoute, parseRoute } from './router.ts';
import { renderPanel } from './panel.ts';
import { Sheet } from './sheet.ts';
import { PathStepper, type StepPosition } from './stepper.ts';
import { DetailControl } from './detail.ts';
import { Presenter } from './present.ts';
import { Minimap } from './minimap.ts';
import { wireStepBadges, zoomInstead } from './taps.ts';
import { activateOnKey, labelSvg } from './a11y.ts';
import { Sidebar, docMeta } from './sidebar.ts';
import { Shell } from './shell.ts';
import { Help } from './help.ts';
import { Header } from './header.ts';
import { Walk } from './walk.ts';
import { makeSeat, type Seat } from './seat.ts';
import { union } from './camera.ts';
import { showDiagnostics } from './diag.ts';
import type { StagePick } from './pick.ts';
import { Reader } from './reader.ts';
import { initialTheme, toggleTheme } from './theme-switch.ts';
import { Overview } from './overview.ts';

/** Height of a container's title strip in canvas pixels; clicks there open or shut the group where it stands. */
const CONTAINER_HEADER = 34;
/** Room kept between the stage edge and a floating panel or card. */
const GAP = 16;

/** What the reader is looking at, for the hub panels: the view, the picture on the stage, and the selected box. */
export interface ViewerContext {
  readonly view: BundleView | undefined;
  readonly drawn: BundleView | undefined;
  readonly node: BundleBox | undefined;
}

export class App {
  readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly side: Sidebar;
  /** Show parts (hidden views) in the picker, presenting, and arrow navigation. */
  private parts = false;
  private readonly header: Header;
  private readonly panel: HTMLElement;
  private readonly sheet: Sheet;
  private readonly story: HTMLElement;
  private readonly tip: Tip;
  private readonly shell: Shell;
  private readonly help = new Help();
  private readonly empty: HTMLElement;
  private readonly panzoom: PanZoom;
  private readonly hl = new Highlighter();
  private readonly stepper: PathStepper;
  private readonly detail: DetailControl;
  private readonly presenter: Presenter;
  private readonly minimap: Minimap;
  private current: BundleView | undefined;
  /** The relation view under the current view (a walkthrough plays over its base). */
  private base: BundleView | undefined;
  /** What is on the stage right now: the base as authored, or as the reader reshaped or zoomed it. */
  private drawn: BundleView | undefined;
  /** The container the route zooms into. */
  private zoom: string | undefined;
  private readonly shaper: Reshaper;
  /** Bumped by every redraw, so a picture laid out for an older request never lands. */
  private ticket = 0;
  private svg: SVGSVGElement | undefined;
  private readonly walk: Walk;
  private readonly reader: Reader;
  private readonly overview: Overview;
  /** The stage area; overlays such as the visual diff mount here. */
  readonly main: HTMLElement;
  /** Hub mode only: the column the steer, comments, and history panels mount in. */
  readonly dock: HTMLElement | undefined;
  /** Hub mode only: the close button for the collaboration column or drawer. */
  readonly dockClose: HTMLButtonElement;
  /** Hub mode only: open comment counts per view, drawn as badges in the picker. */
  private badges: Readonly<Record<string, number>> = {};
  /** Fires when the view or the selected box changes. */
  onContext: ((ctx: ViewerContext) => void) | undefined;
  /** Hub mode only: picks boxes for a comment; while it picks, it takes clicks on the stage and Escape first. */
  picker: StagePick | undefined;
  /** Fires when the reader's seat may have moved: the camera, the view, the step, or the picture. */
  onSeat: (() => void) | undefined;
  /** Fires after any walkthrough or path step renders, from a click, a key, or `stepTo`; voice walkthroughs follow it. */
  onStep: (() => void) | undefined;

  constructor(private bundle: Bundle, mount: HTMLElement, engine: EngineSource | undefined) {
    this.shaper = new Reshaper(bundle, engine);
    document.documentElement.dataset['theme'] = initialTheme(bundle);
    const style = document.createElement('style');
    style.textContent = STYLES + (bundle.fontCss ?? '');
    document.head.appendChild(style);
    document.title = bundle.title;
    this.root = h('div', 'v-app');
    // The picture is rendered in the document's theme; the dark chrome re-tints a light picture with a filter.
    this.root.dataset['pic'] = bundle.theme;

    this.side = new Sidebar(bundle, (parts) => {
      this.parts = parts;
      this.buildPicker();
    }, (v, node) => {
      location.hash = formatRoute({ view: v.id, ...(node ? { node } : {}) });
      this.shell.afterPick();
    }, () => ((location.hash = formatRoute({})), this.shell.afterPick()));
    const side = this.side.el;

    const main = h('main', 'v-main');
    main.setAttribute('aria-labelledby', 'v-view-title');
    const area = h('div', 'v-area');
    this.main = area;
    const canvas = h('div', 'v-canvas');
    this.stage = h('div', 'v-stage');
    canvas.appendChild(this.stage);
    area.appendChild(canvas);
    this.detail = new DetailControl((depth) => this.setDepth(depth));
    if (bundle.hub) {
      this.root.classList.add('v-hub');
      this.dock = h('aside', 'v-dock');
      this.dock.setAttribute('aria-label', 'Collaboration');
    }
    this.shell = new Shell(this.root, side, this.dock, () => this.side.search.focus(), () => requestAnimationFrame(() => this.relayout()));
    this.dockClose = this.shell.dockClose;
    this.header = new Header(this.shell.menuBtn, this.detail.el, {
      fit: () => this.panzoom.fit(true),
      zoom: (f) => this.panzoom.zoomBy(f),
      present: () => this.presenter.toggle(),
      theme: () => this.toggleTheme(),
      download: () => this.download(),
      actualSize: () => this.panzoom.reset(),
      help: () => this.help.toggle(),
    });
    this.header.setTheme(document.documentElement.dataset['theme'] === 'dark');
    this.header.setDoc(bundle.title, docMeta(bundle), bundle.hub ? '/' : undefined);
    this.header.setStatus(drawingNote(bundle));
    if (this.dock) this.header.tools.insertBefore(this.shell.dockBtn, this.header.tools.firstElementChild);
    main.append(area);
    area.append(this.header.card, this.header.toolbar);
    this.empty = h('div', 'v-empty');
    area.appendChild(this.empty);
    this.panel = h('aside', 'v-panel');
    this.panel.setAttribute('aria-label', 'Details');
    area.appendChild(this.panel);
    this.sheet = new Sheet(this.panel, () => this.shell.narrow, (snap) => {
      this.updateInsets();
      // The clear area changed: keep the box in it unless the sheet covers the stage.
      if (this.context.node && snap !== 'full') this.panzoom.reveal(this.context.node);
    }, () => this.select(undefined));
    this.story = h('div', 'v-story');
    this.story.setAttribute('role', 'region');
    this.story.setAttribute('aria-label', 'Steps');
    this.story.addEventListener('v-resize', () => this.updateInsets());
    area.appendChild(this.story);
    this.tip = new Tip(area);
    this.reader = new Reader({ area, root: this.root, views: () => this.bundle.views, name: (id) => this.bundle.kit?.nodes.find((n) => n.id === id)?.name, drawn: () => this.drawn, select: (id) => this.select(id), light: (ids) => (this.hl.pin(ids), ids && this.frameBoxes(ids)), narrow: () => this.shell.narrow, resized: () => this.relayout() });
    this.overview = new Overview({ area, root: this.root, bundle: () => this.bundle, name: (id) => this.bundle.kit?.nodes.find((n) => n.id === id)?.name, marked: (has, open) => this.side.setHome(has, open, this.current?.id) });
    showDiagnostics(bundle.diagnostics, area);
    this.root.append(this.header.el, side, main);
    if (this.dock) this.root.appendChild(this.dock);
    this.root.append(this.shell.scrim, this.help.el);
    mount.replaceChildren(this.root);
    this.panzoom = new PanZoom(canvas, this.stage);
    this.minimap = new Minimap(this.panzoom);
    area.appendChild(this.minimap.el);
    this.panzoom.onChange = () => {
      this.minimap.draw();
      this.onSeat?.();
    };
    this.stepper = new PathStepper({ card: this.story, pin: (ids) => this.hl.pin(ids), frame: (ids) => this.frameBoxes(ids), moved: () => this.onStep?.() });
    this.walk = new Walk({ card: this.story, pin: (ids) => this.hl.pin(ids), frame: (ids) => this.frameBoxes(ids), resized: () => this.updateInsets(), moved: () => this.onStep?.() });
    this.presenter = new Presenter({
      root: this.root,
      slides: () => pickerOrder(this.bundle.views, this.parts).filter((v) => v.kind !== 'doc'),
      currentId: () => this.current?.id,
      goTo: (v) => (location.hash = formatRoute({ view: v.id })),
      stepForward: () => this.stepBy(1),
      stepBack: () => this.stepBy(-1),
      onToggle: (on) => {
        this.header.setPresenting(on);
        requestAnimationFrame(() => this.relayout());
      },
    });
    area.appendChild(this.presenter.counter);
    // The story and view cards settle their size after the first frame; frame again while the reader has not moved.
    const settle = new ResizeObserver(() => {
      this.updateInsets();
      this.panzoom.reopen();
    });
    settle.observe(this.story);
    settle.observe(this.header.card);
    canvas.addEventListener('click', (e) => {
      if (this.panzoom.gesturing || this.picker?.spot(e.clientX, e.clientY)) return;
      if (e.target === canvas || e.target === this.stage) this.select(undefined);
    });
    this.presenter.wireSwipe(canvas, () => this.panzoom.gesturing);
    if (!bundle.views.length) {
      this.header.set({ title: fillEmpty(this.empty, bundle) });
    }
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('hashchange', () => this.fromHash());
    window.addEventListener('resize', () => this.updateInsets());
    this.buildPicker();
    this.fromHash();
  }

  /** Swaps in a newer bundle and keeps the view, the zoom, the reader's changes, the camera, and the selected box. */
  update(bundle: Bundle): void {
    const id = this.current?.id;
    const focused = this.hl.focusedId;
    this.bundle = bundle;
    this.shaper.setBundle(bundle);
    this.header.setStatus(drawingNote(bundle));
    this.root.dataset['pic'] = bundle.theme;
    this.buildPicker();
    this.show(bundle.views.find((v) => v.id === id) ?? firstView(bundle.views), this.zoom, true);
    this.overview.follow(parseRoute(location.hash).view === undefined);
    if (focused && this.drawn?.boxes.some((b) => b.id === focused)) this.select(focused, false);
  }

  get context(): ViewerContext {
    const id = this.hl.focusedId;
    return { view: this.current, drawn: this.drawn, node: id ? this.drawn?.boxes.find((b) => b.id === id) : undefined };
  }

  /** Lays the view on the stage out from a newer version's kit ahead of the hub, whose own picture replaces it when drawn. */
  async drawAhead(engine: LayoutEngine): Promise<void> {
    const [base, ticket] = [this.base, this.ticket];
    const pic = base && !this.zoom ? await engine.request(aheadRequest(base), true) : undefined;
    if (pic && base && ticket === this.ticket && this.base === base) this.mount(withPicture(base, pic), this.drawn, true);
  }

  /** Where this reader is and what they see, for presence. */
  get seat(): Seat {
    const step = this.current?.kind === 'walkthrough' ? { walk: this.walk.index } : this.stepper.position;
    return makeSeat({ view: this.current?.id, open: this.zoom, step, groups: this.base && this.shaper.changes(this.base), cam: this.panzoom.region, presenting: this.presenter.active });
  }

  /** Takes another reader's seat: their view and zoom (replacing the route, so no hashchange fires), groups, step, and region. */
  sit(s: Seat): void {
    if (s.view && this.bundle.views.some((v) => v.id === s.view) && (s.view !== this.current?.id || s.open !== this.zoom)) {
      history.replaceState(history.state, '', formatRoute({ view: s.view, ...(s.open ? { open: s.open } : {}) }));
      this.fromHash();
    }
    if (s.view !== this.current?.id || !this.current || !this.base) return;
    if (this.shaper.adopt(this.base, s.groups)) {
      this.detail.attach(this.zoom ? undefined : this.base, this.shaper.depth(this.base));
      void this.redraw(undefined);
    }
    if (s.step && 'walk' in s.step) this.walk.go(this.current, s.step.walk);
    else if (s.step) this.stepper.go(s.step.path, s.step.step);
    if (s.cam) this.panzoom.showRegion(s.cam);
  }

  /** Puts a view drawn from unsaved YAML on the stage, morphing from what is there; none puts the saved view back. */
  showDraft(draft: BundleView | undefined): void {
    return draft ? this.mount(draft, this.drawn, true) : this.show(this.current, this.zoom, true);
  }

  /** Where the story on the stage stands; a walkthrough is path 0. */
  get position(): StepPosition {
    return this.current?.kind === 'walkthrough' ? { path: 0, step: this.walk.index } : (this.stepper.position ?? { path: 0, step: -1 });
  }

  /** Moves the story on the stage to a step, as the reader would. */
  stepTo(p: StepPosition): void {
    if (this.current?.kind === 'walkthrough') this.walk.move(this.current, p.step - this.walk.index);
    else this.stepper.goTo(p);
  }

  get views(): readonly BundleView[] {
    return this.bundle.views;
  }

  /** The app bar, where hub mode puts its document actions: Export, Share, Delete. */
  get bar(): Header {
    return this.header;
  }

  /** Lights boxes on the stage and dims the rest; undefined lights everything. */
  highlight(ids: readonly string[] | undefined): void {
    this.hl.pin(ids);
  }

  setBadges(counts: Readonly<Record<string, number>>, total: number): void {
    this.badges = counts;
    this.shell.setCount(total);
    this.buildPicker();
  }

  private buildPicker(): void {
    this.side.render(this.bundle.views, { currentId: this.current?.id, parts: this.parts, badges: this.badges });
  }

  private fromHash(): void {
    const route = parseRoute(location.hash);
    const view = this.bundle.views.find((v) => v.id === route.view) ?? firstView(this.bundle.views);
    if (view?.hidden && !this.parts) {
      this.parts = true;
      this.buildPicker();
    }
    if (view && (view !== this.current || route.open !== this.zoom)) this.show(view, route.open);
    // A page's second route part is a heading or a box it names; a picture's is a box to select.
    if (view?.kind === 'doc') this.reader.goTo(route.node);
    else if (route.node) this.select(route.node, false);
    this.overview.follow(route.view === undefined);
  }

  private show(view: BundleView | undefined, zoom: string | undefined, keepCamera = false): void {
    if (!view) return;
    const prev = this.drawn;
    // A walkthrough plays over its base view, and a page is read beside the view it names.
    const under = view.kind === 'walkthrough' ? view.baseView : view.beside;
    const base = (under !== undefined ? this.bundle.views.find((v) => v.id === under) : undefined) ?? view;
    this.current = view;
    this.base = base;
    this.zoom = zoom !== undefined && this.shaper.canOpen(zoom) ? zoom : undefined;
    this.hidePanel();
    this.walk.index = 0;
    // The story card takes its room before the camera frames the picture.
    if (view.kind === 'walkthrough') this.stepper.attach(undefined);
    // The picture on hand goes up now; one still to lay out morphs in when it is ready.
    const ready = this.shaper.ready(base, this.zoom);
    this.mount(withPicture(base, ready ?? base), prev, true);
    this.reader.show(view);
    if (view.kind !== 'walkthrough') this.stepper.attach(view.kind === 'doc' ? undefined : this.drawn);
    else this.walk.render(this.current, !keepCamera);
    // The view card's height is a top inset, so it takes its words before the camera frames the picture.
    this.renderHeader();
    this.updateInsets();
    if (!keepCamera && view.kind !== 'walkthrough') this.panzoom.open(firstStepRect(this.drawn));
    this.side.picker.setActive(view.id);
    this.detail.attach(this.zoom ? undefined : base, this.shaper.depth(base));
    this.presenter.update();
    this.onContext?.(this.context);
    if (ready) this.shaper.prefetch(base, ready, this.zoom);
    else void this.redraw(keepCamera ? undefined : 'open');
  }

  private renderHeader(): void {
    const view = this.current;
    if (!view) return;
    const name = this.zoom ? this.base?.boxes.find((b) => b.id === this.zoom)?.name ?? this.zoom : undefined;
    this.header.set({
      title: view.title,
      question: view.question,
      notes: view.notes,
      crumb: name !== undefined ? { back: this.base?.title ?? view.title, href: formatRoute({ view: view.id }), name } : undefined,
      score: this.base?.metrics ? { score: this.base.metrics.score, notes: this.base.metrics.notes } : undefined,
    });
  }

  /** Puts a picture on the stage, morphing from the previous one, and wires it. */
  private mount(drawn: BundleView, prev: BundleView | undefined, keepCamera: boolean): void {
    this.tip.hide();
    this.svg = morph(this.stage, prev, drawn, this.svg);
    this.drawn = drawn;
    this.hl.pin(undefined);
    this.hl.attach(this.svg, drawn);
    labelSvg(this.svg, drawn);
    this.wire(this.svg, drawn);
    this.panzoom.setContent(drawn.width, drawn.height, drawn.figureHeight);
    if (!keepCamera) this.panzoom.open(firstStepRect(this.drawn));
    this.minimap.attach(drawn);
    this.onSeat?.();
  }

  /** The stage changed size (a column opened, present mode): keep the insets right, then frame the step on show or refit. */
  private relayout(): void {
    this.updateInsets();
    if (this.current?.kind === 'walkthrough') return this.walk.render(this.current, true);
    if (!this.stepper.reframe()) this.panzoom.fit();
  }

  /** Tells the camera what the panel and the story card cover, so frames and fits stay in the clear. */
  private updateInsets(): void {
    const panel = this.panel.classList.contains('show'), story = this.story.classList.contains('show');
    const narrow = this.shell.narrow, presenting = this.root.classList.contains('v-present');
    this.root.classList.toggle('v-inspecting', panel); // the story card's width depends on it, so set it before measuring
    const tb = this.header.toolbar, card = story ? this.story.offsetHeight + GAP : 0, sheet = panel && narrow ? this.panel.offsetHeight : 0;
    // The toolbar sits at the stage's foot beside the story card when the card leaves it room, and rides above the card or the bottom sheet when not.
    const beside = card > 0 && tb.offsetHeight > 0 && tb.offsetLeft + tb.offsetWidth + GAP / 2 <= this.story.offsetLeft;
    this.main.style.setProperty('--lift', `${Math.max(beside ? 0 : card, sheet)}px`);
    const bar = presenting || !tb.offsetHeight ? 0 : tb.offsetHeight + GAP * 1.5;
    const cover = Math.max(card ? card + GAP / 2 : 0, sheet);
    const bottom = beside ? Math.max(cover, bar) : cover + bar;
    const top = this.header.card.offsetHeight ? this.header.card.offsetTop + this.header.card.offsetHeight + GAP / 2 : 0;
    const right = panel && !narrow ? this.panel.offsetWidth + GAP * 1.5 : 0;
    this.panzoom.insets = { top, right, bottom, left: this.reader.inset };
    for (const [name, px] of [['--head', top], ['--foot', bottom ? bottom + GAP / 2 : 0]] as const) this.main.style.setProperty(name, `${px}px`);
  }

  /** Frames the boxes of a story step; no boxes frames the whole picture. */
  private frameBoxes(ids: readonly string[] | undefined): void {
    const rects = (ids ?? []).map((id) => this.drawn?.boxes.find((b) => b.id === id)).filter((b): b is BundleBox => b !== undefined);
    const r = union(rects);
    if (r) this.panzoom.frameRect(r, (this.drawn?.boxes ?? []).filter((b) => b.kind !== 'container'));
    else this.panzoom.fit(true);
  }

  private setDepth(depth: number): void {
    if (!this.base) return;
    this.shaper.setDepth(this.base, depth);
    void this.redraw(undefined);
  }

  /** Opens or shuts a group where it stands; everything else keeps the reader's changes. */
  private toggle(b: BundleBox): void {
    if (!this.base) return;
    this.shaper.toggle(this.base, b);
    void this.redraw(b.id);
  }

  private zoomInto(id: string): void {
    if (this.current && this.shaper.canOpen(id)) location.hash = formatRoute({ view: this.current.id, open: id });
  }

  /**
   * Lays out the picture for the reader's changes and the zoom, then morphs
   * to it. `open` frames it fresh; a box id keeps that box still on screen
   * while the rest moves around it.
   */
  private async redraw(hold: 'open' | string | undefined): Promise<void> {
    const base = this.base;
    const zoom = this.zoom;
    if (!base) return;
    const ticket = ++this.ticket;
    const pic = await this.shaper.picture(base, zoom);
    if (!pic || ticket !== this.ticket || this.base !== base || this.zoom !== zoom) return;
    const before = hold !== undefined && hold !== 'open' ? this.drawn?.boxes.find((b) => b.id === hold) : undefined;
    const next = withPicture(base, pic);
    const focused = this.hl.focusedId;
    this.mount(next, this.drawn, true);
    const after = before ? next.boxes.find((b) => b.id === before.id) : undefined;
    if (before && after) this.panzoom.shiftBy(after.x - before.x, after.y - before.y);
    if (this.current?.kind === 'walkthrough') this.walk.render(this.current, false);
    else {
      if (hold === 'open') this.panzoom.open(firstStepRect(this.drawn));
      this.stepper.retarget(next);
    }
    if (focused && next.boxes.some((b) => b.id === focused)) this.select(focused, false);
    else this.hidePanel();
    this.shaper.prefetch(base, pic, zoom);
  }

  private wire(svg: SVGSVGElement, view: BundleView): void {
    for (const el of svg.querySelectorAll<SVGGElement>('.v-box')) {
      const id = el.dataset['id']!;
      const b = view.boxes.find((x) => x.id === id);
      el.addEventListener('mouseenter', () => {
        this.hl.hover(id);
        if (b?.description || b?.subtitle) this.tip.show(el, b.description ?? b.subtitle ?? '');
      });
      el.addEventListener('mouseleave', () => {
        this.hl.hover(undefined);
        this.tip.hide();
      });
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.panzoom.gesturing || this.picker?.box(id)) return;
        if (zoomInstead(this.panzoom, el, e)) return;
        if (b && b.kind !== 'leaf' && id !== this.zoom && this.shaper.canOpen(id)) {
          const r = el.getBoundingClientRect();
          const header = r.height * (CONTAINER_HEADER / b.h);
          if (e.clientY - r.top <= header) return this.toggle(b);
        }
        this.select(this.hl.focusedId === id ? undefined : id);
      });
      activateOnKey(el, () => this.select(this.hl.focusedId === id ? undefined : id));
    }
    wireEdgeTips(svg, view, this.hl, this.tip);
    wireStepBadges(svg, this.panzoom, (id) => this.stepper.jumpToBadge(id));
  }

  private hidePanel(): void {
    this.panel.classList.remove('show');
    this.sheet.hidden();
    this.updateInsets();
  }

  private select(id: string | undefined, pushHash = true): void {
    const view = this.drawn;
    this.hl.focus(id);
    this.reader.mark(id);
    if (pushHash && this.current) history.replaceState(null, '', formatRoute({ view: this.current.id, ...(id ? { node: id } : {}), ...(this.zoom ? { open: this.zoom } : {}) }));
    if (!id || !view) {
      this.hidePanel();
      this.onContext?.(this.context);
      return;
    }
    const b = view.boxes.find((x) => x.id === id);
    if (!b) {
      // The route named a box this picture does not draw: nothing is selected, so nothing dims.
      this.hl.focus(undefined);
      this.hidePanel();
      return;
    }
    renderPanel(this.panel, this.bundle, b, view, {
      select: (n) => this.select(n),
      reshape: b.id !== this.zoom && this.shaper.canOpen(b.id) ? { toggle: () => this.toggle(b), zoom: () => this.zoomInto(b.id) } : undefined,
      close: () => this.select(undefined),
    });
    this.panel.scrollTop = 0;
    this.sheet.shown();
    this.updateInsets();
    // Keep the box in sight beside the side sheet, or above the bottom sheet on a phone.
    this.panzoom.reveal(b);
    this.onContext?.(this.context);
  }

  /** One step on or back; false when the story has nowhere to go, so present mode turns the slide. */
  private stepBy(d: 1 | -1): boolean {
    if (this.current?.kind === 'walkthrough') return d > 0 ? this.walk.forward(this.current) : this.walk.back(this.current);
    if (!this.stepper.active || !(d > 0 ? this.stepper.hasNext : this.stepper.hasPrev)) return false;
    this.stepper.move(d);
    return true;
  }

  /** Escape closes the nearest open thing, one per press. */
  private escape(): void {
    if (this.help.open) return this.help.close();
    if (this.picker?.escape() || this.header.dismiss()) return;
    if (this.shell.narrow && this.root.querySelector('.v-side.open, .v-dock.open')) return this.shell.closeAll();
    if (this.hl.focusedId) return this.select(undefined);
    if (this.presenter.active) return this.presenter.exit();
    if (this.zoom && this.current) location.hash = formatRoute({ view: this.current.id });
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target;
    if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.classList.contains('v-item'))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (this.help.open && e.key !== 'Escape' && e.key !== '?') return;
    if ((this.reader.open || this.overview.open) && e.key.startsWith('Arrow')) return; // the arrows scroll the page
    switch (e.key) {
      case 'Escape':
        return this.escape();
      case 'f':
        return this.panzoom.fit(true);
      case '+':
      case '=':
        return this.panzoom.zoomBy(ZOOM_STEP);
      case '-':
        return this.panzoom.zoomBy(1 / ZOOM_STEP);
      case 'p':
        return this.presenter.toggle();
      case 'z':
        if (this.hl.focusedId) this.zoomInto(this.hl.focusedId);
        return;
      case 'v':
        return this.shell.toggleSide();
      case '/':
        e.preventDefault();
        this.shell.openSide();
        this.side.search.focus();
        this.side.search.select();
        return;
      case '?':
        return this.help.toggle();
      case 'ArrowRight':
        if (this.presenter.active) this.presenter.next();
        else this.stepBy(1);
        return;
      case 'ArrowLeft':
        if (this.presenter.active) this.presenter.prev();
        else this.stepBy(-1);
        return;
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (this.presenter.active) return this.presenter.jump(e.key === 'ArrowDown' ? 1 : -1);
        const views = pickerOrder(this.bundle.views, this.parts);
        const i = views.findIndex((v) => v.id === this.current?.id);
        const n = views[Math.max(0, Math.min(views.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (n) location.hash = formatRoute({ view: n.id });
        return;
      }
    }
  }

  private toggleTheme(): void {
    this.header.setTheme(toggleTheme(this.bundle) === 'dark');
    this.minimap.draw();
  }

  private download(): void {
    if (this.svg && this.current) downloadSvg(this.svg, `${this.current.id}${this.zoom ? `-${this.zoom}` : ''}.svg`, this.current.openItems === true);
  }
}
