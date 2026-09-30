import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import VenueMapEditor from './VenueMapEditor'

// jsdom has no layout, so the canvas reports a zero size (no tiles, no
// geometry). Pin it to a known viewport so the slippy-map maths run against
// stable numbers: a click at the canvas centre lands exactly on the default
// Johannesburg view, and the pin starts at the canvas centre when one is set.
const CANVAS = { width: 800, height: 400 }

function mockCanvasSize() {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(CANVAS.width)
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(CANVAS.height)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: CANVAS.width,
    height: CANVAS.height,
    right: CANVAS.width,
    bottom: CANVAS.height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
}

function canvas() {
  return screen.getByRole('application', { name: /venue map/i })
}

function tileSrcs() {
  return [...document.querySelectorAll('.venue-map-editor-tile')].map((t) => t.getAttribute('src'))
}

function clickCanvas(el, clientX, clientY, pointerId = 1) {
  fireEvent.pointerDown(el, { pointerId, clientX, clientY })
  fireEvent.pointerUp(el, { pointerId, clientX, clientY })
}

// Mapbox geocoding responses: features with a place_name and a [lng, lat]
// center.
function geocodeResponse(features) {
  return {
    ok: true,
    json: async () => ({
      features: features.map((f) => ({ place_name: f.name, center: [f.lng, f.lat] })),
    }),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  delete navigator.geolocation
  delete navigator.clipboard
})

// The OpenStreetMap fallback — exactly what renders when no Mapbox token is
// configured (local dev without .env, or a mis-configured deploy).
describe('VenueMapEditor (OpenStreetMap fallback)', () => {
  it('renders OSM tiles, attribution and controls around the default view', () => {
    mockCanvasSize()
    render(<VenueMapEditor onChange={vi.fn()} />)

    const srcs = tileSrcs()
    expect(srcs.length).toBeGreaterThan(0)
    expect(srcs.every((src) => src.startsWith('https://tile.openstreetmap.org/12/'))).toBe(true)

    expect(screen.getByRole('link', { name: /OpenStreetMap contributors/i })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright'
    )
    // No token, no address search box — but the map itself still works.
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Use my GPS location/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Clear pin/i })).toBeNull()
    expect(screen.getByText(/Click the map to pin the pitch/i)).toBeInTheDocument()
  })

  it('zooms in when the + control is pressed', () => {
    mockCanvasSize()
    render(<VenueMapEditor onChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))

    expect(tileSrcs().some((src) => src.startsWith('https://tile.openstreetmap.org/13/'))).toBe(true)
  })

  it('drops the pin where the coach clicks', () => {
    mockCanvasSize()
    const onChange = vi.fn()
    render(<VenueMapEditor onChange={onChange} />)

    // Canvas centre === the default Johannesburg view, so a centre click must
    // come back out as exactly the default centre coordinates.
    clickCanvas(canvas(), 400, 200)
    expect(onChange).toHaveBeenLastCalledWith({ lat: -26.2041, lng: 28.0473 })

    // A click east and south of centre moves the pin east and south.
    clickCanvas(canvas(), 600, 300, 2)
    const pin = onChange.mock.calls[1][0]
    expect(pin.lng).toBeGreaterThan(28.0473)
    expect(pin.lat).toBeLessThan(-26.2041)
  })

  it('pans on drag instead of dropping a pin', () => {
    mockCanvasSize()
    const onChange = vi.fn()
    render(<VenueMapEditor onChange={onChange} />)

    const el = canvas()
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 400, clientY: 200 })
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 520, clientY: 260 })
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 520, clientY: 260 })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('drags the existing pin to fine-tune it', () => {
    mockCanvasSize()
    const onChange = vi.fn()
    render(<VenueMapEditor latitude={-26.2041} longitude={28.0473} onChange={onChange} />)

    // With a pin supplied the map opens centred on it (zoom 15), so the pin
    // starts exactly at the canvas centre.
    expect(document.querySelector('.venue-map-editor-pin')).not.toBeNull()

    const el = canvas()
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 400, clientY: 200 })
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 412, clientY: 200 })
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 412, clientY: 200 })

    expect(onChange).toHaveBeenCalledTimes(1)
    const moved = onChange.mock.calls[0][0]
    expect(moved.lng).toBeGreaterThan(28.0473)
    expect(moved.lat).toBeCloseTo(-26.2041, 3)
  })

  it('shows the pinned coordinates at six decimals and clears the pin on demand', () => {
    mockCanvasSize()
    const onChange = vi.fn()
    render(<VenueMapEditor latitude={-26.2041} longitude={28.0473} onChange={onChange} />)

    expect(screen.getByText(/Pinned at -26.204100, 28.047300/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Clear pin/i }))
    expect(onChange).toHaveBeenCalledWith({ lat: null, lng: null })
  })

  it('copies the pinned coordinates to the clipboard', async () => {
    mockCanvasSize()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<VenueMapEditor latitude={-26.2041} longitude={28.0473} onChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /Copy coordinates/i }))

    expect(writeText).toHaveBeenCalledWith('-26.204100, 28.047300')
    await waitFor(() => expect(screen.getByRole('button', { name: /Copied/i })).toBeInTheDocument())
  })

  it('pins the browser location when Use my GPS location is pressed', () => {
    mockCanvasSize()
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (success) =>
          success({ coords: { latitude: -26.1076, longitude: 28.0567 } }),
      },
    })

    const onChange = vi.fn()
    render(<VenueMapEditor onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /Use my GPS location/i }))

    expect(onChange).toHaveBeenCalledWith({ lat: -26.1076, lng: 28.0567 })
  })
})

// The Mapbox path — everything the token unlocks: dark navigation tiles,
// address search, reverse geocoding, GPS accuracy reporting.
describe('VenueMapEditor (Mapbox mode)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', 'pk.test.123')
    // Default stub so no Mapbox-mode test ever hits the real network; tests
    // that care about geocoding override it.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geocodeResponse([])))
  })

  it('renders dark navigation tiles and Mapbox attribution', () => {
    mockCanvasSize()
    render(<VenueMapEditor onChange={vi.fn()} />)

    const srcs = tileSrcs()
    expect(srcs.length).toBeGreaterThan(0)
    expect(srcs.every((src) => src.startsWith('https://api.mapbox.com/styles/v1/mapbox/navigation-night-v1/tiles/12/'))).toBe(true)
    expect(srcs.every((src) => src.includes('access_token=pk.test.123'))).toBe(true)

    expect(screen.getByRole('link', { name: '© Mapbox' })).toHaveAttribute(
      'href',
      'https://www.mapbox.com/about/maps/'
    )
    expect(screen.getByRole('link', { name: '© OpenStreetMap' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright'
    )

    // The address search box is the headline feature of Mapbox mode.
    expect(screen.getByRole('searchbox', { name: /search for a venue by address/i })).toBeInTheDocument()
    expect(screen.getByText(/Search an address above, use GPS, or click the map/i)).toBeInTheDocument()
  })

  it('searches an address and pins the chosen result', async () => {
    mockCanvasSize()
    const fetchMock = vi.fn().mockResolvedValue(
      geocodeResponse([{ name: 'Wits Main Oval, Johannesburg', lat: -26.1926, lng: 28.0305 }])
    )
    vi.stubGlobal('fetch', fetchMock)

    const onChange = vi.fn()
    const onAddress = vi.fn()
    render(<VenueMapEditor onChange={onChange} onAddress={onAddress} />)

    fireEvent.change(screen.getByRole('searchbox', { name: /search for a venue by address/i }), {
      target: { value: 'Wits Main Oval' },
    })

    const result = await screen.findByRole('button', { name: /Wits Main Oval, Johannesburg/i })
    fireEvent.click(result)

    expect(onChange).toHaveBeenLastCalledWith({ lat: -26.1926, lng: 28.0305 })
    // The picked place is offered to the parent's location field.
    expect(onAddress).toHaveBeenCalledWith('Wits Main Oval, Johannesburg')
    // The search request carried the token and the encoded query.
    expect(fetchMock).toHaveBeenCalled()
    const url = fetchMock.mock.calls[0][0]
    expect(url).toContain('https://api.mapbox.com/geocoding/v5/mapbox.places/Wits%20Main%20Oval.json')
    expect(url).toContain('access_token=pk.test.123')
    // Picking a result collapses the list and clears the box.
    expect(screen.queryByRole('button', { name: /Wits Main Oval, Johannesburg/i })).toBeNull()
    expect(screen.getByRole('searchbox', { name: /search for a venue by address/i }).value).toBe('')
    // The chosen address is shown under the map.
    expect(screen.getByText('Wits Main Oval, Johannesburg')).toBeInTheDocument()
  })

  it('never overwrites a venue name the coach typed themselves', async () => {
    mockCanvasSize()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(geocodeResponse([{ name: 'Wits Main Oval, Johannesburg', lat: -26.1926, lng: 28.0305 }]))
    )

    const onAddress = vi.fn()
    render(<VenueMapEditor latitude={-26.2041} longitude={28.0473} label="My own pitch name" onChange={vi.fn()} onAddress={onAddress} />)

    fireEvent.change(screen.getByRole('searchbox', { name: /search for a venue by address/i }), {
      target: { value: 'Wits Main Oval' },
    })

    fireEvent.click(await screen.findByRole('button', { name: /Wits Main Oval, Johannesburg/i }))

    expect(onAddress).not.toHaveBeenCalled()
  })

  it('shows the reverse-geocoded address of a pinned venue', async () => {
    mockCanvasSize()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(geocodeResponse([{ name: '12 Jan Smuts Ave, Braamfontein', lat: 0, lng: 0 }]))
    )

    render(<VenueMapEditor latitude={-26.2041} longitude={28.0473} onChange={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('12 Jan Smuts Ave, Braamfontein')).toBeInTheDocument(), { timeout: 3000 })
  })

  it('uses a high-accuracy GPS fix and reports its accuracy', () => {
    mockCanvasSize()
    let capturedOptions = null
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (success, error, options) => {
          capturedOptions = options
          success({ coords: { latitude: -26.1076, longitude: 28.0567, accuracy: 12.4 } })
        },
      },
    })

    const onChange = vi.fn()
    render(<VenueMapEditor onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /Use my GPS location/i }))

    // Uber-grade request: fresh high-accuracy fix, not a coarse cached one.
    expect(capturedOptions).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 })
    expect(onChange).toHaveBeenCalledWith({ lat: -26.1076, lng: 28.0567 })
    expect(screen.getByText(/±12 m/)).toBeInTheDocument()
  })

  it('shows an error when address search fails', async () => {
    mockCanvasSize()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    render(<VenueMapEditor onChange={vi.fn()} />)

    fireEvent.change(screen.getByRole('searchbox', { name: /search for a venue by address/i }), {
      target: { value: 'Braamfontein' },
    })

    await waitFor(() =>
      expect(screen.getByText(/Address search is unavailable/i)).toBeInTheDocument(), { timeout: 3000 }
    )
  })
})
