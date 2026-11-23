import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HOST_BUDGET_PER_MIN,
  MIN_FORCE_AGE_MS,
  HttpError,
  clearMemoryCache,
  fetchJson,
  fetchViaProxyOrDirect,
  idbGet,
  idbSet,
  resetIdbConnection,
} from '../../src/sources/http';

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  clearMemoryCache();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchJson basics', () => {
  it('returns parsed data', async () => {
    fetchMock.mockResolvedValue(json({ a: 1 }));
    const r = await fetchJson<{ a: number }>('https://x/1');
    expect(r.data).toEqual({ a: 1 });
    expect(r.fromCache).toBe(false);
    expect(r.stale).toBe(false);
    expect(typeof r.fetchedAt).toBe('number');
  });

  it('times out with reason timeout', async () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined)); // never resolves, ignores abort
    await expect(fetchJson('https://x/slow', { timeoutMs: 30, retries: 0 })).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('retries 503 with exponential backoff then succeeds', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(json({ ok: true }));
    const p = fetchJson('https://x/retry', { retries: 2 });
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600); // first backoff 400-500ms
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1200); // second backoff 800-1000ms
    const r = await p;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(r.data).toEqual({ ok: true });
  });

  it('does not retry on 404', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 404 }));
    await expect(fetchJson('https://x/404', { backoffMs: 1 })).rejects.toMatchObject({ reason: 'http', status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries network errors then throws HttpError(network)', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const err = await fetchJson('https://x/net', { backoffMs: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.reason).toBe('network');
    expect(fetchMock).toHaveBeenCalledTimes(2); // default: one retry only
  });

  it('never retries a 429 (rate limited)', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 429 }));
    await expect(fetchJson('https://x/429', { backoffMs: 1, retries: 3 })).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('parse errors (bad JSON, HTML) are not retried', async () => {
    fetchMock.mockResolvedValue(new Response('<html>hi</html>', { status: 200 }));
    await expect(fetchJson('https://x/html', { backoffMs: 1 })).rejects.toMatchObject({ reason: 'parse' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(new Response('{oops', { status: 200 }));
    await expect(fetchJson('https://x/bad', { backoffMs: 1 })).rejects.toMatchObject({ reason: 'parse' });
  });

  it('an aborted signal stops immediately', async () => {
    const c = new AbortController();
    c.abort();
    await expect(fetchJson('https://x/ab', { signal: c.signal })).rejects.toBeInstanceOf(HttpError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('cache', () => {
  it('hit within ttl = 1 fetch; expiry refetches', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    fetchMock.mockImplementation(async () => json({ n: Date.now() }));
    const a = await fetchJson('https://x/c', { ttlMs: 1000 });
    vi.setSystemTime(Date.now() + 500);
    const b = await fetchJson('https://x/c', { ttlMs: 1000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(b.fromCache).toBe(true);
    expect(b.stale).toBe(false);
    expect(b.data).toEqual(a.data);
    vi.setSystemTime(Date.now() + 600);
    const c = await fetchJson('https://x/c', { ttlMs: 1000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(c.fromCache).toBe(false);
  });

  it('ttl 0 and no Expires means no caching', async () => {
    fetchMock.mockImplementation(async () => json({}));
    await fetchJson('https://x/nc');
    await fetchJson('https://x/nc');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses cacheKey instead of url', async () => {
    fetchMock.mockImplementation(async () => json({ v: 1 }));
    await fetchJson('https://x/k1', { ttlMs: 5000, cacheKey: 'shared' });
    const r = await fetchJson('https://x/k2', { ttlMs: 5000, cacheKey: 'shared' });
    expect(r.fromCache).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent calls for the same key', async () => {
    let release!: () => void;
    fetchMock.mockImplementation(() => new Promise<Response>((res) => (release = () => res(json({ d: 1 })))));
    const p1 = fetchJson('https://x/d');
    const p2 = fetchJson('https://x/d');
    await Promise.resolve();
    release();
    const [a, b] = await Promise.all([p1, p2]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('falls back to a stale entry when the network fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    fetchMock.mockResolvedValueOnce(json({ v: 'old' }));
    await fetchJson('https://x/s', { ttlMs: 1000 });
    vi.setSystemTime(Date.now() + 5000);
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));
    const r = await fetchJson<{ v: string }>('https://x/s', { ttlMs: 1000, retries: 0 });
    expect(r.stale).toBe(true);
    expect(r.fromCache).toBe(true);
    expect(r.data.v).toBe('old');
    // allowStale:false throws instead
    await expect(fetchJson('https://x/s', { ttlMs: 1000, retries: 0, allowStale: false })).rejects.toMatchObject({ status: 500 });
  });

  it('honours the Expires header over ttlMs', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const expires = new Date(Date.now() + 60_000).toUTCString();
    fetchMock.mockImplementation(async () => json({ e: 1 }, { headers: { Expires: expires } }));
    await fetchJson('https://x/e', { honourExpires: true });
    vi.setSystemTime(Date.now() + 30_000);
    const hit = await fetchJson('https://x/e', { honourExpires: true });
    expect(hit.fromCache).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 40_000);
    await fetchJson('https://x/e', { honourExpires: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores Expires unless honourExpires', async () => {
    const expires = new Date(Date.now() + 60_000).toUTCString();
    fetchMock.mockImplementation(async () => json({ e: 1 }, { headers: { Expires: expires } }));
    await fetchJson('https://x/e2');
    await fetchJson('https://x/e2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('IndexedDB persistence', () => {
  it('idbSet/idbGet round-trip', async () => {
    await idbSet('k', { a: [1, 2] });
    expect(await idbGet('k')).toEqual({ a: [1, 2] });
    expect(await idbGet('missing')).toBeUndefined();
  });

  it('persist:true survives a memory-cache clear', async () => {
    fetchMock.mockImplementation(async () => json({ p: 1 }));
    await fetchJson('https://x/idb', { ttlMs: 60_000, persist: true });
    await new Promise((r) => setTimeout(r, 20)); // let the fire-and-forget write land
    clearMemoryCache();
    const r = await fetchJson('https://x/idb', { ttlMs: 60_000, persist: true });
    expect(r.fromCache).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves stale from IDB when offline', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    fetchMock.mockResolvedValueOnce(json({ p: 'idb-old' }));
    await fetchJson('https://x/idb2', { ttlMs: 1000, persist: true });
    vi.useRealTimers(); // let async IDB callbacks flush
    await new Promise((r) => setTimeout(r, 20));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 10_000);
    clearMemoryCache();
    fetchMock.mockRejectedValue(new TypeError('offline'));
    const r = await fetchJson<{ p: string }>('https://x/idb2', { ttlMs: 1000, persist: true, retries: 0 });
    expect(r.stale).toBe(true);
    expect(r.data.p).toBe('idb-old');
  });

  it('is a graceful no-op when indexedDB is undefined', async () => {
    resetIdbConnection();
    vi.stubGlobal('indexedDB', undefined);
    await expect(idbSet('z', 1)).resolves.toBeUndefined();
    expect(await idbGet('z')).toBeUndefined();
    fetchMock.mockImplementation(async () => json({ ok: 1 }));
    const r = await fetchJson('https://x/noidb', { ttlMs: 1000, persist: true });
    expect(r.data).toEqual({ ok: 1 });
  });

  it('is a graceful no-op when indexedDB.open throws', async () => {
    resetIdbConnection();
    vi.stubGlobal('indexedDB', {
      open() {
        throw new Error('SecurityError');
      },
    });
    await expect(idbSet('z', 1)).resolves.toBeUndefined();
    expect(await idbGet('z')).toBeUndefined();
  });
});

describe('fetchViaProxyOrDirect', () => {
  const P = '/api/thing.php?x=1';
  const D = 'https://upstream/thing?x=1';
  const byUrl = (map: Record<string, () => Response | Promise<Response>>) =>
    fetchMock.mockImplementation(async (url: string) => {
      const h = map[url];
      if (!h) throw new TypeError('unexpected ' + url);
      return h();
    });

  it('uses the proxy when it works', async () => {
    byUrl({ [P]: () => json({ from: 'proxy' }) });
    const r = await fetchViaProxyOrDirect<{ from: string }>(P, D);
    expect(r.via).toBe('proxy');
    expect(r.data.from).toBe('proxy');
  });

  it.each([
    ['404', () => new Response('', { status: 404 })],
    ['502', () => new Response('', { status: 502 })],
    ['HTML 200', () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } })],
  ])('falls back to direct on proxy %s', async (_n, bad) => {
    byUrl({ [P]: bad, [D]: () => json({ from: 'direct' }) });
    const r = await fetchViaProxyOrDirect<{ from: string }>(P, D, { backoffMs: 1 });
    expect(r.via).toBe('direct');
    expect(r.data.from).toBe('direct');
  });

  it('falls back to direct on proxy network error', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === P) throw new TypeError('connection refused');
      return json({ from: 'direct' });
    });
    const r = await fetchViaProxyOrDirect<{ from: string }>(P, D, { backoffMs: 1 });
    expect(r.via).toBe('direct');
  });

  it('throws when both fail', async () => {
    byUrl({ [P]: () => new Response('', { status: 404 }), [D]: () => new Response('', { status: 500 }) });
    await expect(fetchViaProxyOrDirect(P, D, { backoffMs: 1, retries: 0 })).rejects.toBeInstanceOf(HttpError);
  });

  it('keeps via on cache hits and serves stale only after both fail', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    byUrl({ [P]: () => json({ v: 1 }) });
    await fetchViaProxyOrDirect(P, D, { ttlMs: 1000 });
    const hit = await fetchViaProxyOrDirect(P, D, { ttlMs: 1000 });
    expect(hit.fromCache).toBe(true);
    expect(hit.via).toBe('proxy');
    vi.setSystemTime(Date.now() + 5000);
    byUrl({ [P]: () => new Response('', { status: 404 }), [D]: () => new Response('', { status: 500 }) });
    const r = await fetchViaProxyOrDirect(P, D, { ttlMs: 1000, retries: 0 });
    expect(r.stale).toBe(true);
  });
});

describe('free-tier protection', () => {
  it('a forced refresh reuses a cached copy younger than MIN_FORCE_AGE_MS', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    fetchMock.mockImplementation(async () => json({ v: 1 }));
    await fetchJson('https://x/f', { ttlMs: 60 * 60_000 });
    const r = await fetchJson('https://x/f', { ttlMs: 60 * 60_000, bypassCache: true });
    expect(r.fromCache).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + MIN_FORCE_AGE_MS);
    const r2 = await fetchJson('https://x/f', { ttlMs: 60 * 60_000, bypassCache: true });
    expect(r2.fromCache).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caps real requests per host per minute, then recovers', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    fetchMock.mockImplementation(async () => json({ ok: 1 }));
    for (let i = 0; i < HOST_BUDGET_PER_MIN; i++) await fetchJson(`https://busy.example/${i}`, { retries: 0 });
    await expect(fetchJson('https://busy.example/over', { retries: 0 })).rejects.toMatchObject({ status: 429 });
    await expect(fetchJson('https://other.example/ok', { retries: 0 })).resolves.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(HOST_BUDGET_PER_MIN + 1);
    vi.setSystemTime(Date.now() + 61_000);
    await expect(fetchJson('https://busy.example/later', { retries: 0 })).resolves.toBeTruthy();
  });

  it('does not go direct when our API answered with an error (e.g. 429)', async () => {
    const P = '/api/thing.php';
    const D = 'https://upstream.example/thing';
    fetchMock.mockImplementation(async (url: string) =>
      url === P ? new Response('{"error":{}}', { status: 429, headers: { 'x-raincheck-api': '1' } }) : json({ from: 'direct' }),
    );
    await expect(fetchViaProxyOrDirect(P, D, { backoffMs: 1 })).rejects.toMatchObject({ status: 429 });
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([P]);
  });

  it('serves the stale local copy when our API errors', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const P = '/api/s.php';
    const D = 'https://upstream.example/s';
    fetchMock.mockImplementation(async () => json({ v: 'old' }));
    await fetchViaProxyOrDirect(P, D, { ttlMs: 1000 });
    vi.setSystemTime(Date.now() + 5000);
    fetchMock.mockImplementation(async (url: string) =>
      url === P ? new Response('', { status: 502, headers: { 'x-raincheck-api': '1' } }) : json({ v: 'direct' }),
    );
    const r = await fetchViaProxyOrDirect<{ v: string }>(P, D, { ttlMs: 1000, backoffMs: 1 });
    expect(r.stale).toBe(true);
    expect(r.data.v).toBe('old');
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === D)).toBe(false);
  });
});

describe('errReason for our own API', () => {
  it('explains the daily budget and rate limit in words', async () => {
    const { errReason, HttpError } = await import('../../src/sources/http');
    const api = (status: number) => Object.assign(new HttpError('http', status, 'x'), { fromApi: true });
    expect(errReason(api(503))).toBe('daily free limit reached, back after midnight');
    expect(errReason(api(429))).toBe('busy, try again in a minute');
    expect(errReason(new HttpError('http', 503, 'x'))).toBe('HTTP 503');
  });
});
