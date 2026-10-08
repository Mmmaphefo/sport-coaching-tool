import { useState } from 'react'
import Pitch from './Pitch'
import { buildLineupPayload, defaultXiPositions, detectFormation } from '../lib/lineups'

const MAX_XI = 11

// Sensible starting point: the first 11 by squad number line up in a 4-4-2
// and everyone else sits on the bench. The coach drags from there.
function autoFill(roster, side) {
  const sorted = [...roster].sort(
    (a, b) => (a.squad_number ?? 999) - (b.squad_number ?? 999)
  )
  const slots = defaultXiPositions(side)
  const xi = new Map()
  const bench = new Set()
  sorted.forEach((athlete, i) => {
    if (i < MAX_XI) xi.set(athlete.id, slots[i])
    else bench.add(athlete.id)
  })
  return { xi, bench }
}

function sortRoster(roster) {
  return [...roster].sort(
    (a, b) => (a.squad_number ?? 999) - (b.squad_number ?? 999)
  )
}

// The pre-match screen: pick the starting XI (and bench) for each team,
// drag players around the pitch to shape the formation, then save.
export default function LineupWizard({
  homeName,
  awayName = null,
  homeRoster,
  awayRoster,
  saving = false,
  onSave,
}) {
  const needsAway = Boolean(awayRoster)
  const [tab, setTab] = useState('home')
  const [homeSel, setHomeSel] = useState(() => autoFill(homeRoster, 'home'))
  const [awaySel, setAwaySel] = useState(() =>
    awayRoster ? autoFill(awayRoster, 'away') : { xi: new Map(), bench: new Set() }
  )

  const activeSide = tab
  const sel = activeSide === 'home' ? homeSel : awaySel
  const roster = activeSide === 'home' ? homeRoster : (awayRoster || [])
  const setSel = activeSide === 'home' ? setHomeSel : setAwaySel

  const updateSel = (updater) => setSel((prev) => updater(prev))

  function toggleXi(athlete) {
    updateSel((prev) => {
      const xi = new Map(prev.xi)
      const bench = new Set(prev.bench)
      if (xi.has(athlete.id)) {
        xi.delete(athlete.id)
      } else if (xi.size < MAX_XI) {
        const slots = defaultXiPositions(activeSide)
        xi.set(athlete.id, slots[Math.min(xi.size, MAX_XI - 1)])
        bench.delete(athlete.id)
      } else {
        return prev
      }
      return { xi, bench }
    })
  }

  function toggleBench(athlete) {
    updateSel((prev) => {
      if (prev.xi.has(athlete.id)) return prev
      const bench = new Set(prev.bench)
      if (bench.has(athlete.id)) bench.delete(athlete.id)
      else bench.add(athlete.id)
      return { ...prev, bench }
    })
  }

  function handleMove(athleteId, side, x, y) {
    const setter = side === 'home' ? setHomeSel : setAwaySel
    setter((prev) => {
      if (!prev.xi.has(athleteId)) return prev
      const xi = new Map(prev.xi)
      xi.set(athleteId, { pos_x: x, pos_y: y })
      return { ...prev, xi }
    })
  }

  const xiPlayers = [...sel.xi.entries()]
    .map(([athleteId, pos]) => {
      const athlete = roster.find((a) => a.id === athleteId)
      if (!athlete) return null
      return {
        athlete_id: athlete.id,
        name: athlete.name,
        squad_number: athlete.squad_number,
        photo: athlete.photo,
        pos_x: pos.pos_x,
        pos_y: pos.pos_y,
      }
    })
    .filter(Boolean)

  const homeValid = homeSel.xi.size >= 1
  const awayValid = !needsAway || awaySel.xi.size >= 1
  const canSave = homeValid && awayValid && !saving

  function handleSave() {
    const toRows = (selection) => [
      ...[...selection.xi.entries()].map(([athlete_id, pos]) => ({
        athlete_id,
        is_starter: true,
        pos_x: pos.pos_x,
        pos_y: pos.pos_y,
      })),
      ...[...selection.bench].map((athlete_id) => ({
        athlete_id,
        is_starter: false,
        pos_x: null,
        pos_y: null,
      })),
    ]
    onSave(
      buildLineupPayload({
        home: toRows(homeSel),
        away: needsAway ? toRows(awaySel) : [],
      })
    )
  }

  const xiFull = sel.xi.size >= MAX_XI

  return (
    <div className="live-wizard">
      <div className="live-wizard-head">
        <h2 className="live-section-heading">Set the lineups</h2>
        <p className="live-wizard-hint">
          Pick each starting XI, then drag players on the pitch to shape the
          formation. Everyone named is in the match-day squad; substitutes can
          only receive a card until they come on.
        </p>
      </div>

      {needsAway && (
        <div className="wz-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'home'}
            className={`wz-tab${tab === 'home' ? ' is-active' : ''}`}
            onClick={() => setTab('home')}
          >
            {homeName}
            <span className={`wz-tab-status${homeValid ? ' is-valid' : ''}`}>
              {homeSel.xi.size}/{MAX_XI}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'away'}
            className={`wz-tab${tab === 'away' ? ' is-active' : ''}`}
            onClick={() => setTab('away')}
          >
            {awayName}
            <span className={`wz-tab-status${awayValid ? ' is-valid' : ''}`}>
              {awaySel.xi.size}/{MAX_XI}
            </span>
          </button>
        </div>
      )}

      <div className="live-wizard-body">
        <div className="wz-roster">
          <span className="wz-roster-title">
            {activeSide === 'home' ? homeName : awayName} squad
            {!needsAway && (
              <span className={`wz-tab-status${sel.xi.size >= 1 ? ' is-valid' : ''}`}>
                {sel.xi.size}/{MAX_XI}
              </span>
            )}
          </span>
          {sortRoster(roster).map((athlete) => {
            const inXi = sel.xi.has(athlete.id)
            const inBench = sel.bench.has(athlete.id)
            return (
              <div
                key={athlete.id}
                className={`wz-chip${inXi ? ' is-xi' : ''}${inBench ? ' is-bench' : ''}`}
              >
                <span className="wz-chip-name">
                  {athlete.squad_number != null ? `#${athlete.squad_number} ` : ''}
                  {athlete.name}
                </span>
                <span className="wz-chip-actions">
                  <button
                    type="button"
                    className={`wz-pill${inXi ? ' is-active' : ''}`}
                    disabled={!inXi && xiFull}
                    onClick={() => toggleXi(athlete)}
                  >
                    XI
                  </button>
                  <button
                    type="button"
                    className={`wz-pill${inBench ? ' is-active' : ''}`}
                    disabled={inXi}
                    onClick={() => toggleBench(athlete)}
                  >
                    Bench
                  </button>
                </span>
              </div>
            )
          })}
          {roster.length === 0 && (
            <p className="wz-roster-empty">No players in this squad yet.</p>
          )}
          {xiFull && <p className="wz-roster-note">XI is full — remove a starter to change it.</p>}
        </div>

        <div className="wz-pitch-col">
          <Pitch
            homePlayers={activeSide === 'home' ? xiPlayers : []}
            awayPlayers={activeSide === 'away' ? xiPlayers : []}
            editable
            onMove={handleMove}
          />
          <div className="wz-formation">
            <span className="wz-formation-label">Formation</span>
            <span className="wz-formation-value">
              {detectFormation(xiPlayers, activeSide) || '—'}
            </span>
          </div>
          <div className="wz-actions">
            <button
              type="button"
              className="btn btn-gold"
              disabled={!canSave}
              onClick={handleSave}
            >
              {saving ? 'Saving...' : 'Save lineups & start'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
