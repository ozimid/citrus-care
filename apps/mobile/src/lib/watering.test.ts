import { describe, expect, it, vi } from "vitest";
import type { CareProfile } from "@citrus/shared";
import type { WeatherSummary } from "./weather";
import {
  isIndoor,
  lastWateredAt,
  markWatered,
  parseStoredCareProfile,
  parseWateringLog,
  requestCareProfile,
  serializeWateringLog,
  wateringPlan,
  type WateringInput,
} from "./watering";

// F20's deterministic core: Gemini supplies the baseline ONCE, this module
// makes every watering decision from it. Each rule below is one test.

const PROFILE: CareProfile = {
  base_watering_interval_days: 10,
  water_amount_note: "2L until it drains.",
  sun: "full",
  temp_min_c: 2,
  temp_max_c: 30,
  drought_tolerance: "medium",
  indoor_ok: false,
  notes: "Deep soak then dry back.",
};

const MILD: WeatherSummary = {
  maxTempC: 24,
  minTempC: 14,
  recentPrecipMm: 0,
  meanHumidity: 55,
};

const NOW = new Date("2026-07-15T09:00:00.000Z");

function plan(overrides: Partial<WateringInput> = {}) {
  return wateringPlan({
    careProfile: PROFILE,
    location: null,
    weather: MILD,
    lastWateredAt: "2026-07-15T09:00:00.000Z",
    lastAssessedAt: null,
    now: NOW,
    ...overrides,
  });
}

describe("wateringPlan — baseline", () => {
  it("uses the care profile's fair-weather interval when nothing applies", () => {
    const p = plan();
    expect(p.intervalDays).toBe(10);
    expect(p.nextWaterDueAt).toBe("2026-07-25T09:00:00.000Z");
    expect(p.weatherAdjusted).toBe(false);
    expect(p.reason).toBe("Every 10 days");
  });

  it("counts from the last watering when there is one", () => {
    const p = plan({ lastWateredAt: "2026-07-10T09:00:00.000Z" });
    expect(p.nextWaterDueAt).toBe("2026-07-20T09:00:00.000Z");
  });

  it("falls back to the last assessment when the plant was never marked watered", () => {
    const p = plan({ lastWateredAt: null, lastAssessedAt: "2026-07-12T09:00:00.000Z" });
    expect(p.nextWaterDueAt).toBe("2026-07-22T09:00:00.000Z");
  });

  it("falls back to now when there is neither — a fresh plant starts its clock today", () => {
    const p = plan({ lastWateredAt: null, lastAssessedAt: null });
    expect(p.nextWaterDueAt).toBe("2026-07-25T09:00:00.000Z");
  });

  it("flags due / overdue against now", () => {
    // Watered 07-05 + 10 days = due exactly now: due, 0 days left.
    expect(plan({ lastWateredAt: "2026-07-05T09:00:00.000Z" }).isDue).toBe(true);
    expect(plan({ lastWateredAt: "2026-07-05T09:00:00.000Z" }).daysUntilDue).toBe(0);
    // Watered 06-30 + 10 days = due 07-10: five days overdue.
    expect(plan({ lastWateredAt: "2026-06-30T09:00:00.000Z" }).daysUntilDue).toBe(-5);
    expect(plan({ lastWateredAt: "2026-07-14T09:00:00.000Z" }).isDue).toBe(false);
    expect(plan({ lastWateredAt: "2026-07-14T09:00:00.000Z" }).daysUntilDue).toBe(9);
  });
});

describe("wateringPlan — heat rule", () => {
  const hot: WeatherSummary = { ...MILD, maxTempC: 34 };

  it("shortens the interval by 30% when the week beats temp_max_c", () => {
    const p = plan({ weather: hot });
    expect(p.intervalDays).toBe(7); // round(10 * 0.7)
    expect(p.nextWaterDueAt).toBe("2026-07-22T09:00:00.000Z");
    expect(p.weatherAdjusted).toBe(true);
  });

  it("explains itself in the reason string", () => {
    expect(plan({ weather: hot }).reason).toBe("Hot week (34°C) — water 3 days sooner");
  });

  it("does not fire at exactly temp_max_c — the threshold is strict", () => {
    expect(plan({ weather: { ...MILD, maxTempC: 30 } }).intervalDays).toBe(10);
    expect(plan({ weather: { ...MILD, maxTempC: 30.1 } }).intervalDays).toBe(7);
  });
});

describe("wateringPlan — rain rule", () => {
  const wet: WeatherSummary = { ...MILD, recentPrecipMm: 12 };

  it("extends the interval by 50% after heavy rain on an outdoor plant", () => {
    const p = plan({ weather: wet, location: "South patio" });
    expect(p.intervalDays).toBe(15); // round(10 * 1.5)
    expect(p.reason).toBe("Heavy rain (12mm) — wait 5 days longer");
  });

  it("ignores drizzle below the 5mm bar", () => {
    expect(plan({ weather: { ...MILD, recentPrecipMm: 5 } }).intervalDays).toBe(10);
    expect(plan({ weather: { ...MILD, recentPrecipMm: 5.1 } }).intervalDays).toBe(15);
  });

  it("ignores rain entirely for an indoor plant — it never reached the pot", () => {
    const p = plan({ weather: wet, location: "Indoor windowsill" });
    expect(p.intervalDays).toBe(10);
    expect(p.weatherAdjusted).toBe(false);
  });
});

describe("wateringPlan — drought tolerance", () => {
  it("stretches a drought-tolerant plant by 20%", () => {
    const p = plan({ careProfile: { ...PROFILE, drought_tolerance: "high" } });
    expect(p.intervalDays).toBe(12);
    expect(p.reason).toBe("Every 12 days");
  });

  it("tightens a thirsty plant by 20%", () => {
    expect(plan({ careProfile: { ...PROFILE, drought_tolerance: "low" } }).intervalDays).toBe(8);
  });

  it("leaves a medium-tolerance plant on its baseline", () => {
    expect(plan({ careProfile: { ...PROFILE, drought_tolerance: "medium" } }).intervalDays).toBe(10);
  });
});

describe("wateringPlan — indoor plants", () => {
  it("treats a location naming indoors as indoor, case-insensitively", () => {
    expect(isIndoor("Indoor windowsill", PROFILE)).toBe(true);
    expect(isIndoor("INDOORS, kitchen", PROFILE)).toBe(true);
    expect(isIndoor("South patio", PROFILE)).toBe(false);
  });

  it("falls back to the profile's indoor_ok only when location is unset", () => {
    expect(isIndoor(null, { ...PROFILE, indoor_ok: true })).toBe(true);
    expect(isIndoor("", { ...PROFILE, indoor_ok: true })).toBe(true);
    expect(isIndoor(null, { ...PROFILE, indoor_ok: false })).toBe(false);
    // An explicit outdoor location beats indoor_ok — the user knows where it is.
    expect(isIndoor("South patio", { ...PROFILE, indoor_ok: true })).toBe(false);
  });

  it("applies only a mild heat effect indoors (15%, not 30%)", () => {
    const p = plan({ weather: { ...MILD, maxTempC: 34 }, location: "Indoor shelf" });
    expect(p.intervalDays).toBe(9); // round(10 * 0.85)
    expect(p.weatherAdjusted).toBe(true);
  });
});

describe("wateringPlan — combined rules", () => {
  it("composes heat, rain and drought tolerance multiplicatively", () => {
    const p = plan({
      careProfile: { ...PROFILE, drought_tolerance: "high" },
      location: "South patio",
      weather: { ...MILD, maxTempC: 34, recentPrecipMm: 12 },
    });
    // 10 * 0.7 (hot) * 1.5 (rain) * 1.2 (drought-tolerant) = 12.6 -> 13
    expect(p.intervalDays).toBe(13);
    expect(p.reason).toBe("Hot week (34°C) · Heavy rain (12mm) — wait 3 days longer");
  });

  it("says so plainly when the adjustments cancel out", () => {
    const p = plan({
      location: "South patio",
      weather: { ...MILD, maxTempC: 34, recentPrecipMm: 12 },
      careProfile: { ...PROFILE, base_watering_interval_days: 10 },
    });
    // 10 * 0.7 * 1.5 = 10.5 -> 11 (round-half-up), a 1 day stretch
    expect(p.intervalDays).toBe(11);
    expect(p.reason).toBe("Hot week (34°C) · Heavy rain (12mm) — wait 1 day longer");
  });
});

describe("wateringPlan — clamping and missing weather", () => {
  it("never schedules more often than daily", () => {
    const p = plan({
      careProfile: { ...PROFILE, base_watering_interval_days: 1, drought_tolerance: "low" },
      weather: { ...MILD, maxTempC: 40 },
    });
    expect(p.intervalDays).toBe(1);
  });

  it("never stretches past 60 days", () => {
    const p = plan({
      careProfile: { ...PROFILE, base_watering_interval_days: 60, drought_tolerance: "high" },
      location: "South patio",
      weather: { ...MILD, recentPrecipMm: 20 },
    });
    expect(p.intervalDays).toBe(60);
  });

  it("falls back to the plain baseline when weather is unavailable (no ZIP / offline)", () => {
    const p = plan({ weather: null });
    expect(p.intervalDays).toBe(10);
    expect(p.weatherAdjusted).toBe(false);
    expect(p.reason).toBe("Every 10 days");
  });
});

describe("parseStoredCareProfile", () => {
  it("accepts a valid stored profile", () => {
    expect(parseStoredCareProfile(PROFILE)).toEqual(PROFILE);
  });

  it("rejects junk from the database rather than feeding it to the math", () => {
    expect(parseStoredCareProfile(null)).toBeNull();
    expect(parseStoredCareProfile({})).toBeNull();
    expect(parseStoredCareProfile({ ...PROFILE, base_watering_interval_days: 900 })).toBeNull();
    expect(parseStoredCareProfile("a string")).toBeNull();
  });
});

describe("watering log", () => {
  it("records a watering per plant and reads it back", () => {
    const log = markWatered({}, "plant-1", NOW);
    expect(lastWateredAt(log, "plant-1")).toBe("2026-07-15T09:00:00.000Z");
    expect(lastWateredAt(log, "plant-2")).toBeNull();
  });

  it("overwrites the previous watering for that plant only", () => {
    let log = markWatered({}, "plant-1", new Date("2026-07-01T09:00:00.000Z"));
    log = markWatered(log, "plant-2", new Date("2026-07-02T09:00:00.000Z"));
    log = markWatered(log, "plant-1", NOW);
    expect(lastWateredAt(log, "plant-1")).toBe("2026-07-15T09:00:00.000Z");
    expect(lastWateredAt(log, "plant-2")).toBe("2026-07-02T09:00:00.000Z");
  });

  it("round-trips through storage", () => {
    const log = markWatered({}, "plant-1", NOW);
    expect(parseWateringLog(serializeWateringLog(log))).toEqual(log);
  });

  it("degrades to an empty log on malformed stored data, never throws", () => {
    expect(parseWateringLog(null)).toEqual({});
    expect(parseWateringLog("{not json")).toEqual({});
    expect(parseWateringLog('["array"]')).toEqual({});
    expect(parseWateringLog('{"plant-1":42}')).toEqual({});
  });
});

// The care-profile call is fire-and-forget at plant creation: a plant with no
// profile just has no watering guidance yet, so every failure is silent and
// retryable later. Deps-injected (AuthorizedFetch) so it tests in Node.

describe("requestCareProfile", () => {
  function makeApi(res: { ok: boolean; status: number; body: unknown }) {
    return vi.fn().mockResolvedValue({
      ok: res.ok,
      status: res.status,
      json: async () => res.body,
    });
  }

  it("POSTs the plant id and returns the validated profile", async () => {
    const api = makeApi({ ok: true, status: 200, body: { careProfile: PROFILE } });
    expect(await requestCareProfile(api, "plant-1")).toEqual(PROFILE);
    expect(api).toHaveBeenCalledWith("/care-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plantId: "plant-1" }),
    });
  });

  it("returns null on an API error rather than throwing at the caller", async () => {
    const api = makeApi({ ok: false, status: 429, body: { error: "Too many" } });
    expect(await requestCareProfile(api, "plant-1")).toBeNull();
  });

  it("returns null when the network is unreachable", async () => {
    const api = vi.fn().mockRejectedValue(new Error("Network request failed"));
    expect(await requestCareProfile(api, "plant-1")).toBeNull();
  });

  it("returns null when the server sends a profile that fails the schema", async () => {
    const api = makeApi({
      ok: true,
      status: 200,
      body: { careProfile: { ...PROFILE, drought_tolerance: "extreme" } },
    });
    expect(await requestCareProfile(api, "plant-1")).toBeNull();
  });
});
