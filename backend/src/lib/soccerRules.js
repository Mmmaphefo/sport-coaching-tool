// Soccer realism rules for the calendar and the medical room — the sanity
// bar a real competition would enforce, applied so the data can never tell
// an impossible story:
//
//   1. A squad plays at most one match per day. A match that has already
//      been played blocks the day outright; two merely-scheduled matches on
//      the same day stay advisory (findClashes already flags them).
//   2. Matches never land on three or more consecutive days — a squad needs
//      days off between match days.
//   3. Every week leaves a squad at least two recovery days: no seven-day
//      window may hold more than five match days.
//   4. An injury cannot predate the player's birth, nor land before their
//      15th birthday (the minimum age to appear in senior football here).
//
// The day rules are shared by the event create/edit routes; the injury rule
// by the injuries routes. Pure helpers live here so unit tests can pin the
// exact boundaries without a database.

const MATCH_DAY = 'match';
const MIN_DEBUT_AGE = 15; // a player under 15 cannot pick up a senior injury
const DAY_MS = 24 * 60 * 60 * 1000;
const RECOVERY_DAYS_PER_WEEK = 2; // match-free days every squad is owed
const MAX_MATCH_DAYS_PER_WEEK = 7 - RECOVERY_DAYS_PER_WEEK; // five

// 'YYYY-MM-DD' for any parseable date, in server-local terms — the same
// shape event_date comparisons use throughout the calendar.
function dayKey(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

// Noon on the given day: safely inside the day regardless of DST shifts.
function noon(dayString) {
  return new Date(`${dayString}T12:00:00`);
}

function shiftDay(dayString, offsetDays) {
  return dayKey(new Date(noon(dayString).getTime() + offsetDays * DAY_MS));
}

// An injury date is only meaningful for a player who had been born and was
// at least MIN_DEBUT_AGE years old. Missing either side skips the check —
// an unknown date of birth is a data gap, not a violation.
function injuryDateError({ dateOfBirth, dateSustained }) {
  if (!dateOfBirth || !dateSustained) return null;
  const dob = new Date(dateOfBirth);
  const injury = new Date(dateSustained);
  if (Number.isNaN(dob.getTime()) || Number.isNaN(injury.getTime())) return null;
  if (injury < dob) {
    return 'An injury cannot be dated before the player was born';
  }
  const fifteenthBirthday = new Date(dob.getTime());
  fifteenthBirthday.setFullYear(fifteenthBirthday.getFullYear() + MIN_DEBUT_AGE);
  if (injury < fifteenthBirthday) {
    return `An injury cannot be dated before the player turns ${MIN_DEBUT_AGE} years old`;
  }
  return null;
}

// Pure core of the calendar rules. existingDays / playedDays are day keys of
// the squad's other, non-cancelled matches (playedDays a subset that has
// actually kicked off). Returns null when the new day is legal, otherwise
// { code, message } for the first rule it breaks.
function matchDayViolation({ newDay, existingDays = [], playedDays = [] }) {
  if (!newDay) return null;
  const days = new Set(existingDays);
  const has = (day) => days.has(day);

  // Rule 1 — a played match owns its day completely.
  if (playedDays.includes(newDay)) {
    return {
      code: 'match_already_played_today',
      message: 'This squad has already played a match on this day — a team cannot play twice in one day',
    };
  }

  // Rule 2 — no three (or more) consecutive match days.
  const before1 = shiftDay(newDay, -1);
  const before2 = shiftDay(newDay, -2);
  const after1 = shiftDay(newDay, 1);
  const after2 = shiftDay(newDay, 2);
  const runsIntoPast = has(before1) && has(before2);
  const bridgesBoth = has(before1) && has(after1);
  const runsIntoFuture = has(after1) && has(after2);
  if (runsIntoPast || bridgesBoth || runsIntoFuture) {
    return {
      code: 'three_consecutive_days',
      message: 'A team cannot play on three or more consecutive days — leave a recovery day between matches',
    };
  }

  // Rule 3 — at least two match-free days in any seven-day window.
  for (let start = -6; start <= 0; start++) {
    let matchDays = 0;
    for (let offset = 0; offset < 7; offset++) {
      const day = shiftDay(newDay, start + offset);
      if (day === newDay || days.has(day)) matchDays++;
    }
    if (matchDays > MAX_MATCH_DAYS_PER_WEEK) {
      return {
        code: 'recovery_days',
        message: `Teams need at least ${RECOVERY_DAYS_PER_WEEK} recovery days a week — too many matches already fall within seven days of this one`,
      };
    }
  }

  return null;
}

// DB-backed gate for the event create/edit routes: gathers every non-
// cancelled match day on the squad's calendar — its own simple matches plus
// the fixtures of any league/tournament it has joined — and applies the
// pure rules above. Throws a 400-status error the route catch blocks
// already translate. Advisory same-day scheduling (both matches still
// unplayed) intentionally passes: findClashes keeps flagging it instead.
async function assertMatchDayRules(pool, squadId, timestamp, options = {}) {
  const newDay = dayKey(timestamp);
  if (!newDay) return;

  const eventsResult = await pool.query(
    `SELECT event_date::date AS day, status FROM events
     WHERE squad_id = $1 AND format = $2 AND status <> 'cancelled'
       AND event_date IS NOT NULL
       AND ($3::integer IS NULL OR id <> $3)`,
    [squadId, MATCH_DAY, options.excludeEventId ?? null]
  );
  const fixturesResult = await pool.query(
    `SELECT f.event_date::date AS day, f.status
     FROM fixtures f
     JOIN event_teams et ON et.event_id = f.event_id AND et.squad_id = $1
     WHERE f.status <> 'cancelled' AND f.event_date IS NOT NULL`,
    [squadId]
  );

  const existingDays = [];
  const playedDays = [];
  for (const row of [...eventsResult.rows, ...fixturesResult.rows]) {
    const day = dayKey(row.day);
    if (!day) continue;
    existingDays.push(day);
    if (row.status === 'completed' || row.status === 'live') playedDays.push(day);
  }

  const violation = matchDayViolation({ newDay, existingDays, playedDays });
  if (violation) {
    const err = new Error(violation.message);
    err.status = 400;
    err.code = violation.code;
    throw err;
  }
}

module.exports = {
  MIN_DEBUT_AGE,
  RECOVERY_DAYS_PER_WEEK,
  MAX_MATCH_DAYS_PER_WEEK,
  dayKey,
  injuryDateError,
  matchDayViolation,
  assertMatchDayRules,
};
