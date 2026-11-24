// Controller. Data flow: controls → state → timing → sources (parallel, each may fail) → verdict →
// summary / bestTime → UI modules subscribe and render.
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import './styles/tokens.css';
import './styles/components.css';

import {
  AUTO_REFRESH_MIN,
  BEST_RANGE_MIN,
  BEST_STEP_MIN,
  SCRUB_RANGE_MIN,
  type PresetId,
  type Waypoint,
} from './config';
import { EXAMPLE_TRIP } from './config';
import {
  addTrip,
  autoTripMin,
  assignSlot,
  decodeTrip,
  deleteTrip,
  displayName,
  editSlotStops,
  encodeTrip,
  findSameTrip,
  loadTrips,
  mergeTrips,
  renameTrip,
  resolveSlot,
  setCustomFollow,
  setEveningMirror,
  setCustomReverse,
  setSlotTime,
  setSlotTripMin,
  type TripsState,
} from './core/trips';
import { Store, on, loadLocal, saveLocal, type Actions, type AppState, type ThemePref } from './state';
import { buildStretches, mytDateAt, roundToStep, stretchPoints } from './core/timing';
import { evaluateTrip } from './core/evaluate';
import { summarize } from './core/summary';
import { pickBest, scanDepartures } from './core/bestTime';
import { nearestVertex } from './core/geo';
import type { MetMyForecast, MetMyWarning, RadarDetail, RadarIndex, RadarSample, RouteData, SourceHealth, SourceResult } from './core/types';
import { fetchRoute } from './sources/osrm';
import { fetchOpenMeteo } from './sources/openmeteo';
import { fetchMetNo } from './sources/metno';
import { APP_VERSION, versionLabel } from './version';
import { fetchRadarIndex, sampleRadar, sampleRadarDetail, browserImageLoader } from './sources/rainviewer';
import { fetchMetMy } from './sources/metmy';
import { idbGet, idbSet } from './sources/http';
import { el } from './ui/dom';
import { mountAnswer } from './ui/answerCard';
import { mountTimeline } from './ui/timeline';
import { mountDetail, mountSheet } from './ui/stretchSheet';
import { mountAgreement } from './ui/agreement';
import { mountSettings } from './ui/settings';
import { mapMenu, type MenuItem } from './ui/mapMenu';
import { inMalaysia } from './ui/tripForm';
import { mountBand } from './ui/controls';
import { mountEditor } from './ui/waypointEditor';
import { mountBestTime } from './ui/bestTime';
import { mountRadar } from './ui/radar';
import { mountFeedback } from './ui/feedback';
import { mountSetup } from './ui/tripSetup';
import { applyTheme, effectiveTheme, onSystemThemeChange } from './ui/theme';
import { RouteMap } from './ui/map';
import { mountSideResize, sideWidth } from './ui/sideResize';
import { formatHHMM } from './core/timing';

const MIN = 60_000;

// ───────────── initial state ─────────────
/** Last auto length per driving order, declared before the store (derive() reads it), so switching tabs shows it straight away. */
const autoMinFor = new Map<string, number>();
function stopsKey(stops: Waypoint[]): string {
  return stops.map((w) => `${w.lat.toFixed(5)},${w.lon.toFixed(5)}`).join(';');
}
const now = Date.now();
// Trips v2; on first run after the upgrade, the v1 keys (one home→office route, two preset times,
// one trip length) become the Morning trip with Evening mirroring it. v1 keys are left in place.
const trips0 = loadTrips(loadLocal<unknown>('trips.v2', null), {
  waypoints: loadLocal<unknown>('waypoints', undefined),
  presets: loadLocal<unknown>('presets', undefined),
  tripMin: loadLocal<unknown>('tripMin', undefined),
});
saveLocal('trips.v2', trips0);
const theme = loadLocal<ThemePref>('theme', 'auto');
const autoRefresh = loadLocal<boolean>('autoRefresh', false);
// Before 13:00 → this morning; 13:00–20:00 → this evening; after 20:00 → tomorrow morning.
const initialPreset: PresetId = mytHour(now) < 13 || mytHour(now) >= 20 ? 'morning' : 'evening';
const base0 = baseFor(initialPreset, trips0, '', now);

const store = new Store({
  presetId: initialPreset,
  trips: trips0,
  customTime: formatHHMM(roundToStep(now, 5)),
  ...derive(trips0, initialPreset),
  canUndo: false,
  shared: readShared(),
  baseMs: base0,
  departMs: base0,
  nowMs: now,
  route: null,
  stretches: [],
  sources: [],
  radar: null,
  radarSamples: null,
  radarDetail: null,
  metmy: null,
  health: [],
  evals: [],
  summary: null,
  bestRows: [],
  best: null,
  selected: null,
  hovered: null,
  phase: 'loading',
  error: null,
  fetchedAt: null,
  offline: typeof navigator !== 'undefined' && navigator.onLine === false,
  fromStore: false,
  theme,
  autoRefresh,
  editing: false,
  radarSampleMs: null,
} satisfies AppState);

function mytHour(ms: number): number {
  return new Date(ms + 8 * 3600 * 1000).getUTCHours();
}

function baseFor(id: PresetId, t2: TripsState, customTime: string, nowMs: number): number {
  if (id === 'custom') return mytDateAt(customTime || formatHHMM(roundToStep(nowMs, 5)), nowMs);
  let t = mytDateAt(t2[id].time, nowMs);
  // Preset long past today → tomorrow's (forecast covers 2 days).
  if (t + SCRUB_RANGE_MIN * MIN < nowMs) t += 24 * 60 * MIN;
  return t;
}

/** A trip passed in the URL hash (#t=…); the hash is cleared so a reload does not offer it again. */
function readShared(): AppState['shared'] {
  const m = /^#t=([A-Za-z0-9_-]+)$/.exec(location.hash);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return decodeTrip(m[1]!);
}

/** Fields the UI reads that follow from the trips + the active tab. */
function derive(t: TripsState, preset: PresetId): { stops: Waypoint[]; tripMin: number; tripAuto: boolean } {
  const r = resolveSlot(t, preset);
  const auto = !!r.trip && r.trip.tripMin === null;
  return { stops: r.stops, tripMin: r.trip?.tripMin ?? autoMinFor.get(stopsKey(r.stops)) ?? 60, tripAuto: auto };
}

const routeKey = (s: AppState) => JSON.stringify([s.stops.map((w) => [w.lat.toFixed(5), w.lon.toFixed(5), !!w.highway]), s.tripAuto ? 'auto' : s.tripMin]);

// ───────────── shell ─────────────
const appRoot = document.getElementById('app')!;
const mapEl = el('div', { class: 'map', id: 'map', role: 'region', 'aria-label': 'Route map with forecast colours and radar' });
const radarTag = el('span', { class: 'map-tag', id: 'radar-tag' });
const editBar = el(
  'div',
  { class: 'edit-bar', hidden: true },
  el('p', { text: 'Drag a pin · tap the route to add a stop' }),
  el('button', { type: 'button', class: 'btn primary', onclick: () => actions.setEditing(false) }, 'Done'),
);
const routeTag = el('span', { class: 'map-tag desk-only', text: 'Route coloured by rain when you reach it' });
const mapNote = el('div', { class: 'map-note', 'aria-hidden': 'true' }, radarTag, routeTag);
const handle = el('button', { type: 'button', class: 'handle', 'aria-label': 'Expand panel', 'aria-controls': 'sheet-scroll' });
const band = el('header', { class: 'band' });
const setupSec = el('section', { class: 'setup', id: 'setup', 'aria-labelledby': 'setup-title', hidden: true });
const answer = el('section', { class: 'answer', id: 'answer', tabindex: '-1', 'aria-labelledby': 'answer-sentence' });
const stripSec = el('section', { class: 'strip-wrap', id: 'journey' });
const detailSec = el('section', { class: 'sec', id: 'detail', 'aria-label': 'Stretch detail', hidden: true });
const bestSec = el('section', { class: 'sec', id: 'best' });
const matrixSec = el('section', { class: 'sec', id: 'matrix' });
const radarSec = el('section', { class: 'sec', id: 'radar' });
const editSec = el('section', { class: 'sec', id: 'route' });
const footSec = el('footer', { class: 'sheet-foot', id: 'sheet-foot' });
const scroll = el('div', { class: 'sheet-scroll', id: 'sheet-scroll' }, setupSec, answer, stripSec, detailSec, bestSec, matrixSec, radarSec, editSec, footSec);
const sheet = el('aside', { class: 'sheet', 'aria-label': 'Commute forecast' }, el('div', { class: 'band-wrap' }, band), scroll);
band.prepend(handle);
appRoot.append(el('a', { class: 'skip', href: '#answer', text: 'Skip to the answer' }), el('main', { class: 'app' }, mapEl, mapNote, editBar, sheet));

applyTheme(theme);

// ───────────── actions ─────────────
let loadSeq = 0;
const routeMap = new RouteMap(mapEl, {
  onHover: (i) => actions.hover(i),
  onSelect: (i) => {
    actions.select(i);
    if (i !== null) sheetCtl.snapTo('mid');
  },
  onWaypointDrag: (id, lat, lon) => actions.moveWaypoint(id, lat, lon),
  onInsertVia: (lat, lon) => actions.insertVia(lat, lon),
  onContextMenu: (e) => openMapMenu(e),
  onKeyProblem: (reason) => setHealth({ id: 'map', label: 'Map tiles', state: 'degraded', reason: `map key problem: ${reason}`, fetchedAt: Date.now() }),
  onReady: () => {
    mapReady = true;
    sketch?.remove();
    syncMap(true);
  },
});

const actions: Actions = {
  select: (i) => {
    store.set({ selected: i });
    if (i !== null) {
      requestAnimationFrame(() => detailSec.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }));
    }
  },
  hover: (i) => store.get().hovered !== i && store.set({ hovered: i }),
  setDepart: (ms) => {
    const s = store.get();
    const clamped = Math.max(s.baseMs - SCRUB_RANGE_MIN * MIN, Math.min(s.baseMs + SCRUB_RANGE_MIN * MIN, ms));
    store.set({ departMs: clamped, nowMs: Date.now() });
    evaluate(false); // local re-evaluation only — no refetch
  },
  setPreset: (id) => {
    const s = store.get();
    const b = baseFor(id, s.trips, s.customTime, Date.now());
    const before = routeKey(s);
    store.set({ presetId: id, ...derive(s.trips, id), baseMs: b, departMs: b, selected: null });
    if (routeKey(store.get()) !== before) void load();
    else evaluate(true);
  },
  setPresetTime: (id, hhmm) => {
    if (!/^\d{2}:\d{2}$/.test(hhmm)) return;
    const s = store.get();
    if (id === 'custom') store.set({ customTime: hhmm });
    else setTrips(setSlotTime(s.trips, id, hhmm), false);
    if (store.get().presetId === id) actions.setPreset(id);
  },
  setCustomDirection: (to) => setTrips(setCustomReverse(store.get().trips, !to)),
  leaveNow: () => {
    const t = roundToStep(Date.now(), 5);
    const s = store.get();
    const before = routeKey(s);
    // Custom takes over whatever this tab drives right now (trip + direction).
    const r = resolveSlot(s.trips, s.presetId);
    const follow = !r.trip || r.trip.id === s.trips.morning.tripId;
    const trips = { ...s.trips, custom: { tripId: follow ? null : r.trip!.id, reverse: r.reversed, follow } };
    saveLocal('trips.v2', trips);
    store.set({ presetId: 'custom', trips, ...derive(trips, 'custom'), customTime: formatHHMM(t), baseMs: t, departMs: t, selected: null });
    if (routeKey(store.get()) !== before) void load();
    else evaluate(true);
  },
  refresh: () => void load(true),
  setTheme: (t) => {
    saveLocal('theme', t);
    store.set({ theme: t });
  },
  setAutoRefresh: (v) => {
    saveLocal('autoRefresh', v);
    store.set({ autoRefresh: v });
  },
  setEditing: (v) => {
    store.set({ editing: v });
    // On a phone, drop the sheet so the pins have room to be dragged; refit with the new padding.
    if (!matchMedia('(min-width: 1024px)').matches) {
      sheetCtl.snapTo(v ? 'min' : 'mid');
      setTimeout(() => routeMap.fit(), 250);
    }
  },
  moveWaypoint: (id, lat, lon) => {
    // Keep `highway`: a dragged MEX pin still needs its bearing or the evening route U-turns (GRILL #5).
    editStops((w) => w.map((p) => (p.id === id ? { ...p, lat: round5(lat), lon: round5(lon), name: p.name.replace(/ \(moved\)$/, '') + ' (moved)' } : p)));
  },
  insertVia: (lat, lon) => {
    const s = store.get();
    if (s.stops.length >= 12) {
      setHealth({ id: 'route', label: 'Route', state: 'degraded', reason: 'max 12 pins: remove one first', fetchedAt: Date.now() });
      return;
    }
    const route = s.route;
    const active = s.stops;
    let pos = active.length - 1;
    if (route) {
      const click = nearestVertex(route.coords, { lat, lon });
      const idxs = active.map((w) => nearestVertex(route.coords, w));
      const k = idxs.findIndex((v, i) => i > 0 && v >= click);
      if (k > 0) pos = k;
    }
    const via: Waypoint = { id: `via-${Date.now().toString(36)}`, name: `Via ${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat: round5(lat), lon: round5(lon) };
    editStops((next) => {
      next.splice(pos, 0, via);
      return next;
    });
  },
  addWaypoint: (name, lat, lon) => {
    if (store.get().stops.length >= 12) return;
    editStops((next) => {
      next.splice(next.length - 1, 0, { id: `wp-${Date.now().toString(36)}`, name: name.slice(0, 80), lat: round5(lat), lon: round5(lon) });
      return next;
    });
  },
  removeWaypoint: (id) => {
    editStops((w) => (w.length > 2 ? w.filter((p) => p.id !== id) : w));
  },
  setEndpoint: (which, name, lat, lon) => {
    editStops((w) => {
      const i = which === 'start' ? 0 : w.length - 1;
      const id = `${which}-${Date.now().toString(36)}`;
      w[i] = { id, name: name.slice(0, 80), lat: round5(lat), lon: round5(lon) };
      return w;
    });
  },
  setTripMin: (m) => setTrips(setSlotTripMin(store.get().trips, store.get().presetId, m)),
  undo: () => {
    const prev = undoStack.pop();
    if (prev) setTrips(prev, true, false);
    store.set({ canUndo: undoStack.length > 0 });
  },
  assignTrip: (preset, id) => setTrips(assignSlot(store.get().trips, preset, id)),
  customFollowMorning: () => setTrips(setCustomFollow(store.get().trips)),
  setEveningMirror: (on) => setTrips(setEveningMirror(store.get().trips, on)),
  createTrip: (stops, name, min) => {
    const s = store.get();
    const same = findSameTrip(s.trips, stops);
    if (same && !name?.endsWith('(copy)')) {
      setTrips(assignSlot(s.trips, s.presetId, same.id));
      return true;
    }
    const r = addTrip(s.trips, stops, name, min ?? null);
    if (!r.trip) return false;
    setTrips(assignSlot(r.state, s.presetId, r.trip.id));
    return true;
  },
  renameTrip: (id, name) => setTrips(renameTrip(store.get().trips, id, name)),
  deleteTrip: (id) => setTrips(deleteTrip(store.get().trips, id)),
  useExample: () => {
    actions.createTrip(EXAMPLE_TRIP.stops.map((w) => ({ ...w })), EXAMPLE_TRIP.name);
  },
  shareUrl: () => {
    const s = store.get();
    const r = resolveSlot(s.trips, s.presetId);
    if (!r.trip) return null;
    return `${location.origin}${location.pathname}#t=${encodeTrip({ name: displayName(r), stops: r.stops, tripMin: r.trip.tripMin })}`;
  },
  acceptShared: () => {
    const sh = store.get().shared;
    store.set({ shared: null });
    if (sh && !actions.createTrip(sh.stops, sh.name, sh.tripMin)) {
      setHealth({ id: 'route', label: 'Route', state: 'degraded', reason: 'trip list full (20): delete one to save the shared trip', fetchedAt: Date.now() });
    }
  },
  dismissShared: () => store.set({ shared: null }),
  exportTrips: () => JSON.stringify({ app: 'raincheck', exportedAt: new Date().toISOString(), ...store.get().trips }, null, 1),
  importTrips: (data) => {
    const r = mergeTrips(store.get().trips, data);
    if (!r) return 'That file is not a RainCheck backup.';
    setTrips(r.state);
    return r.added ? `Imported ${r.added} trip${r.added === 1 ? '' : 's'}.` : 'Nothing new: those trips are already saved.';
  },
};

const round5 = (v: number) => Math.round(v * 1e5) / 1e5;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const undoStack: TripsState[] = [];

/** Persist new trips, re-derive the active tab, and re-route only if the drive changed. */
function setTrips(t: TripsState, reload = true, record = true): void {
  const s = store.get();
  if (t === s.trips) return;
  if (record) {
    undoStack.push(s.trips);
    if (undoStack.length > 30) undoStack.shift();
    store.set({ canUndo: true });
  }
  saveLocal('trips.v2', t);
  const before = routeKey(s);
  store.set({ trips: t, ...derive(t, s.presetId) });
  if (reload && routeKey(store.get()) !== before) {
    store.set({ selected: null });
    void load();
  }
}

/** Edit the active tab's stops in travel order (stored back in the trip's own order). */
function editStops(edit: (travel: Waypoint[]) => Waypoint[]): void {
  const s = store.get();
  setTrips(editSlotStops(s.trips, s.presetId, edit));
}

function setHealth(h: SourceHealth): void {
  const rest = store.get().health.filter((x) => x.id !== h.id);
  store.set({ health: [...rest, h] });
}

// ───────────── evaluate (pure, local) ─────────────
function evaluate(rescanBest: boolean): void {
  const s = store.get();
  if (!s.stretches.length || !s.sources.length) return;
  const nowMs = Date.now();
  // Radar older than 30 min (e.g. restored offline) must not bump anything.
  const fresh = !!s.radarSampleMs && nowMs - s.radarSampleMs <= 30 * MIN;
  const radar = fresh ? s.radarSamples : null;
  const radarDetail = fresh ? s.radarDetail : null;
  const run = (d: number) => evaluateTrip(s.stretches, d, s.sources, radar, nowMs, radarDetail);
  const evals = run(s.departMs);
  const summary = summarize(evals);
  const patch: Partial<AppState> = { evals, summary, nowMs };
  if (rescanBest || !s.bestRows.length) {
    const rows = scanDepartures(s.baseMs, run, BEST_RANGE_MIN, BEST_STEP_MIN);
    patch.bestRows = rows;
    patch.best = pickBest(rows, nowMs - 5 * MIN); // never suggest leaving in the past
  }
  store.set(patch);
}

// ───────────── load (network) ─────────────
interface Stored {
  key: string;
  savedAt: number;
  fetchedAt: number;
  route: RouteData;
  sources: SourceResult[];
  radar: RadarIndex | null;
  radarSamples: RadarSample[] | null;
  radarDetail?: RadarDetail[] | null;
  radarSampleMs: number | null;
  metmy: { forecasts: MetMyForecast[]; warnings: MetMyWarning[] } | null;
  health: SourceHealth[];
}

let lastLoadKey = '';
const storeKey = (key: string) => `last-result:${key}`;

async function load(force = false): Promise<void> {
  const seq = ++loadSeq;
  const s0 = store.get();
  if (s0.stops.length < 2) {
    // Nothing to drive yet: the setup card takes the answer's place.
    lastLoadKey = '';
    routeSig = '';
    routeMap.clearRoute();
    store.set({ phase: 'empty', error: null, route: null, stretches: [], sources: [], evals: [], summary: null, bestRows: [], best: null, selected: null, radarSamples: null, radarDetail: null, health: [] });
    return;
  }
  const key = routeKey(s0);
  const sameRoute = key === lastLoadKey && s0.evals.length > 0;
  lastLoadKey = key;
  // A refresh of the same route keeps the current answer on screen (no skeleton flash, selection kept).
  store.set(
    sameRoute
      ? { phase: 'loading', error: null }
      : { phase: 'loading', error: null, selected: null, evals: [], bestRows: [], best: null, stretches: [], summary: null },
  );

  const wps = s0.stops;
  let tripMin = s0.tripMin;
  const tune = { bypassCache: force };
  const routeRes = await fetchRoute(wps, tune);
  if (seq !== loadSeq) return;
  const route = routeRes.route;
  if (!route) {
    await restoreOrFail(seq, key, wps, tripMin, `Couldn’t get the route (${routeRes.health.reason}).`, [routeRes.health]);
    return;
  }
  if (s0.tripAuto) {
    tripMin = autoTripMin(route.totalDurS);
    autoMinFor.set(stopsKey(wps), tripMin);
    if (store.get().tripMin !== tripMin) store.set({ tripMin });
  }
  const stretches = buildStretches(route, wps, tripMin);
  const points = stretchPoints(stretches);
  const districts = [...new Set(stretches.map((x) => x.district))];

  // One deadline for the whole weather fan-out so a hung network reaches the error state in ~20 s, not minutes.
  const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20_000) : undefined;
  const wt = { ...tune, ...(signal ? { signal } : {}) };
  const [om, mn, rv, my] = await Promise.all([
    fetchOpenMeteo(points, wt).catch(() => null),
    fetchMetNo(points, wt).catch(() => null),
    fetchRadarIndex(wt).catch(() => null),
    fetchMetMy(districts, wt).catch(() => null),
  ]);
  if (seq !== loadSeq) return;
  const sources: SourceResult[] = [...(om ?? []), ...(mn ? [mn] : [])];
  const health: SourceHealth[] = [
    routeRes.health,
    ...sources.map((x) => x.health),
    rv?.health ?? { id: 'radar', label: 'RainViewer radar', state: 'failed', reason: 'error', fetchedAt: null },
    my?.health ?? { id: 'metmy', label: 'MET Malaysia', state: 'failed', reason: 'error', fetchedAt: null },
  ];
  const mapH = store.get().health.find((h) => h.id === 'map');
  if (mapH) health.push(mapH);

  const okSources = sources.filter((x) => x.health.state !== 'failed' && x.series.some((p) => p !== null));
  if (okSources.length === 0) {
    await restoreOrFail(seq, key, wps, tripMin, 'Every weather source failed. Check your connection and try again.', health, route);
    return;
  }
  // Honest freshness: the OLDEST voter's fetch time.
  const fetchedAt = Math.min(...okSources.map((x) => x.health.fetchedAt ?? Date.now()));
  // Every voter answered from stale cache (captive portal / flaky network): show the offline badge.
  const allStale = okSources.every((x) => x.health.state === 'degraded' && /cached|stale/i.test(x.health.reason));
  store.set({
    route,
    stretches,
    sources,
    radar: rv?.index ?? null,
    radarSamples: null,
    radarDetail: null,
    radarSampleMs: null,
    metmy: my ? { forecasts: my.forecasts, warnings: my.warnings } : null,
    health,
    phase: 'ready',
    fetchedAt,
    fromStore: allStale,
    offline: navigator.onLine === false,
  });
  evaluate(true);
  void persist(key);

  // Radar sampling is async and optional: it can raise stretches within 90 min, and lower ones within 40 min
  // when the radar is clear there now.
  const latestFrame = rv?.index?.frames.filter((f) => f.kind === 'past').at(-1);
  if (rv?.index && latestFrame && Date.now() - latestFrame.time <= 30 * MIN) {
    try {
      const [samples, detail] = await Promise.all([sampleRadar(rv.index, points, browserImageLoader), sampleRadarDetail(rv.index, points, browserImageLoader)]);
      if (seq !== loadSeq) return;
      store.set({ radarSamples: samples, radarDetail: detail, radarSampleMs: latestFrame.time });
      evaluate(true);
      void persist(key);
    } catch {
      /* radar stays unknown */
    }
  }
}

async function persist(key: string): Promise<void> {
  const s = store.get();
  if (!s.route) return;
  const rec: Stored = {
    key,
    savedAt: Date.now(),
    fetchedAt: s.fetchedAt ?? Date.now(),
    route: s.route,
    sources: s.sources,
    radar: s.radar,
    radarSamples: s.radarSamples,
    radarDetail: s.radarDetail,
    radarSampleMs: s.radarSampleMs,
    metmy: s.metmy,
    health: s.health,
  };
  // One saved result per route+direction+trip length, so morning and evening both work offline.
  await idbSet(storeKey(key), rec).catch(() => undefined);
}

async function restoreOrFail(
  seq: number,
  key: string,
  wps: Waypoint[],
  tripMin: number,
  message: string,
  health: SourceHealth[],
  route: RouteData | null = null,
): Promise<void> {
  const rec = await idbGet<Stored>(storeKey(key)).catch(() => undefined);
  if (seq !== loadSeq) return; // a newer load owns the screen
  if (rec && rec.key === key && rec.route) {
    const stretches = buildStretches(rec.route, wps, tripMin);
    store.set({
      route: rec.route,
      stretches,
      sources: rec.sources,
      radar: rec.radar,
      radarSamples: rec.radarSamples,
      radarDetail: rec.radarDetail ?? null,
      radarSampleMs: rec.radarSampleMs ?? null,
      metmy: rec.metmy,
      health: health.length > 1 ? health : rec.health.map((h) => ({ ...h, state: h.state === 'ok' ? 'degraded' : h.state, reason: `offline · saved ${formatHHMM(rec.fetchedAt)}` })),
      phase: 'ready',
      fetchedAt: rec.fetchedAt,
      fromStore: true,
      offline: true,
      error: null,
    });
    evaluate(true);
    return;
  }
  // Keep drawing the route (neutral ink) when only the forecast failed.
  store.set({ phase: 'error', error: message, health, evals: [], summary: null, bestRows: [], best: null, ...(route ? { route } : {}) });
}

// ───────────── map sync ─────────────
function syncMap(fit: boolean): void {
  const s = store.get();
  routeMap.setWaypoints(s.stops, s.editing);
  if (s.route) routeMap.setRoute(s.route.coords, fit);
  routeMap.setEvals(s.evals);
  routeMap.setRadar(s.radar);
  routeMap.highlight(s.selected, s.hovered);
}

// ───────────── mount ─────────────
let sheetCovered = 0; // px of the map the bottom sheet covers (phones)
const sheetCtl = mountSheet(sheet, handle, (covered) => {
  routeMap.setPadding(covered);
  sheetCovered = covered;
});
const isDesk = () => matchMedia('(min-width: 1024px)').matches;
mountSideResize(sheet, (w, d) => routeMap.setLeftInset(isDesk() ? w : 0, isDesk() ? d : 0));
const settings = mountSettings(store, actions);
mountBand(band, store, actions, settings.button);
mountAnswer(answer, store, () => void load(true));
mountTimeline(stripSec, store, actions);
mountDetail(detailSec, store, actions);
mountBestTime(bestSec, store, actions);
mountAgreement(matrixSec, store, actions);
mountRadar(radarSec, store, routeMap, (t) => {
  radarTag.textContent = '';
  // "Offline" depends on the newest frame, not the one on screen (playback starts two hours back).
  const newest = store.get().radar?.frames.filter((f) => f.kind === 'past').at(-1)?.time ?? t;
  if (t && newest && Date.now() - newest > 2 * 3600_000) radarTag.append(el('span', { text: 'Radar offline · last' }), el('span', { class: 'num', text: formatHHMM(t) }));
  else if (t) radarTag.append(el('span', { text: 'Radar' }), el('span', { class: 'num', text: formatHHMM(t) }), ...(Date.now() - t > 30 * 60000 ? [el('span', { text: `· ${formatAgeShort(Date.now() - t)} old` })] : []));
  else radarTag.append(el('span', { text: store.get().phase === 'loading' ? 'Radar loading…' : 'Radar unavailable' }));
});
const editor = mountEditor(editSec, store, actions, () => settings.open('trips'));
const setup = mountSetup(setupSec, store, actions);
mountFoot();
let prevPhase = store.get().phase;
on(store, ['phase'], (s) => {
  sheet.classList.toggle('is-empty', s.phase === 'empty');
  // A trip was just set up: bring the answer (top of the panel) into view.
  if (prevPhase === 'empty' && s.phase !== 'empty') scroll.scrollTop = 0;
  prevPhase = s.phase;
});

let routeSig = '';
let routeTrip = '';
// Until the MapLibre chunk has loaded, a plain SVG sketch of the route (route ink on the paper ground, same
// framing as fitBounds) keeps the map area from sitting empty.
let mapReady = false;
let sketch: SVGSVGElement | null = null;
function drawSketch(coords: [number, number][], pending = false): void {
  sketch?.remove();
  const w = mapEl.clientWidth;
  const h = mapEl.clientHeight;
  if (!w || !h || coords.length < 2) return;
  const covered = matchMedia('(min-width: 1024px)').matches ? 0 : Math.min(h * 0.72, sheetCovered);
  const left = isDesk() ? sideWidth() : 0; // the map runs under the desktop panel
  const box = { x: left + 28, y: covered ? 92 : 56, w: w - left - 56, h: h - covered - (covered ? 108 : 112) };
  if (box.w < 40 || box.h < 40) return;
  const ys = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [lon, lat] of coords) {
    const y = ys(lat);
    minX = Math.min(minX, lon); maxX = Math.max(maxX, lon); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const k = Math.min(box.w / ((maxX - minX) * Math.PI / 180 || 1), box.h / (maxY - minY || 1));
  const ox = box.x + (box.w - ((maxX - minX) * Math.PI / 180) * k) / 2;
  const oy = box.y + (box.h - (maxY - minY) * k) / 2;
  const pts = coords.filter((_, i) => pending || i % 3 === 0 || i === coords.length - 1).map(([lon, lat]) => `${(ox + ((lon - minX) * Math.PI / 180) * k).toFixed(1)},${(oy + (maxY - ys(lat)) * k).toFixed(1)}`);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', pending ? 'route-sketch pending' : 'route-sketch');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const line = document.createElementNS(NS, 'polyline');
  line.setAttribute('points', pts.join(' '));
  svg.append(line);
  for (const p of [pts[0]!, pts[pts.length - 1]!]) {
    const [cx, cy] = p.split(',');
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', cx!); c.setAttribute('cy', cy!); c.setAttribute('r', '7');
    svg.append(c);
  }
  mapEl.append(svg);
  sketch = svg;
}
on(store, ['route'], (s) => {
  if (!s.route) return;
  const c = s.route.coords;
  const sig = `${c.length}:${c[0]?.join()}:${c.at(-1)?.join()}`;
  const trip = `${s.presetId}|${s.trips[s.presetId]?.tripId ?? ''}`;
  // Re-fit only when the geometry really changed; a different trip or tab is always framed, while an
  // edit to the same trip keeps the view the user zoomed to.
  routeMap.setRoute(c, sig !== routeSig, trip !== routeTrip);
  routeSig = sig;
  routeTrip = trip;
  if (!mapReady) drawSketch(c);
}, false);
on(store, ['evals'], (s) => {
  routeMap.setEvals(s.evals);
  routeTag.hidden = !s.evals.length;
}, false);
on(store, ['selected', 'hovered'], (s) => routeMap.highlight(s.selected, s.hovered), false);
on(store, ['stops', 'editing'], (s) => {
  routeMap.setWaypoints(s.stops, s.editing);
  editBar.hidden = !s.editing;
  mapNote.hidden = s.editing && !matchMedia('(min-width: 1024px)').matches;
}, false);
on(store, ['radar'], (s) => routeMap.setRadar(s.radar), false);
on(store, ['theme'], (s) => {
  const eff = applyTheme(s.theme);
  routeMap.setTheme(eff);
  requestAnimationFrame(() => routeMap.refreshColors());
}, false);
onSystemThemeChange(() => {
  const s = store.get();
  if (s.theme === 'auto') {
    routeMap.setTheme(effectiveTheme('auto'));
    requestAnimationFrame(() => routeMap.refreshColors());
  }
});

// Auto-refresh while visible. Not forced: each source is only re-fetched once its own cache
// lifetime is over (Open-Meteo 15 min, MET Norway per its Expires header, radar 5 min).
setInterval(() => {
  const s = store.get();
  if (s.autoRefresh && !document.hidden && s.phase !== 'loading') void load(false);
}, AUTO_REFRESH_MIN * MIN);

addEventListener('online', () => {
  store.set({ offline: false });
  if (store.get().fromStore) void load(true);
});
addEventListener('offline', () => store.set({ offline: true }));
// A share link pasted into an open tab only changes the hash.
addEventListener('hashchange', () => {
  const sh = readShared();
  if (sh) {
    store.set({ shared: sh });
    scroll.scrollTop = 0;
  }
});

void load();
// Before the route arrives: a dashed sketch through the saved pins, so the map area is never empty.
requestAnimationFrame(() => {
  if (!mapReady && !store.get().route) drawSketch(store.get().stops.map((w) => [w.lon, w.lat] as [number, number]), true);
});
// Map after the answer: idle-load the heavy chunk.
// The MapLibre chunk is ~1 MB of JS: parse it only once the answer has painted (or after 4 s), so it never
// competes with the forecast for the main thread on a phone.
let mapStarted = false;
const startMap = () => {
  if (mapStarted) return;
  mapStarted = true;
  void routeMap.init(effectiveTheme(store.get().theme));
};
const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 800 }) : setTimeout(fn, 200));
on(store, ['phase'], () => {
  const p = store.get().phase;
  if (p === 'ready' || p === 'error' || p === 'empty') idle(startMap);
}, false);
setTimeout(() => idle(startMap), 4000);

// PWA (production only).
if (import.meta.env.PROD && 'serviceWorker' in navigator && import.meta.env.MODE !== 'e2e-nosw') {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}

// Test/debug hook (read-only snapshot).
(window as unknown as { __raincheck: () => AppState }).__raincheck = () => store.get();
if (import.meta.env.DEV) (window as unknown as { __rcMap: unknown }).__rcMap = routeMap;

// ───────────── map right-click menu ─────────────
const menu = mapMenu(mapEl);
function openMapMenu(e: { lat: number; lon: number; x: number; y: number; waypointId: string | null }): void {
  const s = store.get();
  const label = `Map point ${e.lat.toFixed(3)}, ${e.lon.toFixed(3)}`;
  const place = { name: label, lat: e.lat, lon: e.lon };
  if (!inMalaysia(e.lat, e.lon)) {
    menu.open(e.x, e.y, 'Outside Malaysia', [{ label: 'RainCheck covers Malaysia only', disabled: true, run: () => undefined }]);
    return;
  }
  const wp = e.waypointId ? s.stops.find((w) => w.id === e.waypointId) : undefined;
  if (wp) {
    const i = s.stops.indexOf(wp);
    const role = i === 0 ? 'Start' : i === s.stops.length - 1 ? 'Destination' : `Stop ${i}`;
    const items: MenuItem[] = [
      { label: 'To move it: hold the pin, then drag', icon: 'pin', disabled: true, run: () => undefined },
      { label: s.stops.length > 2 ? `Remove ${role.toLowerCase()}` : 'A trip needs a start and a destination', icon: 'trash', danger: true, disabled: s.stops.length <= 2, run: () => actions.removeWaypoint(wp.id) },
    ];
    menu.open(e.x, e.y, `${role}: ${wp.name}`, items);
    return;
  }
  if (s.stops.length < 2) {
    menu.open(e.x, e.y, label, [
      { label: 'Start a trip here', icon: 'pin', run: () => setup.prefill('from', place) },
      { label: 'Drive here', icon: 'flag', run: () => setup.prefill('to', place) },
    ]);
    return;
  }
  const full = s.stops.length >= 12;
  menu.open(e.x, e.y, label, [
    { label: full ? 'Stops full (12)' : 'Add a stop here', icon: 'plus', disabled: full, run: () => actions.insertVia(e.lat, e.lon) },
    { label: 'Make this the start', icon: 'pin', run: () => actions.setEndpoint('start', label, e.lat, e.lon) },
    { label: 'Make this the destination', icon: 'flag', run: () => actions.setEndpoint('end', label, e.lat, e.lon) },
    { label: 'New trip from here', icon: 'route', run: () => editor.newTripWith('from', place) },
    { label: 'New trip to here', icon: 'route', run: () => editor.newTripWith('to', place) },
  ]);
}

// ───────────── panel footer: how it works + source status, both open Settings ─────────────
function mountFoot(): void {
  const srcBtn = el('button', { type: 'button', class: 'foot-btn', id: 'foot-sources', onclick: () => settings.open('sources') });
  const howBtn = el('button', { type: 'button', class: 'foot-btn', id: 'foot-how', onclick: () => settings.open('about') }, 'How this works');
  const fb = mountFeedback();
  const sep = () => el('span', { class: 'foot-sep', 'aria-hidden': 'true', text: '·' });
  const ver = el('span', { class: 'foot-ver num', id: 'app-version', title: `RainCheck ${APP_VERSION}`, text: versionLabel() });
  footSec.append(srcBtn, sep(), howBtn, sep(), fb.button, sep(), ver);
  on(store, ['health'], (s) => {
    srcBtn.textContent = '';
    const bad = s.health.filter((h) => h.state === 'failed').length;
    const deg = s.health.filter((h) => h.state === 'degraded').length;
    const state = bad ? 'failed' : deg ? 'degraded' : 'ok';
    srcBtn.append(
      el('span', { class: `st ${state}`, 'aria-hidden': 'true' }),
      !s.health.length ? 'Data sources' : bad || deg ? `Sources: ${bad ? `${bad} failed` : ''}${bad && deg ? ', ' : ''}${deg ? `${deg} degraded` : ''}` : `All ${s.health.length} sources OK`,
    );
  });
}

function formatAgeShort(ms: number): string {
  const m = Math.round(ms / 60000);
  return m < 90 ? `${m} min` : `${Math.round(m / 60)} h`;
}
