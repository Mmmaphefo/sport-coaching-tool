// AI assistance: drafted with Qoder; reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import WeatherWidget from './WeatherWidget'

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

vi.mock('./Loader', () => ({
  default: () => <span>Loading…</span>,
}))

const weather = {
  current: { temperatureC: 21, description: 'Clear sky', icon: '☀️' },
  daily: [],
  latitude: -26.2041,
  longitude: 28.0473,
  resolvedLocation: 'Johannesburg',
}

describe('WeatherWidget venue map', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset()
    mocks.getToken.mockResolvedValue('test-token')
    mocks.apiRequest.mockResolvedValue(weather)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('falls back to the OpenStreetMap embed without a Mapbox token', async () => {
    render(<WeatherWidget location="Wits Main Oval" />)

    await waitFor(() => expect(screen.getByText(/Johannesburg/i)).toBeInTheDocument())

    const iframe = screen.getByTitle('Map of Johannesburg')
    expect(iframe.getAttribute('src')).toContain('https://www.openstreetmap.org/export/embed.html')
    expect(iframe.getAttribute('src')).toContain('marker=-26.2041%2C28.0473')
    expect(screen.getByRole('link', { name: /View larger map/i })).toHaveAttribute(
      'href',
      expect.stringContaining('https://www.openstreetmap.org/?mlat=-26.2041')
    )
  })

  it('renders a Mapbox static map when the token is configured', async () => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', 'pk.test.123')

    render(<WeatherWidget location="Wits Main Oval" />)

    const img = await screen.findByRole('img', { name: 'Map of Johannesburg' })
    expect(img.getAttribute('src')).toContain('https://api.mapbox.com/styles/v1/mapbox/navigation-night-v1/static/')
    expect(img.getAttribute('src')).toContain('pin-s%2Be0564f(28.0473%2C-26.2041)')
    expect(img.getAttribute('src')).toContain('access_token=pk.test.123')
    // "Open this pin on my phone" goes to a plain Google Maps deep link —
    // no Google API or key involved.
    expect(screen.getByRole('link', { name: /View larger map/i })).toHaveAttribute(
      'href',
      'https://www.google.com/maps?q=-26.2041,28.0473'
    )
  })
})
