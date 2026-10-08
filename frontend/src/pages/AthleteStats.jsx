import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useParams, Link, Navigate } from 'react-router-dom'
import Layout from '../components/Layout'
import Loader from '../components/Loader'
import { apiRequest } from '../lib/api'
import { formatActionType } from '../lib/actions'
import { useConfirm } from '../lib/confirm'
import { useCountUp } from '../lib/useCountUp'
import StatOverrideControl from '../components/StatOverrideControl'
import './AthleteStats.css'

// Simple, dependency-free bar chart for season trends. Renders raw SVG so we
// don't need to add a charting library just for one trend line.
function SeasonTrendChart({ seasonBreakdown }) {
  if (!seasonBreakdown || seasonBreakdown.length === 0) return null

  const width = 600
  const height = 180
  const padding = 32
  const barGap = 12
  const maxGoals = Math.max(...seasonBreakdown.map((s) => s.goals), 1)
  const barWidth =
    (width - padding * 2 - barGap * (seasonBreakdown.length - 1)) / seasonBreakdown.length

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', maxWidth: 600, height: 'auto' }}
      role="img"
      aria-label="Goals per season trend chart"
    >
      {seasonBreakdown.map((s, i) => {
        const barHeight = (s.goals / maxGoals) * (height - padding * 2)
        const x = padding + i * (barWidth + barGap)
        const y = height - padding - barHeight

        return (
          <g key={s.season}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              rx={4}
              fill="var(--color-lime-deep)"
            />
            <text
              x={x + barWidth / 2}
              y={y - 6}
              textAnchor="middle"
              fontSize="12"
              fill="currentColor"
            >
              {s.goals}
            </text>
            <text
              x={x + barWidth / 2}
              y={height - padding + 16}
              textAnchor="middle"
              fontSize="11"
              fill="var(--color-ink-soft)"
            >
              {s.season}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// Maps a stat card's display label to the stat_key the backend's override
// endpoint understands. Cards not listed here (BMI, G+A/match, GK
// estimates) aren't directly-logged counts, so they can't be overridden.
const OVERRIDE_STAT_KEY = {
  Appearances: 'appearances',
  Goals: 'goals',
  Assists: 'assists',
  'Yellow cards': 'yellowCards',
  'Red cards': 'redCards',
  Penalties: 'penalties',
}

const emptyInjuryForm = {
  description: '',
  date_sustained: '',
  severity: 'moderate',
}

const PERIODS = [
  { key: '7d', label: '7D', days: 7 },
  { key: '30d', label: '30D', days: 30 },
  { key: 'season', label: 'Season', days: null },
]

const GROUP_LABELS = {
  gk: 'Goalkeeper unit',
  defender: 'Defence unit',
  midfielder: 'Midfield unit',
  forward: 'Attack unit',
}

const RADAR_ATTRS = {
  gk: ['Reflexes', 'Handling', 'Positioning', 'Kicking', 'Command'],
  defender: ['Pace', 'Defending', 'Passing', 'Physicality', 'Aerial'],
  midfielder: ['Pace', 'Passing', 'Vision', 'Defending', 'Shooting'],
  forward: ['Pace', 'Shooting', 'Dribbling', 'Pressing', 'Composure'],
}

// Activity templates in pitch coordinates (viewBox 0 0 100 132, own goal at
// the bottom). Each zone is a cluster centre the heat blobs are sampled
// around — a position-based estimate, not tracking data.
const HEAT_ZONES = {
  gk: [
    { x: 50, y: 114, rx: 18, ry: 9, w: 3 },
    { x: 50, y: 123, rx: 8, ry: 5, w: 1 },
  ],
  defender: [
    { x: 50, y: 100, rx: 14, ry: 8, w: 2.2 },
    { x: 28, y: 94, rx: 9, ry: 6, w: 1.2 },
    { x: 72, y: 94, rx: 9, ry: 6, w: 1.2 },
    { x: 50, y: 84, rx: 10, ry: 5, w: 0.8 },
  ],
  midfielder: [
    { x: 50, y: 74, rx: 13, ry: 8, w: 2 },
    { x: 50, y: 56, rx: 11, ry: 7, w: 1.6 },
    { x: 30, y: 66, rx: 8, ry: 5, w: 1 },
    { x: 70, y: 66, rx: 8, ry: 5, w: 1 },
  ],
  forward: [
    { x: 50, y: 30, rx: 13, ry: 8, w: 2.4 },
    { x: 32, y: 24, rx: 8, ry: 5, w: 1.2 },
    { x: 68, y: 24, rx: 8, ry: 5, w: 1.2 },
    { x: 50, y: 46, rx: 10, ry: 6, w: 0.9 },
  ],
}

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function positionGroup(position) {
  const p = (position || '').toLowerCase()
  if (/(gk|goal|keeper)/.test(p)) return 'gk'
  if (/(strik|forward|attack|wing|\bst\b|\bcf\b|\blw\b|\brw\b|st\b)/.test(p)) return 'forward'
  if (/(defen|back|\bcb\b|\brb\b|\blb\b)/.test(p)) return 'defender'
  return 'midfielder'
}

function buildHeatBlobs(seed, group, count = 16) {
  const rand = mulberry32(seed * 7919 + 13)
  const zones = HEAT_ZONES[group] || HEAT_ZONES.midfielder
  const totalW = zones.reduce((s, z) => s + z.w, 0)
  const blobs = []
  for (let i = 0; i < count; i++) {
    let pick = rand() * totalW
    let zone = zones[0]
    for (const z of zones) {
      if (pick < z.w) {
        zone = z
        break
      }
      pick -= z.w
    }
    blobs.push({
      x: zone.x + (rand() * 2 - 1) * zone.rx,
      y: zone.y + (rand() * 2 - 1) * zone.ry,
      r: 7 + rand() * 9,
      opacity: (0.18 + rand() * 0.3).toFixed(2),
      delay: (i * 0.09).toFixed(2),
    })
  }
  return blobs
}

function radarValues(seed, group) {
  const rand = mulberry32(seed * 104729 + 7)
  return (RADAR_ATTRS[group] || RADAR_ATTRS.midfielder).map(() => 45 + Math.round(rand() * 45))
}

// No goalkeeper telemetry is tracked yet — deterministic per-player
// estimates (same seeded pattern as the heat map), labelled as such on the
// cards so they are not mistaken for logged figures.
function gkEstimates(seed, appearances) {
  const rand = mulberry32(seed * 31 + 5)
  const saves = Math.max(3, Math.round((1.6 + rand() * 2.4) * Math.max(appearances, 3)))
  const savePct = Math.round(58 + rand() * 28)
  const shots = Math.round(saves / (savePct / 100))
  const conceded = Math.max(0, shots - saves)
  const cleanSheets = Math.max(0, Math.round(appearances * ((savePct - 42) / 130)))
  return { saves, savePct, conceded, cleanSheets }
}

// Goal-frame zones + save dots. Frame interior in a 0 0 100 44 viewBox.
function buildSaveMap(seed, saves, conceded) {
  const rand = mulberry32(seed * 131 + 17)
  const zoneWeights = Array.from({ length: 6 }, () => 0.4 + rand())
  const wSum = zoneWeights.reduce((s, w) => s + w, 0)
  const total = Math.min(saves, 24)
  let assigned = 0
  const zoneCounts = zoneWeights.map((w, i) => {
    const count = i === 5 ? total - assigned : Math.min(total - assigned, Math.round((w / wSum) * total))
    assigned += count
    return count
  })
  const dots = []
  for (let i = 0; i < Math.min(total, 14); i++) {
    dots.push({ x: 10 + rand() * 80, y: 7 + rand() * 30, delay: (i * 0.08).toFixed(2) })
  }
  const concededDots = []
  for (let i = 0; i < Math.min(conceded, 4); i++) {
    concededDots.push({ x: 12 + rand() * 76, y: 8 + rand() * 28, delay: (i * 0.12 + 0.4).toFixed(2) })
  }
  return { zoneCounts, dots, concededDots }
}

function aggregate(logs) {
  let goals = 0
  let assists = 0
  let penalties = 0
  let yellowCards = 0
  let redCards = 0
  const eventIds = new Set()
  for (const l of logs) {
    eventIds.add(l.event_id)
    if (l.action_type === 'goal') goals += l.value || 0
    if (l.action_type === 'assist') assists += l.value || 0
    if (l.action_type.includes('penalty')) penalties += 1
    if (l.action_type === 'yellow_card') yellowCards += 1
    if (l.action_type === 'red_card') redCards += 1
  }
  return { goals, assists, penalties, yellowCards, redCards, appearances: eventIds.size }
}

function matchesFromLogs(logs) {
  const map = new Map()
  for (const l of logs) {
    if (!map.has(l.event_id)) {
      map.set(l.event_id, { key: l.event_id, date: l.event_date, opponent: l.opponent, goals: 0, assists: 0 })
    }
    const m = map.get(l.event_id)
    if (l.action_type === 'goal') m.goals += l.value || 0
    if (l.action_type === 'assist') m.assists += l.value || 0
  }
  return [...map.values()].sort((a, b) => new Date(a.date) - new Date(b.date))
}

// Mirror of the dashboard's clearly-labelled training-load estimate line.
function loadPath(count, width, height, pad) {
  const innerW = width - pad * 2
  const innerH = height - pad * 2
  const shape = [55, 62, 58, 70, 66, 60, 64, 58, 61, 57, 63, 59]
  return shape
    .slice(0, Math.max(count, 2))
    .map((v, i, arr) => {
      const x = pad + (i / Math.max(arr.length - 1, 1)) * innerW
      const y = pad + innerH - (v / 100) * innerH
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function StatNumber({ value, suffix = '' }) {
  const animated = useCountUp(value)
  return <>{animated}{suffix}</>
}

const CHART_W = 640
const CHART_H = 260
const CHART_PAD = 30

function ImpactChart({ matches }) {
  const maxV = Math.max(1, ...matches.map((m) => m.goals + m.assists))
  const slots = Math.max(matches.length, 2)
  const innerW = CHART_W - CHART_PAD * 2
  const innerH = CHART_H - CHART_PAD * 2
  const slotW = innerW / slots
  const barW = Math.min(slotW * 0.55, 48)
  const dashed = loadPath(matches.length, CHART_W, CHART_H, CHART_PAD)

  return (
    <div className="ath-card">
      <span className="ath-card-eyebrow">Performance pulse</span>
      <h3>Match impact</h3>
      {matches.length === 0 ? (
        <p className="roster-status">No matches in this period yet.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="ath-chart" preserveAspectRatio="none" role="img" aria-label="Goals and assists per match">
            <line x1={CHART_PAD} y1={CHART_H - CHART_PAD} x2={CHART_W - CHART_PAD} y2={CHART_H - CHART_PAD} stroke="var(--color-line)" strokeWidth="1" />
            <path d={dashed} fill="none" stroke="var(--color-silver)" strokeWidth="2" strokeDasharray="5 5" />
            {matches.map((m, i) => {
              const h = ((m.goals + m.assists) / maxV) * (innerH - 20)
              const x = CHART_PAD + i * slotW + (slotW - barW) / 2
              const y = CHART_H - CHART_PAD - h
              return (
                <g key={m.key}>
                  <rect x={x} y={y} width={barW} height={Math.max(h, 3)} rx="4" className="ath-bar" />
                  <text x={x + barW / 2} y={Math.max(y - 8, 14)} textAnchor="middle" className="ath-bar-value">
                    {m.goals + m.assists > 0 ? m.goals + m.assists : ''}
                  </text>
                </g>
              )
            })}
          </svg>
          <div className="ath-legend">
            <span className="ath-legend-item"><span className="ath-legend-swatch ath-legend-swatch-lime" /> Goals + assists (real)</span>
            <span className="ath-legend-item"><span className="ath-legend-swatch ath-legend-swatch-dashed" /> Training load (estimate)</span>
          </div>
        </>
      )}
    </div>
  )
}

function HeatMapCard({ group, seed }) {
  const blobs = useMemo(() => buildHeatBlobs(seed, group), [seed, group])
  return (
    <div className="ath-card ath-card-dark">
      <span className="ath-card-eyebrow">Activity heat map</span>
      <h3>Where they operate</h3>
      <svg viewBox="0 0 100 132" className="ath-pitch" role="img" aria-label="Estimated activity heat map">
        <defs>
          <radialGradient id="athHeat">
            <stop offset="0%" stopColor="#D0FF41" stopOpacity="0.9" />
            <stop offset="55%" stopColor="#D0FF41" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#D0FF41" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g fill="none" stroke="rgba(198, 208, 221, 0.4)" strokeWidth="0.6">
          <rect x="1" y="1" width="98" height="130" rx="1.5" />
          <line x1="1" y1="66" x2="99" y2="66" />
          <circle cx="50" cy="66" r="12" />
          <rect x="22" y="1" width="56" height="18" />
          <rect x="36" y="1" width="28" height="7" />
          <rect x="22" y="113" width="56" height="18" />
          <rect x="36" y="124" width="28" height="7" />
        </g>
        <g fill="rgba(198, 208, 221, 0.5)">
          <circle cx="50" cy="66" r="0.9" />
          <circle cx="50" cy="10.5" r="0.9" />
          <circle cx="50" cy="121.5" r="0.9" />
        </g>
        {blobs.map((b, i) => (
          <ellipse
            key={i}
            cx={b.x.toFixed(1)}
            cy={b.y.toFixed(1)}
            rx={b.r.toFixed(1)}
            ry={(b.r * 0.8).toFixed(1)}
            fill="url(#athHeat)"
            opacity={b.opacity}
            className="ath-heat-blob"
            style={{ '--d': `${b.delay}s`, '--o': b.opacity }}
          />
        ))}
      </svg>
      <p className="ath-card-note ath-card-note-dark">Position-based estimate — no tracking data yet.</p>
    </div>
  )
}

function RadarCard({ group, seed }) {
  const attrs = RADAR_ATTRS[group] || RADAR_ATTRS.midfielder
  const values = useMemo(() => radarValues(seed, group), [seed, group])
  const cx = 100
  const cy = 100
  const r = 70
  const angle = (i) => (Math.PI * 2 * i) / attrs.length - Math.PI / 2
  const point = (i, v) => `${(cx + Math.cos(angle(i)) * r * v).toFixed(1)},${(cy + Math.sin(angle(i)) * r * v).toFixed(1)}`
  const polyPoints = values.map((v, i) => point(i, v / 100)).join(' ')
  const ring = (f) => attrs.map((_, i) => point(i, f)).join(' ')

  return (
    <div className="ath-card">
      <span className="ath-card-eyebrow">Attribute profile</span>
      <h3>Skill radar</h3>
      <svg viewBox="0 0 200 200" className="ath-radar" role="img" aria-label="Estimated attribute radar">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <polygon key={f} points={ring(f)} fill="none" stroke="var(--color-line)" strokeWidth="1" />
        ))}
        {attrs.map((_, i) => (
          <line key={i} x1={cx} y1={cy} x2={cx + Math.cos(angle(i)) * r} y2={cy + Math.sin(angle(i)) * r} stroke="var(--color-line)" strokeWidth="1" />
        ))}
        <polygon points={polyPoints} className="ath-radar-poly" />
        {values.map((v, i) => (
          <circle key={i} cx={(cx + Math.cos(angle(i)) * r * (v / 100)).toFixed(1)} cy={(cy + Math.sin(angle(i)) * r * (v / 100)).toFixed(1)} r="2.4" fill="var(--color-lime)" />
        ))}
        {attrs.map((a, i) => (
          <text
            key={a}
            x={(cx + Math.cos(angle(i)) * (r + 15)).toFixed(1)}
            y={(cy + Math.sin(angle(i)) * (r + 15)).toFixed(1)}
            textAnchor="middle"
            dominantBaseline="middle"
            className="ath-radar-label"
          >
            {a}
          </text>
        ))}
      </svg>
      <p className="ath-card-note">Scouting-style estimate derived from position, not logged data.</p>
    </div>
  )
}

// Frame interior: x 8..92, y 5..37 in a 0 0 100 44 viewBox.
const SAVE_ZONE_RECTS = [
  { x: 8, y: 5, w: 42, h: 10.67 },
  { x: 50, y: 5, w: 42, h: 10.67 },
  { x: 8, y: 15.67, w: 42, h: 10.67 },
  { x: 50, y: 15.67, w: 42, h: 10.67 },
  { x: 8, y: 26.34, w: 42, h: 10.66 },
  { x: 50, y: 26.34, w: 42, h: 10.66 },
]
const SAVE_ZONE_NAMES = ['Top left', 'Top right', 'Mid left', 'Mid right', 'Bottom left', 'Bottom right']

function SaveMapCard({ seed, saves, conceded }) {
  const { zoneCounts, dots, concededDots } = useMemo(
    () => buildSaveMap(seed, saves, conceded),
    [seed, saves, conceded]
  )
  const maxZone = Math.max(1, ...zoneCounts)

  return (
    <div className="ath-card ath-card-dark">
      <span className="ath-card-eyebrow">Save locations</span>
      <h3>Save map</h3>
      <svg viewBox="0 0 100 44" className="ath-goal" role="img" aria-label="Estimated save locations on the goal frame">
        {SAVE_ZONE_RECTS.map((zr, i) => (
          <g key={SAVE_ZONE_NAMES[i]}>
            <rect
              x={zr.x}
              y={zr.y}
              width={zr.w}
              height={zr.h}
              className="ath-goal-zone"
              fill="#D0FF41"
              opacity={(zoneCounts[i] / maxZone) * 0.35}
            />
            <text x={zr.x + zr.w / 2} y={zr.y + zr.h / 2 + 0.6} textAnchor="middle" dominantBaseline="middle" className="ath-goal-zone-num">
              {zoneCounts[i] > 0 ? zoneCounts[i] : ''}
            </text>
          </g>
        ))}
        <g stroke="rgba(198, 208, 221, 0.25)" strokeWidth="0.4">
          {Array.from({ length: 5 }, (_, i) => (
            <line key={`v${i}`} x1={8 + ((i + 1) * 84) / 6} y1="5" x2={8 + ((i + 1) * 84) / 6} y2="37" />
          ))}
          {Array.from({ length: 3 }, (_, i) => (
            <line key={`h${i}`} x1="8" y1={5 + ((i + 1) * 32) / 4} x2="92" y2={5 + ((i + 1) * 32) / 4} />
          ))}
        </g>
        <rect x="8" y="5" width="84" height="32" fill="none" stroke="#C6D0DD" strokeWidth="1.4" />
        {dots.map((d, i) => (
          <circle key={i} cx={d.x.toFixed(1)} cy={d.y.toFixed(1)} r="1.5" fill="#D0FF41" className="ath-save-dot" style={{ '--d': `${d.delay}s` }} />
        ))}
        {concededDots.map((d, i) => (
          <circle key={i} cx={d.x.toFixed(1)} cy={d.y.toFixed(1)} r="1.3" fill="#e05555" className="ath-save-dot" style={{ '--d': `${d.delay}s` }} />
        ))}
      </svg>
      <div className="ath-legend">
        <span className="ath-legend-item"><span className="ath-legend-dot ath-legend-dot-lime" /> Save</span>
        <span className="ath-legend-item"><span className="ath-legend-dot ath-legend-dot-red" /> Conceded</span>
      </div>
      <p className="ath-card-note ath-card-note-dark">Estimated placement — no shot data tracked yet.</p>
    </div>  )
}

function AthleteStats() {
  const { id } = useParams()
  const { getToken } = useAuth()
  const confirm = useConfirm()

  const [data, setData] = useState(null)
  const [role, setRole] = useState(null)
  const [athleteId, setAthleteId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedSeason, setSelectedSeason] = useState('') // '' = all time
  const [period, setPeriod] = useState('season')
  const [injuryFormOpen, setInjuryFormOpen] = useState(false)
  const [injuryForm, setInjuryForm] = useState(emptyInjuryForm)
  const [savingInjury, setSavingInjury] = useState(false)
  const [editingReturnDateId, setEditingReturnDateId] = useState(null)
  const [returnDateDraft, setReturnDateDraft] = useState('')

  const isCoach = role === 'coach'
  // Injury logging is staff work (coach or assistant); players can't log
  // injuries — they see the history read-only.
  const isStaff = role === 'coach' || role === 'assistant'

  // Snapshot "now" once on mount — used for the period cutoffs and the age
  // calculation below (same one-time pattern as the events form's nowLocal).
  const [nowMs] = useState(() => Date.now())

  // Logs for the selected period — memoised BEFORE the early returns below
  // so the hook order stays stable across the loading → loaded transition.
  const logs = useMemo(() => data?.logs ?? [], [data])
  const periodLogs = useMemo(() => {
    const p = PERIODS.find((x) => x.key === period)
    if (!p.days) return logs
    const cutoff = nowMs - p.days * 86400000
    return logs.filter((l) => new Date(l.event_date).getTime() >= cutoff)
  }, [logs, period, nowMs])
  const agg = useMemo(() => aggregate(periodLogs), [periodLogs])
  const matches = useMemo(() => matchesFromLogs(periodLogs).slice(-12), [periodLogs])
  const load = useCallback(async (season) => {
    setLoading(true)
    setError('')
    try {
      const query = season ? `?season=${encodeURIComponent(season)}` : ''
      const result = await apiRequest(`/api/athletes/${id}/stats${query}`, { getToken })
      setData(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const loadAccount = useCallback(async () => {
    try {
      const me = await apiRequest('/api/account/me', { getToken })
      setRole(me.role)
      setAthleteId(me.athleteId ?? null)
    } catch {
      setRole('coach')
    }
  }, [getToken])

  useEffect(() => {
    load(selectedSeason)
    loadAccount()    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, selectedSeason])

  async function handleLogInjury(e) {
    e.preventDefault()
    if (!injuryForm.description.trim() || !injuryForm.date_sustained) {
      setError('Description and date sustained are required')
      return
    }
    setSavingInjury(true)
    setError('')
    try {
      await apiRequest('/api/injuries', {
        method: 'POST',
        body: { athlete_id: Number(id), ...injuryForm },
        getToken,
      })
      setInjuryFormOpen(false)
      setInjuryForm(emptyInjuryForm)
      await load(selectedSeason)
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingInjury(false)
    }
  }

  async function handleClearInjury(injuryId) {
    const answer = await confirm({
      title: 'Clear injury',
      message: 'Mark this injury as cleared? The athlete is available for selection again.',
      confirmLabel: 'Mark cleared',
    })
    if (!answer) return
    try {
      await apiRequest(`/api/injuries/${injuryId}`, {
        method: 'PATCH',
        body: { clear: true },
        getToken,
      })
      await load(selectedSeason)
    } catch (err) {
      setError(err.message)
    }
  }

  function startEditReturnDate(injury) {
    setEditingReturnDateId(injury.id)
    setReturnDateDraft(injury.return_date ? injury.return_date.slice(0, 10) : '')
  }

  async function saveReturnDate(injuryId) {
    try {
      await apiRequest(`/api/injuries/${injuryId}`, {
        method: 'PATCH',
        body: { return_date: returnDateDraft },
        getToken,
      })
      setEditingReturnDateId(null)
      await load(selectedSeason)
    } catch (err) {
      setError(err.message)
    }
  }

  // Players only ever open their own card — the "My Stats" nav item links to
  // /roster/:id for them. Any other id bounces to their own profile, and an
  // account that isn't linked to an athlete row goes back to the dashboard.
  if (role === 'athlete') {
    if (!athleteId) return <Navigate to="/dashboard" replace />
    if (String(athleteId) !== String(id)) return <Navigate to={`/roster/${athleteId}`} replace />
  }

  if (loading) {
    return (
      <Layout>
        <Loader label="Loading athlete stats..." />
      </Layout>
    )
  }

  if (error && !data) {
    return (
      <Layout>
        <div className="roster-error">{error}</div>
        <Link to="/roster" className="btn btn-ghost">Back to roster</Link>
      </Layout>
    )
  }

  const { athlete, injuries, currentInjury, bmi, overrides, stats, seasons, seasonBreakdown, opponentBreakdown } = data
  const seed = Number(athlete.id) || 1
  const group = positionGroup(athlete.position)

  // Parse tactical tags
  const tags = athlete.tactical_tags
    ? athlete.tactical_tags.split(',').map((t) => t.trim()).filter(Boolean)
    : []

  // Same clearly-labelled estimate rule the roster cards use — no per-athlete
  // training data is tracked yet: injured < managed < ready.
  const readiness = currentInjury ? 25 : athlete.is_managed ? 60 : 95

  // The season view shows the server's numbers: it computes the same totals
  // across the whole log but folds in any manual corrections, so a corrected
  // stat is the figure the coach sees. The 7d/30d windows are client-side
  // slices of that log and a correction is a lifetime figure — those stay
  // computed (and un-editable) as before.
  const seasonStats = {
    appearances: stats?.appearances ?? agg.appearances,
    goals: stats?.goals ?? agg.goals,
    assists: stats?.assists ?? agg.assists,
    penalties: stats?.penalties ?? agg.penalties,
    yellowCards: stats?.yellowCards ?? agg.yellowCards,
    redCards: stats?.redCards ?? agg.redCards,
  }
  const shown = period === 'season' ? seasonStats : agg

  const involvementsPerMatch = shown.appearances > 0 ? ((shown.goals + shown.assists) / shown.appearances).toFixed(1) : '0.0'
  const gk = group === 'gk' ? gkEstimates(seed, aggregate(logs).appearances) : null

  const age = athlete.date_of_birth
    ? Math.floor((nowMs - new Date(athlete.date_of_birth).getTime()) / (365.25 * 86400000))
    : null
  const season = (() => {
    const now = new Date()
    const y = now.getFullYear()
    return now.getMonth() >= 5 ? `${y}/${String((y + 1) % 100).padStart(2, '0')}` : `${y - 1}/${String(y % 100).padStart(2, '0')}`
  })()

  const statCards = group === 'gk'
    ? [
        { label: 'Appearances', value: shown.appearances, dark: true },
        { label: 'Saves', value: gk.saves, dark: true, note: 'season estimate' },
        { label: 'Save %', value: gk.savePct, suffix: '%', accent: true, note: 'season estimate' },
        { label: 'Clean sheets', value: gk.cleanSheets, dark: true, note: 'season estimate' },
      ]
    : [
        { label: 'Appearances', value: shown.appearances, dark: true },
        { label: 'Goals', value: shown.goals, accent: true },
        { label: 'Assists', value: shown.assists, dark: true },
        { label: 'G+A / match', value: Number(involvementsPerMatch), dark: true },
        { label: 'Penalties', value: shown.penalties, dark: true },
        { label: 'Yellow cards', value: shown.yellowCards, dark: true },
        { label: 'Red cards', value: shown.redCards, dark: true },
      ]

  if (bmi != null) {
    statCards.push({ label: 'BMI', value: bmi, accent: true, note: `${athlete.height_cm}cm / ${athlete.weight_kg}kg` })
  }

  return (
    <Layout>
      <div className="ath-page">
        <header className="ath-head">
          <div className="ath-head-text">
            <span className="ath-eyebrow">Player intelligence</span>
            <h1 className="ath-title-main">
              {athlete.squad_number != null ? `#${athlete.squad_number} ` : ''}{athlete.name}
            </h1>
            <div className="ath-head-meta">
              <span className="ath-pos-pill">{GROUP_LABELS[group]}</span>
              {athlete.position && <span className="ath-pos-pill ath-pos-pill-soft">{athlete.position}</span>}
              {age != null && <span className="ath-pos-pill ath-pos-pill-soft">Age {age}</span>}
              <span className="ath-pos-pill ath-pos-pill-soft">Season {season}</span>            </div>
          </div>
          <Link to="/roster" className="btn btn-ghost ath-back-btn">Back to roster</Link>
        </header>

        <section className="ath-hero">
          <span className="ath-hero-label">{GROUP_LABELS[group]} · {season}</span>
          <h2 className="ath-hero-title">
            {group === 'gk' ? 'The last line of defence' : 'Every touch tells a story'}
          </h2>
          <div className="ath-period-toggle">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                className={`ath-period-pill ${period === p.key ? 'ath-period-pill-active' : ''}`}
                onClick={() => setPeriod(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {seasons.length > 0 && (
            <div className="ath-season-select">
              <label htmlFor={`season-${id}`}>Season</label>
              <select
                id={`season-${id}`}
                value={selectedSeason}
                onChange={(e) => setSelectedSeason(e.target.value)}
              >
                <option value="">All time</option>
                {seasons.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
        </section>

        {error && <div className="roster-error">{error}</div>}

        {currentInjury && (
          <div className="ath-injury-banner">
            <strong>Currently injured:</strong> {currentInjury.description}
            {' — '}
            estimated return {new Date(currentInjury.return_date).toLocaleDateString()}
          </div>
        )}

        <div className="ath-stat-grid">
          <div className="ath-stat-card ath-stat-card-accent">
            <span className="ath-stat-label">Readiness</span>
            <span className="ath-stat-value"><StatNumber value={readiness} suffix="%" /></span>
            <span className="ath-stat-note">
              {currentInjury ? 'Injury return pending' : athlete.is_managed ? 'Managed load' : 'Fully available'}
              {' · estimate'}
            </span>
          </div>
          {statCards.map((card) => {
            // Overrides are lifetime corrections computed on the full log,
            // so they only apply to (and are only editable from) the
            // full-season view — a 7d/30d window is a different number.
            const statKey = OVERRIDE_STAT_KEY[card.label]
            const override = statKey ? overrides?.[statKey] : null
            const canOverride = isCoach && period === 'season' && statKey
            return (
              <div key={card.label} className={`ath-stat-card${card.accent ? ' ath-stat-card-accent' : ''}`}>
                <span className="ath-stat-label">{card.label}</span>
                <span className={`ath-stat-value${card.dark ? ' ath-stat-value-dark' : ''}`}>
                  <StatNumber value={card.value} suffix={card.suffix || ''} />
                </span>
                <span className="ath-stat-note">{card.note || `in this ${period === 'season' ? 'season' : period.replace('d', ' days')}`}</span>
                {canOverride && (
                  <StatOverrideControl
                    athleteId={id}
                    statKey={statKey}
                    override={override}
                    getToken={getToken}
                    onChange={() => load(selectedSeason)}
                  />
                )}
              </div>
            )
          })}
        </div>

        <div className="ath-charts-grid">
          {seasonBreakdown.length > 1 && (
            <div className="ath-card">
              <span className="ath-card-eyebrow">Season history</span>
              <h3>Goals by season</h3>
              <SeasonTrendChart seasonBreakdown={seasonBreakdown} />
              <p className="ath-card-note">Logged goals per season — full career history.</p>
            </div>
          )}
          <ImpactChart matches={matches} />
          <HeatMapCard group={group} seed={seed} />
          {gk && <SaveMapCard seed={seed} saves={gk.saves} conceded={gk.conceded} />}
          <RadarCard group={group} seed={seed} />
        </div>

        {opponentBreakdown.length > 0 && (
          <div className="ath-card" style={{ marginBottom: '32px' }}>
            <span className="ath-card-eyebrow">Matchups</span>
            <h3>Opponent comparison</h3>
            <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', textAlign: 'left' }}>
              <thead>
                <tr>
                    {['Opponent', 'Apps', 'Goals', 'Assists', 'Yellow', 'Red'].map((h) => (
                      <th key={h} style={{ padding: '0.5rem', borderBottom: '2px solid var(--color-line)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {opponentBreakdown.map((o) => (
                    <tr key={o.opponent}>
                      <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--color-line)' }}>{o.opponent}</td>
                      <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--color-line)' }}>{o.appearances}</td>
                      <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--color-line)' }}>{o.goals}</td>
                      <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--color-line)' }}>{o.assists}</td>
                      <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--color-line)' }}>{o.yellowCards}</td>
                      <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--color-line)' }}>{o.redCards}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="ath-card-note">{selectedSeason ? `Totals for the ${selectedSeason} season.` : 'Totals across all seasons.'}</p>
          </div>
        )}

        {(tags.length > 0 || athlete.coach_notes) && (
          <div className="ath-tactics-section">
            {tags.length > 0 && (
              <div className="ath-tactics-tags">
                <h3 className="ath-section-title">Tactical profile</h3>
                <div className="ath-tags-list">
                  {tags.map((tag, i) => (
                    <span key={i} className="ath-tag">{tag}</span>
                  ))}
                </div>
              </div>
            )}
            {athlete.coach_notes && (
              <div className="ath-coach-notes">
                <h3 className="ath-section-title">Coach notes</h3>
                <p className="ath-notes-text">{athlete.coach_notes}</p>
              </div>
            )}
          </div>
        )}

        <div className="ath-section-head">
          <h3 className="ath-section-title">Injury history</h3>
          {isStaff && (
            <button className="btn btn-ghost" onClick={() => setInjuryFormOpen((v) => !v)}>
              {injuryFormOpen ? 'Cancel' : 'Log injury'}
            </button>
          )}
        </div>

        {isStaff && injuryFormOpen && (
          <form className="roster-form" onSubmit={handleLogInjury}>
            <div className="roster-form-grid">
              <label className="roster-form-wide">
                Description
                <input
                  type="text"
                  value={injuryForm.description}
                  onChange={(e) => setInjuryForm({ ...injuryForm, description: e.target.value })}
                  placeholder="e.g. Grade 2 hamstring strain"
                  required
                />
              </label>
              <label>
                Date sustained
                <input
                  type="date"
                  value={injuryForm.date_sustained}
                  onChange={(e) => setInjuryForm({ ...injuryForm, date_sustained: e.target.value })}
                  required
                />
              </label>
              <label>
                Severity
                <select
                  value={injuryForm.severity}
                  onChange={(e) => setInjuryForm({ ...injuryForm, severity: e.target.value })}
                >
                  <option value="minor">Minor</option>
                  <option value="moderate">Moderate</option>
                  <option value="severe">Severe</option>
                </select>
              </label>
            </div>
            <p className="ath-form-note">
              The return date is estimated automatically from the description where possible,
              and can be adjusted afterwards. This is a planning estimate only — always confirm
              with a medical professional.
            </p>
            <div className="roster-form-actions">
              <button type="submit" className="btn btn-gold" disabled={savingInjury}>
                {savingInjury ? <Loader inline label="Saving..." /> : 'Save injury'}
              </button>
            </div>
          </form>
        )}

        {injuries.length === 0 ? (
          <div className="roster-empty">
            <p>No injuries logged for this athlete.</p>
          </div>
        ) : (
          <div className="ath-injury-list">
            {injuries.map((injury) => {
              const isActive = !injury.cleared_at && new Date(injury.return_date) >= new Date(new Date().toDateString())
              return (
                <div className={`ath-injury-card${isActive ? ' ath-injury-card-active' : ''}`} key={injury.id}>
                  <div className="ath-injury-card-main">
                    <strong>{injury.description}</strong>
                    <span className={`ath-severity ath-severity--${injury.severity}`}>
                      {injury.severity}
                    </span>
                    {injury.cleared_at && <span className="ath-injury-tag">Cleared</span>}
                    {!injury.cleared_at && !isActive && <span className="ath-injury-tag">Recovered</span>}
                    {isActive && <span className="ath-injury-tag ath-injury-tag-active">Active</span>}
                  </div>
                  <div className="ath-injury-card-meta">
                    Sustained {new Date(injury.date_sustained).toLocaleDateString()}
                    {' — '}
                    {editingReturnDateId === injury.id ? (
                      <>
                        <input
                          type="date"
                          value={returnDateDraft}
                          onChange={(e) => setReturnDateDraft(e.target.value)}
                        />
                        <button className="btn btn-ghost" onClick={() => saveReturnDate(injury.id)}>Save</button>
                        <button className="btn btn-ghost" onClick={() => setEditingReturnDateId(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        estimated return {injury.return_date ? new Date(injury.return_date).toLocaleDateString() : '—'}
                        {isCoach && !injury.cleared_at && (
                          <button className="btn btn-ghost ath-injury-inline-btn" onClick={() => startEditReturnDate(injury)}>
                            Adjust
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {injury.estimation_basis && (
                    <p className="ath-injury-basis">{injury.estimation_basis}</p>
                  )}
                  {isCoach && !injury.cleared_at && editingReturnDateId !== injury.id && (
                    <button className="btn btn-ghost ath-injury-inline-btn" onClick={() => handleClearInjury(injury.id)}>
                      Mark cleared
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <h3 className="ath-section-title">Logged actions</h3>
        {logs.length === 0 ? (
          <div className="roster-empty">
            <p>No actions logged for this athlete{selectedSeason ? ` in ${selectedSeason}` : ' yet'}.</p>
          </div>
        ) : (
          <div className="ath-timeline">
            {logs.map((entry) => (
              <div className="ath-timeline-entry" key={entry.id}>
                <span className={`ath-timeline-minute ${
                  entry.action_type === 'goal' ? 'ath-timeline-minute--goal'
                  : entry.action_type.includes('card') ? 'ath-timeline-minute--card'
                  : entry.action_type.includes('penalty') ? 'ath-timeline-minute--penalty'
                  : ''
                }`}>
                  {entry.minute != null ? `${entry.minute}'` : '—'}
                </span>
                <div className="ath-timeline-body">
                  <span className="ath-timeline-action">{formatActionType(entry.action_type)}</span>
                  <span className="ath-timeline-who">
                    {entry.opponent ? `vs ${entry.opponent}` : 'Training'}
                    {' · '}
                    {new Date(entry.event_date).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}

export default AthleteStats