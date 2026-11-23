// Authored line icons, one 24-unit grid, 1.75 stroke, round caps. Built with createElementNS (no HTML strings).
import type { Level } from '../core/types';

const NS = 'http://www.w3.org/2000/svg';

type Shape = [tag: 'path' | 'circle' | 'line' | 'rect', attrs: Record<string, string | number>];

/** A symmetric gear outline in the 24×24 box: teeth on radius `ro`, valleys arcing on radius `ri`. */
function gearPath(teeth = 8, ro = 9.8, ri = 7.3): string {
  const step = (2 * Math.PI) / teeth;
  const at = (r: number, a: number) => `${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`;
  let d = '';
  for (let k = 0; k < teeth; k++) {
    const a = -Math.PI / 2 + k * step;
    d += `${k ? 'A' + ri + ' ' + ri + ' 0 0 1 ' : 'M'}${at(ri, a - 0.27 * step)}L${at(ro, a - 0.15 * step)}A${ro} ${ro} 0 0 1 ${at(ro, a + 0.15 * step)}L${at(ri, a + 0.27 * step)}`;
  }
  return `${d}A${ri} ${ri} 0 0 1 ${at(ri, -Math.PI / 2 - 0.27 * step)}Z`;
}

const ICONS: Record<string, Shape[]> = {
  // ☀ sun
  dry: [
    ['circle', { cx: 12, cy: 12, r: 4.2 }],
    ['path', { d: 'M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6' }],
  ],
  // ⛅ sun behind cloud
  possible: [
    ['path', { d: 'M8.2 7.4a3.6 3.6 0 0 1 6.6.6' }],
    ['path', { d: 'M9 2.8v1.4M3.9 4.9l1 1M2.8 10h1.4' }],
    ['path', { d: 'M7.5 19.5h9.2a3.8 3.8 0 0 0 .4-7.6 5 5 0 0 0-9.6 1.2 3.2 3.2 0 0 0 0 6.4Z' }],
  ],
  // ☂ umbrella
  rain: [
    ['path', { d: 'M3 12a9 9 0 0 1 18 0Z' }],
    ['path', { d: 'M12 12v6.6a2.2 2.2 0 0 1-4.4 0' }],
    ['path', { d: 'M12 3v.6' }],
  ],
  // ⛈ storm cloud with bolt
  heavy: [
    ['path', { d: 'M7 15.5h-.3a3.6 3.6 0 0 1-.2-7.2 5.2 5.2 0 0 1 10-.9 3.9 3.9 0 0 1 1 7.7' }],
    ['path', { d: 'M12.6 11.5 10 16h3.2l-2.4 4.6' }],
    ['path', { d: 'M8 18.4l-.8 1.8M16.5 17.6l-.8 1.8' }],
  ],
  nodata: [
    ['circle', { cx: 12, cy: 12, r: 8.5 }],
    ['path', { d: 'M8.5 12h7' }],
  ],
  play: [['path', { d: 'M8 5.5v13l10.5-6.5Z' }]],
  pause: [['path', { d: 'M8.5 5.5v13M15.5 5.5v13' }]],
  refresh: [['path', { d: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4' }]],
  sunMoon: [
    ['circle', { cx: 12, cy: 12, r: 7.5 }],
    ['path', { d: 'M12 4.5a7.5 7.5 0 0 1 0 15Z', fill: 'currentColor' }],
  ],
  clock: [
    ['circle', { cx: 12, cy: 12, r: 8.5 }],
    ['path', { d: 'M12 7.5V12l3 2' }],
  ],
  pin: [
    ['path', { d: 'M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z' }],
    ['circle', { cx: 12, cy: 10, r: 2.3 }],
  ],
  swap: [['path', { d: 'M7 4.5v15M4 16.5l3 3 3-3M17 19.5v-15M14 7.5l3-3 3 3' }]],
  search: [
    ['circle', { cx: 10.5, cy: 10.5, r: 6 }],
    ['path', { d: 'M15 15l5 5' }],
  ],
  close: [['path', { d: 'M6 6l12 12M18 6 6 18' }]],
  reset: [['path', { d: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4' }]],
  radar: [
    ['circle', { cx: 12, cy: 12, r: 8.5 }],
    ['circle', { cx: 12, cy: 12, r: 4.5 }],
    ['path', { d: 'M12 12l6-6' }],
  ],
  offline: [['path', { d: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4-2.4M19 13a10 10 0 0 0-2.4-1.7M2 9.5a15 15 0 0 1 5-2.9M22 9.5a15 15 0 0 0-9.6-3.9' }]],
  trash: [['path', { d: 'M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7' }]],
  chevron: [['path', { d: 'M6 9l6 6 6-6' }]],
  flag: [['path', { d: 'M6 20.5V4M6 4.5h11l-2.5 4 2.5 4H6' }]],
  check: [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  share: [['path', { d: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' }]],
  locate: [
    ['circle', { cx: 12, cy: 12, r: 3.2 }],
    ['path', { d: 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3' }],
  ],
  warning: [['path', { d: 'M12 3.5 21.5 20h-19ZM12 10v4.5M12 17.2v.3' }]],
  // Generated, not hand-drawn: 8 identical teeth, one pointing straight up, so the gear sits level.
  gear: [
    ['circle', { cx: 12, cy: 12, r: 3 }],
    ['path', { d: gearPath() }],
  ],
  send: [['path', { d: 'M4 11.5 20 4l-5.5 16-3.2-6.8ZM11.3 13.2 20 4' }]],
  edit: [['path', { d: 'M4.5 19.5l1-4L15.8 5.2a2 2 0 0 1 2.9 0l.1.1a2 2 0 0 1 0 2.9L8.5 18.5ZM13.5 7.5l3 3' }]],
  copy: [
    ['rect', { x: 8.5, y: 8.5, width: 11, height: 11, rx: 1.5 }],
    ['path', { d: 'M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5' }],
  ],
  route: [
    ['circle', { cx: 6, cy: 18, r: 2.2 }],
    ['circle', { cx: 18, cy: 6, r: 2.2 }],
    ['path', { d: 'M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8' }],
  ],
};

export function icon(name: keyof typeof ICONS | Level, size = 20, label?: string): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', `icon icon-${String(name)}`);
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
  }
  for (const [tag, attrs] of ICONS[name] ?? []) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    svg.appendChild(n);
  }
  return svg;
}
