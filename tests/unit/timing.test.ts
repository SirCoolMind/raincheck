import { afterEach, describe, it, expect } from 'vitest';
import { MYT_OFFSET_MS, type Waypoint } from '../../src/config';
import {
  buildStretches,
  etaFor,
  formatHHMM,
  formatRange,
  mytDateAt,
  mytParts,
  mytSlotKey,
  parseMytLocal,
  roundToStep,
  stretchPoints,
} from '../../src/core/timing';
import type { RouteData } from '../../src/core/types';

// slow local - fast highway - slow local. The time midpoint is NOT the distance midpoint.
const route: RouteData = {
  coords: [
    [101.0, 3.0],
    [101.1, 3.0],
    [101.9, 3.0],
    [102.0, 3.0],
  ],
  cumDurS: [0, 1200, 1800, 3000],
  roadNames: ['Local A', 'MEX', 'Local B', ''],
  totalDurS: 3000,
  distanceM: 111_000,
  legs: [],
};
const wps: Waypoint[] = [
  { id: 'a', name: 'Start', lat: 3.0, lon: 101.0 },
  { id: 'b', name: 'End', lat: 3.0, lon: 102.0 },
];

declare const process: { env: Record<string, string | undefined> };

const T0 = parseMytLocal('2026-11-19T07:30');

describe('mytParts / slot keys', () => {
  it('parts', () => {
    expect(mytParts(T0)).toEqual({ y: 2026, mo: 11, d: 19, hh: 7, mm: 30 });
  });
  it('midnight, month and year boundaries', () => {
    const cases: [string, string, 15 | 60][] = [
      ['2026-11-19T23:59', '2026-11-19T23:45', 15],
      ['2026-11-20T00:00', '2026-11-20T00:00', 15],
      ['2026-11-19T23:59', '2026-11-19T23:00', 60],
      ['2026-01-31T23:59', '2026-01-31T23:00', 60],
      ['2026-02-01T00:00', '2026-02-01T00:00', 60],
      ['2026-12-31T23:59', '2026-12-31T23:45', 15],
      ['2027-01-01T00:07', '2027-01-01T00:00', 15],
      ['2028-02-29T12:44', '2028-02-29T12:30', 15],
    ];
    for (const [input, key, step] of cases) expect(mytSlotKey(parseMytLocal(input), step)).toBe(key);
    const midnight = parseMytLocal('2027-01-01T00:00');
    expect(mytSlotKey(midnight - 1, 60)).toBe('2026-12-31T23:00');
    expect(mytSlotKey(midnight, 60)).toBe('2027-01-01T00:00');
  });
  const origTZ = process.env.TZ;
  afterEach(() => {
    if (origTZ === undefined) delete process.env.TZ;
    else process.env.TZ = origTZ;
  });
  it('is independent of the process time zone', () => {
    const inputs = ['2026-12-31T23:59', '2027-01-01T00:00', '2026-01-31T23:59', '2026-02-01T00:00', '2026-11-19T07:37'];
    const run = () =>
      inputs.flatMap((s) => [mytSlotKey(parseMytLocal(s), 15), mytSlotKey(parseMytLocal(s), 60), formatHHMM(parseMytLocal(s))]);
    const results: string[][] = [];
    for (const tz of ['UTC', 'America/New_York', 'Pacific/Kiritimati', 'Asia/Kuala_Lumpur']) {
      process.env.TZ = tz;
      results.push(run());
    }
    for (const r of results) expect(r).toEqual(results[0]);
    expect(results[0]![0]).toBe('2026-12-31T23:45');
  });
});

describe('parse / format helpers', () => {
  it('parseMytLocal round-trips', () => {
    for (const s of ['2026-11-19T07:30', '2026-12-31T23:45', '2027-01-01T00:00']) {
      expect(mytSlotKey(parseMytLocal(s), 15)).toBe(s);
    }
    expect(parseMytLocal('1970-01-01T08:00')).toBe(0);
    expect(() => parseMytLocal('nope')).toThrow();
  });
  it('mytDateAt', () => {
    const ref = parseMytLocal('2026-11-19T23:10');
    expect(mytDateAt('07:30', ref)).toBe(T0);
    expect(mytDateAt('7:05', ref)).toBe(parseMytLocal('2026-11-19T07:05'));
    // early MYT morning is still the previous UTC day: MYT calendar day of ref is used
    expect(mytDateAt('18:00', parseMytLocal('2026-11-19T00:05'))).toBe(parseMytLocal('2026-11-19T18:00'));
    expect(() => mytDateAt('x', ref)).toThrow();
  });
  it('formatHHMM / formatRange / roundToStep', () => {
    expect(formatHHMM(T0)).toBe('07:30');
    expect(formatHHMM(parseMytLocal('2026-11-19T00:05'))).toBe('00:05');
    expect(formatRange(T0, T0 + 3600_000)).toBe('07:30–08:30');
    expect(roundToStep(parseMytLocal('2026-11-19T07:32'), 5)).toBe(T0);
    expect(roundToStep(parseMytLocal('2026-11-19T07:33'), 5)).toBe(parseMytLocal('2026-11-19T07:35'));
  });
  it('offset constant', () => expect(MYT_OFFSET_MS).toBe(28_800_000));
});

describe('buildStretches', () => {
  it('default count follows trip length', () => {
    expect(buildStretches(route, wps, 60)).toHaveLength(12);
    expect(buildStretches(route, wps, 10)).toHaveLength(6);
    expect(buildStretches(route, wps, 300)).toHaveLength(24);
    expect(buildStretches(route, wps, 60, 4)).toHaveLength(4);
  });
  it.each([60, 75])('scales exactly to trip length %i', (trip) => {
    const s = buildStretches(route, wps, trip);
    expect(s[0]!.startOffsetMin).toBe(0);
    expect(s.at(-1)!.endOffsetMin).toBe(trip);
    expect(s.at(-1)!.endFrac).toBe(1);
  });
  it('stretches are equal in time and contiguous', () => {
    const s = buildStretches(route, wps, 60);
    for (const x of s) {
      expect(x.endOffsetMin - x.startOffsetMin).toBeCloseTo(5, 9);
      expect(x.midOffsetMin).toBeCloseTo((x.startOffsetMin + x.endOffsetMin) / 2, 9);
    }
    for (let i = 1; i < s.length; i++) expect(s[i]!.startOffsetMin).toBeCloseTo(s[i - 1]!.endOffsetMin, 9);
  });
  it('time midpoint is not the distance midpoint (local slow, highway fast)', () => {
    // total 3000 s: boundary at t=1500 lies in the fast leg: lon 101.1 + 0.8 * 0.5 = 101.5
    const s = buildStretches(route, wps, 60, 2);
    expect(s[0]!.coords.at(-1)![0]).toBeCloseTo(101.5, 6);
    // mid of stretch 0 is t=750 s in the slow first leg: lon 101.0625 (distance midpoint would be 101.25)
    expect(s[0]!.mid.lon).toBeCloseTo(101.0625, 6);
    // single stretch: mid t=1500 -> lon 101.5, which is NOT where the distance midpoint (101.5) ... equal by symmetry
    expect(buildStretches(route, wps, 60, 1)[0]!.mid.lon).toBeCloseTo(101.5, 6);
    // 3 stretches: mid of stretch 1 is t=1500 (101.5) but stretch 0 mid t=500 -> 101.0417
    const s3 = buildStretches(route, wps, 60, 3);
    expect(s3[0]!.mid.lon).toBeCloseTo(101.0417, 3);
    const s12 = buildStretches(route, wps, 60);
    const span = (x: (typeof s12)[number]) => Math.abs(x.coords.at(-1)![0] - x.coords[0]![0]);
    expect(span(s12[0]!)).toBeLessThan(span(s12[5]!));
  });
  it('ETAs grow monotonically', () => {
    const s = buildStretches(route, wps, 60);
    let prev = -Infinity;
    for (const x of s) {
      const e = etaFor(x, T0);
      expect(e.startMs).toBeLessThan(e.midMs);
      expect(e.midMs).toBeLessThan(e.endMs);
      expect(e.midMs).toBeGreaterThan(prev);
      prev = e.midMs;
    }
    expect(etaFor(s.at(-1)!, T0).endMs).toBe(T0 + 3600_000);
    expect(etaFor(s[0]!, T0).startMs).toBe(T0);
  });
  it('place naming: waypoint, road name, near fallback', () => {
    const s = buildStretches(route, wps, 60);
    expect(s[0]!.place).toBe('Start');
    expect(s.at(-1)!.place).toBe('End');
    expect(s.some((x) => x.place === 'MEX')).toBe(true);
    const noRoads: RouteData = { ...route, roadNames: ['', '', '', ''] };
    expect(buildStretches(noRoads, wps, 60).every((x) => !x.place.startsWith('near '))).toBe(true); // summary adds 'near'
    expect(buildStretches(noRoads, [], 60, 6)[0]!.place).toBe('the route');
  });
  it('district: Putrajaya bbox, nearest centroid', () => {
    const mk = (lat: number, lon: number): RouteData => ({
      coords: [
        [lon, lat],
        [lon + 0.0001, lat],
      ],
      cumDurS: [0, 100],
      roadNames: ['', ''],
      totalDurS: 100,
      distanceM: 10,
      legs: [],
    });
    expect(buildStretches(mk(2.95, 101.7), [], 30, 1)[0]!.district).toBe('Putrajaya');
    expect(buildStretches(mk(3.14, 101.69), [], 30, 1)[0]!.district).toBe('Kuala Lumpur');
    expect(buildStretches(mk(2.83, 101.5), [], 30, 1)[0]!.district).toBe('Kuala Langat');
    expect(buildStretches(mk(2.7, 101.72), [], 30, 1)[0]!.district).toBe('Sepang');
  });
  it('stretchPoints returns mids', () => {
    const s = buildStretches(route, wps, 60);
    expect(stretchPoints(s)).toEqual(s.map((x) => x.mid));
  });
});
