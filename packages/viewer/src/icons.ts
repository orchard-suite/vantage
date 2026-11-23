/**
 * The viewer's icons: 16px line drawings on a 16 grid, stroked in the
 * current color so they follow the theme and the state of their button.
 */
const PATHS = {
  sidebar: '<rect x="2" y="3" width="12" height="10" rx="2"/><path d="M6 3v10"/>',
  fit: '<path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10"/>',
  minus: '<path d="M4 8h8"/>',
  plus: '<path d="M4 8h8M8 4v8"/>',
  present: '<path d="M5.5 4.2v7.6a.6.6 0 0 0 .9.5l6-3.8a.6.6 0 0 0 0-1L6.4 3.7a.6.6 0 0 0-.9.5Z"/>',
  more: '<circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  prev: '<path d="M10 3.5 5.5 8l4.5 4.5"/>',
  next: '<path d="M6 3.5 10.5 8 6 12.5"/>',
  back: '<path d="M7 3.5 2.5 8 7 12.5M3 8h10.5"/>',
  search: '<circle cx="7" cy="7" r="4.25"/><path d="m10.2 10.2 3.3 3.3"/>',
  moon: '<path d="M13 9.6A5.5 5.5 0 0 1 6.4 3a5.5 5.5 0 1 0 6.6 6.6Z"/>',
  sun: '<circle cx="8" cy="8" r="2.75"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/>',
  download: '<path d="M8 2.5v7.5M4.75 7 8 10.25 11.25 7M3 13.5h10"/>',
  keyboard: '<rect x="1.75" y="4" width="12.5" height="8" rx="1.5"/><path d="M4.5 6.75h.01M7 6.75h.01M9.5 6.75h.01M12 6.75h.01M5 9.5h6"/>',
  actual: '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M6 6.5 7 6v4M9 6.5 10 6v4"/>',
  chat: '<path d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7.5L4.5 14v-2.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z"/>',
  open: '<path d="M9.5 2.5h4v4M13.5 2.5 8 8M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/>',
  enter: '<path d="M2.5 8h8M7.5 4.5 11 8l-3.5 3.5M13.5 2.5v11"/>',
  notes: '<path d="M4 2.5h6l2.5 2.5v8.5H4Z"/><path d="M6.25 7.5h4M6.25 10h4"/>',
  info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.25v3.75M8 5h.01"/>',
  warn: '<path d="M8 2.5 14 13H2Z"/><path d="M8 6.5v3M8 11.25h.01"/>',
  // View kinds, drawn small beside a view's title in the list.
  sequence: '<path d="M4 2.5v11M12 2.5v11M4 6h7M11 6l-1.5-1.25M11 6 9.5 7.25M12 10H5M5 10l1.5-1.25M5 10l1.5 1.25"/>',
  flow: '<rect x="2" y="2.5" width="5" height="4" rx="1"/><rect x="9" y="9.5" width="5" height="4" rx="1"/><path d="M4.5 6.5v5H9"/>',
  gallery: '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>',
  page: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M2.5 7h11M7 7v6.5"/>',
  doc: '<path d="M4 2.5h5.5L12.5 5.5v8H4Z"/><path d="M9.5 2.5v3h3M6.25 8.5h4M6.25 11h4"/>',
  timeline: '<path d="M2 8h12"/><circle cx="4.5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/><path d="M7.5 4.5v7"/>',
  walkthrough: '<circle cx="4" cy="12" r="1.5"/><circle cx="12" cy="4" r="1.5"/><path d="M5.5 12H9a2 2 0 0 0 0-4H7a2 2 0 0 1 0-4h3.5"/>',
  part: '<path d="M8 2 13.5 5v6L8 14l-5.5-3V5Z" stroke-dasharray="2 1.6"/>',
  share: '<path d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.6.6M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.6-.6"/>',
  copy: '<rect x="5.5" y="5.5" width="7.5" height="8" rx="1.25"/><path d="M3.5 10.5V3.75a1.25 1.25 0 0 1 1.25-1.25H10"/>',
  check: '<path d="M3 8.5 6.5 12l6.5-7"/>',
  export: '<path d="M8 2.5V10M4.75 6.75 8 10l3.25-3.25M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2"/>',
  code: '<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3l-2 10"/>',
  // Reactions on boxes.
  thumb: '<path d="M5 7v6.5H2.75V7ZM5 7l2.4-4.3a1.25 1.25 0 0 1 2.3 1L9.1 6.5h3.3a1.2 1.2 0 0 1 1.2 1.4l-.9 4.6a1.2 1.2 0 0 1-1.2 1H5"/>',
  question: '<circle cx="8" cy="8" r="6"/><path d="M6.3 6.25a1.75 1.75 0 1 1 2.5 1.6c-.5.25-.8.65-.8 1.2v.3M8 11.25h.01"/>',
  trash: '<path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.6 8.4a.7.7 0 0 0 .7.6h5.4a.7.7 0 0 0 .7-.6l.6-8.4"/>',
  play: '<path d="M5 3.6v8.8a.6.6 0 0 0 .9.5l7-4.4a.6.6 0 0 0 0-1L5.9 3.1a.6.6 0 0 0-.9.5Z"/>',
  pause: '<path d="M5.5 3.5v9M10.5 3.5v9"/>',
  mic: '<rect x="5.75" y="1.75" width="4.5" height="8" rx="2.25"/><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.25"/>',
  stop: '<rect x="4" y="4" width="8" height="8" rx="1.25"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 16): SVGSVGElement {
  const holder = document.createElement('span');
  holder.innerHTML = `<svg class="v-ico" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
  return holder.firstElementChild as SVGSVGElement;
}
