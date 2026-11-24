// Bottom sheet (mobile) with three snap points, and the stretch detail panel inside it.
import type { Actions, Store } from '../state';
import { on } from '../state';
import { el, clear } from './dom';
import { icon } from './icons';
import { formatRange, formatHHMM } from '../core/timing';
import { levelLabel } from '../core/summary';
import { formatMmh, formatProb } from '../core/format';
import { LIGHT_MMH, RAIN_MMH, RADAR_AREA_CLEAR_WINDOW_MIN, RADAR_CLEAR_WINDOW_MIN, RADAR_WINDOW_MIN } from '../core/verdict';
import { glossMalay } from '../sources/metmy';

// ───────────── Sheet drag ─────────────
type Snap = 'min' | 'mid' | 'max';

export function mountSheet(sheet: HTMLElement, handle: HTMLButtonElement, onChange: (coveredPx: number) => void): {
  snapTo(s: Snap): void;
} {
  const desk = matchMedia('(min-width: 1024px)');
  let snap: Snap = 'mid';
  const vh = () => window.innerHeight;
  // translateY from the sheet's own top (sheet height = vh - 56)
  const pos = (s: Snap): number => {
    const h = vh() - 56;
    if (s === 'max') return 0;
    if (s === 'min') return Math.max(0, h - 150);
    return Math.round(h * 0.24);
  };
  const apply = (y: number) => {
    sheet.style.setProperty('--sheet-y', `${y}px`);
    onChange(desk.matches ? 0 : vh() - 56 - y);
  };
  const snapTo = (s: Snap) => {
    snap = s;
    handle.setAttribute('aria-label', s === 'max' ? 'Collapse panel' : 'Expand panel');
    handle.setAttribute('aria-expanded', String(s === 'max'));
    apply(pos(s));
  };
  let startY = 0;
  let startT = 0;
  let base = 0;
  let dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    if (desk.matches) return;
    dragging = true;
    startY = e.clientY;
    startT = performance.now();
    base = pos(snap);
    sheet.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const y = Math.max(0, Math.min(pos('min'), base + (e.clientY - startY)));
    sheet.style.setProperty('--sheet-y', `${y}px`);
  });
  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('dragging');
    const dy = e.clientY - startY;
    const v = dy / Math.max(1, performance.now() - startT); // px/ms
    if (Math.abs(dy) < 6) {
      snapTo(snap === 'max' ? 'mid' : 'max'); // tap toggles
      return;
    }
    const y = base + dy;
    const order: Snap[] = ['max', 'mid', 'min'];
    let target = order.reduce((a, b) => (Math.abs(pos(b) - y) < Math.abs(pos(a) - y) ? b : a));
    if (v < -0.5) target = snap === 'min' ? 'mid' : 'max';
    if (v > 0.5) target = snap === 'max' ? 'mid' : 'min';
    snapTo(target);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') snapTo(snap === 'min' ? 'mid' : 'max');
    else if (e.key === 'ArrowDown') snapTo(snap === 'max' ? 'mid' : 'min');
    else return;
    e.preventDefault();
  });
  addEventListener('resize', () => snapTo(snap));
  desk.addEventListener('change', () => snapTo(snap));
  snapTo('mid');
  return { snapTo };
}

// ───────────── Stretch detail ─────────────
export function mountDetail(root: HTMLElement, store: Store, actions: Actions): void {
  const render = () => {
    const s = store.get();
    clear(root);
    const i = s.hovered ?? s.selected;
    const ev = i === null ? undefined : s.evals[i];
    root.hidden = !ev;
    if (!ev || i === null) return;
    const v = ev.verdict;
    const close = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close stretch detail', onclick: () => actions.select(null) }, icon('close', 20));
    root.append(
      el(
        'div',
        { class: 'detail-h' },
        el('div', { class: `verdict-tile lv-${v.level}`, 'aria-hidden': 'true' }, icon(v.level, 24)),
        el(
          'div',
          {},
          el('h3', { id: 'detail-h', tabindex: '-1', text: `${formatRange(ev.eta.startMs, ev.eta.endMs)} · ${levelLabel(v.level)}` }),
          el('p', { text: `${ev.stretch.place} · ${ev.stretch.district} · stretch ${i + 1} of ${s.evals.length}` }),
        ),
        close,
      ),
    );
    // Sources at this stretch
    const tbody = el('tbody');
    s.sources.forEach((src, si) => {
      const vote = v.votes[si];
      const mmh = vote?.mmh ?? null;
      tbody.append(
        el(
          'tr',
          { class: mmh === null ? '' : mmh >= RAIN_MMH ? 'wet' : mmh >= LIGHT_MMH ? '' : 'dry' },
          el('th', { scope: 'row' }, src.label, el('small', { text: src.health.state === 'ok' ? src.resolution : `${src.resolution} · ${src.health.reason}` })),
          el('td', { text: formatMmh(mmh) }),
          el('td', { class: 'prob', text: formatProb(vote?.prob ?? null), title: 'Chance of rain (hourly)' }),
        ),
      );
    });
    const radar = s.radarSamples?.[i] ?? null;
    const minsAway = Math.round((ev.eta.midMs - s.nowMs) / 60000);
    const det = s.radarDetail?.[i] ?? null;
    const radarText =
      radar === null
        ? 'unknown'
        : radar
          ? 'rain at this point now'
          : det?.clear
            ? det.recentWet
              ? 'clear now, rained here in the last hour (roads may be wet)'
              : det.areaClear
                ? 'clear within ~30 km of the route now'
                : 'clear within ~4 km now'
            : 'no rain at this point now';
    const radarCan =
      minsAway <= RADAR_CLEAR_WINDOW_MIN || (det?.areaClear && minsAway <= RADAR_AREA_CLEAR_WINDOW_MIN)
        ? 'radar can raise or lower this stretch'
        : minsAway <= RADAR_WINDOW_MIN
          ? 'radar can raise this stretch'
          : 'too far ahead for radar';
    tbody.append(
      el(
        'tr',
        { class: radar ? 'wet' : radar === false ? 'dry' : '' },
        el('th', { scope: 'row' }, 'Radar (latest frame)', el('small', { text: minsAway < 0 ? `ETA was ${-minsAway} min ago: ${radarCan}` : `ETA in ${minsAway} min: ${radarCan}` })),
        el('td', { colspan: '2', style: 'font-family:var(--font-body);font-size:14px', text: radarText + (v.radarBumped ? ' · raised one level' : v.radarLowered ? ' · lowered one level' : '') }),
      ),
    );
    root.append(
      el(
        'table',
        { class: 'vals', 'aria-describedby': 'detail-h' },
        el('caption', { class: 'vh', text: 'Each source at this stretch' }),
        el('thead', { class: 'vh' }, el('tr', {}, el('th', { text: 'Source' }), el('th', { text: 'Rain rate' }), el('th', { text: 'Chance' }))),
        tbody,
      ),
      el('p', { class: 'note', text: `${v.agree}/${v.total} sources agree · light ≥ ${LIGHT_MMH}, rain ≥ ${RAIN_MMH}, heavy ≥ 4 mm/h` }),
    );
    // MET Malaysia context (not a vote)
    const f = s.metmy?.forecasts.find((x) => x.district === ev.stretch.district && x.date === mytDate(ev.eta.midMs));
    if (f) {
      const hh = Number(formatHHMM(ev.eta.midMs).slice(0, 2));
      const part = hh < 12 ? f.morning : hh < 19 ? f.afternoon : f.night;
      const when = hh < 12 ? 'Morning' : hh < 19 ? 'Afternoon' : 'Night';
      const gloss = glossMalay(part);
      root.append(
        el(
          'div',
          { class: 'metmy' },
          el('b', { text: `MET Malaysia · ${f.district} · ${when}: ` }),
          el('span', { lang: 'ms', text: part }),
          gloss ? el('span', { class: 'gloss', text: ` (${gloss})` }) : null,
          el('div', { class: 'note', text: 'District text forecast, context only (not a vote).' }),
        ),
      );
    }
  };
  on(store, ['selected', 'hovered', 'evals', 'radarSamples', 'radarDetail', 'metmy'], render);
}

function mytDate(ms: number): string {
  const d = new Date(ms + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
