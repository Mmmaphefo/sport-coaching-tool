// Lineup helpers for the live-match pitch: player ratings, FotMob-style
// rating colours, formation detection and default XI positioning.
// Everything here is pure so it can be unit-tested without the backend.

// Ratings start from the classic 6.0 base and move with the actions logged
// for a player during the match. Weights are intentionally conservative so
// one moment never swings a rating wildly.
export const RATING_BASE = 6.0
export const RATING_WEIGHTS = {
  goal: 1.0,
  assist: 0.7,
  penalty: 0.5,
  point: 0.5,
  shot_on_target: 0.3,
  save: 0.4,
  yellow_card: -0.5,
  red_card: -1.5,
  substitution: -0.1,
  other: 0,
}

// Mirror of the backend bench rule: benched players can only be booked.
export const BENCH_ALLOWED_ACTIONS = ['yellow_card', 'red_card']

export function computeRating(entries = []) {
  const total = entries.reduce((sum, entry) => sum + (RATING_WEIGHTS[entry.action_type] ?? 0), 0)
  const rounded = Math.round((RATING_BASE + total) * 10) / 10
  return Math.min(10, Math.max(0, rounded))
}

// FotMob's rating palette: red for poor, orange for middling, then a green
// ramp that deepens as the rating climbs.
export function ratingColor(rating) {
  if (rating < 6) return { bg: '#d5453c', fg: '#ffffff' }
  if (rating < 7) return { bg: '#e78a2e', fg: '#ffffff' }
  if (rating < 8) return { bg: '#58a55c', fg: '#ffffff' }
  if (rating < 9) return { bg: '#2e8f43', fg: '#ffffff' }
  return { bg: '#1c6e32', fg: '#ffffff' }
}

export function initialsOf(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Classic 4-4-2 coordinates in percent. Home attacks up the screen (their
// keeper sits near the bottom); the away side is mirrored.
const HOME_XI = [
  { pos_x: 50, pos_y: 88 },
  { pos_x: 16, pos_y: 70 }, { pos_x: 39, pos_y: 72 }, { pos_x: 61, pos_y: 72 }, { pos_x: 84, pos_y: 70 },
  { pos_x: 16, pos_y: 47 }, { pos_x: 39, pos_y: 49 }, { pos_x: 61, pos_y: 49 }, { pos_x: 84, pos_y: 47 },
  { pos_x: 39, pos_y: 24 }, { pos_x: 61, pos_y: 24 },
]

export function defaultXiPositions(side = 'home') {
  return HOME_XI.map((p) =>
    side === 'away' ? { pos_x: p.pos_x, pos_y: 100 - p.pos_y } : { ...p }
  )
}

// Groups starters into horizontal lines and counts them, defence first, to
// produce a label like "4-4-2". Returns null when there is nothing sensible
// to show (e.g. fewer than two lines).
export function detectFormation(players = [], side = 'home') {
  const onPitch = players.filter((p) => p && p.pos_x != null && p.pos_y != null)
  if (onPitch.length === 0) return null

  // Own goal sits at the bottom for home (high y) and the top for away.
  const sorted = [...onPitch].sort((a, b) =>
    side === 'home' ? b.pos_y - a.pos_y : a.pos_y - b.pos_y
  )

  const lines = []
  for (const p of sorted) {
    const current = lines[lines.length - 1]
    if (current && Math.abs(p.pos_y - current.mean) <= 10) {
      current.count += 1
      current.mean = (current.mean * (current.count - 1) + p.pos_y) / current.count
    } else {
      lines.push({ count: 1, mean: p.pos_y })
    }
  }

  const counts = lines.map((l) => l.count)
  // The keeper is always a line of one at the back — formations don't count
  // them (1-4-4-2 is written "4-4-2").
  if (counts.length >= 2 && counts[0] === 1) counts.shift()
  if (counts.length < 2) return null
  return counts.join('-')
}

// True when a log entry is an assist that is linked to the goal it created —
// those are folded into the goal's timeline row instead of standing alone.
export function isLinkedAssist(entry) {
  return entry.action_type === 'assist' && entry.related_log_id != null
}

export function assistForGoal(timeline = [], goalId) {
  return timeline.find((e) => isLinkedAssist(e) && e.related_log_id === goalId) || null
}

// Substitutions record the incoming player in their notes as "on:<id>" so the
// timeline can name both players without a schema change.
export function parseSubstitutionNotes(notes) {
  const match = /^on:(\d+)$/.exec(notes || '')
  return match ? Number(match[1]) : null
}

// Whether a player row (or an unselected athlete) may receive an action,
// mirroring the backend bench rule. `row` is the player's lineup row or null
// when they are not in the match-day squad.
export function canLogOn(row, actionType) {
  if (!row) return false
  if (row.is_starter) return true
  return BENCH_ALLOWED_ACTIONS.includes(actionType)
}

// Turns the wizard's per-side selections into the PUT /lineup payload.
// Selection entries: { athlete_id, is_starter, pos_x, pos_y }.
export function buildLineupPayload({ home = [], away = [] }) {
  const toRow = (side) => (entry) => ({
    athlete_id: entry.athlete_id,
    team_side: side,
    is_starter: Boolean(entry.is_starter),
    pos_x: entry.is_starter ? entry.pos_x : null,
    pos_y: entry.is_starter ? entry.pos_y : null,
  })
  return { lineups: [...home.map(toRow('home')), ...away.map(toRow('away'))] }
}

// Splits lineup rows into starters (pitch order, defence first) and bench.
export function splitLineup(lineups = [], side) {
  const rows = lineups.filter((l) => l.team_side === side)
  const starters = rows
    .filter((r) => r.is_starter && r.pos_x != null && r.pos_y != null)
    .sort((a, b) => a.pos_y - b.pos_y)
  const bench = rows.filter((r) => !r.is_starter)
  return { starters, bench }
}
