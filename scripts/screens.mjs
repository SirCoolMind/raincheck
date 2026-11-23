// Screenshot harness: node scripts/screens.mjs <round> [baseUrl]
// Writes docs/screens/round-<round>/<state>-<width>-<theme>.png (viewport shots, mocked network, fixed clock).
// Assumes `vite preview` is serving the e2e build on baseUrl; if unreachable it builds (--mode e2e) and starts one.
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installMocks, SCENARIOS, TEST_NOW } from '../tests/e2e/mock-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const round = process.argv[2];
if (!round) {
  console.error('usage: node scripts/screens.mjs <round> [baseUrl]');
  process.exit(2);
}
const baseUrl = (process.argv[3] ?? 'http://127.0.0.1:4174').replace(/\/$/, '');
const outDir = path.join(ROOT, 'docs', 'screens', `round-${round}`);
mkdirSync(outDir, { recursive: true });

const VIEWPORTS = [
  { width: 375, height: 812, mobile: true },
  { width: 412, height: 915, mobile: true },
  { width: 1440, height: 900, mobile: false },
];
const THEMES = ['light', 'dark'];
const STATES = ['loading', 'dry', 'rain-at-mex', 'heavy', 'one-source-failed', 'all-failed', 'offline', 'waypoint-edit'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reachable() {
  try {
    const r = await fetch(baseUrl + '/', { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

let server = null;
async function ensureServer() {
  if (await reachable()) return;
  console.log('preview server not reachable: building (--mode e2e) and starting vite preview…');
  const shell = process.platform === 'win32';
  const b = spawnSync('npx', ['vite', 'build', '--mode', 'e2e'], { cwd: ROOT, stdio: 'inherit', shell });
  if (b.status !== 0) throw new Error('vite build failed');
  const port = new URL(baseUrl).port || '4174';
  server = spawn('npx', ['vite', 'preview', '--port', port, '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', shell });
  for (let i = 0; i < 60; i++) {
    if (await reachable()) return;
    await sleep(500);
  }
  throw new Error('preview server did not start');
}

const readyState = (page) => page.waitForFunction(() => typeof window.__raincheck === 'function' && window.__raincheck().phase === 'ready' && window.__raincheck().evals.length > 0, undefined, { timeout: 25_000 });
// Also wait for MapLibre to paint the route (#map[data-ready]); tolerate a slow map so a shot is still taken.
const ready = async (page) => {
  await readyState(page);
  await page.waitForSelector('#map[data-ready="1"]', { timeout: 15_000 }).catch(() => {});
};

async function shoot(browser, state, vp, theme) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.mobile ? 2 : 1,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    colorScheme: theme,
    reducedMotion: state === 'loading' ? 'no-preference' : 'reduce',
    serviceWorkers: 'block',
  });
  const page = await ctx.newPage();
  const file = path.join(outDir, `${state}-${vp.width}-${theme}.png`);
  try {
    const scenario = state === 'dry' ? SCENARIOS.dry : state === 'heavy' ? SCENARIOS.heavy : SCENARIOS.rainAtMexTimed;
    const failSources = state === 'one-source-failed' ? ['openmeteo'] : state === 'all-failed' ? ['openmeteo', 'metno'] : [];
    const ctl = await installMocks(page, scenario, { failSources, delayMs: state === 'loading' ? 60_000 : 0 });
    await page.clock.install({ time: new Date(TEST_NOW) });
    await page.goto(baseUrl + '/');

    if (state === 'loading') {
      await page.waitForSelector('#answer[aria-busy="true"]', { timeout: 10_000 });
      await sleep(150); // fonts + first paint, but still loading
    } else if (state === 'all-failed') {
      await page.waitForFunction(() => window.__raincheck().phase === 'error', undefined, { timeout: 30_000 });
      await sleep(700);
    } else {
      await ready(page);
      if (state === 'offline') {
        await sleep(800); // let the last result persist to IndexedDB
        ctl.setOffline(true);
        await ctx.setOffline(true);
        // Same mechanism as e2e spec 8: try an offline reload (service worker is blocked here, so the shell cannot
        // be served); the app's own Refresh button is the path that works.
        await page.getByRole('button', { name: 'Refresh forecast' }).click();
        await ready(page);
        await page.waitForSelector('#answer .badge');
      } else if (state === 'waypoint-edit') {
        await page.locator('#edit-route').click();
        await page.waitForSelector('.mk.editing', { timeout: 15_000 });
        await page.locator('#route').scrollIntoViewIfNeeded();
      }
      await sleep(900);
    }
    await page.screenshot({ path: file });
    // Phones: a second shot with the sheet expanded and scrolled to the best-time / calendar section.
    if (vp.mobile && (state === 'rain-at-mex' || state === 'heavy')) {
      await page.locator('.handle').click();
      await sleep(500);
      await page.evaluate(() => {
        const sc = document.querySelector('.sheet-scroll');
        const b = document.getElementById('best');
        if (sc && b) sc.scrollTop = b.offsetTop - sc.offsetTop;
      });
      await sleep(400);
      await page.screenshot({ path: file.replace('.png', '-sheet.png') });
    }
    return file;
  } finally {
    await ctx.close();
  }
}

await ensureServer();
const browser = await chromium.launch();
const jobs = [];
for (const state of STATES) for (const vp of VIEWPORTS) for (const theme of THEMES) jobs.push([state, vp, theme]);

const written = [];
const failures = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const [state, vp, theme] = jobs[next++];
    try {
      written.push(await shoot(browser, state, vp, theme));
    } catch (e) {
      failures.push(`${state}-${vp.width}-${theme}: ${String(e.message).split('\n')[0]}`);
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
await browser.close();
if (server) server.kill();

written.sort();
for (const f of written) console.log(path.relative(ROOT, f));
console.log(`\n${written.length} of ${jobs.length} screenshots written to ${path.relative(ROOT, outDir)}`);
if (failures.length) {
  console.error('FAILED:\n' + failures.join('\n'));
  process.exit(1);
}
