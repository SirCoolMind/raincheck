// Defaults. Every value here is a guess the user can change in the UI (waypoint editor / presets).

import districtData from './data/districts.json';

/** A MET Malaysia district name (data.gov.my location_name), e.g. 'Sepang'. */
export type District = string;

export interface Waypoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** On a dual-carriageway highway: OSRM gets a bearing so it snaps to the right side. */
  highway?: boolean;
  /** MET Malaysia district for stretches within 4 km of this pin (overrides nearest centroid). */
  district?: District;
}

/**
 * Neutral example route a new visitor can try (Shah Alam → KLCC). Nobody's real commute ships in the
 * bundle: your own trips live only in your browser.
 */
export const EXAMPLE_TRIP: { name: string; stops: readonly Waypoint[] } = {
  name: 'Example: Shah Alam → KLCC',
  stops: [
    { id: 'ex-start', name: 'Shah Alam', lat: 3.0738, lon: 101.5183 },
    { id: 'ex-end', name: 'KLCC', lat: 3.1579, lon: 101.7123 },
  ],
};

export type Direction = 'toOffice' | 'toHome';
export type PresetId = 'morning' | 'evening' | 'custom';

export interface Preset {
  id: PresetId;
  label: string;
  /** MYT wall-clock "HH:MM". */
  time: string;
  direction: Direction;
}

export const DEFAULT_PRESETS: Record<'morning' | 'evening', Preset> = {
  morning: { id: 'morning', label: 'Morning', time: '07:30', direction: 'toOffice' },
  evening: { id: 'evening', label: 'Evening', time: '18:00', direction: 'toHome' },
};

export const DEFAULT_TRIP_MIN = 60;
export const STRETCH_TARGET_MIN = 5;
export const SCRUB_RANGE_MIN = 120;
export const BEST_RANGE_MIN = 60;
export const BEST_STEP_MIN = 10;
export const AUTO_REFRESH_MIN = 10;

/** Malaysia has no DST: MYT is UTC+8 all year. All time maths uses this, never the device zone. */
export const TZ = 'Asia/Kuala_Lumpur';
export const MYT_OFFSET_MS = 8 * 3600 * 1000;

/**
 * All 168 MET Malaysia districts (data.gov.my location_id + name) with an approximate centroid and state,
 * built once by scripts/record-districts.mjs. Stretches use the nearest centroid.
 */
export const DISTRICTS: readonly { name: District; locationId: string; lat: number; lon: number; state: string }[] = (
  districtData as { id: string; name: string; lat: number; lon: number; state: string }[]
).map((d) => ({ name: d.name, locationId: d.id, lat: d.lat, lon: d.lon, state: d.state }));

/** Putrajaya federal territory bounding box (overrides nearest-centroid). */
export const PUTRAJAYA_BBOX = { minLat: 2.88, maxLat: 2.99, minLon: 101.66, maxLon: 101.73 };

export const APP_NAME = 'RainCheck – Daily Commute';
/** Generic identifying UA for MET Norway (sent by the PHP proxy; browsers can't set it). No personal data. */
export const APP_UA = 'RainCheckDailyCommute/1.0 (+https://github.com/example/raincheck-daily-commute)';

export const ENDPOINTS = {
  openMeteo: 'https://api.open-meteo.com/v1/forecast',
  metno: 'https://api.met.no/weatherapi/locationforecast/2.0/compact',
  metmyForecast: 'https://api.data.gov.my/weather/forecast/',
  metmyWarning: 'https://api.data.gov.my/weather/warning/',
  rainviewer: 'https://api.rainviewer.com/public/weather-maps.json',
  osrm: 'https://router.project-osrm.org/route/v1/driving/',
  nominatim: 'https://nominatim.openstreetmap.org/search',
  proxy: {
    openmeteo: '/api/openmeteo.php',
    metno: '/api/metno.php',
    metmy: '/api/metmy.php',
    radar: '/api/radar.php',
    route: '/api/route.php',
    carto: '/api/carto.php',
    search: '/api/search.php',
  },
} as const;

// No 'best_match': it is built from these same models (mostly ECMWF here), so it would be a second vote for one model.
export const OPEN_METEO_MODELS = [
  'ecmwf_ifs025',
  'gfs_seamless',
  'icon_seamless',
  'jma_seamless',
] as const;
export type OpenMeteoModel = (typeof OPEN_METEO_MODELS)[number];
