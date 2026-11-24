import { describe, it, expect } from 'vitest';
import { evaluateTrip, probAt, valueAt } from '../../src/core/evaluate';
import { buildStretches, parseMytLocal } from '../../src/core/timing';
import type { PointSeries, RouteData, SourceResult } from '../../src/core/types';

const MIN = 60_000;
const t0 = parseMytLocal('2026-11-19T07:00');

const s15: PointSeries = {
  times: [t0, t0 + 15 * MIN, t0 + 30 * MIN],
  stepMin: 15,
  mmh: [0, 1.2, null],
  prob: [10, 80],
  probTimes: [t0, t0 + 60 * MIN],
};

describe('valueAt / probAt', () => {
  it('slot start inclusive, end exclusive', () => {
    expect(valueAt(s15, t0)).toBe(0);
    expect(valueAt(s15, t0 + 15 * MIN - 1)).toBe(0);
    expect(valueAt(s15, t0 + 15 * MIN)).toBe(1.2);
    expect(valueAt(s15, t0 + 30 * MIN)).toBeNull();
    expect(valueAt(s15, t0 + 45 * MIN)).toBeNull();
    expect(valueAt(s15, t0 - 1)).toBeNull();
    expect(valueAt(null, t0)).toBeNull();
  });
  it('hourly series', () => {
    const h: PointSeries = { times: [t0], stepMin: 60, mmh: [2] };
    expect(valueAt(h, t0 + 59 * MIN)).toBe(2);
    expect(valueAt(h, t0 + 60 * MIN)).toBeNull();
  });
  it('probAt', () => {
    expect(probAt(s15, t0 + 20 * MIN)).toBe(10);
    expect(probAt(s15, t0 + 60 * MIN)).toBe(80);
    expect(probAt(s15, t0 + 120 * MIN)).toBeNull();
    expect(probAt(null, t0)).toBeNull();
    expect(probAt({ times: [], stepMin: 15, mmh: [] }, t0)).toBeNull();
  });
});

const route: RouteData = {
  coords: [
    [101.0, 3.0],
    [101.5, 3.0],
  ],
  cumDurS: [0, 3600],
  roadNames: ['R', ''],
  totalDurS: 3600,
  distanceM: 50000,
  legs: [],
};

function src(id: 'metno' | 'om_best_match', series: (PointSeries | null)[], state: 'ok' | 'failed' = 'ok'): SourceResult {
  return { id, label: id, resolution: '', health: { id, label: id, state, reason: '', fetchedAt: null }, series };
}

describe('evaluateTrip', () => {
  const stretches = buildStretches(route, [], 60, 4); // mids at +7.5, 22.5, 37.5, 52.5 min
  const wet: PointSeries = { times: [t0], stepMin: 60, mmh: [1] };
  const dry: PointSeries = { times: [t0], stepMin: 60, mmh: [0] };

  it('votes per source incl. failed ones', () => {
    const sources = [src('metno', [wet, wet, wet, wet]), src('om_best_match', [null, null, null, null], 'failed')];
    const ev = evaluateTrip(stretches, t0, sources, null, t0);
    expect(ev).toHaveLength(4);
    expect(ev[0]!.verdict.votes).toHaveLength(2);
    expect(ev[0]!.verdict.votes[1]!.mmh).toBeNull();
    expect(ev[0]!.verdict.total).toBe(1);
    expect(ev[0]!.verdict.level).toBe('rain');
    expect(ev[0]!.eta.midMs).toBe(t0 + 7.5 * MIN);
  });
  it('series array shorter than stretches -> null', () => {
    const ev = evaluateTrip(stretches, t0, [src('metno', [dry])], null, t0);
    expect(ev[0]!.verdict.level).toBe('dry');
    expect(ev[3]!.verdict.level).toBe('nodata');
  });
  it('radar window logic', () => {
    const sources = [src('metno', [dry, dry, dry, dry])];
    const radar = [true, true, true, null];
    let ev = evaluateTrip(stretches, t0, sources, radar, t0);
    expect(ev.map((e) => e.verdict.level)).toEqual(['possible', 'possible', 'possible', 'dry']);
    expect(ev[0]!.verdict.radarBumped).toBe(true);
    // mid - now = 97.5 min > 90 -> no bump
    ev = evaluateTrip(stretches, t0, sources, radar, t0 - 90 * MIN);
    expect(ev[0]!.verdict.level).toBe('dry');
    // exactly 90 min ahead is inside
    ev = evaluateTrip(stretches, t0, sources, radar, t0 + 7.5 * MIN - 90 * MIN);
    expect(ev[0]!.verdict.level).toBe('possible');
    // mid exactly 15 min before now is inside, 1 ms more is outside
    ev = evaluateTrip(stretches, t0, sources, radar, t0 + 7.5 * MIN + 15 * MIN + 1);
    expect(ev[0]!.verdict.level).toBe('dry');
    ev = evaluateTrip(stretches, t0, sources, radar, t0 + 7.5 * MIN + 15 * MIN);
    expect(ev[0]!.verdict.level).toBe('possible');
    ev = evaluateTrip(stretches, t0, sources, null, t0);
    expect(ev.every((e) => e.verdict.level === 'dry')).toBe(true);
  });
  it('clear radar lowers only stretches reached within 40 min', () => {
    const sources = [src('metno', [wet, wet, wet, wet])]; // mids at +7.5, 22.5, 37.5, 52.5 min
    const detail = [0, 1, 2, 3].map(() => ({ clear: true, recentWet: false }));
    const ev = evaluateTrip(stretches, t0, sources, [false, false, false, false], t0, detail);
    expect(ev.map((e) => e.verdict.level)).toEqual(['possible', 'possible', 'possible', 'rain']);
    expect(ev[3]!.verdict.radarLowered).toBe(false);
    // no detail → unchanged (old behaviour)
    expect(evaluateTrip(stretches, t0, sources, [false, false, false, false], t0).every((e) => e.verdict.level === 'rain')).toBe(true);
  });
  it('nothing on radar around the route lowers stretches reached within 90 min', () => {
    const sources = [src('metno', [wet, wet, wet, wet])];
    const detail = [0, 1, 2, 3].map(() => ({ clear: true, recentWet: false, areaClear: true }));
    // now 40 min before departure: mids at +47.5 … +92.5 min
    const ev = evaluateTrip(stretches, t0, sources, [false, false, false, false], t0 - 40 * MIN, detail);
    expect(ev.map((e) => e.verdict.level)).toEqual(['possible', 'possible', 'possible', 'rain']);
  });
});
