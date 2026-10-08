const express = require('express');
const { Pool } = require('pg');
const { requireAuth, getAuth } = require('../middleware/auth');
const { getOwnedSquadId, getOwnedSquadIdForCoach, getOrCreateUserId } = require('./_squad');
const {
  getSquadMatches,
  summariseMatches,
} = require('../lib/matchStats');
const { buildCsv, buildPdf } = require('../lib/reports');

const router = express.Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadSeasonWithAccess(pool, seasonId, squadId) {
  const result = await pool.query(
    'SELECT * FROM seasons WHERE id = $1 AND squad_id = $2',
    [seasonId, squadId]
  );
  return result.rows[0] || null;
}

function validateSeasonDates(start, end) {
  if (!start || !end) return 'start_date and end_date are required';
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return 'start_date and end_date must be valid dates';
  }
  if (endDate < startDate) return 'end_date must be on or after start_date';
  return null;
}

// ---------------------------------------------------------------------------
// T17: CRUD
// ---------------------------------------------------------------------------

// GET /api/seasons — the squad's seasons, newest first
router.get('/', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const result = await pool.query(
      `SELECT s.*,
              (SELECT COUNT(*) FROM events e WHERE e.season_id = s.id)::int AS event_count
       FROM seasons s
       WHERE s.squad_id = $1
       ORDER BY s.start_date DESC`,
      [squadId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching seasons:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/seasons — create a season (coach only)
router.post('/', requireAuth(), async (req, res) => {
  try {
    const { name, start_date, end_date } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Season name is required' });
    }
    const dateError = validateSeasonDates(start_date, end_date);
    if (dateError) {
      return res.status(400).json({ error: dateError });
    }

    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    const result = await pool.query(
      `INSERT INTO seasons (squad_id, name, start_date, end_date)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [squadId, name.trim(), start_date, end_date]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating season:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/seasons/:id — rename or change the date range (coach only)
router.patch('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    const season = await loadSeasonWithAccess(pool, req.params.id, squadId);
    if (!season) {
      return res.status(404).json({ error: 'Season not found' });
    }

    const { name, start_date, end_date } = req.body;
    const startDate = start_date ?? season.start_date;
    const endDate = end_date ?? season.end_date;
    const dateError = validateSeasonDates(startDate, endDate);
    if (dateError) {
      return res.status(400).json({ error: dateError });
    }
    if (name !== undefined && !name.trim()) {
      return res.status(400).json({ error: 'Season name cannot be empty' });
    }

    const result = await pool.query(
      `UPDATE seasons
       SET name = COALESCE($1, name),
           start_date = COALESCE($2, start_date),
           end_date = COALESCE($3, end_date),
           updated_at = now()
       WHERE id = $4 RETURNING *`,
      [name ? name.trim() : null, start_date || null, end_date || null, season.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating season:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/seasons/:id — remove a season; events keep their data and just
// become untagged (season_id is SET NULL).
router.delete('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    const result = await pool.query(
      'DELETE FROM seasons WHERE id = $1 AND squad_id = $2 RETURNING id',
      [req.params.id, squadId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Season not found' });
    }
    res.sendStatus(204);
  } catch (err) {
    console.error('Error deleting season:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// T17: Season totals + per-event breakdown
// ---------------------------------------------------------------------------

// GET /api/seasons/:id/summary — W/D/L + GF/GA totals and one row per played
// match inside the season. Matches count if they're explicitly tagged with this
// season, or (for untagged events) if their date falls inside the season range.
// Fixtures always count by date — they have no season tag of their own.
router.get('/:id/summary', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const season = await loadSeasonWithAccess(pool, req.params.id, squadId);
    if (!season) {
      return res.status(404).json({ error: 'Season not found' });
    }

    const matches = await getSquadMatches(pool, squadId, {
      seasonId: season.id,
      fromDate: season.start_date,
      toDate: season.end_date,
    });

    res.json({
      season,
      totals: summariseMatches(matches),
      matches,
    });
  } catch (err) {
    console.error('Error fetching season summary:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// T20: Season report exports
// ---------------------------------------------------------------------------

async function buildSeasonReport(pool, season, squadId) {
  const matches = await getSquadMatches(pool, squadId, {
    seasonId: season.id,
    fromDate: season.start_date,
    toDate: season.end_date,
  });
  const totals = summariseMatches(matches);
  const squadResult = await pool.query('SELECT name FROM squads WHERE id = $1', [squadId]);
  const squadName = squadResult.rows[0]?.name || 'Squad';

  return { matches, totals, squadName };
}

function seasonReportCsv(season, squadName, totals, matches) {
  const rows = [
    ['Season Report', season.name],
    ['Squad', squadName],
    ['Period', `${season.start_date} to ${season.end_date}`],
    [],
    ['Played', 'Won', 'Drawn', 'Lost', 'Goals For', 'Goals Against', 'Goal Difference', 'Points'],
    [totals.played, totals.wins, totals.draws, totals.losses, totals.gf, totals.ga, totals.gd, totals.points],
    [],
    ['Date', 'Opponent', 'Venue', 'For', 'Against', 'Result'],
  ];
  for (const m of matches) {
    rows.push([
      m.date ? new Date(m.date).toISOString().slice(0, 10) : '',
      m.opponent,
      m.venue || '',
      m.gf,
      m.ga,
      m.result,
    ]);
  }
  return rows;
}

function seasonReportLines(season, squadName, totals, matches) {
  const lines = [
    { text: `Season Report — ${season.name}`, size: 18, bold: true, gapAfter: 22 },
    { text: `${squadName} · ${season.start_date} to ${season.end_date}`, size: 10, gapAfter: 18 },
    { text: 'Season Totals', size: 13, bold: true, gapAfter: 16 },
    {
      text: `Played ${totals.played}  ·  W ${totals.wins}  D ${totals.draws}  L ${totals.losses}  ·  GF ${totals.gf}  GA ${totals.ga}  GD ${totals.gd > 0 ? '+' : ''}${totals.gd}  ·  Points ${totals.points}`,
      size: 10,
      gapAfter: 18,
    },
    { text: 'Matches', size: 13, bold: true, gapAfter: 14 },
  ];
  if (matches.length === 0) {
    lines.push({ text: 'No completed matches in this season yet.', size: 10, gapAfter: 12 });
  }
  for (const m of matches) {
    const date = m.date ? new Date(m.date).toISOString().slice(0, 10) : 'TBD';
    const venue = m.venue ? `(${m.venue}) ` : '';
    lines.push({
      text: `${date}  ${venue}vs ${m.opponent}  —  ${m.gf}-${m.ga} (${m.result})`,
      size: 10,
      gapAfter: 13,
    });
  }
  return lines;
}

router.get('/:id/report.csv', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const season = await loadSeasonWithAccess(pool, req.params.id, squadId);
    if (!season) {
      return res.status(404).json({ error: 'Season not found' });
    }

    const { matches, totals, squadName } = await buildSeasonReport(pool, season, squadId);
    const csv = buildCsv(seasonReportCsv(season, squadName, totals, matches));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="season-${season.id}-report.csv"`
    );
    res.send(csv);
  } catch (err) {
    console.error('Error exporting season CSV:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/report.pdf', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const season = await loadSeasonWithAccess(pool, req.params.id, squadId);
    if (!season) {
      return res.status(404).json({ error: 'Season not found' });
    }

    const { matches, totals, squadName } = await buildSeasonReport(pool, season, squadId);
    const pdf = buildPdf(seasonReportLines(season, squadName, totals, matches));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="season-${season.id}-report.pdf"`
    );
    res.send(pdf);
  } catch (err) {
    console.error('Error exporting season PDF:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// T23: Season schedule generator with clash flagging
// ---------------------------------------------------------------------------

function findClashes(newDate, durationMinutes, existingEvents) {
  const start = new Date(newDate).getTime();
  const end = start + durationMinutes * 60 * 1000;
  return existingEvents.filter((e) => {
    if (!e.event_date) return false;
    const eStart = new Date(e.event_date).getTime();
    const eEnd = eStart + (e.duration_minutes || 90) * 60 * 1000;
    return start < eEnd && eStart < end;
  });
}

// POST /api/seasons/:id/schedule
// body: { opponents: string[], start_date, interval_days, time (HH:MM),
//         location, duration_minutes, alternate_venues }
// Creates one match event per opponent at the chosen interval from start_date,
// all tagged to this season, and flags any that clash with the squad's existing
// events (scheduled/live/completed, overlapping in time). Cancelled events are
// ignored for clash purposes.
router.post('/:id/schedule', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);
    const userId = await getOrCreateUserId(pool, clerkUserId);

    const season = await loadSeasonWithAccess(pool, req.params.id, squadId);
    if (!season) {
      return res.status(404).json({ error: 'Season not found' });
    }

    const {
      opponents,
      start_date,
      interval_days = 7,
      time = '15:00',
      location,
      duration_minutes = 90,
      alternate_venues = false,
    } = req.body;

    if (!Array.isArray(opponents) || opponents.length === 0 || opponents.some((o) => !o || !o.trim())) {
      return res.status(400).json({ error: 'opponents must be a non-empty list of names' });
    }
    const interval = Number(interval_days);
    if (!Number.isFinite(interval) || interval < 1) {
      return res.status(400).json({ error: 'interval_days must be at least 1' });
    }
    const duration = Number(duration_minutes) || 90;
    if (!/^\d{2}:\d{2}$/.test(String(time))) {
      return res.status(400).json({ error: 'time must be in HH:MM format' });
    }

    const startDate = new Date(`${start_date}T${time}`);
    if (Number.isNaN(startDate.getTime())) {
      return res.status(400).json({ error: 'start_date is required (YYYY-MM-DD)' });
    }
    const seasonEnd = new Date(`${season.end_date}T23:59:59`);
    if (startDate > seasonEnd) {
      return res.status(400).json({ error: 'start_date falls outside this season' });
    }

    const existing = await pool.query(
      `SELECT id, title, opponent, event_date, duration_minutes
       FROM events
       WHERE squad_id = $1 AND status IN ('scheduled', 'live')`,
      [squadId]
    );
    const existingEvents = existing.rows;

    const created = [];
    const clashes = [];
    let cursor = new Date(startDate);

    for (let i = 0; i < opponents.length; i++) {
      const opponent = opponents[i].trim();
      const eventDate = cursor.toISOString();

      const overlapping = findClashes(eventDate, duration, existingEvents);
      const clashInfo = overlapping.map((e) => ({
        event_id: e.id,
        against: e.title || e.opponent,
        event_date: e.event_date,
      }));

      const home = !alternate_venues || i % 2 === 0;
      const venue = home ? location : `@ ${opponent}`;

      const insert = await pool.query(
        `INSERT INTO events (squad_id, title, opponent, event_type, format, season_id, event_date, location, duration_minutes, created_by)
         VALUES ($1, $2, $3, 'match', 'match', $4, $5, $6, $7, $8) RETURNING id, opponent, event_date, location`,
        [squadId, `vs ${opponent}`, opponent, season.id, eventDate, venue || null, duration, userId]
      );
      const event = insert.rows[0];
      created.push(event);

      if (clashInfo.length > 0) {
        clashes.push({ event_id: event.id, opponent, conflicts_with: clashInfo });
      }

      cursor = new Date(cursor.getTime() + interval * 24 * 60 * 60 * 1000);
    }

    res.status(201).json({
      created_count: created.length,
      events: created,
      clashes,
      clash_count: clashes.length,
      season_ends: season.end_date,
      generated_past_season_end:
        cursor.getTime() - interval * 24 * 60 * 60 * 1000 > seasonEnd.getTime(),
    });
  } catch (err) {
    console.error('Error generating schedule:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
