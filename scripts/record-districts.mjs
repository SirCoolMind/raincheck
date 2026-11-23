// One-off: build src/data/districts.json (MET Malaysia district ids + approximate centroid + state).
// 1 call to data.gov.my for the list, then Nominatim at ≤1 req/s (its usage policy), cached in
// scripts/.districts-cache.json so a re-run only asks for what is missing. Not part of the build.
//   node scripts/record-districts.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'scripts', '.districts-cache.json');
const OUT = path.join(ROOT, 'src', 'data', 'districts.json');
const UA = 'RainCheck-build/1.0 (one-off district table)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Hand-checked centroids kept from the original 4-district table.
const FIXED = {
  Ds058: { lat: 3.14, lon: 101.69, state: 'Kuala Lumpur' },
  Ds060: { lat: 2.83, lon: 101.55, state: 'Selangor' },
  Ds062: { lat: 2.93, lon: 101.69, state: 'Putrajaya' },
  Ds064: { lat: 2.82, lon: 101.72, state: 'Selangor' },
};

const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const listRes = await fetch(`https://api.data.gov.my/weather/forecast/?contains=Ds@location__location_id&filter=${today}@date&limit=500`, { headers: { 'User-Agent': UA } });
const rows = await listRes.json();
const list = new Map();
for (const r of rows) list.set(r.location.location_id, r.location.location_name);
console.log(`${list.size} districts`);

const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const stateOf = (a) => a?.state ?? a?.territory ?? a?.city ?? '';

async function geocode(name) {
  const q = new URLSearchParams({ q: name, countrycodes: 'my', format: 'jsonv2', addressdetails: '1', limit: '6' });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${q}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const hits = await res.json();
  // Prefer administrative boundaries (district / state level), then any place.
  const score = (h) => (h.category === 'boundary' && h.type === 'administrative' ? 3 : 0) + (h.addresstype === 'district' || h.addresstype === 'county' ? 2 : 0) + (h.category === 'place' ? 1 : 0);
  hits.sort((a, b) => score(b) - score(a) || b.importance - a.importance);
  const h = hits[0];
  return h ? { lat: Math.round(Number(h.lat) * 1e3) / 1e3, lon: Math.round(Number(h.lon) * 1e3) / 1e3, state: stateOf(h.address), how: `${h.category}/${h.type}/${h.addresstype}` } : null;
}

for (const [id, name] of list) {
  if (FIXED[id] || cache[id]) continue;
  try {
    cache[id] = (await geocode(name)) ?? { miss: true };
    console.log(id, name, JSON.stringify(cache[id]));
  } catch (e) {
    console.log(id, name, 'ERR', e.message);
  }
  writeFileSync(CACHE, JSON.stringify(cache, null, 1));
  await sleep(1200);
}

const out = [];
for (const [id, name] of list) {
  const g = FIXED[id] ?? cache[id];
  if (!g || g.miss || !(g.lat >= 0 && g.lat <= 8 && g.lon >= 99 && g.lon <= 120)) {
    console.log('SKIP (no usable location):', id, name);
    continue;
  }
  out.push({ id, name, lat: g.lat, lon: g.lon, state: g.state || '' });
}
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 0).replace(/},{/g, '},\n{') + '\n');
console.log(`wrote ${out.length} districts to ${path.relative(ROOT, OUT)}`);
