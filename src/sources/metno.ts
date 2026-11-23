// MET Norway locationforecast: one request per unique 0.05° cell, via PHP proxy (sets the identifying UA) or direct.
import { ENDPOINTS } from '../config';
import { snap } from '../core/geo';
import type { LatLon, PointSeries, SourceHealth, SourceResult } from '../core/types';
import { cachedReason, errReason, fetchViaProxyOrDirect } from './http';

const LABEL = 'MET Norway';
const RESOLUTION = 'hourly, mm/h';
const FALLBACK_TTL_MS = 30 * 60 * 1000;

export interface MetNoOpts {
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  bypassCache?: boolean;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parse a locationforecast response into a series (hours with next_1_hours only). */
export function parseMetNo(json: unknown): PointSeries | null {
  if (!isRec(json) || !isRec(json.properties) || !Array.isArray(json.properties.timeseries)) return null;
  const times: number[] = [];
  const mmh: (number | null)[] = [];
  for (const e of json.properties.timeseries as unknown[]) {
    if (!isRec(e) || typeof e.time !== 'string') continue;
    const t = Date.parse(e.time);
    if (!Number.isFinite(t)) continue;
    const data = e.data;
    const n1 = isRec(data) && isRec(data.next_1_hours) && isRec(data.next_1_hours.details) ? data.next_1_hours.details.precipitation_amount : undefined;
    if (typeof n1 !== 'number' || !Number.isFinite(n1)) continue; // 6h-only entries beyond the hourly range are skipped
    times.push(t);
    mmh.push(n1);
  }
  return times.length > 0 ? { times, stepMin: 60, mmh } : null;
}

const cellKey = (lat: number, lon: number) => `${lat.toFixed(2)},${lon.toFixed(2)}`;

export async function fetchMetNo(points: LatLon[], opts: MetNoOpts = {}): Promise<SourceResult> {
  const fail = (reason: string): SourceResult => ({
    id: 'metno',
    label: LABEL,
    resolution: RESOLUTION,
    health: { id: 'metno', label: LABEL, state: 'failed', reason, fetchedAt: null },
    series: points.map(() => null),
  });
  if (points.length === 0) return fail('no points');

  const cells = points.map((p) => ({ lat: snap(p.lat), lon: snap(p.lon) }));
  const unique = new Map<string, { lat: number; lon: number }>();
  for (const c of cells) unique.set(cellKey(c.lat, c.lon), c);

  const byCell = new Map<string, PointSeries | null>();
  let anyStale = false;
  let anyDirect = false;
  let anyProxy = false;
  let oldest = Infinity;
  let lastReason = 'no data in response';
  let okCells = 0;

  const queue = [...unique.entries()];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const [key, c] = item;
      const qs = `lat=${c.lat.toFixed(2)}&lon=${c.lon.toFixed(2)}`;
      try {
        const r = await fetchViaProxyOrDirect<unknown>(`${ENDPOINTS.proxy.metno}?${qs}`, `${ENDPOINTS.metno}?${qs}`, {
          ttlMs: FALLBACK_TTL_MS,
          honourExpires: true,
          persist: true,
          ...(opts.signal ? { signal: opts.signal } : {}),
          ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
          ...(opts.retries !== undefined ? { retries: opts.retries } : {}),
      ...(opts.bypassCache ? { bypassCache: true } : {}),
        });
        const s = parseMetNo(r.data);
        byCell.set(key, s);
        if (s) {
          okCells++;
          oldest = Math.min(oldest, r.fetchedAt);
          if (r.stale) anyStale = true;
          if (r.via === 'direct') anyDirect = true;
          if (r.via === 'proxy') anyProxy = true;
        }
      } catch (e) {
        byCell.set(key, null);
        lastReason = errReason(e);
      }
    }
  };
  await Promise.all([worker(), worker()]);

  const series = cells.map((c) => byCell.get(cellKey(c.lat, c.lon)) ?? null);
  if (okCells === 0) return fail(lastReason);

  let state: SourceHealth['state'] = 'ok';
  let reason = '';
  let via: SourceHealth['via'] = anyProxy && !anyDirect ? 'proxy' : 'direct';
  if (anyStale) {
    state = 'degraded';
    reason = cachedReason(oldest);
    via = 'cache';
  } else if (anyDirect) {
    state = 'degraded';
    reason = 'direct (no proxy, no User-Agent)';
  } else if (okCells < unique.size) {
    state = 'degraded';
    reason = `${unique.size - okCells} of ${unique.size} cells missing`;
  }
  return { id: 'metno', label: LABEL, resolution: RESOLUTION, health: { id: 'metno', label: LABEL, state, reason, fetchedAt: oldest, via }, series };
}
