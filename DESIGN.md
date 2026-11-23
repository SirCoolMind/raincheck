---
name: RainCheck
description: A journey forecast set as a Malaysian takwim, where each five-minute stretch of the drive is a calendar cell.
colors:
  paper: "#eef0ec"
  sheet: "#fbfbf9"
  sheet-2: "#f2f4f0"
  ink: "#14202b"
  ink-2: "#44525f"
  ink-3: "#5f6b76"
  rule: "#d6dbd5"
  rule-strong: "#b7beb6"
  band: "#0e3b4a"
  band-2: "#134a5c"
  band-ink: "#f3f7f6"
  band-ink-2: "#b4cdd1"
  band-rule: "rgb(255 255 255 / 0.16)"
  now: "#c13d26"
  v-dry: "#eadfbd"
  v-dry-ink: "#3b331a"
  v-possible: "#c6dcef"
  v-possible-ink: "#12314d"
  v-rain: "#5f9bd6"
  v-rain-ink: "#071a2e"
  v-heavy: "#27347e"
  v-heavy-ink: "#ffffff"
  v-nodata: "#e3e6e2"
  v-nodata-ink: "#4b5660"
  ok: "#2c6e49"
  warn: "#8a5a00"
  bad: "#a8321f"
  route-casing: "#0e3b4a"
  paper-dark: "#0b1115"
  sheet-dark: "#121a20"
  sheet-2-dark: "#18222a"
  ink-dark: "#e6edf0"
  ink-2-dark: "#aab7bf"
  ink-3-dark: "#8f9da6"
  rule-dark: "#26323a"
  rule-strong-dark: "#3a4852"
  band-dark: "#0f3542"
  band-2-dark: "#164555"
  band-ink-dark: "#eef5f5"
  band-ink-2-dark: "#a3c2c7"
  now-dark: "#ff7b5e"
  v-dry-dark: "#5e5538"
  v-dry-ink-dark: "#efe6c8"
  v-possible-dark: "#20405b"
  v-possible-ink-dark: "#d7e8f7"
  v-rain-dark: "#2f6db0"
  v-rain-ink-dark: "#ffffff"
  v-heavy-dark: "#5868e6"
  v-heavy-ink-dark: "#ffffff"
  v-nodata-dark: "#222c33"
  v-nodata-ink-dark: "#a9b5bd"
  ok-dark: "#6fcf97"
  warn-dark: "#f2c14e"
  bad-dark: "#ff8a73"
  route-casing-dark: "#9fb3b9"
  route-dry-dark: "#b9a76f"
typography:
  display:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', system-ui, sans-serif"
    fontSize: "42px"
    fontWeight: 600
    lineHeight: 0.9
    letterSpacing: "0"
    fontFeature: "tnum, lnum"
  headline:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', system-ui, sans-serif"
    fontSize: "29px"
    fontWeight: 600
    lineHeight: 1.06
    letterSpacing: "0"
    fontFeature: "tnum"
  title:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.1
    fontFeature: "tnum"
  section:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0.06em"
  label:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.04em"
  numeral-small:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1
    fontFeature: "tnum"
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  meta:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.3
rounded:
  day: "2px"
  cell: "3px"
  sm: "6px"
  sheet: "14px"
  pill: "999px"
spacing:
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "20px"
  tap: "44px"
components:
  month-band:
    backgroundColor: "{colors.band}"
    textColor: "{colors.band-ink}"
    padding: "0 16px 12px"
  segmented-option:
    backgroundColor: "transparent"
    textColor: "{colors.band-ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "44px"
  segmented-option-active:
    backgroundColor: "{colors.band-ink}"
    textColor: "{colors.band}"
  button-band:
    backgroundColor: "transparent"
    textColor: "{colors.band-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "44px"
  button:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "44px"
  button-hover:
    backgroundColor: "{colors.sheet-2}"
  button-primary:
    backgroundColor: "{colors.band}"
    textColor: "{colors.band-ink}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.band-2}"
  input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "44px"
  verdict-tile:
    rounded: "{rounded.sm}"
    size: "56px"
  stretch-cell-dry:
    backgroundColor: "{colors.v-dry}"
    textColor: "{colors.v-dry-ink}"
    rounded: "{rounded.cell}"
    height: "48px"
  stretch-cell-possible:
    backgroundColor: "{colors.v-possible}"
    textColor: "{colors.v-possible-ink}"
    rounded: "{rounded.cell}"
    height: "48px"
  stretch-cell-rain:
    backgroundColor: "{colors.v-rain}"
    textColor: "{colors.v-rain-ink}"
    rounded: "{rounded.cell}"
    height: "48px"
  stretch-cell-heavy:
    backgroundColor: "{colors.v-heavy}"
    textColor: "{colors.v-heavy-ink}"
    rounded: "{rounded.cell}"
    height: "48px"
  best-chip:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
    height: "56px"
  calendar-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "4px"
    padding: "0 4px"
    height: "44px"
  calendar-row-hover:
    backgroundColor: "{colors.sheet-2}"
  badge:
    backgroundColor: "{colors.sheet-2}"
    textColor: "{colors.ink-2}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "3px 9px"
  badge-caveat:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "3px 9px"
  source-chip:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "6px 10px"
  map-tag:
    textColor: "{colors.ink-2}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  sheet:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.sheet}"
---

# Design System: RainCheck

## Overview

**Creative North Star: "The Takwim"**

RainCheck is set like the printed wall calendar that hangs in every Malaysian kitchen and office: a solid ink-teal month band at the top, big condensed numerals in a strict grid, flat process-colour fills for the days that matter, and small annotations in the corners. The drive is a takwim row. Each five-minute stretch is a cell with a tabular time, a place note and a flat verdict fill. The departure scan is a full calendar page, with departures as rows and stretches as columns.

The system is calm and printed, not alarming and glowing. Rain is normal here, so the verdict ramp stays in one sand-to-indigo family, and no red alert or weather-app chrome appears. Paper and ink carry the page. Hairlines carry the structure. Colour is spent on the verdict ramp and on one reserved vermilion that marks "now" and "selected". The phone is sparse and puts the answer first. The 400 px desktop panel is denser but keeps the same order.

The world rejects the generic weather app: a big temperature, hourly cards, red alert banners, a dashboard of cards, and false precision.

**Key Characteristics:**
- A solid ink-teal month band holds the departure controls (direction preset, clock, scrubber).
- Barlow Condensed tabular numerals for every time, count and label. system-ui for reading text.
- A flat sand → sky → blue → indigo verdict ramp. Every verdict is paired with a drawn icon and a word.
- Vermilion is reserved for now/selected.
- The departure calendar grid is the signature component.
- 1 px hairline rules. No cast shadows, except the sheet's lift off the map.

## Colors

Paper and ink neutrals, one ink-teal shell colour, a single-family verdict ramp, and one reserved vermilion. Every token has a dark counterpart (the `-dark` keys), applied through `prefers-color-scheme` or `data-theme="dark"`.

### Primary
- **Month-Band Ink Teal** (band / band-dark): the solid band over the sheet. It holds the preset control, the clock and the scrubber. It also fills primary buttons and pin markers, and sets the `accent-color` of native checkboxes and ranges. **Band Teal Lift** (band-2) is the hover state of a primary button only.
- **Band Paper** (band-ink) and **Band Mist** (band-ink-2): text on the band. Band Paper is for the clock and active segments. Band Mist is for the verb, arrival time, ruler, route line and inactive segments.

### Secondary: the Verdict Ramp
A sequential, colour-blind-safe ramp: one sand step, then one blue family stepping down in lightness. It never uses red or green.
- **Dry Sand** (v-dry), **Possible Sky** (v-possible), **Rain Blue** (v-rain), **Heavy Indigo** (v-heavy). Each fill has a paired `-ink` token for the icon drawn on it.
- **No Data Hatch** (v-nodata): always drawn as a 135° hatch against the sheet, never as a flat grey, so a missing value is never read as a verdict.
- On the map, the route uses the same ramp. In dark mode, dry uses **Route Sand** (route-dry-dark), because the dark-mode dry fill disappears against the dark basemap.

### Tertiary
- **Takwim Vermilion** (now / now-dark): the scrubber thumb ring, the selected stretch ring, the current calendar row ring, the current sparkline bar, the focus ring, the selected matrix column and text selection. Nothing else uses it.

### Neutral
- **Cool Paper** (paper): the app ground and map background. **Sheet White** (sheet): the sheet and every surface on it. **Sheet Wash** (sheet-2): hover fills, neutral badges and the MET Malaysia note.
- **Ink** (ink), **Ink 2** (ink-2) and **Ink 3** (ink-3): primary text, secondary text and meta text. Ink 3 is the floor for readable text.
- **Hairline** (rule) and **Strong Hairline** (rule-strong): section dividers, calendar row rules and table rules. The strong hairline is for control borders, the tick baseline and zero bars in the sparkline.
- **Health** (ok, warn, bad): used only for source-health status marks and caveat hairlines.

### Named Rules
**The Reserved Vermilion Rule.** Vermilion means "now" or "selected". It never marks "best", never marks weather, and never marks an error. The best departure is ringed in ink, like a holiday circled on a calendar.

**The One Family Rule.** Verdicts are encoded by lightness inside one sand-to-indigo family, and each one is always paired with its drawn icon and its word. A verdict is never shown by colour alone.

**The No False Dry Rule.** Health hues never fill a surface. A warn-amber tint reads as Dry Sand, so caveats use a hairline border and an icon.

## Typography

**Display Font:** Barlow Condensed 500/600/700, self-hosted (fallbacks: Arial Narrow, system-ui)
**Body Font:** system-ui (fallbacks: -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial)

**Character:** A condensed grotesque, as on a printed calendar or a JKR road sign, for anything you glance at. A plain system face for anything you read.

### Hierarchy
- **Display** (600, 42px, 0.9): the departure clock in the band. One per screen.
- **Headline** (600, 29px, 1.06, balanced wrap): the answer sentence. It drops to 24px in the error state.
- **Title** (600, 22–24px): the best-time numeral, the stretch-detail heading and the radar frame time.
- **Section** (700, 16px, 0.06em, uppercase, ink-2): section headings such as "Your drive" and "Best time to leave". A section heading names its section. It never sits as a label above a number.
- **Label** (600, 15px, 0.04em, uppercase): segmented options and band buttons.
- **Numeral small** (500, 13–15px, tabular): ruler, strip ticks, calendar times and wet minutes.
- **Body** (400, 15px/1.45): detail lines. Prose in the explainer is capped at 68ch.
- **Meta** (400, 13px; place labels under the strip are 12px): badges, chips, notes, attribution. 12px is the floor.

### Named Rules
**The Tabular Rule.** Every number uses `tabular-nums` in the condensed face, so times never shift while scrubbing.

**The Type-Is-Interface Rule.** The answer sentence is set large and stands on the sheet with no card around it.

## Layout

Mobile-first from 360px. On phones, the map fills the screen and a bottom sheet rests at about 46dvh with a drag handle and a 0.42s ease-out snap. At 1024px and above, the same sheet becomes a fixed 400px left panel, and the map fills the rest of the screen. The order inside the sheet never changes: month band, answer, journey strip, best time with the departure calendar, then stretch detail, the agreement matrix (folds from its heading), radar, the Trip section and a footer linking to Settings. Source health, the explainer, theme and the trip library live in the Settings dialog (gear in the band): tabs underlined in ink, sections set as condensed titles over hairlines, options as bordered tiles. Map right-click opens a small sheet-coloured menu.

The spacing scale has a 4px base. The build uses 8 / 12 / 16 / 20: sections are padded 20px by 16px and separated by a hairline, and internal gaps are 12px. Grids use a 2px gutter (1px between calendar day cells), so cells read as one printed row. Every interactive target is at least 44px. Strip cells are 48px tall, and calendar rows are 44px with 28px day cells.

## Elevation & Depth

The system is flat. Depth comes from the band against paper, from hairlines and from tonal steps between sheet and sheet-2. The only cast shadow is the sheet lifting off the map. Elsewhere, `box-shadow` draws solid rings only (focus, selected, inset dot outlines), never a blur.

### Shadow Vocabulary
- **Sheet lift, phone** (`--sheet-shadow`: `0 -6px 24px rgb(14 59 74 / 0.16), 0 -1px 0 rgb(14 59 74 / 0.08)`; dark `0 -6px 24px rgb(0 0 0 / 0.5), 0 -1px 0 rgb(255 255 255 / 0.04)`): the bottom sheet only.
- **Sheet lift, desktop panel** (`1px 0 0 var(--rule), 8px 0 28px rgb(14 59 74 / 0.08)`): the 400px side panel only.
- **Focus / selected ring** (`0 0 0 3px var(--sheet), 0 0 0 5px var(--now)`; on the band `0 0 0 2px var(--band), 0 0 0 4px var(--now)`): a solid ring, not a shadow.

### Named Rules
**The Only Lift Rule.** Only the sheet casts a shadow. Pins, chips, cards and map controls are flat, and MapLibre's control shadow is removed.

## Shapes

Small, printed corners. Data cells are almost square (2–3px). Controls and containers use a 6px radius. The sheet's top corners are 14px on phones and square on the desktop panel. Pills (999px) are used only for segmented options, band buttons, badges, source chips and map tags. Status marks use distinct shapes as well as hue: ok is a circle, degraded is a diamond, failed is a hollow square. A thin-data stretch carries a 9px ink corner notch, like a dog-ear.

## Components

### Buttons
- **Shape:** gently squared (6px). Band buttons are pills.
- **Primary:** band teal fill, band-paper text, 600 15px system-ui, 0 16px, minimum 44px. Hover uses band-2.
- **Default:** sheet fill, strong-hairline border, ink text. Hover uses sheet-2. Disabled is 50% opacity.
- **Band button ("Leave now"):** transparent, with a band-rule hairline and uppercase condensed label. Hover is an 8% white wash.
- **Focus:** the vermilion ring from Elevation.

### Segmented control (direction preset)
- A pill track at `rgb(0 0 0 / 0.22)` on the band, with 44px uppercase condensed options. The active option fills with band-paper and band-teal text.

### Inputs / Fields
- **Style:** sheet fill, strong-hairline border, 6px radius, 16px system-ui (prevents iOS zoom), minimum 44px.
- **Focus:** the border turns vermilion and the focus ring is added. Time fields in the band are transparent, with a currentColor 35% hairline and 18px condensed numerals.
- Native checkboxes and ranges are themed with `accent-color: band` at 22px.

### Chips and badges
- **Badge:** sheet-2 fill, ink-2 text, 13px 600.
- **Caveat badge:** transparent, with a 1px hairline at warn 55%, ink text and a warn-coloured warning icon. It is never filled.
- **Source chip:** sheet fill, rule hairline, a shaped status mark and a meta note. A failed chip shifts its hairline toward bad and colours its note bad.
- **Map tag:** sheet at 92% over the map, rule hairline, 13px. It states radar age and status in words.

### Cards / Containers
- No cards in cards. Sections are bands of the sheet separated by hairlines. The only bordered containers are the best chip, the search results list and the phone edit bar (6px, strong hairline, sheet fill).

### Month band (signature shell)
- A solid band-teal block holding the brand (420px and up), the preset control, refresh, "LEAVE 07:30 → 08:30" with the clock at 42px, the route line, and the scrubber. The scrubber is a 4px band-rule track with a band-paper thumb ringed in vermilion, over a five-label hour ruler (three labels on phones). The current label is band-paper.

### Journey strip (a takwim row)
- 12 equal cells on one grid with 2px gaps, 48px tall and 3px corners, each with a flat verdict fill and a 16px drawn icon. Under the cells is a strong-hairline tick baseline with tabular times (major ticks in ink), then place annotations with 6px tick marks, with the end place set right-aligned. Selecting a stretch rings it in vermilion and dims the rest to 38% in the strip, matrix and map. A legend appears on desktop.

### Departure calendar (signature)
- An open `details` element under the best chip. The header row reads "Leave | your drive, stretch by stretch | wet min" over a hairline. Each row is a 44px button: a 56px tabular time, a 28px row of verdict day cells with 1px gaps, and 52px of right-aligned wet minutes. Rows are separated by hairlines. The current row has an inset 2px vermilion ring and a bold time. The best row has its time circled in a 1.5px ink pill. Departures that have already passed collapse into a single "already passed · show" line, and are dimmed to 40% and disabled when shown. On phones, a verdict key sits above the grid.

### Best-time chip
- A 56px bordered button: a 24px tabular time, a system-ui sentence that states the arrival ("Arrive ~09:30 dry instead of ~15 min in rain."), and a 92×30 sparkline. In the sparkline, the current bar is vermilion, the best bar is ink, wet bars are rain blue, zero bars are strong hairline and past bars are at 35%. When no better time exists, the border is dashed and the sentence says so.

### Verdict icons
- Drawn SVG on a 24-unit grid, 1.75 stroke, round caps and joins, in currentColor: sun, sun-behind-cloud, umbrella, storm with bolt, and a no-data dash. The same grid supplies the UI icons (pin, flag, chevron, radar, warning and others). No emoji or glyph icons.

### Map markers
- 28px band-teal circles with a sheet border (band-paper border in dark mode). The start uses a pin glyph and the end uses a flag glyph. Via points are 14px hollow dots, and numbers appear only in edit mode, with a dashed band-mist outline. Before MapLibre loads, a pending route sketch draws a dashed casing line with paper-filled, ink-stroked dots.

### Motion
- The sheet snaps with `cubic-bezier(0.16, 1, 0.3, 1)` over 0.42s. Cells fade and the calendar chevron rotates over 0.2s. Radar can play. Nothing bounces. Under reduced motion, every animation and transition collapses to 0.01ms. Skeletons shimmer while loading, never in an error state.

## Do's and Don'ts

### Do:
- **Do** pair every verdict fill with its drawn icon and its word (Dry, Possible, Rain, Heavy, No data).
- **Do** set every time, count and duration in Barlow Condensed with `tabular-nums`.
- **Do** ring the best departure in ink (1.5px pill) and keep vermilion for the current departure and the selected stretch.
- **Do** separate sections and calendar rows with 1px hairlines instead of boxes.
- **Do** draw caveats as hairline badges (warn at 55% border, ink text, warn icon).
- **Do** keep every target at 44px or more and every readable text at 12px or more.
- **Do** hedge thin-data verdicts in words ("Likely rain…", "1 of 6 sources answered") instead of dimming the colour.
- **Do** draw missing data as the hatch, never as a flat fill.

### Don't:
- **Don't** use vermilion for "best", for weather, or for errors.
- **Don't** fill a caveat or warning badge with a tint of warn. Amber at low alpha reads as Dry Sand.
- **Don't** put a small uppercase kicker or eyebrow label above a number. The number and its sentence carry the meaning, and section headings name sections.
- **Don't** use red/green or any second hue family for verdict levels.
- **Don't** add drop shadows to pins, chips, cards or map controls. Only the sheet lifts.
- **Don't** nest cards, or put the answer sentence in a card.
- **Don't** use emoji or Unicode glyphs (☀ ⛅ ☂ ⛈ ★) as icons.
- **Don't** show false precision ("37% at 08:23") or leave a shimmer running in an error state.
