import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PostMatchSummary from './PostMatchSummary'

// A busy 3-1 win: two goals from the same player (one assisted), an
// opposition goal, a penalty, shots, a save and a card — everything the
// summary derives its lines from.
const winTimeline = [
  { id: 101, athlete_id: 4, athlete_name: 'Sam Peters', action_type: 'goal', is_scoring: true, value: 1, minute: 23 },
  { id: 102, athlete_id: 5, athlete_name: 'Jamie Doe', action_type: 'assist', is_scoring: false, value: 1, minute: 23, related_log_id: 101 },
  { id: 103, athlete_id: null, athlete_name: null, action_type: 'goal', is_scoring: true, value: 1, minute: 44 },
  { id: 104, athlete_id: 4, athlete_name: 'Sam Peters', action_type: 'goal', is_scoring: true, value: 1, minute: 61 },
  { id: 105, athlete_id: 9, athlete_name: 'Ben Marx', action_type: 'penalty', is_scoring: true, value: 1, minute: 78 },
  { id: 106, athlete_id: 4, athlete_name: 'Sam Peters', action_type: 'shot_on_target', is_scoring: false, value: 1, minute: 30 },
  { id: 107, athlete_id: null, athlete_name: null, action_type: 'shot_on_target', is_scoring: false, value: 1, minute: 50 },
  { id: 108, athlete_id: 2, athlete_name: 'Casey Lane', action_type: 'save', is_scoring: false, value: 1, minute: 52 },
  { id: 109, athlete_id: 4, athlete_name: 'Sam Peters', action_type: 'yellow_card', is_scoring: false, value: 1, minute: 70 },
]

function statBlock(label) {
  return screen.getByText(label).closest('.event-summary-stat')
}

describe('PostMatchSummary', () => {
  it('wraps up a win: outcome badge, scorers with minutes, assists and penalties', () => {
    render(
      <PostMatchSummary
        result={{ squad: 3, opponent: 1 }}
        timeline={winTimeline}
        opponent="Rovers FC"
      />
    )

    expect(screen.getByRole('heading', { name: 'Post-match summary' })).toBeInTheDocument()
    expect(screen.getByText('Win')).toBeInTheDocument()
    expect(screen.getByText(/9 logged actions/)).toBeInTheDocument()

    // Repeated goals from one player collapse into one line with both
    // minutes, and the assist is credited under its goal.
    const sam = screen.getByText('Sam Peters').closest('.event-summary-scorer')
    expect(sam).toHaveTextContent(/2 goals/)
    expect(sam).toHaveTextContent(/23', 61'/)
    expect(sam).toHaveTextContent(/assisted by Jamie Doe/)

    // Opposition goals are grouped under the opponent's name and dimmed.
    const theirs = screen.getByText('Rovers FC').closest('.event-summary-scorer')
    expect(theirs.className).toContain('is-them')
    expect(theirs).toHaveTextContent(/1 goal/)
    expect(theirs).toHaveTextContent(/44'/)

    // A penalty goal keeps its annotation.
    const pen = screen.getByText('Ben Marx').closest('.event-summary-scorer')
    expect(pen).toHaveTextContent(/78' \(pen\)/)

    // us/them pairs for the shape of the game.
    expect(statBlock('Shots on target').textContent).toBe('1Shots on target1')
    expect(statBlock('Saves').textContent).toBe('1Saves0')
    expect(statBlock('Cards').textContent).toBe('1Cards0')
  })

  it('handles a goalless draw with nothing logged', () => {
    render(<PostMatchSummary result={{ squad: 0, opponent: 0 }} timeline={[]} opponent="Rovers FC" />)

    expect(screen.getByText('Draw')).toBeInTheDocument()
    expect(screen.getByText(/0 logged actions/)).toBeInTheDocument()
    expect(document.querySelector('.event-summary-scorers')).toBeNull()
    expect(statBlock('Shots on target').textContent).toBe('0Shots on target0')
  })

  it('labels a defeat as a loss', () => {
    render(<PostMatchSummary result={{ squad: 1, opponent: 2 }} timeline={[]} opponent="Rovers FC" />)

    expect(screen.getByText('Loss')).toBeInTheDocument()
  })
})
