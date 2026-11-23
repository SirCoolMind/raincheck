import { describe, it, expect } from 'vitest';
import { describeBest, pickBest, scanDepartures } from '../../src/core/bestTime';
import { parseMytLocal } from '../../src/core/timing';
import type { DepartureRow, Level, Stretch, StretchEval } from '../../src/core/types';

const MIN = 60_000;
const base = parseMytLocal('2026-11-19T07:30');

function evals(levels: Level[]): StretchEval[] {
  return levels.map((level, i) => ({
    stretch: { index: i, startOffsetMin: i * 5, endOffsetMin: i * 5 + 5 } as unknown as Stretch,
    eta: { startMs: 0, endMs: 0, midMs: 0 },
    verdict: { level, baseLevel: level, radarBumped: false, agree: 0, total: 0, maxMmh: null, votes: [] },
  }));
}

describe('scanDepartures', () => {
  it('13 rows for +-60 / 10 and computes wetMin', () => {
    const rows = scanDepartures(base, () => evals(['rain', 'heavy', 'possible', 'dry', 'nodata']));
    expect(rows).toHaveLength(13);
    expect(rows[0]!.departMs).toBe(base - 60 * MIN);
    expect(rows[12]!.departMs).toBe(base + 60 * MIN);
    expect(rows[6]!.departMs).toBe(base);
    expect(rows[0]!.wetMin).toBe(15); // rain 5 + heavy 5 + possible 2.5 + nodata 2.5 (unknown is not dry)
    expect(rows[0]!.hasData).toBe(true);
    expect(rows[0]!.levels).toEqual(['rain', 'heavy', 'possible', 'dry', 'nodata']);
  });
  it('custom range/step; nodata rows', () => {
    const rows = scanDepartures(base, () => evals(['nodata', 'nodata']), 30, 15);
    expect(rows).toHaveLength(5);
    expect(rows[0]!.hasData).toBe(false);
    expect(rows[0]!.wetMin).toBe(5);
  });
  it('pickBest never picks a departure before notBefore', () => {
    const rows = scanDepartures(base, (d) => evals(d < base ? ['dry'] : ['rain']));
    expect(pickBest(rows)!.departMs).toBe(base - 60 * MIN);
    expect(pickBest(rows, base)!.departMs).toBe(base);
  });
});

describe('pickBest', () => {
  const row = (off: number, wetMin: number, hasData = true): DepartureRow => ({
    departMs: base + off * MIN,
    wetMin,
    hasData,
    levels: [],
  });
  it('lowest wetMin, ties earliest, ignores no-data rows', () => {
    const rows = [row(-20, 10), row(-10, 0, false), row(0, 5), row(10, 5), row(20, 7)];
    expect(pickBest(rows)!.departMs).toBe(base);
    expect(pickBest([row(10, 0), row(-10, 0)])!.departMs).toBe(base - 10 * MIN);
    expect(pickBest([row(-10, 0), row(10, 0)])!.departMs).toBe(base - 10 * MIN);
  });
  it('driest departure from a scan', () => {
    const rows = scanDepartures(base, (d) =>
      evals(d < base ? ['rain', 'rain'] : d === base ? ['possible', 'dry'] : ['dry', 'dry']),
    );
    const best = pickBest(rows)!;
    expect(best.departMs).toBe(base + 10 * MIN);
    expect(best.wetMin).toBe(0);
  });
  it('null when no data', () => {
    expect(pickBest([row(0, 0, false)])).toBeNull();
    expect(pickBest([])).toBeNull();
  });
});

describe('describeBest', () => {
  it('label', () => {
    const r: DepartureRow = { departMs: parseMytLocal('2026-11-19T07:10'), wetMin: 0, hasData: true, levels: [] };
    expect(describeBest(r, base)).toBe('Leave 07:10 · 0 wet min');
    expect(describeBest({ ...r, wetMin: 12.5 }, base)).toBe('Leave 07:10 · 13 wet min');
    expect(describeBest(null, base)).toBe('Not enough data');
  });
});
