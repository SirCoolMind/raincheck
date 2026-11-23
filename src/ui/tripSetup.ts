// Setup card: shown in place of the answer when the active tab has no trip yet (first visit, a new
// trip, a deleted one), and when someone opened a shared trip link. From → To → (Leave at) → Save.
import type { Actions, Store } from '../state';
import { on } from '../state';
import { el, clear, setText } from './dom';
import { icon } from './icons';
import { tripById } from '../core/trips';
import { tripForm, type PlacePick } from './tripForm';

const TAB: Record<string, string> = { morning: 'Morning', evening: 'Evening', custom: 'Custom' };

export interface Setup {
  /** Fill From/To on the setup card (map right-click on an empty tab). */
  prefill(which: 'from' | 'to', p: PlacePick): void;
}

export function mountSetup(root: HTMLElement, store: Store, actions: Actions): Setup {
  // ── shared trip offer ──
  const sharedBox = el('div', { class: 'setup-shared', hidden: true });

  // ── empty tab ──
  const title = el('h2', { class: 'setup-title', id: 'setup-title' });
  const lead = el('p', { class: 'setup-lead' });
  const quick = el('div', { class: 'setup-quick' });
  const example = el('button', { type: 'button', class: 'link-btn', id: 'setup-example' }, 'Or try an example route');
  const form = tripForm({ prefix: 'setup', store, actions, submitLabel: 'Save trip' });
  const tip = el('p', { class: 'note setup-tip', text: 'Tip: right-click the map (or press and hold on a phone) to start or end a trip there.' });
  const emptyBox = el('div', { class: 'setup-empty' }, title, lead, quick, el('div', { class: 'setup-form' }, form.root, example, tip));
  root.append(sharedBox, emptyBox);
  example.addEventListener('click', () => actions.useExample());

  const render = () => {
    const s = store.get();
    // Shared trip offer
    clear(sharedBox);
    sharedBox.hidden = !s.shared;
    if (s.shared) {
      const sh = s.shared;
      sharedBox.append(
        el('h2', { class: 'setup-title', text: 'Someone shared a trip with you' }),
        el('p', { class: 'setup-lead' }, el('b', { text: sh.name }), ` · ${sh.stops.length} stops · ${sh.tripMin} min`),
        el(
          'div',
          { class: 'row-btns' },
          el('button', { type: 'button', class: 'btn primary', id: 'shared-save', onclick: () => actions.acceptShared() }, icon('check', 18), `Save to ${TAB[s.presetId]}`),
          el('button', { type: 'button', class: 'btn', id: 'shared-dismiss', onclick: () => actions.dismissShared() }, 'No thanks'),
        ),
      );
    }
    // Empty tab
    const empty = s.phase === 'empty';
    emptyBox.hidden = !empty;
    root.hidden = !empty && !s.shared;
    if (!empty) return;
    const tab = TAB[s.presetId]!;
    const first = s.trips.trips.length === 0;
    setText(title, first ? 'Where do you drive?' : `Set up your ${tab} trip`);
    setText(
      lead,
      first
        ? 'Add your start and destination. RainCheck shows where rain will be along the way at the time you reach each stretch. Trips stay in this browser.'
        : `Pick a saved trip for ${tab}, or add a new one.`,
    );
    clear(quick);
    const morning = tripById(s.trips, s.trips.morning.tripId);
    if (s.presetId === 'evening' && morning) {
      quick.append(el('button', { type: 'button', class: 'btn', id: 'setup-mirror', onclick: () => actions.setEveningMirror(true) }, icon('swap', 16), `Drive ${morning.name} in reverse`));
    }
    for (const t of s.trips.trips.slice(0, 6)) {
      quick.append(el('button', { type: 'button', class: 'btn', onclick: () => actions.assignTrip(s.presetId, t.id) }, t.name));
    }
    quick.hidden = !quick.childElementCount;
    form.showTime(s.presetId !== 'custom', s.presetId === 'custom' ? '' : s.trips[s.presetId].time);
    example.hidden = !first;
  };
  on(store, ['phase', 'presetId', 'trips', 'shared'], render);
  return { prefill: (which, p) => form.prefill(which, p) };
}
