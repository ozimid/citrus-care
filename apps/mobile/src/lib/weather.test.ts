import { describe, expect, it, vi } from "vitest";
import {
  buildForecastUrl,
  buildGeocodeUrl,
  cachedWeather,
  isFresh,
  normalizeZip,
  parseForecastResponse,
  parseGeocodeResponse,
  parseWeatherCache,
  resolveWeather,
  serializeWeatherCache,
  summarizeWeather,
  todayKey,
  upsertWeatherEntry,
  WEATHER_CACHE_TTL_MS,
  type DailyWeather,
  type WeatherCache,
  type WeatherCacheEntry,
  type WeatherDeps,
} from "./weather";

// Response fixtures are trimmed copies of real Open-Meteo payloads (verified
// live against api.open-meteo.com / geocoding-api.open-meteo.com, 2026-07-15).

const COORDS = { latitude: 34.07362, longitude: -118.40036, label: "Beverly Hills" };

describe("normalizeZip", () => {
  it("trims a usable ZIP and rejects blank/absent ones (feature unavailable)", () => {
    expect(normalizeZip(" 90210 ")).toBe("90210");
    expect(normalizeZip("")).toBeNull();
    expect(normalizeZip("   ")).toBeNull();
    expect(normalizeZip(null)).toBeNull();
  });
});

describe("buildGeocodeUrl", () => {
  it("searches Open-Meteo geocoding by postal code, one result", () => {
    const url = new URL(buildGeocodeUrl("90210"));
    expect(url.origin + url.pathname).toBe("https://geocoding-api.open-meteo.com/v1/search");
    expect(url.searchParams.get("name")).toBe("90210");
    expect(url.searchParams.get("count")).toBe("1");
    expect(url.searchParams.get("format")).toBe("json");
  });

  it("escapes the ZIP rather than interpolating it raw", () => {
    const url = new URL(buildGeocodeUrl("90210&daily=evil"));
    expect(url.searchParams.get("name")).toBe("90210&daily=evil");
  });
});

describe("parseGeocodeResponse", () => {
  it("maps the first result to coordinates", () => {
    const raw = {
      results: [
        {
          id: 5328041,
          name: "Beverly Hills",
          latitude: 34.07362,
          longitude: -118.40036,
          country_code: "US",
          admin1: "California",
          postcodes: ["90210"],
        },
      ],
      generationtime_ms: 0.165,
    };
    expect(parseGeocodeResponse(raw)).toEqual(COORDS);
  });

  it("returns null for an unknown ZIP (no results key at all)", () => {
    expect(parseGeocodeResponse({ generationtime_ms: 0.1 })).toBeNull();
    expect(parseGeocodeResponse({ results: [] })).toBeNull();
  });

  it("returns null rather than throwing on a malformed payload", () => {
    expect(parseGeocodeResponse(null)).toBeNull();
    expect(parseGeocodeResponse("nope")).toBeNull();
    expect(parseGeocodeResponse({ results: [{ name: "X" }] })).toBeNull();
  });
});

describe("buildForecastUrl", () => {
  it("requests the daily fields the watering math needs, past 2 + next 7 days", () => {
    const url = new URL(buildForecastUrl(COORDS));
    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(url.searchParams.get("latitude")).toBe("34.07362");
    expect(url.searchParams.get("longitude")).toBe("-118.40036");
    const daily = url.searchParams.get("daily")!.split(",");
    expect(daily).toContain("temperature_2m_max");
    expect(daily).toContain("temperature_2m_min");
    expect(daily).toContain("precipitation_sum");
    expect(daily).toContain("relative_humidity_2m_mean");
    // past_days covers the "rain in the last 24-48h" rule.
    expect(url.searchParams.get("past_days")).toBe("2");
    expect(url.searchParams.get("forecast_days")).toBe("7");
    expect(url.searchParams.get("timezone")).toBe("auto");
  });
});

describe("parseForecastResponse", () => {
  const raw = {
    latitude: 34.082523,
    longitude: -118.40714,
    timezone: "America/Los_Angeles",
    daily_units: { time: "iso8601", temperature_2m_max: "°C", precipitation_sum: "mm" },
    daily: {
      time: ["2026-07-13", "2026-07-14", "2026-07-15"],
      temperature_2m_max: [27.1, 30.5, 34.2],
      temperature_2m_min: [17.2, 18.4, 21.6],
      precipitation_sum: [0, 6.2, 0.3],
      relative_humidity_2m_mean: [67, 69, 55],
    },
  };

  it("zips the parallel daily arrays into per-day records", () => {
    expect(parseForecastResponse(raw)).toEqual([
      { date: "2026-07-13", tempMaxC: 27.1, tempMinC: 17.2, precipMm: 0, humidity: 67 },
      { date: "2026-07-14", tempMaxC: 30.5, tempMinC: 18.4, precipMm: 6.2, humidity: 69 },
      { date: "2026-07-15", tempMaxC: 34.2, tempMinC: 21.6, precipMm: 0.3, humidity: 55 },
    ]);
  });

  it("tolerates a missing humidity series (optional field)", () => {
    const { relative_humidity_2m_mean: _omit, ...daily } = raw.daily;
    const out = parseForecastResponse({ ...raw, daily });
    expect(out).toHaveLength(3);
    expect(out[0].humidity).toBeNull();
    expect(out[0].tempMaxC).toBe(27.1);
  });

  it("drops days with non-numeric values instead of poisoning the math with NaN", () => {
    const out = parseForecastResponse({
      ...raw,
      daily: { ...raw.daily, temperature_2m_max: [27.1, null, 34.2] },
    });
    expect(out.map((d) => d.date)).toEqual(["2026-07-13", "2026-07-15"]);
  });

  it("returns an empty list rather than throwing on a malformed payload", () => {
    expect(parseForecastResponse(null)).toEqual([]);
    expect(parseForecastResponse({})).toEqual([]);
    expect(parseForecastResponse({ daily: { time: "not-an-array" } })).toEqual([]);
  });
});

describe("summarizeWeather", () => {
  const daily: DailyWeather[] = [
    { date: "2026-07-13", tempMaxC: 22, tempMinC: 14, precipMm: 9, humidity: 80 }, // 2 days ago
    { date: "2026-07-14", tempMaxC: 24, tempMinC: 15, precipMm: 6, humidity: 70 }, // yesterday
    { date: "2026-07-15", tempMaxC: 34, tempMinC: 21, precipMm: 0.5, humidity: 50 }, // today
    { date: "2026-07-16", tempMaxC: 36, tempMinC: 22, precipMm: 0, humidity: 40 },
    { date: "2026-07-17", tempMaxC: 30, tempMinC: 20, precipMm: 0, humidity: 45 },
  ];

  it("takes temperature extremes from the days ahead, not the days already gone", () => {
    const s = summarizeWeather(daily, "2026-07-15")!;
    expect(s.maxTempC).toBe(36); // upcoming peak, ignores the cool past days
    expect(s.minTempC).toBe(20);
  });

  it("sums recent rain over the last 24-48h only (yesterday + today)", () => {
    const s = summarizeWeather(daily, "2026-07-15")!;
    // 6 (yesterday) + 0.5 (today); the 9mm from two days ago has drained.
    expect(s.recentPrecipMm).toBeCloseTo(6.5);
  });

  it("averages humidity over the days ahead, null when the series is absent", () => {
    const s = summarizeWeather(daily, "2026-07-15")!;
    expect(s.meanHumidity).toBeCloseTo(45); // (50 + 40 + 45) / 3
    const noHumidity = daily.map((d) => ({ ...d, humidity: null }));
    expect(summarizeWeather(noHumidity, "2026-07-15")!.meanHumidity).toBeNull();
  });

  it("returns null when no day covers today or later (stale/empty data)", () => {
    expect(summarizeWeather([], "2026-07-15")).toBeNull();
    expect(summarizeWeather(daily.slice(0, 2), "2026-07-15")).toBeNull();
  });
});

describe("todayKey", () => {
  it("renders the LOCAL calendar date, matching Open-Meteo's timezone=auto days", () => {
    expect(todayKey(new Date(2026, 6, 15, 23, 30))).toBe("2026-07-15");
    expect(todayKey(new Date(2026, 0, 5, 0, 15))).toBe("2026-01-05");
  });
});

describe("weather cache", () => {
  const entry: WeatherCacheEntry = {
    fetchedAt: "2026-07-15T10:00:00.000Z",
    coordinates: COORDS,
    daily: [{ date: "2026-07-15", tempMaxC: 34, tempMinC: 21, precipMm: 0, humidity: 50 }],
  };

  it("keeps an entry fresh for 6 hours, stale after", () => {
    expect(WEATHER_CACHE_TTL_MS).toBe(6 * 60 * 60 * 1000);
    expect(isFresh(entry, new Date("2026-07-15T15:59:00.000Z"))).toBe(true);
    expect(isFresh(entry, new Date("2026-07-15T16:01:00.000Z"))).toBe(false);
  });

  it("treats a future-dated entry (clock change) as stale rather than fresh forever", () => {
    expect(isFresh(entry, new Date("2026-07-15T09:00:00.000Z"))).toBe(false);
  });

  it("round-trips through storage keyed by ZIP", () => {
    const cache = upsertWeatherEntry({}, "90210", entry);
    const restored = parseWeatherCache(serializeWeatherCache(cache));
    expect(restored["90210"]).toEqual(entry);
  });

  it("serves a cached entry only while fresh", () => {
    const cache = upsertWeatherEntry({}, "90210", entry);
    expect(cachedWeather(cache, "90210", new Date("2026-07-15T12:00:00.000Z"))).toEqual(entry);
    expect(cachedWeather(cache, "90210", new Date("2026-07-16T12:00:00.000Z"))).toBeNull();
    expect(cachedWeather(cache, "99999", new Date("2026-07-15T12:00:00.000Z"))).toBeNull();
  });

  it("degrades to an empty cache on malformed stored JSON, never throws", () => {
    expect(parseWeatherCache(null)).toEqual({});
    expect(parseWeatherCache("{not json")).toEqual({});
    expect(parseWeatherCache('["array"]')).toEqual({});
    expect(parseWeatherCache('{"90210":{"fetchedAt":42}}')).toEqual({});
  });
});

// resolveWeather is the whole flow: cache → geocode → forecast. Dependency
// injected (weather-io.ts supplies fetch + AsyncStorage), so the cache and
// failure behaviour are testable in Node.

describe("resolveWeather", () => {
  const NOW = new Date("2026-07-15T12:00:00.000Z");
  const TODAY = todayKey(NOW);

  const GEOCODE_BODY = {
    results: [{ name: "Beverly Hills", latitude: 34.07362, longitude: -118.40036 }],
  };

  function forecastBody(dates: string[], maxima: number[], precip: number[]) {
    return {
      daily: {
        time: dates,
        temperature_2m_max: maxima,
        temperature_2m_min: maxima.map((m) => m - 10),
        precipitation_sum: precip,
        relative_humidity_2m_mean: dates.map(() => 50),
      },
    };
  }

  function makeDeps(overrides: Partial<WeatherDeps> = {}) {
    let cache: WeatherCache = {};
    const urls: string[] = [];
    const deps: WeatherDeps = {
      loadCache: async () => cache,
      saveCache: async (next) => {
        cache = next;
      },
      fetchJson: async (url) => {
        urls.push(url);
        if (url.includes("geocoding-api")) return GEOCODE_BODY;
        return forecastBody([TODAY], [34], [0]);
      },
      ...overrides,
    };
    return { deps, urls, getCache: () => cache };
  }

  it("returns null without any network call when the plant has no ZIP", async () => {
    const { deps, urls } = makeDeps();
    expect(await resolveWeather(deps, { zip: null, now: NOW })).toBeNull();
    expect(urls).toEqual([]);
  });

  it("geocodes then fetches the forecast, and summarises it", async () => {
    const { deps, urls } = makeDeps();
    const out = await resolveWeather(deps, { zip: "90210", now: NOW });
    expect(out).not.toBeNull();
    expect(out!.summary.maxTempC).toBe(34);
    expect(out!.coordinates.label).toBe("Beverly Hills");
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("geocoding-api");
    expect(urls[1]).toContain("/v1/forecast");
  });

  it("stores the result so the next call inside the TTL makes no network call", async () => {
    const { deps, urls } = makeDeps();
    await resolveWeather(deps, { zip: "90210", now: NOW });
    expect(urls).toHaveLength(2);

    const again = await resolveWeather(deps, {
      zip: "90210",
      now: new Date("2026-07-15T17:00:00.000Z"), // +5h, still fresh
    });
    expect(again!.summary.maxTempC).toBe(34);
    expect(urls).toHaveLength(2); // untouched — served from cache
  });

  it("refetches once the cached entry is stale", async () => {
    const { deps, urls } = makeDeps();
    await resolveWeather(deps, { zip: "90210", now: NOW });
    await resolveWeather(deps, { zip: "90210", now: new Date("2026-07-15T19:00:00.000Z") }); // +7h
    expect(urls).toHaveLength(4);
  });

  it("returns null for an unknown ZIP and does not call the forecast endpoint", async () => {
    const { deps, urls } = makeDeps({ fetchJson: async () => ({ results: [] }) });
    expect(await resolveWeather(deps, { zip: "00000", now: NOW })).toBeNull();
    expect(urls).toHaveLength(0);
  });

  it("falls back to a stale cached forecast when the network is down", async () => {
    const { deps } = makeDeps();
    await resolveWeather(deps, { zip: "90210", now: NOW });

    const offline = { ...deps, fetchJson: vi.fn().mockRejectedValue(new Error("Network request failed")) };
    // +7h: cache is stale, refetch fails — yesterday's forecast still beats nothing.
    const out = await resolveWeather(offline, { zip: "90210", now: new Date("2026-07-15T19:00:00.000Z") });
    expect(out!.summary.maxTempC).toBe(34);
  });

  it("returns null (never throws) when the network fails with no cache at all", async () => {
    const { deps } = makeDeps({
      fetchJson: async () => {
        throw new Error("Network request failed");
      },
    });
    expect(await resolveWeather(deps, { zip: "90210", now: NOW })).toBeNull();
  });

  it("returns null when the forecast has no day covering today", async () => {
    const { deps } = makeDeps({
      fetchJson: async (url) =>
        url.includes("geocoding-api") ? GEOCODE_BODY : forecastBody(["2026-07-01"], [20], [0]),
    });
    expect(await resolveWeather(deps, { zip: "90210", now: NOW })).toBeNull();
  });
});
