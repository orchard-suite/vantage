/**
 * One view's standalone SVG, drawn when first asked for: the picture a
 * render keeps in its bundle, with the page background and the freshness
 * dimming a file that stands alone carries. It starts from the anchors the
 * render stored for the relation view before it, so it lays out as the
 * render did.
 */
import { layoutView } from '@vantage/layout';
import { renderSvg } from '@vantage/render';
import { loadOverlaid } from '../documents/model.ts';
import type { AnchorList, DocumentInput } from './document-task.ts';
import { resourcesFrom } from './resources.ts';

export interface ViewSvgInput extends Omit<DocumentInput, 'cached'> {
  readonly viewId: string;
  /** The anchors the render stored, by relation view. */
  readonly anchors: Readonly<Record<string, AnchorList>>;
}

export function viewSvg(input: ViewSvgInput): string | undefined {
  const model = loadOverlaid(input, input.observed, { now: new Date(input.now), thresholdDays: input.thresholdDays }).model;
  const at = model?.views.findIndex((v) => v.id === input.viewId) ?? -1;
  if (!model || at < 0) return undefined;
  const view = model.views[at]!;
  const prev = model.views.slice(0, at).findLast((v) => v.kind === 'relation');
  const incoming = prev ? input.anchors[prev.id] : undefined;
  const anchors = incoming ? new Map(incoming.map(([id, x, y]) => [id, { x, y }])) : undefined;
  const layout = layoutView(model, view, undefined, anchors);
  const theme = model.theme === 'dark' ? 'dark' : 'light';
  return renderSvg(layout, { theme, ...resourcesFrom(model, input.resources), freshness: { thresholdDays: input.thresholdDays, now: new Date(input.now) } });
}
