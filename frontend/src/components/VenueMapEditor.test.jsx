import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
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

  it('moves the view when dragged — the visible tiles change', () => {
    mockCanvasSize()
    render(<VenueMapEditor onChange={vi.fn()} />)
    const before = tileSrcs()

    const el = canvas()
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 400, clientY: 200 })
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 600, clientY: 200 })
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 600, clientY: 200 })

    expect(tileSrcs().join('|')).not.toBe(before.join('|'))
  })

  it('after panning, the same screen click lands on a different place', () => {
    mockCanvasSize()
    const onChange = vi.fn()
    render(<VenueMapEditor onChange={onChange} />)

    const el = canvas()
    // Click centre → the default Johannesburg view.
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 400, clientY: 200 })
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 400, clientY: 200 })
    const first = onChange.mock.calls[0][0]

    // Pan right by 200px, then click the canvas centre again.
    fireEvent.pointerDown(el, { pointerId: 2, clientX: 400, clientY: 200 })
    fireEvent.pointerMove(el, { pointerId: 2, clientX: 600, clientY: 200 })
    fireEvent.pointerUp(el, { pointerId: 2, clientX: 600, clientY: 200 })
    fireEvent.pointerDown(el, { pointerId: 3, clientX: 400, clientY: 200 })
    fireEvent.pointerUp(el, { pointerId: 3, clientX: 400, clientY: 200 })
    const second = onChange.mock.calls[1][0]

    expect(second.lng).not.toBeCloseTo(first.lng, 3)
  })

  it('zooms in and out with the mouse wheel', () => {
    mockCanvasSize()
    render(<VenueMapEditor onChange={vi.fn()} />)
    const el = canvas()

    // Raw native dispatch — wrap in act so the state update flushes before
    // the tile assertions.
    act(() => {
      el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 400, clientY: 200, deltaY: -100 }))
    })
    expect(tileSrcs().some((src) => src.startsWith('https://tile.openstreetmap.org/13/'))).toBe(true)

    act(() => {
      el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 400, clientY: 200, deltaY: 100 }))
    })
    expect(tileSrcs().some((src) => src.startsWith('https://tile.openstreetmap.org/12/'))).toBe(true)
  })

  it('ignores small trackpad wheel deltas until they add up to a step', () => {
    mockCanvasSize()
    render(<VenueMapEditor onChange={vi.fn()} />)
    const el = canvas()

    act(() => {
      for (let i = 0; i < 3; i += 1) {
        el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 400, clientY: 200, deltaY: -20 }))
      }
    })
    expect(tileSrcs().every((src) => src.startsWith('https://tile.openstreetmap.org/12/'))).toBe(true)
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

  it('hides the built-in search box when the parent form provides its own', () => {
    mockCanvasSize()
    render(<VenueMapEditor searchable={false} onChange={vi.fn()} />)
    expect(screen.queryByRole('searchbox')).toBeNull()
    // The map itself is still fully usable.
    expect(screen.getByRole('application', { name: /venue map/i })).toBeInTheDocument()
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

// The ride-hailing picker behaviour: the map follows the pin, not the other
// way round. A parent harness owns the pin the way Events.jsx does.
function PinHarness({ onChange }) {
  const [pin, setPin] = useState({ lat: -26.2041, lng: 28.0473 })
  return (
    <VenueMapEditor
      latitude={pin.lat}
      longitude={pin.lng}
      onChange={(next) => {
        onChange(next)
        if (next.lat !== null && next.lng !== null) setPin(next)
      }}
    />
  )
}

describe('VenueMapEditor (view follows the pin)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', 'pk.test.123')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [] }),
    }))
  })

  it('centres the map when the parent moves the pin (form autocomplete pick)', () => {
    mockCanvasSize()
    const { rerender } = render(
      <VenueMapEditor latitude={-26.2041} longitude={28.0473} onChange={vi.fn()} />
    )

    // Choosing an address in the form's Location field updates the pin props
    // from outside the editor — the view must jump to the chosen spot.
    rerender(<VenueMapEditor latitude={-26.1926} longitude={28.0305} onChange={vi.fn()} />)

    const pin = document.querySelector('.venue-map-editor-pin')
    expect(pin.style.left).toBe('400px')
    expect(pin.style.top).toBe('200px')
  })

  it('the map follows the pin while it is dragged (Uber-style)', () => {
    mockCanvasSize()
    const onChange = vi.fn()
    render(<PinHarness onChange={onChange} />)

    const el = canvas()
    // Grab the pin at the canvas centre and drag it east in two moves.
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 400, clientY: 200 })
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 412, clientY: 200 })
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 424, clientY: 200 })
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 424, clientY: 200 })

    // The pin ends centred — the map moved under it, not the other way
    // round — and the pin itself travelled east.
    const pin = document.querySelector('.venue-map-editor-pin')
    expect(pin.style.left).toBe('400px')
    expect(pin.style.top).toBe('200px')
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    expect(last.lng).toBeGreaterThan(28.0473)
  })

  it('click-to-place still drops the pin without yanking the view', () => {
    mockCanvasSize()
    const onChange = vi.fn()
    render(<PinHarness onChange={onChange} />)

    const el = canvas()
    // Click east of the pin; the view must NOT recenter on the new pin.
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 500, clientY: 200 })
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 500, clientY: 200 })

    const pin = document.querySelector('.venue-map-editor-pin')
    // Sub-pixel slop is the pin's coordinate rounding, not a recentered view:
    // a recenter would put the pin at the canvas centre (400px).
    expect(Math.abs(parseFloat(pin.style.left) - 500)).toBeLessThan(1)
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ lat: expect.any(Number), lng: expect.any(Number) })
    )
  })
})
