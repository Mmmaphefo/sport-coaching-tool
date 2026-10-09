// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
import { describe, it, expect } from 'vitest'
import { periodFor, comparisonFor } from './periods'

const today = new Date(2026, 9, 9) // 9 Oct 2026, local time

describe('periodFor', () => {
  it('this year runs from 1 January to today', () => {
    expect(periodFor('year', today)).toEqual({ from: '2026-01-01', to: '2026-10-09' })
  })
  it('last year is the whole previous calendar year', () => {
    expect(periodFor('last-year', today)).toEqual({ from: '2025-01-01', to: '2025-12-31' })
  })
  it('last 90 days includes today', () => {
    expect(periodFor('90', today)).toEqual({ from: '2026-07-12', to: '2026-10-09' })
  })
})

describe('comparisonFor', () => {
  it('the period before has the same length and ends the day before', () => {
    expect(comparisonFor('previous', { from: '2026-07-12', to: '2026-10-09' }))
      .toEqual({ from: '2026-04-13', to: '2026-07-11' })
  })
  it('same dates last year shifts both ends back a year', () => {
    expect(comparisonFor('last-year', { from: '2026-01-01', to: '2026-10-09' }))
      .toEqual({ from: '2025-01-01', to: '2025-10-09' })
  })
  it('a leap day maps to 28 February', () => {
    expect(comparisonFor('last-year', { from: '2028-01-01', to: '2028-02-29' }).to).toBe('2027-02-28')
  })
  it('no comparison returns null', () => {
    expect(comparisonFor('none', { from: '2026-01-01', to: '2026-02-01' })).toBeNull()
  })
})
