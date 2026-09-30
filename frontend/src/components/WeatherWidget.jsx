import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { apiRequest } from '../lib/api'
import { mapboxEnabled, mapboxStaticUrl } from '../lib/mapbox'
import Loader from './Loader'
import './WeatherWidget.css'

// US18 — Venue Weather Forecast.
// `location` is a free-text venue string (from the event's `location`
// field, or whatever the coach has typed so far in the create form).
// `latitude`/`longitude` are the optional map pin from the venue editor —
// when present the forecast centres on the exact pitch instead of
// re-geocoding the place name.
// `compact` renders a smaller inline version for use inside a form,
// versus the fuller card used on the event detail page.
function toCoord(value) {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

export default function WeatherWidget({ location, latitude, longitude, compact = false }) {
  const { getToken } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const debounceRef = useRef(null)

  const lat = toCoord(latitude)
  const lng = toCoord(longitude)
  const hasPin = lat !== null && lng !== null

  useEffect(() => {
    const trimmed = (location || '').trim()

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    if (!trimmed && !hasPin) {
      setData(null)
      setError('')
      setLoading(false)
      return
    }

    // Debounced so a form preview doesn't fire a request on every keystroke.
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams()
        if (trimmed) params.set('location', trimmed)
        if (hasPin) {
          params.set('lat', String(lat))
          params.set('lng', String(lng))
        }
        const result = await apiRequest(`/api/weather?${params.toString()}`, {
          getToken,
        })
        setData(result)
      } catch (err) {
        setError(err.message)
        setData(null)
      } finally {
        setLoading(false)
      }
    }, 500)

    return () => clearTimeout(debounceRef.current)
  }, [location, lat, lng, hasPin, getToken])

  if (!(location || '').trim() && !hasPin) {
    return null
  }

  if (loading) {
    return (
      <div className={`weather-widget${compact ? ' weather-widget-compact' : ''}`}>
        <Loader inline size="sm" label="Loading weather..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className={`weather-widget weather-widget-error${compact ? ' weather-widget-compact' : ''}`}>
        Couldn't load weather: {error}
      </div>
    )
  }

  if (!data || !data.current) {
    return null
  }

  return (
    <div className={`weather-widget${compact ? ' weather-widget-compact' : ''}`}>
      <div className="weather-widget-current">
        <span className="weather-widget-icon">{data.current.icon}</span>
        <div>
          <span className="weather-widget-temp">{Math.round(data.current.temperatureC)}°C</span>
          <span className="weather-widget-desc">{data.current.description}</span>
        </div>
        <span className="weather-widget-location">{data.resolvedLocation}</span>
      </div>

      {!compact && data.daily && data.daily.length > 0 && (
        <div className="weather-widget-daily">
          {data.daily.map((day) => (
            <div key={day.date} className="weather-widget-day">
              <span className="weather-widget-day-date">
                {new Date(day.date).toLocaleDateString(undefined, { weekday: 'short' })}
              </span>
              <span className="weather-widget-day-icon">{day.icon}</span>
              <span className="weather-widget-day-temps">
                {Math.round(day.maxC)}° / {Math.round(day.minC)}°
              </span>
            </div>
          ))}
        </div>
      )}

      {!compact && data.latitude && data.longitude && (
        <VenueMap latitude={data.latitude} longitude={data.longitude} label={data.resolvedLocation} />
      )}
    </div>
  )
}

// Small embedded venue map, centred on the coordinates the weather lookup
// already resolved above (no extra geocoding request). With a Mapbox token
// configured it renders a static image on the same dark navigation basemap
// as the venue editor — one GET, no interactivity, no API cost beyond a
// single map load. Without a token it falls back to OpenStreetMap's free
// public embed.
function VenueMap({ latitude, longitude, label }) {
  if (mapboxEnabled()) {
    const src = mapboxStaticUrl({ latitude, longitude, width: 640, height: 360, zoom: 15 })
    // A plain deep link — no Google API involved — because "open this pin in
    // the maps app on my phone" is what coaches actually do with it.
    const largeMapUrl = `https://www.google.com/maps?q=${latitude},${longitude}`
    return (
      <div className="weather-widget-map">
        <img
          className="weather-widget-map-img"
          src={src}
          alt={`Map of ${label || 'venue'}`}
          loading="lazy"
        />
        <a href={largeMapUrl} target="_blank" rel="noreferrer" className="weather-widget-map-link">
          View larger map
        </a>
      </div>
    )
  }

  const delta = 0.01
  const bbox = [
    longitude - delta, latitude - delta,
    longitude + delta, latitude + delta,
  ].join('%2C')
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude}%2C${longitude}`
  const largeMapUrl = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=15/${latitude}/${longitude}`

  return (
    <div className="weather-widget-map">
      <iframe
        title={`Map of ${label || 'venue'}`}
        src={src}
        loading="lazy"
        style={{ border: 0, width: '100%', height: '180px', borderRadius: '8px' }}
      />
      <a href={largeMapUrl} target="_blank" rel="noreferrer" className="weather-widget-map-link">
        View larger map
      </a>
    </div>
  )
}
