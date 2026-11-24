// Settings: one gear button in the band opens a dialog with tabs. General (departure times, refresh,
// theme), Trips (every saved trip: rename / share / delete, backup), Sources (health of each data source),
// About (how the verdict works, your data, attribution). Native <dialog>: focus is kept inside, Esc closes.
import type { Actions, Store, ThemePref } from '../state';
import { on } from '../state';
import { el, clear, setText, timeField, normHHMM } from './dom';
import { icon } from './icons';
import { formatAgo } from '../core/format';
import { encodeTrip, MAX_TRIPS, type Trip, type TripsState } from '../core/trips';
import { mountHow } from './how';

export type SettingsTab = 'general' | 'trips' | 'sources' | 'about';
const TABS: [SettingsTab, string][] = [
  ['general', 'General'],
  ['trips', 'Trips'],
  ['sources', 'Sources'],
  ['about', 'About'],
];

export interface Settings {
  open(tab?: SettingsTab): void;
  /** Gear button for the band. */
  button: HTMLButtonElement;
}

export function mountSettings(store: Store, actions: Actions): Settings {
  const mark = el('span', { class: 'gear-mark', 'aria-hidden': 'true', hidden: true });
  const button = el(
    'button',
    { type: 'button', class: 'icon-btn gear-btn', id: 'settings-btn', 'aria-label': 'Settings', title: 'Settings', 'aria-haspopup': 'dialog' },
    icon('gear', 20),
    mark,
  ) as HTMLButtonElement;

  const close = el('button', { type: 'button', class: 'icon-btn dlg-close', 'aria-label': 'Close settings', id: 'settings-close' }, icon('close', 20));
  const tablist = el('div', { class: 'dlg-tabs', role: 'tablist', 'aria-label': 'Settings sections' });
  const body = el('div', { class: 'dlg-body' });
  const dlg = el(
    'dialog',
    { class: 'dlg', id: 'settings', 'aria-labelledby': 'settings-title' },
    el('div', { class: 'dlg-head' }, el('h2', { id: 'settings-title', text: 'Settings' }), close),
    tablist,
    body,
  ) as HTMLDialogElement;
  document.body.append(dlg);

  const tabBtns = new Map<SettingsTab, HTMLButtonElement>();
  const panels = new Map<SettingsTab, HTMLElement>();
  for (const [id, label] of TABS) {
    const b = el('button', { type: 'button', role: 'tab', id: `set-tab-${id}`, 'aria-controls': `set-panel-${id}`, 'aria-selected': 'false', tabindex: '-1', text: label }) as HTMLButtonElement;
    b.addEventListener('click', () => select(id, true));
    tabBtns.set(id, b);
    tablist.append(b);
    const p = el('section', { class: 'dlg-panel', role: 'tabpanel', id: `set-panel-${id}`, 'aria-labelledby': `set-tab-${id}`, tabindex: '0', hidden: true });
    panels.set(id, p);
    body.append(p);
  }
  let current: SettingsTab = 'general';
  const select = (id: SettingsTab, focus = false) => {
    current = id;
    for (const [k, b] of tabBtns) {
      const on2 = k === id;
      b.setAttribute('aria-selected', String(on2));
      b.tabIndex = on2 ? 0 : -1;
      panels.get(k)!.hidden = !on2;
    }
    body.scrollTop = 0;
    if (focus) tabBtns.get(id)!.focus();
  };
  tablist.addEventListener('keydown', (e) => {
    const order = TABS.map((t) => t[0]);
    const i = order.indexOf(current);
    const go = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? order.length - 1 : null;
    if (go === null) return;
    e.preventDefault();
    select(order[(go + order.length) % order.length]!, true);
  });

  close.addEventListener('click', () => dlg.close());
  // A click on the backdrop (outside the dialog box) closes it.
  dlg.addEventListener('click', (e) => {
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) dlg.close();
  });
  dlg.addEventListener('close', () => button.focus());
  button.addEventListener('click', () => open());

  const open = (tab?: SettingsTab) => {
    select(tab ?? current);
    if (!dlg.open) dlg.showModal();
    tabBtns.get(current)!.focus();
  };

  general(panels.get('general')!, store, actions);
  trips(panels.get('trips')!, store, actions);
  sources(panels.get('sources')!, store);
  mountHow(panels.get('about')!);

  // Gear mark: any source not OK shows on the gear, in the same shape language as the source list.
  on(store, ['health'], (s) => {
    const failed = s.health.some((h) => h.state === 'failed');
    const degraded = s.health.some((h) => h.state === 'degraded');
    mark.hidden = !failed && !degraded;
    mark.className = `gear-mark ${failed ? 'failed' : 'degraded'}`;
    button.setAttribute('aria-label', failed ? 'Settings (a data source failed)' : degraded ? 'Settings (a data source is degraded)' : 'Settings');
  });

  return { open, button };
}

// ───────── General ─────────
function general(root: HTMLElement, store: Store, actions: Actions): void {
  const mTime = timeField('morning-time');
  const eTime = timeField('evening-time');
  const auto = el('input', { type: 'checkbox', id: 'auto-refresh' }) as HTMLInputElement;
  const themeOpts: [ThemePref, string][] = [
    ['light', 'Light'],
    ['dark', 'Dark'],
    ['auto', 'Follow system'],
  ];
  const themeInputs = themeOpts.map(([v, label]) => {
    const i = el('input', { type: 'radio', name: 'theme', value: v, id: `theme-${v}` }) as HTMLInputElement;
    i.addEventListener('change', () => i.checked && actions.setTheme(v));
    return el('label', { class: 'opt', for: `theme-${v}` }, i, el('span', { text: label }));
  });
  root.append(
    el('h3', { class: 'set-h', text: 'Departure times' }),
    el('p', { class: 'note set-lead', text: 'Each tab opens at its own time. Custom starts from now.' }),
    el('div', { class: 'set-grid' }, el('label', { class: 'set-label', for: 'morning-time', text: 'Morning leaves' }), mTime, el('label', { class: 'set-label', for: 'evening-time', text: 'Evening leaves' }), eTime),
    el('h3', { class: 'set-h', text: 'Updates' }),
    el('label', { class: 'opt opt-wide', for: 'auto-refresh' }, auto, el('span', {}, 'Refresh the forecast every 10 minutes', el('small', { text: 'Only while this page is open. Each source is fetched again only once its cached answer is old.' }))),
    el('h3', { class: 'set-h', text: 'Appearance' }),
    el('div', { class: 'set-grid' }, el('span', { class: 'set-label', id: 'theme-label', text: 'Theme' }), el('div', { class: 'opts', role: 'radiogroup', 'aria-labelledby': 'theme-label' }, ...themeInputs)),
  );
  mTime.addEventListener('change', () => {
    const v = normHHMM(mTime.value);
    if (v) actions.setPresetTime('morning', v);
    mTime.value = v ?? store.get().trips.morning.time;
  });
  eTime.addEventListener('change', () => {
    const v = normHHMM(eTime.value);
    if (v) actions.setPresetTime('evening', v);
    eTime.value = v ?? store.get().trips.evening.time;
  });
  auto.addEventListener('change', () => actions.setAutoRefresh(auto.checked));
  on(store, ['trips', 'autoRefresh', 'theme'], (s) => {
    if (document.activeElement !== mTime) mTime.value = s.trips.morning.time;
    if (document.activeElement !== eTime) eTime.value = s.trips.evening.time;
    auto.checked = s.autoRefresh;
    themeInputs.forEach((l) => {
      const i = l.querySelector('input')!;
      i.checked = i.value === s.theme;
    });
  });
}

// ───────── Trips ─────────
function usedBy(t: TripsState, trip: Trip): string[] {
  const out: string[] = [];
  const isMorning = t.morning.tripId === trip.id;
  if (isMorning) out.push('Morning');
  if ((t.evening.mirror && isMorning) || (!t.evening.mirror && t.evening.tripId === trip.id)) out.push(t.evening.mirror ? 'Evening (reversed)' : 'Evening');
  if ((t.custom.follow && isMorning) || (!t.custom.follow && t.custom.tripId === trip.id)) out.push('Custom');
  return out;
}

function trips(root: HTMLElement, store: Store, actions: Actions): void {
  const count = el('small', { class: 'set-count' });
  const list = el('ul', { class: 'trip-list', id: 'trip-list' });
  const msg = el('p', { class: 'note', 'aria-live': 'polite' });
  const exp = el('button', { type: 'button', class: 'btn small', id: 'trips-export' }, 'Export trips');
  const impFile = el('input', { type: 'file', accept: 'application/json,.json', id: 'trips-import-file', hidden: true }) as HTMLInputElement;
  const imp = el('button', { type: 'button', class: 'btn small', id: 'trips-import', onclick: () => impFile.click() }, 'Import trips');
  const backupMsg = el('p', { class: 'note', 'aria-live': 'polite' });
  root.append(
    el('h3', { class: 'set-h' }, 'Saved trips', count),
    el('p', { class: 'note set-lead', text: 'Pick which trip each tab drives in the Trip section of the panel. Here you can rename, share or delete any of them.' }),
    list,
    msg,
    el('h3', { class: 'set-h', text: 'Backup' }),
    el('p', { class: 'note set-lead', text: 'Trips are saved in this browser only. Export them to move to another device, then import the file there.' }),
    el('div', { class: 'row-btns' }, exp, imp, impFile),
    backupMsg,
  );
  let renaming: string | null = null;

  const render = () => {
    const s = store.get();
    setText(count, `${s.trips.trips.length} of ${MAX_TRIPS}`);
    clear(list);
    if (!s.trips.trips.length) list.append(el('li', { class: 'note', text: 'No saved trips yet.' }));
    for (const t of s.trips.trips) {
      const tags = usedBy(s.trips, t);
      const meta = `${t.stops.length} stops · ${t.tripMin ? `${t.tripMin} min` : 'auto length'}`;
      const nameEl =
        renaming === t.id
          ? (() => {
              const i = el('input', { type: 'text', value: t.name, maxlength: 80, 'aria-label': `New name for ${t.name}`, class: 'trip-rename' }) as HTMLInputElement;
              const done = (save: boolean) => {
                renaming = null;
                if (save && i.value.trim() && i.value.trim() !== t.name) actions.renameTrip(t.id, i.value);
                else render();
              };
              i.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') done(true);
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  e.preventDefault();
                  done(false);
                }
              });
              i.addEventListener('blur', () => done(true));
              requestAnimationFrame(() => i.select());
              return i;
            })()
          : el('b', { text: t.name });
      list.append(
        el(
          'li',
          { class: 'trip-row' },
          el('span', { class: 'tr-main' }, nameEl, el('small', {}, meta, ...tags.map((g) => el('span', { class: 'tag', text: g })))),
          el(
            'span',
            { class: 'tr-acts' },
            el('button', { type: 'button', class: 'icon-btn', 'aria-label': `Rename ${t.name}`, title: 'Rename', onclick: () => ((renaming = t.id), render()) }, icon('edit', 18)),
            el('button', { type: 'button', class: 'icon-btn', 'aria-label': `Copy share link for ${t.name}`, title: 'Copy share link', onclick: () => void shareTrip(t) }, icon('share', 18)),
            el('button', { type: 'button', class: 'icon-btn danger', 'aria-label': `Delete ${t.name}`, title: 'Delete', onclick: () => del(t) }, icon('trash', 18)),
          ),
        ),
      );
    }
  };
  const shareTrip = async (t: Trip) => {
    const url = `${location.origin}${location.pathname}#t=${encodeTrip({ name: t.name, stops: t.stops, tripMin: t.tripMin })}`;
    try {
      await navigator.clipboard.writeText(url);
      msg.textContent = `Link for “${t.name}” copied. Anyone who opens it can save the trip.`;
    } catch {
      window.prompt('Copy this link:', url);
    }
  };
  const del = (t: Trip) => {
    const tags = usedBy(store.get().trips, t);
    const warn = tags.length ? ` ${tags.join(' and ')} will need another trip.` : '';
    if (!window.confirm(`Delete the trip “${t.name}”?${warn} Undo in the Trip section brings it back.`)) return;
    actions.deleteTrip(t.id);
    msg.textContent = `Deleted “${t.name}”.`;
  };
  exp.addEventListener('click', () => {
    const blob = new Blob([actions.exportTrips()], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'raincheck-trips.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    backupMsg.textContent = 'Saved raincheck-trips.json.';
  });
  impFile.addEventListener('change', async () => {
    const f = impFile.files?.[0];
    impFile.value = '';
    if (!f) return;
    if (f.size > 200_000) {
      backupMsg.textContent = 'That file is too big to be a RainCheck backup.';
      return;
    }
    try {
      backupMsg.textContent = actions.importTrips(JSON.parse(await f.text()));
    } catch {
      backupMsg.textContent = 'That file is not a RainCheck backup.';
    }
  });
  on(store, ['trips'], render);
}

// ───────── Sources ─────────
function sources(root: HTMLElement, store: Store): void {
  const sub = el('small', { id: 'src-sub', class: 'set-count' });
  const list = el('ul', { class: 'src-list', 'aria-labelledby': 'src-h' });
  root.append(
    el('h3', { class: 'set-h', id: 'src-h' }, 'Data sources', sub),
    el('p', { class: 'note set-lead', text: 'Five weather models vote on each stretch. Radar can raise or lower a stretch close to your ETA. MET Malaysia is shown as context and does not vote.' }),
    list,
  );
  on(store, ['health'], (s) => {
    clear(list);
    const counts = { ok: 0, degraded: 0, failed: 0 };
    for (const hl of s.health) {
      counts[hl.state]++;
      const word = hl.state === 'ok' ? 'OK' : hl.state === 'degraded' ? 'Degraded' : 'Failed';
      const reason = hl.reason || (hl.fetchedAt ? `updated ${formatAgo(hl.fetchedAt, Date.now())}` : '');
      list.append(
        el(
          'li',
          { class: `chip src-row ${hl.state}`, 'data-source': hl.id },
          el('span', { class: 'st', 'aria-hidden': 'true' }),
          el('span', { class: 'src-name', text: hl.label }),
          el('span', { class: 'src-state', text: word }),
          reason ? el('small', { text: reason }) : null,
        ),
      );
    }
    setText(sub, s.health.length ? `${counts.ok} ok · ${counts.degraded} degraded · ${counts.failed} failed` : 'loading…');
  });
}
