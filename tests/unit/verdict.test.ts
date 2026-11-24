import { describe, it, expect } from 'vitest';
import type { Level, SourceId, Vote } from '../../src/core/types';
import {
  HEAVY_MMH,
  LEVEL_ORDER,
  LIGHT_MMH,
  RADAR_AREA_CLEAR_WINDOW_MIN,
  RADAR_CLEAR_WINDOW_MIN,
  RADAR_WINDOW_MIN,
  RAIN_MMH,
  RULE_VERSION,
  bump,
  isWet,
  judge,
  levelOf,
  levelRank,
  lower,
} from '../../src/core/verdict';

const votes = (...v: (number | null)[]): Vote[] => v.map((mmh, i) => ({ source: `s${i}` as SourceId, mmh, prob: null }));
const noRadar = { wet: null, withinWindow: false };

describe('constants / helpers', () => {
  it('constants', () => {
    expect(RULE_VERSION).toBe('v3');
    expect(RADAR_CLEAR_WINDOW_MIN).toBe(40);
    expect(RADAR_AREA_CLEAR_WINDOW_MIN).toBe(90);
    expect(RAIN_MMH).toBe(1);
    expect(LIGHT_MMH).toBe(0.4);
    expect(HEAVY_MMH).toBe(4);
    expect(RADAR_WINDOW_MIN).toBe(90);
    expect(LEVEL_ORDER).toEqual(['nodata', 'dry', 'possible', 'rain', 'heavy']);
  });
  it('levelOf boundaries', () => {
    expect(levelOf(null)).toBeNull();
    expect(levelOf(0)).toBe('dry');
    expect(levelOf(0.39)).toBe('dry');
    expect(levelOf(0.4)).toBe('possible');
    expect(levelOf(0.99)).toBe('possible');
    expect(levelOf(1)).toBe('rain');
    expect(levelOf(3.99)).toBe('rain');
    expect(levelOf(4.0)).toBe('heavy');
  });
  it('bump / isWet / levelRank', () => {
    expect(bump('nodata')).toBe('possible');
    expect(bump('dry')).toBe('possible');
    expect(bump('possible')).toBe('rain');
    expect(bump('rain')).toBe('heavy');
    expect(bump('heavy')).toBe('heavy');
    expect(isWet('dry')).toBe(false);
    expect(isWet('nodata')).toBe(false);
    expect(isWet('possible') && isWet('rain') && isWet('heavy')).toBe(true);
    expect(levelRank('nodata')).toBe(0);
    expect(levelRank('heavy')).toBe(4);
  });
});

describe('judge', () => {
  const table: [string, (number | null)[], Level, number, number][] = [
    ['all dry', [0, 0, 0, 0, 0, 0], 'dry', 6, 6],
    ['all null', [null, null, null], 'nodata', 0, 0],
    ['empty', [], 'nodata', 0, 0],
    ['single wet source', [1], 'rain', 1, 1],
    ['1 of 6 wet (outlier) stays dry', [1, 0, 0, 0, 0, 0], 'dry', 5, 6],
    ['2 of 6 wet', [1, 1, 0, 0, 0, 0], 'possible', 2, 6],
    ['3 of 6 wet (tie) is only possible', [1, 1, 1, 0, 0, 0], 'possible', 3, 6],
    ['4 of 6 wet', [1, 1, 1, 1, 0, 0], 'rain', 4, 6],
    ['3 of 6 heavy', [5, 5, 5, 0, 0, 0], 'possible', 3, 6],
    ['4 of 6 heavy', [5, 5, 5, 5, 0, 0], 'heavy', 4, 6],
    ['6 wet 3 heavy', [5, 5, 5, 1, 1, 1], 'rain', 6, 6],
    ['mixed nulls: 1 wet of 2 (tie)', [1, 0, null, null, null, null], 'dry', 1, 2],
    ['mixed nulls: 2 wet of 3', [1, 1, 0, null], 'rain', 2, 3],
    ['mixed nulls dry', [0, null, 0.1], 'dry', 2, 2],
    ['light drizzle from most sources is possible', [0.4, 0.8, 0.4, 0.8, 0, 0], 'possible', 4, 6],
    ['light drizzle from half is dry', [0.4, 0.8, 0.4, 0, 0, 0], 'dry', 3, 6],
    ['the 24 Nov morning: 2 wet, 2 light, 2 dry', [1.2, 0.4, 2, 0, 0.8, 0], 'possible', 4, 6],
    ['0.99 alone is light → possible', [0.99], 'possible', 1, 1],
    ['0.39 is dry', [0.39], 'dry', 1, 1],
    ['4.0 is heavy', [4.0], 'heavy', 1, 1],
  ];
  it.each(table)('%s', (_n, vals, level, agree, total) => {
    const v = judge(votes(...vals), noRadar);
    expect(v.level).toBe(level);
    expect(v.baseLevel).toBe(level);
    expect(v.radarBumped).toBe(false);
    expect(v.agree).toBe(agree);
    expect(v.total).toBe(total);
  });
  it('maxMmh', () => {
    expect(judge(votes(0.1, null, 2.5), noRadar).maxMmh).toBe(2.5);
    expect(judge(votes(null), noRadar).maxMmh).toBeNull();
  });
  it('keeps votes', () => {
    const vs = votes(1, 2);
    expect(judge(vs, noRadar).votes).toBe(vs);
  });
  it('radar bump raises one level in window', () => {
    const r = { wet: true, withinWindow: true };
    const cases: [(number | null)[], Level, Level, boolean][] = [
      [[null], 'nodata', 'possible', true],
      [[0], 'dry', 'possible', true],
      [[1, 1, 0, 0], 'possible', 'rain', true],
      [[1, 1], 'rain', 'heavy', true],
      [[5, 5], 'heavy', 'heavy', false],
    ];
    for (const [vals, base, level, bumped] of cases) {
      const v = judge(votes(...vals), r);
      expect(v.baseLevel).toBe(base);
      expect(v.level).toBe(level);
      expect(v.radarBumped).toBe(bumped);
    }
  });
  it('no bump outside window, with dry radar, or unknown radar', () => {
    expect(judge(votes(0), { wet: true, withinWindow: false }).level).toBe('dry');
    expect(judge(votes(0), { wet: false, withinWindow: true }).level).toBe('dry');
    expect(judge(votes(0), { wet: null, withinWindow: true }).level).toBe('dry');
  });
  it('agree after a bump counts sources backing the bumped claim', () => {
    const v = judge(votes(0, 0, 0), { wet: true, withinWindow: true });
    expect(v.level).toBe('possible');
    expect(v.agree).toBe(0); // 0/3 sources see rain; the radar raised it
    const h = judge(votes(5, 5, 1, 1, 0), { wet: true, withinWindow: true });
    expect(h.baseLevel).toBe('rain');
    expect(h.level).toBe('heavy');
    expect(h.agree).toBe(2);
  });
});

describe('clear radar lowers near-term stretches (rule v2)', () => {
  const clear = (recentWet: boolean | null = false, withinClearWindow = true) => ({ wet: false, withinWindow: true, clear: true, recentWet, withinClearWindow });
  it('lower is the opposite of bump', () => {
    expect(lower('heavy')).toBe('rain');
    expect(lower('rain')).toBe('possible');
    expect(lower('possible')).toBe('dry');
    expect(lower('dry')).toBe('dry');
    expect(lower('nodata')).toBe('nodata');
  });
  it('models say rain, radar clear now → one level drier, sources backing the new claim', () => {
    const v = judge(votes(1, 1, 1, 0), clear());
    expect(v.baseLevel).toBe('rain');
    expect(v.level).toBe('possible');
    expect(v.radarLowered).toBe(true);
    expect(v.radarBumped).toBe(false);
    expect(v.justEnded).toBe(false);
    expect(v.agree).toBe(3);
    const p = judge(votes(1, 1, 0, 0), clear());
    expect(p.baseLevel).toBe('possible');
    expect(p.level).toBe('dry');
    expect(p.agree).toBe(2);
  });
  it('rained in the last hour, clear now → just ended', () => {
    const v = judge(votes(1, 1), clear(true));
    expect(v.level).toBe('possible');
    expect(v.justEnded).toBe(true);
    // models already dry: nothing to lower, but the wet-road note still applies
    const d = judge(votes(0, 0), clear(true));
    expect(d.level).toBe('dry');
    expect(d.radarLowered).toBe(false);
    expect(d.justEnded).toBe(true);
  });
  it('no lowering outside the window, with unknown or wet radar', () => {
    expect(judge(votes(1, 1), clear(false, false)).level).toBe('rain');
    expect(judge(votes(1, 1), { wet: false, withinWindow: true, clear: null, withinClearWindow: true }).level).toBe('rain');
    expect(judge(votes(1, 1), { wet: false, withinWindow: true, clear: false, withinClearWindow: true }).level).toBe('rain');
    // rain at the point now still raises, never lowers
    const b = judge(votes(1, 1), { wet: true, withinWindow: true, clear: false, withinClearWindow: true });
    expect(b.level).toBe('heavy');
    expect(b.radarLowered).toBe(false);
  });
});

describe('wide-area clear radar (rule v3)', () => {
  const area = (within = true, clear: boolean | null = true) => ({ wet: false, withinWindow: true, clear, recentWet: true, withinClearWindow: false, areaClear: true, withinAreaClearWindow: within });
  it('nothing within ~30 km lowers stretches up to 90 min ahead, one level only', () => {
    const v = judge(votes(1, 1, 1, 1, 0, 0), area());
    expect(v.baseLevel).toBe('rain');
    expect(v.level).toBe('possible');
    expect(v.radarLowered).toBe(true);
    expect(v.justEnded).toBe(true);
    expect(judge(votes(5, 5, 5, 5), area()).level).toBe('rain');
  });
  it('not beyond the window, not when the area has rain, not when the point itself is wet', () => {
    expect(judge(votes(1, 1, 1, 1), area(false)).level).toBe('rain');
    expect(judge(votes(1, 1, 1, 1), { ...area(), areaClear: false }).level).toBe('rain');
    expect(judge(votes(1, 1, 1, 1), { ...area(), areaClear: null }).level).toBe('rain');
    expect(judge(votes(1, 1, 1, 1), area(true, false)).level).toBe('rain');
    expect(judge(votes(1, 1, 1, 1), { ...area(), wet: true }).level).toBe('heavy');
  });
});
