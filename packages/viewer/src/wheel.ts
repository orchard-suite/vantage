/**
 * Reads a wheel event as a zoom. The wheel never pans; dragging does that.
 * Every vertical wheel event zooms by its size, so a mouse notch, a
 * trackpad swipe, and a pinch all glide the same way the zoom buttons do.
 * A pinch arrives as a wheel event with the control key held and small
 * deltas, so it zooms faster per pixel than a scroll. Sideways deltas do
 * nothing. Mouse and trackpad are not told apart: browsers send the same
 * shape for both.
 */

/** One zoom step: the buttons, the + and - keys, and one mouse wheel notch. */
export const ZOOM_STEP = 1.25;

/** The pixels one mouse notch reports in Chromium, Safari, and Firefox in pixel mode. */
const NOTCH_PX = 120;
/** Zoom per pixel of scroll: one notch is one button step. */
const SCROLL_RATE = Math.log(ZOOM_STEP) / NOTCH_PX;
/** Zoom per pixel of pinch delta. */
const PINCH_RATE = 0.01;
/** The most one wheel event may zoom, in log scale: one button step, however fast the wheel spins. */
const MAX_LOG_STEP = Math.log(ZOOM_STEP);

/** The parts of a wheel event the reading needs. */
export interface WheelInput {
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
}

/** The zoom factor a wheel event asks for; 1 means no zoom. Above 1 zooms in. */
export function wheelZoom(e: WheelInput): number {
  if (!e.deltaY) return 1;
  // Lines or pages come from a notched wheel: one full step per event.
  const log = e.deltaMode !== 0
    ? -Math.sign(e.deltaY) * MAX_LOG_STEP
    : -e.deltaY * (e.ctrlKey || e.metaKey ? PINCH_RATE : SCROLL_RATE);
  return Math.exp(Math.max(-MAX_LOG_STEP, Math.min(MAX_LOG_STEP, log)));
}
