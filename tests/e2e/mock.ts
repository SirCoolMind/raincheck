// Test-side helpers: mocks (generated in mock-core.mjs), fixed clock, state snapshot, ready-wait.
import type { Page } from '@playwright/test';
// @ts-expect-error plain-JS sibling shared with scripts/screens.mjs
import * as core from './mock-core.mjs';

export type FailSource = 'openmeteo' | 'metno' | 'metmy' | 'radar' | 'osrm' | 'all';
export interface MockOpts {
  failSources?: FailSource[];
  /** Delay (ms) applied to the Open-Meteo response. */
  delayMs?: number;
  /** false = first visit (nothing stored). Default: the test commute is saved as a returning user's route. */
  seed?: boolean;
}
export interface Scenario {
  name: string;
  mmh: (lat: number, lon: number, ms: number, model: string) => number;
  radarWet?: boolean;
}
export interface MockCtl {
  counts: { openmeteo: number; metno: number; metmy: number; rainviewer: number; osrm: number; tiles: number; weather: number };
  fail: Set<string>;
  setFail(list: FailSource[]): void;
  setOffline(v: boolean): void;
  resetCounts(): void;
  urls: string[];
}

export const SCENARIOS = core.SCENARIOS as Record<'dry' | 'rainAtMex' | 'heavy' | 'lateRain', Scenario>;
export const TEST_NOW: string = core.TEST_NOW;
export const installMocks = core.installMocks as (page: Page, scenario: Scenario, opts?: MockOpts) => Promise<MockCtl>;

export interface Snap {
  phase: string;
  selected: number | null;
  presetId: string;
  departMs: number;
  baseMs: number;
  offline: boolean;
  fromStore: boolean;
  editing: boolean;
  error: string | null;
  waypoints: { id: string; name: string; lat: number; lon: number }[];
  sentence: string | null;
  level: string | null;
  places: string[];
  levels: string[];
  bestMs: number | null;
  health: { id: string; state: string; reason: string }[];
}

export function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const s = (window as any).__raincheck();
    return {
      phase: s.phase,
      selected: s.selected,
      presetId: s.presetId,
      departMs: s.departMs,
      baseMs: s.baseMs,
      offline: s.offline,
      fromStore: s.fromStore,
      editing: s.editing,
      error: s.error,
      waypoints: s.stops.map((w: any) => ({ id: w.id, name: w.name, lat: w.lat, lon: w.lon })),
      sentence: s.summary?.sentence ?? null,
      level: s.summary?.level ?? null,
      places: s.evals.map((e: any) => e.stretch.place),
      levels: s.evals.map((e: any) => e.verdict.level),
      bestMs: s.best?.departMs ?? null,
      health: s.health.map((h: any) => ({ id: h.id, state: h.state, reason: h.reason })),
    };
  });
}

export async function waitPhase(page: Page, phase: 'ready' | 'error' | 'empty', timeout = 20_000): Promise<void> {
  await page.waitForFunction(
    (p) => typeof (window as any).__raincheck === 'function' && (window as any).__raincheck().phase === p,
    phase,
    { timeout },
  );
}

/** Wait until the evals (and the best-time scan) exist: phase 'ready' is set just before evaluate(). */
export async function waitReady(page: Page, timeout = 20_000): Promise<void> {
  await waitPhase(page, 'ready', timeout);
  await page.waitForFunction(() => (window as any).__raincheck().evals.length > 0, undefined, { timeout });
}

/** Fix the clock to Fri 2026-11-20 07:00 MYT (time keeps flowing), install mocks, open the app. */
export async function openApp(
  page: Page,
  scenario: Scenario,
  opts: MockOpts & { wait?: 'ready' | 'error' | 'none' } = {},
): Promise<MockCtl> {
  const ctl = await installMocks(page, scenario, opts);
  await page.clock.install({ time: new Date(TEST_NOW) });
  await page.goto('/');
  const wait = opts.wait ?? 'ready';
  if (wait === 'ready') await waitReady(page);
  else if (wait === 'error') await waitPhase(page, 'error');
  return ctl;
}

export const MYT_HHMM = (ms: number): string => {
  const d = new Date(ms + 8 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
