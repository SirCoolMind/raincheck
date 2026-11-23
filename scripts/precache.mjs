// Post-build: list dist/assets/* into dist/sw.js so the whole shell (incl. lazy MapLibre chunk,
// fonts, CSS) is available offline from first install, and version the cache by content hash.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const out = process.argv[2] || 'dist';
const sw = `${out}/sw.js`;
if (!existsSync(sw)) process.exit(0);
// Third-party bundles (MapLibre) carry a sourceMappingURL to a map we don't ship: strip it.
for (const f of readdirSync(`${out}/assets`).filter((x) => x.endsWith('.js'))) {
  const p = `${out}/assets/${f}`;
  const js = readFileSync(p, 'utf8');
  const cleaned = js.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n');
  if (cleaned !== js) writeFileSync(p, cleaned);
}
const assets = readdirSync(`${out}/assets`).filter((f) => !f.endsWith('.map')).map((f) => `/assets/${f}`).sort();
const hash = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 10);
let src = readFileSync(sw, 'utf8');
src = src.replace('const ASSETS = []; /* __PRECACHE__ */', `const ASSETS = ${JSON.stringify(assets)};`);
src = src.replace("'raincheck-shell-v1'", `'raincheck-shell-${hash}'`);
writeFileSync(sw, src);
console.log(`precache: ${assets.length} assets, cache raincheck-shell-${hash}`);
