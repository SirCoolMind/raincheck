// Minimal observable store. UI modules subscribe and render; only the controller (main.ts) writes.
import type { PresetId, Waypoint } from './config';
import type { Trip, TripsState } from './core/trips';
import type {
  DepartureRow,
  MetMyForecast,
  MetMyWarning,
  RadarIndex,
  RadarDetail, RadarSample,
  RouteData,
  SourceHealth,
  SourceResult,
  Stretch,
  StretchEval,
  Summary,
} from './core/types';

/** 'empty' = the active tab has no trip yet (the setup card shows instead of an answer). */
export type Phase = 'loading' | 'ready' | 'error' | 'empty';
export type ThemePref = 'auto' | 'light' | 'dark';

export interface AppState {
  presetId: PresetId;
  /** Saved trips + which trip each tab drives (source of truth, persisted). */
  trips: TripsState;
  /** MYT wall time for the Custom preset. */
  customTime: string;
  /** Derived from trips + presetId: the active tab's stops in travel order. */
  stops: Waypoint[];
  /** Derived: the active trip's planned drive length (min). */
  tripMin: number;
  /** The length is automatic (route driving time + traffic allowance), not set by hand. */
  tripAuto: boolean;
  /** There is a trips change to undo (pin moves, adds, removals, edits). */
  canUndo: boolean;
  /** A trip from a share link (#t=…) waiting for the visitor to save or dismiss it. */
  shared: Pick<Trip, 'name' | 'stops' | 'tripMin'> | null;

  /** Base departure for the current preset (epoch ms). The scrubber offsets from it. */
  baseMs: number;
  departMs: number;
  nowMs: number;

  route: RouteData | null;
  stretches: Stretch[];
  sources: SourceResult[];
  radar: RadarIndex | null;
  radarSamples: RadarSample[] | null;
  /** Clear-now / rained-recently per stretch, from the same frames (same 30-min freshness rule). */
  radarDetail: RadarDetail[] | null;
  /** Time of the radar frame the samples came from (samples older than 30 min are ignored). */
  radarSampleMs: number | null;
  metmy: { forecasts: MetMyForecast[]; warnings: MetMyWarning[] } | null;
  health: SourceHealth[];

  evals: StretchEval[];
  summary: Summary | null;
  bestRows: DepartureRow[];
  best: DepartureRow | null;

  selected: number | null;
  hovered: number | null;

  phase: Phase;
  error: string | null;
  /** When the weather data shown was fetched. */
  fetchedAt: number | null;
  offline: boolean;
  /** Data restored from IndexedDB because the network failed. */
  fromStore: boolean;

  theme: ThemePref;
  autoRefresh: boolean;
  editing: boolean;
}

type Listener = (s: AppState, prev: AppState) => void;

export class Store {
  private s: AppState;
  private listeners = new Set<Listener>();
  constructor(initial: AppState) {
    this.s = initial;
  }
  get(): AppState {
    return this.s;
  }
  set(patch: Partial<AppState>): void {
    const prev = this.s;
    this.s = { ...prev, ...patch };
    for (const l of this.listeners) l(this.s, prev);
  }
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

/** Run `fn` only when one of the selected keys changed. */
export function on<K extends keyof AppState>(
  store: Store,
  keys: K[],
  fn: (s: AppState) => void,
  immediate = true,
): void {
  store.subscribe((s, prev) => {
    if (keys.some((k) => s[k] !== prev[k])) fn(s);
  });
  if (immediate) fn(store.get());
}

// ───── local persistence (per-viewer conveniences only) ─────
const LS = 'raincheck:v1:';
export function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(LS + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function saveLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(LS + key, JSON.stringify(value));
  } catch {
    /* private mode / quota — ignore */
  }
}

/** Everything the UI may ask the controller to do. */
export interface Actions {
  select(idx: number | null): void;
  hover(idx: number | null): void;
  setDepart(ms: number): void;
  setPreset(id: PresetId): void;
  setPresetTime(id: PresetId, hhmm: string): void;
  setCustomDirection(toOffice: boolean): void;
  leaveNow(): void;
  refresh(): void;
  setTheme(t: ThemePref): void;
  setAutoRefresh(on: boolean): void;
  setEditing(on: boolean): void;
  moveWaypoint(id: string, lat: number, lon: number): void;
  insertVia(lat: number, lon: number): void;
  addWaypoint(name: string, lat: number, lon: number): void;
  removeWaypoint(id: string): void;
  /** Replace the start or the destination (map right-click). */
  setEndpoint(which: 'start' | 'end', name: string, lat: number, lon: number): void;
  /** null = automatic length from the route. */
  setTripMin(min: number | null): void;
  /** Step back one trips change. */
  undo(): void;
  /** Put a saved trip on a tab; null leaves the tab empty (for a new trip). */
  assignTrip(preset: PresetId, tripId: string | null): void;
  setEveningMirror(on: boolean): void;
  /** Custom drives the Morning trip (the default). */
  customFollowMorning(): void;
  /** Save stops as a new trip and put it on the active tab. False if the library is full / invalid. */
  createTrip(stops: Waypoint[], name?: string, tripMin?: number | null): boolean;
  renameTrip(id: string, name: string): void;
  deleteTrip(id: string): void;
  useExample(): void;
  /** Link that carries the active tab's trip, or null when the tab is empty. */
  shareUrl(): string | null;
  acceptShared(): void;
  dismissShared(): void;
  /** JSON backup of all trips. */
  exportTrips(): string;
  /** Merge a parsed backup; returns a message for the user. */
  importTrips(data: unknown): string;
}
