// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// Seasons (T17) and the schedule generator (T23). A season is a named date
// range per squad; its detail reuses the same teamStats building blocks as
// the printable season report (T20), so the two can never disagree. The
// generator spreads a list of opponents across the season at a fixed cadence
// and flags clashes advisory-style — the same "flag, never block" rule the
// calendar already follows for single events.

const express = require('express');
const pool = require('../db');
const { requireAuth, getAuth } = require('../middleware/auth');
const { getOwnedSquadIdForStaff, getOrCreateUserId } = require('./_squad');
const { findClashes } = require('../lib/clashes');
const { loadTeamMatches, summarise, byOpponent } = require('../lib/teamStats');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_SEASONS = 20;
const MAX_SPAN_DAYS = 400;
const MAX_OPPONENTS = 12;

function parseDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayString(date) {
  return date.toISOString().slice(0, 10);
}

// Validates and normalises the { name, starts_on, ends_on } payload shared by
// POST and PATCH. `currentId` lets PATCH skip the season itself when checking
// for a duplicate name. Returns the cleaned fields or throws a 400/409.
async function validateSeasonFields(squadId, { name, starts_on, ends_on }, currentId = null) {
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (!cleanName) {
    throw badRequest('Season name is required');
  }
  if (cleanName.length > 100) {
    throw badRequest('Season name must be 100 characters or fewer');
  }

  const start = parseDay(starts_on);
  const end = parseDay(ends_on);
  if (!start || !end) {
    throw badRequest('Use dates in the form YYYY-MM-DD');
  }
  if (start > end) {
    throw badRequest('The start date must be on or before the end date');
  }
  if ((end - start) / (24 * 60 * 60 * 1000) > MAX_SPAN_DAYS) {
    throw badRequest(`A season cannot span more than ${MAX_SPAN_DAYS} days`);
  }

  const duplicate = await pool.query(
    'SELECT id FROM seasons WHERE squad_id = $1 AND lower(name) = lower($2)',
    [squadId, cleanName]
  );
  const clash = duplicate.rows.find((row) => row.id !== currentId);
  if (clash) {
    const err = new Error(`You already have a season called "${cleanName}"`);
    err.status = 409;
    throw err;
  }

  return { name: cleanName, starts_on: dayString(start), ends_on: dayString(end) };
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

// Returns { athleteCount, minRosterSize, meetsMinimum } — the same gate
// POST /api/events applies before scheduling a match, kept in step so a
// generated fixture can never dodge the roster rule a hand-scheduled one
// has to pass.
async function getRosterStatus(squadId) {
  const result = await pool.query(
    `SELECT s.min_roster_size,
            (SELECT COUNT(*)::int FROM athletes a WHERE a.squad_id = s.id) AS athlete_count
     FROM squads s
     WHERE s.id = $1`,
    [squadId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`Squad ${squadId} not found while checking roster status`);
  }
  return {
    athleteCount: row.athlete_count,
    minRosterSize: row.min_roster_size,
    meetsMinimum: row.athlete_count >= row.min_roster_size,
  };
}

async function loadSeason(squadId, id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) return null;
  // starts_on/ends_on are cast to text so they stay plain YYYY-MM-DD —
  // node-pg otherwise hands back Date objects, which JSON-serialises with
  // a timezone offset and breaks the plain day comparisons below.
  const result = await pool.query(
    `SELECT id, squad_id, name, starts_on::text AS starts_on, ends_on::text AS ends_on,
            created_at, updated_at
       FROM seasons WHERE id = $1 AND squad_id = $2`,
    [numericId, squadId]
  );
  return result.rows[0] || null;
}

// The generator's date plan: one kickoff per opponent, `cadenceDays` apart,
// optionally snapped forward to a weekday. Pure date math (UTC days), so the
// preview the coach sees is exactly what gets inserted.
function planKickoffs({ firstKickoff, cadenceDays, weekday, kickoffTime, count }) {
  let start = parseDay(firstKickoff);
  if (weekday !== null) {
    while (start.getUTCDay() !== weekday) {
      start = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    }
  }
  const plan = [];
  for (let i = 0; i < count; i += 1) {
    const day = new Date(start.getTime() + i * cadenceDays * 24 * 60 * 60 * 1000);
    plan.push(`${dayString(day)}T${kickoffTime}`);
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /api/seasons — the squad's seasons, newest first, with calendar counts.
router.get('/', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);

    const result = await pool.query(
      `SELECT s.id, s.name, s.starts_on::text AS starts_on, s.ends_on::text AS ends_on, s.created_at, s.updated_at,
              COUNT(e.id)::int AS event_count,
              COUNT(e.id) FILTER (WHERE e.status = 'scheduled')::int AS scheduled_count,
              COUNT(e.id) FILTER (WHERE e.status = 'completed')::int AS completed_count
         FROM seasons s
         LEFT JOIN events e ON e.season_id = s.id
        WHERE s.squad_id = $1
        GROUP BY s.id
        ORDER BY s.starts_on DESC, s.id DESC`,
      [squadId]
    );
    res.json(result.rows);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Error listing seasons:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/seasons — create a season. Staff only, like event scheduling.
router.post('/', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);

    const count = await pool.query('SELECT COUNT(*)::int AS n FROM seasons WHERE squad_id = $1', [squadId]);
    if (count.rows[0].n >= MAX_SEASONS) {
      throw badRequest(`You already have ${MAX_SEASONS} seasons — delete one before adding another`);
    }

    const fields = await validateSeasonFields(squadId, req.body);
    const result = await pool.query(
      `INSERT INTO seasons (squad_id, name, starts_on, ends_on)
       VALUES ($1, $2, $3, $4)
       RETURNING id, squad_id, name, starts_on::text AS starts_on, ends_on::text AS ends_on,
                 created_at, updated_at`,
      [squadId, fields.name, fields.starts_on, fields.ends_on]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Error creating season:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/seasons/:id — season detail: the record and per-match breakdown
// over the season's dates (same teamStats pipeline as the printable report)
// plus the season's own schedule with live clash flags on upcoming matches.
router.get('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);

    const season = await loadSeason(squadId, req.params.id);
    if (!season) {
      return res.status(404).json({ error: 'Season not found' });
    }

    const start = parseDay(season.starts_on);
    const range = {
      from: start,
      toExclusive: new Date(parseDay(season.ends_on).getTime() + 24 * 60 * 60 * 1000),
    };
    const matches = await loadTeamMatches(pool, squadId, range);

    const schedule = await pool.query(
      `SELECT id, title, opponent, event_date, duration_minutes, location, status, format
         FROM events
        WHERE season_id = $1
        ORDER BY event_date`,
      [season.id]
    );

    // Clash flags ride along on scheduled matches only — completed or live
    // ones can no longer be moved, so re-checking them would be noise.
    for (const row of schedule.rows) {
      row.clashes = row.status === 'scheduled'
        ? await findClashes(pool, squadId, row.event_date, row.duration_minutes, {
            excludeEventId: row.id,
          })
        : [];
    }

    res.json({
      season,
      summary: summarise(matches),
      matches,
      opponents: byOpponent(matches),
      schedule: schedule.rows,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Error loading season:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/seasons/:id — rename or resize a season.
router.patch('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);

    const season = await loadSeason(squadId, req.params.id);
    if (!season) {
      return res.status(404).json({ error: 'Season not found' });
    }

    const fields = await validateSeasonFields(
      squadId,
      {
        name: req.body.name !== undefined ? req.body.name : season.name,
        starts_on: req.body.starts_on !== undefined ? req.body.starts_on : season.starts_on,
        ends_on: req.body.ends_on !== undefined ? req.body.ends_on : season.ends_on,
      },
      season.id
    );

    const result = await pool.query(
      `UPDATE seasons SET name = $1, starts_on = $2, ends_on = $3, updated_at = now()
        WHERE id = $4 AND squad_id = $5
       RETURNING id, squad_id, name, starts_on::text AS starts_on, ends_on::text AS ends_on,
                 created_at, updated_at`,
      [fields.name, fields.starts_on, fields.ends_on, season.id, squadId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Error updating season:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/seasons/:id — remove the season. Its events stay on the
// calendar (the FK just clears their season tag).
router.delete('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);

    const season = await loadSeason(squadId, req.params.id);
    if (!season) {
      return res.status(404).json({ error: 'Season not found' });
    }

    await pool.query('DELETE FROM seasons WHERE id = $1 AND squad_id = $2', [season.id, squadId]);
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Error deleting season:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/seasons/:id/schedule — generate the season's match schedule (T23).
//
// Body:
//   opponents       required, 1-12 names (deduped, order kept)
//   first_kickoff   YYYY-MM-DD, defaults to the season start (or tomorrow
//                   when the season is already underway)
//   kickoff_time    HH:MM, default 10:00
//   cadence_days    days between matches, default 7 (1-28)
//   weekday         optional 0-6 (Sunday=0): snap kickoffs to that weekday
//   duration_minutes default 90 (15-300)
//   location        optional, applied to every match
//   dry_run         true = return the plan with clash flags, insert nothing
//
// Clashes are flagged on the response, never blocking — matching how the
// calendar treats a single event that overlaps another.
router.post('/:id/schedule', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const userId = await getOrCreateUserId(pool, clerkUserId);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);

    const season = await loadSeason(squadId, req.params.id);
    if (!season) {
      return res.status(404).json({ error: 'Season not found' });
    }

    // --- opponents ---------------------------------------------------------
    const rawOpponents = Array.isArray(req.body.opponents)
      ? req.body.opponents
      : String(req.body.opponents || '').split(/[\n,]/);
    const opponents = [];
    const seen = new Set();
    for (const raw of rawOpponents) {
      const name = typeof raw === 'string' ? raw.trim() : '';
      if (!name) continue;
      if (name.length > 100) {
        throw badRequest('Opponent names must be 100 characters or fewer');
      }
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      opponents.push(name);
    }
    if (opponents.length === 0) {
      throw badRequest('Add at least one opponent to generate a schedule');
    }
    if (opponents.length > MAX_OPPONENTS) {
      throw badRequest(`A generated schedule supports at most ${MAX_OPPONENTS} opponents`);
    }

    // --- cadence and kickoff ----------------------------------------------
    const cadenceDays = req.body.cadence_days === undefined ? 7 : Number(req.body.cadence_days);
    if (!Number.isInteger(cadenceDays) || cadenceDays < 1 || cadenceDays > 28) {
      throw badRequest('cadence_days must be a whole number between 1 and 28');
    }

    const kickoffTime = req.body.kickoff_time === undefined ? '10:00' : req.body.kickoff_time;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(kickoffTime)) {
      throw badRequest('kickoff_time must be in the form HH:MM');
    }

    const durationMinutes = req.body.duration_minutes === undefined ? 90 : Number(req.body.duration_minutes);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 300) {
      throw badRequest('duration_minutes must be a whole number between 15 and 300');
    }

    let weekday = null;
    if (req.body.weekday !== undefined && req.body.weekday !== null && req.body.weekday !== '') {
      weekday = Number(req.body.weekday);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        throw badRequest('weekday must be 0-6 (Sunday = 0)');
      }
    }

    const location = req.body.location === undefined || req.body.location === null
      ? null
      : String(req.body.location).trim();
    if (location && location.length > 200) {
      throw badRequest('location must be 200 characters or fewer');
    }

    // The first kickoff defaults into the season: its start date when that
    // is still ahead, otherwise tomorrow (matches can never be scheduled in
    // the past, so an already-underway season starts generating from now).
    const tomorrow = dayString(new Date(Date.now() + 24 * 60 * 60 * 1000));
    const firstKickoff = req.body.first_kickoff || (season.starts_on > tomorrow ? season.starts_on : tomorrow);
    if (!parseDay(firstKickoff)) {
      throw badRequest('first_kickoff must be in the form YYYY-MM-DD');
    }
    // The generated schedule lives inside the season — a kickoff before it
    // starts would create a match the season's own totals never count.
    if (firstKickoff < season.starts_on) {
      throw badRequest(`The first kickoff must be on or after the season start (${season.starts_on})`);
    }

    // --- the plan ----------------------------------------------------------
    const kickoffs = planKickoffs({ firstKickoff, cadenceDays, weekday, kickoffTime, count: opponents.length });

    for (let i = 0; i < kickoffs.length; i += 1) {
      // Same past-date rule as POST /api/events (one-minute grace).
      if (new Date(kickoffs[i]).getTime() < Date.now() - 60 * 1000) {
        throw badRequest('The first kickoff must be in the future — check the date and time');
      }
      // ends_on is inclusive: a match on the last day still fits. Both
      // sides are YYYY-MM-DD, so the comparison is a plain day compare.
      if (kickoffs[i].slice(0, 10) > season.ends_on) {
        throw badRequest(
          `Only ${i} of ${opponents.length} matches fit before the season ends on ${season.ends_on} — ` +
          'remove opponents, shorten the gap between matches, or extend the season'
        );
      }
      if (new Date(kickoffs[i]).getTime() > Date.now() + 2 * 365 * 24 * 60 * 60 * 1000) {
        throw badRequest('Cannot schedule a match more than 2 years ahead');
      }
    }

    // Same roster gate as scheduling a match by hand.
    const roster = await getRosterStatus(squadId);
    if (!roster.meetsMinimum) {
      return res.status(400).json({
        error: `Your roster needs at least ${roster.minRosterSize} athletes to schedule a match (you currently have ${roster.athleteCount}).`,
      });
    }

    // --- dry run: the plan plus clash flags, nothing inserted --------------
    if (req.body.dry_run) {
      const planned = [];
      for (let i = 0; i < opponents.length; i += 1) {
        const clashes = await findClashes(pool, squadId, kickoffs[i], durationMinutes);
        planned.push({ opponent: opponents[i], event_date: kickoffs[i], clashes });
      }
      const clashCount = planned.filter((p) => p.clashes.length > 0).length;
      return res.json({ dry_run: true, season, planned, clash_count: clashCount });
    }

    // --- real run ----------------------------------------------------------
    const created = [];
    for (let i = 0; i < opponents.length; i += 1) {
      const result = await pool.query(
        `INSERT INTO events (squad_id, opponent, event_type, format, event_date, location, duration_minutes, created_by, season_id)
         VALUES ($1, $2, 'match', 'match', $3, $4, $5, $6, $7) RETURNING *`,
        [squadId, opponents[i], kickoffs[i], location, durationMinutes, userId, season.id]
      );
      const event = result.rows[0];
      event.clashes = await findClashes(pool, squadId, kickoffs[i], durationMinutes, {
        excludeEventId: event.id,
      });
      created.push(event);
    }

    res.status(201).json({ season, created });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Error generating schedule:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
