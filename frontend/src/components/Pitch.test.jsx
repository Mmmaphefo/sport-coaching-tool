import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Pitch from './Pitch'

const homePlayers = [
  { athlete_id: 1, name: 'Marcus Hale', squad_number: 9, pos_x: 50, pos_y: 88, rating: 7.5 },
  { athlete_id: 2, name: 'Pia Sundhage', squad_number: 10, pos_x: 39, pos_y: 24, photo: 'data:image/jpeg;base64,UElD', rating: 8.4 },
]

const awayPlayers = [
  { athlete_id: 3, name: 'Away Striker', pos_x: 50, pos_y: 12 },
]

describe('Pitch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('positions players with percent coordinates', () => {
    const { container } = render(
      <Pitch homePlayers={homePlayers} awayPlayers={awayPlayers} />
    )
    const dots = container.querySelectorAll('.pitch-player')
    expect(dots).toHaveLength(3)
    expect(dots[0]).toHaveStyle({ left: '50%', top: '88%' })
    expect(dots[0].className).toContain('pitch-player-home')
    expect(dots[2].className).toContain('pitch-player-away')
  })

  it('shows initials when there is no photo and the photo when there is one', () => {
    const { container } = render(<Pitch homePlayers={homePlayers} awayPlayers={[]} />)
    expect(screen.getByText('MH')).toBeInTheDocument()
    expect(screen.queryByText('PS')).not.toBeInTheDocument()
    const img = container.querySelector('.pitch-dot-img')
    expect(img).toHaveAttribute('src', 'data:image/jpeg;base64,UElD')
  })

  it('renders FotMob-coloured rating badges', () => {
    const { container } = render(<Pitch homePlayers={homePlayers} awayPlayers={[]} />)
    const badges = container.querySelectorAll('.pitch-rating')
    expect(badges).toHaveLength(2)
    expect(badges[0]).toHaveStyle({ background: '#58a55c' })
    expect(badges[1]).toHaveStyle({ background: '#2e8f43' })
    expect(screen.getByText('7.5')).toBeInTheDocument()
  })

  it('omits the rating badge when no rating was supplied', () => {
    const { container } = render(<Pitch homePlayers={awayPlayers} awayPlayers={[]} />)
    expect(container.querySelector('.pitch-rating')).toBeNull()
  })

  it('calls onSelect with the player and side on click in view mode', () => {
    const onSelect = vi.fn()
    render(<Pitch homePlayers={homePlayers} awayPlayers={[]} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('9 · Marcus Hale'))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ athlete_id: 1 }),
      'home'
    )
  })

  it('drags a dot to clamped percent coordinates in editable mode', () => {
    const onMove = vi.fn()
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 400,
      right: 200,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    render(
      <Pitch homePlayers={homePlayers} awayPlayers={[]} editable onMove={onMove} />
    )
    const dot = screen.getByText('9 · Marcus Hale').closest('.pitch-player')

    fireEvent.pointerDown(dot, { pointerId: 1, clientX: 100, clientY: 352 })
    expect(onMove).toHaveBeenLastCalledWith(1, 'home', 50, 88)

    fireEvent.pointerMove(window, { pointerId: 1, clientX: 400, clientY: -50 })
    expect(onMove).toHaveBeenLastCalledWith(1, 'home', 98, 2)

    const callsAfterMove = onMove.mock.calls.length
    fireEvent.pointerUp(window, { pointerId: 1 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 10 })
    expect(onMove.mock.calls.length).toBe(callsAfterMove)
  })

  it('marks the selected player and fades ineligible ones', () => {
    const { container } = render(
      <Pitch
        homePlayers={homePlayers}
        awayPlayers={[]}
        selectedId={1}
        fadedIds={new Set([2])}
      />
    )
    const dots = container.querySelectorAll('.pitch-player')
    expect(dots[0].className).toContain('is-selected')
    expect(dots[1].className).toContain('is-faded')
  })
})
