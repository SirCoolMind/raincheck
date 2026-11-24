// Radar playback: play/pause, frame time, opacity. Reduced motion → no autoplay.
// Play preloads every frame on the map and only steps to a frame once its tiles are in, so the map never
// flashes empty. Each frame bar's height is the share of the area around the route with rain on radar, and a
// dry area says so in words: an empty map then reads as "no rain nearby", not "radar broken".
import type { Store } from '../state';
import { on } from '../state';
import { el, clear, setText, prefersReducedMotion } from './dom';
import { icon } from './icons';
import { formatHHMM } from '../core/timing';
import { browserImageLoader, radarCoverage } from '../sources/rainviewer';
import type { LatLon } from '../core/types';
import type { RouteMap } from './map';
import { mountWindMap } from './windMap';

const STEP_MS = 650;
const HOLD_LAST_MS = 1600;
const MAX_WAIT_TICKS = 6; // ~2.4 s for a slow frame, then step on anyway

export function mountRadar(root: HTMLElement, store: Store, map: RouteMap, onFrameTime: (t: number | null) => void): void {
  const h = el('h2', { class: 'sec-h', id: 'radar-h' }, 'Radar', el('small', { text: 'RainViewer, last ~2 h' }));
  const play = el('button', { type: 'button', class: 'btn small', 'aria-pressed': 'false', id: 'radar-play' });
  const time = el('div', { class: 'radar-time', 'aria-live': 'off' });
  const frames = el('div', { class: 'frames', 'aria-hidden': 'true' });
  const op = el('input', { type: 'range', min: '0', max: '100', value: '60', id: 'radar-op', 'aria-label': 'Radar opacity' });
  const opv = el('span', { class: 'num', text: '60%' });
  const status = el('p', { class: 'radar-status', id: 'radar-status', 'aria-live': 'polite', hidden: true });
  const note = el('p', {
    class: 'note',
    text: 'Radar shows rain that has already fallen. The coloured route is the forecast for when you get there. Within 90 min of your ETA, rain on radar raises a stretch one level.',
  });
  const radarCtl = el('div', { class: 'radar-ctl' }, play, time, frames, el('label', { class: 'range-row', for: 'radar-op' }, 'Opacity', op, opv));
  root.append(h, radarCtl, status);
  const mini = mountWindMap(root, store, map);
  root.append(note);

  let idx = -1;
  let timer: number | undefined;
  let playing = false;
  let waits = 0;
  /** Autoplay runs one pass through the frames, then rests on the latest (so the map matches "now"). */
  let oncePass = false;
  let coverage: (number | null)[] = [];
  let covKey = '';

  const n = () => store.get().radar?.frames.length ?? 0;
  const latestPast = () => {
    const r = store.get().radar;
    if (!r) return -1;
    const k = r.frames.map((f) => f.kind).lastIndexOf('past');
    return k >= 0 ? k : r.frames.length - 1;
  };

  const show = (i: number) => {
    idx = i;
    const f = map.showFrame(i);
    mini.showFrame(i);
    const total = n();
    setText(time, f ? formatHHMM(f.time) : '—');
    const c = coverage[i];
    const wetWord = c === undefined || c === null ? '' : c > 0.002 ? ' · rain nearby' : ' · dry nearby';
    time.append(
      el('small', {
        text: f ? `${f.kind === 'nowcast' ? 'nowcast' : 'observed'} · frame ${i + 1}/${total}${i === total - 1 ? ' · latest' : ''}${wetWord}` : 'radar unavailable',
      }),
    );
    Array.from(frames.children).forEach((c2, k) => c2.classList.toggle('on', k === i));
    onFrameTime(f ? f.time : null);
  };

  const tick = () => {
    const total = n();
    if (!playing || !total) return;
    const next = (idx + 1) % total;
    if (!map.radarFrameReady(next) && waits < MAX_WAIT_TICKS) {
      if (!waits) map.preloadRadar(); // idempotent; covers a radar refresh during playback
      waits++;
      radarCtl.classList.add('buffering');
      timer = window.setTimeout(tick, 400);
      return;
    }
    waits = 0;
    radarCtl.classList.remove('buffering');
    show(next);
    if (oncePass && next === total - 1) {
      oncePass = false;
      setPlaying(false);
      return;
    }
    timer = window.setTimeout(tick, next === total - 1 ? HOLD_LAST_MS : STEP_MS);
  };

  const setPlaying = (p: boolean) => {
    playing = p;
    clear(play);
    play.append(icon(p ? 'pause' : 'play', 18), p ? 'Pause' : 'Play');
    play.setAttribute('aria-pressed', String(p));
    play.setAttribute('aria-label', p ? 'Pause radar animation' : 'Play radar animation');
    clearTimeout(timer);
    radarCtl.classList.remove('buffering');
    waits = 0;
    if (p) {
      map.preloadRadar();
      // Start from the oldest frame so one pass shows the whole two hours.
      if (idx >= n() - 1) show(0);
      timer = window.setTimeout(tick, STEP_MS);
    }
  };
  play.addEventListener('click', () => {
    oncePass = false;
    setPlaying(!playing);
  });
  op.addEventListener('input', () => {
    map.setRadarOpacity(Number(op.value) / 100);
    mini.setOpacity(Number(op.value) / 100);
    setText(opv, `${op.value}%`);
  });

  const drawFrames = () => {
    const r = store.get().radar;
    clear(frames);
    if (!r) return;
    const peak = Math.max(0.05, ...coverage.map((c) => c ?? 0));
    r.frames.forEach((f, k) => {
      const c = coverage[k];
      // Bar height follows the rain area near the route; a dry frame is a flat tick.
      const hgt = c === undefined || c === null ? 6 : c <= 0.002 ? 3 : 6 + Math.round(16 * Math.sqrt(c / peak));
      frames.append(el('i', { class: `${f.kind}${c && c > 0.002 ? ' wet' : ''}`, style: `height:${hgt}px` }));
    });
    frames.style.gridTemplateColumns = `repeat(${r.frames.length}, 1fr)`;
    Array.from(frames.children).forEach((c2, k) => c2.classList.toggle('on', k === idx));
  };

  const setStatus = () => {
    const known = coverage.filter((c): c is number => c !== null && c !== undefined);
    if (!known.length || known.length < coverage.length) {
      status.hidden = true;
      return;
    }
    const wetFrames = known.filter((c) => c > 0.002).length;
    status.hidden = false;
    status.classList.toggle('dry', wetFrames === 0);
    clear(status);
    if (wetFrames === 0) {
      status.append(icon('dry', 16), 'No rain on radar within about 50 km of your route in the last 2 hours, so the map stays clear.');
    } else {
      const last = known[known.length - 1]!;
      status.append(
        icon('rain', 16),
        last > 0.002 ? `Rain on radar near your route now (${pct(last)} of the area).` : `Rain near your route in ${wetFrames} of ${known.length} frames, none in the latest.`,
      );
    }
  };

  /** Rain area around the route per frame; recomputed when the frames or the drive change. */
  const measure = () => {
    const s = store.get();
    const r = s.radar;
    const pts: LatLon[] = (s.route?.coords ?? []).filter((_, i, a) => i % 20 === 0 || i === a.length - 1).map(([lon, lat]) => ({ lat, lon }));
    const key = r && pts.length ? `${r.frames.map((f) => f.path).join()}|${pts[0]!.lat},${pts[0]!.lon}|${pts.at(-1)!.lat}` : '';
    if (key === covKey) return;
    covKey = key;
    coverage = [];
    setStatus();
    drawFrames();
    if (!r || !key) return;
    // Up to 13 frames × 6 tiles to decode: wait until the first answer has painted and the page is idle.
    whenIdle(() => {
      if (covKey !== key) return;
      void radarCoverage(r, pts, browserImageLoader)
        .then((c) => {
          if (covKey !== key) return;
          coverage = c;
          drawFrames();
          setStatus();
          if (idx >= 0 && !playing) show(idx);
        })
        .catch(() => undefined);
    });
  };

  const render = () => {
    const r = store.get().radar;
    play.disabled = !r || !r.frames.length;
    radarCtl.classList.toggle('empty', !r || !r.frames.length);
    if (!r || !r.frames.length) {
      setPlaying(false);
      clear(frames);
      status.hidden = true;
      setText(time, '');
      time.append(el('small', { text: store.get().phase === 'loading' ? 'loading radar…' : 'radar unavailable' }));
      onFrameTime(null);
      return;
    }
    drawFrames();
    if (!playing && !prefersReducedMotion() && !document.hidden && r.frames.length > 1) {
      oncePass = true;
      show(0);
      setPlaying(true);
    } else if (!playing) {
      show(latestPast());
    }
    measure();
  };
  setPlaying(false);
  on(store, ['radar'], render);
  on(store, ['route'], measure, false);
  on(store, ['phase'], () => {
    if (n()) return;
    setText(time, '');
    time.append(el('small', { text: store.get().phase === 'loading' ? 'loading radar…' : 'radar unavailable' }));
    onFrameTime(null);
  }, false);
}

function whenIdle(cb: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(cb, { timeout: 3000 });
  else setTimeout(cb, 500);
}

function pct(c: number): string {
  return c < 0.01 ? 'under 1%' : `${Math.round(c * 100)}%`;
}
