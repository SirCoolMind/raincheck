import { describe, it, expect } from 'vitest';
import { summarize, levelLabel, levelWord } from '../../src/core/summary';
import { parseMytLocal } from '../../src/core/timing';
import type { Level, Stretch, StretchEval } from '../../src/core/types';

const MIN = 60_000;
const t0 = parseMytLocal('2026-11-19T08:00');

function mk(levels: Level[], opts: { mm?: Record<number, number>; ratio?: Record<number, [number, number]> } = {}): StretchEval[] {
  return levels.map((level, i) => {
    const stretch = { index: i, startOffsetMin: i * 5, endOffsetMin: i * 5 + 5, place: `P${i}` } as unknown as Stretch;
    const [agree, total] = opts.ratio?.[i] ?? (level === 'nodata' ? [0, 0] : [6, 6]);
    return {
      stretch,
      eta: { startMs: t0 + i * 5 * MIN, endMs: t0 + (i * 5 + 5) * MIN, midMs: t0 + (i * 5 + 2.5) * MIN },
      verdict: {
        level,
        baseLevel: level,
        radarBumped: false,
        agree,
        total,
        maxMmh: level === 'nodata' ? null : (opts.mm?.[i] ?? 0),
        votes: [],
      },
    };
  });
}

describe('words and labels', () => {
  it('maps', () => {
    expect(levelWord('heavy')).toBe('heavy rain');
    expect(levelWord('rain')).toBe('rain');
    expect(levelWord('possible')).toBe('possible rain');
    expect(levelWord('dry')).toBe('dry');
    expect(levelWord('nodata')).toBe('no data');
    expect(levelLabel('heavy')).toBe('Heavy');
    expect(levelLabel('rain')).toBe('Rain');
    expect(levelLabel('possible')).toBe('Possible');
    expect(levelLabel('dry')).toBe('Dry');
    expect(levelLabel('nodata')).toBe('No data');
  });
});

describe('summarize', () => {
  it('all dry', () => {
    const s = summarize(mk(['dry', 'dry', 'dry'], { ratio: { 1: [4, 6] } }));
    expect(s.level).toBe('dry');
    expect(s.sentence).toBe('Dry all the way, 08:00–08:15');
    expect(s.detail).toBe('');
    expect(s.windows).toEqual([]);
    expect([s.agree, s.total]).toEqual([4, 6]);
  });
  it('dry with partial nodata', () => {
    const s = summarize(mk(['dry', 'nodata', 'dry', 'nodata']));
    expect(s.level).toBe('dry');
    expect(s.detail).toBe('No data for 2 of 4 stretches');
  });
  it('all nodata', () => {
    const s = summarize(mk(['nodata', 'nodata']));
    expect(s.level).toBe('nodata');
    expect(s.sentence).toBe('No forecast data for this trip');
    expect([s.agree, s.total]).toEqual([0, 0]);
  });
  it('groups neighbouring wet stretches and takes max level', () => {
    const s = summarize(mk(['dry', 'possible', 'rain', 'possible', 'dry', 'dry'], { mm: { 2: 1 } }));
    expect(s.windows).toHaveLength(1);
    const w = s.windows[0]!;
    expect([w.fromIdx, w.toIdx, w.level]).toEqual([1, 3, 'rain']);
    expect(w.startMs).toBe(t0 + 5 * MIN);
    expect(w.endMs).toBe(t0 + 20 * MIN);
    expect(s.sentence).toBe('Rain 08:05–08:20 near P2');
  });
  it('place = wettest stretch (tie -> first)', () => {
    const levels: Level[] = ['rain', 'rain', 'rain', 'dry', 'dry'];
    expect(summarize(mk(levels, { mm: { 0: 1, 1: 3, 2: 3 } })).sentence).toContain('near P1');
    expect(summarize(mk(levels, { mm: { 0: 1, 1: 1, 2: 1 } })).sentence).toContain('near P0');
  });
  it('whole-route and most-of-route rain name the span, not a place', () => {
    const all = summarize(mk(['heavy', 'heavy', 'heavy', 'heavy', 'heavy']));
    expect(all.sentence).toBe('Heavy rain the whole drive');
    expect(all.detail).toBe('08:00–08:25');
    const most = summarize(mk(['dry', 'rain', 'rain', 'rain', 'rain']));
    expect(most.sentence).toBe('Rain most of the drive');
  });
  it('heavy / rain / possible wording', () => {
    expect(summarize(mk(['dry', 'heavy'])).sentence).toBe('Heavy rain 08:05–08:10 near P1');
    expect(summarize(mk(['rain', 'dry'])).sentence).toBe('Rain 08:00–08:05 near P0');
    expect(summarize(mk(['dry', 'possible'])).sentence).toBe('Possible rain 08:05–08:10 near P1');
  });
  it('headline = highest level, tie earliest; Also ... (+m more)', () => {
    const s = summarize(mk(['possible', 'dry', 'rain', 'dry', 'rain', 'dry', 'possible']));
    expect(s.windows).toHaveLength(4);
    expect(s.sentence).toBe('Rain 08:10–08:15 near P2');
    expect(s.detail).toBe('Also possible rain 08:00 near P0 (+2 more)');
  });
  it('single other window', () => {
    const s = summarize(mk(['rain', 'dry', 'possible']));
    expect(s.detail).toBe('Also possible rain 08:10 near P2');
  });
  it('agree/total from the headline window wettest stretch', () => {
    const s = summarize(mk(['rain', 'rain'], { mm: { 1: 2 }, ratio: { 0: [3, 6], 1: [5, 6] } }));
    expect([s.agree, s.total]).toEqual([5, 6]);
  });
});
