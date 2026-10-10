// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// More tactics board behaviour: deleting the routine that is open, a
// cancelled or failed delete, and clearing the board. Kept separate from TacticsBoard.test.jsx.
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


async function openRoutine() {
  mockApi()
  const view = renderBoard()
  await screen.findByText('Corner kick routine')
  fireEvent.click(screen.getByRole('button', { name: 'Corner kick routine' }))
  const svg = pitch(view.container)
  expect(svg.querySelectorAll('g')).toHaveLength(1)
  return svg
}

const deletes = () => mocks.apiRequest.mock.calls.filter(([, o]) => o?.method === 'DELETE')

describe('TacticsBoard: deleting and clearing', () => {
  it('deleting the open routine also clears the board', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    const svg = await openRoutine()
    fireEvent.click(document.querySelector('.tactics-delete'))
    await waitFor(() => expect(svg.querySelectorAll('g')).toHaveLength(0))
    expect(svg.querySelectorAll('line[marker-end]')).toHaveLength(0)
    // With nothing open, saving creates a new routine again.
    expect(screen.getByRole('button', { name: 'Save Routine' })).toBeInTheDocument()
  })

  it('keeps the routine when the delete is cancelled', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    await openRoutine()
    fireEvent.click(document.querySelector('.tactics-delete'))
    expect(deletes()).toEqual([])
    expect(screen.getByRole('button', { name: 'Corner kick routine' })).toBeInTheDocument()
  })

  it('keeps the routine and logs the error when the delete fails', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockApi()
    const base = mocks.apiRequest.getMockImplementation()
    mocks.apiRequest.mockImplementation((path, options = {}) =>
      options.method === 'DELETE' ? Promise.reject(new Error('Server error')) : base(path, options))
    renderBoard()
    await screen.findByText('Corner kick routine')
    fireEvent.click(document.querySelector('.tactics-delete'))
    await waitFor(() => expect(logged).toHaveBeenCalledWith('Failed to delete tactic:', expect.any(Error)))
    expect(screen.getByRole('button', { name: 'Corner kick routine' })).toBeInTheDocument()
  })

  it('Clear empties the board of markers and arrows', async () => {
    const svg = await openRoutine()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(svg.querySelectorAll('g')).toHaveLength(0)
    expect(svg.querySelectorAll('line[marker-end]')).toHaveLength(0)
  })
})
