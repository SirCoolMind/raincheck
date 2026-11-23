import { describe, it, expect } from 'vitest';
import { districtFor } from '../../src/core/timing';
import { TEST_ROUTE } from './testRoute';

describe('districtFor', () => {
  const wps = [...TEST_ROUTE];
  it('uses the district pinned on a waypoint within 4 km', () => {
    // Near the Cyberjaya pin the pin's district wins; near KLCC it is Kuala Lumpur.
    expect(districtFor({ lat: 2.925, lon: 101.655 }, wps)).toBe('Sepang');
    expect(districtFor({ lat: 3.157, lon: 101.711 }, wps)).toBe('Kuala Lumpur');
  });
  it('falls back to the Putrajaya bbox beyond 4 km of any pin', () => {
    expect(districtFor({ lat: 2.93, lon: 101.69 }, wps)).toBe('Putrajaya');
  });
  it('falls back to nearest centroid with no waypoints', () => {
    expect(districtFor({ lat: 2.83, lon: 101.56 })).toBe('Kuala Langat');
    expect(districtFor({ lat: 3.14, lon: 101.69 })).toBe('Kuala Lumpur');
  });
  it('ignores waypoints without a district', () => {
    expect(districtFor({ lat: 2.9226, lon: 101.651 }, [{ id: 'x', name: 'x', lat: 2.9226, lon: 101.651 }])).not.toBe('');
  });
});

describe('nationwide districts', () => {
  it('has every MET Malaysia district with an id, a state and a Malaysian location', async () => {
    const { DISTRICTS } = await import('../../src/config');
    expect(DISTRICTS.length).toBe(168);
    for (const d of DISTRICTS) {
      expect(d.locationId).toMatch(/^Ds\d{3}$/);
      expect(d.state).not.toBe('');
      expect(d.lat).toBeGreaterThan(0);
      expect(d.lat).toBeLessThan(8);
      expect(d.lon).toBeGreaterThan(99);
      expect(d.lon).toBeLessThan(120);
    }
    expect(new Set(DISTRICTS.map((d) => d.name)).size).toBe(DISTRICTS.length);
  });

  it('maps cities outside the Klang Valley to their district', () => {
    expect(districtFor({ lat: 1.4927, lon: 103.7414 })).toBe('Johor Bahru');
    expect(districtFor({ lat: 1.553, lon: 110.359 })).toBe('Kuching');
    expect(districtFor({ lat: 5.4141, lon: 100.3288 })).toBe('Timur Laut'); // George Town
    expect(districtFor({ lat: 4.5975, lon: 101.0901 })).toBe('Kinta'); // Ipoh
  });
});
