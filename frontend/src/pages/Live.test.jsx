// AI assistance: drafted with Qoder (AI coding assistant); reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Live from './Live'

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

function renderLive() {
  return render(
    <MemoryRouter initialEntries={['/live']}>
      <Routes>
        <Route path="/live" element={<Live />} />
        <Route path="/dashboard" element={<p>Dashboard page</p>} />
        <Route path="/live/:id" element={<p>Match centre</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('Live', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset()
    mocks.getToken.mockResolvedValue('test-token')
  })

  it('redirects players to the dashboard', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/account/me') return Promise.resolve({ role: 'athlete' })
      if (path === '/api/events') return Promise.resolve([])
      return Promise.resolve({})
    })

    renderLive()

    // The live hub is a staff tool — players follow scores from the dashboard.
    expect(await screen.findByText('Dashboard page')).toBeInTheDocument()
    expect(screen.queryByText('No live event right now')).not.toBeInTheDocument()
  })

  it('shows the empty state for staff when nothing is live', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/account/me') return Promise.resolve({ role: 'coach' })
      if (path === '/api/events') return Promise.resolve([])
      return Promise.resolve({})
    })

    renderLive()

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /No live event right now/i })).toBeInTheDocument()
    })
  })
})
