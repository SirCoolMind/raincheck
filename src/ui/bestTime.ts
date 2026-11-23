// "Best time to leave" chip + the departure calendar (signature move): departures as takwim rows.
import type { Actions, Store } from '../state';
import { on } from '../state';
import { el, clear } from './dom';
import { icon } from './icons';
import { fold } from './fold';
import { formatHHMM } from '../core/timing';
import { levelLabel } from '../core/summary';

const NS = 'http://www.w3.org/2000/svg';

export function mountBestTime(root: HTMLElement, store: Store, actions: Actions): void {
  const chip = el('button', { type: 'button', class: 'best-chip', id: 'best-chip' });
  const grid = el('div', { class: 'cal-grid', role: 'list', 'aria-label': 'Wet minutes per departure time' });
  const key = el(
    'div',
    { class: 'legend cal-key', 'aria-hidden': 'true' },
    ...(['dry', 'possible', 'rain', 'heavy', 'nodata'] as const).map((lv) => el('span', {}, el('i', { class: `lv-${lv}` }, icon(lv, 12)), levelLabel(lv))),
  );
  const cal = el('div', { class: 'cal', id: 'cal-body' }, key, grid);
  // The calendar folds from the heading row, so a closed calendar costs no extra line.
  const calFold = fold({ key: 'cal', label: 'Calendar', body: cal, kind: 'pill', id: 'cal-toggle' });
  calFold.button.setAttribute('aria-label', 'Departure calendar: every departure ±60 min in 10-min steps');
  const h = el('div', { class: 'sec-row' }, el('h2', { class: 'sec-h', id: 'best-h' }, 'Best time to leave'), calFold.button);
  root.append(h, chip, cal);

  chip.addEventListener('click', () => {
    const b = store.get().best;
    if (b && !chip.classList.contains('same')) actions.setDepart(b.departMs);
  });

  let showPast = false;
  const render = () => {
    const s = store.get();
    clear(chip);
    clear(grid);
    const rows = s.bestRows;
    if (!rows.length) {
      chip.disabled = true;
      chip.append(
        s.phase === 'error'
          ? el('span', { class: 'best-sub', text: 'No departures to compare until a forecast loads.' })
          : el('span', { class: 'skel', text: 'Scanning departures…' }),
      );
      calFold.button.hidden = s.phase === 'error';
      cal.hidden = s.phase === 'error' || !calFold.isOpen();
      // Reserve the calendar's height while loading so nothing below it jumps when rows arrive.
      if (s.phase !== 'error') for (let k = 0; k < 10; k++) grid.append(el('div', { class: 'cal-skel skel', 'aria-hidden': 'true' }));
      return;
    }
    calFold.button.hidden = false;
    cal.hidden = !calFold.isOpen();
    const best = s.best;
    chip.disabled = !best;
    const cur = rows.reduce((a, r) => (Math.abs(r.departMs - s.departMs) < Math.abs(a.departMs - s.departMs) ? r : a), rows[0]!);
    // "No better time" when the best is not meaningfully drier than the current departure.
    const thin = (s.summary?.total ?? 0) < 3;
    const isCur = !!best && (Math.abs(best.departMs - s.departMs) < 60000 || best.wetMin >= cur.wetMin - 2.5);
    chip.classList.toggle('same', isCur);
    const max = Math.max(1, ...rows.map((r) => r.wetMin));
    chip.append(
      el('span', { class: 'best-time', text: best ? formatHHMM(isCur ? cur.departMs : best.departMs) : '—' }),
      el('span', {
        class: 'best-sub',
        text: best
          ? isCur
            ? cur.wetMin < 1
              ? 'Your time is already dry. Nothing better within ±60 min.'
              : `No drier time within ±60 min. ~${Math.round(cur.wetMin)} min in rain either way.`
            : best.wetMin < 1
              ? `Arrive ~${formatHHMM(best.departMs + s.tripMin * 60000)}${thin ? ' likely' : ''} dry instead of ~${Math.round(cur.wetMin)}\u00A0min in rain.`
              : `Arrive ~${formatHHMM(best.departMs + s.tripMin * 60000)} with ~${Math.round(best.wetMin)}\u00A0min in rain instead of ~${Math.round(cur.wetMin)}${thin ? ' (likely)' : ''}.`
          : 'Not enough data',
      }),
      spark(rows, max, isCur ? null : (best?.departMs ?? null), cur.departMs),
    );
    chip.prepend(el('span', { class: 'vh', text: 'Best time to leave: ' }));
    const n = s.evals.length || 12;
    grid.append(
      el(
        'div',
        { class: 'cal-head', 'aria-hidden': 'true' },
        el('span', { text: 'Leave' }),
        el('span', { text: 'your drive, stretch by stretch · 10-min steps' }),
        el('span', { text: 'wet min' }),
      ),
    );
    const pastCount = rows.filter((r) => r.departMs < Date.now() - 60000).length;
    if (pastCount && !showPast) {
      grid.append(
        el(
          'div',
          { role: 'listitem' },
          el('button', { type: 'button', class: 'cal-past', onclick: () => ((showPast = true), render()) }, `${pastCount} earlier departure${pastCount > 1 ? 's' : ''} already passed · show`),
        ),
      );
    }
    for (const r of rows) {
      const isBest = best && !isCur && r.departMs === best.departMs;
      const past = r.departMs < Date.now() - 60000;
      if (past && !showPast) continue;
      const days = el('span', { class: 'days', style: `--n:${n}`, 'aria-hidden': 'true' });
      r.levels.forEach((lv) => days.append(el('i', { class: `lv-${lv}`, title: levelLabel(lv) })));
      grid.append(
        el(
          'div',
          { role: 'listitem' },
          el(
            'button',
            {
              type: 'button',
              class: `cal-row${r === cur ? ' cur' : ''}${isBest ? ' best' : ''}${past ? ' past' : ''}`,
              disabled: past ? '' : undefined,
              onclick: () => actions.setDepart(r.departMs),
            },
            el('span', { class: 'vh', text: 'Leave ' }),
            el('span', { class: 't', text: formatHHMM(r.departMs) }),
            days,
            el('span', { class: 'w', text: r.hasData ? String(Math.round(r.wetMin)) : '—' }),
            el('span', { class: 'vh', text: ` wet minutes${isBest ? ', best' : ''}${r === cur ? ', current' : ''}${past ? ', already passed' : ''}` }),
          ),
        ),
      );
    }
  };
  on(store, ['bestRows', 'best', 'departMs', 'phase'], render);
}

function spark(rows: { departMs: number; wetMin: number }[], max: number, best: number | null, cur: number): SVGSVGElement {
  const w = 92;
  const hgt = 30;
  const bw = w / rows.length;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(hgt));
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.setAttribute('aria-hidden', 'true');
  rows.forEach((r, i) => {
    // A dry best departure still gets a visible ink mark (a zero-height bar would hide the answer).
    const bh = r.departMs === best && r.wetMin <= 0 ? 9 : r.wetMin <= 0 ? 2 : Math.max(3, (r.wetMin / max) * (hgt - 2));
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', String(i * bw + 0.75));
    rect.setAttribute('y', String(hgt - bh));
    rect.setAttribute('width', String(Math.max(1, bw - 1.5)));
    rect.setAttribute('height', String(bh));
    rect.setAttribute('rx', '1');
    rect.setAttribute('class', `${r.departMs === best ? 'best' : r.departMs === cur ? 'cur' : r.wetMin <= 0 ? 'zero' : ''}${r.departMs < Date.now() - 60000 ? ' past' : ''}`);
    svg.appendChild(rect);
  });
  return svg;
}
