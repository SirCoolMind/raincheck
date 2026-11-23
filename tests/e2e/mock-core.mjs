// Shared network mock for the Playwright suite (tests/e2e/mock.ts) and the screenshot harness (scripts/screens.mjs).
// Plain JS so both TypeScript and node can import it. Serves generated Open-Meteo / MET Norway data and real recorded
// fixtures for everything else; there is NO PHP backend, so /api/*.php is 404 and the app falls back to direct upstreams.
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(HERE, '../fixtures/real');
const readJson = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));

export const TEST_NOW = '2026-11-20T07:00:00+08:00';
export const TEST_DAY = '2026-11-20';
const DAY0 = Date.parse(`${TEST_DAY}T00:00:00+08:00`);
const MIN = 60_000;
export const MODELS = ['best_match', 'ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'jma_seamless'];

// ───────────── scenarios: mmh(lat, lon, ms, model) → mm/h. model = an Open-Meteo model id or 'metno'. ─────────────
const LATE_RAIN_FROM = Date.parse(`${TEST_DAY}T08:00:00+08:00`);
export const SCENARIOS = {
  dry: { name: 'dry', mmh: () => 0 },
  rainAtMex: { name: 'rainAtMex', mmh: (lat) => (lat >= 2.97 && lat <= 3.06 ? 2.0 : 0) },
  heavy: { name: 'heavy', mmh: (_lat, _lon, _ms, model) => (model === 'jma_seamless' ? 0 : 8) },
  // Screens showcase: a rain cell over the MEX latitudes from 07:45 to 08:30 (so departure rows differ), GFS disagrees.
  rainAtMexTimed: {
    name: 'rainAtMexTimed',
    mmh: (lat, _lon, ms, model) =>
      model !== 'gfs_seamless' && lat >= 2.97 && lat <= 3.06 && ms >= DAY0 + 465 * MIN && ms < DAY0 + 510 * MIN ? 2.0 : 0,
  },
  lateRain: { name: 'lateRain', mmh: (_lat, _lon, ms) => (ms >= LATE_RAIN_FROM ? 3.0 : 0) },
};

// ───────────── PNG tiles ─────────────
let crcTable;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x++) row.set(rgba, 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const PNG_CLEAR = makePng(256, [0, 0, 0, 0]);
const PNG_WET = makePng(256, [40, 120, 255, 255]);

// ───────────── generators ─────────────
const pad = (n) => String(n).padStart(2, '0');
function mytLabel(ms) {
  const d = new Date(ms + 8 * 3600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function genOpenMeteo(url, scenario) {
  const q = new URL(url).searchParams;
  const lats = (q.get('latitude') ?? '').split(',').map(Number);
  const lons = (q.get('longitude') ?? '').split(',').map(Number);
  const m15 = Array.from({ length: 2 * 96 }, (_, i) => DAY0 + i * 15 * MIN);
  const hr = Array.from({ length: 2 * 24 }, (_, i) => DAY0 + i * 60 * MIN);
  const out = lats.map((lat, k) => {
    const lon = lons[k];
    const minutely = { time: m15.map(mytLabel) };
    const hourly = { time: hr.map(mytLabel) };
    for (const m of MODELS) {
      minutely[`precipitation_${m}`] = m15.map((t) => Math.round((scenario.mmh(lat, lon, t, m) / 4) * 1000) / 1000);
      hourly[`precipitation_${m}`] = hr.map((t) => scenario.mmh(lat, lon, t, m));
      hourly[`precipitation_probability_${m}`] = hr.map((t) => (scenario.mmh(lat, lon, t, m) >= 0.4 ? 80 : 5));
    }
    return { latitude: lat, longitude: lon, utc_offset_seconds: 28800, timezone: 'Asia/Kuala_Lumpur', minutely_15: minutely, hourly };
  });
  return out.length === 1 ? out[0] : out;
}

export function genMetNo(url, scenario) {
  const q = new URL(url).searchParams;
  const lat = Number(q.get('lat'));
  const lon = Number(q.get('lon'));
  const ts = Array.from({ length: 56 }, (_, i) => {
    const t = DAY0 + i * 60 * MIN;
    return {
      time: new Date(t).toISOString().replace('.000Z', 'Z'),
      data: { instant: { details: {} }, next_1_hours: { summary: { symbol_code: 'cloudy' }, details: { precipitation_amount: scenario.mmh(lat, lon, t, 'metno') } } },
    };
  });
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat, 10] }, properties: { meta: { updated_at: TEST_NOW }, timeseries: ts } };
}

/** OSRM fixture is the morning (home→office) route; reversed requests get legs/steps/geometries reversed. */
export function reverseOsrm(json) {
  const copy = JSON.parse(JSON.stringify(json));
  for (const r of copy.routes) {
    r.legs.reverse();
    for (const leg of r.legs) {
      leg.steps.reverse();
      for (const st of leg.steps) st.geometry.coordinates.reverse();
    }
  }
  return copy;
}

// ───────────── installer ─────────────
/**
 * @param page   Playwright Page (or BrowserContext: anything with .route)
 * @param scenario  entry of SCENARIOS (or {mmh, radarWet?})
 * @param opts   { failSources?: string[]  ('openmeteo'|'metno'|'metmy'|'radar'|'osrm'|'all'),
 *                 delayMs?: number (Open-Meteo), delayAllMs?: number (every mocked upstream) }
 * @returns ctl  { counts, fail:Set, setFail(list), delay:{openmeteo,all}, urls:string[] }
 */
export async function installMocks(page, scenario, opts = {}) {
  const fixtures = {
    osrm: readJson('osrm.json'),
    osrmRev: null,
    metmyF: readJson('metmy-forecast.json'),
    metmyW: readJson('metmy-warning.json'),
    radar: readJson('rainviewer.json'),
    nominatim: readJson('nominatim.json'),
  };
  const ctl = {
    counts: { wind: 0, openmeteo: 0, metno: 0, metmy: 0, rainviewer: 0, osrm: 0, tiles: 0, weather: 0 },
    fail: new Set(opts.failSources ?? []),
    delay: { openmeteo: opts.delayMs ?? 0, all: opts.delayAllMs ?? 0 },
    urls: [],
    offline: false,
    setOffline(v) {
      ctl.offline = !!v;
    },
    setFail(list) {
      ctl.fail = new Set(list);
    },
    resetCounts() {
      for (const k of Object.keys(ctl.counts)) ctl.counts[k] = 0;
    },
  };
  // A returning user: the test route saved by an older version (v1 key), which the app migrates
  // into the Morning trip. Only when nothing is stored, so reloads keep edits. opts.seed=false = first visit.
  if (opts.seed !== false) {
    const route = JSON.parse(readFileSync(path.join(HERE, '..', 'fixtures', 'test-route.json'), 'utf8'));
    await page.addInitScript((wps) => {
      try {
        if (!localStorage.getItem('raincheck:v1:trips.v2') && !sessionStorage.getItem('rc-seeded')) {
          localStorage.setItem('raincheck:v1:waypoints', JSON.stringify(wps));
          sessionStorage.setItem('rc-seeded', '1');
        }
      } catch {
        /* storage blocked */
      }
    }, route);
  }
  const failed = (name) => ctl.fail.has(name) || ctl.fail.has('all');
  const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Expires' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const json = (route, body, extra = {}) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { ...cors, ...extra }, body: JSON.stringify(body) });
  const err = (route, status = 500) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: '{"error":"mock"}' });

  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    let u;
    try {
      u = new URL(url);
    } catch {
      return route.continue();
    }
    const host = u.hostname;

    // Same-origin: app assets pass through; the PHP backend does not exist.
    if (host === '127.0.0.1' || host === 'localhost') {
      if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'no backend in e2e' });
      return route.continue();
    }
    if (u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
    if (ctl.offline) return route.abort('internetdisconnected');
    ctl.urls.push(url);
    if (ctl.delay.all) await sleep(ctl.delay.all);

    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,OPTIONS' } });
    }

    if (host === 'router.project-osrm.org') {
      ctl.counts.osrm++;
      if (failed('osrm')) return err(route);
      const coords = decodeURIComponent(u.pathname.split('/driving/')[1] ?? '').split(';').map((c) => c.split(',').map(Number));
      const reversed = coords.length > 1 && coords[0][1] > coords[coords.length - 1][1]; // starts at the office end
      if (reversed) fixtures.osrmRev ??= reverseOsrm(fixtures.osrm);
      return json(route, reversed ? fixtures.osrmRev : fixtures.osrm);
    }
    if (host === 'api.open-meteo.com' && u.searchParams.get('current')) {
      // Radar minimap wind grid: steady 12 km/h from the north-east everywhere. Not a forecast call.
      ctl.counts.wind++;
      const n = (u.searchParams.get('latitude') ?? '').split(',').length;
      return json(route, Array.from({ length: n }, () => ({ current: { wind_speed_10m: 12, wind_direction_10m: 45 } })));
    }
    if (host === 'api.open-meteo.com') {
      ctl.counts.openmeteo++;
      ctl.counts.weather++;
      if (ctl.delay.openmeteo) await sleep(ctl.delay.openmeteo);
      if (failed('openmeteo')) return err(route);
      return json(route, genOpenMeteo(url, scenario));
    }
    if (host === 'api.met.no') {
      ctl.counts.metno++;
      ctl.counts.weather++;
      if (failed('metno')) return err(route);
      return json(route, genMetNo(url, scenario), { Expires: new Date(Date.parse(TEST_NOW) + 3600_000).toUTCString() });
    }
    if (host === 'api.data.gov.my') {
      ctl.counts.metmy++;
      ctl.counts.weather++;
      if (failed('metmy')) return err(route);
      return json(route, u.pathname.includes('/warning') ? fixtures.metmyW : fixtures.metmyF);
    }
    if (host === 'api.rainviewer.com') {
      ctl.counts.rainviewer++;
      ctl.counts.weather++;
      if (failed('radar')) return err(route);
      return json(route, fixtures.radar);
    }
    if (host === 'tilecache.rainviewer.com') {
      ctl.counts.tiles++;
      return route.fulfill({ status: 200, contentType: 'image/png', headers: cors, body: scenario.radarWet ? PNG_WET : PNG_CLEAR });
    }
    if (host === 'nominatim.openstreetmap.org') return json(route, fixtures.nominatim);
    return route.fulfill({ status: 404, contentType: 'text/plain', headers: cors, body: 'blocked in e2e' });
  });
  return ctl;
}
