// Mapbox integration — the commercial map stack behind the venue picker.
//
// One public access token (VITE_MAPBOX_TOKEN) unlocks three products:
//   • Static Tiles API  → the dark navigation basemap in the venue editor
//   • Geocoding API     → "find the venue by address" + reverse "what's at this pin"
//   • Static Images API → the read-only mini-map on the weather widget
// Mapbox public tokens are public by design — the same rule as Clerk's
// publishable key — so shipping one inside the Vite bundle is safe. When the
// token is missing every caller falls back to OpenStreetMap, so the map
// degrades to the previous behaviour instead of disappearing.
//
// Free tier (no credit card): ~50k map loads + ~100k geocoding requests per
// month, far beyond this project's volume.

// Mapbox's dark navigation style — the basemap family ride-hailing apps use
// at night, and a close visual match for KickStat's dark theme.
const STYLE_PATH = 'mapbox/navigation-night-v1'
const GEOCODING_BASE = 'https://api.mapbox.com/geocoding/v5/mapbox.places'

// Raster tiles for the venue editor top out two levels beyond OSM's public
// tiles, which lets a coach zoom right onto the pitch before dropping the pin.
export const MAPBOX_MAX_ZOOM = 20

export function mapboxToken() {
  return (import.meta.env.VITE_MAPBOX_TOKEN || '').trim()
}

export function mapboxEnabled() {
  return mapboxToken().length > 0
}

// One raster tile for the editor's slippy map. `@2x` asks for a 512px image
// that the CSS still displays at 256 logical pixels, so pins stay crisp on
// high-DPI phones without changing any of the map maths.
export function mapboxTileUrl(z, x, y) {
  return `https://api.mapbox.com/styles/v1/${STYLE_PATH}/tiles/${z}/${x}/${y}@2x?access_token=${mapboxToken()}`
}

// Read-only mini-map for the weather widget: a single pre-rendered image
// centred on the pin, with a Mapbox pin marker dropped on it.
export function mapboxStaticUrl({ latitude, longitude, width = 640, height = 360, zoom = 15, markerColor = 'e0564f' }) {
  const pin = encodeURIComponent(`pin-s+${markerColor}(${longitude},${latitude})`)
  return `https://api.mapbox.com/styles/v1/${STYLE_PATH}/static/${pin}/${longitude},${latitude},${zoom},0/${width}x${height}@2x?access_token=${mapboxToken()}`
}

// "Find the venue by address": turns free text into ranked candidates.
// `proximity` (the current pin or map centre) biases results to the places
// a coach is actually looking at, which is what keeps e.g. "Johannesburg"
// resolving to the South African one first.
export async function forwardGeocode(query, { proximity, signal } = {}) {
  if (!mapboxEnabled() || !query.trim()) return []
  const params = new URLSearchParams({
    access_token: mapboxToken(),
    limit: '5',
    language: 'en',
  })
  if (proximity) params.set('proximity', `${proximity.lng},${proximity.lat}`)
  const response = await fetch(`${GEOCODING_BASE}/${encodeURIComponent(query.trim())}.json?${params}`, { signal })
  if (!response.ok) {
    throw new Error(`Mapbox geocoding failed (${response.status})`)
  }
  const data = await response.json()
  return (data.features || [])
    .map((feature) => ({
      name: feature.place_name,
      lat: Array.isArray(feature.center) ? feature.center[1] : undefined,
      lng: Array.isArray(feature.center) ? feature.center[0] : undefined,
    }))
    .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng))
}

// "What's at this pin": the closest street address to a dropped pin, shown
// under the map so a coordinate can be sanity-checked against a real place.
export async function reverseGeocode(latitude, longitude, { signal } = {}) {
  if (!mapboxEnabled()) return null
  const params = new URLSearchParams({
    access_token: mapboxToken(),
    limit: '1',
    language: 'en',
  })
  const response = await fetch(`${GEOCODING_BASE}/${longitude},${latitude}.json?${params}`, { signal })
  if (!response.ok) {
    throw new Error(`Mapbox reverse geocoding failed (${response.status})`)
  }
  const data = await response.json()
  return (data.features && data.features[0] && data.features[0].place_name) || null
}
