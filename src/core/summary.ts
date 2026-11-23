// PURE trip summary: group wet stretches into windows, pick the headline.
import { formatHHMM, formatRange } from './timing';
import type { Level, StretchEval, Summary, Window } from './types';
import { isWet, levelRank } from './verdict';

export function levelWord(level: Level): string {
  switch (level) {
    case 'heavy':
      return 'heavy rain';
    case 'rain':
      return 'rain';
    case 'possible':
      return 'possible rain';
    case 'dry':
      return 'dry';
    default:
      return 'no data';
  }
}

export function levelLabel(level: Level): string {
  switch (level) {
    case 'heavy':
      return 'Heavy';
    case 'rain':
      return 'Rain';
    case 'possible':
      return 'Possible';
    case 'dry':
      return 'Dry';
    default:
      return 'No data';
  }
}

function wettest(evals: StretchEval[], from: number, to: number): StretchEval {
  let best = evals[from]!;
  for (let i = from + 1; i <= to; i++) {
    const e = evals[i]!;
    if ((e.verdict.maxMmh ?? -1) > (best.verdict.maxMmh ?? -1)) best = e;
  }
  return best;
}

function buildWindows(evals: StretchEval[]): Window[] {
  const windows: Window[] = [];
  let i = 0;
  while (i < evals.length) {
    if (!isWet(evals[i]!.verdict.level)) {
      i++;
      continue;
    }
    let j = i;
    let level: Level = evals[i]!.verdict.level;
    while (j + 1 < evals.length && isWet(evals[j + 1]!.verdict.level)) {
      j++;
      const l = evals[j]!.verdict.level;
      if (levelRank(l) > levelRank(level)) level = l;
    }
    windows.push({
      level,
      fromIdx: i,
      toIdx: j,
      startMs: evals[i]!.eta.startMs,
      endMs: evals[j]!.eta.endMs,
      place: wettest(evals, i, j).stretch.place,
    });
    i = j + 1;
  }
  return windows;
}

export function summarize(evals: StretchEval[]): Summary {
  const windows = buildWindows(evals);
  const n = evals.length;
  const withData = evals.filter((e) => e.verdict.level !== 'nodata');

  if (windows.length === 0) {
    if (withData.length === 0) {
      return { level: 'nodata', sentence: 'No forecast data for this trip', detail: '', windows, agree: 0, total: 0 };
    }
    let low = withData[0]!.verdict;
    for (const e of withData) {
      if (e.verdict.agree / e.verdict.total < low.agree / low.total) low = e.verdict;
    }
    const range = formatRange(evals[0]!.eta.startMs, evals[n - 1]!.eta.endMs);
    const missing = n - withData.length;
    return {
      level: 'dry',
      sentence: `Dry all the way, ${range}`,
      detail: missing > 0 ? `No data for ${missing} of ${n} stretches` : '',
      windows,
      agree: low.agree,
      total: low.total,
    };
  }

  let head = windows[0]!;
  for (const w of windows) if (levelRank(w.level) > levelRank(head.level)) head = w;
  const range = formatRange(head.startMs, head.endMs);
  const prefix = head.level === 'heavy' ? 'Heavy rain' : head.level === 'rain' ? 'Rain' : 'Possible rain';
  const others = windows.filter((w) => w !== head);
  let detail = '';
  if (others.length > 0) {
    const nx = others[0]!;
    detail = `Also ${levelWord(nx.level)} ${formatHHMM(nx.startMs)} near ${nx.place}`;
    if (others.length > 1) detail += ` (+${others.length - 1} more)`;
  }
  const v = wettest(evals, head.fromIdx, head.toIdx).verdict;
  const span = head.toIdx - head.fromIdx + 1;
  if (span >= Math.ceil(n * 0.8)) {
    return {
      level: head.level,
      sentence: span === n ? `${prefix} the whole drive` : `${prefix} most of the drive`,
      detail: detail ? `${range} · ${detail}` : range,
      windows,
      agree: v.agree,
      total: v.total,
    };
  }
  return {
    level: head.level,
    sentence: `${prefix} ${range} near ${head.place}`,
    detail,
    windows,
    agree: v.agree,
    total: v.total,
  };
}
