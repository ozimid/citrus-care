// F20 — weather, pure half. URL building, response mapping, aggregation and
// cache freshness; the fetch + AsyncStorage wiring is the thin weather-io.ts
// (same pure/thin split as photo-store.ts vs photo-store-io.ts).
//
// Provider: Open-Meteo — free, no API key, no account (the reason it fits the
// local-first D-16 shape: the phone talks to it directly, no server hop, and
// nothing about the user is sent beyond a coarse ZIP centroid). Verified live
// 2026-07-15: geocoding resolves US ZIPs via `name`, and the forecast endpoint
// serves daily temperature_2m_max/min, precipitation_sum and
// relative_humidity_2m_mean with past_days for the recent-rain window.
//
// Everything here is defensive: a third-party payload is untrusted input, so
// malformed data degrades to "no weather" (base watering schedule) and never
// throws into the UI.

export const GEOCODE_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
export const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";

export const WEATHER_CACHE_STORAGE_KEY = "citrus.weather-cache.v1";

/** 6h TTL: weather moves slowly enough, and this keeps a plants-list render
 * from fanning out network calls. */
export const WEATHER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Past days requested — the "heavy rain in the last 24-48h" rule needs them. */
const PAST_DAYS = 2;
const FORECAST_DAYS = 7;

export interface Coordinates {
  latitude: number;
  longitude: number;
  /** Resolved place name, for the "Beverly Hills" hint under the card. */
  label: string;
}

export interface DailyWeather {
  /** Local calendar day at the plant's location, "YYYY-MM-DD". */
  date: string;
  tempMaxC: number;
  tempMinC: number;
  precipMm: number;
  /** Daily mean RH %, or null when the series wasn't returned. */
  humidity: number | null;
}

export interface WeatherSummary {
  /** Hottest day AHEAD — what the watering interval should react to. */
  maxTempC: number;
  minTempC: number;
  /** Rain over the last 24-48h (yesterday + today). */
  recentPrecipMm: number;
  meanHumidity: number | null;
}

/** No ZIP → no weather; the feature is simply unavailable for that plant. */
export function normalizeZip(zip: string | null | undefined): string | null {
  if (typeof zip !== "string") return null;
  const trimmed = zip.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildGeocodeUrl(zip: string): string {
  const params = new URLSearchParams({
    name: zip,
    count: "1",
    language: "en",
    format: "json",
  });
  return `${GEOCODE_ENDPOINT}?${params.toString()}`;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** First geocoding hit → coordinates. Unknown ZIP / malformed body → null. */
export function parseGeocodeResponse(raw: unknown): Coordinates | null {
  if (typeof raw !== "object" || raw === null) return null;
  const results = (raw as { results?: unknown }).results;
  if (!Array.isArray(results) || results.length === 0) return null;
  const first = results[0];
  if (typeof first !== "object" || first === null) return null;
  const r = first as Record<string, unknown>;
  const latitude = num(r.latitude);
  const longitude = num(r.longitude);
  if (latitude === null || longitude === null) return null;
  return {
    latitude,
    longitude,
    label: typeof r.name === "string" ? r.name : "",
  };
}

export function buildForecastUrl(coordinates: Coordinates): string {
  const params = new URLSearchParams({
    latitude: String(coordinates.latitude),
    longitude: String(coordinates.longitude),
    daily: [
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_sum",
      "relative_humidity_2m_mean",
    ].join(","),
    past_days: String(PAST_DAYS),
    forecast_days: String(FORECAST_DAYS),
    // Days are the plant's local calendar days, matching todayKey().
    timezone: "auto",
  });
  return `${FORECAST_ENDPOINT}?${params.toString()}`;
}

function series(daily: Record<string, unknown>, key: string): unknown[] | null {
  const value = daily[key];
  return Array.isArray(value) ? value : null;
}

/** Open-Meteo returns parallel arrays under `daily`; zip them into records.
 * A day missing any required value is dropped rather than yielding NaN. */
export function parseForecastResponse(raw: unknown): DailyWeather[] {
  if (typeof raw !== "object" || raw === null) return [];
  const dailyRaw = (raw as { daily?: unknown }).daily;
  if (typeof dailyRaw !== "object" || dailyRaw === null) return [];
  const daily = dailyRaw as Record<string, unknown>;

  const time = series(daily, "time");
  if (!time) return [];
  const maxima = series(daily, "temperature_2m_max") ?? [];
  const minima = series(daily, "temperature_2m_min") ?? [];
  const precip = series(daily, "precipitation_sum") ?? [];
  const humidity = series(daily, "relative_humidity_2m_mean");

  const out: DailyWeather[] = [];
  for (let i = 0; i < time.length; i++) {
    const date = time[i];
    const tempMaxC = num(maxima[i]);
    const tempMinC = num(minima[i]);
    const precipMm = num(precip[i]);
    if (typeof date !== "string" || tempMaxC === null || tempMinC === null || precipMm === null) {
      continue;
    }
    out.push({
      date,
      tempMaxC,
      tempMinC,
      precipMm,
      humidity: humidity ? num(humidity[i]) : null,
    });
  }
  return out;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local calendar date "YYYY-MM-DD" — the phone's day, which lines up with the
 * timezone=auto days Open-Meteo returns for the plant's location. */
export function todayKey(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Collapse the daily series into the handful of numbers the watering math
 * needs. Temperatures look FORWARD (what the plant is about to face); rain
 * looks BACKWARD over 24-48h (water already in the soil). ISO date strings
 * compare lexicographically, so no Date parsing is needed here.
 */
export function summarizeWeather(daily: DailyWeather[], today: string): WeatherSummary | null {
  const ahead = daily.filter((d) => d.date >= today);
  if (ahead.length === 0) return null;

  const maxTempC = Math.max(...ahead.map((d) => d.tempMaxC));
  const minTempC = Math.min(...ahead.map((d) => d.tempMinC));

  const recent = daily.filter((d) => d.date <= today && d.date >= previousDay(today));
  const recentPrecipMm = recent.reduce((sum, d) => sum + d.precipMm, 0);

  const humidities = ahead
    .map((d) => d.humidity)
    .filter((h): h is number => typeof h === "number");
  const meanHumidity =
    humidities.length > 0 ? humidities.reduce((a, b) => a + b, 0) / humidities.length : null;

  return { maxTempC, minTempC, recentPrecipMm, meanHumidity };
}

/** "2026-07-15" → "2026-07-14" (UTC math on a date-only key; no TZ shift). */
function previousDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() - 1);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export interface WeatherCacheEntry {
  /** ISO timestamp of the fetch. */
  fetchedAt: string;
  coordinates: Coordinates;
  daily: DailyWeather[];
}

/** ZIP → entry. Keyed by ZIP, not plant: several plants at one address share
 * a forecast, so the whole garden costs one request per 6h. */
export type WeatherCache = Record<string, WeatherCacheEntry>;

export function upsertWeatherEntry(
  cache: WeatherCache,
  zip: string,
  entry: WeatherCacheEntry,
): WeatherCache {
  return { ...cache, [zip]: entry };
}

/** Fresh = fetched within the TTL AND not in the future (a clock change must
 * not pin a stale entry as fresh forever). */
export function isFresh(entry: WeatherCacheEntry, now: Date): boolean {
  const fetchedAt = new Date(entry.fetchedAt).getTime();
  if (isNaN(fetchedAt)) return false;
  const age = now.getTime() - fetchedAt;
  return age >= 0 && age <= WEATHER_CACHE_TTL_MS;
}

export function cachedWeather(
  cache: WeatherCache,
  zip: string,
  now: Date,
): WeatherCacheEntry | null {
  const entry = cache[zip];
  if (!entry) return null;
  return isFresh(entry, now) ? entry : null;
}

function isValidCoordinates(value: unknown): value is Coordinates {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return num(c.latitude) !== null && num(c.longitude) !== null && typeof c.label === "string";
}

function isValidDay(value: unknown): value is DailyWeather {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.date === "string" &&
    num(d.tempMaxC) !== null &&
    num(d.tempMinC) !== null &&
    num(d.precipMm) !== null &&
    (d.humidity === null || num(d.humidity) !== null)
  );
}

function isValidEntry(value: unknown): value is WeatherCacheEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.fetchedAt === "string" &&
    isValidCoordinates(e.coordinates) &&
    Array.isArray(e.daily) &&
    e.daily.every(isValidDay)
  );
}

/** Stored data is untrusted (same rule as the photo index): malformed JSON or
 * entries degrade to "no cached weather", never an exception. */
export function parseWeatherCache(json: string | null): WeatherCache {
  if (!json) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const cache: WeatherCache = {};
  for (const [zip, entry] of Object.entries(raw)) {
    if (isValidEntry(entry)) cache[zip] = entry;
  }
  return cache;
}

export function serializeWeatherCache(cache: WeatherCache): string {
  return JSON.stringify(cache);
}

export interface WeatherDeps {
  loadCache: () => Promise<WeatherCache>;
  saveCache: (cache: WeatherCache) => Promise<void>;
  /** GET + parse JSON. Throws on transport failure (weather-io.ts). */
  fetchJson: (url: string) => Promise<unknown>;
}

export interface ResolveWeatherInput {
  /** plants.zip_code — the only location signal F20 uses. */
  zip: string | null;
  now: Date;
}

export interface ResolvedWeather {
  summary: WeatherSummary;
  coordinates: Coordinates;
  /** True when this came from a cached forecast the TTL had already expired —
   * the network was unreachable and stale data still beats no guidance. */
  stale: boolean;
}

/**
 * ZIP → weather summary, the whole flow: fresh cache, else geocode + forecast,
 * else whatever stale cache we still hold. Dependency-injected so the cache and
 * offline behaviour are testable in Node; weather-io.ts supplies the real
 * AsyncStorage + fetch.
 *
 * Never throws: weather is an enhancement, and a plant with no ZIP or no
 * connection simply falls back to its base watering schedule.
 */
export async function resolveWeather(
  deps: WeatherDeps,
  input: ResolveWeatherInput,
): Promise<ResolvedWeather | null> {
  const zip = normalizeZip(input.zip);
  if (!zip) return null;

  const cache = await deps.loadCache().catch(() => ({}) as WeatherCache);
  const fresh = cachedWeather(cache, zip, input.now);
  if (fresh) return summarize(fresh, input.now, false);

  try {
    const geocoded = parseGeocodeResponse(await deps.fetchJson(buildGeocodeUrl(zip)));
    if (!geocoded) return null; // Unknown ZIP — a refetch won't help.

    const daily = parseForecastResponse(await deps.fetchJson(buildForecastUrl(geocoded)));
    const entry: WeatherCacheEntry = {
      fetchedAt: input.now.toISOString(),
      coordinates: geocoded,
      daily,
    };
    // Best-effort: a cache write failure only costs the next request.
    await deps.saveCache(upsertWeatherEntry(cache, zip, entry)).catch(() => {});
    return summarize(entry, input.now, false);
  } catch (e) {
    console.error("[resolveWeather] lookup failed:", (e as Error).message);
    const stale = cache[zip];
    return stale ? summarize(stale, input.now, true) : null;
  }
}

function summarize(entry: WeatherCacheEntry, now: Date, stale: boolean): ResolvedWeather | null {
  const summary = summarizeWeather(entry.daily, todayKey(now));
  if (!summary) return null;
  return { summary, coordinates: entry.coordinates, stale };
}
