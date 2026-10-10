// The wrap-up that appears by itself once a match is completed: outcome,
// who scored with minutes and assists, and the shape of the game. Everything
// is derived from the match's own live log — no extra request, nothing for
// the coach to click — so the summary is simply there at full time.

function minuteLabel(minute) {
  return minute == null ? '—' : `${minute}'`
}

function outcomeWord(result) {
  if (result.squad > result.opponent) return 'win'
  if (result.squad < result.opponent) return 'loss'
  return 'draw'
}

function buildScorers(timeline, opponent) {
  // An assist rides along with the goal it created, matched through
  // related_log_id — the same pairing the match report uses.
  const assistFor = new Map(
    timeline
      .filter((e) => e.action_type === 'assist' && e.related_log_id)
      .map((e) => [e.related_log_id, e.athlete_name])
  )

  const scorers = []
  for (const goal of timeline.filter((e) => e.is_scoring)) {
    const ours = goal.athlete_id !== null
    const key = ours ? `a${goal.athlete_id}` : 'them'
    let entry = scorers.find((s) => s.key === key)
    if (!entry) {
      entry = {
        key,
        name: ours ? goal.athlete_name || 'Unknown player' : opponent,
        ours,
        goals: 0,
        minutes: [],
        assists: new Set(),
      }
      scorers.push(entry)
    }
    entry.goals += Number(goal.value) || 1
    entry.minutes.push(
      goal.action_type === 'penalty' ? `${minuteLabel(goal.minute)} (pen)` : minuteLabel(goal.minute)
    )
    const assist = assistFor.get(goal.id)
    if (assist) entry.assists.add(assist)
  }
  return scorers.sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name))
}

export default function PostMatchSummary({ result, timeline, opponent }) {
  const outcome = outcomeWord(result)
  const scorers = buildScorers(timeline, opponent)
  const count = (type, ours) =>
    timeline.filter(
      (e) => e.action_type === type && (ours ? e.athlete_id !== null : e.athlete_id === null)
    ).length
  const stats = [
    { label: 'Shots on target', us: count('shot_on_target', true), them: count('shot_on_target', false) },
    { label: 'Saves', us: count('save', true), them: count('save', false) },
    {
      label: 'Cards',
      us: count('yellow_card', true) + count('red_card', true),
      them: count('yellow_card', false) + count('red_card', false),
    },
  ]

  return (
    <section className="event-summary">
      <div className="event-summary-head">
        <h3 className="event-summary-title">Post-match summary</h3>
        <span className={`event-summary-badge is-${outcome}`}>
          {outcome === 'win' ? 'Win' : outcome === 'loss' ? 'Loss' : 'Draw'}
        </span>
      </div>
      <p className="event-summary-note">
        {timeline.length} logged {timeline.length === 1 ? 'action' : 'actions'} · generated
        automatically at full time
      </p>
      {scorers.length > 0 && (
        <ul className="event-summary-scorers">
          {scorers.map((s) => (
            <li key={s.key} className={`event-summary-scorer${s.ours ? '' : ' is-them'}`}>
              <span className="event-summary-scorer-name">{s.name}</span>
              <span className="event-summary-scorer-detail">
                {s.goals} {s.goals === 1 ? 'goal' : 'goals'} · {s.minutes.join(', ')}
              </span>
              {s.assists.size > 0 && (
                <span className="event-summary-scorer-assist">
                  assisted by {[...s.assists].join(', ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="event-summary-stats">
        {stats.map((stat) => (
          <div key={stat.label} className="event-summary-stat">
            <span className="event-summary-stat-us">{stat.us}</span>
            <span className="event-summary-stat-label">{stat.label}</span>
            <span className="event-summary-stat-them">{stat.them}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
