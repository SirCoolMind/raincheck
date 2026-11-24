// Open-Meteo: ONE request for all points, 4 models → 4 SourceResults.
import { ENDPOINTS, OPEN_METEO_MODELS, TZ, type OpenMeteoModel } from '../config';
import type { LatLon, PointSeries, SourceHealth, SourceResult } from '../core/types';
import { cachedReason, errReason, fetchViaProxyOrDirect } from './http';

const LABELS: Record<OpenMeteoModel, string> = {
  ecmwf_ifs025: 'ECMWF IFS 0.25°',
  gfs_seamless: 'GFS',
  icon_seamless: 'ICON',
  jma_seamless: 'JMA',
};
const RES_15 = '15-min (interpolated from hourly in Malaysia)';
const RES_60 = 'hourly';
const TTL_MS = 15 * 60 * 1000;

export interface OpenMeteoOpts {
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  bypassCache?: boolean;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

const toMs = (t: unknown): number => (typeof t === 'string' ? Date.parse(`${t}+08:00`) : NaN);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function timesOf(block: unknown): number[] | null {
  if (!isRec(block) || !Array.isArray(block.time)) return null;
  const t = block.time.map(toMs);
  return t.length > 0 && t.every(Number.isFinite) ? t : null;
}

function valuesOf(block: unknown, base: string, model: OpenMeteoModel, len: number): (number | null)[] | null {
  if (!isRec(block)) return null;
  const arr = block[`${base}_${model}`] ?? block[base];
  if (!Array.isArray(arr) || arr.length !== len) return null;
  return arr.map(num);
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Build the series for one model at one point; `fallback` reports that hourly was used. */
function seriesFor(point: unknown, model: OpenMeteoModel): { s: PointSeries; hourly: boolean } | null {
  if (!isRec(point)) return null;
  const mTimes = timesOf(point.minutely_15);
  const hTimes = timesOf(point.hourly);
  const m15 = mTimes ? valuesOf(point.minutely_15, 'precipitation', model, mTimes.length) : null;
  const hPrecip = hTimes ? valuesOf(point.hourly, 'precipitation', model, hTimes.length) : null;
  const prob = hTimes ? valuesOf(point.hourly, 'precipitation_probability', model, hTimes.length) : null;
  // Open-Meteo precipitation (and probability) is the sum/chance over the PRECEDING interval:
  // the value stamped 08:15 covers 08:00–08:15. Store slot STARTS so valueAt() lines up with MET Norway.
  const shift = (ts: number[], stepMin: number) => ts.map((t) => t - stepMin * 60_000);
  const probPart = prob && hTimes ? { prob, probTimes: shift(hTimes, 60) } : {};

  if (mTimes && m15 && m15.some((v) => v !== null)) {
    return { s: { times: shift(mTimes, 15), stepMin: 15, mmh: m15.map((v) => (v === null ? null : r3(v * 4))), ...probPart }, hourly: false };
  }
  if (hTimes && hPrecip && hPrecip.some((v) => v !== null)) {
    return { s: { times: shift(hTimes, 60), stepMin: 60, mmh: hPrecip, ...probPart }, hourly: true };
  }
  return null;
}

function failedAll(points: LatLon[], reason: string): SourceResult[] {
  return OPEN_METEO_MODELS.map((m) => ({
    id: `om_${m}` as const,
    label: LABELS[m],
    resolution: RES_15,
    health: { id: `om_${m}` as const, label: LABELS[m], state: 'failed', reason, fetchedAt: null } satisfies SourceHealth,
    series: points.map(() => null),
  }));
}

export function parseOpenMeteo(json: unknown, points: LatLon[], health: { stale: boolean; fetchedAt: number; via?: string }): SourceResult[] {
  const items: unknown[] = Array.isArray(json) ? json : [json];
  return OPEN_METEO_MODELS.map((m) => {
    const per = points.map((_, i) => seriesFor(items[i], m));
    const series = per.map((p) => p?.s ?? null);
    const got = series.some((s) => s !== null);
    const allHourly = got && per.every((p) => p === null || p.hourly);
    const id = `om_${m}` as const;
    let state: SourceHealth['state'] = 'ok';
    let reason = '';
    if (!got) {
      state = 'failed';
      reason = 'no data in response';
    } else if (health.stale) {
      state = 'degraded';
      reason = cachedReason(health.fetchedAt);
    } else if (allHourly) {
      state = 'degraded';
      reason = 'hourly only';
    }
    return {
      id,
      label: LABELS[m],
      resolution: allHourly ? RES_60 : RES_15,
      health: { id, label: LABELS[m], state, reason, fetchedAt: got ? health.fetchedAt : null, via: health.stale ? 'cache' : health.via === 'proxy' ? 'proxy' : 'direct' },
      series,
    };
  });
}

// 2 decimals (~1 km) is far finer than any model grid and matches api/openmeteo.php,
// so nearby routes share one cache entry instead of each costing a call.
const coord = (v: number) => (Math.round(v * 100) / 100).toFixed(2);

/** Same-origin proxy URL (server-side cache shared by every visitor). */
export function openMeteoProxyUrl(points: LatLon[]): string {
  return `${ENDPOINTS.proxy.openmeteo}?lat=${points.map((p) => coord(p.lat)).join(',')}&lon=${points.map((p) => coord(p.lon)).join(',')}`;
}

export function openMeteoUrl(points: LatLon[]): string {
  const lat = points.map((p) => coord(p.lat)).join(',');
  const lon = points.map((p) => coord(p.lon)).join(',');
  const q = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    minutely_15: 'precipitation',
    hourly: 'precipitation_probability,precipitation',
    models: OPEN_METEO_MODELS.join(','),
    timezone: TZ,
    forecast_days: '2',
    past_days: '0',
  });
  // Keep commas literal for readability/cache stability.
  return `${ENDPOINTS.openMeteo}?${q.toString().replace(/%2C/g, ',')}`;
}

export async function fetchOpenMeteo(points: LatLon[], opts: OpenMeteoOpts = {}): Promise<SourceResult[]> {
  if (points.length === 0) return failedAll(points, 'no points');
  try {
    const r = await fetchViaProxyOrDirect<unknown>(openMeteoProxyUrl(points), openMeteoUrl(points), {
      ttlMs: TTL_MS,
      persist: true,
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.retries !== undefined ? { retries: opts.retries } : {}),
      ...(opts.bypassCache ? { bypassCache: true } : {}),
    });
    return parseOpenMeteo(r.data, points, r);
  } catch (e) {
    return failedAll(points, errReason(e));
  }
}
