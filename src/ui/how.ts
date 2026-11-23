// "How this works": the versioned verdict rule in plain language, plus attribution. Shown in Settings → About.
import { el } from './dom';
import { RULE_VERSION, RAIN_MMH, HEAVY_MMH, RADAR_WINDOW_MIN } from '../core/verdict';

export function mountHow(root: HTMLElement): void {
  const d = el('div', { class: 'how' });
  d.append(
    el('h3', { class: 'set-h', text: `How this works (rule ${RULE_VERSION})` }),
    el('p', {
      text: 'Your drive is cut into ~5-minute stretches. Each stretch gets the forecast for the time you reach it, not for now. Drive times come from OSRM road speeds, scaled so the whole trip takes your trip length (by default the route driving time plus 25% for traffic).',
    }),
    el(
      'ol',
      {},
      el('li', { text: `A source is wet at ≥ ${RAIN_MMH} mm/h (≈ 0.1 mm per 15 min) and heavy at ≥ ${HEAVY_MMH} mm/h.` }),
      el('li', { text: 'No data: no source returned a value. Dry: no source is wet.' }),
      el('li', { text: 'Possible: some sources are wet, but fewer than half. Rain: half or more are wet. Heavy: more than half are heavy.' }),
      el('li', { text: 'Confidence “4/6” = sources backing the verdict / sources that returned data.' }),
      el('li', { text: `If you reach a stretch within ${RADAR_WINDOW_MIN} min and the latest radar frame shows rain there, it is raised one level.` }),
      el('li', { text: 'MET Malaysia district forecasts are shown as context only. They do not vote.' }),
    ),
    el('p', {
      text: 'Six voters: Open-Meteo best match, ECMWF IFS, GFS, ICON and JMA (15-min values in Malaysia are interpolated from hourly), and MET Norway (hourly). The radar and MET Malaysia do not vote. All values are shown in mm/h.',
    }),
    el('p', {
      text: 'Be honest with yourself: tropical showers are small and fast. A forecast is a chance, not a promise.',
    }),
    el('h3', { class: 'set-h', text: 'Your data' }),
    el('p', {
      text: 'Your trips are saved only in this browser. There is no account and nothing about you is stored on the server. To get the forecast, the server asks the weather and routing services about rounded points on your route (about 1 km); those answers are cached and shared by everyone, not linked to you. Share links keep the trip after the # in the address, which browsers never send to the server.',
    }),
    el('p', {
      text: 'RainCheck uses free data services. To stay within their free limits, answers are cached and each service has a daily cap on this site; if one is reached, you see the last saved data until midnight.',
    }),
    el(
      'p',
      { class: 'attrib' },
      'Data: ',
      link('Open-Meteo', 'https://open-meteo.com/'),
      ', ',
      link('MET Norway', 'https://api.met.no/'),
      ', ',
      link('MET Malaysia via data.gov.my', 'https://developer.data.gov.my/'),
      ', ',
      link('RainViewer', 'https://www.rainviewer.com/'),
      ', ',
      link('OSRM', 'https://project-osrm.org/'),
      ', ',
      link('Nominatim', 'https://nominatim.org/'),
      '. Map © ',
      link('CARTO', 'https://carto.com/attributions'),
      ' © ',
      link('OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright'),
      '.',
    ),
  );
  root.append(d);
}

function link(text: string, href: string): HTMLAnchorElement {
  return el('a', { href, rel: 'noopener', target: '_blank', text });
}
