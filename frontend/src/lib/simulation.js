// Replay runner for simulated matches.
//
// The backend does the simulating: POST /api/{events|fixtures}/:id/simulate
// returns a script (every incident, with the minute and the players involved)
// plus a ratings summary. This module replays that script through the normal
// log endpoint so a simulated match is recorded exactly like a hand-logged
// one — same validation, same stats, same timeline.
//
// Two playback modes:
//   quick — post every incident straight away, the whole 90 minutes at once.
//   timed — walk the clock minute by minute over a real-world two minutes,
//           firing each incident as its minute arrives.
export const FULL_TIME_MINUTE = 90
export const SIM_DURATION_MS = 120000
export const MINUTE_MS = SIM_DURATION_MS / FULL_TIME_MINUTE

export function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

// Maps one script entry onto the POST /logs body. Only the fields the log
// endpoint understands are sent, and the optional ones are dropped when the
// incident doesn't have them (the route treats a missing assist/substitute as
// "none", while an explicit null would still be falsy — either is fine, this
// just keeps the payloads clean).
export function scriptToLogBody(entry) {
  const body = {
    athlete_id: entry.athlete_id ?? null,
    action_type: entry.action_type,
    is_scoring: Boolean(entry.is_scoring),
    minute: entry.minute ?? null,
    notes: entry.notes ?? null,
  }
  if (entry.assist_athlete_id) body.assist_athlete_id = entry.assist_athlete_id
  if (entry.substitute_athlete_id) body.substitute_athlete_id = entry.substitute_athlete_id
  return body
}

// Incidents grouped by minute, keeping the order the engine produced so the
// replay is identical to a manual log of the same match.
export function groupByMinute(script = []) {
  const byMinute = new Map()
  for (const entry of [...script].sort((a, b) => a.minute - b.minute)) {
    const minute = entry.minute
    if (!byMinute.has(minute)) byMinute.set(minute, [])
    byMinute.get(minute).push(entry)
  }
  return byMinute
}

// Replays `script`. Returns a small report so callers can show what happened;
// a failure stops the run (later incidents depend on earlier ones — a
// substitution must land before the players it brought on can be logged).
export async function runSimulation({
  script = [],
  mode = 'quick',
  postEvent,
  onMinute,
  onEvent,
  isCancelled = () => false,
  now = () => Date.now(),
  sleep = defaultSleep,
  pacing = MINUTE_MS,
} = {}) {
  const byMinute = groupByMinute(script)
  const failures = []
  const logs = []
  let lastMinute = 0

  async function post(entry) {
    try {
      const created = await postEvent(scriptToLogBody(entry), entry)
      logs.push({ entry, created })
      if (onEvent) onEvent(entry, created)
      return true
    } catch (error) {
      failures.push({ entry, error })
      return false
    }
  }

  async function play(entryList) {
    for (const entry of entryList) {
      if (isCancelled()) return false
      const ok = await post(entry)
      if (!ok) return false
      lastMinute = Math.max(lastMinute, entry.minute || 0)
    }
    return true
  }

  if (mode !== 'timed') {
    if (onMinute) onMinute(0)
    const completed = await play([...byMinute.values()].flat())
    if (completed && !isCancelled()) {
      lastMinute = FULL_TIME_MINUTE
      if (onMinute) onMinute(FULL_TIME_MINUTE)
    }
    return { mode: 'quick', posted: logs.length, logs, failures, cancelled: isCancelled(), lastMinute }
  }

  // Timed: minute 1 through 90, each one taking 1/90th of the two minutes so
  // the whole match lands in two real-world minutes regardless of how many
  // incidents there are.
  const startedAt = now()
  let cancelled = false

  for (let minute = 1; minute <= FULL_TIME_MINUTE; minute += 1) {
    if (isCancelled()) {
      cancelled = true
      break
    }
    if (onMinute) onMinute(minute)
    lastMinute = minute

    const completed = await play(byMinute.get(minute) || [])
    if (!completed) break

    const remaining = startedAt + minute * pacing - now()
    if (remaining > 0) await sleep(remaining)
  }

  return {
    mode: 'timed',
    posted: logs.length,
    logs,
    failures,
    cancelled: cancelled || isCancelled(),
    lastMinute,
  }
}
