import { describe, expect, it } from 'vitest';
import { gridFor, parseWind, toVector, windAt, meanWind, compass, windUrl, type WindGrid } from '../../src/sources/wind';

describe('wind grid', () => {
  it('snaps outward to 0.5° and caps the points per side', () => {
    const g = gridFor({ west: 100.2, south: 1.7, east: 103.1, north: 4.4 });
    expect(g.bounds).toEqual({ west: 100, south: 1.5, east: 103.5, north: 4.5 });
    expect(g.cols).toBeLessThanOrEqual(6);
    expect(g.rows).toBeLessThanOrEqual(6);
    expect(g.points).toHaveLength(g.cols * g.rows);
    expect(g.points[0]).toEqual({ lat: 1.5, lon: 100 });
    expect(g.points.at(-1)).toEqual({ lat: 4.5, lon: 103.5 });
  });
  it('nearby routes share one request URL', () => {
    const a = gridFor({ west: 100.21, south: 1.71, east: 103.1, north: 4.4 });
    const b = gridFor({ west: 100.4, south: 1.9, east: 103.3, north: 4.3 });
    expect(windUrl(a.points)).toBe(windUrl(b.points));
    expect(windUrl(a.points)).toContain('current=wind_speed_10m,wind_direction_10m');
  });
});

describe('wind maths', () => {
  it('a north wind blows toward the south', () => {
    const v = toVector({ speed: 10, dir: 0 });
    expect(v.u).toBeCloseTo(0);
    expect(v.v).toBeCloseTo(-10);
    expect(compass(0)).toBe('north');
    expect(compass(225)).toBe('south-west');
    expect(compass(350)).toBe('north');
  });
  it('parses multi-point responses and tolerates gaps', () => {
    const pts = [{ lat: 3, lon: 101 }, { lat: 3, lon: 102 }];
    const s = parseWind([{ current: { wind_speed_10m: 8, wind_direction_10m: 90 } }, { current: {} }], pts);
    expect(s[0]).toEqual({ lat: 3, lon: 101, speed: 8, dir: 90 });
    expect(s[1]).toBeNull();
  });
  it('interpolates between grid points and averages direction as vectors', () => {
    const g: WindGrid = {
      cols: 2,
      rows: 2,
      bounds: { west: 0, south: 0, east: 1, north: 1 },
      samples: [
        { lat: 0, lon: 0, speed: 10, dir: 90 },
        { lat: 0, lon: 1, speed: 20, dir: 90 },
        { lat: 1, lon: 0, speed: 10, dir: 90 },
        { lat: 1, lon: 1, speed: 20, dir: 90 },
      ],
    };
    const mid = windAt(g, 0.5, 0.5)!;
    expect(mid.u).toBeCloseTo(-15); // from the east → toward the west
    expect(mid.v).toBeCloseTo(0);
    const m = meanWind(g)!;
    expect(m.speed).toBeCloseTo(15);
    expect(m.dir).toBeCloseTo(90);
  });
});
