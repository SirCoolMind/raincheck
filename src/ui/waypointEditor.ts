// Trip section: which saved trip this tab drives, a clear "+ New trip" form, then the trip's stops, time,
// length and name. Library-wide jobs (rename/delete any trip, backup) live in Settings → Trips; refresh and
// theme in Settings → General. The map's right-click menu edits the same stops.
import type { Actions, Store } from '../state';
import { on } from '../state';
import { el, clear, setText, timeField, normHHMM } from './dom';
import { icon } from './icons';
import { placeSearch } from './placeSearch';
import { tripForm, type PlacePick } from './tripForm';
import { displayName, resolveSlot, MAX_STOPS } from '../core/trips';

const TAB: Record<string, string> = { morning: 'Morning', evening: 'Evening', custom: 'Custom' };

export interface Editor {
  /** Open the new-trip form with From or To filled in (map right-click). */
  newTripWith(which: 'from' | 'to', p: PlacePick): void;
}

export function mountEditor(root: HTMLElement, store: Store, actions: Actions, openSettings: () => void): Editor {
  const sub = el('small', { id: 'route-sub' });
  const h = el('h2', { class: 'sec-h', id: 'route-h' }, 'Trip', sub);

  // ── which trip ──
  const pick = el('select', { id: 'trip-pick', 'aria-labelledby': 'trip-pick-label' }) as HTMLSelectElement;
  const newBtn = el('button', { type: 'button', class: 'btn', id: 'trip-new', 'aria-expanded': 'false', 'aria-controls': 'new-panel' }, icon('plus', 18), 'New trip');
  const pickRow = el('div', { class: 'trip-pick' }, el('span', { class: 'field-label', id: 'trip-pick-label' }), el('div', { class: 'with-btn' }, pick, newBtn));

  // ── new trip ──
  const cancel = el('button', { type: 'button', class: 'btn', id: 'new-cancel' }, 'Cancel');
  const newTitle = el('h3', { class: 'sub-h', id: 'new-title' });
  const newLead = el('p', { class: 'note', text: 'Search the start and the destination. You can add stops after it is saved.' });
  const form = tripForm({ prefix: 'new', store, actions, submitLabel: 'Create trip', withName: true, extra: [cancel], onSaved: () => setNew(false) });
  const newPanel = el('div', { class: 'new-panel', id: 'new-panel', role: 'group', 'aria-labelledby': 'new-title', hidden: true }, newTitle, newLead, form.root);

  // ── this trip: stops ──
  const editBtn = el('button', { type: 'button', class: 'btn small', 'aria-pressed': 'false', id: 'edit-route' });
  const undo = el('button', { type: 'button', class: 'btn small', id: 'undo-route', onclick: () => actions.undo() }, icon('reset', 16), 'Undo');
  const list = el('ol', { class: 'wps', 'aria-labelledby': 'stops-h' });
  const help = el('p', { class: 'note', id: 'edit-help' });
  const search = placeSearch({
    id: 'place-q',
    label: 'Add a stop',
    placeholder: 'Add a stop: search a place',
    onPick: (p) => {
      actions.addWaypoint(p.name, p.lat, p.lon);
      search.reset();
      search.status.textContent = `Added ${p.name} before the destination.`;
    },
  });

  // ── this trip: time, length, name, sharing ──
  const tabTime = timeField('tab-time');
  const tabTimeField = el('label', { class: 'field', for: 'tab-time' }, el('span', { id: 'tab-time-label', text: 'Leaves at' }), tabTime);
  const trip = el('input', { type: 'number', id: 'trip-min', min: '20', max: '180', step: '5', inputmode: 'numeric' }) as HTMLInputElement;
  const tripAuto = el('button', { type: 'button', class: 'btn small', id: 'trip-min-auto', title: 'Use the route driving time plus 25% for traffic', onclick: () => actions.setTripMin(null) }, 'Auto');
  const name = el('input', { type: 'text', id: 'trip-name', maxlength: 80, autocomplete: 'off' }) as HTMLInputElement;
  const share = el('button', { type: 'button', class: 'btn small', id: 'trip-share' }, icon('share', 16), 'Share link');
  const dup = el('button', { type: 'button', class: 'btn small', id: 'trip-duplicate' }, icon('copy', 16), 'Duplicate');
  const del = el('button', { type: 'button', class: 'btn small danger', id: 'trip-delete' }, icon('trash', 16), 'Delete');
  const shareOut = el('input', { type: 'text', id: 'trip-share-url', readonly: true, hidden: true, 'aria-label': 'Share link for this trip' }) as HTMLInputElement;
  const tripMsg = el('p', { class: 'note', 'aria-live': 'polite' });
  const manage = el('button', { type: 'button', class: 'link-btn', id: 'trip-manage', onclick: () => openSettings() }, 'Manage all trips and backup');

  const details = el(
    'div',
    { class: 'trip-details', id: 'trip-details' },
    el('div', { class: 'sec-row' }, el('h3', { class: 'sub-h', id: 'stops-h', text: 'Stops' }), el('div', { class: 'row-btns tight' }, editBtn, undo)),
    list,
    help,
    search.root,
    el(
      'div',
      { class: 'grid2' },
      tabTimeField,
      el('div', { class: 'field' }, el('label', { for: 'trip-min', id: 'trip-min-label', text: 'Trip length (min)' }), el('div', { class: 'with-btn' }, trip, tripAuto)),
    ),
    el('label', { class: 'field', for: 'trip-name', id: 'trip-name-field' }, el('span', { id: 'trip-name-label', text: 'Trip name' }), name),
    el('div', { class: 'row-btns', id: 'trip-actions' }, share, dup, del),
    shareOut,
    tripMsg,
  );
  root.append(h, pickRow, newPanel, details, el('p', { class: 'trip-foot' }, manage));

  let newOpen = false;
  const setNew = (open: boolean) => {
    newOpen = open;
    newPanel.hidden = !open;
    newBtn.setAttribute('aria-expanded', String(open));
    newBtn.classList.toggle('on', open);
    render();
    if (open) requestAnimationFrame(() => form.focus());
    else form.reset();
  };
  newBtn.addEventListener('click', () => setNew(!newOpen));
  cancel.addEventListener('click', () => {
    setNew(false);
    newBtn.focus();
  });

  pick.addEventListener('change', () => {
    const s = store.get();
    const v = pick.value;
    tripMsg.textContent = '';
    if (v === '__mirror') actions.setEveningMirror(true);
    else if (v === '__morning') actions.customFollowMorning();
    else actions.assignTrip(s.presetId, v);
  });
  name.addEventListener('change', () => {
    const t = resolveSlot(store.get().trips, store.get().presetId).trip;
    if (t && name.value.trim()) actions.renameTrip(t.id, name.value);
  });
  dup.addEventListener('click', () => {
    const s = store.get();
    const r = resolveSlot(s.trips, s.presetId);
    const ok = actions.createTrip(s.stops, `${displayName(r)} (copy)`, r.trip?.tripMin ?? null);
    tripMsg.textContent = ok ? `Made a copy and put it on ${TAB[s.presetId]}. Edits now change the copy only.` : 'Could not copy: the list holds 20 trips at most.';
  });
  share.addEventListener('click', async () => {
    const url = actions.shareUrl();
    if (!url) return;
    shareOut.value = url;
    shareOut.hidden = false;
    shareOut.select();
    try {
      await navigator.clipboard.writeText(url);
      tripMsg.textContent = 'Link copied. Anyone who opens it can save this trip.';
    } catch {
      tripMsg.textContent = 'Copy the link above. Anyone who opens it can save this trip.';
    }
  });
  del.addEventListener('click', () => {
    const t = resolveSlot(store.get().trips, store.get().presetId).trip;
    if (!t) return;
    if (!window.confirm(`Delete the trip “${t.name}”? Tabs using it will need another trip. Undo brings it back.`)) return;
    actions.deleteTrip(t.id);
  });
  editBtn.addEventListener('click', () => actions.setEditing(!store.get().editing));
  trip.addEventListener('change', () => {
    const v = Math.round(Number(trip.value));
    if (v >= 20 && v <= 180) actions.setTripMin(v);
  });
  tabTime.addEventListener('change', () => {
    const s = store.get();
    const v = normHHMM(tabTime.value);
    if (v && s.presetId !== 'custom') actions.setPresetTime(s.presetId, v);
    tabTime.value = s.presetId === 'custom' ? s.customTime : (v ?? s.trips[s.presetId].time);
  });

  const render = () => {
    const s = store.get();
    const r = resolveSlot(s.trips, s.presetId);
    const tab = TAB[s.presetId]!;
    setText(root.querySelector('#trip-pick-label'), `${tab} drives`);
    setText(newTitle, `New trip for ${tab}`);
    clear(pick);
    const opt = (value: string, text: string) => el('option', { value, text });
    const mirrored = s.presetId === 'evening' && s.trips.evening.mirror;
    const follow = s.presetId === 'custom' && s.trips.custom.follow;
    if (s.presetId === 'evening') pick.append(opt('__mirror', 'Morning trip, driven back'));
    if (s.presetId === 'custom') pick.append(opt('__morning', 'Same as Morning'));
    for (const t of s.trips.trips) pick.append(opt(t.id, t.name));
    if (!r.trip) pick.append(opt('__none', 'No trip yet'));
    pick.value = mirrored ? '__mirror' : follow ? '__morning' : (r.trip?.id ?? '__none');
    pick.disabled = !s.trips.trips.length;

    details.hidden = newOpen || !r.trip;
    undo.disabled = !s.canUndo;
    if (!r.trip) shareOut.hidden = true;
    const shared = mirrored || follow;
    setText(root.querySelector('#trip-name-label'), shared ? 'Trip name (same trip as Morning)' : 'Trip name');
    if (document.activeElement !== name) name.value = r.trip?.name ?? '';

    clear(list);
    s.stops.forEach((wp, i) => {
      const first = i === 0;
      const last = i === s.stops.length - 1;
      const removable = s.stops.length > 2;
      list.append(
        el(
          'li',
          { class: `wp${first ? ' start' : last ? ' end' : ''}` },
          el('span', { class: `k${first || last ? '' : ' via'}`, 'aria-hidden': 'true' }, first ? icon('pin', 14) : last ? icon('flag', 14) : String(i)),
          el('span', { class: 'nm' }, el('b', { text: wp.name }), el('small', { text: first ? 'Start' : last ? 'Destination' : `Stop ${i}${wp.highway ? ' · highway' : ''}` })),
          removable
            ? el('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${wp.name}`, title: 'Remove', onclick: () => actions.removeWaypoint(wp.id) }, icon('trash', 18))
            : el('span', { class: 'wp-pad', 'aria-hidden': 'true' }),
        ),
      );
    });
    clear(editBtn);
    editBtn.append(icon(s.editing ? 'check' : 'pin', 16), s.editing ? 'Done' : 'Move on map');
    editBtn.classList.toggle('primary', s.editing);
    editBtn.setAttribute('aria-pressed', String(s.editing));
    help.textContent = s.editing
      ? 'Drag a pin to move it. Tap the route line to add a stop there.'
      : mirrored
        ? 'Evening drives the Morning stops back, so edits here change both. Right-click the map to add or remove a stop.'
        : `Right-click the map (or press and hold on a phone) to add a stop, move the start or destination, or remove one. Up to ${MAX_STOPS} stops.`;
    search.root.hidden = s.stops.length >= MAX_STOPS;

    tabTimeField.hidden = s.presetId === 'custom';
    if (document.activeElement !== tabTime) tabTime.value = s.presetId === 'custom' ? '' : s.trips[s.presetId].time;
    setText(root.querySelector('#tab-time-label'), `${tab} leaves at`);
    if (document.activeElement !== trip) trip.value = String(s.tripMin);
    setText(root.querySelector('#trip-min-label'), s.tripAuto ? 'Trip length · auto' : 'Trip length (min)');
    tripAuto.hidden = s.tripAuto;
    sub.textContent = r.trip && s.route ? `${(s.route.distanceM / 1000).toFixed(1)} km · ~${s.tripMin} min` : '';
  };
  on(store, ['stops', 'trips', 'presetId', 'editing', 'tripMin', 'tripAuto', 'route', 'canUndo', 'customTime'], render);
  // A new tab starts with the form closed.
  on(store, ['presetId'], () => newOpen && setNew(false), false);

  return {
    newTripWith: (which, p) => {
      if (!newOpen) setNew(true);
      form.prefill(which, p);
      root.scrollIntoView({ block: 'start', behavior: 'smooth' });
    },
  };
}
