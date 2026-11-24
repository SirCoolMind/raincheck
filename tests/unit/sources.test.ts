import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPEN_METEO_MODELS } from '../../src/config';
import { TEST_ROUTE } from './testRoute';
import { clearMemoryCache } from '../../src/sources/http';
import { fetchMetMy, glossMalay, parseWarnings } from '../../src/sources/metmy';
import { fetchMetNo, parseMetNo } from '../../src/sources/metno';
import { parsePlaces, resetNominatimThrottle, searchPlaces } from '../../src/sources/nominatim';
import { fetchOpenMeteo, openMeteoUrl, parseOpenMeteo } from '../../src/sources/openmeteo';
import { bearingsParam, fetchRoute, parseOsrm } from '../../src/sources/osrm';
import {
  MAX_ZOOM,
  fetchRadarIndex,
  parseRadar,
  radarCoverage,
  rasterTemplate,
  sampleRadar,
  sampleRadarDetail,
  tileUrl,
  type ImageLike,
} from '../../src/sources/rainviewer';
import { tileFor } from '../../src/core/geo';

const files = import.meta.glob<string>('../fixtures/**/*.json', { query: '?raw', import: 'default', eager: true });
const load = (dir: string, n: string): string => {
  const v = files[`../fixtures/${dir}/${n}`];
  if (v === undefined) throw new Error(`missing fixture ${dir}/${n}`);
  return v;
};
const real = (n: string) => load('real', n);
const bad = (n: string) => load('malformed', n);
const MALFORMED = ['empty-object.json', 'wrong-types.json', 'html.json', 'empty-array.json'];

type Handler = (url: string) => { status?: number; body: string; headers?: Record<string, string> } | undefined;
function mockFetch(h: Handler) {
  const fn = vi.fn(async (url: string) => {
    const r = h(String(url));
    if (!r) throw new TypeError('network down: ' + url);
    return new Response(r.body, { status: r.status ?? 200, headers: r.headers });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const NOW = { retries: 0, timeoutMs: 2000 };
const FAST = { retries: 1, backoffMs: 1, timeoutMs: 2000 };

beforeEach(() => {
  clearMemoryCache();
  resetNominatimThrottle();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const P2 = [
  { lat: 2.9226, lon: 101.651 },
  { lat: 3.1579, lon: 101.7123 },
];

describe('open-meteo', () => {
  it('real fixture → 5 results, numeric series, one request', async () => {
    const f = mockFetch(() => ({ body: real('openmeteo.json') }));
    const res = await fetchOpenMeteo(P2, NOW);
    // Goes through the same-origin proxy first (server cache shared by all visitors), coords at 2 dp.
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0]![0])).toBe('/api/openmeteo.php?lat=2.92,3.16&lon=101.65,101.71');
    const url = openMeteoUrl(P2);
    expect(url).toContain('latitude=2.92,3.16');
    expect(url).toContain('longitude=101.65,101.71');
    expect(url).toContain('models=ecmwf_ifs025,gfs_seamless,icon_seamless,jma_seamless');
    expect(url).toContain('minutely_15=precipitation');
    expect(url).toContain('timezone=Asia%2FKuala_Lumpur');
    expect(res.map((r) => r.id)).toEqual(OPEN_METEO_MODELS.map((m) => `om_${m}`));
    expect(res.map((r) => r.label)).toEqual(['ECMWF IFS 0.25°', 'GFS', 'ICON', 'JMA']);
    for (const r of res) {
      expect(r.health.state).toBe('ok');
      expect(r.resolution).toBe('15-min (interpolated from hourly in Malaysia)');
      expect(r.series).toHaveLength(2);
      for (const s of r.series) {
        expect(s!.stepMin).toBe(15);
        expect(s!.times.length).toBe(192);
        expect(s!.times[0]).toBe(Date.parse('2026-11-23T00:00:00+08:00') - 15 * 60_000); // value stamped 00:00 covers 23:45–00:00
        expect(s!.times[1]! - s!.times[0]!).toBe(15 * 60_000);
        expect(s!.mmh.some((v) => typeof v === 'number')).toBe(true);
        expect(s!.prob!.length).toBe(s!.probTimes!.length);
        expect(s!.probTimes![1]! - s!.probTimes![0]!).toBe(3600_000);
      }
    }
    // ECMWF raw first value 0 mm/15min → 0 mm/h
    expect(res[0]!.series[0]!.mmh[0]).toBe(0);
  });

  it('converts mm/15min to mm/h (×4) on a hand-made single-point object', () => {
    const mini = {
      minutely_15: { time: ['2026-11-19T07:30', '2026-11-19T07:45'], precipitation_ecmwf_ifs025: [0.1, 0.3] },
      hourly: {
        time: ['2026-11-19T07:00', '2026-11-19T08:00'],
        precipitation_ecmwf_ifs025: [0.5, 2],
        precipitation_probability_ecmwf_ifs025: [20, 80],
      },
    };
    const [r] = parseOpenMeteo(mini, [P2[0]!], { stale: false, fetchedAt: 1 });
    const s = r!.series[0]!;
    expect(s.mmh).toEqual([0.4, 1.2]);
    expect(s.stepMin).toBe(15);
    expect(s.times[0]).toBe(Date.UTC(2026, 10, 19, 7 - 8, 15)); // preceding-interval value → slot start
    expect(s.prob).toEqual([20, 80]);
    expect(r!.health.state).toBe('ok');
    // other models absent → failed health, null series
    expect(parseOpenMeteo(mini, [P2[0]!], { stale: false, fetchedAt: 1 })[1]!.health.state).toBe('failed');
  });

  it('handles unsuffixed keys (single-model request)', () => {
    const one = { minutely_15: { time: ['2026-11-19T07:30'], precipitation: [0.25] } };
    const [r] = parseOpenMeteo(one, [P2[0]!], { stale: false, fetchedAt: 1 });
    expect(r!.series[0]!.mmh).toEqual([1]);
  });

  it('falls back to hourly mm/h when minutely_15 is all null', () => {
    const j = {
      minutely_15: { time: ['2026-11-19T07:00', '2026-11-19T07:15'], precipitation_ecmwf_ifs025: [null, null] },
      hourly: { time: ['2026-11-19T07:00', '2026-11-19T08:00'], precipitation_ecmwf_ifs025: [1.5, 0], precipitation_probability_ecmwf_ifs025: [60, 10] },
    };
    const res = parseOpenMeteo(j, [P2[0]!], { stale: false, fetchedAt: 1 });
    const e = res.find((r) => r.id === 'om_ecmwf_ifs025')!;
    expect(e.series[0]).toMatchObject({ stepMin: 60, mmh: [1.5, 0], prob: [60, 10] });
    expect(e.resolution).toBe('hourly');
    expect(e.health.state).toBe('degraded');
  });

  it('marks cache fallbacks as degraded with age', async () => {
    const r = parseOpenMeteo(JSON.parse(real('openmeteo.json')), P2, { stale: true, fetchedAt: Date.now() - 12 * 60_000 });
    expect(r[0]!.health).toMatchObject({ state: 'degraded', reason: 'cached 12 min', via: 'cache' });
  });

  it('HTTP 500 → 4 failed results, null series, never throws', async () => {
    mockFetch(() => ({ status: 500, body: 'oops' }));
    const res = await fetchOpenMeteo(P2, NOW);
    expect(res).toHaveLength(4);
    for (const r of res) {
      expect(r.health).toMatchObject({ state: 'failed', reason: 'HTTP 500' });
      expect(r.series).toEqual([null, null]);
    }
  });

  it('network failure and timeout are reported', async () => {
    mockFetch(() => undefined);
    expect((await fetchOpenMeteo(P2, NOW))[0]!.health.reason).toBe('network error');
    clearMemoryCache();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    expect((await fetchOpenMeteo(P2, { retries: 0, timeoutMs: 20 }))[0]!.health.reason).toBe('timeout');
  });

  it.each(MALFORMED)('malformed %s → failed, null series', async (name) => {
    mockFetch(() => ({ body: bad(name) }));
    const res = await fetchOpenMeteo(P2, NOW);
    expect(res).toHaveLength(4);
    for (const r of res) {
      expect(r.health.state).toBe('failed');
      expect(r.series).toEqual([null, null]);
    }
  });

  it('empty points → failed without a request', async () => {
    const f = mockFetch(() => ({ body: '[]' }));
    const res = await fetchOpenMeteo([]);
    expect(f).not.toHaveBeenCalled();
    expect(res[0]!.health.state).toBe('failed');
  });

  it('caches for 15 minutes', async () => {
    const f = mockFetch(() => ({ body: real('openmeteo.json') }));
    await fetchOpenMeteo(P2, NOW);
    await fetchOpenMeteo(P2, NOW);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('met norway', () => {
  const pts = [
    { lat: 2.9226, lon: 101.651 },
    { lat: 2.9264, lon: 101.6964 }, // different cell
    { lat: 2.91, lon: 101.64 }, // same cell as point 0
  ];

  it('parses next_1_hours amounts and skips 6h-only entries', () => {
    const s = parseMetNo(JSON.parse(real('metno.json')))!;
    expect(s.stepMin).toBe(60);
    expect(s.times[0]).toBe(Date.parse('2026-11-23T11:00:00Z'));
    expect(s.mmh[0]).toBe(0.2);
    expect(s.times).toHaveLength(s.mmh.length);
    expect(s.times.length).toBeLessThan(92);
    expect(s.mmh.every((v) => typeof v === 'number')).toBe(true);
  });

  it('dedupes cells, keeps order, proxy → ok', async () => {
    const f = mockFetch((u) => (u.startsWith('/api/metno.php') ? { body: real('metno.json'), headers: { expires: new Date(Date.now() + 1800_000).toUTCString() } } : undefined));
    const r = await fetchMetNo(pts, NOW);
    expect(f).toHaveBeenCalledTimes(2); // 2 unique cells
    expect(String(f.mock.calls[0]![0])).toMatch(/^\/api\/metno\.php\?lat=2\.90&lon=101\.65$/);
    expect(r.id).toBe('metno');
    expect(r.resolution).toBe('hourly, mm/h');
    expect(r.health).toMatchObject({ state: 'ok', via: 'proxy' });
    expect(r.series).toHaveLength(3);
    expect(r.series[0]).toBe(r.series[2]);
    expect(r.series[0]).not.toBeNull();
    // second call within Expires is served from cache
    await fetchMetNo(pts, NOW);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('direct fallback → degraded', async () => {
    mockFetch((u) => (u.startsWith('https://api.met.no/') ? { body: real('metno.json') } : { status: 404, body: '' }));
    const r = await fetchMetNo([pts[0]!], NOW);
    expect(r.health).toMatchObject({ state: 'degraded', reason: 'direct (no proxy, no User-Agent)', via: 'direct' });
    expect(r.series[0]).not.toBeNull();
  });

  it('stale cache → degraded "cached N min"', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    mockFetch((u) => (u.startsWith('/api') ? { body: real('metno.json') } : undefined));
    await fetchMetNo([pts[0]!], NOW);
    vi.setSystemTime(Date.now() + 45 * 60_000);
    mockFetch(() => ({ status: 500, body: '' }));
    const r = await fetchMetNo([pts[0]!], NOW);
    expect(r.health).toMatchObject({ state: 'degraded', reason: 'cached 45 min' });
    expect(r.series[0]).not.toBeNull();
  });

  it('HTTP 500 everywhere → failed', async () => {
    mockFetch(() => ({ status: 500, body: '' }));
    const r = await fetchMetNo(pts, NOW);
    expect(r.health).toMatchObject({ state: 'failed', reason: 'HTTP 500' });
    expect(r.series).toEqual([null, null, null]);
  });

  it.each(MALFORMED)('malformed %s → failed, no throw', async (name) => {
    mockFetch(() => ({ body: bad(name) }));
    const r = await fetchMetNo(pts, NOW);
    expect(r.health.state).toBe('failed');
    expect(r.series.every((s) => s === null)).toBe(true);
  });
});

describe('met malaysia', () => {
  it('glossMalay maps phrases, longest first, case-insensitive', () => {
    expect(glossMalay('Tiada Hujan')).toBe('No rain');
    expect(glossMalay('Hujan di beberapa tempat')).toBe('Rain in places');
    expect(glossMalay('HUJAN DI SATU DUA TEMPAT')).toBe('Rain in one or two places');
    expect(glossMalay('Ribut petir di beberapa tempat')).toBe('Thunderstorms in places');
    expect(glossMalay('Ribut petir di satu dua tempat')).toBe('Thunderstorms in one or two places');
    expect(glossMalay('Hujan menyeluruh')).toBe('Widespread rain');
    expect(glossMalay('Ribut petir')).toBe('Thunderstorms');
    expect(glossMalay('Berjerebu')).toBe('Hazy');
    expect(glossMalay('Mendung')).toBe('Cloudy');
    expect(glossMalay('Sesuatu yang lain')).toBe('');
    expect(glossMalay('')).toBe('');
  });

  it('parses forecasts + filters warnings', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T10:00:00+08:00'));
    const f = mockFetch((u) => {
      if (u.includes('kind=forecast')) return { body: real('metmy-forecast.json') };
      if (u.includes('kind=warning')) return { body: real('metmy-warning.json') };
      return undefined;
    });
    const r = await fetchMetMy(['Sepang']);
    expect(f).toHaveBeenCalledTimes(2);
    expect(String(f.mock.calls[0]![0])).toBe('/api/metmy.php?kind=forecast&district=Ds064');
    expect(r.forecasts.length).toBeGreaterThan(3);
    const first = r.forecasts[0]!;
    expect(first.district).toBe('Sepang');
    expect(first.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof first.morning).toBe('string');
    expect(first.summary).not.toBe('');
    expect(r.forecasts.map((x) => x.date)).toEqual([...r.forecasts.map((x) => x.date)].sort());
    expect(r.health).toMatchObject({ state: 'ok', via: 'proxy' });
    for (const w of r.warnings) expect(Date.parse(w.validTo + '+08:00')).toBeGreaterThanOrEqual(Date.now());
  });

  it('warning filter: expiry and state mentions', () => {
    const mk = (text: string, validTo: string) => ({
      warning_issue: { issued: '2026-11-19T10:00:00', title_en: 'T' },
      heading_en: 'H',
      text_en: text,
      valid_from: '2026-11-19T00:00:00',
      valid_to: validTo,
    });
    const now = Date.parse('2026-11-20T00:00:00+08:00');
    const out = parseWarnings(
      [
        mk('Thunderstorms over Selangor and Perak', '2026-11-21T00:00:00'),
        mk('Heavy rain over Kelantan and Sabah', '2026-11-21T00:00:00'),
        mk('General advisory with no places', '2026-11-21T00:00:00'),
        mk('Expired Selangor warning', '2026-11-19T12:00:00'),
        'junk',
        null,
      ],
      now,
    );
    expect(out.map((w) => w.text)).toEqual(['Thunderstorms over Selangor and Perak', 'General advisory with no places']);
    expect(out[0]).toMatchObject({ issued: '2026-11-19T10:00:00', title: 'T', heading: 'H' });
  });

  it('keeps warnings for the states the trip crosses (aliases included)', () => {
    const now = Date.parse('2026-11-20T00:00:00Z');
    const w = (text: string) => ({ warning_issue: { issued: 'x', title_en: 'T' }, heading_en: 'H', text_en: text, valid_from: '2026-11-19T00:00:00', valid_to: '2026-11-21T00:00:00' });
    const json = [w('Thunderstorms over Johor'), w('Thunderstorms over Pulau Pinang'), w('Thunderstorms over Selangor'), w('Haze advisory')];
    expect(parseWarnings(json, now, ['Penang']).map((x) => x.text)).toEqual(['Thunderstorms over Pulau Pinang', 'Haze advisory']);
    expect(parseWarnings(json, now, ['Johor']).map((x) => x.text)).toEqual(['Thunderstorms over Johor', 'Haze advisory']);
  });

  it('direct fallback uses trailing-slash endpoints and contains filter', async () => {
    const f = mockFetch((u) => {
      if (u.startsWith('/api')) return { status: 404, body: '' };
      if (u.includes('contains=Ds064@location__location_id')) return { body: real('metmy-forecast.json') };
      if (u.startsWith('https://api.data.gov.my/weather/warning/?limit=5')) return { body: real('metmy-warning.json') };
      return undefined;
    });
    const r = await fetchMetMy(['Sepang']);
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain('https://api.data.gov.my/weather/forecast/?contains=Ds064@location__location_id');
    expect(urls).toContain('https://api.data.gov.my/weather/warning/?limit=5');
    expect(r.health).toMatchObject({ state: 'degraded', via: 'direct' });
    expect(r.forecasts.length).toBeGreaterThan(0);
  });

  it('unknown/mismatched district yields failed health', async () => {
    mockFetch((u) => (u.includes('kind=forecast') ? { body: real('metmy-forecast.json') } : { body: '[]' }));
    const r = await fetchMetMy(['Kuala Lumpur']);
    expect(r.forecasts).toEqual([]);
    expect(r.health.state).toBe('failed');
  });

  it('HTTP 500 → failed', async () => {
    mockFetch(() => ({ status: 500, body: '' }));
    const r = await fetchMetMy(['Kuala Langat', 'Sepang', 'Putrajaya', 'Kuala Lumpur'], FAST);
    expect(r.health).toMatchObject({ state: 'failed', reason: 'HTTP 500' });
    expect(r.forecasts).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it.each(MALFORMED)('malformed %s → no throw', async (name) => {
    mockFetch(() => ({ body: bad(name) }));
    const r = await fetchMetMy(['Sepang']);
    expect(r.forecasts).toEqual([]);
    expect(r.health.state).toBe('failed');
  });
});

describe('rainviewer', () => {
  it('tileUrl / rasterTemplate / MAX_ZOOM', () => {
    const fr = { path: '/v2/radar/abc' };
    expect(MAX_ZOOM).toBe(7);
    expect(tileUrl('https://h', fr, 7, 100, 62)).toBe('https://h/v2/radar/abc/256/7/100/62/2/0_0.png');
    expect(tileUrl('https://h', fr, 5, 1, 2, { color: 4, smooth: 1, snow: 1, size: 512 })).toBe('https://h/v2/radar/abc/512/5/1/2/4/1_1.png');
    expect(rasterTemplate('https://h', fr)).toBe('https://h/v2/radar/abc/256/{z}/{x}/{y}/2/0_0.png');
  });

  it('parses the real index; no nowcast is fine', async () => {
    mockFetch((u) => (u.startsWith('/api/radar.php') ? { body: real('rainviewer.json') } : undefined));
    const { index, health } = await fetchRadarIndex();
    expect(index!.host).toBe('https://tilecache.rainviewer.com');
    expect(index!.frames.length).toBeGreaterThan(5);
    expect(index!.frames.every((f) => f.kind === 'past' && f.time > 1e12)).toBe(true);
    expect(index!.frames.map((f) => f.time)).toEqual([...index!.frames.map((f) => f.time)].sort((a, b) => a - b));
    expect(health).toMatchObject({ id: 'radar', state: 'ok', reason: 'no nowcast (free tier)', via: 'proxy' });
  });

  it('includes nowcast frames when present; direct fallback noted', async () => {
    const j = JSON.parse(real('rainviewer.json'));
    j.radar.nowcast = [{ time: j.radar.past.at(-1).time + 600, path: '/v2/radar/nc1' }];
    mockFetch((u) => (u.startsWith('https://api.rainviewer.com') ? { body: JSON.stringify(j) } : { status: 404, body: '' }));
    const { index, health } = await fetchRadarIndex();
    expect(index!.frames.at(-1)).toMatchObject({ kind: 'nowcast', path: '/v2/radar/nc1' });
    expect(health).toMatchObject({ state: 'ok', via: 'direct' });
  });

  it('failures → null index, failed health', async () => {
    mockFetch(() => ({ status: 500, body: '' }));
    const r = await fetchRadarIndex(FAST);
    expect(r.index).toBeNull();
    expect(r.health).toMatchObject({ state: 'failed', reason: 'HTTP 500' });
    for (const n of MALFORMED) {
      clearMemoryCache();
      mockFetch(() => ({ body: bad(n) }));
      const m = await fetchRadarIndex(FAST);
      expect(m.index).toBeNull();
      expect(m.health.state).toBe('failed');
    }
    expect(parseRadar(null)).toBeNull();
  });

  it('sampleRadar loads each tile once and reads alpha', async () => {
    const index = parseRadar(JSON.parse(real('rainviewer.json')))!;
    const a = { lat: 2.9226, lon: 101.651 };
    const b = { lat: 2.9, lon: 101.9 }; // same tile, other pixel
    const c = { lat: 8, lon: 104 }; // different tile
    const ta = tileFor(a, 7);
    const tc = tileFor(c, 7);
    expect(`${ta.x},${ta.y}`).not.toBe(`${tc.x},${tc.y}`);
    const mk = (px: number, py: number, alpha: number): ImageLike => {
      const data = new Uint8ClampedArray(256 * 256 * 4);
      data[(py * 256 + px) * 4 + 3] = alpha;
      return { width: 256, height: 256, data };
    };
    const urls: string[] = [];
    const loader = vi.fn(async (u: string) => {
      urls.push(u);
      return u.includes(`/7/${ta.x}/${ta.y}/`) ? mk(ta.px, ta.py, 200) : null;
    });
    const out = await sampleRadar(index, [a, b, c], loader);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(urls[0]).toContain(index.frames.at(-1)!.path);
    expect(out).toEqual([true, false, null]);
  });

  it('sampleRadar: no past frame or throwing loader → nulls', async () => {
    expect(await sampleRadar({ host: 'h', frames: [], generatedMs: 0 }, [{ lat: 1, lon: 100 }], async () => null)).toEqual([null]);
    const index = parseRadar(JSON.parse(real('rainviewer.json')))!;
    const out = await sampleRadar(index, [{ lat: 2.8, lon: 101.6 }], async () => {
      throw new Error('tainted');
    });
    expect(out).toEqual([null]);
  });

  it('sampleRadarDetail: clear box in the latest frame, rain in the hour before', async () => {
    const index = parseRadar(JSON.parse(real('rainviewer.json')))!;
    const past = index.frames.filter((f) => f.kind === 'past');
    const latest = past.at(-1)!;
    const earlier = past.find((f) => f.time >= latest.time - 60 * 60_000 && f !== latest)!;
    const a = { lat: 2.9226, lon: 101.651 };
    const ta = tileFor(a, 7);
    // A 3×3 echo centred dx px east of the point (3×3 so the every-2nd-pixel area scan always sees it).
    const img = (dx: number | null): ImageLike => {
      const data = new Uint8ClampedArray(256 * 256 * 4);
      if (dx !== null) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) data[((ta.py + y) * 256 + ta.px + dx + x) * 4 + 3] = 200;
      return { width: 256, height: 256, data };
    };
    // latest: echo 10 px away (outside the ±3 px box, inside the ~30 km area) → clear, area not clear;
    // earlier frame: echo 2 px away → recentWet
    const loader = vi.fn(async (u: string) => (u.includes(latest.path) ? img(10) : u.includes(earlier.path) ? img(2) : img(null)));
    expect(await sampleRadarDetail(index, [a], loader)).toEqual([{ clear: true, recentWet: true, areaClear: false }]);
    // latest: nothing anywhere → area clear too
    const allClear = vi.fn(async (u: string) => (u.includes(earlier.path) ? img(2) : img(null)));
    expect(await sampleRadarDetail(index, [a], allClear)).toEqual([{ clear: true, recentWet: true, areaClear: true }]);
    // latest: echo 2 px away → not clear
    const wetNow = vi.fn(async (u: string) => (u.includes(latest.path) ? img(2) : img(null)));
    expect(await sampleRadarDetail(index, [a], wetNow)).toEqual([{ clear: false, recentWet: false, areaClear: false }]);
    // unreadable tiles → unknown
    expect(await sampleRadarDetail(index, [a], async () => null)).toEqual([{ clear: null, recentWet: null, areaClear: null }]);
    expect(await sampleRadarDetail({ host: 'h', frames: [], generatedMs: 0 }, [a], async () => null)).toEqual([{ clear: null, recentWet: null }]);
  });

  it('radarCoverage: share of wet pixels around the route, per frame', async () => {
    const index = parseRadar(JSON.parse(real('rainviewer.json')))!;
    const route = [{ lat: 3.07, lon: 101.52 }, { lat: 3.16, lon: 101.71 }];
    const wetPath = index.frames[0]!.path;
    // Frame 0: every pixel wet. Other frames: dry. Tiles counted once per frame.
    const loader = vi.fn(async (u: string): Promise<ImageLike> => {
      const data = new Uint8ClampedArray(256 * 256 * 4);
      if (u.includes(wetPath)) for (let i = 3; i < data.length; i += 4) data[i] = 255;
      return { width: 256, height: 256, data };
    });
    const out = await radarCoverage(index, route, loader);
    expect(out).toHaveLength(index.frames.length);
    expect(out[0]).toBe(1);
    expect(out.slice(1).every((c) => c === 0)).toBe(true);
    expect(await radarCoverage(index, route, async () => null)).toEqual(index.frames.map(() => null));
    expect(await radarCoverage(index, [], loader)).toEqual(index.frames.map(() => null));
  });
});

describe('osrm', () => {
  const wps = [...TEST_ROUTE];

  it('bearings: only highway waypoints, separators kept', () => {
    expect(bearingsParam(wps)).toMatch(/^;;\d{1,3},90;\d{1,3},90;$/);
    expect(bearingsParam(wps.slice().reverse())).toMatch(/^;\d{1,3},90;\d{1,3},90;;$/);
  });

  it('parseOsrm builds RouteData from the real fixture', () => {
    const j = JSON.parse(real('osrm.json'));
    const r = parseOsrm(j)!;
    expect(r.totalDurS).toBeCloseTo(j.routes[0].duration, 5);
    expect(r.distanceM).toBeCloseTo(j.routes[0].distance, 5);
    expect(r.coords.length).toBeGreaterThan(100);
    expect(r.cumDurS).toHaveLength(r.coords.length);
    expect(r.roadNames).toHaveLength(r.coords.length);
    expect(r.cumDurS[0]).toBe(0);
    expect(r.cumDurS.at(-1)).toBeCloseTo(r.totalDurS, 5);
    for (let i = 1; i < r.cumDurS.length; i++) expect(r.cumDurS[i]!).toBeGreaterThanOrEqual(r.cumDurS[i - 1]!);
    // no duplicate joint vertices
    for (let i = 1; i < r.coords.length; i++) expect(r.coords[i]).not.toEqual(r.coords[i - 1]);
    expect(r.legs).toHaveLength(4);
    expect(r.legs[0]!.durationS).toBeGreaterThan(0);
    expect(r.roadNames[0]).toBe('Jalan Perdana');
    expect(r.roadNames.some((n) => n !== '')).toBe(true);
  });

  it('parseOsrm distributes step duration by segment distance (hand-made)', () => {
    const j = {
      code: 'Ok',
      routes: [
        {
          duration: 100,
          distance: 3000,
          legs: [
            {
              duration: 100,
              distance: 3000,
              summary: 'Main',
              steps: [
                { name: 'A', duration: 40, geometry: { coordinates: [[101, 3], [101.001, 3], [101.003, 3]] } },
                { name: 'B', duration: 60, geometry: { coordinates: [[101.003, 3], [101.004, 3]] } },
              ],
            },
          ],
        },
      ],
    };
    const r = parseOsrm(j)!;
    expect(r.coords).toHaveLength(4);
    expect(r.cumDurS[0]).toBe(0);
    expect(r.cumDurS[1]).toBeCloseTo(40 / 3, 1); // 1/3 of A's distance
    expect(r.cumDurS[2]).toBeCloseTo(40, 5);
    expect(r.cumDurS[3]).toBeCloseTo(100, 5);
    expect(r.roadNames).toEqual(['A', 'A', 'B', 'B']);
    expect(r.legs[0]!.summary).toBe('Main');
  });

  it.each(MALFORMED)('parseOsrm malformed %s → null', (name) => {
    let v: unknown;
    try {
      v = JSON.parse(bad(name));
    } catch {
      v = bad(name);
    }
    expect(parseOsrm(v)).toBeNull();
  });

  it('fetchRoute: proxy URL, direct fallback URL with bearings', async () => {
    const f = mockFetch((u) => (u.startsWith('https://router.project-osrm.org/') ? { body: real('osrm.json') } : { status: 404, body: '' }));
    const { route, health } = await fetchRoute(wps);
    expect(route).not.toBeNull();
    expect(health).toMatchObject({ id: 'route', state: 'ok', via: 'direct' });
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toMatch(/^\/api\/route\.php\?wp=.+&b=/);
    const direct = urls.find((u) => u.startsWith('https://router'))!;
    expect(direct).toContain('101.651,2.9226;101.6964,2.9264;101.6831,2.9969;101.6959,3.0968;101.7123,3.1579');
    expect(direct).toContain('overview=false&steps=true&geometries=geojson&continue_straight=true&bearings=;;');
    // cached for days: second call makes no request
    const n = f.mock.calls.length;
    await fetchRoute(wps);
    expect(f.mock.calls.length).toBe(n);
  });

  it('fetchRoute failures → route null, failed health', async () => {
    mockFetch(() => ({ status: 500, body: '' }));
    const r = await fetchRoute(wps, FAST);
    expect(r.route).toBeNull();
    expect(r.health).toMatchObject({ state: 'failed', reason: 'HTTP 500' });
    for (const n of MALFORMED) {
      clearMemoryCache();
      mockFetch(() => ({ body: bad(n) }));
      const m = await fetchRoute(wps, FAST);
      expect(m.route).toBeNull();
      expect(m.health.state).toBe('failed');
    }
    expect((await fetchRoute([wps[0]!])).route).toBeNull();
  });
});

describe('nominatim', () => {
  it('parses the real fixture (via the search proxy)', async () => {
    const f = mockFetch(() => ({ body: real('nominatim.json') }));
    const r = await searchPlaces('Putrajaya');
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0]![0])).toBe('/api/search.php?q=Putrajaya');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]).toMatchObject({ name: 'Putrajaya', lat: 2.9384381, lon: 101.69223 });
    expect(r[0]!.label).toContain('Putrajaya');
  });

  it('falls back to Nominatim directly (Malaysia only, no regional bias) when the proxy is down', async () => {
    const f = mockFetch((u) => (u.startsWith('/api') ? { status: 404, body: '' } : { body: real('nominatim.json') }));
    await searchPlaces('Putrajaya Presint 1');
    const url = String(f.mock.calls.at(-1)![0]);
    for (const part of ['countrycodes=my', 'format=jsonv2', 'limit=5', 'accept-language=en']) expect(url).toContain(part);
    expect(url).not.toContain('viewbox');
  });

  it('ignores queries shorter than 3 characters', async () => {
    const f = mockFetch(() => ({ body: '[]' }));
    expect(await searchPlaces('ab')).toEqual([]);
    expect(await searchPlaces('  a ')).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('throttles to >= 1100 ms between calls', async () => {
    vi.useFakeTimers();
    const stamps: number[] = [];
    mockFetch(() => {
      stamps.push(Date.now());
      return { body: real('nominatim.json') };
    });
    const p1 = searchPlaces('Putrajaya');
    const p2 = searchPlaces('Cyberjaya');
    const p3 = searchPlaces('KLCC');
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all([p1, p2, p3]);
    expect(stamps).toHaveLength(3);
    expect(stamps[1]! - stamps[0]!).toBeGreaterThanOrEqual(1100);
    expect(stamps[2]! - stamps[1]!).toBeGreaterThanOrEqual(1100);
  });

  it('failures and malformed payloads → []', async () => {
    mockFetch(() => ({ status: 500, body: '' }));
    expect(await searchPlaces('Putrajaya')).toEqual([]);
    for (const n of MALFORMED) expect(parsePlaces(safe(bad(n)))).toEqual([]);
    expect(parsePlaces([{ lat: 'x', lon: '1', display_name: 'A' }, { lat: '1', lon: '2', display_name: 'Foo, Bar' }])).toEqual([
      { name: 'Foo', lat: 1, lon: 2, label: 'Foo, Bar' },
    ]);
  });

  it('an already-aborted signal makes no request', async () => {
    const f = mockFetch(() => ({ body: '[]' }));
    const c = new AbortController();
    c.abort();
    expect(await searchPlaces('Putrajaya', { signal: c.signal })).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});

function safe(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}
