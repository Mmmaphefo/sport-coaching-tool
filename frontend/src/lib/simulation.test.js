// AI assistance: drafted with Claude (Sonnet 5) via claude.ai; reviewed and tested by the project team.
import { describe, it, expect, vi } from 'vitest'
import {
  FULL_TIME_MINUTE,
  MINUTE_MS,
  SIM_DURATION_MS,
  groupByMinute,
  runSimulation,
  scriptToLogBody,
} from './simulation'

// A small script that covers every incident shape the engine emits, including
// an opponent action (athlete_id null) and a substitution.
const SCRIPT = [
  { minute: 3, team_side: 'home', action_type: 'shot_on_target', is_scoring: false, athlete_id: 11 },
  { minute: 3, team_side: 'away', action_type: 'save', is_scoring: false, athlete_id: 21 },
  { minute: 24, team_side: 'home', action_type: 'goal', is_scoring: true, athlete_id: 11, assist_athlete_id: 7 },
  { minute: 41, team_side: 'away', action_type: 'goal', is_scoring: true, athlete_id: null },
  { minute: 58, team_side: 'home', action_type: 'yellow_card', is_scoring: false, athlete_id: 4 },
  { minute: 62, team_side: 'home', action_type: 'substitution', is_scoring: false, athlete_id: 11, substitute_athlete_id: 18 },
  { minute: 71, team_side: 'home', action_type: 'goal', is_scoring: true, athlete_id: 18 },
  { minute: 88, team_side: 'home', action_type: 'penalty', is_scoring: false, athlete_id: 18 },
]

function collectingPoster() {
  const posts = []
  return {
    posts,
    postEvent: vi.fn(async (body, entry) => {
      posts.push({ body, minute: entry.minute })
      return { id: posts.length }
    }),
  }
}

describe('simulation helpers', () => {
  it('maps script entries onto log bodies, keeping assists and substitutes', () => {
    expect(scriptToLogBody(SCRIPT[2])).toEqual({
      athlete_id: 11,
      action_type: 'goal',
      is_scoring: true,
      minute: 24,
      notes: null,
      assist_athlete_id: 7,
    })

    expect(scriptToLogBody(SCRIPT[3])).toEqual({
      athlete_id: null,
      action_type: 'goal',
      is_scoring: true,
      minute: 41,
      notes: null,
    })

    expect(scriptToLogBody(SCRIPT[5])).toEqual({
      athlete_id: 11,
      action_type: 'substitution',
      is_scoring: false,
      minute: 62,
      notes: null,
      substitute_athlete_id: 18,
    })
  })

  it('groups incidents by minute in the order the engine produced them', () => {
    const byMinute = groupByMinute(SCRIPT)

    expect([...byMinute.keys()]).toEqual([3, 24, 41, 58, 62, 71, 88])
    expect(byMinute.get(3).map((entry) => entry.action_type)).toEqual(['shot_on_target', 'save'])
    expect(byMinute.get(24)).toHaveLength(1)
  })
})

describe('runSimulation quick mode', () => {
  it('posts every incident immediately and finishes at full time', async () => {
    const { posts, postEvent } = collectingPoster()
    const minutes = []

    const result = await runSimulation({
      script: SCRIPT,
      mode: 'quick',
      postEvent,
      onMinute: (minute) => minutes.push(minute),
    })

    expect(result.posted).toBe(SCRIPT.length)
    expect(result.failures).toEqual([])
    expect(result.cancelled).toBe(false)
    expect(result.lastMinute).toBe(FULL_TIME_MINUTE)
    expect(minutes).toEqual([0, FULL_TIME_MINUTE])
    expect(posts.map((post) => post.minute)).toEqual([3, 3, 24, 41, 58, 62, 71, 88])
    expect(posts[0].body).toMatchObject({ action_type: 'shot_on_target', athlete_id: 11 })
  })

  it('stops at the first failure so later incidents are not logged out of order', async () => {
    const { posts, postEvent } = collectingPoster()
    postEvent.mockImplementation(async (body, entry) => {
      if (entry.action_type === 'goal') throw new Error('Player is not in the match-day squad')
      posts.push({ body, minute: entry.minute })
      return { id: posts.length }
    })

    const result = await runSimulation({ script: SCRIPT, mode: 'quick', postEvent })

    expect(result.posted).toBe(2)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].entry.action_type).toBe('goal')
    expect(result.failures[0].error.message).toBe('Player is not in the match-day squad')
    expect(posts.map((post) => post.minute)).toEqual([3, 3])
  })

  it('posts nothing when the run is cancelled before it starts', async () => {
    const { posts, postEvent } = collectingPoster()

    const result = await runSimulation({
      script: SCRIPT,
      mode: 'quick',
      postEvent,
      isCancelled: () => true,
    })

    expect(postEvent).not.toHaveBeenCalled()
    expect(posts).toEqual([])
    expect(result.posted).toBe(0)
    expect(result.cancelled).toBe(true)
  })
})

describe('runSimulation timed mode', () => {
  // Fake clock so a two-minute playback runs instantly in the test while the
  // pacing maths stays the real one.
  function fakeClock() {
    let clock = 0
    return {
      get clock() {
        return clock
      },
      now: () => clock,
      sleep: vi.fn(async (ms) => {
        clock += ms
      }),
    }
  }

  it('spends exactly two real minutes on the ninety minutes', async () => {
    const { postEvent } = collectingPoster()
    const clock = fakeClock()
    const minutes = []

    const result = await runSimulation({
      script: SCRIPT,
      mode: 'timed',
      postEvent,
      onMinute: (minute) => minutes.push(minute),
      now: clock.now,
      sleep: clock.sleep,
    })

    expect(result.posted).toBe(SCRIPT.length)
    expect(result.mode).toBe('timed')
    expect(result.lastMinute).toBe(FULL_TIME_MINUTE)
    expect(minutes).toEqual(
      Array.from({ length: FULL_TIME_MINUTE }, (_, index) => index + 1)
    )
    // "Two real minutes" — 90 minutes of 1333.33ms, so the accumulation is
    // compared with a tolerance rather than an exact float equality.
    expect(clock.clock).toBeCloseTo(SIM_DURATION_MS, 6)
    expect(MINUTE_MS * FULL_TIME_MINUTE).toBeCloseTo(SIM_DURATION_MS, 6)
    expect(clock.sleep).toHaveBeenCalledTimes(FULL_TIME_MINUTE)
    expect(clock.sleep).toHaveBeenCalledWith(MINUTE_MS)
  })

  it('fires each incident on its own minute and honours injected pacing', async () => {
    const calls = []
    const clock = fakeClock()

    await runSimulation({
      script: SCRIPT,
      mode: 'timed',
      postEvent: async (body, entry) => {
        calls.push({ minute: entry.minute, at: clock.clock, action: body.action_type })
        return { id: calls.length }
      },
      now: clock.now,
      sleep: clock.sleep,
      pacing: 10,
    })

    // Minute 3 arrives at 30ms, minute 88 at 880ms with a 10ms minute.
    expect(calls[0]).toEqual({ minute: 3, at: 20, action: 'shot_on_target' })
    expect(calls.find((call) => call.minute === 88).at).toBe(870)
    expect(clock.clock).toBe(FULL_TIME_MINUTE * 10)
  })

  it('can be stopped part way through a playback', async () => {
    const clock = fakeClock()
    let stop = false

    const result = await runSimulation({
      script: SCRIPT,
      mode: 'timed',
      postEvent: async (body, entry) => {
        if (entry.minute >= 58) stop = true
        return { id: entry.minute }
      },
      isCancelled: () => stop,
      now: clock.now,
      sleep: clock.sleep,
    })

    expect(result.cancelled).toBe(true)
    // Minutes 1-58 ran, nothing after the cancellation point was posted.
    expect(result.posted).toBe(5)
    expect(result.lastMinute).toBe(58)
    expect(clock.clock).toBeLessThan(SIM_DURATION_MS)
  })
})
