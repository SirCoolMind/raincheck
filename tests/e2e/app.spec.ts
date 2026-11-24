import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { SCENARIOS, openApp, snap, waitReady, waitPhase, MYT_HHMM } from './mock';

// The wet stretches are on the Maju Expressway (MEX). The app labels the wettest stretch by its road name, which
// OSRM returns as 'Lebuhraya Maju' (= MEX), or by the waypoint name 'MEX – ...'.
const MEX_RAIN = /(Possible )?[Rr]ain \d\d:\d\d–\d\d:\d\d near (MEX|Lebuhraya Maju)/;
const settle = (page: Page, ms = 400) => page.waitForTimeout(ms);
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

async function firstWetIdx(page: Page): Promise<number> {
  const s = await snap(page);
  const i = s.levels.findIndex((l) => l === 'rain' || l === 'heavy');
  expect(i, 'expected at least one wet stretch').toBeGreaterThanOrEqual(0);
  return i;
}

test.describe('RainCheck e2e', () => {
  test('1 load shows skeleton, then the correct answer (rain near MEX)', async ({ page }) => {
    await openApp(page, SCENARIOS.rainAtMex, { delayMs: 800, wait: 'none' });
    await expect(page.locator('#answer')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#answer .skel').first()).toBeVisible();
    await waitReady(page);
    await expect(page.locator('#answer')).not.toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#answer-sentence')).toHaveText(MEX_RAIN);
    await expect(page.locator('#strip .cell')).toHaveCount((await snap(page)).places.length);
    expect((await snap(page)).level).toBe('rain');
  });

  test('2 tapping a stretch selects it and opens the detail with 5 source rows', async ({ page }) => {
    await openApp(page, SCENARIOS.rainAtMex);
    const idx = await firstWetIdx(page);
    const cell = page.locator(`#strip .cell[data-idx="${idx}"]`);
    await cell.click();
    await expect(cell).toHaveAttribute('aria-pressed', 'true');
    await expect(cell).toHaveClass(/\bon\b/);
    const detail = page.locator('#detail');
    await expect(detail).toBeVisible();
    const rows = detail.locator('table.vals tbody tr');
    await expect(rows).toHaveCount(6); // 5 weather voters + radar
    for (let i = 0; i < 5; i++) await expect(rows.nth(i).locator('td').first()).toHaveText(/\d+(\.\d+)?\s*mm\/h|\d/);
    await expect(rows.nth(0)).toContainText(/ECMWF IFS/);
    await expect(rows.nth(4)).toContainText(/MET Norway/);
    expect((await snap(page)).selected).toBe(idx);
    // tapping again deselects
    await cell.click();
    expect((await snap(page)).selected).toBeNull();
    await page.mouse.move(2, 2); // detail also previews the hovered/focused cell, so move the pointer away
    await expect(detail).toBeHidden();
    expect((await snap(page)).selected).toBeNull();
  });

  test('3 scrubber re-evaluates locally with zero new weather requests', async ({ page }) => {
    const ctl = await openApp(page, SCENARIOS.lateRain);
    await settle(page, 600); // let radar sampling finish
    const before = await snap(page);
    expect(before.level).not.toBe('dry');
    const weather = () => { const { tiles: _t, ...rest } = ctl.counts; return rest; }; // radar tile sampling may still land
    const counts = weather();
    await page.locator('#scrub').evaluate((el: HTMLInputElement) => {
      el.value = '-60';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction((d) => (window as any).__raincheck().departMs !== d, before.departMs);
    const after = await snap(page);
    expect(after.departMs).toBe(before.departMs - 60 * 60_000);
    expect(after.sentence).not.toBe(before.sentence);
    expect(after.levels).not.toEqual(before.levels);
    await expect(page.locator('#answer-sentence')).toHaveText(after.sentence!);
    await settle(page, 600);
    expect(weather()).toEqual(counts);
  });

  test('4 Morning to Evening reverses route and place labels', async ({ page }) => {
    await openApp(page, SCENARIOS.rainAtMex);
    const places = page.locator('#journey .places span');
    const m0 = (await places.first().textContent()) ?? '';
    const mN = (await places.last().textContent()) ?? '';
    const morning = await snap(page);
    expect(m0).toBe('Cyberjaya');
    expect(mN).toBe('KLCC');
    await page.locator('.seg button[data-preset="evening"]').click();
    await waitReady(page);
    await expect(page.locator('.seg button[data-preset="evening"]')).toHaveAttribute('aria-pressed', 'true');
    const e0 = (await places.first().textContent()) ?? '';
    const eN = (await places.last().textContent()) ?? '';
    expect(e0).toBe(mN);
    expect(eN).toBe(m0);
    const evening = await snap(page);
    expect(evening.presetId).toBe('evening');
    expect(evening.places[0]).not.toBe(morning.places[0]);
    expect(evening.places[0]).toMatch(/KLCC|Kuchai|MEX|Jalan|Lorong/);
    // and back
    await page.locator('.seg button[data-preset="morning"]').click();
    await waitReady(page);
    expect((await snap(page)).places[0]).toBe(morning.places[0]);
  });

  test('5 best-time chip sets an earlier departure and updates the answer', async ({ page }) => {
    await openApp(page, SCENARIOS.lateRain);
    const before = await snap(page);
    const chip = page.locator('#best-chip');
    await expect(chip).toBeEnabled();
    const t = (await chip.locator('.best-time').textContent())!.trim();
    expect(t).toMatch(/^\d\d:\d\d$/);
    expect(t < MYT_HHMM(before.baseMs), `best ${t} should be earlier than ${MYT_HHMM(before.baseMs)}`).toBe(true);
    await chip.click();
    await page.waitForFunction((d) => (window as any).__raincheck().departMs !== d, before.departMs);
    const after = await snap(page);
    expect(MYT_HHMM(after.departMs)).toBe(t);
    expect(after.sentence).not.toBe(before.sentence);
    await expect(page.locator('#depart-clock')).toHaveText(t);
    await expect(chip).toHaveClass(/same/);
  });

  test('6 one failed source (Open-Meteo 500): chips show failed, verdict still renders', async ({ page }) => {
    await openApp(page, SCENARIOS.rainAtMex, { failSources: ['openmeteo'] });
    // Source health lives in Settings → Sources; the gear and the panel footer both flag the failure.
    await expect(page.locator('#settings-btn .gear-mark.failed')).toBeVisible();
    await expect(page.locator('#foot-sources')).toContainText(/failed/);
    await page.locator('#foot-sources').click();
    await expect(page.locator('#set-tab-sources')).toHaveAttribute('aria-selected', 'true');
    const failed = page.locator('.chip.failed');
    expect(await failed.count()).toBeGreaterThanOrEqual(1);
    await expect(page.locator('.chip.failed[data-source^="om_"]').first()).toBeVisible();
    await expect(page.locator('.chip[data-source="metno"]')).not.toHaveClass(/failed/);
    const s = await snap(page);
    expect(s.phase).toBe('ready');
    await expect(page.locator('#answer-sentence')).not.toHaveText(/Couldn.t get/);
    await expect(page.locator('#answer-sentence')).toHaveText(MEX_RAIN);
  });

  test('7 all sources fail: error state, then Try again recovers', async ({ page }) => {
    const ctl = await openApp(page, SCENARIOS.rainAtMex, { failSources: ['openmeteo', 'metno'], wait: 'error' });
    await expect(page.locator('#answer-sentence')).toHaveText('Couldn’t get the forecast');
    const retry = page.getByRole('button', { name: 'Try again' });
    await expect(retry).toBeVisible();
    ctl.setFail([]);
    await retry.click();
    await waitReady(page);
    await expect(page.locator('#answer-sentence')).toHaveText(MEX_RAIN);
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  });

  test('8 offline after first load shows the last result with an offline badge', async ({ page, context }) => {
    const ctl = await openApp(page, SCENARIOS.rainAtMex);
    await page.waitForFunction(() => (window as any).__raincheck().radarSamples !== null, undefined, { timeout: 5000 }).catch(() => undefined);
    await settle(page, 800); // let IndexedDB persist
    const online = await snap(page);
    await page.evaluate(() => navigator.serviceWorker?.ready.then(() => 0)).catch(() => undefined);
    ctl.setOffline(true); // mocks abort like a dead network (route.fulfill would otherwise still answer)
    await context.setOffline(true);
    let path = 'reload';
    try {
      await page.reload({ timeout: 10_000 });
      await waitReady(page, 15_000);
    } catch {
      path = 'refresh-button'; // shell not servable offline: use the app's own Refresh
      if (page.url() === 'about:blank' || page.url().startsWith('chrome-error')) throw new Error('page lost after offline reload');
      await page.getByRole('button', { name: 'Refresh forecast' }).click();
      await waitReady(page, 15_000);
    }
    test.info().annotations.push({ type: 'offline-path', description: path });
    await expect(page.locator('#answer .badge[role="status"]')).toHaveText(/Offline · forecast from \d\d:\d\d \((saved just now|\d+ (min|h) old)\)/);
    await expect(page.locator('#answer-sentence')).toHaveText(online.sentence!);
  });

  test('9 dragging the home marker re-routes; Undo restores the pins', async ({ page }) => {
    test.skip(!isDesktop(page), 'marker dragging with a mouse is only reliable on the desktop layout (the sheet covers the map on phones)');
    const ctl = await openApp(page, SCENARIOS.rainAtMex);
    const defaults = (await snap(page)).waypoints.map((w) => [w.lat, w.lon]);
    await page.locator('#edit-route').click();
    const mk = page.locator('.mk');
    await expect(mk.first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.mk.editing').first()).toBeVisible();
    await settle(page, 1500); // let the map's fit-to-route animation finish so the marker holds still
    const osrmBefore = ctl.counts.osrm;
    const box = (await mk.first().boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 20, y + 20, { steps: 5 });
    await page.mouse.move(x + 60, y + 30, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction(() => (window as any).__raincheck().stops[0].name.includes('(moved)'), undefined, { timeout: 10_000 });
    const moved = await snap(page);
    expect([moved.waypoints[0]!.lat, moved.waypoints[0]!.lon]).not.toEqual(defaults[0]);
    await waitReady(page);
    expect(ctl.counts.osrm).toBeGreaterThan(osrmBefore);
    await page.locator('#undo-route').click();
    await page.waitForFunction(() => !(window as any).__raincheck().stops[0].name.includes('(moved)'));
    const reset = await snap(page);
    expect(reset.waypoints.map((w) => [w.lat, w.lon])).toEqual(defaults);
    expect(reset.waypoints.map((w) => w.name)).toEqual(['Cyberjaya', 'Putrajaya', 'MEX – Putrajaya', 'MEX – Kuchai Lama', 'KLCC']);
  });

  test('10 keyboard only: arrows move selection, Enter/Space toggle, Escape clears, live region announces', async ({ page }) => {
    await openApp(page, SCENARIOS.rainAtMex);
    let landed = false;
    for (let i = 0; i < 40 && !landed; i++) {
      await page.keyboard.press('Tab');
      landed = await page.evaluate(() => document.activeElement?.classList.contains('cell') ?? false);
    }
    expect(landed, 'Tab should reach the first strip cell').toBe(true);
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.idx)).toBe('0');
    await page.keyboard.press('ArrowRight');
    expect((await snap(page)).selected).toBe(1);
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.idx)).toBe('1');
    await page.keyboard.press('ArrowRight');
    expect((await snap(page)).selected).toBe(2);
    await page.keyboard.press('Enter'); // toggles the selected cell off
    expect((await snap(page)).selected).toBeNull();
    await page.keyboard.press('Space'); // and on again
    expect((await snap(page)).selected).toBe(2);
    await expect(page.locator('#detail')).toBeVisible();
    await page.keyboard.press('Escape');
    expect((await snap(page)).selected).toBeNull();
    await page.evaluate(() => (document.activeElement as HTMLElement).blur()); // focus previews the detail too
    await expect(page.locator('#detail')).toBeHidden();
    const sentence = (await snap(page)).sentence!;
    await expect(page.locator('#answer-live')).toContainText(sentence, { timeout: 5000 });
    await expect(page.locator('#answer-live')).toHaveAttribute('aria-live', 'polite');
  });

  test.describe('11 axe (serious/critical)', () => {
    const SKIP = ['.maplibregl-canvas', '.maplibregl-ctrl'];
    async function audit(page: Page, label: string) {
      await settle(page, 700);
      const res = await new AxeBuilder({ page }).exclude(SKIP[0]!).exclude(SKIP[1]!).analyze();
      const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      const report = bad.map((v) => `${v.id} [${v.impact}] ${v.help}\n   ` + v.nodes.slice(0, 5).map((n) => n.target.join(' ')).join('\n   ')).join('\n');
      expect(bad.length, `axe violations in "${label}":\n${report}`).toBe(0);
    }
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
    });

    test('loaded (rain at MEX)', async ({ page }) => {
      await openApp(page, SCENARIOS.rainAtMex);
      await audit(page, 'loaded');
    });
    test('stretch detail open', async ({ page }) => {
      await openApp(page, SCENARIOS.rainAtMex);
      await page.locator(`#strip .cell[data-idx="${await firstWetIdx(page)}"]`).click();
      await expect(page.locator('#detail')).toBeVisible();
      await audit(page, 'detail open');
    });
    test('error state', async ({ page }) => {
      await openApp(page, SCENARIOS.rainAtMex, { failSources: ['openmeteo', 'metno'], wait: 'error' });
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
      await audit(page, 'error');
    });
    test('first-visit setup', async ({ page }) => {
      await openApp(page, SCENARIOS.rainAtMex, { seed: false, wait: 'none' });
      await waitPhase(page, 'empty');
      await audit(page, 'setup');
    });
    test('settings dialog', async ({ page }) => {
      await openApp(page, SCENARIOS.rainAtMex);
      await page.locator('#settings-btn').click();
      await expect(page.locator('#settings')).toBeVisible();
      await audit(page, 'settings general');
      await page.locator('#set-tab-trips').click();
      await audit(page, 'settings trips');
    });
    test('map menu + new trip form', async ({ page }) => {
      await openApp(page, SCENARIOS.rainAtMex);
      await page.locator('#trip-new').click();
      await expect(page.locator('#new-from')).toBeVisible();
      await audit(page, 'new trip form');
    });
    test('editing route', async ({ page }) => {
      await openApp(page, SCENARIOS.rainAtMex);
      await page.locator('#edit-route').click();
      await expect(page.locator('#edit-route')).toHaveAttribute('aria-pressed', 'true');
      await audit(page, 'editing');
    });
  });

  test('12 saves a screenshot baseline', async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page, SCENARIOS.rainAtMex);
    await settle(page, 800);
    mkdirSync('tests/e2e/baseline', { recursive: true });
    await page.screenshot({ path: `tests/e2e/baseline/${testInfo.project.name}-rain-at-mex.png` });
  });

  test('13 dry scenario says dry all the way', async ({ page }) => {
    await openApp(page, SCENARIOS.dry);
    await expect(page.locator('#answer-sentence')).toHaveText(/^Dry all the way/);
    expect((await snap(page)).level).toBe('dry');
  });

  test('14 heavy scenario (4 of 5 sources at 8 mm/h) says heavy rain', async ({ page }) => {
    await openApp(page, SCENARIOS.heavy);
    await expect(page.locator('#answer-sentence')).toHaveText(/^Heavy rain /);
    expect((await snap(page)).level).toBe('heavy');
  });

  test('15 first visit: setup card, then the example route gives an answer', async ({ page }) => {
    await openApp(page, SCENARIOS.rainAtMex, { seed: false, wait: 'none' });
    await waitPhase(page, 'empty');
    await expect(page.locator('#setup-title')).toHaveText('Where do you drive?');
    await expect(page.locator('#answer')).toBeHidden();
    await expect(page.locator('.band')).toContainText('No trip set up yet');
    await page.locator('#setup-example').click();
    await waitReady(page);
    await expect(page.locator('#setup')).toBeHidden();
    await expect(page.locator('#answer-sentence')).not.toBeEmpty();
    await expect(page.locator('.band')).toContainText('Example: Shah Alam → KLCC');
    // Evening mirrors it: no second setup needed.
    await page.locator('[data-preset="evening"]').click();
    await waitReady(page);
    expect((await snap(page)).waypoints.map((w) => w.name)).toEqual(['KLCC', 'Shah Alam']);
  });

  test('16 set up a trip by searching From and To; it survives a reload', async ({ page }) => {
    await openApp(page, SCENARIOS.rainAtMex, { seed: false, wait: 'none' });
    await waitPhase(page, 'empty');
    await page.locator('#setup-from').fill('Putrajaya');
    await page.locator('#setup-from-results [role=option]').first().click();
    await expect(page.locator('#setup-save')).toBeDisabled();
    await page.locator('#setup-to').fill('Putrajaya');
    await page.locator('#setup-to-results [role=option]').nth(1).click();
    await page.locator('#setup-time').fill('0645');
    await page.locator('#setup-time').blur();
    await page.locator('#setup-save').click();
    await waitReady(page);
    const s = await snap(page);
    expect(s.waypoints).toHaveLength(2);
    expect(s.waypoints[0]!.lat).toBeCloseTo(2.93844, 4);
    expect(s.waypoints[1]!.lat).toBeCloseTo(2.91797, 4);
    await page.reload();
    await waitReady(page);
    expect((await snap(page)).waypoints.map((w) => w.lat)).toEqual(s.waypoints.map((w) => w.lat));
    await expect(page.locator('#morning-time')).toHaveValue('06:45');
  });

  test('17 Custom can hold its own trip; a share link hands a trip to someone new', async ({ page, browser }) => {
    test.slow(); // several full app loads, each with a software-rendered map and radar preload
    await openApp(page, SCENARIOS.rainAtMex);
    await page.locator('[data-preset="custom"]').click();
    await waitReady(page);
    // + New trip opens the form in place; Custom keeps showing its current answer until the trip is saved.
    await page.locator('#trip-new').click();
    await expect(page.locator('#new-title')).toHaveText('New trip for Custom');
    await page.locator('#new-from').fill('Putrajaya');
    await page.locator('#new-from-results [role=option]').first().click();
    await page.locator('#new-to').fill('Putrajaya');
    await page.locator('#new-to-results [role=option]').nth(1).click();
    await page.locator('#new-name').fill('Gym run');
    await page.locator('#new-save').click();
    await waitReady(page);
    const custom = await page.evaluate(() => {
      const s = (window as any).__raincheck();
      return { n: s.stops.length, name: s.trips.trips.find((t: any) => t.id === s.trips.custom.tripId)?.name, morning: s.trips.morning.tripId };
    });
    expect(custom.n).toBe(2);
    expect(custom.name).toBe('Gym run');
    await expect(page.locator('#new-panel')).toBeHidden();
    await page.locator('[data-preset="morning"]').click();
    await waitReady(page);
    await page.locator('#trip-share').click();
    const url = await page.locator('#trip-share-url').inputValue();
    expect(url).toMatch(/#t=[A-Za-z0-9_-]+$/);

    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    await openApp(other, SCENARIOS.rainAtMex, { seed: false, wait: 'none' });
    await other.goto(url.replace(/^https?:\/\/[^/]+/, ''));
    await expect(other.locator('#shared-save')).toBeVisible();
    await other.locator('#shared-save').click();
    await waitReady(other);
    expect((await snap(other)).waypoints.map((w) => w.name)).toEqual(['Cyberjaya', 'Putrajaya', 'MEX – Putrajaya', 'MEX – Kuchai Lama', 'KLCC']);
    expect(other.url()).not.toContain('#t=');
    await ctx.close();
  });

  test('18 right-click the map adds a stop there; Escape closes the menu; Undo removes it', async ({ page }) => {
    test.skip(!isDesktop(page), 'right-click is a desktop gesture (phones use press and hold)');
    await openApp(page, SCENARIOS.rainAtMex);
    await page.waitForFunction(() => (window as any).__rcMap?.isReady?.() ?? document.querySelector('.maplibregl-canvas'), undefined, { timeout: 15_000 });
    await settle(page, 1500);
    const before = (await snap(page)).waypoints.length;
    const box = (await page.locator('#map').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.4, { button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Add a stop here' })).toBeFocused();
    await page.getByRole('menuitem', { name: 'Add a stop here' }).click();
    await page.waitForFunction((n) => (window as any).__raincheck().stops.length === n + 1, before);
    await expect(menu).toHaveCount(0);
    // Escape closes the menu without acting.
    await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.4, { button: 'right' });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.locator('#undo-route').click();
    await page.waitForFunction((n) => (window as any).__raincheck().stops.length === n, before);
  });
  test('19 feedback popup: sum check, validation, server error, then sends', async ({ page }) => {
    await openApp(page, SCENARIOS.rainAtMex);
    let posts = 0;
    let last: any = null;
    const api = { 'content-type': 'application/json', 'X-RainCheck-Api': '1' };
    await page.route('**/api/feedback.php*', async (r) => {
      if (r.request().method() === 'GET') return r.fulfill({ status: 200, headers: api, body: '{"q":"12 + 32","token":"t1"}' });
      posts++;
      last = r.request().postDataJSON();
      if (posts === 1) return r.fulfill({ status: 422, headers: api, body: '{"error":{"code":"wrong_answer","message":"That sum is not right. Try this one."},"challenge":{"q":"20 + 15","token":"t2"}}' });
      if (posts === 2) return r.fulfill({ status: 503, headers: api, body: '{"error":{"code":"not_configured","message":"Feedback is not set up on this server yet."}}' });
      return r.fulfill({ status: 200, headers: api, body: '{"ok":true}' });
    });
    await page.locator('#foot-feedback').evaluate((b) => (b as HTMLButtonElement).click());
    await expect(page.locator('#feedback')).toBeVisible();
    await expect(page.locator('#fb-message')).toBeFocused();
    await expect(page.locator('#fb-q')).toHaveText('12 + 32');
    await page.locator('#fb-send').click();
    await expect(page.locator('.fb-status')).toHaveText('Write a few words first.');
    await page.locator('label[for="fb-kind-problem"]').click();
    await page.locator('#fb-message').fill('Radar froze on frame 3');
    await page.locator('#fb-send').click();
    await expect(page.locator('.fb-status')).toHaveText('Answer the small sum first.');
    expect(posts).toBe(0);
    await page.locator('#fb-answer').fill('45');
    await page.locator('#fb-send').click();
    await expect(page.locator('.fb-status')).toHaveText('That sum is not right. Try this one.');
    await expect(page.locator('#fb-q')).toHaveText('20 + 15'); // fresh sum swapped in
    await expect(page.locator('#fb-answer')).toHaveValue('');
    await page.locator('#fb-answer').fill('35');
    await page.locator('#fb-send').click();
    await expect(page.locator('.fb-status')).toHaveText('Feedback is not set up on this server yet.');
    await expect(page.locator('#fb-message')).toHaveValue('Radar froze on frame 3'); // draft kept
    const res = await new AxeBuilder({ page }).include('#feedback').analyze();
    expect(res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
    await expect(page.locator('#fb-q')).toHaveText('12 + 32'); // the used sum was replaced
    await page.locator('#fb-answer').fill('44');
    await page.locator('#fb-send').click();
    await expect(page.locator('.fb-thanks')).toContainText('on its way');
    expect(last).toMatchObject({ kind: 'problem', message: 'Radar froze on frame 3', email: '', website: '', token: 't1', answer: '44' });
    await page.locator('#fb-close-done').click();
    await expect(page.locator('#feedback')).toBeHidden();
  });
});
