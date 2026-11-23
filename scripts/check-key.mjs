// Greps tracked files and dist/ for the CARTO key value. Prints only found / not found.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const keyFile = 'carto_api_key.txt';
if (!existsSync(keyFile)) { console.log('[check-key] no key file; nothing to check'); process.exit(0); }
const key = readFileSync(keyFile, 'utf8').trim();
const hits = [];
const scan = (path) => { try { if (readFileSync(path, 'utf8').includes(key)) hits.push(path); } catch { /* binary */ } };
let tracked = [];
try { tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { /* no git */ }
tracked.filter((f) => f !== keyFile && existsSync(f)).forEach(scan);
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : scan(p); } };
if (existsSync('dist')) walk('dist');
if (hits.length) { console.log(`[check-key] FOUND in ${hits.length} file(s): ${hits.join(', ')}`); process.exit(process.env.ALLOW_BUNDLED_KEY ? 0 : 1); }
console.log('[check-key] CARTO key: not found in tracked files or dist/');
