/**
 * A reader's seat: where they are in a document and what they see. The
 * view, the container they zoomed into, the step of a walkthrough or a
 * path, the groups they opened or shut, the region of the picture on their
 * screen, and whether they present. Presence carries it; a follower takes it.
 */
import type { Rect } from './camera.ts';
import type { Groups } from './reshape.ts';

export type SeatStep = { readonly walk: number } | { readonly path: number; readonly step: number };

export interface Seat {
  readonly view?: string;
  readonly open?: string;
  readonly step?: SeatStep;
  readonly groups?: Groups;
  readonly cam?: Rect;
  readonly presenting?: boolean;
}

/** A seat from its parts, leaving out what is empty, so it reads the same however it was built. */
export function makeSeat(p: { view: string | undefined; open: string | undefined; step: SeatStep | undefined; groups: Groups | undefined; cam: Rect | undefined; presenting: boolean }): Seat {
  return {
    ...(p.view ? { view: p.view } : {}),
    ...(p.open ? { open: p.open } : {}),
    ...(p.step ? { step: p.step } : {}),
    ...(p.groups ? { groups: p.groups } : {}),
    ...(p.cam ? { cam: roundRect(p.cam) } : {}),
    ...(p.presenting ? { presenting: true } : {}),
  };
}

/** Canvas pixels to a tenth: finer is noise on the wire, and equal seats compare equal. */
function roundRect(r: Rect): Rect {
  const k = (n: number): number => Math.round(n * 10) / 10;
  return { x: k(r.x), y: k(r.y), w: Math.max(0.1, k(r.w)), h: Math.max(0.1, k(r.h)) };
}

/** Everything but the camera: a change here moves the reader somewhere others should hear about now. */
export function samePlace(a: Seat, b: Seat): boolean {
  const { cam: _a, ...pa } = a;
  const { cam: _b, ...pb } = b;
  return JSON.stringify(pa) === JSON.stringify(pb);
}

export function sameSeat(a: Seat, b: Seat): boolean {
  return samePlace(a, b) && JSON.stringify(a.cam ?? null) === JSON.stringify(b.cam ?? null);
}

/** Up to two initials for an avatar: "Ana Lopez" is AL, "ana" is A, an empty name is a dot. */
export function initials(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (!words.length) return '·';
  const first = [...words[0]!][0] ?? '';
  const last = words.length > 1 ? ([...words.at(-1)!][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** The path colors avatars take, one per session, so a person keeps their color across a visit. */
export const PEER_COLORS = ['blue', 'violet', 'emerald', 'amber', 'red', 'teal', 'pink'] as const;

export function peerColor(session: string): (typeof PEER_COLORS)[number] {
  let h = 0;
  for (const ch of session) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PEER_COLORS[h % PEER_COLORS.length]!;
}
