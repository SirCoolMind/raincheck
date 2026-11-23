// From → To (→ Leave at, → Name) form that saves a new trip on the active tab. Used by the first-visit
// setup card and by "+ New trip" in the Trip section. Ids are prefixed (`setup-from`, `new-from`, …).
import type { Actions, Store } from '../state';
import type { Waypoint } from '../config';
import { el, clear, timeField, normHHMM } from './dom';
import { icon } from './icons';
import { placeSearch } from './placeSearch';
import { tripName, MAX_TRIPS } from '../core/trips';

const round5 = (v: number) => Math.round(v * 1e5) / 1e5;
export const inMalaysia = (lat: number, lon: number): boolean => lat >= 0 && lat <= 8 && lon >= 99 && lon <= 120;

export interface PlacePick {
  name: string;
  lat: number;
  lon: number;
}

export interface TripForm {
  root: HTMLElement;
  /** Fill From or To (e.g. from a map right-click). */
  prefill(which: 'from' | 'to', p: PlacePick): void;
  reset(): void;
  focus(): void;
  /** Show or hide the Leave-at row (hidden on Custom, which starts from now). */
  showTime(on: boolean, value?: string): void;
}

export function tripForm(o: {
  prefix: string;
  store: Store;
  actions: Actions;
  submitLabel: string;
  withName?: boolean;
  /** Extra buttons placed after the submit button (e.g. Cancel). */
  extra?: HTMLElement[];
  onSaved?(): void;
}): TripForm {
  const p = o.prefix;
  let from: Waypoint | null = null;
  let to: Waypoint | null = null;
  const msg = el('p', { class: 'note', 'aria-live': 'polite' });
  const fromSearch = placeSearch({ id: `${p}-from`, label: 'From', placeholder: 'Start: search a place', visibleLabel: true, onPick: (x) => pick('from', x) });
  const toSearch = placeSearch({ id: `${p}-to`, label: 'To', placeholder: 'Destination: search a place', visibleLabel: true, onPick: (x) => pick('to', x) });
  const fromChosen = el('div', { class: 'chosen', hidden: true });
  const toChosen = el('div', { class: 'chosen', hidden: true });
  const locate = el('button', { type: 'button', class: 'btn small', id: `${p}-locate` }, icon('locate', 16), 'Use my location');
  const time = timeField(`${p}-time`);
  const timeRow = el('label', { class: 'field', for: `${p}-time` }, 'Leave at', time);
  const name = el('input', { type: 'text', id: `${p}-name`, maxlength: 80, autocomplete: 'off', placeholder: 'Start → Destination' }) as HTMLInputElement;
  const nameRow = el('label', { class: 'field', for: `${p}-name` }, 'Name (optional)', name);
  const save = el('button', { type: 'button', class: 'btn primary', id: `${p}-save`, disabled: true }, icon('check', 18), o.submitLabel);
  const root = el(
    'div',
    { class: 'trip-form' },
    el('div', { class: 'tf-leg' }, el('span', { class: 'tf-dot start', 'aria-hidden': 'true' }), el('div', { class: 'tf-field' }, fromSearch.root, fromChosen, el('div', { class: 'tf-locate' }, locate))),
    el('div', { class: 'tf-leg' }, el('span', { class: 'tf-dot end', 'aria-hidden': 'true' }), el('div', { class: 'tf-field' }, toSearch.root, toChosen)),
    el('div', { class: 'tf-extra' }, timeRow, o.withName ? nameRow : null),
    el('div', { class: 'row-btns' }, save, ...(o.extra ?? [])),
    msg,
  );

  const chosen = (box: HTMLElement, label: string, w: Waypoint | null, clearFn: () => void) => {
    clear(box);
    box.hidden = !w;
    if (w)
      box.append(
        el('span', { class: 'field-label', text: label }),
        el('span', { class: 'chosen-v' }, el('b', { text: w.name }), el('button', { type: 'button', class: 'link-btn', text: 'Change', 'aria-label': `Change ${label}: ${w.name}`, onclick: clearFn })),
      );
  };
  const sync = () => {
    chosen(fromChosen, 'From', from, () => {
      from = null;
      sync();
      fromSearch.input.focus();
    });
    chosen(toChosen, 'To', to, () => {
      to = null;
      sync();
      toSearch.input.focus();
    });
    fromSearch.root.hidden = !!from;
    locate.hidden = !!from;
    toSearch.root.hidden = !!to;
    (save as HTMLButtonElement).disabled = !(from && to);
    if (!name.value || name.dataset.auto === '1') {
      name.placeholder = from && to ? tripName([from, to]) : 'Start → Destination';
    }
  };
  const pick = (which: 'from' | 'to', x: PlacePick) => {
    if (!inMalaysia(x.lat, x.lon)) {
      msg.textContent = 'RainCheck covers Malaysia only. Pick a place in Malaysia.';
      return;
    }
    const w: Waypoint = { id: which === 'from' ? 'start' : 'end', name: x.name.slice(0, 80), lat: round5(x.lat), lon: round5(x.lon) };
    if (which === 'from') {
      from = w;
      fromSearch.reset();
    } else {
      to = w;
      toSearch.reset();
    }
    msg.textContent = '';
    sync();
    if (which === 'from' && !to) toSearch.input.focus();
  };

  locate.addEventListener('click', () => {
    if (!('geolocation' in navigator)) {
      msg.textContent = 'This browser cannot share its location. Search for the place instead.';
      return;
    }
    msg.textContent = 'Finding your location…';
    navigator.geolocation.getCurrentPosition(
      (pos) => pick('from', { name: 'My location', lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => {
        msg.textContent = 'Location not available. Search for the place instead.';
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  });
  time.addEventListener('change', () => {
    time.value = normHHMM(time.value) ?? '';
  });
  save.addEventListener('click', () => {
    if (!from || !to) return;
    const s = o.store.get();
    const stamp = Date.now().toString(36);
    const stops = [from, to].map((w, i) => ({ ...w, id: `${i ? 'end' : 'start'}-${stamp}` }));
    const t = normHHMM(time.value);
    if (t && !timeRow.hidden && s.presetId !== 'custom') o.actions.setPresetTime(s.presetId, t);
    const nm = (o.withName && name.value.trim()) || tripName(stops);
    if (!o.actions.createTrip(stops, nm)) {
      msg.textContent = `Could not save: the list holds ${MAX_TRIPS} trips at most. Delete one in Settings → Trips.`;
      return;
    }
    reset();
    o.onSaved?.();
  });

  const reset = () => {
    from = to = null;
    name.value = '';
    msg.textContent = '';
    fromSearch.reset();
    toSearch.reset();
    sync();
  };
  sync();
  return {
    root,
    prefill: (which, x) => pick(which, x),
    reset,
    focus: () => (from ? (to ? save : toSearch.input) : fromSearch.input).focus(),
    showTime: (on, value) => {
      timeRow.hidden = !on;
      if (value !== undefined && document.activeElement !== time) time.value = value;
    },
  };
}
