// F20 — weather, IO half: the concrete WeatherDeps for the pure resolver in
// weather.ts (same split as photo-store.ts vs photo-store-io.ts). Untested by
// design — README testing policy: the fetch/AsyncStorage wiring is exercised
// via `expo export` bundling, the logic via weather.test.ts.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Hemisphere } from "./pruning-rules";
import {
  cachedWeather,
  normalizeZip,
  parseWeatherCache,
  resolveWeather,
  serializeWeatherCache,
  summarizeWeather,
  todayKey,
  WEATHER_CACHE_STORAGE_KEY,
  type ResolvedWeather,
  type WeatherCache,
  type WeatherDeps,
  type WeatherSummary,
} from "./weather";

/** A forecast that never arrives must not hang the card behind it: Open-Meteo
 * is a third party on the user's own connection, so the request gets a bound. */
const REQUEST_TIMEOUT_MS = 10_000;

export const weatherDeps: WeatherDeps = {
  async loadCache(): Promise<WeatherCache> {
    // parseWeatherCache already degrades malformed data to {}; this guards the
    // storage read itself failing.
    try {
      return parseWeatherCache(await AsyncStorage.getItem(WEATHER_CACHE_STORAGE_KEY));
    } catch (e) {
      console.error("[weatherDeps.loadCache] read failed:", (e as Error).message);
      return {};
    }
  },

  async saveCache(cache: WeatherCache): Promise<void> {
    await AsyncStorage.setItem(WEATHER_CACHE_STORAGE_KEY, serializeWeatherCache(cache));
  },

  /** GET + JSON. Throws on transport/HTTP failure — resolveWeather catches it
   * and falls back to stale cache or "no weather" (the deps contract). */
  async fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`weather request failed (${res.status})`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  },
};

/**
 * ZIP → weather, the app's one entry point. Null when the plant has no ZIP, the
 * ZIP is unknown, or nothing (not even stale cache) is available — the callers
 * treat that as "no weather guidance", never an error.
 */
export function loadWeatherFor(zip: string | null, now: Date = new Date()): Promise<ResolvedWeather | null> {
  return resolveWeather(weatherDeps, { zip, now });
}

/**
 * What the cache alone can tell us about a plant's location — no network, so a
 * screen can open on it. Two facts come from the one read:
 *
 *  - `weather`, for watering math (null = the plain baseline interval).
 *  - `hemisphere`, from the sign of the cached geocode's latitude. Pruning
 *    windows are stored northern-hemisphere (every source behind them is), so
 *    this is what stops a southern-hemisphere grower being told to prune six
 *    months out of phase. Null = we genuinely don't know, and the caller's
 *    default (northern) applies with the condition stated in the copy.
 */
export interface CachedLocalConditions {
  weather: WeatherSummary | null;
  hemisphere: Hemisphere | null;
}

export async function cachedLocalConditions(
  zip: string | null | undefined,
  now: Date = new Date(),
): Promise<CachedLocalConditions> {
  const normalized = normalizeZip(zip);
  if (!normalized) return { weather: null, hemisphere: null };
  try {
    const cache = await weatherDeps.loadCache();
    // Two different lifetimes on purpose: a FORECAST goes stale in hours, but
    // the ZIP's latitude does not, so the hemisphere is read from the raw entry
    // while the weather still respects the 6h TTL. Expiring the hemisphere
    // would silently drop a southern grower back to northern pruning months.
    const stored = cache[normalized];
    const hemisphere: Hemisphere | null = stored
      ? stored.coordinates.latitude < 0
        ? "southern"
        : "northern"
      : null;
    const fresh = cachedWeather(cache, normalized, now);
    return {
      weather: fresh ? summarizeWeather(fresh.daily, todayKey(now)) : null,
      hemisphere,
    };
  } catch (e) {
    console.error("[weather-io] cached conditions read failed:", (e as Error).message);
    return { weather: null, hemisphere: null };
  }
}
