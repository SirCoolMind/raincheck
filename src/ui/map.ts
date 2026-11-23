// Map: MapLibre GL, lazy-loaded so the answer renders before the ~250 kB gz map chunk.
// CARTO vector basemap via transformRequest (key appended client-side in dev, or the PHP proxy in prod).
// If the key is missing or rejected (401/403/503) → OSM raster fallback + "map key problem" chip.
import type { Map as MlMap, Marker, GeoJSONSource, StyleSpecification, MapLayerMouseEvent } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import type { Waypoint } from '../config';
import type { LonLat, RadarFrame, RadarIndex, StretchEval } from '../core/types';
import { CARTO_STYLES, transformCarto, type CartoMode } from './cartoUrl';
import { rasterTemplate, MAX_ZOOM as RADAR_MAX_ZOOM } from '../sources/rainviewer';
import { el } from './dom';
import { icon } from './icons';

export interface MapCallbacks {
  onHover(idx: number | null): void;
  onSelect(idx: number | null): void;
  onWaypointDrag(id: string, lat: number, lon: number): void;
  onInsertVia(lat: number, lon: number): void;
  /** Right-click / long-press: where, in map pixels, and the pin under it (if any). */
  onContextMenu?(e: { lat: number; lon: number; x: number; y: number; waypointId: string | null }): void;
  onKeyProblem(reason: string): void;
  onReady(): void;
}

type Theme = 'light' | 'dark';

const MODE = ((import.meta.env.VITE_CARTO_MODE as CartoMode | undefined) ?? 'direct') as CartoMode;
// Read the key ONLY inside the 'direct' branch: in proxy/none builds Vite folds the condition and the key
// never enters the bundle (verified by scripts/check-key.mjs). Never reference import.meta.env as a whole.
let KEY = '';
if (import.meta.env.VITE_CARTO_MODE !== 'proxy' && import.meta.env.VITE_CARTO_MODE !== 'none') {
  KEY = (import.meta.env.VITE_CARTO_API_KEY as string | undefined) ?? '';
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

function levelColor(level: string): string {
  return (level === 'dry' && cssVar('--route-dry') !== '#888' ? cssVar('--route-dry') : '') || cssVar(`--v-${level}`);
}

const OSM_STYLE = (): StyleSpecification => ({
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': cssVar('--paper') } },
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
      paint: { 'raster-saturation': -0.6, 'raster-opacity': 0.85 },
    },
  ],
});

const BLANK_STYLE = (): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': cssVar('--paper') } }],
});

/** A 2× tile of two offset wavelets on a sea tint, for the minimap's water fill. */
function wavePattern(bg: string, ink: string): ImageData | null {
  const W = 40;
  const H = 24;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  const wave = (x: number, y: number) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 3, y - 3, x + 6, y);
    ctx.quadraticCurveTo(x + 9, y + 3, x + 12, y);
    ctx.stroke();
  };
  wave(4, 7);
  wave(24, 18);
  return ctx.getImageData(0, 0, W, H);
}

export class RouteMap {
  private map: MlMap | null = null;
  private ml: typeof import('maplibre-gl') | null = null;
  private markers: Marker[] = [];
  private theme: Theme = 'light';
  private fallback: 'carto' | 'osm' | 'blank' = MODE === 'none' ? 'blank' : 'carto';
  private evals: StretchEval[] = [];
  private coords: LonLat[] = [];
  private selected: number | null = null;
  private hovered: number | null = null;
  private radar: RadarIndex | null = null;
  private radarFrame = -1;
  private radarOpacity = 0.6;
  private editing = false;
  private waypoints: Waypoint[] = [];
  private padBottom = 0;
  private padLeft = 0;
  private ready = false;

  constructor(
    private container: HTMLElement,
    private cb: MapCallbacks,
  ) {}

  async init(theme: Theme): Promise<void> {
    this.theme = theme;
    try {
      const [ml] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]);
      this.ml = ml;
    } catch {
      this.container.appendChild(el('div', { class: 'map-fallback', text: 'Map could not load. The forecast still works.' }));
      return;
    }
    const ml = this.ml;
    const origin = location.origin;
    this.map = new ml.Map({
      container: this.container,
      style: this.styleFor(theme),
      center: [101.68, 2.99],
      zoom: 9.3,
      minZoom: 6,
      maxZoom: 16,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      cooperativeGestures: false,
      transformRequest: (url) => ({ url: transformCarto(url, MODE, KEY, origin) }),
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.keyboard.enable();
    this.map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
    this.map.on('style.load', () => this.installLayers());
    // Any pan or zoom by the user (drag, pinch, keys and buttons carry originalEvent; wheel zoom does not).
    this.map.on('movestart', (e) => {
      if ((e as { originalEvent?: unknown }).originalEvent) this.userMoved = true;
    });
    this.map.on('wheel', () => (this.userMoved = true));
    this.map.on('dblclick', () => (this.userMoved = true));
    this.map.on('error', (e) => this.handleError(e as unknown as { error?: { status?: number; message?: string }; sourceId?: string }));
    this.map.once('load', () => {
      this.ready = true;
      this.cb.onReady();
    });
  }

  private styleFor(theme: Theme): string | StyleSpecification {
    if (this.fallback === 'blank') return BLANK_STYLE();
    if (this.fallback === 'osm') return OSM_STYLE();
    if (MODE === 'direct' && !KEY) {
      this.fallback = 'osm';
      queueMicrotask(() => this.cb.onKeyProblem('no CARTO key configured; using OSM tiles'));
      return OSM_STYLE();
    }
    return CARTO_STYLES[theme];
  }

  private styleLoaded = false;
  private handleError(e: { error?: { status?: number; message?: string; url?: string }; sourceId?: string }): void {
    if (this.fallback !== 'carto' || e.sourceId?.startsWith('radar') || e.sourceId === 'route' || e.sourceId === 'route-full') return;
    const status = e.error?.status;
    // Fall back only for a key problem (401/403, or the proxy saying "no key" 503), or when the style itself
    // never loaded. Single tile 429/5xx errors are transient and must not switch the basemap for good.
    const keyProblem = status === 401 || status === 403 || (status === 503 && !this.styleLoaded);
    const styleFailed = !this.styleLoaded && !e.sourceId;
    if (keyProblem || styleFailed) {
      this.fallback = 'osm';
      this.cb.onKeyProblem(status ? `CARTO HTTP ${status}; using OSM tiles` : 'CARTO style failed; using OSM tiles');
      this.map?.setStyle(OSM_STYLE(), { diff: false });
      for (const m of this.minis) m.setStyle(OSM_STYLE(), { diff: false });
    }
  }

  setTheme(theme: Theme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    if (!this.map) return;
    this.styleLoaded = false;
    this.map.setStyle(this.styleFor(theme), { diff: false });
    for (const m of this.minis) m.setStyle(this.styleFor(theme), { diff: false });
  }

  // ───── Minimaps ─────
  private minis: MlMap[] = [];
  /**
   * A small, non-interactive second map (the radar minimap) that shares this map's basemap, key handling,
   * theme and fallback. Null until the main map has loaded.
   */
  createMini(container: HTMLElement): MlMap | null {
    const ml = this.ml;
    if (!ml || !this.map) return null;
    const origin = location.origin;
    const m = new ml.Map({
      container,
      style: this.styleFor(this.theme),
      center: this.map.getCenter(),
      zoom: 6,
      interactive: false,
      attributionControl: { compact: true },
      fadeDuration: 0,
      transformRequest: (url) => ({ url: transformCarto(url, MODE, KEY, origin) }),
    });
    m.on('style.load', () => {
      for (const layer of m.getStyle().layers ?? []) {
        if (layer.type === 'symbol' && /poi|housenumber|road|transit|water/i.test(layer.id)) m.setLayoutProperty(layer.id, 'visibility', 'none');
      }
      // At this zoom CARTO's land and sea are almost the same grey: tint the sea and draw the coast.
      const water = m.getLayer('water');
      if (water && water.type === 'fill' && !m.getLayer('mini-coast')) {
        const dark = this.theme === 'dark';
        // Voyager paints an opaque, 1 px-offset copy of the sea above it ("water_shadow"), which would
        // cover the wavelets and the coast line.
        if (m.getLayer('water_shadow')) m.setLayoutProperty('water_shadow', 'visibility', 'none');
        m.setPaintProperty('water', 'fill-color', dark ? '#0b1a22' : '#bfd0d8');
        // Sea as a chart would draw it: small repeating wavelets over the tint.
        const waves = wavePattern(dark ? '#0b1a22' : '#bfd0d8', dark ? '#2c4a57' : '#93adb9');
        if (waves) {
          if (m.hasImage('mini-waves')) m.removeImage('mini-waves');
          m.addImage('mini-waves', waves, { pixelRatio: 2 });
          m.setPaintProperty('water', 'fill-pattern', 'mini-waves');
        }
        m.addLayer(
          {
            id: 'mini-coast',
            type: 'line',
            source: water.source,
            'source-layer': water.sourceLayer ?? 'water',
            paint: { 'line-color': dark ? '#7f99a4' : '#5b737e', 'line-width': 2 },
          },
          m.getLayer('water_shadow') ? 'water_shadow' : undefined,
        );
      }
    });
    this.minis.push(m);
    return m;
  }

  /** Bottom padding (px) the sheet covers, so fitBounds keeps the route visible. */
  setPadding(bottom: number): void {
    this.padBottom = bottom;
  }

  /**
   * Left inset (px) the desktop side panel covers. The map stays full-width under the panel, so a
   * width change only pans the view by half the change: no canvas resize, no flicker.
   */
  setLeftInset(left: number, delta = 0): void {
    this.padLeft = left;
    if (delta && this.map) this.map.panBy([-delta / 2, 0], { duration: 0 });
  }

  private installLayers(): void {
    const map = this.map;
    if (!map) return;
    this.styleLoaded = true;
    if (map.getSource('route')) return; // already installed for this style
    // Quiet the basemap: the route and radar carry the colour.
    for (const layer of map.getStyle().layers ?? []) {
      if (layer.type === 'symbol' && /poi|housenumber/i.test(layer.id)) map.setLayoutProperty(layer.id, 'visibility', 'none');
    }
    map.addSource('route', { type: 'geojson', data: this.routeGeoJson(), promoteId: 'idx' });
    map.addSource('route-full', { type: 'geojson', data: this.fullLine() });
    const casing = cssVar('--route-casing');
    map.addLayer({
      id: 'route-casing',
      type: 'line',
      source: 'route-full',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': casing, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 7, 13, 13], 'line-opacity': 0.9 },
    });
    map.addLayer({
      id: 'route-sel',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      filter: ['==', ['get', 'idx'], -1],
      paint: { 'line-color': cssVar('--now'), 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 13, 13, 20] },
    });
    map.addLayer({
      id: 'route-lv',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4.5, 13, 9],
        'line-opacity': ['case', ['boolean', ['feature-state', 'dim'], false], 0.35, 1],
      },
    });
    // Fat invisible hit layer for touch.
    map.addLayer({
      id: 'route-hit',
      type: 'line',
      source: 'route',
      paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 26 },
    });
    this.applyRadar();
    this.applySelection();
    this.bindRouteEvents();
  }

  private bound = false;
  private suppressClickUntil = 0;

  /** The pin within ~22 px of a map point, if any. */
  private pinNear(x: number, y: number): string | null {
    if (!this.map) return null;
    let best: string | null = null;
    let bd = 22 * 22;
    for (const wp of this.waypoints) {
      const p = this.map.project([wp.lon, wp.lat]);
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = wp.id;
      }
    }
    return best;
  }
  private bindRouteEvents(): void {
    const map = this.map;
    if (!map || this.bound) return;
    this.bound = true;
    map.on('mousemove', 'route-hit', (e: MapLayerMouseEvent) => {
      const idx = Number(e.features?.[0]?.properties?.idx);
      map.getCanvas().style.cursor = this.editing ? 'copy' : 'pointer';
      if (Number.isFinite(idx) && idx !== this.hovered) this.cb.onHover(idx);
    });
    map.on('mouseleave', 'route-hit', () => {
      map.getCanvas().style.cursor = '';
      this.cb.onHover(null);
    });
    map.on('contextmenu', (e) => {
      e.preventDefault();
      this.cb.onContextMenu?.({ lat: e.lngLat.lat, lon: e.lngLat.lng, x: e.point.x, y: e.point.y, waypointId: this.pinNear(e.point.x, e.point.y) });
    });
    // Press and hold (touch) opens the same menu; the tap that ends it must not also select a stretch.
    let hold: number | undefined;
    const cancelHold = () => clearTimeout(hold);
    map.on('touchstart', (e) => {
      cancelHold();
      if (e.points.length !== 1) return;
      const { lngLat, point } = e;
      hold = window.setTimeout(() => {
        this.suppressClickUntil = Date.now() + 600;
        this.cb.onContextMenu?.({ lat: lngLat.lat, lon: lngLat.lng, x: point.x, y: point.y, waypointId: this.pinNear(point.x, point.y) });
      }, 550);
    });
    map.on('touchend', cancelHold);
    map.on('touchcancel', cancelHold);
    map.on('touchmove', cancelHold);
    map.on('dragstart', cancelHold);
    map.on('zoomstart', cancelHold);
    map.on('click', 'route-hit', (e: MapLayerMouseEvent) => {
      if (Date.now() < this.suppressClickUntil) return;
      if (this.editing) {
        this.cb.onInsertVia(e.lngLat.lat, e.lngLat.lng);
        return;
      }
      const idx = Number(e.features?.[0]?.properties?.idx);
      if (Number.isFinite(idx)) this.cb.onSelect(idx === this.selected ? null : idx);
    });
  }

  private routeGeoJson(): FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: this.evals.map((ev) => ({
        type: 'Feature',
        id: ev.stretch.index,
        properties: { idx: ev.stretch.index, level: ev.verdict.level, color: levelColor(ev.verdict.level) },
        geometry: { type: 'LineString', coordinates: ev.stretch.coords },
      })),
    };
  }

  private fullLine(): Feature {
    return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: this.coords } };
  }

  /** No trip: drop the route line, colours and pins. */
  clearRoute(): void {
    this.coords = [];
    this.evals = [];
    (this.map?.getSource('route-full') as GeoJSONSource | undefined)?.setData(this.fullLine());
    (this.map?.getSource('route') as GeoJSONSource | undefined)?.setData(this.routeGeoJson());
  }

  /**
   * `fit`: the geometry changed. `newTrip`: a different trip or tab, which is always framed.
   * An edit to the same trip (a stop added, moved or removed) leaves the view alone once the user has
   * panned or zoomed, or when the new route already fits on screen.
   */
  setRoute(coords: LonLat[], fit: boolean, newTrip = false): void {
    if (fit && !newTrip && this.framed && (this.userMoved || this.inView(coords))) fit = false;
    this.coords = coords;
    const map = this.map;
    if (!map) return;
    (map.getSource('route-full') as GeoJSONSource | undefined)?.setData(this.fullLine());
    if (fit && coords.length > 1) this.fit();
    // Signals "route drawn" (used by the screenshot harness and e2e) once MapLibre has painted it.
    map.once('idle', () => {
      this.container.dataset.ready = '1';
    });
  }

  /** Is every point of `coords` inside the map area not covered by the sheet / side panel? */
  private inView(coords: LonLat[]): boolean {
    const map = this.map;
    if (!map || !this.ready) return false;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const left = this.padLeft + 12;
    const bottom = h - Math.min(this.padBottom, h * 0.72) - 12;
    const step = Math.max(1, Math.floor(coords.length / 200));
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < coords.length; i += step) {
      const p = map.project(coords[i]!);
      if (p.x < left || p.x > w - 12 || p.y < 12 || p.y > bottom) return false;
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    const last = map.project(coords[coords.length - 1]!);
    if (last.x < left || last.x > w - 12 || last.y < 12 || last.y > bottom) return false;
    // A route that would be a speck in this view (e.g. a different, short trip) still gets framed.
    return x1 - x0 >= (w - left) * 0.2 || y1 - y0 >= bottom * 0.2;
  }

  /** True once a route has been framed on the real map (the starting view does not count). */
  private framed = false;
  /** The user panned or zoomed since the last fit. */
  private userMoved = false;
  fit(): void {
    const map = this.map;
    if (!map || !this.ml || this.coords.length < 2) return;
    this.framed = true;
    this.userMoved = false;
    const b = new this.ml.LngLatBounds(this.coords[0], this.coords[0]);
    for (const c of this.coords) b.extend(c);
    const h = this.container.clientHeight;
    map.fitBounds(b, {
      padding: { top: this.padBottom ? 92 : 56, left: this.padLeft + 28, right: 28, bottom: Math.min(this.padBottom + 16, h * 0.72) },
      duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600,
      maxZoom: 12,
    });
  }

  setEvals(evals: StretchEval[]): void {
    this.evals = evals;
    (this.map?.getSource('route') as GeoJSONSource | undefined)?.setData(this.routeGeoJson());
    this.applySelection();
  }

  /** Re-read colours from CSS after a theme switch. */
  refreshColors(): void {
    this.setEvals(this.evals);
    const map = this.map;
    if (map?.getLayer('route-casing')) map.setPaintProperty('route-casing', 'line-color', cssVar('--route-casing'));
    if (map?.getLayer('route-sel')) map.setPaintProperty('route-sel', 'line-color', cssVar('--now'));
  }

  highlight(selected: number | null, hovered: number | null): void {
    this.selected = selected;
    this.hovered = hovered;
    this.applySelection();
  }

  private applySelection(): void {
    const map = this.map;
    if (!map || !map.getLayer('route-sel')) return;
    const focus = this.hovered ?? this.selected;
    map.setFilter('route-sel', ['==', ['get', 'idx'], focus ?? -1]);
    for (const ev of this.evals) {
      map.setFeatureState({ source: 'route', id: ev.stretch.index }, { dim: focus !== null && ev.stretch.index !== focus });
    }
  }

  // ───── Radar ─────
  // One raster layer per frame. Only the shown frame is opaque. Before Play, only that frame has a layer;
  // preloadRadar() adds the rest so playback flips between frames that already have tiles, instead of
  // swapping tile URLs and showing an empty map while each frame downloads.
  private radarLayers = new Set<number>();
  private radarPreload = false;
  private radarKey = '';

  setRadar(index: RadarIndex | null): void {
    const key = index ? `${index.host}|${index.frames.map((f) => f.path).join(',')}` : '';
    if (key !== this.radarKey) {
      this.removeRadarLayers();
      // A new set of frames drops the preload; the first index after load does not (Play may already
      // have asked for it before the map was up).
      if (this.radarKey) this.radarPreload = false;
      this.radarKey = key;
    }
    this.radar = index;
    if (this.radarFrame < 0 || !index || this.radarFrame >= index.frames.length) {
      this.radarFrame = index ? this.latestPastFrame(index) : -1;
    }
    this.applyRadar();
  }

  private latestPastFrame(index: RadarIndex): number {
    for (let i = index.frames.length - 1; i >= 0; i--) {
      if (index.frames[i]!.kind === 'past') return i;
    }
    return index.frames.length - 1;
  }

  showFrame(i: number): RadarFrame | null {
    if (!this.radar) return null;
    this.radarFrame = Math.max(0, Math.min(i, this.radar.frames.length - 1));
    this.applyRadar();
    return this.radar.frames[this.radarFrame] ?? null;
  }

  /** Load every frame's tiles (called on Play). */
  preloadRadar(): void {
    this.radarPreload = true;
    this.applyRadar();
  }

  /** Have frame i's visible tiles arrived? True when the map is not up (nothing to wait for). */
  radarFrameReady(i: number): boolean {
    const map = this.map;
    if (!map || !map.getLayer('route-casing') || !this.radarLayers.has(i)) return !map;
    try {
      return map.isSourceLoaded(`radar-${i}`);
    } catch {
      return false;
    }
  }

  setRadarOpacity(o: number): void {
    this.radarOpacity = o;
    const id = `radar-${this.radarFrame}`;
    if (this.map?.getLayer(id)) this.map.setPaintProperty(id, 'raster-opacity', o);
  }

  private removeRadarLayers(): void {
    const map = this.map;
    if (!map) return;
    for (const i of this.radarLayers) {
      if (map.getLayer(`radar-${i}`)) map.removeLayer(`radar-${i}`);
      if (map.getSource(`radar-${i}`)) map.removeSource(`radar-${i}`);
    }
    this.radarLayers.clear();
  }

  private addRadarLayer(i: number): void {
    const map = this.map!;
    const frame = this.radar!.frames[i]!;
    const id = `radar-${i}`;
    if (!map.getSource(id)) {
      map.addSource(id, {
        type: 'raster',
        tiles: [rasterTemplate(this.radar!.host, frame)],
        tileSize: 256,
        maxzoom: RADAR_MAX_ZOOM,
        attribution: '<a href="https://www.rainviewer.com/api.html">RainViewer</a>',
      });
    }
    if (!map.getLayer(id)) {
      map.addLayer(
        { id, type: 'raster', source: id, paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 } },
        map.getLayer('route-casing') ? 'route-casing' : undefined,
      );
    }
    this.radarLayers.add(i);
  }

  private applyRadar(): void {
    const map = this.map;
    // Not isStyleLoaded(): it is false while ANY tile is downloading (most of radar playback), so frame
    // switches were dropped and the map sat on an old or empty frame. Our route layer marks our style.
    if (!map || !map.getLayer('route-casing')) return;
    // A style reload drops our layers: forget the ones that are gone.
    for (const i of [...this.radarLayers]) if (!map.getLayer(`radar-${i}`)) this.radarLayers.delete(i);
    if (!this.radar || this.radarFrame < 0) {
      this.removeRadarLayers();
      return;
    }
    const want = this.radarPreload ? this.radar.frames.map((_, i) => i) : [this.radarFrame];
    for (const i of want) this.addRadarLayer(i);
    for (const i of this.radarLayers) map.setPaintProperty(`radar-${i}`, 'raster-opacity', i === this.radarFrame ? this.radarOpacity : 0);
  }

  // ───── Waypoints ─────
  setWaypoints(wps: Waypoint[], editing: boolean): void {
    this.waypoints = wps;
    this.editing = editing;
    const ml = this.ml;
    const map = this.map;
    for (const m of this.markers) m.remove();
    this.markers = [];
    if (!ml || !map) return;
    wps.forEach((wp, i) => {
      const end = i === 0 || i === wps.length - 1;
      const node = el('div', {
        class: `mk${end ? '' : ' via'}${editing ? ' editing' : ''}`,
        role: 'img',
        'aria-label': `${i + 1}: ${wp.name}`,
        title: wp.name,
        text: editing ? String(i + 1) : '',
      });
      // View mode speaks places, not editor indices: a pin glyph at the start, a flag at the destination.
      if (!editing && end) node.append(icon(i === 0 ? 'pin' : 'flag', 15));
      const m = new ml.Marker({ element: node, draggable: editing }).setLngLat([wp.lon, wp.lat]).addTo(map);
      node.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const r = this.container.getBoundingClientRect();
        this.cb.onContextMenu?.({ lat: wp.lat, lon: wp.lon, x: ev.clientX - r.left, y: ev.clientY - r.top, waypointId: wp.id });
      });
      m.on('dragend', () => {
        const p = m.getLngLat();
        this.cb.onWaypointDrag(wp.id, p.lat, p.lng);
      });
      if (!editing) this.holdToMove(node, m, wp);
      this.markers.push(m);
    });
  }

  /**
   * Outside edit mode a pin is still yours to handle: press and hold it (mouse or finger) and it lifts.
   * Drag it and it moves there; let go without moving and its menu opens (Remove, …).
   * A short press does nothing, and the map does not pan from a pin.
   */
  private holdToMove(node: HTMLElement, m: Marker, wp: Waypoint): void {
    const HOLD_MS = 380;
    const SLOP = 6;
    let timer: number | undefined;
    let lifted = false;
    let moved = false;
    let x0 = 0;
    let y0 = 0;
    // Keep the map's own pan, long-press, click (stretch select) and double-click zoom from firing under a pin.
    for (const t of ['mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend'] as const) {
      node.addEventListener(t, (ev) => ev.stopPropagation(), { passive: true });
    }
    const local = (ev: PointerEvent) => {
      const r = this.container.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    const end = (ev: PointerEvent, cancelled: boolean) => {
      clearTimeout(timer);
      if (node.hasPointerCapture(ev.pointerId)) node.releasePointerCapture(ev.pointerId);
      if (!lifted) return;
      lifted = false;
      node.classList.remove('lifted');
      this.suppressClickUntil = Date.now() + 400;
      if (cancelled) {
        m.setLngLat([wp.lon, wp.lat]);
        return;
      }
      if (moved) {
        const p = m.getLngLat();
        this.cb.onWaypointDrag(wp.id, p.lat, p.lng);
      } else {
        const { x, y } = local(ev);
        this.cb.onContextMenu?.({ lat: wp.lat, lon: wp.lon, x, y, waypointId: wp.id });
      }
    };
    node.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || !ev.isPrimary) return;
      ev.stopPropagation();
      x0 = ev.clientX;
      y0 = ev.clientY;
      moved = false;
      node.setPointerCapture(ev.pointerId);
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        lifted = true;
        node.classList.add('lifted');
        navigator.vibrate?.(12);
      }, HOLD_MS);
    });
    node.addEventListener('pointermove', (ev) => {
      if (!lifted) {
        // Moved before the hold completed: not a hold.
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > SLOP) clearTimeout(timer);
        return;
      }
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) <= SLOP) return;
      moved = true;
      const { x, y } = local(ev);
      m.setLngLat(this.map!.unproject([x, y]));
    });
    node.addEventListener('pointerup', (ev) => end(ev, false));
    node.addEventListener('pointercancel', (ev) => end(ev, true));
    node.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && lifted) end(new PointerEvent('pointercancel'), true);
    });
  }

  isReady(): boolean {
    return this.ready;
  }

  get waypointCount(): number {
    return this.waypoints.length;
  }

  resize(): void {
    this.map?.resize();
  }
}
