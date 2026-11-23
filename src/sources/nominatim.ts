// Nominatim place search via the server proxy (24 h cache, site-wide 1 req/s); direct only when the proxy is
// unreachable. Client-side throttle (>= 1100 ms between calls), q >= 3 chars. Debounce lives in the UI.
import { ENDPOINTS } from '../config';
import { fetchViaProxyOrDirect } from './http';

export interface Place {
  name: string;
  lat: number;
  lon: number;
  label: string;
}

const MIN_GAP_MS = 1100;
let chain: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

/** Test hook. */
export function resetNominatimThrottle(): void {
  chain = Promise.resolve();
  lastCallAt = 0;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parsePlaces(json: unknown): Place[] {
  if (!Array.isArray(json)) return [];
  const out: Place[] = [];
  for (const r of json) {
    if (!isRec(r)) continue;
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const label = typeof r.display_name === 'string' ? r.display_name : '';
    const name = (typeof r.name === 'string' && r.name) || label.split(',')[0]?.trim() || '';
    if (!name) continue;
    out.push({ name, lat, lon, label });
  }
  return out;
}

export async function searchPlaces(q: string, opts: { signal?: AbortSignal } = {}): Promise<Place[]> {
  const query = q.trim();
  if (query.length < 3) return [];
  const params = new URLSearchParams({
    q: query,
    countrycodes: 'my',
    format: 'jsonv2',
    limit: '5',
    'accept-language': 'en',
  });
  const url = `${ENDPOINTS.nominatim}?${params.toString()}`;
  const proxyUrl = `${ENDPOINTS.proxy.search}?q=${encodeURIComponent(query)}`;
  const run = async (): Promise<Place[]> => {
    if (opts.signal?.aborted) return [];
    const wait = lastCallAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
    if (opts.signal?.aborted) return [];
    lastCallAt = Date.now();
    try {
      const r = await fetchViaProxyOrDirect<unknown>(proxyUrl, url, { ttlMs: 60 * 60 * 1000, retries: 0, ...(opts.signal ? { signal: opts.signal } : {}) });
      return parsePlaces(r.data);
    } catch {
      return [];
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}
