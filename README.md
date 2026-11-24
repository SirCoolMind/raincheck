# RainCheck – Daily Commute

RainCheck answers one question for a daily drive anywhere in Malaysia: will it rain on my route when I leave? Each tab (Morning, Evening, Custom) drives a saved trip: a start, a destination and optional stops. Evening can simply be Morning in reverse. New visitors get a short setup card; trips stay in the browser (no accounts) and move between devices with a share link or a JSON export. It routes the drive with OSRM, pulls forecasts from several weather sources and RainViewer radar, and gives a verdict for each departure time (Dry, Possible, Rain or Heavy). Each verdict shows how many sources agree, and the app suggests the best time to leave. A map and timeline show where the rain is.

## Quick start (Windows, PowerShell)

Prerequisites: Node.js LTS, and PHP 8.x on your PATH with the curl extension (`php -m` should list `curl`).

In the project folder, run once:

```powershell
npm install
npm run key
```

`npm run key` writes `.env.local` from `carto_api_key.txt` and never prints the key. Without a key file the map falls back to OpenStreetMap raster tiles.

**Easiest:** double-click `start.bat`. It installs dependencies on the first run, starts the
PHP API and the web app on the first free ports (from 8787 and 5173 upwards), opens the
browser, and stops both when you press Ctrl+C or close the window. Options:
`start.bat -WebPort 6000 -ApiPort 9000 -NoBrowser`.

Or by hand, open two terminals in the project folder:

```powershell
# Terminal 1: PHP proxy API on 127.0.0.1:8787
npm run api

# Terminal 2: Vite dev server on 5173 (proxies /api to 8787)
npm run dev
```

Open <http://localhost:5173>.

## Scripts

| Script | What it does |
|---|---|
| `npm run test` | Unit tests (Vitest, one run) |
| `npm run coverage` | Unit tests with V8 coverage report |
| `npm run test:e2e` | Playwright E2E: 17 tests × 6 projects (iPhone SE, Pixel 7, desktop 1440; light + dark). Builds `--mode e2e` into `dist-e2e/` and serves it on :4176; every network call is mocked from fixtures |
| `npm run test:php` | PHP smoke test for the API (`tests/php/smoke.php`) |
| `npm run smoke` | Live check of every upstream API (status, latency, response shape, CORS) |
| `npm run fixtures` | Re-record upstream API fixtures (`scripts/record-fixtures.mjs`) |
| `npm run build` | Type-check, production build, service-worker precache list, then `check:key` |
| `npm run preview` | Serve `dist/` on port 4173 (API still on 8787) |
| `npm run lint` | ESLint on `src` and `tests/unit` |
| `node scripts/record-districts.mjs` | Rebuild `src/data/districts.json` (one data.gov.my call, then Nominatim at 1 req/s; cached). Rarely needed |
| `npm run check:key` | Confirms the CARTO key is not in tracked files or `dist/`. Must print "not found" |

Also available: `npm run key` (write `.env.development.local` from the key file; dev mode only), `npm run dev` and `npm run api` (see Quick start), and `npm run format` (Prettier).

## Folder layout

```
src/
  core/      pure logic, no DOM or network: verdict, geo, timing, bestTime, evaluate, summary, format, types
  sources/   upstream clients: openmeteo, metno, metmy, rainviewer, osrm, nominatim, http
  ui/        DOM components: map, radar, timeline, answerCard, bestTime, waypointEditor, controls, theme, ...
  styles/    CSS tokens and components
  data/      districts.json: all 168 MET Malaysia districts (built by scripts/record-districts.mjs)
  config.ts, state.ts, main.ts
api/         PHP proxy endpoints: openmeteo, metno, metmy, radar, route, search, carto, feedback (POST, Gmail API), index (404); shared helpers in common.php
tests/
  unit/      Vitest specs
  fixtures/  recorded upstream responses (real/) and bad ones (malformed/)
  e2e/       Playwright specs + shared network mock (mock-core.mjs)
  php/       PHP smoke test
public/      static files copied into dist/ (service worker, manifest, icons)
scripts/     key loading and checking, smoke test, fixture recording, icon generation,
             screens.mjs (design screenshots), lighthouse.mjs, precache.mjs
docs/screens/ design-loop screenshots (generated, gitignored)
```

## Trips

- `src/core/trips.ts` holds the model: a library of up to 20 trips (2–12 stops each) and what each tab drives. Storage key `raincheck:v1:trips.v2`; an older single saved route migrates into the Morning trip.
- The **Trip** section picks what the active tab drives and has **+ New trip** (From → To form in place). Below it: stops, the tab's departure time, trip length, name, share, duplicate, delete.
- Right-click the map (press and hold on a phone) to add a stop there, make it the start or destination, start a new trip from or to it, or remove a stop from its pin.
- **Send feedback** (panel footer) opens a short form: Idea / Problem / Other, a message and an optional reply email. `api/feedback.php` mails it to the owner through the Gmail API (OAuth refresh token, set in `api/config.local.php`; see DEPLOY.md). The owner's address never reaches the browser. Bot checks: a small sum to solve (for example 12 + 32) that the server signs and accepts once, not answered in under 3 seconds; a hidden spam trap; 3 a minute and 10 a day per visitor; 2,000 characters.
- Press and hold any pin (mouse or finger) and it lifts: drag it to move that stop, or let go without moving to open its menu (Remove, …). A short click on a pin does nothing, and the map does not pan from a pin.
- **Settings** (gear in the band) has tabs: General (departure times, auto-refresh, theme), Trips (rename, share or delete any trip, export/import), Sources (health of each data source), About (how the verdict works, your data, attributions). The panel footer links to Sources and About.
- Best time's **Calendar** and **Do the sources agree?** fold from their headings; the choice is remembered per browser (`rc.fold.*`).
- Radar **Play** preloads every frame as its own map layer and steps only when a frame's tiles are in. The frame bars show how much of the area around the route has rain; when it is dry the panel says so.
- Under the radar, a **Wider area** minimap shows about 150 km around the route with the same radar frame and surface wind drawn as drifting streaks (Open-Meteo 10 m wind, one request for a 0.5° grid, cached 30 min, fetched only when the minimap scrolls into view). With reduced motion it draws still arrows.
- Trip length is automatic by default (OSRM driving time × 1.25, to 5 min); set a number to fix it, or press Auto to go back.
- MET Malaysia context uses the nearest of all 168 districts, and warnings for the states the trip crosses.
- E2E tests seed the original commute (`tests/fixtures/test-route.json`) as a returning user; `seed: false` tests the first visit.

## How the verdict works (rule v1)

The rules live in `src/core/verdict.ts` as `RULE_VERSION = 'v1'`.

- **Wet thresholds.** A source reading of 0.4 mm/h or more counts as wet (rain). A reading of 4 mm/h or more counts as heavy.
- **Levels.** No data: no source returned a value. Dry: no source is wet. Possible: fewer than half of the sources are wet. Rain: at least half are wet and fewer than half are heavy. Heavy: more than half are heavy.
- **Confidence.** `agree/total` is the number of sources that back the base level, out of the sources that returned a value.
- **Radar.** If RainViewer radar shows rain on the route within 90 minutes of the departure time, the level goes up one step (Dry becomes Possible, Possible becomes Rain, Rain becomes Heavy). Heavy stays Heavy.
- **MET Malaysia.** Its forecasts and warnings are shown as context only. They do not vote in the verdict.

## Privacy and keys

- **CARTO key.** The key lives only in `carto_api_key.txt`, which is gitignored. Locally it is copied to `.env.local` (also gitignored). On the server it goes into `api/config.local.php` (gitignored), entered by hand.
- **Production.** The build uses proxy mode (`VITE_CARTO_MODE=proxy`), so the browser fetches map tiles and styles through `api/carto.php`. The key never reaches the browser, and `npm run check:key` fails the build if it appears in `dist/`.
- **Your trips.** Saved only in the browser (`localStorage`). Share links carry a trip after the `#`, which browsers never send to the server.
- **Server-side storage.** The PHP proxy keeps a file cache of upstream responses, per-IP rate-limit counters and per-host daily budget counters. In development that is `api/cache/` (gitignored). In production it is `CACHE_DIR`.
- **Free tiers.** Every upstream goes through the proxy with a shared cache and a daily cap per host (about 80 % of each free tier, see `DEFAULT_DAILY_BUDGET` in `api/common.php`). The browser also limits itself to 40 calls per minute per third-party host.
- **Deployment.** See `DEPLOY.md`.

## Data attributions

- [Open-Meteo](https://open-meteo.com/) forecasts
- [MET Norway](https://api.met.no/) (Locationforecast), via the server-side proxy
- [MET Malaysia](https://www.met.gov.my/) forecasts and warnings, via [data.gov.my](https://data.gov.my/)
- [RainViewer](https://www.rainviewer.com/) radar
- [OSRM](https://project-osrm.org/) routing
- [Nominatim](https://nominatim.org/) geocoding, data from [OpenStreetMap](https://www.openstreetmap.org/copyright)
- [CARTO](https://carto.com/) basemaps
- [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors

## Screenshots

`node scripts/screens.mjs <round> [baseUrl]` writes 8 states × 375/412/1440 × light/dark to `docs/screens/round-<round>/`
(mocked network, fixed clock 2026-11-20 07:00 MYT, blank basemap). The folder is gitignored. Phones also get a `*-sheet.png` with the sheet expanded.

## Field-test log

Record each real commute here to compare the verdict with what you saw.

| Date | Depart | Tool said | Actually saw | Notes |
|---|---|---|---|---|
|  |  |  |  |  |
|  |  |  |  |  |
|  |  |  |  |  |
|  |  |  |  |  |
|  |  |  |  |  |

## Changelog

### 1.2.1 (2026-11-24)

- Faster on phones and weak PCs, same look. Theme colours are read once per theme instead of once per route
  stretch per re-render; the slider re-evaluates at most once per frame; "Do the sources agree?" and the departure
  calendar are only built while open; radar tiles are read from a CPU canvas; the radar panel's per-frame rain
  bars are measured when the page is idle. On a 6× slowed phone this cut the app's own JS time by about a third
  and slider blocking time by about half.

### 1.2 (2026-11-24)

- Five voters instead of six: Open-Meteo "best match" is removed. It is built from the same models that already
  vote (mostly ECMWF here), so it counted one model twice. With 5 sources there are no ties; Rain needs 3 of 5.

### 1.1 (2026-11-24)

- Verdict rule v3, to stop "Rain" on days that stay dry. The models report rain in 0.1 mm steps per 15 min and
  spread that drizzle over whole areas in the tropics; the old 0.4 mm/h threshold counted exactly that as rain.
  - A source now votes wet at 1 mm/h. 0.4–1 mm/h is only "light".
  - Rain needs more than half of the sources (a 3/6 tie became Possible). Possible needs two wet sources or most
    sources showing light rain; one wet outlier stays Dry.
  - If the radar shows no rain anywhere within about 30 km of the route, stretches you reach in the next 90 min are
    lowered one level (was 40 min, and only when clear within 4 km).

### 1.0 (2026-11-24)

- First versioned release. The version shows in the panel footer and in "How this works".
- Verdict rule v2: radar can now also lower a stretch. If you reach it within 40 min and the latest radar frame
  shows no rain within about 4 km, the forecast drops one level. The models often get a storm right but its
  timing an hour off, and kept saying "rain" after it had passed.
- New note: when the radar showed rain near the route in the last hour but is clear now, the answer says
  "Rain just ended near … – roads may be wet".

## More documentation

- [DEPLOY.md](DEPLOY.md): server deployment runbook
- [DESIGN.md](DESIGN.md): the shipped design system (takwim)
