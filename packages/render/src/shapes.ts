/** Shape outlines as SVG path data, in local coordinates. */
import type { NodeShape } from '@vantage/model';

export function shapePath(shape: NodeShape, w: number, h: number): string {
  switch (shape) {
    case 'box':
      return `M0 0H${w}V${h}H0Z`;
    case 'rounded':
      return roundedRect(w, h, 8);
    case 'pill':
      return roundedRect(w, h, h / 2);
    case 'cylinder': {
      const ry = 6;
      return `M0 ${ry}A${w / 2} ${ry} 0 0 1 ${w} ${ry}V${h - ry}A${w / 2} ${ry} 0 0 1 0 ${h - ry}Z`;
    }
    case 'queue': {
      const rx = 6;
      return `M${rx} 0H${w - rx}A${rx} ${h / 2} 0 0 1 ${w - rx} ${h}H${rx}A${rx} ${h / 2} 0 0 1 ${rx} 0Z`;
    }
    case 'hexagon': {
      const d = Math.min(18, w * 0.18);
      return `M${d} 0H${w - d}L${w} ${h / 2}L${w - d} ${h}H${d}L0 ${h / 2}Z`;
    }
    case 'document': {
      const c = 8;
      return `M0 0H${w}V${h - c}Q${w * 0.75} ${h - c * 2.2} ${w / 2} ${h - c}T0 ${h - c}Z`;
    }
    case 'cloud': {
      return roundedRect(w, h, Math.min(22, h / 2));
    }
    case 'person':
      return roundedRect(w, h, 10);
    case 'ellipse':
      return `M0 ${h / 2}A${w / 2} ${h / 2} 0 1 0 ${w} ${h / 2}A${w / 2} ${h / 2} 0 1 0 0 ${h / 2}Z`;
    case 'circle': {
      const r = Math.min(w, h) / 2, cx = w / 2, cy = h / 2;
      return `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;
    }
    case 'diamond':
      return `M${w / 2} 0L${w} ${h / 2}L${w / 2} ${h}L0 ${h / 2}Z`;
    case 'parallelogram': {
      const d = Math.min(22, w * 0.2);
      return `M${d} 0H${w}L${w - d} ${h}H0Z`;
    }
    case 'triangle':
      return `M${w / 2} 0L${w} ${h}H0Z`;
  }
}

export function roundedRect(w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return `M${rr} 0H${w - rr}A${rr} ${rr} 0 0 1 ${w} ${rr}V${h - rr}A${rr} ${rr} 0 0 1 ${w - rr} ${h}H${rr}A${rr} ${rr} 0 0 1 0 ${h - rr}V${rr}A${rr} ${rr} 0 0 1 ${rr} 0Z`;
}

/** The extra top ellipse that makes a cylinder read as a database. */
export function cylinderCap(w: number): string {
  const ry = 6;
  return `M0 ${ry}A${w / 2} ${ry} 0 0 0 ${w} ${ry}`;
}
