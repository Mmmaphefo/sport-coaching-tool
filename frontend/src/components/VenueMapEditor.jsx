import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MAPBOX_MAX_ZOOM,
  mapboxEnabled,
  mapboxTileUrl,
  reverseGeocode,
} from '../lib/mapbox'
import AddressSearchInput from './AddressSearchInput'
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
//
// The view follows the pin: choose an address (the built-in search, or the
// parent form's autocomplete when `searchable={false}`), use GPS, or drag
// the pin — the map moves to keep the pin in view, the way ride-hailing
// pickers do. Click-to-place and drag-to-pan leave the view alone, and the
// mouse wheel zooms around the cursor.

const TILE_SIZE = 256
const MIN_ZOOM = 3
const OSM_MAX_ZOOM = 18
// Johannesburg city centre — a sensible opening view before anything is pinned.
const DEFAULT_CENTER = { lat: -26.2041, lng: 28.0473 }
// Treat a pointer press that barely moves as a click (place/move the pin)
// rather than a pan gesture.
const CLICK_SLOP_PX = 4
const PIN_GRAB_PX = 16
// Post-drag settle time before asking Mapbox what the pin is near (a drag
// fires onChange continuously — only the resting position is worth a
// request).
const REVERSE_DEBOUNCE_MS = 600
// Mouse-wheel zoom: accumulated scroll delta that triggers one zoom step,
// so a trackpad's many small events don't zoom too fast. Pinch-zoom events
// (ctrlKey) step one level immediately.
const WHEEL_ZOOM_STEP_DELTA = 100
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

export default function VenueMapEditor({ latitude, longitude, label, onChange, onAddress, searchable = true }) {
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
  // Which code moved the pin most recently — decides whether the view
  // follows it. 'drag' and 'external' recentre the map; 'click' leaves the
  // view alone; 'search' and 'gps' set the view themselves before
  // reporting the new pin.
  const pinSourceRef = useRef('external')
  // Latest view geometry for the native wheel listener (attached once).
  const viewRef = useRef(null)
  const wheelAccRef = useRef(0)

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

  // Mouse-wheel zoom around the cursor. Attached natively because React's
  // synthetic wheel listener is passive — preventDefault would not stop the
  // page scrolling underneath. The latest view geometry lives in viewRef,
  // updated every render below.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      const view = viewRef.current
      if (!view || !view.size.w || !view.size.h) return
      if (e.ctrlKey) {
        wheelAccRef.current = 0
      } else {
        wheelAccRef.current += e.deltaY
        if (Math.abs(wheelAccRef.current) < WHEEL_ZOOM_STEP_DELTA) return
      }
      const direction = e.deltaY < 0 ? 1 : -1
      wheelAccRef.current = 0
      const nextZoom = Math.max(MIN_ZOOM, Math.min(view.maxZoom, view.zoom + direction))
      if (nextZoom === view.zoom) return
      const rect = el.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      // Anchor the zoom on the world point under the cursor so it stays put.
      const anchor = unproject(view.originX + px, view.originY + py, view.zoom)
      const anchorPx = project(anchor.lat, anchor.lng, nextZoom)
      const next = unproject(anchorPx.x - px + view.size.w / 2, anchorPx.y - py + view.size.h / 2, nextZoom)
      setZoom(nextZoom)
      setCenter({ lat: clampLat(next.lat), lng: next.lng })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // The view follows the pin. Dragging the pin ('drag') and parent-driven
  // pin changes ('external' — e.g. an address chosen in the form's
  // autocomplete) recentre the map so the chosen spot stays in view;
  // 'click', 'search' and 'gps' already decided where the view should be.
  useEffect(() => {
    if (!hasPin) {
      pinSourceRef.current = 'external'
      return
    }
    const source = pinSourceRef.current
    pinSourceRef.current = 'external'
    if (source === 'external' || source === 'drag') {
      setCenter({ lat: pinLat, lng: pinLng })
    }
  }, [hasPin, pinLat, pinLng])

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
  // Fresh geometry for the wheel listener and the pointer handlers.
  useEffect(() => {
    viewRef.current = { zoom, originX, originY, size, maxZoom }
  })

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

  function placePinAt(clientX, clientY, source) {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const point = unproject(originX + (clientX - rect.left), originY + (clientY - rect.top), zoom)
    // Manual placement invalidates the GPS accuracy reading — the pin is no
    // longer exactly where the device said it was.
    setGpsAccuracy(null)
    pinSourceRef.current = source
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
      if (drag.moved >= CLICK_SLOP_PX) placePinAt(e.clientX, e.clientY, 'drag')
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
      placePinAt(e.clientX, e.clientY, 'click')
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
        pinSourceRef.current = 'gps'
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
    setGpsAccuracy(null)
    setAddress(result.name || '')
    lastReverseRef.current = `${next.lat.toFixed(6)},${next.lng.toFixed(6)}`
    pinSourceRef.current = 'search'
    onChange(next)
    // Offer the picked place to the parent's location field, but never
    // overwrite a venue name the coach typed themselves. (The search box
    // fills with the picked name first — clearing it here keeps the old
    // "list collapses, box empties, address shows under the map" behaviour.)
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

  return (
    <div className="venue-map-editor">
      {usingMapbox && searchable && (
        <AddressSearchInput
          value={search}
          onChange={setSearch}
          onPick={applySearchResult}
          proximity={hasPin ? { lat: pinLat, lng: pinLng } : center}
          placeholder="Find the venue — search an address or place"
          ariaLabel="Search for a venue by address"
        />
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
          ? `Pinned at ${pinLat.toFixed(6)}, ${pinLng.toFixed(6)} — drag the pin (the map follows) or click to fine-tune.`
          : usingMapbox
            ? 'Search an address above, use GPS, or click the map to pin the pitch. Drag the map to pan, scroll to zoom.'
            : 'Click the map to pin the pitch. Drag to pan, scroll or + / − to zoom.'}
        {gpsAccuracy !== null ? ` GPS fix ±${Math.round(gpsAccuracy)} m.` : ''}
        {hint ? ` ${hint}` : ''}
      </p>
      {address && <p className="venue-map-editor-address">{address}</p>}
    </div>
  )
}
