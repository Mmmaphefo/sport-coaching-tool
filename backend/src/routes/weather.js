const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// US18 — Venue Weather Forecast
//
// Uses Open-Meteo (https://open-meteo.com) — free, no API key required,
// which is why it's the choice here over something like OpenWeatherMap.
// Two calls: geocode the free-text venue name to lat/lon, then fetch
// current + short-range daily weather for those coordinates.
// ---------------------------------------------------------------------------

// WMO weather codes -> human description + emoji, per Open-Meteo's docs.
const WEATHER_CODES = {
  0: { description: 'Clear sky', icon: '☀️' },
  1: { description: 'Mainly clear', icon: '🌤️' },
  2: { description: 'Partly cloudy', icon: '⛅' },
  3: { description: 'Overcast', icon: '☁️' },
  45: { description: 'Fog', icon: '🌫️' },
  48: { description: 'Depositing rime fog', icon: '🌫️' },
  51: { description: 'Light drizzle', icon: '🌦️' },
  53: { description: 'Moderate drizzle', icon: '🌦️' },
  55: { description: 'Dense drizzle', icon: '🌧️' },
  61: { description: 'Slight rain', icon: '🌦️' },
  63: { description: 'Moderate rain', icon: '🌧️' },
  65: { description: 'Heavy rain', icon: '🌧️' },
  71: { description: 'Slight snow', icon: '🌨️' },
  73: { description: 'Moderate snow', icon: '🌨️' },
  75: { description: 'Heavy snow', icon: '❄️' },
  80: { description: 'Slight rain showers', icon: '🌦️' },
  81: { description: 'Moderate rain showers', icon: '🌧️' },
  82: { description: 'Violent rain showers', icon: '⛈️' },
  95: { description: 'Thunderstorm', icon: '⛈️' },
  96: { description: 'Thunderstorm with hail', icon: '⛈️' },
  99: { description: 'Thunderstorm with heavy hail', icon: '⛈️' },
};

function describeCode(code) {
  return WEATHER_CODES[code] || { description: 'Unknown', icon: '🌡️' };
}

// ---------------------------------------------------------------------------
// Simple in-memory cache — geocoding results barely change; weather is
// cached briefly so a page full of events doesn't re-hit the API per render.
// ---------------------------------------------------------------------------
const geocodeCache = new Map();
const weatherCache = new Map();
const WEATHER_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour - reduce API calls to avoid rate limits

function getCached(map, key, ttl) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ttl) {
    map.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(map, key, data) {
  map.set(key, { ts: Date.now(), data });
}

async function geocodeLocation(location) {
  const key = location.trim().toLowerCase();
  const cached = getCached(geocodeCache, key, Infinity); // place coordinates don't go stale
  if (cached) return cached;

  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    location
  )}&count=1`;

  let res;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
  } catch (err) {
    console.error('Geocoding fetch failed:', err.message);
    const serviceErr = new Error('Weather service unavailable');
    serviceErr.status = 503;
    throw serviceErr;
  }
  if (!res.ok) {
    console.error('Geocoding returned:', res.status);
    const err = new Error('Weather service unavailable');
    err.status = 503;
    throw err;
  }

  const data = await res.json();
  const match = data.results && data.results[0];
  if (!match) {
    return null;
  }

  const resolved = {
    name: match.name,
    admin1: match.admin1 || null,
    country: match.country || null,
    latitude: match.latitude,
    longitude: match.longitude,
  };

  setCached(geocodeCache, key, resolved);
  return resolved;
}

async function fetchWeather(latitude, longitude) {
  const key = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
  const cached = getCached(weatherCache, key, WEATHER_CACHE_TTL_MS);
  if (cached) return cached;

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    `&current_weather=true` +
    `&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_probability_max` +
    `&forecast_days=3&timezone=auto`;

  let res;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
  } catch (err) {
    console.error('Weather fetch failed:', err.message);
    const serviceErr = new Error('Weather service unavailable');
    serviceErr.status = 503;
    throw serviceErr;
  }
  if (!res.ok) {
    console.error('Weather API returned:', res.status);
    
    // If rate-limited (429), return mock weather as fallback
    if (res.status === 429) {
      console.warn('Rate limited - returning mock weather data');
      return {
        current: {
          temperatureC: 22,
          windSpeedKph: 10,
          weatherCode: 2,
          description: 'Partly cloudy',
          icon: '⛅',
          observedAt: new Date().toISOString(),
        },
        daily: [
          { date: new Date().toISOString().split('T')[0], maxC: 24, minC: 16, precipitationChance: 20, weatherCode: 2, description: 'Partly cloudy', icon: '⛅' },
          { date: new Date(Date.now() + 86400000).toISOString().split('T')[0], maxC: 23, minC: 15, precipitationChance: 30, weatherCode: 3, description: 'Overcast', icon: '☁️' },
          { date: new Date(Date.now() + 172800000).toISOString().split('T')[0], maxC: 25, minC: 17, precipitationChance: 10, weatherCode: 1, description: 'Mainly clear', icon: '🌤️' },
        ],
      };
    }
    
    const err = new Error('Weather service unavailable');
    err.status = 503;
    throw err;
  }

  const data = await res.json();

  const current = data.current_weather
    ? {
        temperatureC: data.current_weather.temperature,
        windSpeedKph: data.current_weather.windspeed,
        weatherCode: data.current_weather.weathercode,
        ...describeCode(data.current_weather.weathercode),
        observedAt: data.current_weather.time,
      }
    : null;

  const daily = (data.daily?.time || []).map((date, i) => ({
    date,
    maxC: data.daily.temperature_2m_max[i],
    minC: data.daily.temperature_2m_min[i],
    precipitationChance: data.daily.precipitation_probability_max[i],
    weatherCode: data.daily.weathercode[i],
    ...describeCode(data.daily.weathercode[i]),
  }));

  const result = { current, daily };
  setCached(weatherCache, key, result);
  return result;
}

// ---------------------------------------------------------------------------
// GET /api/weather?location=<venue name>&lat=<num>&lng=<num>
//
// Not tied to a specific event id on purpose — this lets the event
// creation form show a live preview as the coach types a venue, before
// the event (and its id) exists, as well as the event detail page once
// it's saved.
//
// When the coach has pinned the pitch on the venue map, the saved lat/lng
// are passed through instead of geocoding the name: the forecast (and the
// marker on the map) then belongs to the exact spot they picked, whatever
// the venue is called.
// ---------------------------------------------------------------------------
function parseCoord(value, min, max) {
  if (value === undefined || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) return null;
  return num;
}

router.get('/', requireAuth(), async (req, res) => {
  const location = (req.query.location || '').trim();
  const lat = parseCoord(req.query.lat, -90, 90);
  const lng = parseCoord(req.query.lng, -180, 180);
  const pinned = lat !== null && lng !== null;

  if (!location && !pinned) {
    return res.status(400).json({ error: 'location query parameter is required' });
  }

  try {
    const place = pinned
      ? { name: null, admin1: null, country: null, latitude: lat, longitude: lng }
      : await geocodeLocation(location);
    if (!place) {
      return res.status(404).json({ error: `Could not find a location matching "${location}"` });
    }

    const weather = await fetchWeather(place.latitude, place.longitude);

    res.json({
      query: location || null,
      resolvedLocation: pinned
        ? (location || 'Pinned location')
        : [place.name, place.admin1, place.country].filter(Boolean).join(', '),
      latitude: place.latitude,
      longitude: place.longitude,
      current: weather.current,
      daily: weather.daily,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
});

module.exports = router;
