// PURE timing + stretch building. All wall-clock maths is MYT (UTC+8) via epoch ms and UTC getters.
import { DISTRICTS, MYT_OFFSET_MS, PUTRAJAYA_BBOX, type District, type Waypoint } from '../config';
import { haversineM, pointAtMeasure, slicePolyline } from './geo';
import type { Eta, LatLon, RouteData, Stretch } from './types';

const MIN = 60_000;
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function mytParts(ms: number): { y: number; mo: number; d: number; hh: number; mm: number } {
  const d = new Date(ms + MYT_OFFSET_MS);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}

/** 'YYYY-MM-DDTHH:MM' of the slot start containing ms (MYT). */
export function mytSlotKey(ms: number, stepMin: 15 | 60): string {
  const stepMs = stepMin * MIN;
  const floored = Math.floor((ms + MYT_OFFSET_MS) / stepMs) * stepMs - MYT_OFFSET_MS;
  const p = mytParts(floored);
  return `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}`;
}

/** Interpret 'YYYY-MM-DDTHH:MM' as MYT wall time → epoch ms. */
export function parseMytLocal(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`bad MYT local time: ${s}`);
  const [y, mo, d, hh, mm] = m.slice(1).map(Number) as [number, number, number, number, number];
  return Date.UTC(y, mo - 1, d, hh, mm) - MYT_OFFSET_MS;
}

/** Epoch ms of MYT wall time 'HH:MM' on refMs's MYT calendar day. */
export function mytDateAt(hhmm: string, refMs: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`bad HH:MM: ${hhmm}`);
  const p = mytParts(refMs);
  return Date.UTC(p.y, p.mo - 1, p.d, Number(m[1]), Number(m[2])) - MYT_OFFSET_MS;
}

export function formatHHMM(ms: number): string {
  const p = mytParts(ms);
  return `${pad(p.hh)}:${pad(p.mm)}`;
}

export function formatRange(a: number, b: number): string {
  return `${formatHHMM(a)}–${formatHHMM(b)}`;
}

export function roundToStep(ms: number, stepMin: number): number {
  const s = stepMin * MIN;
  return Math.round(ms / s) * s;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function nearestWaypoint(p: LatLon, waypoints: Waypoint[]): { wp: Waypoint; d: number } | null {
  let best: { wp: Waypoint; d: number } | null = null;
  for (const wp of waypoints) {
    const d = haversineM(p, wp);
    if (!best || d < best.d) best = { wp, d };
  }
  return best;
}

export function districtFor(p: LatLon, waypoints: Waypoint[] = []): District {
  const near = nearestWaypoint(
    p,
    waypoints.filter((w) => w.district),
  );
  if (near && near.d <= 4000 && near.wp.district) return near.wp.district;
  const b = PUTRAJAYA_BBOX;
  if (p.lat >= b.minLat && p.lat <= b.maxLat && p.lon >= b.minLon && p.lon <= b.maxLon) return 'Putrajaya';
  let best = DISTRICTS[0]!;
  let bestD = Infinity;
  for (const d of DISTRICTS) {
    const dist = haversineM(p, d);
    if (dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  return best.name;
}

export function buildStretches(route: RouteData, waypoints: Waypoint[], tripMin: number, n?: number): Stretch[] {
  const count = n ?? clamp(Math.round(tripMin / 5), 6, 24);
  const total = route.totalDurS;
  const out: Stretch[] = [];
  for (let i = 0; i < count; i++) {
    const startFrac = i / count;
    const endFrac = (i + 1) / count;
    const midFrac = (startFrac + endFrac) / 2;
    const mp = pointAtMeasure(route.coords, route.cumDurS, midFrac * total);
    const mid: LatLon = { lat: mp.c[1], lon: mp.c[0] };
    const near = nearestWaypoint(mid, waypoints);
    let place: string;
    // The user's own pin names are the vocabulary of the answer ("near MEX – Putrajaya"); OSRM road names
    // only for stretches far (>12 km) from every pin.
    if (near && near.d <= 12000) place = near.wp.name;
    else {
      const road = route.roadNames[mp.seg];
      if (road) place = road;
      else place = near ? near.wp.name : 'the route';
    }
    out.push({
      index: i,
      startFrac,
      endFrac,
      startOffsetMin: startFrac * tripMin,
      endOffsetMin: endFrac * tripMin,
      midOffsetMin: midFrac * tripMin,
      mid,
      coords: slicePolyline(route.coords, route.cumDurS, startFrac * total, endFrac * total),
      place,
      district: districtFor(mid, waypoints),
    });
  }
  return out;
}

export function etaFor(stretch: Stretch, departMs: number): Eta {
  return {
    startMs: departMs + stretch.startOffsetMin * MIN,
    endMs: departMs + stretch.endOffsetMin * MIN,
    midMs: departMs + stretch.midOffsetMin * MIN,
  };
}

export function stretchPoints(stretches: Stretch[]): LatLon[] {
  return stretches.map((s) => s.mid);
}
