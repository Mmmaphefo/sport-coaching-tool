---
sidebar_position: 5
---

# Open-Meteo Weather API

## What Open-Meteo does for us

[Open-Meteo](https://open-meteo.com) powers the venue weather forecast shown on an event's creation and detail pages (US18). Given a coach's free-text venue name (e.g. "Wits Rugby Fields"), the backend:

1. **Geocodes** the venue name to latitude/longitude via Open-Meteo's geocoding endpoint.
2. **Fetches a forecast** for those coordinates — current conditions plus a 3-day daily outlook (max/min temperature, precipitation chance, WMO weather code).
3. Maps Open-Meteo's numeric [WMO weather codes](https://open-meteo.com/en/docs) to a human-readable description and emoji (`WEATHER_CODES` in `weather.js`) before returning the response.

## Why Open-Meteo

- **No API key required** — nothing to store as a secret, no risk of hitting a paid tier by accident during coursework.
- **Free for our request volume**, with no rate-limit surprises.
- **Combines geocoding and forecasting** from one provider, so a free-text venue name goes straight to a forecast without a separate geocoding subscription.

## Where it lives in the codebase

| Piece | File |
|---|---|
| Route | `backend/src/routes/weather.js` — `GET /api/weather?location=<venue name>` |
| Tests | `backend/tests/integration/weather.integration.test.js` |
| Frontend | Event creation form (live preview as a coach types a venue) and the event detail page, both via a shared weather-display component |

## Caching

Geocoding results and forecasts are cached in memory (`geocodeCache` / `weatherCache` in `weather.js`) to avoid re-hitting Open-Meteo on every render of a page full of events:

- **Geocode results never expire** within a running server process — a venue's coordinates don't change.
- **Forecasts are cached for 15 minutes** (`WEATHER_CACHE_TTL_MS`), which is short enough to stay accurate but long enough that a dashboard with several events doesn't trigger a forecast request per event per page load.

This is an in-memory cache (a `Map`), not a persistent one — it resets on every server restart/redeploy, which is fine given the 15-minute TTL.

## Error handling

- If the venue name can't be geocoded (typo, made-up place, etc.), the endpoint returns **404** rather than a partial/broken forecast.
- If an event has no venue set at all, no forecast is requested and none is shown — this is a normal case, not an error (see US18's acceptance criteria in [Acceptance Tests](../product/acceptance-tests.md)).
- If Open-Meteo itself is unreachable (network failure, outage), both the geocoding and forecast calls return **503** rather than letting the request hang or crash.
- The CI test suite skips the "real venue" assertion gracefully if Open-Meteo is unreachable from the CI runner, so a third-party outage doesn't fail the whole pipeline.
