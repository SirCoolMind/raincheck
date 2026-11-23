import { describe, it, expect } from 'vitest';
import {
  bearingDeg,
  cumulativeDistances,
  haversineM,
  lerp,
  nearestVertex,
  pointAtMeasure,
  slicePolyline,
  snap,
  tileFor,
} from '../../src/core/geo';
import type { LonLat } from '../../src/core/types';

const line: LonLat[] = [
  [101.0, 3.0],
  [101.1, 3.0],
  [101.1, 3.1],
  [101.2, 3.1],
];

describe('geo', () => {
  it('haversine KLCC -> KLIA', () => {
    const d = haversineM({ lat: 3.1579, lon: 101.7123 }, { lat: 2.7456, lon: 101.7072 });
    expect(Math.abs(d / 1000 - 45.9)).toBeLessThan(0.3);
  });
  it('1 degree of lon on the equator', () => {
    const d = haversineM({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    expect(d / 1000).toBeCloseTo(111.195, 1);
  });
  it('cumulative distances', () => {
    const cum = cumulativeDistances(line);
    expect(cum[0]).toBe(0);
    let sum = 0;
    for (let i = 1; i < line.length; i++) {
      sum += haversineM({ lat: line[i - 1]![1], lon: line[i - 1]![0] }, { lat: line[i]![1], lon: line[i]![0] });
    }
    expect(cum[cum.length - 1]).toBeCloseTo(sum, 6);
  });
  it('lerp', () => expect(lerp(0, 10, 0.25)).toBe(2.5));
  it('pointAtMeasure interpolates and clamps', () => {
    const cum = cumulativeDistances(line);
    const mid = pointAtMeasure(line, cum, cum[1]! / 2);
    expect(mid.c[0]).toBeCloseTo(101.05, 6);
    expect(mid.seg).toBe(0);
    expect(pointAtMeasure(line, cum, -5).c).toEqual(line[0]);
    const end = pointAtMeasure(line, cum, 1e9);
    expect(end.c).toEqual(line[3]);
    expect(end.seg).toBe(2);
    expect(pointAtMeasure([[1, 2]], [0], 5).c).toEqual([1, 2]);
    expect(() => pointAtMeasure([], [], 0)).toThrow();
  });
  it('pointAtMeasure handles zero-length segments', () => {
    const c: LonLat[] = [
      [0, 0],
      [1, 0],
      [1, 0],
      [3, 0],
    ];
    const r = pointAtMeasure(c, [0, 5, 5, 10], 5);
    expect(r.c[0]).toBe(1);
  });
  it('slicePolyline pieces sum to total and ends match', () => {
    const cum = cumulativeDistances(line);
    const total = cum[cum.length - 1]!;
    const split = total * 0.37;
    const a = slicePolyline(line, cum, 0, split);
    const b = slicePolyline(line, cum, split, total);
    const len = (p: LonLat[]) => cumulativeDistances(p).at(-1)!;
    expect(len(a) + len(b)).toBeCloseTo(total, 3);
    expect(a[0]).toEqual(line[0]);
    expect(b.at(-1)).toEqual(line.at(-1));
    expect(a.at(-1)![0]).toBeCloseTo(b[0]![0], 9);
    expect(a.at(-1)![1]).toBeCloseTo(b[0]![1], 9);
  });
  it('nearestVertex', () => {
    expect(nearestVertex(line, { lat: 3.09, lon: 101.11 })).toBe(2);
  });
  it('bearing', () => {
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: -1, lon: 0 })).toBeCloseTo(180, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: -1 })).toBeCloseTo(270, 6);
  });
  it('snap', () => {
    expect(snap(2.9226)).toBe(2.9);
    expect(snap(101.651)).toBe(101.65);
  });
  it('tileFor', () => {
    expect(tileFor({ lat: 0, lon: 0 }, 1)).toEqual({ x: 1, y: 1, px: 0, py: 0 });
    const k = tileFor({ lat: 3.1579, lon: 101.7123 }, 7);
    expect(k.x).toBe(100);
    expect(k.y).toBe(62);
    expect(k.px).toBeGreaterThanOrEqual(0);
    expect(k.px).toBeLessThan(256);
  });
});
