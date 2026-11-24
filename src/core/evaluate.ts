// PURE trip evaluation: stretches x sources → verdicts.
import { etaFor } from './timing';
import type { PointSeries, RadarDetail, RadarSample, SourceResult, Stretch, StretchEval, Vote } from './types';
import { RADAR_CLEAR_WINDOW_MIN, RADAR_WINDOW_MIN, judge } from './verdict';

const MIN = 60_000;

export function valueAt(series: PointSeries | null | undefined, t: number): number | null {
  if (!series) return null;
  const w = series.stepMin * MIN;
  for (let k = 0; k < series.times.length; k++) {
    const s = series.times[k]!;
    if (s <= t && t < s + w) return series.mmh[k] ?? null;
  }
  return null;
}

export function probAt(series: PointSeries | null | undefined, t: number): number | null {
  if (!series?.prob || !series.probTimes) return null;
  for (let k = 0; k < series.probTimes.length; k++) {
    const s = series.probTimes[k]!;
    if (s <= t && t < s + 60 * MIN) return series.prob[k] ?? null;
  }
  return null;
}

export function evaluateTrip(
  stretches: Stretch[],
  departMs: number,
  sources: SourceResult[],
  radar: RadarSample[] | null,
  nowMs: number,
  detail: RadarDetail[] | null = null,
): StretchEval[] {
  return stretches.map((stretch, i) => {
    const eta = etaFor(stretch, departMs);
    const votes: Vote[] = sources.map((src) => {
      const series = src.series[i] ?? null;
      return { source: src.id, mmh: valueAt(series, eta.midMs), prob: probAt(series, eta.midMs) };
    });
    const withinWindow = eta.midMs - nowMs <= RADAR_WINDOW_MIN * MIN && eta.midMs >= nowMs - 15 * MIN;
    const withinClearWindow = eta.midMs - nowMs <= RADAR_CLEAR_WINDOW_MIN * MIN && eta.midMs >= nowMs - 15 * MIN;
    const d = detail?.[i] ?? null;
    const verdict = judge(votes, { wet: radar?.[i] ?? null, withinWindow, clear: d?.clear ?? null, recentWet: d?.recentWet ?? null, withinClearWindow });
    return { stretch, eta, verdict };
  });
}
