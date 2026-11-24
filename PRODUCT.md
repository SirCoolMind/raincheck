# Product

<!-- impeccable:product-schema 1 -->

> Product context for design work. Facts marked *(inferred)* are assumptions, not research.

## Platform

web

## Stack
Vite + TypeScript, no UI framework; MapLibre GL with CARTO vector basemaps; tiny PHP 8 file-cached API layer
for Nginx + PHP-FPM. Built locally; npm never runs on the server. (Pinned by the brief.)

## Users
Malaysian drivers with a regular commute (for example ~60 min along a highway such as MEX) in the morning
and the reverse in the evening. Checks it on a phone in the minutes before leaving (often one-handed, at the
door or in the car park) and on a desktop at the office before the evening drive.

## Product Purpose
Answer one question: "If I leave at time T, where on my drive will it be raining, and when?" Success is a
one-glance answer the user trusts enough to change their departure time or take an umbrella.

## Positioning
Weather apps forecast a place at a time; RainCheck forecasts the *journey*: each ~5-minute stretch gets the
forecast for the moment the driver reaches it, voted across five models plus live radar, with the disagreement
shown rather than hidden.

## Operating Context
Glance-and-go before driving; tropical afternoon/evening thunderstorms (Nov–Mar NE monsoon) are the main
risk. Bright daylight on phones in the morning, office lighting / dusk in the evening. Data from keyless public
APIs (Open-Meteo, MET Norway, MET Malaysia via data.gov.my, RainViewer, OSRM, Nominatim).

## Capabilities and Constraints
Route editable (waypoints), departure scrubber ±2 h evaluated locally, best-time suggestion, radar playback,
per-source agreement, offline last result, light/dark. Out of scope: live traffic, alternative routes, native
app, accounts, notifications. Malaysian Malay forecast text shown as context only.

## Evidence on Hand
No real users, testimonials or accuracy stats exist; never claim accuracy. A field-test log in README is the
only future evidence.

## Product Principles
1. The answer comes first; everything else is "why".
2. Honest about uncertainty: show agreement counts and data resolution, never fake precision.
3. Calm, not alarming: rain is normal here; heavy rain on MEX is what matters.
4. Works when the network doesn't.

## Accessibility & Inclusion
WCAG AA in both themes, colour-blind-safe verdicts always paired with icon + word, keyboard-complete,
≥ 44 px targets, reduced motion respected.
