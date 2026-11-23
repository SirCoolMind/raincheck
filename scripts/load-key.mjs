// Reads carto_api_key.txt into .env.development.local (dev mode only, never read by production builds) as VITE_CARTO_API_KEY.
// Never prints the key. Safe to run repeatedly.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const src = new URL('../carto_api_key.txt', import.meta.url);
const dst = new URL('../.env.development.local', import.meta.url);
if (!existsSync(src)) {
  console.log('[load-key] carto_api_key.txt not found: map will fall back to OSM raster tiles.');
  process.exit(0);
}
const key = readFileSync(src, 'utf8').trim();
if (!/^[A-Za-z0-9._-]{8,200}$/.test(key)) {
  console.log('[load-key] the CARTO key file looks malformed; skipping.');
  process.exit(0);
}
let lines = existsSync(dst) ? readFileSync(dst, 'utf8').split(/\r?\n/) : [];
lines = lines.filter((l) => l && !l.startsWith('VITE_CARTO_API_KEY='));
lines.push(`VITE_CARTO_API_KEY=${key}`);
writeFileSync(dst, lines.join('\n') + '\n');
console.log('[load-key] the CARTO key was written to .env.development.local (value not shown).');
