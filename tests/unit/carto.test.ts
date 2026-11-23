import { describe, it, expect } from 'vitest';
import { isCartoUrl, toCartoProxy, transformCarto, withCartoKey } from '../../src/ui/cartoUrl';

const K = 'TESTKEY123';

describe('withCartoKey', () => {
  it('adds ?key= when there is no query string', () => {
    expect(withCartoKey('https://basemaps.cartocdn.com/gl/positron-gl-style/style.json', K)).toBe(
      'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json?key=TESTKEY123',
    );
  });
  it('adds &key= when a query string exists', () => {
    expect(withCartoKey('https://tiles.basemaps.cartocdn.com/vectortiles/carto.streets/v1/1/2/3.mvt?x=1', K)).toBe(
      'https://tiles.basemaps.cartocdn.com/vectortiles/carto.streets/v1/1/2/3.mvt?x=1&key=TESTKEY123',
    );
  });
  it('does not add the key twice', () => {
    const u = 'https://basemaps.cartocdn.com/a.json?key=OTHER';
    expect(withCartoKey(u, K)).toBe(u);
    expect(withCartoKey(withCartoKey('https://basemaps.cartocdn.com/a.json', K), K)).toBe(
      'https://basemaps.cartocdn.com/a.json?key=TESTKEY123',
    );
  });
  it('leaves non-CARTO hosts untouched', () => {
    for (const u of [
      'https://tilecache.rainviewer.com/v2/radar/x/256/7/1/2/2/0_0.png',
      'https://evil.example/basemaps.cartocdn.com/x',
      'https://basemaps.cartocdn.com.evil.example/x',
      '/api/carto.php?p=x',
    ]) {
      expect(withCartoKey(u, K)).toBe(u);
    }
  });
  it('handles a trailing ? and a hash', () => {
    expect(withCartoKey('https://basemaps.cartocdn.com/a.json?', K)).toBe('https://basemaps.cartocdn.com/a.json?key=TESTKEY123');
    expect(withCartoKey('https://basemaps.cartocdn.com/a.json#z', K)).toBe('https://basemaps.cartocdn.com/a.json?key=TESTKEY123#z');
  });
  it('no key → unchanged', () => {
    expect(withCartoKey('https://basemaps.cartocdn.com/a.json', '')).toBe('https://basemaps.cartocdn.com/a.json');
  });
  it('covers subdomain hosts', () => {
    expect(isCartoUrl('https://a.basemaps.cartocdn.com/x.png')).toBe(true);
    expect(isCartoUrl('https://e.basemaps.cartocdn.com/x.png')).toBe(false);
  });
});

describe('toCartoProxy', () => {
  it('rewrites to the same-origin proxy and drops any key', () => {
    expect(toCartoProxy('https://basemaps.cartocdn.com/gl/positron-gl-style/style.json?key=X', 'https://app.test')).toBe(
      'https://app.test/api/carto.php?p=gl%2Fpositron-gl-style%2Fstyle.json',
    );
  });
  it('keeps the host for subdomains and other params', () => {
    expect(toCartoProxy('https://tiles.basemaps.cartocdn.com/v/1/2/3.mvt?a=1', 'http://l')).toBe(
      'http://l/api/carto.php?p=v%2F1%2F2%2F3.mvt&h=tiles.basemaps.cartocdn.com&a=1',
    );
  });
  it('leaves non-CARTO untouched', () => {
    expect(toCartoProxy('https://osm.org/1/2/3.png', 'http://l')).toBe('https://osm.org/1/2/3.png');
  });
});

describe('transformCarto', () => {
  it('dispatches by mode', () => {
    const u = 'https://basemaps.cartocdn.com/a.json';
    expect(transformCarto(u, 'direct', K, 'http://l')).toContain('key=TESTKEY123');
    expect(transformCarto(u, 'proxy', K, 'http://l')).toBe('http://l/api/carto.php?p=a.json');
    expect(transformCarto(u, 'none', K, 'http://l')).toBe(u);
  });
});
