require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { clerkMiddleware, requireAuth } = require('./middleware/auth');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');
const webhooksRouter = require('./routes/webhooks');
const dashboardRouter = require('./routes/dashboard');
const squadsRouter = require('./routes/squads');
const athletesRouter = require('./routes/athletes');
const eventsRouter = require('./routes/events');
const fixturesRouter = require('./routes/fixtures');
const invitesRouter = require('./routes/invites');
const accountRouter = require('./routes/account');
const weatherRouter = require('./routes/weather');
const injuriesRouter = require('./routes/injuries');
const compareRouter = require('./routes/compare');
const reportsRouter = require('./routes/reports');
const tacticsRouter = require('./routes/tactics');
const sessionsRouter = require('./routes/sessions');
const seasonsRouter = require('./routes/seasons');
const friendliesRouter = require('./routes/friendlies');
const publicRouter = require('./routes/public');
const healthRouter = require('./routes/health');
const { sendEventReminders } = require('./lib/reminders');

const app = express();

app.use('/webhooks', webhooksRouter);
// FRONTEND_URL carries the deployed frontend origin (set on the hosting
// platform). It is normalised because a trailing slash or stray whitespace in
// the dashboard value ("https://kickstat.pages.dev/") silently fails every
// browser request with a CORS error. Several origins may be given
// comma-separated, and Cloudflare Pages preview deploys
// (<hash>.<project>.pages.dev) of a configured pages.dev origin are allowed.
// The localhost ports cover Vite dev servers, which bump the port when 5173
// is already in use.
const normaliseOrigin = (o) => o.trim().replace(/\/+$/, '').toLowerCase();
const allowedOrigins = new Set(
  [
    ...(process.env.FRONTEND_URL || '').split(','),
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
  ]
    .map(normaliseOrigin)
    .filter(Boolean)
);
const pagesProjects = [...allowedOrigins]
  .map((o) => o.match(/^https:\/\/([a-z0-9-]+)\.pages\.dev$/))
  .filter(Boolean)
  .map((m) => m[1]);

function isAllowedOrigin(origin) {
  // Non-browser clients (curl, health checks, server-to-server) send none.
  if (!origin) return true;
  const o = normaliseOrigin(origin);
  if (allowedOrigins.has(o)) return true;
  return pagesProjects.some((p) =>
    new RegExp(`^https://[a-z0-9-]+\\.${p}\\.pages\\.dev$`).test(o)
  );
}

app.use(cors({
  origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
  credentials: true,
}));
// Raised from the 100kb default so profile-photo data URLs (already
// downscaled in the browser) fit without hitting a 413.
app.use(express.json({ limit: '1mb' }));
// No auth middleware — the token in the URL is the access control (see
// public.js). Mounted before clerkMiddleware so a Clerk outage or key
// problem can never take the public squad pages down with it.
app.use('/api/public', publicRouter);
// Registered before every authenticated router so getAuth()/requireAuth()
// work everywhere (including /api/dashboard).
app.use(clerkMiddleware());
app.use('/api/dashboard', dashboardRouter);

// Moved here from before `const app = express()` — that's what was crashing
// the server. Everything else in this block is unchanged from what you sent.
if (process.env.NODE_ENV !== 'test') {
  const swaggerDocument = YAML.load(path.join(__dirname, '..', 'openapi.yml'));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}

app.use('/api/squads', squadsRouter);
app.use('/api/athletes', athletesRouter);
app.use('/api/events', eventsRouter);
app.use('/api/fixtures', fixturesRouter);
app.use('/api/invites', invitesRouter);
app.use('/api/account', accountRouter);
app.use('/api/weather', weatherRouter);
app.use('/api/injuries', injuriesRouter);
app.use('/api/compare', compareRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/tactics', tacticsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/seasons', seasonsRouter);
app.use('/api/friendlies', friendliesRouter);

// No auth — Render's deploy health check and the keepalive workflow hit
// this without a token; see routes/health.js.
app.use('/api/health', healthRouter);

// Protected route example — requires a logged-in user
app.get('/api/me', requireAuth(), (req, res) => {
  res.json({ userId: req.auth.userId });
});

// ---- Auto-transition sweep ----
// Runs periodically so events don't require a manual "Start live"/"End event"
// click: scheduled -> live once event_date passes, live -> completed once
// started_at + duration_minutes passes (falling back to event_date for rows
// that went live before started_at existed). Manual buttons on the frontend
// still work as an override (e.g. starting a delayed match early/late).
// Shared pool from db.js — previously a second pool created just for the
// sweep, which doubled this process's connection count.
const sweepPool = require('./db');
const { getMatchAvailability } = require('./lib/availability');

// Matches and fixtures may only start once enough players are available, so
// the sweep checks each due row individually instead of flipping every one in
// a single UPDATE — the RSVP bar holds for the automatic start exactly as it
// does for the Start live button (see lib/availability). A match that is short
// of available players simply stays 'scheduled' until the squad responds.
async function startDueMatches() {
  const matchCandidates = await sweepPool.query(
    `SELECT id, squad_id FROM events
     WHERE status = 'scheduled' AND format = 'match' AND event_date <= now()`
  );
  for (const row of matchCandidates.rows) {
    const availability = await getMatchAvailability(sweepPool, { eventId: row.id, squadId: row.squad_id });
    if (!availability.meets) continue;
    await sweepPool.query(
      `UPDATE events SET status = 'live', started_at = COALESCE(started_at, now()), updated_at = now()
       WHERE id = $1 AND status = 'scheduled'`,
      [row.id]
    );
  }

  // League/tournament fixtures follow the same bar (their event carries the
  // RSVPs; the home squad is the one that fields the team).
  const fixtureCandidates = await sweepPool.query(
    `SELECT id, event_id, home_squad_id FROM fixtures
     WHERE status = 'scheduled' AND event_date <= now()`
  );
  for (const row of fixtureCandidates.rows) {
    const availability = await getMatchAvailability(sweepPool, {
      eventId: row.event_id,
      squadId: row.home_squad_id,
    });
    if (!availability.meets) continue;
    await sweepPool.query(
      `UPDATE fixtures SET status = 'live', started_at = COALESCE(started_at, now()), updated_at = now()
       WHERE id = $1 AND status = 'scheduled'`,
      [row.id]
    );
  }
}

async function runAutoTransitionSweep() {
  try {
    // Training sessions carry no availability bar, so they still flip in one
    // statement. League/tournament containers also pass through a 'scheduled'
    // state (while teams are joining) and must never auto-start; their
    // fixtures transition individually above.
    await sweepPool.query(
      `UPDATE events SET status = 'live', started_at = COALESCE(started_at, now()), updated_at = now()
       WHERE status = 'scheduled' AND format = 'training' AND event_date <= now()`
    );
    await startDueMatches();
    await sweepPool.query(
      `UPDATE events SET status = 'completed', updated_at = now()
       WHERE status = 'live' AND format IN ('match', 'training')
         AND COALESCE(started_at, event_date) + (COALESCE(duration_minutes, 90) || ' minutes')::interval <= now()`
    );

    await sweepPool.query(
      `UPDATE fixtures f
       SET status = 'completed', updated_at = now()
       FROM events e
       WHERE f.status = 'live'
         AND f.event_id = e.id
         AND COALESCE(f.started_at, f.event_date) + (COALESCE(e.duration_minutes, 90) || ' minutes')::interval <= now()`
    );
  } catch (err) {
    console.error('Auto-transition sweep failed:', err.message);
  }
}

runAutoTransitionSweep();
setInterval(runAutoTransitionSweep, 60 * 1000);

// Safety net: any error that escapes a route handler is answered as JSON,
// never Express's default HTML page (which includes a stack trace outside
// production). Details go to the server log only.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// ---- Event reminder sweep ----
// AI assistance: drafted with Claude (Sonnet 5) via claude.ai; reviewed and tested by the project team.
// Sends email reminders to coaches for scheduled events starting within the
// next 24 hours. Runs immediately on startup and then every hour.
sendEventReminders(sweepPool);
setInterval(() => sendEventReminders(sweepPool), 60 * 60 * 1000);