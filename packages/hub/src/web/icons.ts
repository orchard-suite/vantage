/** The hub pages' 16px line icons: 1.5px round strokes on a 16 grid, in the current color (as the viewer's icons.ts). */
const PATHS = {
  plus: 'M8 3v10M3 8h10',
  import: 'M8 10V2.5M5 5.5 8 2.5l3 3M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10',
  export: 'M8 2.5V10M5 7l3 3 3-3M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM10.3 10.3 13.5 13.5',
  chevron: 'M4.5 6.5 8 10l3.5-3.5',
  right: 'M6.5 4.5 10 8l-3.5 3.5',
  left: 'M9.5 4.5 6 8l3.5 3.5',
  home: 'M2.5 7.5 8 3l5.5 4.5V13a.5.5 0 0 1-.5.5H10V10H6v3.5H3a.5.5 0 0 1-.5-.5Z',
  clock: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM8 5v3l2 1.5',
  star: 'M8 2.5l1.7 3.5 3.8.5-2.8 2.6.7 3.8L8 11.1l-3.4 1.8.7-3.8L2.5 6.5l3.8-.5Z',
  users: 'M6 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.5 13.5c.4-2.3 2.2-3.5 4.5-3.5s4.1 1.2 4.5 3.5M10.5 2.7a2.5 2.5 0 0 1 0 4.6M12 10.2c1.4.4 2.3 1.6 2.5 3.3',
  grid: 'M2.5 2.5h4.5v4.5H2.5ZM9 2.5h4.5v4.5H9ZM2.5 9h4.5v4.5H2.5ZM9 9h4.5v4.5H9Z',
  list: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01',
  sort: 'M5 3v10M2.5 10.5 5 13l2.5-2.5M11 13V3M8.5 5.5 11 3l2.5 2.5',
  play: 'M5 3.5v9l7-4.5Z',
  copy: 'M5.5 5.5h7v8h-7ZM3.5 10.5v-8h7',
  code: 'M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5',
  trash: 'M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.6 8.4a.7.7 0 0 0 .7.6h5.4a.7.7 0 0 0 .7-.6l.6-8.4',
  fit: 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10',
  check: 'M3 8.5 6.5 12l6.5-7',
  warn: 'M8 2.5 14 13H2ZM8 6.5v3M8 11.2h.01',
  error: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM8 5v3.5M8 11h.01',
  moon: 'M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5Z',
  sun: 'M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1',
  monitor: 'M2.5 3h11v7.5h-11ZM6 13.5h4M8 10.5v3',
  layers: 'M8 2.5 13.5 5.5 8 8.5 2.5 5.5ZM2.5 8.5 8 11.5l5.5-3',
  out: 'M9.5 3.5h3v9h-3M6 5 3 8l3 3M3 8h7',
  menu: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11',
  close: 'M4 4l8 8M12 4l-8 8',
  chat: 'M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5v-2.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z',
  at: 'M10.2 8a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Zm0 0v.8a1.7 1.7 0 0 0 3.3.4V8A5.5 5.5 0 1 0 11 12.6',
  book: 'M3 3.5h4a1.5 1.5 0 0 1 1 .5 1.5 1.5 0 0 1 1-.5h4v9H9a1 1 0 0 0-1 1 1 1 0 0 0-1-1H3ZM8 4v9.5',
  user: 'M8 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM3 13.5c.5-2.4 2.4-3.7 5-3.7s4.5 1.3 5 3.7',
  key: 'M10.5 2.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM8.4 7.6 2.5 13.5M4.5 11.5l1.5 1.5M6 10l1.5 1.5',
  updown: 'M5 6 8 3l3 3M5 10l3 3 3-3',
  link: 'M7 9a3 3 0 0 0 4.2.2l2-2a3 3 0 0 0-4.2-4.2l-1 1M9 7a3 3 0 0 0-4.2-.2l-2 2a3 3 0 0 0 4.2 4.2l1-1',
} as const;

export type IconName = keyof typeof PATHS;

export function ico(name: IconName, size = 16): string {
  const w = name === 'more' ? 2.4 : 1.5;
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[name]}"/></svg>`;
}
