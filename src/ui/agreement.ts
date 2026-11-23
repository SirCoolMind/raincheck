// Source-agreement dot matrix: sources × stretches. Replaces the legacy 9-column table.
// Dot fill = that source's own level at your ETA; hollow ring = no data. Bottom row = fused verdict.
import type { Actions, Store } from '../state';
import { on } from '../state';
import { el, clear } from './dom';
import { fold } from './fold';
import { levelOf } from '../core/verdict';
import { levelLabel } from '../core/summary';
import { formatMmh } from '../core/format';
import { formatHHMM } from '../core/timing';
import type { Level } from '../core/types';

export function mountAgreement(root: HTMLElement, store: Store, actions: Actions): void {
  const grid = el('div', { class: 'matrix', role: 'table', 'aria-labelledby': 'matrix-h', id: 'matrix-body' });
  const f = fold({ key: 'matrix', label: 'Do the sources agree?', body: grid, id: 'matrix-toggle' });
  const sub = el('small', { id: 'matrix-sub' });
  const h = el('h2', { class: 'sec-h fold-h', id: 'matrix-h' }, f.button, sub);
  root.append(h, grid);
  // Closed: one line that still answers the question. Open: how to read the dots.
  const setSub = () => {
    const s = store.get();
    const n = s.evals.length;
    const all = s.evals.filter((ev) => ev.verdict.total > 0 && ev.verdict.agree === ev.verdict.total).length;
    sub.textContent = f.isOpen() ? 'each dot = one source at your ETA' : !n ? '' : all === n ? 'all agree on every stretch' : all === 0 ? 'split on every stretch' : `all agree on ${all} of ${n} stretches`;
  };
  f.onChange(setSub);

  const render = () => {
    const s = store.get();
    clear(grid);
    const n = s.evals.length;
    grid.style.setProperty('--n', String(n || 12));
    // A table role needs rows; while empty (loading / all failed) the grid is a plain group.
    grid.setAttribute('role', n ? 'table' : 'group');
    if (!n) {
      grid.append(
        s.phase === 'error'
          ? el('p', { class: 'note', style: 'grid-column:1/-1', text: 'No sources answered, so there is nothing to compare yet.' })
          : el('div', { class: 'skel skel-line', style: 'grid-column:1/-1' }),
      );
      return;
    }
    // Header row (time ticks every 3rd)
    const head = el('div', { role: 'row', style: 'display:contents' }, el('span', { role: 'columnheader', class: 'rl' }, el('span', { class: 'vh', text: 'Source' })));
    s.evals.forEach((ev, i) =>
      head.append(
        el('span', {
          role: 'columnheader',
          class: 'num',
          'data-col': String(i),
          style: 'font-size:12px;color:var(--ink-3);text-align:center;overflow:visible;white-space:nowrap',
          text: i % 3 === 0 ? formatHHMM(ev.eta.startMs) : '',
          'aria-label': formatHHMM(ev.eta.startMs),
        }),
      ),
    );
    grid.append(head);
    s.sources.forEach((src, si) => {
      const row = el('div', { role: 'row', style: 'display:contents' });
      row.append(el('span', { role: 'rowheader', class: 'rl', title: `${src.label} · ${src.resolution}`, text: src.label }));
      s.evals.forEach((ev, i) => {
        const vote = ev.verdict.votes[si];
        const lv: Level = vote && vote.mmh !== null ? (levelOf(vote.mmh) ?? 'nodata') : 'nodata';
        row.append(
          el(
            'span',
            { role: 'cell', style: 'display:grid;place-items:center;min-height:16px' },
            el('button', {
              type: 'button',
              class: `dot lv-${lv}`,
              'data-col': String(i),
              tabindex: '-1',
              'aria-label': `${src.label}, ${formatHHMM(ev.eta.startMs)}: ${vote?.mmh === null || !vote ? 'no data' : formatMmh(vote.mmh)}`,
              title: `${src.label} ${formatHHMM(ev.eta.startMs)}: ${vote?.mmh === null || !vote ? 'no data' : formatMmh(vote.mmh)}`,
              onclick: () => actions.select(i),
              onmouseenter: () => actions.hover(i),
              onmouseleave: () => actions.hover(null),
            }),
          ),
        );
      });
      grid.append(row);
    });
    // Radar row
    if (s.radarSamples) {
      const row = el('div', { role: 'row', style: 'display:contents' });
      row.append(el('span', { role: 'rowheader', class: 'rl', text: 'Radar now', title: 'Latest radar frame; can only raise stretches within 90 min' }));
      s.evals.forEach((ev, i) => {
        const r = s.radarSamples?.[i] ?? null;
        row.append(
          el(
            'span',
            { role: 'cell', style: 'display:grid;place-items:center' },
            el('span', {
              class: `dot ${r === null ? 'lv-nodata' : r ? 'lv-rain' : 'lv-dry'}`,
              'data-col': String(i),
              style: 'border-radius:2px',
              title: r === null ? 'radar unknown' : r ? 'rain on radar now' : 'no rain on radar now',
              role: 'img',
              'aria-label': `Radar ${formatHHMM(ev.eta.startMs)}: ${r === null ? 'unknown' : r ? 'rain now' : 'dry now'}`,
            }),
          ),
        );
      });
      grid.append(row);
    }
    grid.append(el('span', { class: 'sep', 'aria-hidden': 'true' }));
    const fused = el('div', { role: 'row', style: 'display:contents' });
    fused.append(el('span', { role: 'rowheader', class: 'rl fused', text: 'Verdict' }));
    s.evals.forEach((ev, i) =>
      fused.append(
        el('span', {
          role: 'cell',
          class: `fused-cell lv-${ev.verdict.level}`,
          'data-col': String(i),
          'aria-label': `${formatHHMM(ev.eta.startMs)}: ${levelLabel(ev.verdict.level)} (${ev.verdict.agree}/${ev.verdict.total})`,
          title: `${levelLabel(ev.verdict.level)} · ${ev.verdict.agree}/${ev.verdict.total}`,
        }),
      ),
    );
    grid.append(fused);
  };

  const mark = () => {
    const s = store.get();
    const focus = s.hovered ?? s.selected;
    grid.querySelectorAll('.col-on').forEach((n) => n.classList.remove('col-on'));
    if (focus === null) return;
    grid.querySelectorAll(`[data-col="${focus}"]`).forEach((n) => n.classList.add('col-on'));
  };
  on(store, ['evals', 'sources', 'radarSamples', 'phase'], () => {
    render();
    setSub();
    mark();
  });
  on(store, ['selected', 'hovered'], mark, false);
}
