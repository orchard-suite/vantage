/**
 * Steer actions the panel sends to the hub, and the pure helpers that build
 * them from what is on the stage. One action is one YAML edit on the server.
 */
import type { BundleBox, BundlePicture } from './bundle.ts';

export const GESTURES = ['auto', 'flow', 'grid', 'row', 'column', 'mirror', 'ring', 'outline', 'matrix'] as const;
export const DIRECTIONS = ['right', 'down', 'left', 'up'] as const;
export type Gesture = (typeof GESTURES)[number];
export type Direction = (typeof DIRECTIONS)[number];

export type SteerAction =
  | { kind: 'order'; view: string; node: string; order: readonly string[] }
  | { kind: 'collapse'; view: string; node: string; on: boolean }
  | { kind: 'expand'; view: string; node: string; on: boolean }
  | { kind: 'hide'; view: string; node: string }
  | { kind: 'arrange'; view: string; node: string; as?: Gesture; direction?: Direction }
  | { kind: 'note'; view: string; text: string; at?: string }
  | { kind: 'question'; view: string; text: string }
  | { kind: 'bind'; node: string; bind: string };

/** The canvas itself, the container every top-level node sits in. */
export const ROOT = 'root';

/** Children of a container in reading order (top to bottom, then left to right); `ROOT` means the top level. */
export function childrenOf(pic: BundlePicture, container: string): BundleBox[] {
  const kids = pic.boxes.filter((b) => (container === ROOT ? b.parentId === undefined : b.parentId === container));
  return [...kids].sort((a, b) => (Math.abs(a.y - b.y) > Math.min(a.h, b.h) / 2 ? a.y - b.y : a.x - b.x));
}

/** The order with `id` moved by `delta` places, clamped to the ends. */
export function moveInOrder(order: readonly string[], id: string, delta: number): string[] {
  const i = order.indexOf(id);
  if (i < 0) return [...order];
  const j = Math.max(0, Math.min(order.length - 1, i + delta));
  const out = order.filter((x) => x !== id);
  out.splice(j, 0, id);
  return out;
}

export function reorder(view: string, node: string, order: readonly string[]): SteerAction {
  return { kind: 'order', view, node, order };
}

export function collapse(view: string, node: string, on = true): SteerAction {
  return { kind: 'collapse', view, node, on };
}

export function expand(view: string, node: string, on = true): SteerAction {
  return { kind: 'expand', view, node, on };
}

export function hide(view: string, node: string): SteerAction {
  return { kind: 'hide', view, node };
}

/** An arrange hint; an empty gesture or direction is left out so the server changes only what was picked. */
export function arrange(view: string, node: string, pick: { as?: Gesture | '' | undefined; direction?: Direction | '' | undefined }): SteerAction | undefined {
  const action: SteerAction = { kind: 'arrange', view, node, ...(pick.as ? { as: pick.as } : {}), ...(pick.direction ? { direction: pick.direction } : {}) };
  return action.as === undefined && action.direction === undefined ? undefined : action;
}

export function note(view: string, text: string, at?: string): SteerAction | undefined {
  const t = text.trim();
  if (!t) return undefined;
  return { kind: 'note', view, text: t, ...(at !== undefined ? { at } : {}) };
}

export function question(view: string, text: string): SteerAction {
  return { kind: 'question', view, text: text.trim() };
}

export function bind(node: string, target: string): SteerAction {
  return { kind: 'bind', node, bind: target.trim() };
}

export function isGesture(v: string): v is Gesture {
  return (GESTURES as readonly string[]).includes(v);
}

export function isDirection(v: string): v is Direction {
  return (DIRECTIONS as readonly string[]).includes(v);
}
