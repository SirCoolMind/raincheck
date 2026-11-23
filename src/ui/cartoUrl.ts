// PURE helpers for CARTO basemap URLs (unit-tested). The key value is never logged.

export const CARTO_HOSTS = new Set([
  'basemaps.cartocdn.com',
  'tiles.basemaps.cartocdn.com',
  'a.basemaps.cartocdn.com',
  'b.basemaps.cartocdn.com',
  'c.basemaps.cartocdn.com',
  'd.basemaps.cartocdn.com',
]);

export type CartoMode = 'direct' | 'proxy' | 'none';

export const CARTO_STYLES = {
  light: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
} as const;

function hostOf(url: string): string | null {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url);
  return m ? m[1]!.toLowerCase() : null;
}

export function isCartoUrl(url: string): boolean {
  const h = hostOf(url);
  return h !== null && CARTO_HOSTS.has(h);
}

/** Append `key=` to a CARTO URL: `?` or `&` as needed, never twice. Non-CARTO URLs are returned untouched. */
export function withCartoKey(url: string, key: string): string {
  if (!key || !isCartoUrl(url)) return url;
  const hashAt = url.indexOf('#');
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const q = base.indexOf('?');
  if (q >= 0) {
    const params = base.slice(q + 1).split('&');
    if (params.some((p) => p.startsWith('key='))) return url;
  }
  return `${base}${q >= 0 ? (base.endsWith('?') || base.endsWith('&') ? '' : '&') : '?'}key=${encodeURIComponent(key)}${hash}`;
}

/** Rewrite a CARTO URL to the same-origin PHP proxy, which adds the key server-side. */
export function toCartoProxy(url: string, origin: string, proxyPath = '/api/carto.php'): string {
  if (!isCartoUrl(url)) return url;
  const m = /^https?:\/\/([^/?#]+)\/([^?#]*)(?:\?([^#]*))?/i.exec(url);
  if (!m) return url;
  const host = m[1]!.toLowerCase();
  const path = m[2] ?? '';
  const rest = (m[3] ?? '')
    .split('&')
    .filter((p) => p && !p.startsWith('key='))
    .join('&');
  const h = host === 'basemaps.cartocdn.com' ? '' : `&h=${encodeURIComponent(host)}`;
  return `${origin}${proxyPath}?p=${encodeURIComponent(path)}${h}${rest ? `&${rest}` : ''}`;
}

export function transformCarto(url: string, mode: CartoMode, key: string, origin: string): string {
  if (mode === 'direct') return withCartoKey(url, key);
  if (mode === 'proxy') return toCartoProxy(url, origin);
  return url;
}
