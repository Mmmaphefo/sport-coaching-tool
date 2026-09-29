---
sidebar_position: 7
---

# Mapbox Maps & Geocoding

## What Mapbox does for us

[Mapbox](https://mapbox.com) powers everything location-related around an
event's venue. One public access token (`VITE_MAPBOX_TOKEN`) unlocks three
products:

1. **Dark navigation basemap** — the venue editor's map renders on Mapbox's
   `navigation-night-v1` raster tiles: the same family of dark, road-first
   basemaps that ride-hailing apps use, and a close visual match for
   KickStat's dark theme.
2. **Address search** — the coach types "Wits Main Oval" in the search box
   above the map and picks the right place from the ranked results
   (forward geocoding, biased towards the current view via `proximity`).
   Picking a result drops the pin on the exact coordinates and offers to
   fill the event's location field.
3. **Reverse geocoding & static maps** — a pin dropped by hand or by GPS is
   shown with its closest street address so a bare coordinate can be
   sanity-checked, and the weather widget's read-only mini-map renders as a
   single pre-rendered static image on the same dark basemap.

The GPS button requests a **high-accuracy fix** (`enableHighAccuracy: true`,
no cached position) and reports the accuracy radius (`±12 m`) alongside the
pinned coordinates, which are stored to six decimal places (~0.1 m).

## Why Mapbox

- **Ride-hailing-grade maps without a credit card.** The free tier (~50k map
  loads + ~100k geocoding requests per month) needs only an email signup —
  unlike Google Maps Platform, which requires a billing account even on the
  free tier.
- **Public tokens are public by design** — the same rule as Clerk's
  publishable key, so the token ships inside the Vite bundle via
  `frontend/.env.production` with no server-side proxying needed.
- **Graceful degradation.** With no token configured the editor falls back to
  the previous OpenStreetMap tiles: the map, click-to-pin and GPS still work,
  only address search and reverse geocoding disappear. CI runs in this mode,
  so tests never need a token or network access.

## Where it lives in the codebase

| Piece | File |
|---|---|
| Mapbox client (token, tile URLs, geocoding, static maps) | `frontend/src/lib/mapbox.js` |
| Venue editor (search box, GPS, pin, reverse geocoding) | `frontend/src/components/VenueMapEditor.jsx` |
| Read-only mini-map on the weather widget | `frontend/src/components/WeatherWidget.jsx` |
| Token configuration | `frontend/.env.example`, `frontend/.env.production` (`VITE_MAPBOX_TOKEN`) |
| Tests | `frontend/src/components/VenueMapEditor.test.jsx`, `frontend/src/components/WeatherWidget.test.jsx` |

## Setup

1. Create a free account at [mapbox.com](https://account.mapbox.com/auth/signup/)
   (no credit card required).
2. Copy the **default public token** from the account page — it starts with
   `pk.`.
3. Paste it as `VITE_MAPBOX_TOKEN` in `frontend/.env` (local development)
   and `frontend/.env.production` (baked into the production build; the CI
   deploy job builds from the committed file, so committing the token deploys
   it).

## Attribution

Mapbox's terms require visible attribution. The venue editor renders
**© Mapbox** (linking to mapbox.com/about/maps) and **© OpenStreetMap**
(linking to openstreetmap.org/copyright) on the map itself, and the static
mini-map keeps Mapbox's built-in attribution overlay.

## Costs and limits

All usage sits comfortably inside the free tier: a coach's editing session
loads a handful of tiles per zoom level, address searches fire debounced
(350 ms after the last keystroke) and only once at least three characters are
typed, and reverse geocoding is debounced (600 ms) so dragging a pin issues
at most one request for its resting position.
