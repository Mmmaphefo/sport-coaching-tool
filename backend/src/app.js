require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { clerkMiddleware, requireAuth } = require('./middleware/auth');
const webhooksRouter = require('./routes/webhooks');
const squadsRouter = require('./routes/squads');
const athletesRouter = require('./routes/athletes');
const eventsRouter = require('./routes/events');
const fixturesRouter = require('./routes/fixtures');
const invitesRouter = require('./routes/invites');
const accountRouter = require('./routes/account');
const weatherRouter = require('./routes/weather');
const seasonsRouter = require('./routes/seasons');
const friendliesRouter = require('./routes/friendlies');
const leaderboardRouter = require('./routes/leaderboard');
const { sendEventReminders } = require('./lib/reminders');

const app = express();

app.use('/webhooks', webhooksRouter);
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'],
  credentials: true,
}));
app.use(express.json());
app.use(clerkMiddleware());
app.use('/api/squads', squadsRouter);
app.use('/api/athletes', athletesRouter);
app.use('/api/events', eventsRouter);
app.use('/api/fixtures', fixturesRouter);
app.use('/api/invites', invitesRouter);
app.use('/api/account', accountRouter);
app.use('/api/weather', weatherRouter);
app.use('/api/seasons', seasonsRouter);
app.use('/api/friendlies', friendliesRouter);
app.use('/api/leaderboard', leaderboardRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Protected route example — requires a logged-in user
app.get('/api/me', requireAuth(), (req, res) => {
  res.json({ userId: req.auth.userId });
});

// ---- Auto-transition sweep ----
// Runs periodically so events don't require a manual "Start live"/"End event"
// click: scheduled -> live once event_date passes, live -> completed once
// event_date + duration_minutes passes. Manual buttons on the frontend still
// work as an override (e.g. starting a delayed match early/late).
const sweepPool = new Pool({ connectionString: process.env.DATABASE_URL });

async function runAutoTransitionSweep() {
  try {
    // Simple events and league containers
    await sweepPool.query(
      `UPDATE events SET status = 'live', updated_at = now()
       WHERE status = 'scheduled' AND event_date <= now()`
    );
    await sweepPool.query(
      `UPDATE events SET status = 'completed', updated_at = now()
       WHERE status = 'live'
         AND event_date + (COALESCE(duration_minutes, 90) || ' minutes')::interval <= now()`
    );

    // League/tournament fixtures
    await sweepPool.query(
      `UPDATE fixtures SET status = 'live', updated_at = now()
       WHERE status = 'scheduled' AND event_date <= now()`
    );
    await sweepPool.query(
      `UPDATE fixtures f
       SET status = 'completed', updated_at = now()
       FROM events e
       WHERE f.status = 'live'
         AND f.event_id = e.id
         AND f.event_date + (COALESCE(e.duration_minutes, 90) || ' minutes')::interval <= now()`
    );
  } catch (err) {
    console.error('Auto-transition sweep failed:', err.message);
  }
}

runAutoTransitionSweep();
setInterval(runAutoTransitionSweep, 60 * 1000);

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
