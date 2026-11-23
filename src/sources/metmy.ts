// MET Malaysia (data.gov.my): Malay text forecasts per district + warnings. Context only, not a voter.
import { DISTRICTS, ENDPOINTS, type District } from '../config';
import type { MetMyForecast, MetMyWarning, SourceHealth } from '../core/types';
import { cachedReason, errReason, fetchViaProxyOrDirect, type FetchTune } from './http';

const TTL_MS = 30 * 60 * 1000;
const LABEL = 'MET Malaysia';

const GLOSS: [string, string][] = [
  ['Ribut petir di beberapa tempat', 'Thunderstorms in places'],
  ['Ribut petir di satu dua tempat', 'Thunderstorms in one or two places'],
  ['Hujan di beberapa tempat', 'Rain in places'],
  ['Hujan di satu dua tempat', 'Rain in one or two places'],
  ['Hujan menyeluruh', 'Widespread rain'],
  ['Tiada hujan', 'No rain'],
  ['Ribut petir', 'Thunderstorms'],
  ['Berjerebu', 'Hazy'],
  ['Mendung', 'Cloudy'],
].sort((a, b) => b[0]!.length - a[0]!.length) as [string, string][];

/** English gloss for common MET Malaysia phrases (case-insensitive, longest match first); '' if unknown. */
export function glossMalay(text: string): string {
  const t = (text ?? '').trim().toLowerCase();
  for (const [ms, en] of GLOSS) if (t === ms.toLowerCase()) return en;
  for (const [ms, en] of GLOSS) if (t.includes(ms.toLowerCase())) return en;
  return '';
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function parseForecasts(json: unknown, district: District): MetMyForecast[] {
  if (!Array.isArray(json)) return [];
  const out: MetMyForecast[] = [];
  for (const r of json) {
    if (!isRec(r) || typeof r.date !== 'string') continue;
    const name = isRec(r.location) ? str(r.location.location_name) : '';
    if (name && name !== district) continue;
    out.push({
      district,
      date: r.date,
      morning: str(r.morning_forecast),
      afternoon: str(r.afternoon_forecast),
      night: str(r.night_forecast),
      summary: str(r.summary_forecast),
      summaryWhen: str(r.summary_when),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const STATE_WORDS = [
  'perlis', 'kedah', 'penang', 'pulau pinang', 'perak', 'selangor', 'kuala lumpur', 'putrajaya', 'negeri sembilan', 'melaka', 'malacca',
  'johor', 'pahang', 'terengganu', 'kelantan', 'sarawak', 'sabah', 'labuan',
];
/** Words a warning may use for a state (English + Malay spellings). */
const ALIASES: Record<string, string[]> = { malacca: ['malacca', 'melaka'], penang: ['penang', 'pulau pinang'] };
export const stateWords = (states: string[]): string[] => [...new Set(states.flatMap((st) => ALIASES[st.toLowerCase()] ?? [st.toLowerCase()]))].filter(Boolean);
const DEFAULT_STATES = ['selangor', 'kuala lumpur', 'putrajaya'];

/** valid_to is MYT wall-clock without offset. */
const mytMs = (s: string): number => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}+08:00`);

/** Active warnings that mention one of `states` (or no state at all: nationwide). */
export function parseWarnings(json: unknown, now = Date.now(), states: string[] = DEFAULT_STATES): MetMyWarning[] {
  const mine = stateWords(states);
  if (!Array.isArray(json)) return [];
  const out: MetMyWarning[] = [];
  for (const r of json) {
    if (!isRec(r)) continue;
    const issue = isRec(r.warning_issue) ? r.warning_issue : {};
    const w: MetMyWarning = {
      issued: str(issue.issued),
      title: str(issue.title_en),
      heading: str(r.heading_en),
      text: str(r.text_en),
      validFrom: str(r.valid_from),
      validTo: str(r.valid_to),
    };
    const to = mytMs(w.validTo);
    if (!Number.isFinite(to) || to < now) continue;
    const hay = `${w.heading} ${w.text} ${w.title}`.toLowerCase();
    const mentionsMine = mine.some((s) => hay.includes(s));
    const mentionsAnyState = STATE_WORDS.some((s) => hay.includes(s));
    if (mentionsMine || !mentionsAnyState) out.push(w);
  }
  return out;
}

export async function fetchMetMy(
  districts: District[],
  tune: FetchTune = {},
): Promise<{ forecasts: MetMyForecast[]; warnings: MetMyWarning[]; health: SourceHealth }> {
  const forecasts: MetMyForecast[] = [];
  let warnings: MetMyWarning[] = [];
  let oldest = Infinity;
  let anyStale = false;
  let anyDirect = false;
  let ok = 0;
  let lastReason = 'no data in response';
  const known = [...new Set(districts)].map((d) => DISTRICTS.find((x) => x.name === d)).filter((d): d is (typeof DISTRICTS)[number] => !!d);
  const names = known.map((d) => d.name);
  const states = [...new Set(known.map((d) => d.state).filter(Boolean))];
  const common = { ttlMs: TTL_MS, persist: true, ...tune };

  const track = (r: { fetchedAt: number; stale: boolean; via?: string }) => {
    oldest = Math.min(oldest, r.fetchedAt);
    if (r.stale) anyStale = true;
    if (r.via === 'direct') anyDirect = true;
  };

  await Promise.all(
    known.map(async ({ name, locationId }) => {
      try {
        // By location_id: unambiguous and the only shape the proxy accepts.
        const r = await fetchViaProxyOrDirect<unknown>(
          `${ENDPOINTS.proxy.metmy}?kind=forecast&district=${locationId}`,
          `${ENDPOINTS.metmyForecast}?contains=${locationId}@location__location_id`,
          common,
        );
        const f = parseForecasts(r.data, name);
        if (f.length > 0) {
          forecasts.push(...f);
          ok++;
          track(r);
        } else lastReason = 'no data in response';
      } catch (e) {
        lastReason = errReason(e);
      }
    }),
  );
  let warnOk = false;
  try {
    const r = await fetchViaProxyOrDirect<unknown>(
      `${ENDPOINTS.proxy.metmy}?kind=warning`,
      `${ENDPOINTS.metmyWarning}?limit=5`,
      common,
    );
    warnings = parseWarnings(r.data, Date.now(), states.length ? states : DEFAULT_STATES);
    warnOk = Array.isArray(r.data);
    if (warnOk) track(r);
  } catch {
    /* warnings are optional context */
  }

  const mk = (state: SourceHealth['state'], reason: string, via?: SourceHealth['via']): SourceHealth => ({
    id: 'metmy',
    label: LABEL,
    state,
    reason,
    fetchedAt: Number.isFinite(oldest) ? oldest : null,
    ...(via ? { via } : {}),
  });
  if (ok === 0) return { forecasts, warnings, health: mk('failed', lastReason) };
  if (anyStale) return { forecasts, warnings, health: mk('degraded', cachedReason(oldest), 'cache') };
  if (ok < names.length || !warnOk) {
    return { forecasts, warnings, health: mk('degraded', ok < names.length ? `${names.length - ok} district(s) missing` : 'warnings unavailable', anyDirect ? 'direct' : 'proxy') };
  }
  if (anyDirect) return { forecasts, warnings, health: mk('degraded', 'direct (no proxy)', 'direct') };
  return { forecasts, warnings, health: mk('ok', '', 'proxy') };
}
