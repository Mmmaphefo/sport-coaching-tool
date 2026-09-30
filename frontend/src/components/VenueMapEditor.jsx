import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MAPBOX_MAX_ZOOM,
  forwardGeocode,
  mapboxEnabled,
  mapboxTileUrl,
  reverseGeocode,
} from '../lib/mapbox'
import './VenueMapEditor.css'

// Editable venue map — a small, dependency-free slippy map rendered on
// Mapbox's dark navigation raster tiles (the basemap family ride-hailing
// apps use) with OpenStreetMap as the fallback when no VITE_MAPBOX_TOKEN is
// configured. The coach can pin the pitch three ways:
//
//   • search an address or venue name in the box above the map,
//   • press "Use my GPS location" for a high-accuracy device fix, or
//   • click / drag directly on the map to fine-tune to ~0.1 m.
//
// `latitude`/`longitude` are the saved pin (controlled by the parent form);
// `onChange({ lat, lng })` reports a new pin, or `{ lat: null, lng: null }`
// when it is cleared. `onAddress(address)` offers the place name of an
// address the coach explicitly picked from search, so the parent can fill
// its location text field — it is never called for a name the coach typed.

const TILE_SIZE = 256
const MIN_ZOOM = 3
const OSM_MAX_ZOOM = 18
// Johannesburg city centre — a sensible opening view before anything is pinned.
const DEFAULT_CENTER = { lat: -26.2041, lng: 28.0473 }
// Treat a pointer press that barely moves as a click (place/move the pin)
// rather than a pan gesture.
const CLICK_SLOP_PX = 4
const PIN_GRAB_PX = 16
// Keystroke debounce for address search, and post-drag settle time before
// asking Mapbox what the pin is near (a drag fires onChange continuously —
// only the resting position is worth a request).
const SEARCH_DEBOUNCE_MS = 350
const REVERSE_DEBOUNCE_MS = 600
// Uber-grade GPS: high accuracy, no cached fix, generous indoor timeout.
const GPS_OPTIONS = { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }

function clampLat(lat) {
  return Math.max(-85.0511, Math.min(85.0511, lat))
}

// Web-Mercator world pixel coordinates for a lat/lng at a given zoom.
function project(lat, lng, zoom) {
  const scale = TILE_SIZE * 2 ** zoom
  const sin = Math.sin((clampLat(lat) * Math.PI) / 180)
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  }
}

function unproject(x, y, zoom) {
  const scale = TILE_SIZE * 2 ** zoom
  const n = Math.PI - (2 * Math.PI * y) / scale
  return {
    lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
    lng: (x / scale) * 360 - 180,
  }
}

function toCoord(value) {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function round6(value) {
  return Number(value.toFixed(6))
}

export default function VenueMapEditor({ latitude, longitude, label, onChange, onAddress }) {
  const pinLat = toCoord(latitude)
  const pinLng = toCoord(longitude)
  const hasPin = pinLat !== null && pinLng !== null
  const usingMapbox = mapboxEnabled()
  const maxZoom = usingMapbox ? MAPBOX_MAX_ZOOM : OSM_MAX_ZOOM

  const [center, setCenter] = useState(() => (hasPin ? { lat: pinLat, lng: pinLng } : DEFAULT_CENTER))
  const [zoom, setZoom] = useState(hasPin ? 15 : 12)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hint, setHint] = useState('')
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [address, setAddress] = useState('')
  const [gpsAccuracy, setGpsAccuracy] = useState(null)
  const [copied, setCopied] = useState(false)

  const containerRef = useRef(null)
  const dragRef = useRef(null)
  // The place name this editor last wrote into the parent's location field —
  // used to recognise "the coach only has our own autofill there" so a second
  // pick can replace it, while never clobbering a hand-typed venue name.
  const lastAutoFillRef = useRef('')
  const lastReverseRef = useRef('')

  // The canvas is fluid — measure it so the tiles can cover it exactly.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    let observer = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure)
      observer.observe(el)
    }
    window.addEventListener('resize', measure)
    return () => {
      if (observer) observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // Address search — debounced, aborted when the query changes mid-flight,
  // biased towards the current view via `proximity`.
  useEffect(() => {
    if (!usingMapbox) return
    const query = search.trim()
    if (query.length < 3) {
      setResults([])
      setSearchError('')
      setSearching(false)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setSearching(true)
      setSearchError('')
      try {
        const found = await forwardGeocode(query, {
          proximity: hasPin ? { lat: pinLat, lng: pinLng } : center,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        setResults(found)
      } catch (err) {
        if (err.name === 'AbortError' || controller.signal.aborted) return
        setResults([])
        setSearchError('Address search is unavailable — try again in a moment.')
      } finally {
        if (!controller.signal.aborted) setSearching(false)
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [search, usingMapbox, hasPin, pinLat, pinLng, center])

  // Reverse geocode the resting pin so a bare coordinate can be checked
  // against a real place name. Skipped in the OSM fallback and for pins we
  // already have an address for (e.g. one chosen from search results).
  useEffect(() => {
    if (!usingMapbox || !hasPin) {
      setAddress('')
      lastReverseRef.current = ''
      return
    }
    const key = `${pinLat.toFixed(6)},${pinLng.toFixed(6)}`
    if (key === lastReverseRef.current) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const found = await reverseGeocode(pinLat, pinLng, { signal: controller.signal })
        if (controller.signal.aborted) return
        lastReverseRef.current = key
        setAddress(found || '')
      } catch {
        // The address line is a nicety, not a feature gate — stay quiet.
      }
    }, REVERSE_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [usingMapbox, hasPin, pinLat, pinLng])

  const centerPx = project(center.lat, center.lng, zoom)
  const originX = centerPx.x - size.w / 2
  const originY = centerPx.y - size.h / 2

  const tiles = useMemo(() => {
    if (!size.w || !size.h) return []
    const tileCount = 2 ** zoom
    const minTX = Math.floor(originX / TILE_SIZE)
    const maxTX = Math.floor((originX + size.w) / TILE_SIZE)
    const minTY = Math.max(0, Math.floor(originY / TILE_SIZE))
    const maxTY = Math.min(tileCount - 1, Math.floor((originY + size.h) / TILE_SIZE))
    const out = []
    for (let tx = minTX; tx <= maxTX; tx++) {
      const wrappedX = ((tx % tileCount) + tileCount) % tileCount
      for (let ty = minTY; ty <= maxTY; ty++) {
        out.push({
          key: `${zoom}/${wrappedX}/${ty}@${tx}`,
          url: usingMapbox
            ? mapboxTileUrl(zoom, wrappedX, ty)
            : `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${ty}.png`,
          left: tx * TILE_SIZE - originX,
          top: ty * TILE_SIZE - originY,
        })
      }
    }
    return out
  }, [originX, originY, size, zoom, usingMapbox])

  const pinScreen = hasPin
    ? (() => {
        const px = project(pinLat, pinLng, zoom)
        return { x: px.x - originX, y: px.y - originY }
      })()
    : null

  function placePinAt(clientX, clientY) {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const point = unproject(originX + (clientX - rect.left), originY + (clientY - rect.top), zoom)
    // Manual placement invalidates the GPS accuracy reading — the pin is no
    // longer exactly where the device said it was.
    setGpsAccuracy(null)
    onChange({ lat: round6(point.lat), lng: round6(point.lng) })
  }

  function handlePointerDown(e) {
    if (e.button !== undefined && e.button > 0) return
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const onPin = pinScreen
      && Math.hypot(e.clientX - rect.left - pinScreen.x, e.clientY - rect.top - pinScreen.y) <= PIN_GRAB_PX
    dragRef.current = {
      pointerId: e.pointerId,
      mode: onPin ? 'pin' : 'pan',
      startX: e.clientX,
      startY: e.clientY,
      moved: 0,
      originX,
      originY,
    }
    if (e.currentTarget.setPointerCapture) {
      e.currentTarget.setPointerCapture(e.pointerId)
    }
  }

  function handlePointerMove(e) {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    drag.moved = Math.max(drag.moved, Math.hypot(dx, dy))

    if (drag.mode === 'pin') {
      if (drag.moved >= CLICK_SLOP_PX) placePinAt(e.clientX, e.clientY)
      return
    }
    if (drag.moved < CLICK_SLOP_PX) return
    const next = unproject(drag.originX - dx, drag.originY - dy, zoom)
    setCenter({ lat: clampLat(next.lat), lng: next.lng })
  }

  function handlePointerUp(e) {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    if (e.currentTarget.releasePointerCapture && drag.pointerId !== undefined) {
      try {
        e.currentTarget.releasePointerCapture(drag.pointerId)
      } catch {
        // The pointer may already have been released — nothing to do.
      }
    }
    if (drag.mode === 'pan' && drag.moved < CLICK_SLOP_PX) {
      placePinAt(e.clientX, e.clientY)
    }
  }

  function useMyGpsLocation() {
    if (!navigator.geolocation) {
      setHint('GPS is not available in this browser — search the address or click the map instead.')
      return
    }
    setHint('Getting a precise GPS fix…')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = {
          lat: round6(pos.coords.latitude),
          lng: round6(pos.coords.longitude),
        }
        setCenter(next)
        setZoom((z) => Math.max(z, 17))
        setGpsAccuracy(Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null)
        setHint('')
        onChange(next)
      },
      () => setHint('Could not read your location — search the address or click the map instead.'),
      GPS_OPTIONS
    )
  }

  function applySearchResult(result) {
    const next = { lat: round6(result.lat), lng: round6(result.lng) }
    setCenter(next)
    setZoom((z) => Math.max(z, 15))
    setSearch('')
    setResults([])
    setSearchError('')
    setGpsAccuracy(null)
    setAddress(result.name || '')
    lastReverseRef.current = `${next.lat.toFixed(6)},${next.lng.toFixed(6)}`
    onChange(next)
    // Offer the picked place to the parent's location field, but never
    // overwrite a venue name the coach typed themselves.
    const current = (label || '').trim()
    if (onAddress && (!current || current === lastAutoFillRef.current)) {
      lastAutoFillRef.current = result.name
      onAddress(result.name)
    }
  }

  async function copyCoords() {
    if (!hasPin || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(`${pinLat.toFixed(6)}, ${pinLng.toFixed(6)}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setHint('Could not copy — select the coordinates text instead.')
    }
  }

  function handleSearchKeyDown(e) {
    if (e.key === 'Escape') {
      setSearch('')
      setResults([])
      return
    }
    if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault()
      applySearchResult(results[0])
    }
  }

  return (
    <div className="venue-map-editor">
      {usingMapbox && (
        <div className="venue-map-editor-search" role="search">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Find the venue — search an address or place"
            aria-label="Search for a venue by address"
          />
          {searching && <span className="venue-map-editor-search-status">Searching…</span>}
          {results.length > 0 && (
            <ul className="venue-map-editor-results" aria-label="Address search results">
              {results.map((result) => (
                <li key={`${result.lat},${result.lng}`}>
                  <button type="button" onClick={() => applySearchResult(result)}>
                    {result.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searchError && <p className="venue-map-editor-search-error">{searchError}</p>}
        </div>
      )}

      <div
        ref={containerRef}
        className="venue-map-editor-canvas"
        role="application"
        aria-label="Venue map — click to place the pitch pin"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {tiles.map((tile) => (
          <img
            key={tile.key}
            className="venue-map-editor-tile"
            src={tile.url}
            alt=""
            draggable={false}
            style={{ left: `${tile.left}px`, top: `${tile.top}px` }}
          />
        ))}
        {pinScreen && (
          <span
            className="venue-map-editor-pin"
            style={{ left: `${pinScreen.x}px`, top: `${pinScreen.y}px` }}
            title={label || 'Pinned pitch'}
          />
        )}
        {!size.w && <span className="venue-map-editor-placeholder">Loading map…</span>}
        {usingMapbox ? (
          <span className="venue-map-editor-attribution venue-map-editor-attribution-multi">
            <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noreferrer">© Mapbox</a>
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
          </span>
        ) : (
          <a
            className="venue-map-editor-attribution"
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            © OpenStreetMap contributors
          </a>
        )}
      </div>

      <div className="venue-map-editor-controls">
        <button
          type="button"
          className="venue-map-editor-btn"
          aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.min(maxZoom, z + 1))}
        >
          +
        </button>
        <button
          type="button"
          className="venue-map-editor-btn"
          aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 1))}
        >
          −
        </button>
        <button type="button" className="venue-map-editor-btn venue-map-editor-btn-wide" onClick={useMyGpsLocation}>
          Use my GPS location
        </button>
        {hasPin && (
          <button
            type="button"
            className="venue-map-editor-btn venue-map-editor-btn-wide"
            onClick={copyCoords}
          >
            {copied ? 'Copied ✓' : 'Copy coordinates'}
          </button>
        )}
        {hasPin && (
          <button
            type="button"
            className="venue-map-editor-btn venue-map-editor-btn-wide"
            onClick={() => onChange({ lat: null, lng: null })}
          >
            Clear pin
          </button>
        )}
      </div>

      <p className="venue-map-editor-hint">
        {hasPin
          ? `Pinned at ${pinLat.toFixed(6)}, ${pinLng.toFixed(6)} — drag the pin or click the map to fine-tune.`
          : usingMapbox
            ? 'Search an address above, use GPS, or click the map to pin the pitch.'
            : 'Click the map to pin the pitch. Drag to pan, + / − to zoom.'}
        {gpsAccuracy !== null ? ` GPS fix ±${Math.round(gpsAccuracy)} m.` : ''}
        {hint ? ` ${hint}` : ''}
      </p>
      {address && <p className="venue-map-editor-address">{address}</p>}
    </div>
  )
}
