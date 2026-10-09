// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
// CSV export for reports (T20).

// Quote a value for CSV. Text cells that a spreadsheet would treat as a
// formula (=, +, -, @, tab, carriage return) are prefixed with an apostrophe
// so an opponent or player name like "=HYPERLINK(...)" can't run in Excel.
// Plain numbers (including negatives such as a goal difference) are kept.
export function csvCell(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return String(value)
  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(headers, rows) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
}

// Trigger a browser download of CSV text. A UTF-8 BOM makes Excel read
// accented names correctly.
export function downloadCsv(filename, csv) {
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Safe file name fragment, e.g. "My Squad" -> "my-squad".
export function slug(text) {
  return String(text || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report'
}
