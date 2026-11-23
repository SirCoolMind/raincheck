// PURE verdict rules (RULE_VERSION v1).
import type { Level, Verdict, Vote } from './types';

export const RULE_VERSION = 'v1';
export const RAIN_MMH = 0.4;
export const HEAVY_MMH = 4;
export const RADAR_WINDOW_MIN = 90;
export const LEVEL_ORDER: readonly Level[] = ['nodata', 'dry', 'possible', 'rain', 'heavy'];

export function levelOf(mmh: number | null): Level | null {
  if (mmh === null) return null;
  if (mmh >= HEAVY_MMH) return 'heavy';
  if (mmh >= RAIN_MMH) return 'rain';
  return 'dry';
}

export function levelRank(level: Level): number {
  return LEVEL_ORDER.indexOf(level);
}

export function isWet(level: Level): boolean {
  return level === 'possible' || level === 'rain' || level === 'heavy';
}

export function bump(level: Level): Level {
  switch (level) {
    case 'nodata':
    case 'dry':
      return 'possible';
    case 'possible':
      return 'rain';
    default:
      return 'heavy';
  }
}

export function judge(votes: Vote[], radar: { wet: boolean | null; withinWindow: boolean }): Verdict {
  const vals = votes.map((v) => v.mmh).filter((m): m is number => m !== null);
  const total = vals.length;
  const wetCount = vals.filter((m) => m >= RAIN_MMH).length;
  const heavyCount = vals.filter((m) => m >= HEAVY_MMH).length;
  const dryCount = total - wetCount;

  let base: Level;
  let agree: number;
  if (total === 0) {
    base = 'nodata';
    agree = 0;
  } else if (wetCount === 0) {
    base = 'dry';
    agree = dryCount;
  } else if (wetCount * 2 < total) {
    base = 'possible';
    agree = wetCount;
  } else if (heavyCount * 2 > total) {
    base = 'heavy';
    agree = heavyCount;
  } else {
    base = 'rain';
    agree = wetCount;
  }

  let level = base;
  if (radar.withinWindow && radar.wet === true) level = bump(base);
  // After a bump the claim changes side (e.g. dry → possible): count the sources backing the NEW claim.
  if (level !== base) agree = level === 'heavy' ? heavyCount : wetCount;
  return {
    level,
    baseLevel: base,
    radarBumped: level !== base,
    agree,
    total,
    maxMmh: total ? Math.max(...vals) : null,
    votes,
  };
}
