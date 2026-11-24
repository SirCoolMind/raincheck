// Shared PURE types for core/ and sources/. No DOM, no network.
import type { District, OpenMeteoModel } from '../config';

export type LonLat = [lon: number, lat: number];
export interface LatLon {
  lat: number;
  lon: number;
}

/** Voting weather sources (radar and MET Malaysia are NOT voters). */
export type SourceId = `om_${OpenMeteoModel}` | 'metno';
export type AnySourceId = SourceId | 'radar' | 'metmy' | 'route' | 'map';

// ───────────── Route (from OSRM, pure data) ─────────────
export interface RouteData {
  /** Full-resolution polyline, [lon, lat]. */
  coords: LonLat[];
  /** Seconds from start at each coord (monotonic non-decreasing; last = totalDurS). From OSRM step durations. */
  cumDurS: number[];
  /** Road name (OSRM step name) of the segment starting at each coord; '' when unnamed. */
  roadNames: string[];
  totalDurS: number;
  distanceM: number;
  legs: { durationS: number; distanceM: number; summary: string }[];
}

// ───────────── Stretches & timing ─────────────
export interface Stretch {
  index: number;
  /** Fractions of total trip TIME. */
  startFrac: number;
  endFrac: number;
  /** Minutes after departure, already scaled to the user's trip length. */
  startOffsetMin: number;
  endOffsetMin: number;
  midOffsetMin: number;
  /** Forecast point (time-midpoint of the stretch along the route). */
  mid: LatLon;
  /** Sub-polyline for drawing. */
  coords: LonLat[];
  /** Human place name: nearest waypoint (≤ 4 km) else road name else "near <nearest waypoint>". */
  place: string;
  district: District;
}

export interface Eta {
  startMs: number;
  endMs: number;
  midMs: number;
}

// ───────────── Source series ─────────────
/** One time series at one point. times[i] is the slot START (epoch ms). Values are mm/h (already converted). */
export interface PointSeries {
  times: number[];
  stepMin: 15 | 60;
  mmh: (number | null)[];
  /** Chance of rain 0–100 where the source provides it (hourly). Aligned to probTimes. */
  prob?: (number | null)[];
  probTimes?: number[];
}

export type HealthState = 'ok' | 'degraded' | 'failed';
export interface SourceHealth {
  id: AnySourceId;
  label: string;
  state: HealthState;
  /** Plain-language reason, e.g. "cached 12 min", "direct (no proxy)", "HTTP 500", "timeout". */
  reason: string;
  fetchedAt: number | null;
  via?: 'proxy' | 'direct' | 'cache';
}

export interface SourceResult {
  id: SourceId;
  label: string;
  /** Honest resolution label, e.g. "15-min (interpolated from hourly in MY)" or "hourly ÷ 4, shown as mm/h". */
  resolution: string;
  health: SourceHealth;
  /** Index-aligned with the requested points; null = no data for that point. */
  series: (PointSeries | null)[];
}

// ───────────── Radar ─────────────
export interface RadarFrame {
  time: number; // epoch ms
  path: string;
  kind: 'past' | 'nowcast';
}
export interface RadarIndex {
  host: string;
  frames: RadarFrame[];
  generatedMs: number;
}
/** Per stretch: was rain detected at the stretch midpoint in the latest radar frame? null = unknown. */
export type RadarSample = boolean | null;

/** Per stretch: no echo within ~4 km in the latest frame, and any echo there in the hour before it. */
export interface RadarDetail {
  clear: boolean | null;
  recentWet: boolean | null;
  /** No echo anywhere around the route (~30 km) in the latest frame; same for every stretch. */
  areaClear?: boolean | null;
}

// ───────────── MET Malaysia ─────────────
export interface MetMyForecast {
  district: District;
  date: string; // YYYY-MM-DD (MYT)
  morning: string;
  afternoon: string;
  night: string;
  summary: string;
  summaryWhen: string;
}
export interface MetMyWarning {
  issued: string;
  title: string;
  heading: string;
  text: string;
  validFrom: string;
  validTo: string;
}

// ───────────── Verdict ─────────────
export type Level = 'nodata' | 'dry' | 'possible' | 'rain' | 'heavy';

export interface Vote {
  source: SourceId;
  mmh: number | null;
  prob: number | null;
}

export interface Verdict {
  level: Level;
  /** Level before any radar bump. */
  baseLevel: Level;
  radarBumped: boolean;
  /** Lowered one level because the radar is clear there now (ETA within RADAR_CLEAR_WINDOW_MIN). */
  radarLowered?: boolean;
  /** Radar is clear now but showed rain there in the last hour: roads may still be wet. */
  justEnded?: boolean;
  /** Sources supporting the verdict's claim (dry→dry count; possible/rain→wet count; heavy→heavy count). */
  agree: number;
  /** Sources that returned a value. */
  total: number;
  maxMmh: number | null;
  votes: Vote[];
}

export interface StretchEval {
  stretch: Stretch;
  eta: Eta;
  verdict: Verdict;
}

export interface Window {
  level: Level;
  fromIdx: number;
  toIdx: number;
  startMs: number;
  endMs: number;
  place: string;
}

export interface Summary {
  level: Level;
  /** e.g. "Rain 08:20–08:35 near MEX – Putrajaya" (no icon; UI adds the icon). */
  sentence: string;
  /** Secondary line, e.g. "Also possible 08:50 near Kuchai Lama" or ''. */
  detail: string;
  /** Radar note, e.g. "Rain just ended near Putrajaya – roads may be wet" or ''. */
  note?: string;
  windows: Window[];
  /** Agreement for the headline window (or whole trip when dry). */
  agree: number;
  total: number;
}

export interface DepartureRow {
  departMs: number;
  /** Wet minutes: rain/heavy stretch minutes + 0.5 × possible minutes. */
  wetMin: number;
  hasData: boolean;
  levels: Level[];
}
