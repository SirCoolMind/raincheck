// RainViewer: radar frame index + point sampling from a 256px tile (alpha > 0 = echo).
import { ENDPOINTS } from '../config';
import { tileFor } from '../core/geo';
import type { LatLon, RadarDetail, RadarFrame, RadarIndex, RadarSample, SourceHealth } from '../core/types';
import { cachedReason, errReason, fetchViaProxyOrDirect, type FetchTune } from './http';

/** The free tier caps tile zoom at 7. */
export const MAX_ZOOM = 7;
const TTL_MS = 5 * 60 * 1000;

export interface TileOpts {
  color?: number;
  smooth?: number;
  snow?: number;
  size?: number;
}

export function tileUrl(host: string, frame: Pick<RadarFrame, 'path'>, z: number, x: number, y: number, o: TileOpts = {}): string {
  const { color = 2, smooth = 0, snow = 0, size = 256 } = o;
  return `${host}${frame.path}/${size}/${z}/${x}/${y}/${color}/${smooth}_${snow}.png`;
}

/** MapLibre raster tile template. */
export function rasterTemplate(host: string, frame: Pick<RadarFrame, 'path'>, o: TileOpts = {}): string {
  const { color = 2, smooth = 0, snow = 0, size = 256 } = o;
  return `${host}${frame.path}/${size}/{z}/{x}/{y}/${color}/${smooth}_${snow}.png`;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

function frames(list: unknown, kind: RadarFrame['kind']): RadarFrame[] {
  if (!Array.isArray(list)) return [];
  const out: RadarFrame[] = [];
  for (const f of list) {
    if (isRec(f) && typeof f.time === 'number' && typeof f.path === 'string') out.push({ time: f.time * 1000, path: f.path, kind });
  }
  return out;
}

export function parseRadar(json: unknown): RadarIndex | null {
  if (!isRec(json) || typeof json.host !== 'string' || !isRec(json.radar)) return null;
  const all = [...frames(json.radar.past, 'past'), ...frames(json.radar.nowcast, 'nowcast')];
  if (all.length === 0) return null;
  all.sort((a, b) => a.time - b.time);
  const gen = typeof json.generated === 'number' ? json.generated * 1000 : Date.now();
  return { host: json.host, frames: all, generatedMs: gen };
}

export async function fetchRadarIndex(tune: FetchTune = {}): Promise<{ index: RadarIndex | null; health: SourceHealth }> {
  const base = { id: 'radar' as const, label: 'Rain radar' };
  try {
    const r = await fetchViaProxyOrDirect<unknown>(ENDPOINTS.proxy.radar, ENDPOINTS.rainviewer, { ttlMs: TTL_MS, persist: true, ...tune });
    const index = parseRadar(r.data);
    if (!index) return { index: null, health: { ...base, state: 'failed', reason: 'no data in response', fetchedAt: null } };
    const hasNowcast = index.frames.some((f) => f.kind === 'nowcast');
    const via = r.stale ? 'cache' : r.via === 'proxy' ? 'proxy' : 'direct';
    let state: SourceHealth['state'] = 'ok';
    let reason = hasNowcast ? '' : 'no nowcast (free tier)';
    if (r.stale) {
      state = 'degraded';
      reason = cachedReason(r.fetchedAt);
    } else if (via === 'direct') {
      reason = reason ? `${reason}; direct` : 'direct (no proxy)';
    }
    return { index, health: { ...base, state, reason, fetchedAt: r.fetchedAt, via } };
  } catch (e) {
    return { index: null, health: { ...base, state: 'failed', reason: errReason(e), fetchedAt: null } };
  }
}

export interface ImageLike {
  width: number;
  height: number;
  data: ArrayLike<number>;
}
export type ImageLoader = (url: string) => Promise<ImageLike | null>;

/** Was rain detected at each point in the latest past radar frame? null = unknown (tile unreadable). */
export async function sampleRadar(index: RadarIndex, points: LatLon[], loadImage: ImageLoader): Promise<RadarSample[]> {
  const past = index.frames.filter((f) => f.kind === 'past');
  const frame = past[past.length - 1];
  if (!frame) return points.map(() => null);
  const refs = points.map((p) => tileFor(p, MAX_ZOOM));
  const tiles = new Map<string, Promise<ImageLike | null>>();
  for (const t of refs) {
    const url = tileUrl(index.host, frame, MAX_ZOOM, t.x, t.y);
    if (!tiles.has(url)) tiles.set(url, loadImage(url).catch(() => null));
  }
  return Promise.all(
    refs.map(async (t) => {
      const img = await tiles.get(tileUrl(index.host, frame, MAX_ZOOM, t.x, t.y));
      if (!img) return null;
      const px = Math.min(img.width - 1, Math.max(0, Math.round((t.px / 256) * img.width - 0.5)));
      const py = Math.min(img.height - 1, Math.max(0, Math.round((t.py / 256) * img.height - 0.5)));
      const a = img.data[(py * img.width + px) * 4 + 3];
      return a === undefined ? null : a > 0;
    }),
  );
}

const MIN_MS = 60_000;

/**
 * Per point, from the zoom-7 tiles (≈1.2 km per pixel in Malaysia):
 * - clear: the latest frame has no echo in a box of ±`radiusPx` pixels (≈ ±4 km) around the point;
 * - recentWet: any echo in that box in the frames of the hour before the latest one.
 * null when the tiles cannot be read. Each tile of each frame is loaded once.
 */
/** ≈ 28 km around the route's bounds. */
export const AREA_PAD_DEG = 0.25;
export const AREA_CLEAR_MAX_SHARE = 0.001;

export async function sampleRadarDetail(index: RadarIndex, points: LatLon[], loadImage: ImageLoader, radiusPx = 3): Promise<RadarDetail[]> {
  const past = index.frames.filter((f) => f.kind === 'past');
  const latest = past[past.length - 1];
  if (!latest) return points.map(() => ({ clear: null, recentWet: null }));
  const earlier = past.filter((f) => f !== latest && f.time >= latest.time - 60 * MIN_MS);
  const refs = points.map((p) => tileFor(p, MAX_ZOOM));
  // Whole area around the route in the latest frame (same tiles the map shows). Below ~0.1 % wet counts as clear,
  // so a stray clutter pixel does not block it.
  const share = (await radarCoverage({ ...index, frames: [latest] }, points, loadImage, AREA_PAD_DEG).catch(() => [null]))[0] ?? null;
  const areaClear = share === null ? null : share < AREA_CLEAR_MAX_SHARE;
  const cache = new Map<string, Promise<ImageLike | null>>();
  const load = (frame: RadarFrame, t: { x: number; y: number }) => {
    const url = tileUrl(index.host, frame, MAX_ZOOM, t.x, t.y);
    if (!cache.has(url)) cache.set(url, loadImage(url).catch(() => null));
    return cache.get(url)!;
  };
  // true = echo in the box, false = none, null = unreadable
  const boxWet = (img: ImageLike | null, t: { px: number; py: number }): boolean | null => {
    if (!img) return null;
    const s = img.width / 256;
    const r = Math.max(1, Math.round(radiusPx * s));
    const cx = Math.round(t.px * s);
    const cy = Math.round(t.py * s);
    for (let y = Math.max(0, cy - r); y <= Math.min(img.height - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(img.width - 1, cx + r); x++) {
        if ((img.data[(y * img.width + x) * 4 + 3] ?? 0) > 0) return true;
      }
    }
    return false;
  };
  return Promise.all(
    refs.map(async (t) => {
      const now = boxWet(await load(latest, t), t);
      let recentWet: boolean | null = null;
      for (const f of earlier) {
        const w = boxWet(await load(f, t), t);
        if (w === true) {
          recentWet = true;
          break;
        }
        if (w === false) recentWet = false;
      }
      return { clear: now === null ? null : !now, recentWet, areaClear };
    }),
  );
}

/**
 * Share of the area around the route with any radar echo, per frame (0..1; null = tiles unreadable).
 * The box is the route's bounds padded by `padDeg` (≈ 55 km per 0.5°), read from the same zoom-7 tiles
 * the map shows, so "dry nearby" in the panel matches what the map can show.
 */
export async function radarCoverage(index: RadarIndex, points: LatLon[], loadImage: ImageLoader, padDeg = 0.5): Promise<(number | null)[]> {
  if (!points.length) return index.frames.map(() => null);
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const nw = tileFor({ lat: Math.max(...lats) + padDeg, lon: Math.min(...lons) - padDeg }, MAX_ZOOM);
  const se = tileFor({ lat: Math.min(...lats) - padDeg, lon: Math.max(...lons) + padDeg }, MAX_ZOOM);
  const tiles: { x: number; y: number; x0: number; x1: number; y0: number; y1: number }[] = [];
  for (let x = nw.x; x <= se.x; x++) {
    for (let y = nw.y; y <= se.y; y++) {
      tiles.push({ x, y, x0: x === nw.x ? nw.px : 0, x1: x === se.x ? se.px : 255, y0: y === nw.y ? nw.py : 0, y1: y === se.y ? se.py : 255 });
    }
  }
  if (tiles.length > 6) return index.frames.map(() => null); // a huge box: not worth the downloads
  return Promise.all(
    index.frames.map(async (frame) => {
      let wet = 0;
      let all = 0;
      for (const t of tiles) {
        const img = await loadImage(tileUrl(index.host, frame, MAX_ZOOM, t.x, t.y)).catch(() => null);
        if (!img) return null;
        const k = img.width / 256;
        // Every 2nd pixel is plenty for an area share.
        for (let py = t.y0; py <= t.y1; py += 2) {
          for (let px = t.x0; px <= t.x1; px += 2) {
            const ix = Math.min(img.width - 1, Math.floor(px * k));
            const iy = Math.min(img.height - 1, Math.floor(py * k));
            all++;
            if ((img.data[(iy * img.width + ix) * 4 + 3] ?? 0) > 0) wet++;
          }
        }
      }
      return all ? wet / all : null;
    }),
  );
}

// Radar frame tile URLs are immutable (the frame time is in the path), so remember the pixels:
// re-loads, preset switches and auto-refresh reuse them instead of downloading again.
const tileMemo = new Map<string, Promise<ImageLike | null>>();
const TILE_MEMO_MAX = 64; // 13 frames × up to 4 tiles around a route, plus the point samples

/** Browser loader: fetch → bitmap → canvas pixels. Null on any error (CORS / tainted canvas). */
export const browserImageLoader: ImageLoader = (url) => {
  const hit = tileMemo.get(url);
  if (hit) return hit;
  const p = loadTilePixels(url).then((img) => {
    if (!img) tileMemo.delete(url); // don't remember failures
    return img;
  });
  tileMemo.set(url, p);
  if (tileMemo.size > TILE_MEMO_MAX) tileMemo.delete(tileMemo.keys().next().value as string);
  return p;
};

async function loadTilePixels(url: string): Promise<ImageLike | null> {
  try {
    const res = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob());
    const canvas: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return { width: d.width, height: d.height, data: d.data };
  } catch {
    return null;
  }
}
