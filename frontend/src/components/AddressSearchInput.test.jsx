import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AddressSearchInput from './AddressSearchInput'

// Controlled harness — the component is controlled, so typing only works if
// something applies onChange back into the value.
function Controlled({ onChangeSpy = vi.fn(), onPickSpy = vi.fn(), ...props }) {
  const [value, setValue] = useState('')
  return (
    <AddressSearchInput
      value={value}
      onChange={(text) => {
        setValue(text)
        onChangeSpy(text)
      }}
      onPick={onPickSpy}
      ariaLabel="Search for a venue by address"
      {...props}
    />
  )
}

function geocodeResponse(features) {
  return {
    ok: true,
    json: async () => ({
      features: features.map((f) => ({ place_name: f.name, center: [f.lng, f.lat] })),
    }),
  }
}

const WITS_OVAL = { name: 'Wits Main Oval, Johannesburg', lat: -26.1926, lng: 28.0305 }
const WITS_STADIUM = { name: 'Wits Main Stadium, Johannesburg', lat: -26.1927, lng: 28.0306 }

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('AddressSearchInput (no Mapbox token)', () => {
  it('degrades to a plain text input', () => {
    render(<Controlled />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).toBeNull()
  })
})

describe('AddressSearchInput (Mapbox mode)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', 'pk.test.123')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geocodeResponse([])))
  })

  it('shows suggestions as the coach types and fills the field on pick', async () => {
    const fetchMock = vi.fn().mockResolvedValue(geocodeResponse([WITS_OVAL, WITS_STADIUM]))
    vi.stubGlobal('fetch', fetchMock)
    const onChangeSpy = vi.fn()
    const onPickSpy = vi.fn()
    render(<Controlled onChangeSpy={onChangeSpy} onPickSpy={onPickSpy} />)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Wits Main' } })

    await screen.findByRole('button', { name: /Wits Main Oval, Johannesburg/i })
    expect(screen.getByRole('button', { name: /Wits Main Stadium, Johannesburg/i })).toBeInTheDocument()
    // The request carried the token and the encoded query.
    const url = fetchMock.mock.calls[0][0]
    expect(url).toContain('https://api.mapbox.com/geocoding/v5/mapbox.places/Wits%20Main.json')
    expect(url).toContain('access_token=pk.test.123')

    fireEvent.click(screen.getByRole('button', { name: /Wits Main Oval, Johannesburg/i }))

    // Field filled with the chosen address, pick reported with coordinates,
    // list collapsed.
    expect(onChangeSpy).toHaveBeenLastCalledWith('Wits Main Oval, Johannesburg')
    expect(onPickSpy).toHaveBeenCalledWith(WITS_OVAL)
    expect(screen.queryByRole('button', { name: /Wits Main Oval, Johannesburg/i })).toBeNull()
    expect(screen.getByRole('searchbox').value).toBe('Wits Main Oval, Johannesburg')
  })

  it('Enter picks the highlighted suggestion and never submits the form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geocodeResponse([WITS_OVAL, WITS_STADIUM])))
    const onPickSpy = vi.fn()
    render(
      <form onSubmit={() => { throw new Error('form must not submit while suggestions are open') }}>
        <Controlled onPickSpy={onPickSpy} />
      </form>
    )

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Wits Main' } })
    await screen.findByRole('button', { name: /Wits Main Oval, Johannesburg/i })

    // preventDefault was called when Enter was handled.
    expect(fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' })).toBe(false)
    expect(onPickSpy).toHaveBeenCalledWith(WITS_OVAL)
  })

  it('ArrowDown then Enter picks the next suggestion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geocodeResponse([WITS_OVAL, WITS_STADIUM])))
    const onPickSpy = vi.fn()
    render(<Controlled onPickSpy={onPickSpy} />)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Wits Main' } })
    await screen.findByRole('button', { name: /Wits Main Oval, Johannesburg/i })

    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' })
    expect(onPickSpy).toHaveBeenCalledWith(WITS_STADIUM)
  })

  it('Escape closes the dropdown without wiping the typed text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geocodeResponse([WITS_OVAL])))
    render(<Controlled />)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Wits Main' } })
    await screen.findByRole('button', { name: /Wits Main Oval, Johannesburg/i })

    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect(screen.queryByRole('button', { name: /Wits Main Oval, Johannesburg/i })).toBeNull()
    expect(screen.getByRole('searchbox').value).toBe('Wits Main')
  })

  it('shows a hint when nothing matches', async () => {
    render(<Controlled />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzqq nowhere' } })
    await screen.findByText(/No matching addresses/i)
  })

  it('shows an error when geocoding fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    render(<Controlled />)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Braamfontein' } })

    await waitFor(() =>
      expect(screen.getByText(/Address search is unavailable/i)).toBeInTheDocument()
    )
  })
})
