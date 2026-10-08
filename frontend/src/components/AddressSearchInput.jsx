import { useState, useEffect, useRef } from 'react'
import { forwardGeocode, mapboxEnabled } from '../lib/mapbox'
import './AddressSearchInput.css'

// Address autocomplete — the "type an address, pick from a list that refines
// as you type" box that ride-hailing apps made standard. Debounced Mapbox
// forward geocoding, keyboard navigation (ArrowUp/Down + Enter, Escape to
// close), and a proximity bias so results near the current pin or map view
// rank first.
//
// `value`/`onChange` make it a controlled text field; `onPick` fires with
// `{ name, lat, lng }` when the coach chooses a suggestion (the box text is
// also set to the picked name via onChange). Without a Mapbox token it
// degrades to a plain text input — same behaviour as typing a venue name in
// any other form field.

const SEARCH_DEBOUNCE_MS = 350
const MIN_QUERY_CHARS = 3

function GeocodingSearchInput({ value, onChange, onPick, proximity, placeholder, ariaLabel }) {
  const [results, setResults] = useState([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  // Proximity changes on every pan/pin drag — read it when the debounced
  // request fires instead of reacting to each change.
  const proximityRef = useRef(proximity)
  useEffect(() => {
    proximityRef.current = proximity
  })

  useEffect(() => {
    const query = value.trim()
    if (query.length < MIN_QUERY_CHARS) {
      setResults([])
      setActiveIndex(-1)
      setError('')
      setSearching(false)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setSearching(true)
      setError('')
      try {
        const found = await forwardGeocode(query, {
          proximity: proximityRef.current,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        setResults(found)
        setActiveIndex(found.length > 0 ? 0 : -1)
      } catch (err) {
        if (err.name === 'AbortError' || controller.signal.aborted) return
        setResults([])
        setActiveIndex(-1)
        setError('Address search is unavailable — try again in a moment.')
      } finally {
        if (!controller.signal.aborted) setSearching(false)
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [value])

  function pick(place) {
    setResults([])
    setActiveIndex(-1)
    setError('')
    // Fill the field with the chosen address, then report the pick so the
    // parent can drop the pin / recentre the map / load its weather.
    onChange(place.name)
    if (onPick) onPick(place)
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % results.length)
      return
    }
    if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1))
      return
    }
    if (e.key === 'Enter' && results.length > 0) {
      // Swallow the Enter so the surrounding form doesn't submit — choosing
      // a suggestion is the only thing Enter means while the list is open.
      e.preventDefault()
      pick(results[activeIndex >= 0 ? activeIndex : 0])
      return
    }
    if (e.key === 'Escape') {
      setResults([])
      setActiveIndex(-1)
    }
  }

  const showEmpty = !searching && value.trim().length >= MIN_QUERY_CHARS && results.length === 0 && !error

  return (
    <div className="venue-addr">
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
      {searching && <span className="venue-addr-status">Searching…</span>}
      {results.length > 0 && (
        <ul className="venue-addr-results" aria-label="Address search results">
          {results.map((result, index) => (
            <li key={`${result.lat},${result.lng}`}>
              <button
                type="button"
                className={index === activeIndex ? 'venue-addr-result-active' : ''}
                onMouseEnter={() => setActiveIndex(index)}
                // Keep focus on the input so Enter keeps working after a
                // mouse hover; the click still fires the pick.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(result)}
              >
                {result.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {showEmpty && (
        <ul className="venue-addr-results" aria-label="Address search results">
          <li className="venue-addr-none">No matching addresses — keep typing or pick on the map</li>
        </ul>
      )}
      {error && <p className="venue-addr-error">{error}</p>}
    </div>
  )
}

export default function AddressSearchInput({ value, onChange, onPick, proximity, placeholder, ariaLabel }) {
  if (!mapboxEnabled()) {
    // OSM fallback: no geocoding available, so this is a plain text field.
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
    )
  }
  return (
    <GeocodingSearchInput
      value={value}
      onChange={onChange}
      onPick={onPick}
      proximity={proximity}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
    />
  )
}
