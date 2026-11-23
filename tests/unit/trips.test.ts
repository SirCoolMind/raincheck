import { describe, expect, it } from 'vitest';
import type { Waypoint } from '../../src/config';
import {
  MAX_STOPS,
  MAX_TRIPS,
  addTrip,
  autoTripMin,
  assignSlot,
  emptyTrips,
  decodeTrip,
  displayName,
  encodeTrip,
  findSameTrip,
  mergeTrips,
  deleteTrip,
  editSlotStops,
  loadTrips,
  migrateV1,
  renameTrip,
  resolveSlot,
  sanitizeTrips,
  setCustomFollow,
  setCustomReverse,
  setEveningMirror,
  setSlotTime,
  setSlotTripMin,
  type TripsState,
} from '../../src/core/trips';

const wp = (id: string, lat = 3, lon = 101.5): Waypoint => ({ id, name: id.toUpperCase(), lat, lon });
const AB = [wp('a', 3.0), wp('b', 3.1)];
const XYZ = [wp('x', 2.9), wp('y', 3.0), wp('z', 3.2)];
const ids = (w: Waypoint[]) => w.map((p) => p.id);

/** Morning = A→B; plus a saved X→Y→Z trip. */
function two(): { s: TripsState; xyz: string } {
  const base = migrateV1({ waypoints: AB });
  const { state, trip } = addTrip(base, XYZ, 'Gym');
  return { s: state, xyz: trip!.id };
}

describe('migration from v1', () => {
  it('turns the v1 route, times and length into the Morning trip; Evening mirrors it', () => {
    const s = migrateV1({ waypoints: AB, presets: { morning: { time: '06:45' }, evening: { time: '17:30' } }, tripMin: 75 });
    expect(s.trips).toHaveLength(1);
    expect(s.trips[0]!.name).toBe('A → B');
    expect(s.trips[0]!.tripMin).toBe(75);
    expect(s.morning).toEqual({ tripId: s.trips[0]!.id, time: '06:45' });
    expect(s.evening).toMatchObject({ tripId: null, time: '17:30', mirror: true });
    expect(ids(resolveSlot(s, 'morning').stops)).toEqual(['a', 'b']);
    expect(ids(resolveSlot(s, 'evening').stops)).toEqual(['b', 'a']);
  });

  it('without a saved v1 route, starts with no trips but keeps the v1 times', () => {
    for (const v1 of [{}, { waypoints: 'junk', presets: 5, tripMin: 9999 }, { waypoints: [wp('only')] }]) {
      const s = migrateV1(v1);
      expect(s.trips).toEqual([]);
      expect(s.morning).toEqual({ tripId: null, time: '07:30' });
      expect(s.evening.time).toBe('18:00');
    }
    expect(migrateV1({ presets: { morning: { time: '06:10' } } }).morning.time).toBe('06:10');
  });

  it('keeps the highway flag and district on migrated pins', () => {
    const s = migrateV1({ waypoints: [{ ...wp('a'), highway: true, district: 'Sepang' }, wp('b')] });
    expect(s.trips[0]!.stops[0]).toMatchObject({ highway: true, district: 'Sepang' });
  });

  it('loadTrips prefers valid v2 storage over v1 keys', () => {
    const { s } = two();
    const loaded = loadTrips(JSON.parse(JSON.stringify(s)), { waypoints: XYZ });
    expect(loaded).toEqual(s);
    expect(ids(loadTrips({ version: 1 }, { waypoints: XYZ }).trips[0]!.stops)).toEqual(['x', 'y', 'z']);
  });
});

describe('sanitizeTrips', () => {
  it('drops broken trips, duplicate ids and dangling tab references', () => {
    const { s, xyz } = two();
    const raw = JSON.parse(JSON.stringify(assignSlot(s, 'custom', xyz)));
    raw.trips.push({ id: 'bad', name: 'x', stops: [wp('a')], tripMin: 60 }); // one stop
    raw.trips.push({ ...raw.trips[0] }); // duplicate id
    raw.trips = raw.trips.filter((t: { id: string }) => t.id !== xyz);
    raw.evening = { tripId: 'gone', time: '25:00', mirror: false };
    const clean = sanitizeTrips(raw)!;
    expect(clean.trips).toHaveLength(1);
    expect(clean.custom).toEqual({ tripId: null, reverse: false, follow: true });
    expect(clean.evening).toEqual({ tripId: null, time: '18:00', mirror: false });
  });

  it('caps the library and rejects non-objects', () => {
    const raw = { ...emptyTrips(), trips: Array.from({ length: MAX_TRIPS + 5 }, (_, i) => ({ id: `t${i}`, name: '', stops: AB, tripMin: 60 })) };
    expect(sanitizeTrips(raw)!.trips).toHaveLength(MAX_TRIPS);
    expect(sanitizeTrips(raw)!.trips[0]!.name).toBe('A → B');
    expect(sanitizeTrips(null)).toBeNull();
    expect(sanitizeTrips('x')).toBeNull();
  });
});

describe('resolveSlot', () => {
  it('Evening uses its own trip only when not mirroring', () => {
    const { s, xyz } = two();
    const own = assignSlot(s, 'evening', xyz);
    expect(own.evening.mirror).toBe(false);
    expect(ids(resolveSlot(own, 'evening').stops)).toEqual(['x', 'y', 'z']);
    expect(ids(resolveSlot(setEveningMirror(own, true), 'evening').stops)).toEqual(['b', 'a']);
  });

  it('Custom defaults to the Morning trip and can be reversed or pointed at any trip', () => {
    const { s, xyz } = two();
    expect(ids(resolveSlot(s, 'custom').stops)).toEqual(['a', 'b']);
    expect(ids(resolveSlot(setCustomReverse(s, true), 'custom').stops)).toEqual(['b', 'a']);
    const c = setCustomReverse(assignSlot(s, 'custom', xyz), true);
    expect(ids(resolveSlot(c, 'custom').stops)).toEqual(['z', 'y', 'x']);
    expect(resolveSlot(c, 'custom').reversed).toBe(true);
    // Emptying Custom gives the setup card, not the Morning trip; following Morning brings it back.
    const blank = assignSlot(s, 'custom', null);
    expect(resolveSlot(blank, 'custom').trip).toBeNull();
    expect(ids(resolveSlot(setCustomFollow(blank), 'custom').stops)).toEqual(['a', 'b']);
    // An empty Evening stops mirroring.
    expect(resolveSlot(assignSlot(s, 'evening', null), 'evening').trip).toBeNull();
  });

  it('an empty tab resolves to no trip and no stops', () => {
    const s = emptyTrips();
    expect(resolveSlot(s, 'morning')).toEqual({ trip: null, stops: [], reversed: false });
    expect(resolveSlot(s, 'evening').stops).toEqual([]);
  });
});

describe('editing', () => {
  it('edits on a mirrored Evening land on the Morning trip in its own order', () => {
    const { s } = two();
    const next = editSlotStops(s, 'evening', (travel) => {
      travel.splice(1, 0, wp('via'));
      return travel;
    });
    expect(ids(resolveSlot(next, 'evening').stops)).toEqual(['b', 'via', 'a']);
    expect(ids(resolveSlot(next, 'morning').stops)).toEqual(['a', 'via', 'b']);
    expect(s.trips[0]!.stops).toHaveLength(2); // input not mutated
  });

  it('rejects edits that leave fewer than 2 or more than MAX_STOPS pins', () => {
    const { s } = two();
    expect(editSlotStops(s, 'morning', (t) => t.slice(0, 1))).toBe(s);
    expect(editSlotStops(s, 'morning', () => Array.from({ length: MAX_STOPS + 1 }, (_, i) => wp(`p${i}`)))).toBe(s);
  });

  it('trip length and tab times validate their input', () => {
    const { s } = two();
    expect(setSlotTripMin(s, 'evening', 90).trips[0]!.tripMin).toBe(90); // mirror → Morning trip
    expect(setSlotTripMin(s, 'morning', 5)).toBe(s);
    expect(setSlotTime(s, 'evening', '17:15').evening.time).toBe('17:15');
    expect(setSlotTime(s, 'morning', '7:15')).toBe(s);
  });
});

describe('library', () => {
  it('adds, renames and deletes; deleting clears tabs that used the trip', () => {
    const { s, xyz } = two();
    expect(s.trips.map((t) => t.name)).toEqual(['A → B', 'Gym']);
    const renamed = renameTrip(s, xyz, '  Gym run  ');
    expect(renamed.trips[1]!.name).toBe('Gym run');
    expect(renameTrip(s, xyz, '   ')).toBe(s);
    const used = assignSlot(assignSlot(renamed, 'evening', xyz), 'custom', xyz);
    const del = deleteTrip(used, xyz);
    expect(del.trips).toHaveLength(1);
    expect(del.evening).toMatchObject({ tripId: null, mirror: true });
    expect(del.custom).toMatchObject({ tripId: null, follow: true });
    expect(ids(resolveSlot(del, 'evening').stops)).toEqual(['b', 'a']);
  });

  it('refuses to add past the library cap or with invalid stops', () => {
    let s = emptyTrips();
    for (let i = 0; i < MAX_TRIPS; i++) s = addTrip(s, AB).state;
    expect(s.trips).toHaveLength(MAX_TRIPS);
    expect(addTrip(s, AB).trip).toBeNull();
    expect(addTrip(emptyTrips(), [wp('a')]).trip).toBeNull();
  });

  it('assignSlot ignores unknown trip ids', () => {
    const s = emptyTrips();
    expect(assignSlot(s, 'custom', 'nope').custom.tripId).toBeNull();
  });
});

describe('display name', () => {
  it('a mirrored auto-name follows the driving order; a custom name gets "(return)"', () => {
    const { s } = two();
    expect(displayName(resolveSlot(s, 'morning'))).toBe('A → B');
    expect(displayName(resolveSlot(s, 'evening'))).toBe('B → A');
    const named = renameTrip(s, s.trips[0]!.id, 'Work');
    expect(displayName(resolveSlot(named, 'evening'))).toBe('Work (return)');
    expect(displayName(resolveSlot(emptyTrips(), 'morning'))).toBe('');
  });
});

describe('share links', () => {
  it('round-trips a trip (names with non-ASCII, highway flag, length)', () => {
    const stops = [{ ...wp('a'), name: 'KLCC – KL' }, { ...wp('b', 3.2), highway: true }];
    const code = encodeTrip({ name: 'Kerja ☔', stops, tripMin: 45 });
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = decodeTrip(code)!;
    expect(back.name).toBe('Kerja ☔');
    expect(back.tripMin).toBe(45);
    expect(back.stops.map((w) => [w.name, w.lat, w.lon, !!w.highway])).toEqual([
      ['KLCC – KL', 3, 101.5, false],
      ['B', 3.2, 101.5, true],
    ]);
  });

  it('rejects malformed payloads', () => {
    for (const bad of ['', '!!!', 'abc', encodeTrip({ name: 'x', stops: [wp('a')], tripMin: 60 }).slice(0, -3), 'eyJzIjpbXX0']) {
      expect(decodeTrip(bad)).toBeNull();
    }
  });
});

describe('import (merge)', () => {
  it('adds only new trips, maps tab refs, fills empty tabs only', () => {
    const { s } = two();
    const backup = JSON.parse(JSON.stringify(s));
    expect(mergeTrips(s, backup)!.added).toBe(0);
    const fresh = mergeTrips(emptyTrips(), backup)!;
    expect(fresh.added).toBe(2);
    expect(findSameTrip(fresh.state, AB)!.id).toBe(fresh.state.morning.tripId);
    expect(mergeTrips(s, { nope: 1 })).toBeNull();
  });
});

describe('automatic trip length', () => {
  it('is route driving time × 1.25, to 5 min, within 20–180', () => {
    expect(autoTripMin(40 * 60)).toBe(50);
    expect(autoTripMin(33 * 60)).toBe(40); // 41.25 → 40
    expect(autoTripMin(5 * 60)).toBe(20);
    expect(autoTripMin(4 * 3600)).toBe(180);
    expect(autoTripMin(NaN)).toBe(60);
  });

  it('new trips are auto; a set length can go back to auto; v1 lengths stay fixed', () => {
    const { s, xyz } = two();
    expect(s.trips.find((t) => t.id === xyz)!.tripMin).toBeNull();
    expect(s.trips[0]!.tripMin).toBe(60); // migrated from v1 (always fixed)
    const fixed = setSlotTripMin(assignSlot(s, 'custom', xyz), 'custom', 45);
    expect(resolveSlot(fixed, 'custom').trip!.tripMin).toBe(45);
    expect(resolveSlot(setSlotTripMin(fixed, 'custom', null), 'custom').trip!.tripMin).toBeNull();
    expect(decodeTrip(encodeTrip({ name: 'n', stops: AB, tripMin: null }))!.tripMin).toBeNull();
  });
});
