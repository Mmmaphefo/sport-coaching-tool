// AI assistance: drafted with Claude (Sonnet 5) via claude.ai; reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import TacticsBoard from './TacticsBoard'

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  getToken: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  apiRequest: mocks.apiRequest,
}))

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mocks.getToken }),
}))

vi.mock('../components/Layout', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

const seededTactic = {
  id: 11,
  name: 'Corner kick routine',
  frames: [
    {
      id: 1,
      elements: [{ id: 1, type: 'X', x: 30, y: 40 }],
      arrows: [{ id: 2, x1: 10, y1: 10, x2: 60, y2: 60 }],
    },
  ],
}

let tacticsList

function mockApi({ role = 'coach' } = {}) {
  mocks.apiRequest.mockImplementation((path, options = {}) => {
    if (path === '/api/account/me') return Promise.resolve({ role })
    if (path === '/api/tactics' && options.method === 'POST') {
      const saved = { id: 12, ...options.body }
      tacticsList = [...tacticsList, saved]
      return Promise.resolve(saved)
    }
    if (options.method === 'DELETE' && path.startsWith('/api/tactics/')) {
      tacticsList = tacticsList.filter((t) => t.id !== Number(path.split('/').pop()))
      return Promise.resolve({})
    }
    if (path === '/api/tactics') return Promise.resolve([...tacticsList])
    return Promise.resolve({})
  })
}

function renderBoard() {
  return render(<BrowserRouter><TacticsBoard /></BrowserRouter>)
}

function pitch(container) {
  return container.querySelector('.tactics-svg')
}

// getSvgPoint maps client coordinates through getBoundingClientRect — jsdom
// returns all zeros, so the pitch is given a deterministic 100x100 box.
beforeEach(() => {
  mocks.apiRequest.mockReset()
  mocks.getToken.mockResolvedValue('test-token')
  tacticsList = [{ ...seededTactic, frames: seededTactic.frames.map((f) => ({ ...f })) }]
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    right: 100,
    bottom: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('TacticsBoard', () => {
  it('lists saved routines and starts with an empty pitch', async () => {
    mockApi()
    const { container } = renderBoard()

    expect(await screen.findByText('Corner kick routine')).toBeInTheDocument()
    expect(screen.getByText('Saved Routines')).toBeInTheDocument()
    // No elements on the pitch yet — the marker polygon lives in defs, not in
    // a placed element group.
    expect(pitch(container).querySelector('g')).toBeNull()
  })

  it('places the active tool on the pitch where clicked', async () => {
    mockApi()
    const { container } = renderBoard()
    await screen.findByText('Corner kick routine')

    // X is the default tool.
    fireEvent.click(pitch(container), { clientX: 50, clientY: 50 })
    expect(pitch(container).querySelector('g text').textContent).toBe('X')
    expect(pitch(container).querySelector('g').getAttribute('transform')).toBe('translate(50, 50)')

    // Switching to the cone places a triangle at the click point instead.
    fireEvent.click(screen.getByRole('button', { name: /Cone/ }))
    fireEvent.click(pitch(container), { clientX: 20, clientY: 80 })
    expect(pitch(container).querySelectorAll('g polygon')).toHaveLength(1)
    expect(pitch(container).querySelectorAll('g text')).toHaveLength(1)
  })

  it('draws an arrow between two clicked points', async () => {
    mockApi()
    const { container } = renderBoard()
    await screen.findByText('Corner kick routine')

    fireEvent.click(screen.getByRole('button', { name: /Arrow/ }))
    fireEvent.click(pitch(container), { clientX: 20, clientY: 20 })
    expect(await screen.findByText(/Click start point, then click end point/i)).toBeInTheDocument()

    fireEvent.click(pitch(container), { clientX: 80, clientY: 80 })

    // One committed arrow (the dashed preview is gone), from 20,20 to 80,80.
    const arrows = pitch(container).querySelectorAll('line[marker-end]')
    expect(arrows).toHaveLength(1)
    expect(arrows[0].getAttribute('x1')).toBe('20')
    expect(arrows[0].getAttribute('y1')).toBe('20')
    expect(arrows[0].getAttribute('x2')).toBe('80')
    expect(arrows[0].getAttribute('y2')).toBe('80')
  })

  it('loads a saved routine onto the board', async () => {
    mockApi()
    const { container } = renderBoard()
    await screen.findByText('Corner kick routine')

    fireEvent.click(screen.getByRole('button', { name: 'Corner kick routine' }))

    const svg = pitch(container)
    expect(svg.querySelector('g').getAttribute('transform')).toBe('translate(30, 40)')
    expect(svg.querySelectorAll('line[marker-end]')).toHaveLength(1)
    // An open routine is updated rather than saved as a new one.
    expect(screen.getByRole('button', { name: 'Update Routine' })).toBeInTheDocument()
  })

  it('saves the current board as a new routine through the dialog', async () => {
    mockApi()
    const { container } = renderBoard()
    await screen.findByText('Corner kick routine')
    fireEvent.click(pitch(container), { clientX: 50, clientY: 50 })

    fireEvent.click(screen.getByRole('button', { name: 'Save Routine' }))
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Pressing trap' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const post = mocks.apiRequest.mock.calls.find(([path, options]) => path === '/api/tactics' && options?.method === 'POST')
      expect(post).toBeDefined()
      expect(post[1].body.name).toBe('Pressing trap')
      expect(post[1].body.description).toBeNull()
      expect(post[1].body.frames[0].elements).toEqual([
        expect.objectContaining({ type: 'X', x: 50, y: 50 }),
      ])
    })

    // The dialog closes and the refreshed sidebar lists the new routine.
    await screen.findByText('Pressing trap')
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('deletes a routine after confirmation', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    mockApi()
    renderBoard()
    await screen.findByText('Corner kick routine')

    fireEvent.click(document.querySelector('.tactics-delete'))

    await waitFor(() =>
      expect(mocks.apiRequest).toHaveBeenCalledWith('/api/tactics/11', expect.objectContaining({ method: 'DELETE' }))
    )
    await waitFor(() => expect(screen.queryByText('Corner kick routine')).not.toBeInTheDocument())
  })

  it('hides the editing tools from athletes', async () => {
    mockApi({ role: 'athlete' })
    const { container } = renderBoard()

    // Saved routines stay visible, but only for reference.
    await screen.findByText('Corner kick routine')
    await waitFor(() =>
      expect(mocks.apiRequest).toHaveBeenCalledWith('/api/account/me', expect.anything())
    )

    expect(screen.queryByText('Tools')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Save Routine/ })).not.toBeInTheDocument()
    expect(container.querySelector('.tactics-delete')).toBeNull()
  })
})
