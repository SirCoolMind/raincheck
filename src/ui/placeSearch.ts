// Place search combobox (Nominatim via searchPlaces: debounced 600 ms here, throttled ≥1.1 s there).
// Arrow keys move through results, Enter picks, Escape closes. Used by the route editor and trip setup.
import { el, clear } from './dom';
import { searchPlaces, type Place } from '../sources/nominatim';

export interface PlaceSearch {
  root: HTMLElement;
  input: HTMLInputElement;
  status: HTMLElement;
  reset(): void;
}

export function placeSearch(o: { id: string; label: string; placeholder: string; onPick: (p: Place) => void; visibleLabel?: boolean }): PlaceSearch {
  const listId = `${o.id}-results`;
  const q = el('input', {
    type: 'search',
    id: o.id,
    placeholder: o.placeholder,
    autocomplete: 'off',
    role: 'combobox',
    'aria-expanded': 'false',
    'aria-controls': listId,
    'aria-autocomplete': 'list',
  }) as HTMLInputElement;
  const results = el('ul', { class: 'results', id: listId, role: 'listbox', hidden: true });
  const status = el('p', { class: 'note', 'aria-live': 'polite' });
  const label = el('label', { class: o.visibleLabel ? 'field-label' : 'vh', for: o.id, text: o.label });
  const root = el('div', { class: 'search' }, label, q, results, status);

  let timer: number | undefined;
  let ctl: AbortController | null = null;
  let found: Place[] = [];
  let active = -1;
  const closeResults = () => {
    results.hidden = true;
    q.setAttribute('aria-expanded', 'false');
    q.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const choose = (p: Place) => {
    clear(results);
    closeResults();
    o.onPick(p);
  };
  q.addEventListener('input', () => {
    clearTimeout(timer);
    const v = q.value.trim();
    if (v.length < 3) {
      closeResults();
      return;
    }
    timer = window.setTimeout(async () => {
      ctl?.abort();
      ctl = new AbortController();
      status.textContent = 'Searching…';
      try {
        found = await searchPlaces(v, { signal: ctl.signal });
      } catch {
        found = [];
      }
      clear(results);
      found.forEach((p, i) =>
        results.append(
          el(
            'li',
            { role: 'presentation' },
            el('button', { type: 'button', role: 'option', id: `${o.id}-opt-${i}`, 'aria-selected': 'false', tabindex: '-1', onclick: () => choose(p), text: p.label }),
          ),
        ),
      );
      results.hidden = found.length === 0;
      q.setAttribute('aria-expanded', String(found.length > 0));
      status.textContent = found.length ? `${found.length} places found. Use arrow keys to pick.` : 'No places found in Malaysia.';
    }, 600);
  });
  q.addEventListener('keydown', (e) => {
    if (results.hidden) return;
    const opts = Array.from(results.querySelectorAll<HTMLButtonElement>('[role=option]'));
    if (e.key === 'ArrowDown') active = Math.min(opts.length - 1, active + 1);
    else if (e.key === 'ArrowUp') active = Math.max(0, active - 1);
    else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      const p = found[active];
      if (p) choose(p);
      return;
    } else if (e.key === 'Escape') {
      closeResults();
      return;
    } else return;
    e.preventDefault();
    opts.forEach((b, i) => b.setAttribute('aria-selected', String(i === active)));
    const cur = opts[active];
    if (cur) q.setAttribute('aria-activedescendant', cur.id);
  });
  q.addEventListener('blur', () => setTimeout(closeResults, 200));

  return {
    root,
    input: q,
    status,
    reset: () => {
      q.value = '';
      clear(results);
      closeResults();
    },
  };
}
