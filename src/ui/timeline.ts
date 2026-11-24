// Journey strip: the trip as one takwim row. Equal-time cells on one shared baseline,
// time ticks beneath, waypoint places beneath that. Arrow keys move between cells.
import type { Actions, Store } from '../state';
import { on } from '../state';
import { el, clear } from './dom';
import { icon } from './icons';
import { formatHHMM, formatRange } from '../core/timing';
import { levelLabel } from '../core/summary';
import { formatMmh } from '../core/format';
import type { Level } from '../core/types';

const LEVELS: Level[] = ['dry', 'possible', 'rain', 'heavy', 'nodata'];

export function mountTimeline(root: HTMLElement, store: Store, actions: Actions): void {
  const heading = el('h2', { class: 'sec-h', id: 'strip-h' }, 'Your drive', el('small', { id: 'strip-sub' }));
  const strip = el('ol', { class: 'strip', 'aria-labelledby': 'strip-h', id: 'strip' });
  const ticks = el('div', { class: 'ticks', 'aria-hidden': 'true' });
  const places = el('div', { class: 'places', 'aria-hidden': 'true' });
  const legend = el(
    'div',
    { class: 'legend', 'aria-label': 'Legend' },
    ...LEVELS.map((lv) => el('span', {}, el('i', { class: `lv-${lv}` }, icon(lv, 12)), levelLabel(lv))),
    el('span', { class: 'leg-bump', hidden: '' }, el('i', { class: 'lv-rain', style: 'position:relative' }, el('span', { class: 'bump' })), 'Raised by radar'),
  );
  root.append(heading, strip, ticks, places, legend);

  let cells: HTMLButtonElement[] = [];

  const build = () => {
    const s = store.get();
    clear(strip);
    clear(ticks);
    clear(places);
    cells = [];
    const n = s.evals.length || 12;
    for (const node of [strip, ticks, places]) node.style.setProperty('--n', String(n));
    if (!s.evals.length) {
      // Loading shimmers; a failed load shows flat no-data cells (a shimmer would say "still loading").
      const cls = s.phase === 'error' ? 'cell lv-nodata' : 'cell skel';
      for (let i = 0; i < n; i++) strip.append(el('li', {}, el('div', { class: cls })));
      return;
    }
    s.evals.forEach((ev, i) => {
      const v = ev.verdict;
      const label = cellLabel(ev);
      const b = el(
        'button',
        {
          type: 'button',
          class: `cell lv-${v.level}`,
          'aria-label': label,
          'aria-pressed': 'false',
          'data-idx': String(i),
          tabindex: i === (s.selected ?? 0) ? '0' : '-1',
          onclick: () => actions.select(store.get().selected === i ? null : i),
          onmouseenter: () => actions.hover(i),
          onmouseleave: () => actions.hover(null),
          onfocus: () => actions.hover(i),
          onblur: () => actions.hover(null),
          onkeydown: (e: Event) => keynav(e as KeyboardEvent, i),
        },
        icon(v.level, 16),
        v.radarBumped ? el('span', { class: 'bump', 'aria-hidden': 'true' }) : null,
      );
      cells.push(b);
      strip.append(el('li', {}, b));
      // Ticks: every 3rd stretch start, plus arrival.
      const tick = i % 3 === 0 ? formatHHMM(ev.eta.startMs) : '';
      ticks.append(el('span', { class: i === 0 ? 'major' : '', text: tick }));
      places.append(el('span', {}, el('b')));
    });
    // Place labels at the first and last cells (plus a mid label if room), rendered under the baseline.
    const first = s.evals[0]!;
    const last = s.evals[s.evals.length - 1]!;
    const pl = places.children;
    const inner = (k: number) => (pl[k] as HTMLElement).firstElementChild as HTMLElement;
    inner(0).textContent = shortName(s, 0);
    const endCell = pl[pl.length - 1] as HTMLElement;
    inner(pl.length - 1).textContent = shortName(s, -1);
    endCell.classList.add('end');
    // One mid label: the intermediate waypoint passed closest to the middle of the trip (short, never a road name).
    const ends = new Set([shortName(s, 0), shortName(s, -1)]);
    const names = new Set(s.stops.map((w) => w.name).filter((nm) => !ends.has(nm)));
    const half = s.evals.length / 2;
    let midIdx = -1;
    s.evals.forEach((ev, i) => {
      if (names.has(ev.stretch.place) && i > 1 && i < s.evals.length - 3 && (midIdx < 0 || Math.abs(i - half) < Math.abs(midIdx - half))) midIdx = i;
    });
    const mid = midIdx >= 0 ? (pl[midIdx] as HTMLElement) : undefined;
    if (mid) {
      const mi = mid.firstElementChild as HTMLElement;
      mi.textContent = s.evals[midIdx]!.stretch.place;
      // Drop the mid label if its text would collide with either end label's text at this width.
      requestAnimationFrame(() => {
        const a = inner(0).getBoundingClientRect();
        const m = mi.getBoundingClientRect();
        const z = inner(pl.length - 1).getBoundingClientRect();
        if (m.left < a.right + 16 || m.right + 16 > z.left) mi.textContent = '';
      });
    }
    (ticks.lastElementChild as HTMLElement).textContent = formatHHMM(last.eta.endMs);
    (ticks.lastElementChild as HTMLElement).classList.add('major');
    (ticks.lastElementChild as HTMLElement).style.textAlign = 'right';
    const sub = root.querySelector('#strip-sub');
    if (sub) sub.textContent = `${formatHHMM(first.eta.startMs)} → ${formatHHMM(last.eta.endMs)} · ~${Math.round(last.stretch.endOffsetMin / s.evals.length)} min each`;
    highlight();
  };

  const shortName = (s: ReturnType<Store['get']>, pos: 0 | -1): string => {
    const wps = s.stops;
    const wp = pos === 0 ? wps[0] : wps[wps.length - 1];
    return wp?.name ?? '';
  };

  const highlight = () => {
    const s = store.get();
    const focus = s.hovered ?? s.selected;
    strip.classList.toggle('focus', focus !== null);
    cells.forEach((c, i) => {
      c.classList.toggle('on', i === focus);
      c.setAttribute('aria-pressed', String(i === s.selected));
      c.tabIndex = i === (s.selected ?? 0) ? 0 : -1;
    });
  };

  const keynav = (e: KeyboardEvent, i: number) => {
    let j = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = Math.min(cells.length - 1, i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = cells.length - 1;
    else if (e.key === 'Escape') {
      actions.select(null);
      return;
    } else return;
    e.preventDefault();
    cells[j]?.focus();
    actions.select(j);
  };

  // Patch cells in place when only verdicts change (scrubbing, radar arrival) so focus is never lost.
  let shape = '';
  const update = () => {
    const s = store.get();
    const sig = `${s.evals.length ? '' : s.phase}${s.evals.length}:${s.evals[0]?.stretch.place}:${s.evals.at(-1)?.stretch.place}:${s.presetId}`;
    if (sig !== shape || cells.length !== s.evals.length) {
      shape = sig;
      build();
      return;
    }
    s.evals.forEach((ev, i) => {
      const b = cells[i]!;
      const v = ev.verdict;
      b.className = `cell lv-${v.level}`;
      b.replaceChildren(icon(v.level, 16));
      if (v.radarBumped) b.append(el('span', { class: 'bump', 'aria-hidden': 'true' }));
      b.setAttribute('aria-label', cellLabel(ev));
      const tick = ticks.children[i] as HTMLElement | undefined;
      if (tick && (i % 3 === 0 || i === s.evals.length - 1)) tick.textContent = i === s.evals.length - 1 ? formatHHMM(ev.eta.endMs) : formatHHMM(ev.eta.startMs);
    });
    const first = s.evals[0];
    const last = s.evals.at(-1);
    const sub = root.querySelector('#strip-sub');
    if (sub && first && last) sub.textContent = `${formatHHMM(first.eta.startMs)} → ${formatHHMM(last.eta.endMs)} · ~${Math.round(last.stretch.endOffsetMin / s.evals.length)} min each`;
    highlight();
  };
  const legBump = legend.querySelector<HTMLElement>('.leg-bump')!;
  on(store, ['evals', 'phase'], () => {
    update();
    legBump.hidden = !store.get().evals.some((e) => e.verdict.radarBumped);
    legend.hidden = store.get().phase === 'error' && !store.get().summary;
  });
  on(store, ['selected', 'hovered'], highlight, false);
}

function cellLabel(ev: import('../core/types').StretchEval): string {
  const v = ev.verdict;
  return `${formatRange(ev.eta.startMs, ev.eta.endMs)}, ${ev.stretch.place}: ${levelLabel(v.level)}${
    v.maxMmh !== null ? `, up to ${formatMmh(v.maxMmh)}` : ''
  }${v.radarBumped ? ', raised by radar' : v.radarLowered ? ', lowered by radar (clear now)' : ''}. ${v.total ? `${v.agree} of ${v.total} sources agree.` : ''}`;
}
