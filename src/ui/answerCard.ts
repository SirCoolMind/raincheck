// Answer card: icon + one sentence + confidence + freshness. aria-live so screen readers hear the new answer.
import type { Store } from '../state';
import { on } from '../state';
import { el, clear, setText } from './dom';
import { icon } from './icons';
import { levelLabel } from '../core/summary';
import { formatAgo } from '../core/format';
import { formatHHMM } from '../core/timing';

export function mountAnswer(root: HTMLElement, store: Store, onRetry: () => void): void {
  const tile = el('div', { class: 'verdict-tile lv-nodata', 'aria-hidden': 'true' });
  const sentence = el('h2', { class: 'answer-sentence', id: 'answer-sentence' });
  const detail = el('p', { class: 'answer-detail' });
  const meta = el('div', { class: 'answer-meta' });
  const live = el('p', { class: 'vh', 'aria-live': 'polite', 'aria-atomic': 'true', id: 'answer-live' });
  const retry = el('button', { class: 'btn primary retry', type: 'button', onclick: () => onRetry() }, icon('refresh', 18), 'Try again');
  const box = el('div', { class: 'answer-main' }, tile, el('div', {}, sentence, detail));
  const warn = el('div', { class: 'metmy-warn', hidden: '' });
  root.append(box, meta, warn, live);

  let lastAnnounce = '';

  const render = () => {
    const s = store.get();
    root.classList.toggle('error', s.phase === 'error');
    retry.remove();
    clear(meta);
    if (s.phase === 'loading' && !s.summary) {
      tile.className = 'verdict-tile skel';
      sentence.className = 'answer-sentence skel skel-line';
      setText(sentence, 'Checking the drive…');
      detail.className = 'answer-detail skel';
      setText(detail, 'Loading route and forecasts');
      meta.append(el('span', { class: 'skel', text: 'sources 0/5 · updated' }));
      root.setAttribute('aria-busy', 'true');
      return;
    }
    root.removeAttribute('aria-busy');
    sentence.className = 'answer-sentence';
    detail.className = 'answer-detail';
    if (s.phase === 'error' && !s.summary) {
      tile.className = 'verdict-tile lv-nodata';
      tile.replaceChildren(icon('offline', 28));
      setText(sentence, 'Couldn’t get the forecast');
      setText(detail, s.error ?? 'Every weather source failed. Check your connection and try again.');
      root.append(retry);
      announce('Couldn’t get the forecast. ' + (s.error ?? ''));
      return;
    }
    const sum = s.summary;
    if (!sum) return;
    tile.className = `verdict-tile lv-${sum.level}`;
    tile.replaceChildren(icon(sum.level, 30));
    // Hedge a verdict that rests on fewer than 3 sources.
    const thin = sum.total > 0 && sum.total < 3 && sum.level !== 'dry';
    const headline = thin ? `Likely ${sum.sentence.charAt(0).toLowerCase()}${sum.sentence.slice(1)}` : sum.sentence;
    setText(sentence, headline);
    const second = [sum.note, sum.detail].filter(Boolean).join(' · ');
    setText(detail, second || routeLine(s));
    detail.classList.toggle('route-only', !second);
    detail.hidden = false;

    const down = s.health.filter((h) => h.state === 'failed' && h.id !== 'radar' && h.id !== 'metmy' && h.id !== 'route' && h.id !== 'map').length;
    if (sum.total > 0 && sum.total < 3) {
      // One statement for a thin answer: how many answered out of how many asked, and what they say.
      meta.append(
        el('span', { class: 'badge warn' }, icon('warning', 14), `${sum.total} of ${sum.total + down} sources answered · ${sum.agree === sum.total ? '' : `${sum.agree} `}${sum.level === 'dry' ? 'say dry' : sum.total === 1 ? 'sees rain' : 'see rain'}`),
      );
    } else if (sum.total > 0) {
      const pips = el('span', { class: 'pips', 'aria-hidden': 'true' });
      for (let i = 0; i < sum.total; i++) pips.append(el('i', { class: i < sum.agree ? 'on' : '' }));
      const what = sum.level === 'dry' ? 'say dry' : 'see rain';
      meta.append(
        el(
          'span',
          { class: 'agree', title: 'Sources that agree / sources that returned data' },
          el('span', { class: 'num', text: `${sum.agree}/${sum.total}` }),
          pips,
          `sources ${what}`,
        ),
      );
      // Weather voters that failed outright: say so in the first viewport, never hide it inside n/n.
      if (down > 0) meta.append(el('span', { class: 'badge warn' }, icon('warning', 14), `${down} source${down > 1 ? 's' : ''} down`));
    }
    if (s.offline || s.fromStore) {
      const age = s.fetchedAt ? Math.max(0, Math.round((Date.now() - s.fetchedAt) / 60000)) : null;
      meta.append(
        el(
          'span',
          { class: 'badge warn', role: 'status' },
          icon('offline', 14),
          s.fetchedAt ? `Offline · forecast from ${stamp(s.fetchedAt)} (${age! < 2 ? 'saved just now' : age! < 90 ? `${age} min old` : `${Math.round(age! / 60)} h old`})` : 'Offline · last saved forecast',
        ),
      );
    } else if (s.fetchedAt) meta.append(el('span', { class: 'ago', 'data-ago': String(s.fetchedAt), text: `Updated ${formatAgo(s.fetchedAt, Date.now())}` }));
    if (s.phase === 'error') root.append(retry);
    announce(`${levelLabel(sum.level)}. ${headline}. ${sum.detail}${sum.total > 0 && sum.total < 3 ? ` Only ${sum.total} of ${sum.total + down} sources answered.` : ''}`);
  };

  // Debounced so dragging the scrubber doesn't flood screen readers; only the settled answer is read.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const announce = (text: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (text === lastAnnounce) return;
      lastAnnounce = text;
      setText(live, text);
    }, 800);
  };

  // MET Malaysia official warnings (context only — never changes the verdict).
  const renderWarn = () => {
    const s = store.get();
    clear(warn);
    const now = Date.now();
    const active = (s.metmy?.warnings ?? []).filter((w) => {
      const to = Date.parse(w.validTo);
      return Number.isNaN(to) || to >= now;
    });
    if (!active.length) {
      warn.hidden = true;
      return;
    }
    warn.hidden = false;
    const w = active[0]!;
    warn.append(
      icon('warning', 16),
      el(
        'p',
        {},
        el('strong', { text: 'MET Malaysia warning: ' }),
        w.title || w.heading,
        active.length > 1 ? ` (+${active.length - 1} more)` : '',
        el('small', { text: ` · official text, not part of the verdict` }),
      ),
    );
  };

  on(store, ['summary', 'phase', 'fetchedAt', 'offline', 'fromStore', 'error'], render);
  on(store, ['metmy'], renderWarn);
  // Keep "updated N min ago" honest.
  setInterval(() => {
    const ago = root.querySelector<HTMLElement>('.ago');
    const t = Number(ago?.dataset.ago);
    if (ago && t) setText(ago, `Updated ${formatAgo(t, Date.now())}`);
  }, 30_000);
}

function routeLine(s: ReturnType<Store['get']>): string {
  const first = s.evals[0];
  const last = s.evals[s.evals.length - 1];
  if (!first || !last) return '';
  return `Arrive ~${formatHHMM(last.eta.endMs)} · ${s.tripMin}\u00A0min drive in ${s.evals.length} stretches`;
}

/** HH:MM today; "Tue 18 Nov HH:MM" for an older result (MYT). */
function stamp(ms: number): string {
  const day = (t: number) => Math.floor((t + 8 * 3600_000) / 86_400_000);
  if (day(ms) === day(Date.now())) return formatHHMM(ms);
  const d = new Date(ms + 8 * 3600_000);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${wd} ${d.getUTCDate()} ${mo} ${formatHHMM(ms)}`;
}
