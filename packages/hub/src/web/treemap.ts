/**
 * A squarified treemap: rectangles whose areas follow their values and whose
 * sides stay as near square as the values allow, so a name has room to sit.
 * The admin console draws the deployment and each workspace with it.
 */

export interface Tile<T> {
  readonly item: T;
  /** Position and size as percentages of the frame, so the map stretches with its box. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The worst aspect ratio in a row of areas laid along a side of the given length. */
function worst(areas: readonly number[], side: number): number {
  const sum = areas.reduce((a, b) => a + b, 0);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

/**
 * Lays the items out in a frame of the given proportions (width by height, in
 * any unit), biggest first. Items with no value get no tile. The result is in
 * percentages of the frame.
 */
export function squarify<T>(items: readonly T[], value: (item: T) => number, width: number, height: number): Tile<T>[] {
  const sorted = items.map((item) => ({ item, v: value(item) })).filter((e) => e.v > 0).sort((a, b) => b.v - a.v);
  const total = sorted.reduce((s, e) => s + e.v, 0);
  if (!total) return [];
  const scale = (width * height) / total;
  const queue = sorted.map((e) => ({ item: e.item, area: e.v * scale }));
  const out: Tile<T>[] = [];
  const free: Rect = { x: 0, y: 0, w: width, h: height };
  const place = (row: typeof queue): void => {
    const sum = row.reduce((s, e) => s + e.area, 0);
    if (free.w >= free.h) {
      const w = sum / free.h;
      let y = free.y;
      for (const e of row) {
        const h = e.area / w;
        out.push({ item: e.item, x: (free.x / width) * 100, y: (y / height) * 100, w: (w / width) * 100, h: (h / height) * 100 });
        y += h;
      }
      free.x += w;
      free.w -= w;
    } else {
      const h = sum / free.w;
      let x = free.x;
      for (const e of row) {
        const w = e.area / h;
        out.push({ item: e.item, x: (x / width) * 100, y: (free.y / height) * 100, w: (w / width) * 100, h: (h / height) * 100 });
        x += w;
      }
      free.y += h;
      free.h -= h;
    }
  };
  let row: typeof queue = [];
  for (const e of queue) {
    const side = Math.min(free.w, free.h);
    if (!row.length || worst([...row.map((r) => r.area), e.area], side) <= worst(row.map((r) => r.area), side)) {
      row.push(e);
      continue;
    }
    place(row);
    row = [e];
  }
  if (row.length) place(row);
  return out;
}
