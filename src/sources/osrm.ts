// OSRM demo router → RouteData (cumulative time per vertex from step durations). Cached 7 days.
import { ENDPOINTS, type Waypoint } from '../config';
import { bearingDeg, haversineM } from '../core/geo';
import type { LonLat, RouteData, SourceHealth } from '../core/types';
import { cachedReason, errReason, fetchViaProxyOrDirect, type FetchTune } from './http';

const TTL_MS = 7 * 24 * 3600 * 1000;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseOsrm(json: unknown): RouteData | null {
  if (!isRec(json) || json.code !== 'Ok' || !Array.isArray(json.routes)) return null;
  const route = json.routes[0];
  if (!isRec(route) || !Array.isArray(route.legs) || !isNum(route.duration) || !isNum(route.distance)) return null;
  const totalDur: number = route.duration;
  const totalDist: number = route.distance;

  const coords: LonLat[] = [];
  const cumDurS: number[] = [];
  const roadNames: string[] = [];
  const legs: RouteData['legs'] = [];
  let t = 0;

  for (const leg of route.legs) {
    if (!isRec(leg) || !Array.isArray(leg.steps)) return null;
    const names = new Set<string>();
    for (const step of leg.steps) {
      if (!isRec(step) || !isRec(step.geometry) || !Array.isArray(step.geometry.coordinates)) return null;
      const dur = isNum(step.duration) ? step.duration : 0;
      const name = typeof step.name === 'string' ? step.name : '';
      if (name) names.add(name);
      const raw = step.geometry.coordinates as unknown[];
      if (!raw.every((c) => Array.isArray(c) && isNum(c[0]) && isNum(c[1]))) return null;
      const line = raw as LonLat[];
      if (line.length === 0) continue;
      if (coords.length === 0) {
        coords.push(line[0]!);
        cumDurS.push(0);
        roadNames.push(name);
      }
      // The step's first vertex is the previous step's last (joint): drop it, keep the rest.
      const tail: LonLat[] = [];
      for (const c of line.slice(1)) {
        const last = tail[tail.length - 1] ?? coords[coords.length - 1]!;
        if (c[0] !== last[0] || c[1] !== last[1]) tail.push(c);
      }
      if (tail.length === 0) {
        // zero-length step (e.g. "arrive"): keep its time on the last vertex
        t += dur;
        cumDurS[cumDurS.length - 1] = t;
        continue;
      }
      const chain: LonLat[] = [coords[coords.length - 1]!, ...tail];
      roadNames[roadNames.length - 1] = name; // the segment starting at the joint belongs to this step
      const segD: number[] = [];
      let tot = 0;
      for (let i = 1; i < chain.length; i++) {
        const d = haversineM({ lat: chain[i - 1]![1], lon: chain[i - 1]![0] }, { lat: chain[i]![1], lon: chain[i]![0] });
        segD.push(d);
        tot += d;
      }
      for (let i = 0; i < tail.length; i++) {
        t += dur * (tot > 0 ? segD[i]! / tot : 1 / tail.length);
        coords.push(tail[i]!);
        cumDurS.push(t);
        roadNames.push(name);
      }
    }
    legs.push({
      durationS: isNum(leg.duration) ? leg.duration : 0,
      distanceM: isNum(leg.distance) ? leg.distance : 0,
      summary: typeof leg.summary === 'string' && leg.summary ? leg.summary : [...names].slice(0, 3).join(', '),
    });
  }
  if (coords.length < 2) return null;
  // Scale so the last vertex equals the route's duration exactly (step sums can drift slightly).
  const last = cumDurS[cumDurS.length - 1]!;
  const k = last > 0 ? totalDur / last : 1;
  const scaled = cumDurS.map((v, i) => (i === cumDurS.length - 1 ? totalDur : v * k));
  return { coords, cumDurS: scaled, roadNames, totalDurS: totalDur, distanceM: totalDist, legs };
}

export function bearingsParam(wps: Waypoint[]): string {
  return wps
    .map((w, i) => {
      if (!w.highway) return '';
      const a = wps[i - 1] ?? w;
      const b = wps[i + 1] ?? w;
      if (a === b) return '';
      return `${Math.round(bearingDeg(a, b)) % 360},90`;
    })
    .join(';');
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export async function fetchRoute(waypoints: Waypoint[], tune: FetchTune = {}): Promise<{ route: RouteData | null; health: SourceHealth }> {
  const base = { id: 'route' as const, label: 'OSRM route' };
  if (waypoints.length < 2) return { route: null, health: { ...base, state: 'failed', reason: 'need at least 2 waypoints', fetchedAt: null } };
  const wp = waypoints.map((w) => `${w.lon},${w.lat}`).join(';');
  const bearings = bearingsParam(waypoints);
  const hasBearings = bearings.replace(/;/g, '') !== '';
  const direct = `${ENDPOINTS.osrm}${wp}?overview=false&steps=true&geometries=geojson&continue_straight=true${hasBearings ? `&bearings=${bearings}` : ''}`;
  const proxy = `${ENDPOINTS.proxy.route}?wp=${encodeURIComponent(wp)}${hasBearings ? `&b=${encodeURIComponent(bearings)}` : ''}`;
  try {
    const r = await fetchViaProxyOrDirect<unknown>(proxy, direct, { ttlMs: TTL_MS, persist: true, cacheKey: `osrm:${hash(direct)}`, ...tune });
    const route = parseOsrm(r.data);
    if (!route) return { route: null, health: { ...base, state: 'failed', reason: 'no route in response', fetchedAt: null } };
    const via = r.stale ? 'cache' : r.via === 'proxy' ? 'proxy' : 'direct';
    return {
      route,
      health: {
        ...base,
        state: r.stale ? 'degraded' : 'ok',
        reason: r.stale ? cachedReason(r.fetchedAt) : '',
        fetchedAt: r.fetchedAt,
        via,
      },
    };
  } catch (e) {
    return { route: null, health: { ...base, state: 'failed', reason: errReason(e), fetchedAt: null } };
  }
}
