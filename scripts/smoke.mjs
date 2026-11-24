// One real call per upstream API; prints a table. Exit 0 even on failures. Reads NO key files.
const ORIGIN = 'http://localhost:5173';
const UA = 'RainCheckDailyCommute/1.0 (+https://github.com/example/raincheck-daily-commute)';
const calls = [
  ['Open-Meteo', 'https://api.open-meteo.com/v1/forecast?latitude=2.9226,3.1579&longitude=101.651,101.7123&minutely_15=precipitation&hourly=precipitation_probability,precipitation&models=ecmwf_ifs025,gfs_seamless,icon_seamless,jma_seamless&timezone=Asia%2FKuala_Lumpur&forecast_days=2&past_days=0', {}],
  ['MET Norway', 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=2.8&lon=101.65', { 'User-Agent': UA }],
  ['MET MY forecast', 'https://api.data.gov.my/weather/forecast/?contains=Sepang@location__location_name', {}],
  ['MET MY warning', 'https://api.data.gov.my/weather/warning/?limit=5', {}],
  ['RainViewer', 'https://api.rainviewer.com/public/weather-maps.json', {}],
  ['OSRM', 'https://router.project-osrm.org/route/v1/driving/101.651,2.9226;101.6964,2.9264?overview=false&steps=true&geometries=geojson', {}],
  ['Nominatim', 'https://nominatim.openstreetmap.org/search?q=Putrajaya&countrycodes=my&format=jsonv2&limit=1', { 'User-Agent': UA }],
  ['CARTO style (no key)', 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json', {}],
];
const shape = (j) => (Array.isArray(j) ? `array[${j.length}]` : j && typeof j === 'object' ? `{${Object.keys(j).slice(0, 6).join(',')}${Object.keys(j).length > 6 ? ',…' : ''}}` : typeof j);
const rows = [];
for (const [i, [name, url, headers]] of calls.entries()) {
  if (i) await new Promise((r) => setTimeout(r, 1200));
  const t0 = performance.now();
  try {
    const res = await fetch(url, { headers: { Origin: ORIGIN, ...headers } });
    const text = await res.text();
    let s;
    try { s = shape(JSON.parse(text)); } catch { s = `non-JSON (${text.length} B)`; }
    rows.push([name, String(res.status), String(Math.round(performance.now() - t0)), s, res.headers.get('access-control-allow-origin') ?? '(none)']);
  } catch (e) {
    rows.push([name, 'ERR', String(Math.round(performance.now() - t0)), String(e?.message ?? e), '-']);
  }
}
const head = ['API', 'HTTP', 'ms', 'shape', 'CORS ACAO'];
const all = [head, ...rows];
const w = head.map((_, c) => Math.max(...all.map((r) => r[c].length)));
for (const [n, r] of all.entries()) {
  console.log('| ' + r.map((v, c) => v.padEnd(w[c])).join(' | ') + ' |');
  if (n === 0) console.log('|' + w.map((x) => '-'.repeat(x + 2)).join('|') + '|');
}
const bad = rows.filter((r) => !/^2/.test(r[1]));
if (bad.length) console.log('\nFAILURES: ' + bad.map((r) => `${r[0]} (${r[1]} ${r[3]})`).join('; '));
process.exit(0);
