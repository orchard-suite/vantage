/** The engine without its tooling: what a browser loads to lay out a view. */
export * from './types.ts';
export { DEFAULT_STYLE, RULES, type LayoutStyle } from './style.ts';
export { layoutView, anchorsOf, type Anchors } from './layout.ts';
export { computeVisible, type VisibleSet, type VisibleNode } from './visible.ts';
export { depthStops, openedView, scopedView, zoomedView, type ViewScope } from './scope.ts';
