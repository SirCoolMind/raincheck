// Radar minimap: the wider region (about 150 km around the route) with the radar frame that is on the main
// map, the route, and surface wind drawn as drifting streaks. It answers "where is the rain, and which way is
// the air moving" at a glance. Built only when scrolled into view; the wind costs one cached request.
import type { Map as MlMap, GeoJSONSource } from 'maplibre-gl';
import type { Store } from '../state';
import { on } from '../state';
import { el, prefersReducedMotion } from './dom';
import type { RouteMap } from './map';
import { rasterTemplate } from '../sources/rainviewer';
import { fetchWind, windAt, meanWind, compass, type Bounds, type WindGrid } from '../sources/wind';

const PAD_DEG = 1.3; // region shown around the route's box
const MINI_RADAR_ZOOM = 6; // low-zoom radar tiles: 1–4 per frame for this view
const N_PARTICLES = 120; // sparse on purpose: a hint of flow, not a texture
const MAX_AGE = 180; // frames a streak lives; it fades in and out over its life
const PX_PER_KMH = 0.03; // streak speed per frame; illustrative, not to scale

export interface WindMap {
  showFrame(i: number): void;
  /** Radar layer opacity, 0–1 (the Radar panel's Opacity slider drives both maps). */
  setOpacity(o: number): void;
}

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function mountWindMap(root: HTMLElement, store: Store, routeMap: RouteMap): WindMap {
  const mapBox = el('div', { class: 'wm-map', id: 'wind-map' });
  const canvas = el('canvas', { class: 'wm-wind', 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const cap = el('figcaption', { class: 'wm-cap', id: 'wind-cap', 'aria-live': 'polite' });
  const fig = el(
    'figure',
    { class: 'windmap', role: 'group', 'aria-label': 'Wider area: radar and surface wind around your route' },
    el('div', { class: 'wm-stage' }, mapBox, canvas, el('span', { class: 'wm-tag', text: 'Wider area' })),
    cap,
  );
  root.append(fig);
  cap.textContent = 'Wind: loading…';

  let mini: MlMap | null = null;
  let visible = false;
  let wind: WindGrid | null = null;
  let windKey = '';
  let routeKey = '';
  let opacity = 0.6;
  let frame = -1; // wanted radar frame
  let shown = -1; // frame actually on screen (kept until the wanted one's tiles arrive)
  const radarLayers = new Set<number>();
  let raf = 0;
  let retry: number | undefined;

  // ───── map ─────
  const routeBounds = (): Bounds | null => {
    const c = store.get().route?.coords;
    if (!c || c.length < 2) return null;
    let west = 180;
    let east = -180;
    let south = 90;
    let north = -90;
    for (const [lon, lat] of c) {
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    return { west: west - PAD_DEG, east: east + PAD_DEG, south: south - PAD_DEG, north: north + PAD_DEG };
  };

  const routeData = () => {
    const c = store.get().route?.coords ?? [];
    return {
      type: 'FeatureCollection' as const,
      features: c.length > 1
        ? [
            { type: 'Feature' as const, properties: { k: 'line' }, geometry: { type: 'LineString' as const, coordinates: c } },
            { type: 'Feature' as const, properties: { k: 'start' }, geometry: { type: 'Point' as const, coordinates: c[0]! } },
            { type: 'Feature' as const, properties: { k: 'end' }, geometry: { type: 'Point' as const, coordinates: c[c.length - 1]! } },
          ]
        : [],
    };
  };

  const install = () => {
    const m = mini;
    if (!m) return;
    radarLayers.clear();
    shown = -1;
    streakColor = cssVar('--ink', '#222'); // the theme just changed (or first load)
    if (!m.getSource('wm-route')) m.addSource('wm-route', { type: 'geojson', data: routeData() });
    const ink = cssVar('--ink', '#222');
    const paper = cssVar('--sheet', '#fff');
    m.addLayer({ id: 'wm-route-casing', type: 'line', source: 'wm-route', filter: ['==', ['get', 'k'], 'line'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': paper, 'line-width': 5 } });
    m.addLayer({ id: 'wm-route', type: 'line', source: 'wm-route', filter: ['==', ['get', 'k'], 'line'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ink, 'line-width': 2.5 } });
    m.addLayer({
      id: 'wm-ends',
      type: 'circle',
      source: 'wm-route',
      filter: ['!=', ['get', 'k'], 'line'],
      paint: { 'circle-radius': 4, 'circle-color': ['match', ['get', 'k'], 'start', paper, ink], 'circle-stroke-color': ink, 'circle-stroke-width': 2 },
    });
    applyRadar();
  };

  const fit = () => {
    const b = routeBounds();
    if (!mini || !b) return;
    mini.fitBounds([[b.west, b.south], [b.east, b.north]], { duration: 0, padding: 4 });
  };

  const create = () => {
    if (mini || !visible) return;
    mini = routeMap.createMini(mapBox);
    if (!mini) {
      retry = window.setTimeout(create, 800); // main map still loading
      return;
    }
    mini.on('style.load', install);
    mini.on('error', () => undefined); // a failed radar tile is not worth a console error
    mini.on('sourcedata', (e) => {
      if (e.sourceId === `wm-radar-${frame}` && frame !== shown) applyRadar();
    });
    mini.on('move', reproject);
    // Keep the credit as the small (i) button: expanded, it would cover a quarter of the minimap.
    mini.once('load', () => mapBox.querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show'));
    mini.on('resize', sizeCanvas);
    fit();
    sizeCanvas();
    loadWind();
  };

  // ───── radar: mirror the main map's frame, keeping the last good frame until the new one has tiles ─────
  const applyRadar = () => {
    const m = mini;
    const r = store.get().radar;
    // Not isStyleLoaded(): that stays false while any tile downloads (i.e. most of playback), which
    // silently dropped frame and opacity changes. Our route layer exists exactly when the style is ours.
    if (!m || !m.getLayer('wm-route-casing')) return;
    if (!r || frame < 0 || frame >= r.frames.length) {
      for (const i of radarLayers) m.setPaintProperty(`wm-radar-${i}`, 'raster-opacity', 0);
      return;
    }
    const id = `wm-radar-${frame}`;
    if (!m.getSource(id)) {
      m.addSource(id, { type: 'raster', tiles: [rasterTemplate(r.host, r.frames[frame]!)], tileSize: 256, maxzoom: MINI_RADAR_ZOOM });
      m.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 } }, 'wm-route-casing');
      radarLayers.add(frame);
    }
    let ready = false;
    try {
      ready = m.isSourceLoaded(id);
    } catch {
      ready = false;
    }
    if (ready || shown < 0 || !radarLayers.has(shown)) shown = frame;
    for (const i of radarLayers) m.setPaintProperty(`wm-radar-${i}`, 'raster-opacity', i === shown ? opacity : 0);
  };

  const resetRadar = () => {
    const m = mini;
    if (m && m.getLayer('wm-route-casing')) {
      for (const i of radarLayers) {
        if (m.getLayer(`wm-radar-${i}`)) m.removeLayer(`wm-radar-${i}`);
        if (m.getSource(`wm-radar-${i}`)) m.removeSource(`wm-radar-${i}`);
      }
    }
    radarLayers.clear();
    shown = -1;
  };

  // ───── wind ─────
  const loadWind = () => {
    const b = routeBounds();
    if (!b) return;
    const key = `${b.west.toFixed(1)},${b.south.toFixed(1)},${b.east.toFixed(1)},${b.north.toFixed(1)}`;
    if (key === windKey) return;
    windKey = key;
    void fetchWind(b).then((g) => {
      if (windKey !== key) return;
      wind = g;
      caption();
      reproject();
      start();
    });
  };

  const caption = () => {
    const m = wind ? meanWind(wind) : null;
    cap.textContent = '';
    if (!m) {
      cap.append('Wind data unavailable right now. The radar still shows where rain is.');
      return;
    }
    const calm = m.speed < 4;
    cap.append(
      el('b', { class: 'num', text: `${Math.round(m.speed)} km/h` }),
      calm ? ' surface wind, nearly calm. Showers here tend to build and fade where they are.' : ` surface wind from the ${compass(m.dir)}, carrying air toward the ${compass(m.dir + 180)}.`,
      el('span', { class: 'wm-src', text: ' Open-Meteo, 10 m, now.' }),
    );
  };

  // Screen-space wind field on a coarse grid, rebuilt when the view moves (it barely ever does).
  const CELL = 16;
  let field: Float32Array | null = null;
  let fCols = 0;
  let fRows = 0;
  let W = 0;
  let H = 0;
  const reproject = () => {
    if (!mini || !wind) return;
    fCols = Math.ceil(W / CELL) + 1;
    fRows = Math.ceil(H / CELL) + 1;
    field = new Float32Array(fCols * fRows * 2);
    for (let r = 0; r < fRows; r++) {
      for (let c = 0; c < fCols; c++) {
        const ll = mini.unproject([c * CELL, r * CELL]);
        const w = windAt(wind, ll.lat, ll.lng);
        const k = (r * fCols + c) * 2;
        field[k] = w ? w.u * PX_PER_KMH : 0;
        field[k + 1] = w ? -w.v * PX_PER_KMH : 0; // screen y grows downward
      }
    }
    if (prefersReducedMotion()) drawArrows();
  };
  const vel = (x: number, y: number): [number, number] => {
    if (!field) return [0, 0];
    const c = Math.max(0, Math.min(fCols - 1, Math.round(x / CELL)));
    const r = Math.max(0, Math.min(fRows - 1, Math.round(y / CELL)));
    const k = (r * fCols + c) * 2;
    return [field[k]!, field[k + 1]!];
  };

  const sizeCanvas = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    W = mapBox.clientWidth;
    H = mapBox.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
    reproject();
  };

  // ───── streaks ─────
  const px = new Float32Array(N_PARTICLES);
  const py = new Float32Array(N_PARTICLES);
  const age = new Uint16Array(N_PARTICLES);
  const spawn = (i: number) => {
    px[i] = Math.random() * W;
    py[i] = Math.random() * H;
    age[i] = Math.floor(Math.random() * MAX_AGE);
  };
  let seeded = false;

  const step = () => {
    raf = 0;
    const ctx = canvas.getContext('2d');
    if (!ctx || !field || !visible || document.hidden) return;
    if (!seeded) {
      for (let i = 0; i < N_PARTICLES; i++) spawn(i);
      seeded = true;
    }
    // Fade the previous frame so each streak leaves a short tail.
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = 'rgba(0,0,0,0.92)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = streakColor;
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    // Brightness follows a slow rise-and-fall over each streak's life (4 buckets, one stroke each),
    // so streaks never pop in or out.
    const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    for (let i = 0; i < N_PARTICLES; i++) {
      const x = px[i]!;
      const y = py[i]!;
      const [u, v] = vel(x, y);
      const nx = x + u;
      const ny = y + v;
      if (++age[i]! > MAX_AGE || nx < 0 || ny < 0 || nx > W || ny > H) {
        spawn(i);
        age[i] = 0;
        continue;
      }
      const b = Math.min(3, Math.floor(Math.sin((Math.PI * age[i]!) / MAX_AGE) * 4));
      paths[b]!.moveTo(x, y);
      paths[b]!.lineTo(nx, ny);
      px[i] = nx;
      py[i] = ny;
    }
    paths.forEach((p, b) => {
      ctx.globalAlpha = 0.15 + b * 0.15; // at most 0.6
      ctx.stroke(p);
    });
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(step);
  };
  let streakColor = '';
  const start = () => {
    streakColor = cssVar('--ink', '#222');
    if (prefersReducedMotion()) {
      drawArrows();
      return;
    }
    if (!raf && field && visible && !document.hidden) raf = requestAnimationFrame(step);
  };

  /** Reduced motion: still arrows on a loose grid instead of moving streaks. */
  const drawArrows = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx || !field) return;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = cssVar('--ink', '#222');
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    for (let y = 24; y < H; y += 40) {
      for (let x = 24; x < W; x += 40) {
        const [u, v] = vel(x, y);
        const len = Math.hypot(u, v);
        if (len < 0.05) continue;
        const k = Math.min(14, 6 + len * 10) / len;
        const ex = x + u * k;
        const ey = y + v * k;
        const a = Math.atan2(v, u);
        ctx.beginPath();
        ctx.moveTo(x - u * k * 0.5, y - v * k * 0.5);
        ctx.lineTo(ex, ey);
        ctx.moveTo(ex - 5 * Math.cos(a - 0.5), ey - 5 * Math.sin(a - 0.5));
        ctx.lineTo(ex, ey);
        ctx.lineTo(ex - 5 * Math.cos(a + 0.5), ey - 5 * Math.sin(a + 0.5));
        ctx.stroke();
      }
    }
  };

  // ───── lifecycle ─────
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) {
      create();
      start();
    } else {
      clearTimeout(retry);
    }
  }).observe(fig);
  document.addEventListener('visibilitychange', start);

  on(store, ['route'], () => {
    const c = store.get().route?.coords;
    const key = c && c.length > 1 ? `${c[0]!.join()}|${c[c.length - 1]!.join()}|${c.length}` : '';
    fig.hidden = !key;
    if (key === routeKey) return;
    routeKey = key;
    (mini?.getSource('wm-route') as GeoJSONSource | undefined)?.setData(routeData());
    fit();
    if (mini) loadWind();
  });
  on(store, ['radar'], () => {
    resetRadar();
    applyRadar();
  }, false);
  on(store, ['theme'], () => {
    streakColor = cssVar('--ink', '#222');
  }, false);

  return {
    showFrame(i: number) {
      frame = i;
      applyRadar();
    },
    setOpacity(o: number) {
      opacity = o;
      applyRadar();
    },
  };
}
