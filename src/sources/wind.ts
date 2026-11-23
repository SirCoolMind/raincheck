// Surface wind around the route, for the radar minimap. ONE Open-Meteo request for a small grid of points
// (current 10 m wind), cached 30 min and keyed by a grid snapped to 0.5°, so nearby routes share it.
import { ENDPOINTS, TZ } from '../config';
import { fetchJson } from './http';

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface WindSample {
  lat: number;
  lon: number;
  /** km/h */
  speed: number;
  /** Degrees the wind blows FROM (meteorological), 0 = north. */
  dir: number;
}

export interface WindGrid {
  cols: number;
  rows: number;
  bounds: Bounds;
  /** Row-major from the south-west corner; null where the response had no value. */
  samples: (WindSample | null)[];
}

const SNAP = 0.5;
const TTL_MS = 30 * 60 * 1000;
const snapDown = (v: number) => Math.floor(v / SNAP) * SNAP;
const snapUp = (v: number) => Math.ceil(v / SNAP) * SNAP;

/** Grid points covering `b`, snapped outward to 0.5° and at most `max` per side. */
export function gridFor(b: Bounds, max = 6): { cols: number; rows: number; bounds: Bounds; points: { lat: number; lon: number }[] } {
  const bounds = { west: snapDown(b.west), south: snapDown(b.south), east: snapUp(b.east), north: snapUp(b.north) };
  const cols = Math.min(max, Math.max(2, Math.round((bounds.east - bounds.west) / SNAP) + 1));
  const rows = Math.min(max, Math.max(2, Math.round((bounds.north - bounds.south) / SNAP) + 1));
  const points: { lat: number; lon: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lat = bounds.south + ((bounds.north - bounds.south) * r) / (rows - 1);
      const lon = bounds.west + ((bounds.east - bounds.west) * c) / (cols - 1);
      points.push({ lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 });
    }
  }
  return { cols, rows, bounds, points };
}

export function windUrl(points: { lat: number; lon: number }[]): string {
  const q = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(2)).join(','),
    longitude: points.map((p) => p.lon.toFixed(2)).join(','),
    current: 'wind_speed_10m,wind_direction_10m',
    wind_speed_unit: 'kmh',
    timezone: TZ,
  });
  return `${ENDPOINTS.openMeteo}?${q.toString().replace(/%2C/g, ',')}`;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseWind(json: unknown, points: { lat: number; lon: number }[]): (WindSample | null)[] {
  const items: unknown[] = Array.isArray(json) ? json : [json];
  return points.map((p, i) => {
    const it = items[i];
    const cur = isRec(it) && isRec(it.current) ? it.current : null;
    const speed = num(cur?.wind_speed_10m);
    const dir = num(cur?.wind_direction_10m);
    return speed === null || dir === null ? null : { lat: p.lat, lon: p.lon, speed, dir };
  });
}

export async function fetchWind(b: Bounds, signal?: AbortSignal): Promise<WindGrid | null> {
  const g = gridFor(b);
  try {
    const r = await fetchJson<unknown>(windUrl(g.points), { ttlMs: TTL_MS, persist: true, retries: 1, timeoutMs: 8000, ...(signal ? { signal } : {}) });
    const samples = parseWind(r.data, g.points);
    return samples.some(Boolean) ? { cols: g.cols, rows: g.rows, bounds: g.bounds, samples } : null;
  } catch {
    return null;
  }
}

/** Wind as a vector the air moves TOWARD, in km/h: u east, v north. */
export function toVector(s: Pick<WindSample, 'speed' | 'dir'>): { u: number; v: number } {
  const a = (s.dir * Math.PI) / 180;
  return { u: -s.speed * Math.sin(a), v: -s.speed * Math.cos(a) };
}

/** Bilinear wind vector at (lat, lon), clamped to the grid; null when the corners are missing. */
export function windAt(g: WindGrid, lat: number, lon: number): { u: number; v: number } | null {
  const { west, south, east, north } = g.bounds;
  const fx = Math.max(0, Math.min(1, (lon - west) / (east - west))) * (g.cols - 1);
  const fy = Math.max(0, Math.min(1, (lat - south) / (north - south))) * (g.rows - 1);
  const c0 = Math.min(g.cols - 2, Math.floor(fx));
  const r0 = Math.min(g.rows - 2, Math.floor(fy));
  const tx = fx - c0;
  const ty = fy - r0;
  const at = (r: number, c: number) => {
    const s = g.samples[r * g.cols + c];
    return s ? toVector(s) : null;
  };
  const q = [at(r0, c0), at(r0, c0 + 1), at(r0 + 1, c0), at(r0 + 1, c0 + 1)];
  if (q.some((x) => !x)) {
    const any = q.find(Boolean);
    return any ?? null;
  }
  const [a, b, c, d] = q as { u: number; v: number }[];
  const mix = (k: 'u' | 'v') => (a![k] * (1 - tx) + b![k] * tx) * (1 - ty) + (c![k] * (1 - tx) + d![k] * tx) * ty;
  return { u: mix('u'), v: mix('v') };
}

/** Vector mean of the grid: average speed (km/h) and the direction it blows FROM. */
export function meanWind(g: WindGrid): { speed: number; dir: number } | null {
  const vs = g.samples.filter((s): s is WindSample => !!s);
  if (!vs.length) return null;
  let u = 0;
  let v = 0;
  for (const s of vs) {
    const w = toVector(s);
    u += w.u;
    v += w.v;
  }
  u /= vs.length;
  v /= vs.length;
  const speed = vs.reduce((a, s) => a + s.speed, 0) / vs.length;
  const dir = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
  return { speed, dir };
}

const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** 'north-east' etc. for a direction in degrees. */
export function compass(dir: number): string {
  return POINTS[Math.round((((dir % 360) + 360) % 360) / 45) % 8]!;
}
