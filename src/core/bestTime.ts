// PURE best-departure scan.
import { formatHHMM } from './timing';
import type { DepartureRow, StretchEval } from './types';

const MIN = 60_000;

export function scanDepartures(
  baseMs: number,
  evaluate: (departMs: number) => StretchEval[],
  rangeMin = 60,
  stepMin = 10,
): DepartureRow[] {
  const rows: DepartureRow[] = [];
  for (let off = -rangeMin; off <= rangeMin; off += stepMin) {
    const departMs = baseMs + off * MIN;
    const evals = evaluate(departMs);
    let wetMin = 0;
    for (const e of evals) {
      const dur = e.stretch.endOffsetMin - e.stretch.startOffsetMin;
      const l = e.verdict.level;
      if (l === 'rain' || l === 'heavy') wetMin += dur;
      else if (l === 'possible' || l === 'nodata') wetMin += 0.5 * dur; // unknown is not "dry"
    }
    rows.push({
      departMs,
      wetMin,
      hasData: evals.some((e) => e.verdict.level !== 'nodata'),
      levels: evals.map((e) => e.verdict.level),
    });
  }
  return rows;
}

/** Earliest driest departure; never one before `notBeforeMs` (you can't leave in the past). */
export function pickBest(rows: DepartureRow[], notBeforeMs = -Infinity): DepartureRow | null {
  let best: DepartureRow | null = null;
  for (const r of rows) {
    if (!r.hasData || r.departMs < notBeforeMs) continue;
    if (!best || r.wetMin < best.wetMin || (r.wetMin === best.wetMin && r.departMs < best.departMs)) best = r;
  }
  return best;
}

export function describeBest(best: DepartureRow | null, _baseMs?: number): string {
  if (!best) return 'Not enough data';
  return `Leave ${formatHHMM(best.departMs)} · ${Math.round(best.wetMin)} wet min`;
}
