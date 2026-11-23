---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: []
---

Scope: the single app screen (index.html), mode **Operate**. Audience: one commuter, phone before leaving, desktop at the office. Task: read the verdict, then pick a departure. Proof: live multi-source forecast per stretch; no accuracy claims.

## Direction contract
THESIS: The commute is a takwim row. Each ~5-min stretch is a calendar cell with a big tabular time, a tiny place annotation and a flat verdict fill. It refuses the weather-app default (a big temperature, hourly cards, a red alert banner).

OWN-WORLD: Paper ground (cool off-white / near-black ink in dark), a solid deep ink-teal month band over the sheet, Barlow Condensed numerals and labels, system-ui body, flat fills on a sand→sky→blue→indigo verdict ramp with drawn SVG icons, 1 px hairline grid rules, vermilion reserved for "now/selected". No shadows except the sheet's lift. No cards inside cards.

STORY: Glance: "Rain 08:20–08:35 near MEX – Putrajaya, 4/6 agree". Trust it via the strip and the matrix. Act: tap the best-time chip or drag the scrubber.

FIRST VIEWPORT: Mobile 375: full-bleed map (top 45%) with the route in route ink and radar. Bottom sheet peeks at 55%: the month band holds the direction preset (Morning/Evening/Custom) and the departure time. Under it, the answer sentence at ~28 px condensed with its icon, then confidence + "updated" on one line, the journey strip (12 cells, time ticks on one baseline), then the best-time chip with its sparkline. Desktop ≥1024: the same sheet as a fixed 400 px left panel, with the map filling the rest.

FORM: Takwim (printed Malaysian wall calendar), position 6 of 7 on the grounded list, seed key 00800bad. Signature move: the "departure calendar". The best-time scan renders as a takwim grid (rows = departures −60…+60 min, columns = stretches), filled like holiday cells. Tapping a row sets the departure. Raises: Ikeda tabular hairlines, folio fixed-scale baseline, streaming-wall focus-dims-rest, orienteering reserved route ink, metro type-as-interface.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Unresolved: office pin; MET Malaysia gloss wording.
