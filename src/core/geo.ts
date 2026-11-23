// PURE geometry helpers. No DOM, no network.
import type { LatLon, LonLat } from './types';

const R = 6371008.8; // mean Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const ll = (c: LonLat): LatLon => ({ lat: c[1], lon: c[0] });

/** Cumulative distance (m) at each vertex; first = 0. */
export function cumulativeDistances(coords: LonLat[]): number[] {
  const out = new Array<number>(coords.length).fill(0);
  for (let i = 1; i < coords.length; i++) {
    out[i] = out[i - 1]! + haversineM(ll(coords[i - 1]!), ll(coords[i]!));
  }
  return out;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Point along a polyline where the monotonic `measure` (distance or time per vertex) reaches `target`.
 * Returns the interpolated coordinate and the segment index it falls in.
 */
export function pointAtMeasure(coords: LonLat[], measure: number[], target: number): { c: LonLat; seg: number } {
  if (coords.length === 0) throw new Error('empty polyline');
  if (coords.length === 1 || target <= measure[0]!) return { c: coords[0]!, seg: 0 };
  const last = coords.length - 1;
  if (target >= measure[last]!) return { c: coords[last]!, seg: Math.max(0, last - 1) };
  // binary search for segment i with measure[i] <= target < measure[i+1]
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (measure[mid]! <= target) lo = mid;
    else hi = mid;
  }
  const m0 = measure[lo]!;
  const m1 = measure[lo + 1]!;
  const t = m1 > m0 ? (target - m0) / (m1 - m0) : 0;
  const a = coords[lo]!;
  const b = coords[lo + 1]!;
  return { c: [lerp(a[0], b[0], t), lerp(a[1], b[1], t)], seg: lo };
}

/** Sub-polyline between two measure values (inclusive, interpolated ends). */
export function slicePolyline(coords: LonLat[], measure: number[], from: number, to: number): LonLat[] {
  const a = pointAtMeasure(coords, measure, from);
  const b = pointAtMeasure(coords, measure, to);
  const out: LonLat[] = [a.c];
  for (let i = a.seg + 1; i <= b.seg; i++) out.push(coords[i]!);
  out.push(b.c);
  return out;
}

/** Index of the vertex nearest to p (planar approximation is fine at city scale). */
export function nearestVertex(coords: LonLat[], p: LatLon): number {
  let best = 0;
  let bestD = Infinity;
  const k = Math.cos(rad(p.lat));
  for (let i = 0; i < coords.length; i++) {
    const dx = (coords[i]![0] - p.lon) * k;
    const dy = coords[i]![1] - p.lat;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Initial bearing a→b in degrees 0–360. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Snap to a grid (MET Norway: 0.05°) — rounds to 2 decimals cleanly. */
export function snap(v: number, step = 0.05): number {
  return Math.round(Math.round(v / step) * step * 100) / 100;
}

/** Tile x/y for a lat/lon at zoom z, plus pixel within the 256px tile. */
export function tileFor(p: LatLon, z: number): { x: number; y: number; px: number; py: number } {
  const n = 2 ** z;
  const fx = ((p.lon + 180) / 360) * n;
  const latR = rad(p.lat);
  const fy = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  const x = Math.floor(fx);
  const y = Math.floor(fy);
  return { x, y, px: Math.floor((fx - x) * 256), py: Math.floor((fy - y) * 256) };
}
