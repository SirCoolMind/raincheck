// Perf probe (not part of the normal suite: run with PERF=1). Slow CPU, CPU profile, long tasks, per phase.
import { test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { SCENARIOS, installMocks, TEST_NOW, waitReady } from './mock';

test.skip(!process.env.PERF, 'set PERF=1');

test('perf probe', async ({ page }) => {
  test.setTimeout(240_000);
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message, (e.stack ?? '').split('\n').slice(0, 4).join(' | ')));
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU ?? 6) });
  await page.addInitScript(() => {
    (window as unknown as { __lt: { s: number; d: number }[] }).__lt = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) (window as unknown as { __lt: { s: number; d: number }[] }).__lt.push({ s: Math.round(e.startTime), d: Math.round(e.duration) });
    }).observe({ type: 'longtask', buffered: true });
  });
  await installMocks(page, SCENARIOS.rainAtMex);
  await page.clock.install({ time: new Date(TEST_NOW) });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  const t0 = Date.now();
  await page.goto('/');
  await waitReady(page);
  const tReady = Date.now() - t0;
  await page.waitForTimeout(6000); // radar sampling, map tiles, idle work
  const mark = async (label: string) => {
    const lt = await page.evaluate(() => (window as unknown as { __lt: { s: number; d: number }[] }).__lt.splice(0));
    const tbt = lt.reduce((a, x) => a + Math.max(0, x.d - 50), 0);
    console.log(`${label}: longtasks=${lt.length} max=${Math.max(0, ...lt.map((x) => x.d))}ms TBT=${tbt}ms  ${lt.map((x) => x.d).join(',')}`);
  };
  console.log(`ready after ${tReady} ms`);
  await mark('load+6s');
  // Scrub the departure slider
  const slider = page.locator('input[type=range]').first();
  if (await slider.count()) {
    await slider.focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(1500);
    await mark('scrub x12');
  }
  // Radar play
  const play = page.getByRole('button', { name: /play/i }).first();
  if (await play.count()) {
    await play.click().catch(() => undefined);
    await page.waitForTimeout(5000);
    await mark('radar play 5s');
  }
  const { profile } = await cdp.send('Profiler.stop');
  // Aggregate self time by function
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map<number, number>();
  const dt = profile.timeDeltas ?? [];
  (profile.samples ?? []).forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (dt[i] ?? 0)));
  const agg = new Map<string, number>();
  for (const [id, us] of self) {
    const cf = byId.get(id)!.callFrame;
    const file = cf.url.split('/').pop() || '(native)';
    const k = `${cf.functionName || '(anon)'} @ ${file}:${cf.lineNumber + 1}`;
    agg.set(k, (agg.get(k) ?? 0) + us);
  }
  const top = [...agg].sort((a, b) => b[1] - a[1]).slice(0, 40);
  const out = top.map(([k, us]) => `${(us / 1000).toFixed(0).padStart(6)} ms  ${k}`).join('\n');
  console.log(out);
  writeFileSync(process.env.PERF_OUT ?? 'perf-profile.json', JSON.stringify(profile));
});
