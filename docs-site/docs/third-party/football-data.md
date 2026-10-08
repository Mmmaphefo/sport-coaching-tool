---
sidebar_position: 2
---

# football-data.org

:::warning Removed in Sprint 3
The Pro Fixtures feature and its football-data.org integration were **removed in
Sprint 3** (see [Feature Rationale](../product/feature-rationale.md) for the
justification). This page is retained as a historical record of how the
integration worked while it was part of the product.
:::

## What football-data.org does for us

[football-data.org](https://www.football-data.org) provides professional football fixtures, results, and league standings. In Kickstat it powers the **Pro Fixtures** tab on the Events page, where coaches can compare their own schedule against top-tier competitions.

## Where it is used

- **Backend route:** `backend/src/routes/external.js`
  - `GET /api/external/fixtures?league=PL` returns upcoming/recent matches for an allowed league.
  - `GET /api/external/standings?league=PL` returns the league table.
- **Frontend:** `frontend/src/pages/Events.jsx` renders the Pro Fixtures tab, league selector, standings table, and fixtures list.

## Supported leagues

The backend allow-list limits calls to protect the free-tier rate limit:

| Code | Competition |
|---|---|
| PL | Premier League |
| PD | La Liga |
| BL1 | Bundesliga |
| SA | Serie A |
| FL1 | Ligue 1 |
| CL | UEFA Champions League |

## Required environment variables

Add this to `backend/.env`:

```bash
FOOTBALL_DATA_API_KEY=<your-token>
```

Get a free API token from [football-data.org/client/register](https://www.football-data.org/client/register).

## How the integration works

1. The frontend requests `/api/external/fixtures?league=PL` or `/api/external/standings?league=PL`.
2. The backend validates the league code against `ALLOWED_LEAGUES`.
3. If a fresh cached entry exists (TTL = 5 minutes), it is returned immediately.
4. Otherwise the backend calls `https://api.football-data.org/v4/...` with the `X-Auth-Token` header.
5. The response is normalised to a smaller, stable shape and cached before being sent to the client.

## Rate limits and caching

The free tier of football-data.org allows **10 requests per minute**. The in-memory 5-minute cache means repeated page loads or league switches within a session rarely hit the upstream limit. Champions League standings are intentionally skipped because the API returns a group-stage structure rather than a single table.

## Local development notes

- If `FOOTBALL_DATA_API_KEY` is missing, the backend returns HTTP 503 with the message "External API not configured".
- The cache can be cleared in tests by calling `resetCache()` exported from `external.js`.

## Compliance / attribution

Football data is provided by [football-data.org](https://www.football-data.org). We do not redistribute raw API responses; data is fetched on-demand, cached briefly for performance, and displayed within the Kickstat application. Use of the data is subject to the football-data.org terms.
