---
sidebar_position: 2
---

# API Design

## Architecture style

Kickstat uses a **RESTful** API. Every resource (squads, athletes, events, fixtures, invites) is accessed through standard HTTP methods:

| Method | Purpose |
|--------|---------|
| `GET` | Read a resource or list |
| `POST` | Create a resource |
| `PATCH` | Partially update a resource |
| `PUT` | Replace a resource or set a complete sub-resource |
| `DELETE` | Remove or soft-delete a resource |

## Base URL

All API endpoints are mounted under `/api` on the backend server.

| Environment | Base URL |
|-------------|----------|
| Local development | `http://localhost:3000/api` |
| Production | `https://kickstat-api-i2rc.onrender.com/api` |

## Authentication

Every `/api/*` route (except `/api/webhooks/clerk` and `/api/health`) requires a valid Clerk JWT token in the `Authorization` header:

```
Authorization: Bearer <clerk-jwt>
```

The backend validates the token using Clerk's JWKS endpoint. If the token is missing or invalid, the API returns `401 Unauthorized`.

## Architecture Decisions

### 1. RESTful resource-oriented design
Each domain entity (squad, athlete, event, fixture, injury, invite, tactic, session/drill) is a resource with standard CRUD operations. This makes the API predictable and easy to document.

### 2. Nested resources for scoped operations
Sub-resources are used where ownership is clear:
- `/api/events/:id/logs` — log entries belong to an event
- `/api/events/:id/fixtures` — fixtures belong to a league
- `/api/fixtures/:id/logs` — log entries belong to a fixture
- `/api/athletes/:id/stats/override` — stat overrides belong to an athlete

### 3. PATCH for partial updates, PUT for full replacements
- `PATCH` is used for most updates (e.g., updating squad name without touching other fields)
- `PUT` is reserved for operations that replace a complete sub-resource (e.g., setting a full lineup)

### 4. Soft deletes for audit trail
Log entries use soft delete (setting a `deleted_at` timestamp) rather than hard delete, so that undo operations can restore them and the audit trail is preserved.

### 5. Query parameters for filtering
List endpoints accept query parameters for filtering rather than path segments:
- `GET /api/events?gender_filter=true` — filter events by squad gender
- `GET /api/sessions?tactical_goal=possession&phase=attacking` — filter drills
- `GET /api/weather?location=Johannesburg` — geocode by name

### 6. Background sweeps for async state transitions
- **Auto-transition sweep** (every 60s): Events transition from `scheduled` → `live` → `completed` based on their date and duration
- **Reminder sweep** (every hour): Sends reminders for upcoming events

### 7. Idempotency for offline support
The `POST /api/events/:id/logs` endpoint accepts a `client_id` field. If the same `client_id` is submitted twice (e.g., due to offline queue replay), the second request is ignored, preventing duplicate log entries.

---

## Complete Endpoint Reference

### Health & Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check (no auth required) |
| `GET` | `/api/me` | Current user ID from JWT |
| `POST` | `/webhooks/clerk` | Clerk webhook for user deletion (no auth) |

### Account (`/api/account`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/account/me` | Current user profile and role |
| `DELETE` | `/api/account/me` | Delete account and all associated data |

### Squads (`/api/squads`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/squads/mine` | Get current user's squad (auto-creates if none) |
| `PATCH` | `/api/squads/mine` | Update squad name, gender, onboarding status, public visibility |

**PATCH body fields:** `name`, `gender` (male/female), `onboarded` (boolean), `is_public` (boolean)

### Athletes (`/api/athletes`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/athletes` | List all athletes in squad with injury flags |
| `POST` | `/api/athletes` | Add athlete (coach only); optional email for athlete invite |
| `GET` | `/api/athletes/:id/stats` | Per-athlete statistics, injury history, BMI |
| `PATCH` | `/api/athletes/:id` | Edit athlete details, managed/rested status, photo |
| `DELETE` | `/api/athletes/:id` | Remove athlete (coach only) |
| `PATCH` | `/api/athletes/:id/stats/override` | Coach-only stat correction |
| `DELETE` | `/api/athletes/:id/stats/override/:statKey` | Revert stat override |

### Events (`/api/events`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/events` | List events; supports `?gender_filter=true` |
| `POST` | `/api/events` | Create event or league/tournament |
| `GET` | `/api/events/clashes` | Pre-check time conflicts before creation |
| `GET` | `/api/events/:id` | Event detail with timeline, lineups, availability |
| `PATCH` | `/api/events/:id` | Update event (title, status, location, duration) |
| `GET` | `/api/events/:id/clashes` | Re-check clashes for existing event |
| `PATCH` | `/api/events/:id/cancel` | Quick cancel endpoint |
| `DELETE` | `/api/events/:id` | Permanently remove event |
| `POST` | `/api/events/:id/join` | Join open league/tournament |
| `GET` | `/api/events/:id/teams` | List teams in league/tournament |
| `GET` | `/api/events/:id/fixtures` | List fixtures in league/tournament |
| `GET` | `/api/events/:id/standings` | League standings table |
| `GET` | `/api/events/:id/stats` | Top scorers/assisters in league |
| `PUT` | `/api/events/:id/lineup` | Set starting XI + bench |
| `POST` | `/api/events/:id/simulate` | Generate match simulation |
| `GET` | `/api/events/:id/logs` | Active log entries for live timeline |
| `POST` | `/api/events/:id/logs` | Log live action (goal, card, sub, etc.) |
| `PATCH` | `/api/events/:id/logs/:logId` | Edit log entry |
| `DELETE` | `/api/events/:id/logs/:logId` | Undo log entry (soft delete) |
| `GET` | `/api/events/:id/rsvps` | All athlete availability responses |
| `PUT` | `/api/events/:id/rsvps/mine` | Athlete sets own availability |
| `PUT` | `/api/events/:id/rsvps/:athleteId` | Coach sets athlete availability |

### Fixtures (`/api/fixtures`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/fixtures/:id` | Fixture detail with timeline, lineups, rosters |
| `GET` | `/api/fixtures/:id/clashes` | Check fixture time conflicts |
| `PATCH` | `/api/fixtures/:id` | Update fixture status/kickoff time |
| `PUT` | `/api/fixtures/:id/lineup` | Set both teams' lineups |
| `POST` | `/api/fixtures/:id/simulate` | Generate fixture simulation |
| `GET` | `/api/fixtures/:id/logs` | Fixture log entries |
| `POST` | `/api/fixtures/:id/logs` | Log fixture action (home team only) |
| `PATCH` | `/api/fixtures/:id/logs/:logId` | Edit fixture log |
| `DELETE` | `/api/fixtures/:id/logs/:logId` | Undo fixture log |

### Injuries (`/api/injuries`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/injuries` | Log injury with automatic return date estimation |
| `PATCH` | `/api/injuries/:id` | Coach override return date, edit details, clear injury |
| `DELETE` | `/api/injuries/:id` | Remove injury (coach only) |

### Invites (`/api/invites`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/invites` | Create assistant invite (coach only) |
| `POST` | `/api/invites/:token/accept` | Accept invite and link to squad/role |
| `GET` | `/api/invites/verify/:token` | Public invite verification (no auth) |

### Tactics (`/api/tactics`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tactics` | List all tactics for squad |
| `GET` | `/api/tactics/:id` | Get single tactic with frames |
| `POST` | `/api/tactics` | Create new tactic |
| `PATCH` | `/api/tactics/:id` | Update tactic |
| `DELETE` | `/api/tactics/:id` | Delete tactic |

### Sessions / Drills (`/api/sessions`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sessions` | List drills; supports `?tactical_goal=`, `?age_group=`, `?max_duration=`, `?phase=` |
| `POST` | `/api/sessions` | Create new drill |
| `PATCH` | `/api/sessions/:id` | Update drill |
| `DELETE` | `/api/sessions/:id` | Delete drill |

### Compare (`/api/compare`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/compare/athletes?ids=1,2` | Side-by-side athlete comparison stats |

### Dashboard (`/api/dashboard`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/dashboard/summary` | Dashboard summary: roster readiness, form, attack leaders, live events |

### Weather (`/api/weather`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/weather` | Weather forecast; supports `?lat=&lng=` or `?location=` |

### Public (`/api/public`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/public/squads` | Public squad directory + live events (no auth) |
| `GET` | `/api/public/squads/:id` | Public squad page with roster and results (no auth) |
| `GET` | `/api/public/links/:token` | Private link squad page (no auth) |
| `GET` | `/api/public/links/:token/export.csv` | CSV roster export (no auth) |

---

## Error Handling

All errors return a JSON object with an `error` field:

```json
{ "error": "Gender must be male or female" }
```

Common status codes:

| Code | Meaning |
|------|---------|
| `400` | Validation error (missing field, invalid value) |
| `401` | Missing or invalid authentication token |
| `403` | Authenticated but not authorized (e.g., assistant trying to delete athlete) |
| `404` | Resource not found |
| `409` | Conflict (e.g., duplicate entry) |
| `500` | Internal server error |
| `503` | External service unavailable (e.g., weather API down) |

---

## Swagger UI

An interactive API documentation is available at `/api/docs` when the backend is running (disabled in test environment). The OpenAPI specification is defined in `backend/openapi.yml`.
