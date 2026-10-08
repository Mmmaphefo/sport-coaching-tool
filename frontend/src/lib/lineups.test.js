import { describe, it, expect } from 'vitest'
import {
  computeRating,
  ratingColor,
  initialsOf,
  defaultXiPositions,
  detectFormation,
  isLinkedAssist,
  assistForGoal,
  parseSubstitutionNotes,
  canLogOn,
  buildLineupPayload,
  splitLineup,
} from './lineups'

describe('computeRating', () => {
  it('starts at the 6.0 base with no entries', () => {
    expect(computeRating([])).toBe(6.0)
  })

  it('adds and subtracts action weights', () => {
    const rating = computeRating([
      { action_type: 'goal' },
      { action_type: 'assist' },
      { action_type: 'yellow_card' },
    ])
    expect(rating).toBe(6 + 1.0 + 0.7 - 0.5)
  })

  it('clamps to the 0-10 range', () => {
    const manyGoals = Array.from({ length: 10 }, () => ({ action_type: 'goal' }))
    expect(computeRating(manyGoals)).toBe(10)
    const sentOff = Array.from({ length: 10 }, () => ({ action_type: 'red_card' }))
    expect(computeRating(sentOff)).toBe(0)
  })

  it('ignores unknown action types', () => {
    expect(computeRating([{ action_type: 'water_break' }])).toBe(6.0)
  })
})

describe('ratingColor', () => {
  it('follows the FotMob buckets', () => {
    expect(ratingColor(5.4).bg).toBe('#d5453c')
    expect(ratingColor(6.6).bg).toBe('#e78a2e')
    expect(ratingColor(7.5).bg).toBe('#58a55c')
    expect(ratingColor(8.4).bg).toBe('#2e8f43')
    expect(ratingColor(9.3).bg).toBe('#1c6e32')
  })
})

describe('initialsOf', () => {
  it('uses first and last name initials', () => {
    expect(initialsOf('Marcus Hale')).toBe('MH')
  })

  it('truncates single names and handles empties', () => {
    expect(initialsOf('Cher')).toBe('CH')
    expect(initialsOf('')).toBe('?')
  })
})

describe('defaultXiPositions', () => {
  it('returns 11 slots for a full XI', () => {
    expect(defaultXiPositions('home')).toHaveLength(11)
    expect(defaultXiPositions('away')).toHaveLength(11)
  })

  it('mirrors the away side vertically', () => {
    const home = defaultXiPositions('home')
    const away = defaultXiPositions('away')
    home.forEach((slot, i) => {
      expect(away[i].pos_x).toBe(slot.pos_x)
      expect(away[i].pos_y).toBe(100 - slot.pos_y)
    })
  })

  it('keeps the keeper near the bottom for home and the top for away', () => {
    expect(defaultXiPositions('home')[0].pos_y).toBeGreaterThan(80)
    expect(defaultXiPositions('away')[0].pos_y).toBeLessThan(20)
  })
})

describe('detectFormation', () => {
  const xi = (side) =>
    defaultXiPositions(side).map((p) => ({ pos_x: p.pos_x, pos_y: p.pos_y }))

  it('reads a default home XI as 4-4-2', () => {
    expect(detectFormation(xi('home'), 'home')).toBe('4-4-2')
  })

  it('reads a default away XI as 4-4-2', () => {
    expect(detectFormation(xi('away'), 'away')).toBe('4-4-2')
  })

  it('reads a 4-3-3 when the front line has three', () => {
    const players = [
      { pos_x: 50, pos_y: 88 },
      { pos_x: 20, pos_y: 70 }, { pos_x: 40, pos_y: 70 }, { pos_x: 60, pos_y: 70 }, { pos_x: 80, pos_y: 70 },
      { pos_x: 30, pos_y: 48 }, { pos_x: 50, pos_y: 48 }, { pos_x: 70, pos_y: 48 },
      { pos_x: 20, pos_y: 22 }, { pos_x: 50, pos_y: 20 }, { pos_x: 80, pos_y: 22 },
    ]
    expect(detectFormation(players, 'home')).toBe('4-3-3')
  })

  it('returns null without enough lines', () => {
    expect(detectFormation([{ pos_x: 50, pos_y: 50 }], 'home')).toBeNull()
    expect(detectFormation([], 'home')).toBeNull()
  })
})

describe('timeline links', () => {
  it('flags linked assists and finds the assist for a goal', () => {
    const goal = { id: 7, action_type: 'goal' }
    const assist = { id: 8, action_type: 'assist', related_log_id: 7 }
    const legacy = { id: 9, action_type: 'assist', related_log_id: null }
    const timeline = [goal, assist, legacy]

    expect(isLinkedAssist(assist)).toBe(true)
    expect(isLinkedAssist(legacy)).toBe(false)
    expect(assistForGoal(timeline, 7)).toBe(assist)
    expect(assistForGoal(timeline, 999)).toBeNull()
  })

  it('parses substitution notes', () => {
    expect(parseSubstitutionNotes('on:42')).toBe(42)
    expect(parseSubstitutionNotes('hand injury')).toBeNull()
    expect(parseSubstitutionNotes(null)).toBeNull()
  })
})

describe('canLogOn', () => {
  it('allows anything on starters', () => {
    expect(canLogOn({ is_starter: true }, 'goal')).toBe(true)
  })

  it('restricts bench players to cards only', () => {
    const benchRow = { is_starter: false }
    expect(canLogOn(benchRow, 'yellow_card')).toBe(true)
    expect(canLogOn(benchRow, 'red_card')).toBe(true)
    expect(canLogOn(benchRow, 'goal')).toBe(false)
    expect(canLogOn(benchRow, 'save')).toBe(false)
  })

  it('rejects players outside the match-day squad entirely', () => {
    expect(canLogOn(null, 'yellow_card')).toBe(false)
  })
})

describe('buildLineupPayload', () => {
  it('builds rows for both sides and nulls bench positions', () => {
    const { lineups } = buildLineupPayload({
      home: [{ athlete_id: 1, is_starter: true, pos_x: 50, pos_y: 88 }],
      away: [{ athlete_id: 2, is_starter: false, pos_x: 10, pos_y: 10 }],
    })

    expect(lineups).toEqual([
      { athlete_id: 1, team_side: 'home', is_starter: true, pos_x: 50, pos_y: 88 },
      { athlete_id: 2, team_side: 'away', is_starter: false, pos_x: null, pos_y: null },
    ])
  })
})

describe('splitLineup', () => {
  it('splits starters from bench for one side', () => {
    const lineups = [
      { athlete_id: 1, team_side: 'home', is_starter: true, pos_x: 50, pos_y: 88 },
      { athlete_id: 2, team_side: 'home', is_starter: false, pos_x: null, pos_y: null },
      { athlete_id: 3, team_side: 'away', is_starter: true, pos_x: 50, pos_y: 12 },
    ]
    const { starters, bench } = splitLineup(lineups, 'home')
    expect(starters.map((s) => s.athlete_id)).toEqual([1])
    expect(bench.map((b) => b.athlete_id)).toEqual([2])
  })
})
