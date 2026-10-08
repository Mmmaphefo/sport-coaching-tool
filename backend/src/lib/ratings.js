// Player ratings for the match simulator.
//
// The simulator needs an "overall" for every player who can take part, so it
// can weight the simulated odds by how good each side actually is. Real
// professionals get their EA/FIFA-style overall from a public player dataset
// exposed by the Hugging Face datasets-server (no API key required); anyone
// the dataset does not know about falls back to a deterministic estimate
// derived from the position they play, kept between 70 and 85 overall.
//
// Every name is looked up at most once ever: hits are cached in the
// `player_ratings` table forever, estimates are cached for
// ESTIMATE_RECHECK_DAYS and re-checked afterwards (a player may be added to
// the dataset later). If the API is unreachable the run still completes on
// estimates and nothing is cached, so a transient outage never downgrades a
// real player permanently.

// Dataset: "FIFA 21 complete player data" — one row per player with name,
// position and overall. Both the dataset and the API base can be pointed at
// a newer EA FC release through environment variables without touching code.
const DEFAULT_API_BASE = 'https://datasets-server.huggingface.co';
const DEFAULT_DATASET = 'jason1966/aayushmishra1512_fifa-2021-complete-player-data';
const DEFAULT_DATASET_CONFIG = 'default';
const DEFAULT_DATASET_SPLIT = 'train';

const REQUEST_TIMEOUT_MS = 6000;
// A cold query on the public dataset server regularly outlives the first
// deadline, so one retry is allowed to wait longer before the player is
// treated as unknown. It is capped: a query the server never answers (a name
// the dataset simply does not carry) must not hold a simulation open.
const RETRY_TIMEOUT_MS = 12000;
const MAX_PARALLEL_LOOKUPS = 4;
const ESTIMATE_RECHECK_DAYS = 30;
const ROWS_PER_QUERY = 10;

// Fallbacks are estimated from the position, always inside this band.
const ESTIMATE_MIN = 70;
const ESTIMATE_MAX = 85;

// Position groups the estimator and the simulator both reason about.
const GROUP_BASE_RATING = {
  GK: 74,
  CB: 75,
  FB: 75,
  DM: 76,
  CM: 76,
  AM: 78,
  W: 78,
  ST: 79,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Lowercased, accent-stripped, punctuation-free form used as the cache key
// and as the basis for comparing a dataset row against the athlete's name.
function normalizeName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Maps a free-text position ("ST", "Left Back", "goalkeeper", "CM/CDM") onto
// one of the groups above. Anything unrecognised lands in the midfield band.
function positionGroup(position) {
  const value = String(position || '').toLowerCase();
  if (!value) return 'CM';
  if (/goalkeeper|\bk\b|keeper|\bgk\b/.test(value)) return 'GK';
  if (/sweeper|centre.?back|center.?back|centre half|\bcb\b|\bdef/.test(value)) return 'CB';
  if (/wing.?back|\bwb\b|left.?back|right.?back|full.?back|\blb\b|\brb\b/.test(value)) return 'FB';
  if (/defensive.?mid|\bcdm\b|\bdm\b|holding/.test(value)) return 'DM';
  if (/attacking.?mid|\bcam\b|\bam\b|playmaker|number 10/.test(value)) return 'AM';
  if (/left.?mid|right.?mid|\blm\b|\brm\b|\bmid/.test(value)) return 'CM';
  if (/winger|left.?wing|right.?wing|\blw\b|\brw\b|\bwing/.test(value)) return 'W';
  if (/striker|centre.?forward|center.?forward|forward|\bst\b|\bcf\b|\bss\b|\bfw\b/.test(value)) return 'ST';
  return 'CM';
}

// Stable string hash (djb2) so the same player always gets the same
// estimate while different players spread across the 70-85 band.
function hashString(value) {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function estimateRating(name, position) {
  const group = positionGroup(position);
  const base = GROUP_BASE_RATING[group] || GROUP_BASE_RATING.CM;
  const spread = ESTIMATE_MAX - ESTIMATE_MIN; // 15
  const jitter = (hashString(`${normalizeName(name)}|${group}`) % (spread + 1)) - Math.floor(spread / 2);
  return {
    overall: clamp(base + jitter, ESTIMATE_MIN, ESTIMATE_MAX),
    position: position || null,
    source: 'estimated',
  };
}

// The datasets-server serialises single-column datasets as
// { "name;position;overall": "Lionel Messi;RW;94" }. Dataset swaps are cheap
// (env vars), so rebuild a proper record either way: split the header/value
// pair when both look delimited, otherwise use the plain column names.
function rowToRecord(row) {
  const record = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (typeof value !== 'string' || !key.includes(';') || !value.includes(';')) {
      record[String(key).trim().toLowerCase()] = value;
      continue;
    }
    const headers = key.split(';');
    const cells = value.split(';');
    headers.forEach((header, index) => {
      record[header.trim().toLowerCase()] = (cells[index] ?? '').trim();
    });
  }
  return record;
}

function readOverall(record) {
  const raw = record.overall ?? record.rating ?? record.ovr;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? clamp(value, 1, 99) : null;
}

// One search request under its own deadline. The AbortController turns a slow
// lookup into a plain AbortError, which is what lets the caller tell a slow
// dataset server apart from an unreachable one.
async function searchDataset({ apiBase, params, fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${apiBase}/search?${params.toString()}`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Ratings dataset responded with ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

// Looks one player up in the dataset. Returns { overall, position, source }
// or null when the dataset has no row for that exact name.
async function fetchDatasetRating(name, options = {}) {
  const apiBase = options.apiBase || process.env.PLAYER_RATINGS_API_BASE || DEFAULT_API_BASE;
  const dataset = options.dataset || process.env.PLAYER_RATINGS_DATASET || DEFAULT_DATASET;
  const config = options.config || process.env.PLAYER_RATINGS_DATASET_CONFIG || DEFAULT_DATASET_CONFIG;
  const split = options.split || process.env.PLAYER_RATINGS_DATASET_SPLIT || DEFAULT_DATASET_SPLIT;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs || REQUEST_TIMEOUT_MS;

  const params = new URLSearchParams({
    dataset,
    config,
    split,
    query: name,
    offset: '0',
    length: String(ROWS_PER_QUERY),
  });

  // The public dataset server is slow to answer a query it has not served
  // before, so a first timeout gets one more, longer, attempt before the
  // player is treated as unknown. Anything else — a DNS failure, a 5xx — is
  // left to the caller's circuit breaker: retrying a real outage would only
  // cost the coach more waiting for the same estimate.
  let payload = null;
  let failure = null;
  for (const deadline of [timeoutMs, RETRY_TIMEOUT_MS]) {
    try {
      payload = await searchDataset({ apiBase, params, fetchImpl, timeoutMs: deadline });
      failure = null;
      break;
    } catch (err) {
      failure = err;
      if (err.name !== 'AbortError' && err.name !== 'TimeoutError') break;
    }
  }
  if (failure) throw failure;

  const wanted = normalizeName(name);
  const match = (payload.rows || [])
    .map((entry) => rowToRecord(entry.row))
    .find((record) => readOverall(record) != null && normalizeName(record.name) === wanted);
  if (!match) return null;
  return {
    overall: readOverall(match),
    position: match.position || null,
    source: 'dataset',
  };
}

async function upsertRating(pool, nameNormalized, displayName, rating) {
  await pool.query(
    `INSERT INTO player_ratings (name_normalized, display_name, overall, position, source, checked_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (name_normalized) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           overall = EXCLUDED.overall,
           position = EXCLUDED.position,
           source = EXCLUDED.source,
           checked_at = now(),
           updated_at = now()`,
    [nameNormalized, displayName || null, rating.overall, rating.position || null, rating.source]
  );
}

function isCacheFresh(row) {
  if (!row) return false;
  // A real dataset hit never changes; an estimate is re-checked after a while
  // in case the player has since been added to the dataset.
  if (row.source === 'dataset') return true;
  const checkedAt = new Date(row.checked_at).getTime();
  return Number.isFinite(checkedAt) && Date.now() - checkedAt < ESTIMATE_RECHECK_DAYS * 86400000;
}

async function mapWithConcurrency(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

// Resolves a rating for every athlete passed in, hitting the external dataset
// only for names that are missing (or stale) in the cache.
// `athletes` items: { id, name, position }.
// Returns a Map of athlete id -> { overall, position, source }.
async function ensureRatings(pool, athletes, options = {}) {
  const ratings = new Map();
  const wanted = new Map(); // normalized name -> { name, position }
  for (const athlete of athletes || []) {
    if (!athlete || !athlete.name) continue;
    const key = normalizeName(athlete.name);
    if (!key || wanted.has(key)) continue;
    wanted.set(key, { name: athlete.name, position: athlete.position });
  }
  if (wanted.size === 0) return ratings;

  const keys = [...wanted.keys()];
  const cached = await pool.query(
    `SELECT name_normalized, overall, position, source, checked_at
     FROM player_ratings WHERE name_normalized = ANY($1)`,
    [keys]
  );
  const cacheByName = new Map(cached.rows.map((row) => [row.name_normalized, row]));

  const resolved = new Map();
  const misses = [];
  for (const [key, entry] of wanted) {
    const row = cacheByName.get(key);
    if (isCacheFresh(row)) {
      resolved.set(key, { overall: row.overall, position: row.position, source: row.source });
    } else {
      misses.push({ key, ...entry });
    }
  }

  // One outage should not cost one timeout per player: the first network
  // failure flips this flag and the remaining names fall back immediately.
  let providerDown = false;
  await mapWithConcurrency(misses, MAX_PARALLEL_LOOKUPS, async (miss) => {
    if (providerDown) {
      resolved.set(miss.key, estimateRating(miss.name, miss.position));
      return;
    }
    try {
      const hit = await fetchDatasetRating(miss.name, options);
      const rating = hit || estimateRating(miss.name, miss.position);
      resolved.set(miss.key, rating);
      await upsertRating(pool, miss.key, miss.name, rating);
    } catch {
      providerDown = true;
      resolved.set(miss.key, estimateRating(miss.name, miss.position));
    }
  });

  for (const athlete of athletes || []) {
    if (!athlete || !athlete.name) continue;
    const rating = resolved.get(normalizeName(athlete.name));
    if (rating) ratings.set(athlete.id, rating);
  }
  return ratings;
}

// Attaches an athlete's overall to a lineup row so the simulator can weigh
// events by ability. Rows without a rating default to an average pro.
function withRating(row, ratings) {
  return {
    athlete_id: row.athlete_id,
    name: row.name,
    position: row.position,
    rating: ratings.get(row.athlete_id)?.overall ?? 75,
  };
}

// Splits a side's lineup rows into the shape the simulator expects.
function squadFromRows(rows, ratings) {
  return {
    starters: rows.filter((row) => row.is_starter).map((row) => withRating(row, ratings)),
    bench: rows.filter((row) => !row.is_starter).map((row) => withRating(row, ratings)),
  };
}

// Map -> plain object so the client can show where each rating came from.
function ratingsPayload(ratings) {
  const payload = {};
  for (const [athleteId, rating] of ratings) {
    payload[athleteId] = rating;
  }
  return payload;
}

module.exports = {
  ESTIMATE_MIN,
  ESTIMATE_MAX,
  normalizeName,
  positionGroup,
  estimateRating,
  fetchDatasetRating,
  ensureRatings,
  withRating,
  squadFromRows,
  ratingsPayload,
};
