// The month band: presets, departure clock, ±2 h scrubber (local re-evaluation, no refetch), Leave now.
import type { Actions, Store } from '../state';
import { displayName, resolveSlot } from '../core/trips';
import { on } from '../state';
import { el, setText, timeField, normHHMM } from './dom';
import { icon } from './icons';
import { formatHHMM } from '../core/timing';
import { SCRUB_RANGE_MIN } from '../config';
import type { PresetId } from '../config';

export function mountBand(root: HTMLElement, store: Store, actions: Actions, gear?: HTMLElement): void {
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Trip preset' });
  const presetBtns = (['morning', 'evening', 'custom'] as PresetId[]).map((id) => {
    const b = el('button', { type: 'button', 'aria-pressed': 'false', 'data-preset': id, onclick: () => actions.setPreset(id) }, id === 'morning' ? 'Morning' : id === 'evening' ? 'Evening' : 'Custom');
    seg.append(b);
    return b;
  });
  const refreshBtn = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Refresh forecast', title: 'Refresh forecast', onclick: () => actions.refresh() }, icon('refresh', 20));
  const routeName = el('span', { class: 'route-name' });
  const clock = el('span', { class: 'clock num', id: 'depart-clock' });
  const arrive = el('span', { class: 'arrive' });
  const leaveNow = el('button', { type: 'button', class: 'btn-band', onclick: () => actions.leaveNow() }, 'Leave now');
  const range = el('input', {
    type: 'range',
    id: 'scrub',
    min: String(-SCRUB_RANGE_MIN),
    max: String(SCRUB_RANGE_MIN),
    step: '5',
    value: '0',
    'aria-label': 'Departure time',
  });
  // Custom preset: time + direction (shown only when Custom is active).
  const customTime = timeField('custom-time', 'Custom departure time');
  const dirBtn = el('button', { type: 'button', class: 'btn-band', id: 'custom-dir', onclick: () => actions.setCustomDirection(store.get().trips.custom.reverse) });
  const customRow = el('div', { class: 'custom-row', hidden: '' }, el('label', { for: 'custom-time', text: 'Custom' }), customTime, dirBtn);
  customTime.addEventListener('change', () => {
    const v = normHHMM(customTime.value);
    if (v) actions.setPresetTime('custom', v);
    customTime.value = v ?? store.get().customTime;
  });
  const ruler = el('div', { class: 'ruler', 'aria-hidden': 'true' });
  for (let k = 0; k < 5; k++) ruler.append(el('span'));

  root.append(
    el('div', { class: 'band-row' }, el('span', { class: 'brand', text: 'RainCheck' }), seg, el('span', { class: 'band-tools' }, refreshBtn, gear ?? null)),
    el(
      'div',
      { class: 'depart' },
      el('label', { class: 'depart-time', for: 'scrub' }, el('span', { class: 'verb', text: 'Leave' }), clock, arrive),
      leaveNow,
    ),
    customRow,
    el('p', { class: 'depart-label' }, icon('pin', 14), routeName),
    el('div', { class: 'scrub' }, range, ruler),
  );

  range.addEventListener('input', () => {
    const s = store.get();
    actions.setDepart(s.baseMs + Number(range.value) * 60000);
  });

  const render = () => {
    const s = store.get();
    presetBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === s.presetId)));
    const wps = s.stops;
    const nm = displayName(resolveSlot(s.trips, s.presetId));
    setText(routeName, nm ? `${nm} · ${s.tripMin} min` : 'No trip set up yet');
    setText(clock, formatHHMM(s.departMs));
    setText(arrive, `→ ${formatHHMM(s.departMs + s.tripMin * 60000)}`);
    const off = Math.round((s.departMs - s.baseMs) / 60000);
    if (Number(range.value) !== off) range.value = String(off);
    range.setAttribute('aria-valuetext', `Leave ${formatHHMM(s.departMs)}, arrive ${formatHHMM(s.departMs + s.tripMin * 60000)}`);
    const marks = [-120, -60, 0, 60, 120];
    Array.from(ruler.children).forEach((c, k) => setText(c, formatHHMM(s.baseMs + marks[k]! * 60000)));
    customRow.hidden = s.presetId !== 'custom' || wps.length < 2;
    if (customTime.value !== s.customTime) customTime.value = s.customTime;
    const dest = wps[wps.length - 1]?.name ?? '';
    setText(dirBtn, `To ${dest}`);
    dirBtn.setAttribute('aria-label', `Direction: to ${dest}. Swap direction`);
  };
  on(store, ['presetId', 'departMs', 'baseMs', 'stops', 'trips', 'tripMin', 'customTime'], render);
}
