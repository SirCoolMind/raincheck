// PURE verdict rules (RULE_VERSION v3: 1 mm/h for a wet vote, strict majority for Rain, wide-area clear radar).
import type { Level, Verdict, Vote } from './types';

export const RULE_VERSION = 'v3';
/** A source votes wet at this rate. 0.1 mm per 15 min (0.4 mm/h) is the smallest step the models report and they
 *  smear it over whole grid cells in the tropics, so it is only "light" (it can make a stretch Possible, not Rain). */
export const RAIN_MMH = 1;
export const LIGHT_MMH = 0.4;
export const HEAVY_MMH = 4;
export const RADAR_WINDOW_MIN = 90;
/** Clear radar may lower a stretch only this soon: showers can form or drift in after that. */
export const RADAR_CLEAR_WINDOW_MIN = 40;
/** No echo anywhere within ~30 km of the route: nothing can drift in quickly, so lowering reaches further ahead. */
export const RADAR_AREA_CLEAR_WINDOW_MIN = 90;
export const LEVEL_ORDER: readonly Level[] = ['nodata', 'dry', 'possible', 'rain', 'heavy'];

export function levelOf(mmh: number | null): Level | null {
  if (mmh === null) return null;
  if (mmh >= HEAVY_MMH) return 'heavy';
  if (mmh >= RAIN_MMH) return 'rain';
  if (mmh >= LIGHT_MMH) return 'possible';
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

/** One level drier (the opposite of bump). */
export function lower(level: Level): Level {
  switch (level) {
    case 'heavy':
      return 'rain';
    case 'rain':
      return 'possible';
    case 'possible':
      return 'dry';
    default:
      return level;
  }
}

export interface RadarInput {
  /** Latest frame shows rain at the stretch. */
  wet: boolean | null;
  /** ETA within RADAR_WINDOW_MIN: radar may raise. */
  withinWindow: boolean;
  /** Latest frame shows no rain anywhere within ~4 km of the stretch. */
  clear?: boolean | null;
  /** Radar showed rain near the stretch in the hour before the latest frame. */
  recentWet?: boolean | null;
  /** ETA within RADAR_CLEAR_WINDOW_MIN: clear radar may lower. */
  withinClearWindow?: boolean;
  /** Latest frame shows no rain anywhere around the route (~30 km). */
  areaClear?: boolean | null;
  /** ETA within RADAR_AREA_CLEAR_WINDOW_MIN. */
  withinAreaClearWindow?: boolean;
}

export function judge(votes: Vote[], radar: RadarInput): Verdict {
  const vals = votes.map((v) => v.mmh).filter((m): m is number => m !== null);
  const total = vals.length;
  const wetCount = vals.filter((m) => m >= RAIN_MMH).length;
  const lightCount = vals.filter((m) => m >= LIGHT_MMH).length; // light or more
  const heavyCount = vals.filter((m) => m >= HEAVY_MMH).length;
  const dryCount = total - lightCount;

  let base: Level;
  let agree: number;
  if (total === 0) {
    base = 'nodata';
    agree = 0;
  } else if (heavyCount * 2 > total) {
    base = 'heavy';
    agree = heavyCount;
  } else if (wetCount * 2 > total) {
    // Strictly more than half: with 5 sources Rain needs 3.
    base = 'rain';
    agree = wetCount;
  } else if (wetCount >= 2 || lightCount * 2 > total) {
    // Two real wet votes, or most sources showing at least light rain. One wet outlier alone stays Dry.
    base = 'possible';
    agree = lightCount;
  } else {
    base = 'dry';
    agree = dryCount;
  }

  let level = base;
  let bumped = false;
  let lowered = false;
  let justEnded = false;
  if (radar.withinWindow && radar.wet === true) {
    level = bump(base);
    bumped = level !== base;
  } else if ((radar.withinClearWindow && radar.clear === true) || (radar.withinAreaClearWindow && radar.areaClear === true && radar.clear !== false)) {
    // Observed beats modelled for the next few minutes: the models often have a storm right but its timing
    // an hour off, and then keep saying "rain" after it has passed. One level only, so a cell drifting in
    // still shows as "possible".
    level = lower(base);
    lowered = level !== base;
    justEnded = radar.recentWet === true && radar.clear === true;
  }
  // After a radar change the claim may change side (e.g. dry → possible): count the sources backing the NEW claim.
  if (level !== base) agree = level === 'heavy' ? heavyCount : level === 'dry' ? dryCount : level === 'rain' ? wetCount : lightCount;
  return {
    level,
    baseLevel: base,
    radarBumped: bumped,
    radarLowered: lowered,
    justEnded,
    agree,
    total,
    maxMmh: total ? Math.max(...vals) : null,
    votes,
  };
}
