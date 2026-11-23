// Records ONE real response per upstream into tests/fixtures/real/. Node 22 (global fetch).
// Polite: calls spaced >= 1.2 s apart. Never reads any key file.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'real');
const APP_UA = 'RainCheckDailyCommute/1.0 (+https://github.com/example/raincheck-daily-commute)';
const WAYPOINTS = [
  { id: 'home', name: 'Cyberjaya', lat: 2.9226, lon: 101.651 },
  { id: 'kw', name: 'Putrajaya', lat: 2.9264, lon: 101.6964 },
  { id: 'mex-pj', name: 'MEX – Putrajaya', lat: 2.9969, lon: 101.6831, highway: true },
  { id: 'mex-kl', name: 'MEX – Kuchai Lama', lat: 3.0968, lon: 101.6959, highway: true },
  { id: 'office', name: 'KLCC', lat: 3.1579, lon: 101.7123 },
];
const rad = (d) => (d * Math.PI) / 180;
function bearingDeg(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
const bearings = WAYPOINTS.map((w, i) => {
  if (!w.highway) return '';
  const prev = WAYPOINTS[i - 1] ?? w;
  const next = WAYPOINTS[i + 1] ?? w;
  return `${Math.round(bearingDeg(prev, next))},90`;
}).join(';');

const OM_MODELS = 'best_match,ecmwf_ifs025,gfs_seamless,icon_seamless,jma_seamless';
const jobs = [
  ['openmeteo.json', 'https://api.open-meteo.com/v1/forecast?latitude=2.9226,3.1579&longitude=101.651,101.7123&minutely_15=precipitation&hourly=precipitation_probability,precipitation&models=' + OM_MODELS + '&timezone=Asia%2FKuala_Lumpur&forecast_days=2&past_days=0', {}],
  ['metno.json', 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=2.92&lon=101.65', { 'User-Agent': APP_UA }],
  ['metmy-forecast.json', 'https://api.data.gov.my/weather/forecast/?contains=' + encodeURIComponent('Sepang') + '@location__location_name', {}],
  ['metmy-warning.json', 'https://api.data.gov.my/weather/warning/?limit=5', {}],
  ['rainviewer.json', 'https://api.rainviewer.com/public/weather-maps.json', {}],
  ['osrm.json', 'https://router.project-osrm.org/route/v1/driving/' + WAYPOINTS.map((w) => `${w.lon},${w.lat}`).join(';') + '?overview=false&steps=true&geometries=geojson&continue_straight=true&bearings=' + bearings, {}],
  ['nominatim.json', 'https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent('Putrajaya') + '&countrycodes=my&format=jsonv2&limit=5&accept-language=en', { 'User-Agent': APP_UA }],
];

await mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ONLY=osrm.json,nominatim.json re-records just those files.
const only = process.env.ONLY?.split(',');
for (const [i, [file, url, headers]] of jobs.filter(([f]) => !only || only.includes(f)).entries()) {
  if (i) await sleep(1300);
  try {
    const res = await fetch(url, { headers });
    const text = await res.text();
    if (!res.ok) { console.log(`FAIL ${file}: HTTP ${res.status}`); continue; }
    await writeFile(join(OUT, file), JSON.stringify(JSON.parse(text), null, 1));
    console.log(`ok   ${file} (${text.length} bytes)`);
  } catch (e) {
    console.log(`FAIL ${file}: ${e instanceof Error ? e.message : e}`);
  }
}
