// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
// Date-range helpers for team comparison (T19) and reports (T20).
// All days are YYYY-MM-DD strings, matching input[type=date].

// YYYY-MM-DD in the viewer's own timezone (input[type=date] format).
export function isoDay(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00`)
  d.setDate(d.getDate() + n)
  return isoDay(d)
}

function daysBetween(from, to) {
  return Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000)
}

export function periodFor(preset, today = new Date()) {
  const year = today.getFullYear()
  const t = isoDay(today)
  switch (preset) {
    case 'last-year':
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` }
    case '90':
      return { from: addDays(t, -89), to: t }
    case 'year':
    default:
      return { from: `${year}-01-01`, to: t }
  }
}

// The comparison window for a period: the same-length window just before it,
// or the same dates one year earlier.
export function comparisonFor(mode, period) {
  if (mode === 'previous') {
    const length = daysBetween(period.from, period.to)
    const to = addDays(period.from, -1)
    return { from: addDays(to, -length), to }
  }
  if (mode === 'last-year') {
    const shift = (day) => `${Number(day.slice(0, 4)) - 1}${day.slice(4)}`
    return { from: shift(period.from), to: shift(period.to).replace(/-02-29$/, '-02-28') }
  }
  return null
}
