// Network core: timeout + retry/backoff, memory + IndexedDB cache, in-flight dedupe, stale fallback.

export type HttpReason = 'timeout' | 'network' | 'http' | 'parse';

export class HttpError extends Error {
  readonly status?: number;
  readonly reason: HttpReason;
  /** True when our own PHP API produced the error (it sends `X-RainCheck-Api: 1`). */
  fromApi = false;
  constructor(reason: HttpReason, status?: number, message?: string) {
    super(message ?? (status ? `HTTP ${status}` : reason));
    this.name = 'HttpError';
    this.reason = reason;
    if (status !== undefined) this.status = status;
  }
}

// ───────────── free-tier protection ─────────────
/** A manual Refresh only goes back to the network if the cached copy is at least this old. */
export const MIN_FORCE_AGE_MS = 5 * 60 * 1000;
/** Hard ceiling on real network requests per host per minute (backstop against loops/bugs). */
export const HOST_BUDGET_PER_MIN = 40;
const hostHits = new Map<string, number[]>();

function hostOf(url: string): string {
  try {
    return new URL(url, 'http://same-origin.invalid/').host;
  } catch {
    return 'unknown';
  }
}

/** Reserve one request against the host's per-minute budget, or throw a local 429. */
function takeBudget(url: string): void {
  // Our own /api proxy has its own server cache + per-IP limit; the budget guards third-party hosts.
  if (url.startsWith('/')) return;
  const host = hostOf(url);
  const now = Date.now();
  const hits = (hostHits.get(host) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= HOST_BUDGET_PER_MIN) {
    hostHits.set(host, hits);
    throw new HttpError('http', 429, `local request budget reached for ${host}`);
  }
  hits.push(now);
  hostHits.set(host, hits);
}

export interface FetchOpts {
  timeoutMs?: number;
  retries?: number;
  /** Base backoff in ms (default 400, doubled per attempt, plus jitter). */
  backoffMs?: number;
  ttlMs?: number;
  cacheKey?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  persist?: boolean;
  honourExpires?: boolean;
  /** Return a stale cached entry when the network fails (default true). */
  allowStale?: boolean;
  /** Label stored with the cache entry and returned as `via` (set by fetchViaProxyOrDirect). */
  via?: string;
  /** Skip a fresh cache hit (user pressed Refresh). A cached entry is still the stale fallback. */
  bypassCache?: boolean;
}

/** Tuning knobs adapters accept so callers/tests can shorten retries. */
export type FetchTune = Pick<FetchOpts, 'timeoutMs' | 'retries' | 'backoffMs' | 'signal' | 'bypassCache'>;

/** Once the same-origin proxy is clearly absent (network error / 404 / HTML), skip it for this page session. */
let proxyDown = false;
export function resetProxyState(): void {
  proxyDown = false;
}

export interface FetchResult<T> {
  data: T;
  fromCache: boolean;
  stale: boolean;
  fetchedAt: number;
  via?: string;
}

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  expiresAt: number;
  via?: string;
}

const mem = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<FetchResult<unknown>>>();

export function clearMemoryCache(): void {
  proxyDown = false;
  mem.clear();
  inflight.clear();
  hostHits.clear();
}

// ───────────── IndexedDB (tiny, never throws) ─────────────
const DB_NAME = 'raincheck';
const STORE = 'http';
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  const p = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  dbPromise = p.then((db) => {
    if (!db) dbPromise = null; // allow a later retry
    return db;
  });
  return dbPromise;
}

/** Test hook: drop the cached connection (e.g. after swapping the global indexedDB). */
export function resetIdbConnection(): void {
  void dbPromise?.then((db) => db?.close()).catch(() => undefined);
  dbPromise = null;
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDb();
    if (!db) return undefined;
    return await new Promise<T | undefined>((resolve) => {
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  } catch {
    return undefined;
  }
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch {
    /* no-op */
  }
}

// ───────────── fetch core ─────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function looksLikeHtml(text: string, contentType: string | null): boolean {
  if (contentType && /text\/html/i.test(contentType)) return true;
  return /^\s*</.test(text);
}

async function attempt<T>(
  url: string,
  o: Required<Pick<FetchOpts, 'timeoutMs'>> & FetchOpts,
): Promise<{ data: T; expires: number | null }> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  o.signal?.addEventListener('abort', onAbort);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(new HttpError('timeout', undefined, 'timeout'));
      }, o.timeoutMs);
    });
    const work = (async () => {
      let res: Response;
      takeBudget(url);
      try {
        res = await fetch(url, { headers: o.headers, signal: ctrl.signal });
      } catch (e) {
        throw new HttpError('network', undefined, e instanceof Error ? e.message : 'network error');
      }
      if (!res.ok) {
        const err = new HttpError('http', res.status);
        err.fromApi = res.headers.get('x-raincheck-api') === '1';
        throw err;
      }
      let text: string;
      try {
        text = await res.text();
      } catch {
        throw new HttpError('network', undefined, 'body read failed');
      }
      if (looksLikeHtml(text, res.headers.get('content-type'))) {
        throw new HttpError('parse', res.status, 'HTML instead of JSON');
      }
      let data: T;
      try {
        data = JSON.parse(text) as T;
      } catch {
        throw new HttpError('parse', res.status, 'invalid JSON');
      }
      const exp = res.headers.get('expires');
      const t = exp ? Date.parse(exp) : NaN;
      return { data, expires: Number.isFinite(t) ? t : null };
    })();
    work.catch(() => undefined); // avoid unhandled rejection when the timeout wins
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    o.signal?.removeEventListener('abort', onAbort);
  }
}

function retryable(e: HttpError): boolean {
  if (e.reason === 'timeout' || e.reason === 'network') return true;
  // 429 = "slow down": never hammer a rate-limited free API with retries.
  if (e.reason === 'http') return (e.status ?? 0) >= 500;
  return false;
}

async function readCache<T>(key: string, persist: boolean): Promise<CacheEntry<T> | undefined> {
  const m = mem.get(key) as CacheEntry<T> | undefined;
  if (m) return m;
  if (!persist) return undefined;
  const d = await idbGet<CacheEntry<T>>(key);
  if (d && typeof d.fetchedAt === 'number' && typeof d.expiresAt === 'number') {
    mem.set(key, d);
    return d;
  }
  return undefined;
}

async function run<T>(url: string, opts: FetchOpts, key: string): Promise<FetchResult<T>> {
  const { timeoutMs = 8000, retries = 1, backoffMs = 400, ttlMs = 0, persist = false, allowStale = true } = opts;
  const cached = await readCache<T>(key, persist);
  // A forced refresh still uses a fresh-enough copy: free APIs shouldn't see a call per button press.
  const force = opts.bypassCache === true && !!cached && Date.now() - cached.fetchedAt >= MIN_FORCE_AGE_MS;
  if (cached && !force && Date.now() < cached.expiresAt) {
    return { data: cached.data, fromCache: true, stale: false, fetchedAt: cached.fetchedAt, via: cached.via ?? 'cache' };
  }
  let lastErr: HttpError = new HttpError('network');
  for (let n = 0; n <= retries; n++) {
    if (opts.signal?.aborted) {
      lastErr = new HttpError('network', undefined, 'aborted');
      break;
    }
    try {
      const { data, expires } = await attempt<T>(url, { ...opts, timeoutMs });
      const now = Date.now();
      let expiresAt = now + ttlMs;
      if (opts.honourExpires && expires !== null) expiresAt = Math.max(expires, now);
      const entry: CacheEntry<T> = { data, fetchedAt: now, expiresAt, ...(opts.via ? { via: opts.via } : {}) };
      if (expiresAt > now) {
        mem.set(key, entry);
        if (persist) void idbSet(key, entry);
      }
      return { data, fromCache: false, stale: false, fetchedAt: now, ...(opts.via ? { via: opts.via } : {}) };
    } catch (e) {
      lastErr = e instanceof HttpError ? e : new HttpError('network', undefined, String(e));
      if (!retryable(lastErr) || n === retries) break;
      await sleep(backoffMs * 2 ** n + Math.random() * backoffMs * 0.25);
    }
  }
  if (allowStale && cached) {
    return { data: cached.data, fromCache: true, stale: true, fetchedAt: cached.fetchedAt, via: cached.via ?? 'cache' };
  }
  throw lastErr;
}

export function fetchJson<T>(url: string, opts: FetchOpts = {}): Promise<FetchResult<T>> {
  const key = opts.cacheKey ?? url;
  const existing = inflight.get(key) as Promise<FetchResult<T>> | undefined;
  if (existing) return existing;
  const p = run<T>(url, opts, key).finally(() => {
    if (inflight.get(key) === p) inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

/** Proxy first; any failure (network, 404, 502, HTML/parse, ...) falls back to the upstream directly. */
export async function fetchViaProxyOrDirect<T>(
  proxyUrl: string,
  directUrl: string,
  opts: FetchOpts = {},
): Promise<FetchResult<T>> {
  const cacheKey = opts.cacheKey ?? directUrl;
  if (!proxyDown) {
    try {
      // The proxy attempt must not answer with stale data: direct might still succeed.
      // Short timeout: a missing proxy should cost ~3 s once, not 40 s per source.
      return await fetchJson<T>(proxyUrl, {
        ...opts,
        cacheKey,
        via: 'proxy',
        timeoutMs: Math.min(opts.timeoutMs ?? 8000, 4000),
        retries: Math.min(opts.retries ?? 2, 1),
        allowStale: false,
      });
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      if (e instanceof HttpError && e.fromApi) {
        // Our server is up and answered (rate limit, or upstream down with nothing cached).
        // Going direct would just add the browser's own calls to the free API on top: don't.
        const stale = await readCache<T>(cacheKey, opts.persist ?? false);
        if (stale && opts.allowStale !== false) {
          return { data: stale.data, fromCache: true, stale: true, fetchedAt: stale.fetchedAt, via: stale.via ?? 'cache' };
        }
        throw e;
      }
      // No API behind /api (404, HTML page, connection refused, dev-proxy 5xx): use the upstream directly.
      proxyDown = true;
    }
  }
  return fetchJson<T>(directUrl, { ...opts, cacheKey, via: 'direct' });
}

/** Plain-language reason for a failed fetch (for SourceHealth.reason). */
export function errReason(e: unknown): string {
  if (e instanceof HttpError) {
    if (e.reason === 'timeout') return 'timeout';
    if (e.reason === 'network') return 'network error';
    // Our server says this free source is at its daily cap (it resets at midnight MYT).
    if (e.reason === 'http' && e.status === 503 && e.fromApi) return 'daily free limit reached, back after midnight';
    if (e.reason === 'http' && e.status === 429 && e.fromApi) return 'busy, try again in a minute';
    if (e.reason === 'http') return `HTTP ${e.status ?? '?'}`;
    return 'unreadable response';
  }
  return 'network error';
}

/** "cached 12 min" style label for stale fallbacks. */
export function cachedReason(fetchedAt: number, now = Date.now()): string {
  return `cached ${Math.max(0, Math.round((now - fetchedAt) / 60000))} min`;
}
