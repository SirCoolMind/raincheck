// Saved trips and the three tabs (Morning / Evening / Custom). Pure: no DOM, no storage.
// A trip is an ordered list of stops in travel order. Each tab points at a trip:
//   Morning → its trip as-is.
//   Evening → its own trip, or (mirror) the Morning trip reversed — the classic way home.
//   Custom  → any saved trip, or (follow) the Morning trip; `reverse` flips it.
import { DEFAULT_PRESETS, DEFAULT_TRIP_MIN, type PresetId, type Waypoint } from '../config';

export const TRIPS_VERSION = 2;
export const MAX_TRIPS = 20;
export const MAX_STOPS = 12;
export const MIN_TRIP_MIN = 20;
export const MAX_TRIP_MIN = 180;
const MAX_NAME = 80;

export interface Trip {
  id: string;
  name: string;
  /** Travel order: first = start, last = destination. */
  stops: Waypoint[];
  /** Planned drive length in minutes; null = auto (route driving time + traffic allowance). */
  tripMin: number | null;
}

export interface TripsState {
  version: typeof TRIPS_VERSION;
  trips: Trip[];
  morning: { tripId: string | null; time: string };
  evening: { tripId: string | null; time: string; mirror: boolean };
  /** follow = drive the Morning trip; otherwise tripId (null = empty, set up a new one). */
  custom: { tripId: string | null; reverse: boolean; follow: boolean };
}

export interface Resolved {
  /** The saved trip behind this tab (null = the tab has nothing set up yet). */
  trip: Trip | null;
  /** Stops in the order you drive them for this tab. */
  stops: Waypoint[];
  /** True when this tab drives `trip.stops` backwards (Evening mirror, Custom reverse). */
  reversed: boolean;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function newId(prefix = 't'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Valid pins only (finite, on Earth, named); null if fewer than 2 survive or there are too many. */
export function sanitizeStops(v: unknown): Waypoint[] | null {
  if (!Array.isArray(v) || v.length < 2 || v.length > MAX_STOPS) return null;
  const out: Waypoint[] = [];
  for (const p of v) {
    if (!isRec(p) || typeof p.id !== 'string' || typeof p.name !== 'string') return null;
    const lat = Number(p.lat);
    const lon = Number(p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const w: Waypoint = { id: p.id.slice(0, 40), name: p.name.slice(0, MAX_NAME), lat, lon };
    if (p.highway === true) w.highway = true;
    if (typeof p.district === 'string') w.district = p.district as Waypoint['district'];
    out.push(w);
  }
  return out;
}

/** Auto length: OSRM free-flow time × 1.25 for traffic, to 5 min, within the allowed range. */
export function autoTripMin(routeDurS: number): number {
  const m = Math.round(((routeDurS / 60) * 1.25) / 5) * 5;
  return Math.min(MAX_TRIP_MIN, Math.max(MIN_TRIP_MIN, Number.isFinite(m) ? m : DEFAULT_TRIP_MIN));
}

const tripMinOrAuto = (v: unknown): number | null => (v === null || v === undefined ? null : clampTripMin(v));
const clampTripMin = (v: unknown): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= MIN_TRIP_MIN && n <= MAX_TRIP_MIN ? n : DEFAULT_TRIP_MIN;
};
const timeOr = (v: unknown, fallback: string): string => (typeof v === 'string' && HHMM.test(v) ? v : fallback);

export function tripName(stops: Waypoint[]): string {
  const a = stops[0]?.name.replace(/ \(moved\)$/, '') ?? '';
  const b = stops[stops.length - 1]?.name.replace(/ \(moved\)$/, '') ?? '';
  return `${a} → ${b}`.slice(0, MAX_NAME);
}

export function makeTrip(stops: Waypoint[], name?: string, tripMin: number | null = null): Trip {
  return { id: newId(), name: (name?.trim() || tripName(stops)).slice(0, MAX_NAME), stops: stops.map((w) => ({ ...w })), tripMin: tripMinOrAuto(tripMin) };
}

/** The starting state for a new visitor: no trips yet, Evening set to mirror Morning once it exists. */
export function emptyTrips(): TripsState {
  return {
    version: TRIPS_VERSION,
    trips: [],
    morning: { tripId: null, time: DEFAULT_PRESETS.morning.time },
    evening: { tripId: null, time: DEFAULT_PRESETS.evening.time, mirror: true },
    custom: { tripId: null, reverse: false, follow: true },
  };
}

/**
 * v1 kept one waypoint list (home → office), two preset times and one trip length. Only a saved
 * route becomes a trip; with no route, the times still carry over onto empty tabs.
 */
export function migrateV1(v1: { waypoints?: unknown; presets?: unknown; tripMin?: unknown }): TripsState {
  const base = emptyTrips();
  const p = isRec(v1.presets) ? v1.presets : {};
  const mTime = isRec(p.morning) ? timeOr(p.morning.time, base.morning.time) : base.morning.time;
  const eTime = isRec(p.evening) ? timeOr(p.evening.time, base.evening.time) : base.evening.time;
  const out: TripsState = { ...base, morning: { ...base.morning, time: mTime }, evening: { ...base.evening, time: eTime } };
  const stops = sanitizeStops(v1.waypoints);
  if (!stops) return out;
  const trip = makeTrip(stops, undefined, v1.tripMin === undefined ? DEFAULT_TRIP_MIN : clampTripMin(v1.tripMin)); // v1 always planned with a fixed length
  return { ...out, trips: [trip], morning: { ...out.morning, tripId: trip.id } };
}

/** Accept a stored v2 object, repairing what it can; null if it is not usable at all. */
export function sanitizeTrips(v: unknown): TripsState | null {
  if (!isRec(v) || v.version !== TRIPS_VERSION || !Array.isArray(v.trips)) return null;
  const trips: Trip[] = [];
  const seen = new Set<string>();
  for (const t of v.trips.slice(0, MAX_TRIPS)) {
    if (!isRec(t) || typeof t.id !== 'string' || seen.has(t.id)) continue;
    const stops = sanitizeStops(t.stops);
    if (!stops) continue;
    seen.add(t.id);
    trips.push({ id: t.id, name: typeof t.name === 'string' && t.name.trim() ? t.name.slice(0, MAX_NAME) : tripName(stops), stops, tripMin: tripMinOrAuto(t.tripMin) });
  }
  const ref = (id: unknown) => (typeof id === 'string' && seen.has(id) ? id : null);
  const d = emptyTrips();
  const m = isRec(v.morning) ? v.morning : {};
  const e = isRec(v.evening) ? v.evening : {};
  const c = isRec(v.custom) ? v.custom : {};
  return {
    version: TRIPS_VERSION,
    trips,
    morning: { tripId: ref(m.tripId), time: timeOr(m.time, d.morning.time) },
    evening: { tripId: ref(e.tripId), time: timeOr(e.time, d.evening.time), mirror: e.mirror !== false },
    custom: { tripId: ref(c.tripId), reverse: c.reverse === true, follow: customFollow(c.tripId, c.follow, ref(c.tripId)) },
  };
}

// Missing flag (older v2) or a reference to a trip that is gone → follow Morning; else as stored.
function customFollow(rawId: unknown, follow: unknown, id: string | null): boolean {
  if (typeof rawId === 'string' && !id) return true;
  return follow === undefined ? !id : follow === true;
}

/** Load order: v2 if valid, else migrate whatever v1 keys exist (or defaults). */
export function loadTrips(stored: unknown, v1: { waypoints?: unknown; presets?: unknown; tripMin?: unknown }): TripsState {
  return sanitizeTrips(stored) ?? migrateV1(v1);
}

export const tripById = (s: TripsState, id: string | null): Trip | null => (id ? (s.trips.find((t) => t.id === id) ?? null) : null);

/** Which trip a tab drives, and in what order. */
export function resolveSlot(s: TripsState, preset: PresetId): Resolved {
  const morning = tripById(s, s.morning.tripId);
  const pick = (trip: Trip | null, reversed: boolean): Resolved => ({
    trip,
    reversed: !!trip && reversed,
    stops: trip ? (reversed ? [...trip.stops].reverse() : trip.stops) : [],
  });
  if (preset === 'morning') return pick(morning, false);
  if (preset === 'evening') {
    return s.evening.mirror ? pick(morning, true) : pick(tripById(s, s.evening.tripId), false);
  }
  return pick(s.custom.follow ? morning : tripById(s, s.custom.tripId), s.custom.reverse);
}

function replaceTrip(s: TripsState, trip: Trip): TripsState {
  return { ...s, trips: s.trips.map((t) => (t.id === trip.id ? trip : t)) };
}

/**
 * Edit the stops of the trip behind a tab. `edit` works in this tab's travel order;
 * the result is stored back in the trip's own order. No-op if the tab has no trip or the edit is invalid.
 */
export function editSlotStops(s: TripsState, preset: PresetId, edit: (travel: Waypoint[]) => Waypoint[]): TripsState {
  const r = resolveSlot(s, preset);
  if (!r.trip) return s;
  const next = sanitizeStops(edit([...r.stops]));
  if (!next) return s;
  return replaceTrip(s, { ...r.trip, stops: r.reversed ? next.reverse() : next });
}

/** Set the active trip's length; null switches it back to auto. */
export function setSlotTripMin(s: TripsState, preset: PresetId, min: number | null): TripsState {
  const r = resolveSlot(s, preset);
  if (!r.trip) return s;
  if (min === null) return r.trip.tripMin === null ? s : replaceTrip(s, { ...r.trip, tripMin: null });
  if (!Number.isFinite(min) || min < MIN_TRIP_MIN || min > MAX_TRIP_MIN) return s;
  return replaceTrip(s, { ...r.trip, tripMin: Math.round(min) });
}

export function setSlotTime(s: TripsState, preset: 'morning' | 'evening', hhmm: string): TripsState {
  if (!HHMM.test(hhmm)) return s;
  return preset === 'morning' ? { ...s, morning: { ...s.morning, time: hhmm } } : { ...s, evening: { ...s.evening, time: hhmm } };
}

export function setCustomReverse(s: TripsState, reverse: boolean): TripsState {
  return { ...s, custom: { ...s.custom, reverse } };
}

/** Put a trip on a tab; null empties the tab (Evening stops mirroring, Custom stops following Morning). */
export function assignSlot(s: TripsState, preset: PresetId, tripId: string | null): TripsState {
  const id = tripId && tripById(s, tripId) ? tripId : null;
  if (preset === 'morning') return { ...s, morning: { ...s.morning, tripId: id } };
  if (preset === 'evening') return { ...s, evening: { ...s.evening, tripId: id, mirror: false } };
  return { ...s, custom: { ...s.custom, tripId: id, follow: false } };
}

/** Custom drives the Morning trip again. */
export function setCustomFollow(s: TripsState): TripsState {
  return { ...s, custom: { ...s.custom, tripId: null, follow: true } };
}

export function setEveningMirror(s: TripsState, mirror: boolean): TripsState {
  return { ...s, evening: { ...s.evening, mirror } };
}

/** Save stops as a new library trip. Returns the same state if the library is full or stops invalid. */
export function addTrip(s: TripsState, stops: Waypoint[], name?: string, tripMin: number | null = null): { state: TripsState; trip: Trip | null } {
  const clean = sanitizeStops(stops);
  if (!clean || s.trips.length >= MAX_TRIPS) return { state: s, trip: null };
  const trip = makeTrip(clean, name, tripMin);
  return { state: { ...s, trips: [...s.trips, trip] }, trip };
}

export function renameTrip(s: TripsState, id: string, name: string): TripsState {
  const t = tripById(s, id);
  const n = name.trim().slice(0, MAX_NAME);
  return t && n ? replaceTrip(s, { ...t, name: n }) : s;
}

/** Remove a trip; any tab pointing at it is cleared (Evening falls back to mirroring Morning). */
export function deleteTrip(s: TripsState, id: string): TripsState {
  if (!tripById(s, id)) return s;
  return {
    ...s,
    trips: s.trips.filter((t) => t.id !== id),
    morning: s.morning.tripId === id ? { ...s.morning, tripId: null } : s.morning,
    evening: s.evening.tripId === id ? { ...s.evening, tripId: null, mirror: true } : s.evening,
    custom: s.custom.tripId === id ? { ...s.custom, tripId: null, follow: true } : s.custom,
  };
}

/** What to call the active tab's trip: a mirrored auto-name follows the driving order. */
export function displayName(r: Resolved): string {
  if (!r.trip) return '';
  if (!r.reversed) return r.trip.name;
  return r.trip.name === tripName(r.trip.stops) ? tripName(r.stops) : `${r.trip.name} (return)`;
}

// ───── share links / export ─────
// A share link carries one trip in the URL hash (#t=…), so it never reaches the server or its logs.
type Packed = { n: string; m: number | null; s: [string, number, number, 1?][] };

const b64url = (str: string) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (str: string) => {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export function encodeTrip(t: Pick<Trip, 'name' | 'stops' | 'tripMin'>): string {
  const packed: Packed = {
    n: t.name,
    m: t.tripMin,
    s: t.stops.map((w) => (w.highway ? [w.name, w.lat, w.lon, 1] : [w.name, w.lat, w.lon])),
  };
  return b64url(JSON.stringify(packed));
}

/** Parse a share payload; null for anything malformed. The result has fresh stop ids. */
export function decodeTrip(code: string): Pick<Trip, 'name' | 'stops' | 'tripMin'> | null {
  if (!code || code.length > 6000 || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
  try {
    const p = JSON.parse(unb64url(code)) as unknown;
    if (!isRec(p) || !Array.isArray(p.s)) return null;
    const stops = sanitizeStops(
      p.s.map((x, i) => (Array.isArray(x) ? { id: `s${i}`, name: String(x[0] ?? ''), lat: x[1], lon: x[2], ...(x[3] === 1 ? { highway: true } : {}) } : null)),
    );
    if (!stops || stops.some((w) => !w.name.trim())) return null;
    const name = typeof p.n === 'string' && p.n.trim() ? p.n.slice(0, MAX_NAME) : tripName(stops);
    return { name, stops, tripMin: tripMinOrAuto(p.m) };
  } catch {
    return null;
  }
}

const stopsSig = (stops: Waypoint[]) => stops.map((w) => `${w.lat.toFixed(4)},${w.lon.toFixed(4)}`).join(';');

/** Is a trip with the same stops already saved? Returns it. */
export function findSameTrip(s: TripsState, stops: Waypoint[]): Trip | null {
  const sig = stopsSig(stops);
  return s.trips.find((t) => stopsSig(t.stops) === sig) ?? null;
}

/**
 * Import a backup: add its trips that are not already saved (same stops), up to the cap, and fill
 * tabs that are still empty. Returns how many were added.
 */
export function mergeTrips(s: TripsState, incoming: unknown): { state: TripsState; added: number } | null {
  const inc = sanitizeTrips(incoming);
  if (!inc) return null;
  let out = s;
  let added = 0;
  const idMap = new Map<string, string>();
  for (const t of inc.trips) {
    const same = findSameTrip(out, t.stops);
    if (same) {
      idMap.set(t.id, same.id);
      continue;
    }
    const r = addTrip(out, t.stops, t.name, t.tripMin);
    if (!r.trip) break;
    out = r.state;
    idMap.set(t.id, r.trip.id);
    added++;
  }
  const map = (id: string | null) => (id ? (idMap.get(id) ?? null) : null);
  if (!out.morning.tripId && map(inc.morning.tripId)) out = { ...out, morning: { tripId: map(inc.morning.tripId), time: inc.morning.time } };
  if (!out.evening.tripId && out.evening.mirror && !inc.evening.mirror && map(inc.evening.tripId)) {
    out = { ...out, evening: { tripId: map(inc.evening.tripId), time: inc.evening.time, mirror: false } };
  }
  return { state: out, added };
}
