import { describe, expect, it } from "vitest";
import type { CareProfile } from "@citrus/shared";
import type { WeatherSummary } from "./weather";
import {
  distinctZips,
  dueLabel,
  isIndoor,
  lastWateredAt,
  markWatered,
  parseStoredCareProfile,
  parseWateringLog,
  serializeWateringLog,
  wateringPlan,
  wateringPlansFor,
  type PlanCandidate,
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

/** Past PROFILE.temp_max_c (30) — the heat rule fires. */
const HOT: WeatherSummary = { ...MILD, maxTempC: 34 };

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

// The one line the watering card actually leads with. Dates are rendered in
// LOCAL time (the plant's day, and the notification window's day), so the
// assertions below build their expectations from local Date parts too.

describe("dueLabel", () => {
  function labelFor(overrides: Partial<WateringInput> = {}): string {
    return dueLabel(
      wateringPlan({
        careProfile: PROFILE,
        location: null,
        weather: MILD,
        lastWateredAt: null,
        lastAssessedAt: null,
        now: NOW,
        ...overrides,
      }),
    );
  }

  it("says 'Due today' the moment the interval elapses", () => {
    // Watered exactly one interval (10 days) ago → due right now.
    expect(labelFor({ lastWateredAt: new Date(NOW.getTime() - 10 * 86400000).toISOString() })).toBe(
      "Due today",
    );
  });

  it("counts the days when the plant is overdue", () => {
    expect(labelFor({ lastWateredAt: new Date(NOW.getTime() - 13 * 86400000).toISOString() })).toBe(
      "Overdue by 3 days",
    );
  });

  it("uses the singular for a single overdue day", () => {
    expect(labelFor({ lastWateredAt: new Date(NOW.getTime() - 11 * 86400000).toISOString() })).toBe(
      "Overdue by 1 day",
    );
  });

  it("says 'Due tomorrow' rather than a bare date for the nearest future day", () => {
    expect(labelFor({ lastWateredAt: new Date(NOW.getTime() - 9 * 86400000).toISOString() })).toBe(
      "Due tomorrow",
    );
  });

  it("names the date for anything further out", () => {
    const plan = wateringPlan({
      careProfile: PROFILE,
      location: null,
      weather: MILD,
      lastWateredAt: NOW.toISOString(),
      lastAssessedAt: null,
      now: NOW,
    });
    const due = new Date(plan.nextWaterDueAt);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    expect(dueLabel(plan)).toBe(`Due ${months[due.getMonth()]} ${due.getDate()}`);
  });
});

// The Plants list computes every card's chip in ONE pass. The rule that makes
// it cheap: weather is looked up per distinct ZIP, never per card — a garden of
// twenty plants at one address costs one forecast, not twenty.

describe("distinctZips", () => {
  function candidate(overrides: Partial<PlanCandidate> = {}): PlanCandidate {
    return {
      id: "plant-1",
      zipCode: "90210",
      location: null,
      careProfile: PROFILE,
      lastAssessedAt: null,
      ...overrides,
    };
  }

  it("collapses repeats so several plants at one address cost one lookup", () => {
    expect(
      distinctZips([
        candidate({ id: "a", zipCode: "90210" }),
        candidate({ id: "b", zipCode: "90210" }),
        candidate({ id: "c", zipCode: "10001" }),
      ]),
    ).toEqual(["90210", "10001"]);
  });

  it("skips plants with no (or blank) ZIP — nothing to look up", () => {
    expect(
      distinctZips([
        candidate({ id: "a", zipCode: null }),
        candidate({ id: "b", zipCode: "   " }),
        candidate({ id: "c", zipCode: "90210" }),
      ]),
    ).toEqual(["90210"]);
  });

  it("ignores plants that have no care profile — their ZIP buys nothing", () => {
    expect(distinctZips([candidate({ zipCode: "90210", careProfile: null })])).toEqual([]);
  });
});

describe("wateringPlansFor", () => {
  function candidate(overrides: Partial<PlanCandidate> = {}): PlanCandidate {
    return {
      id: "plant-1",
      zipCode: "90210",
      location: null,
      careProfile: PROFILE,
      lastAssessedAt: null,
      ...overrides,
    };
  }

  it("plans every plant that has a profile, reusing one summary per ZIP", () => {
    const plans = wateringPlansFor(
      [candidate({ id: "a" }), candidate({ id: "b" })],
      { "90210": HOT },
      { a: "2026-07-14T09:00:00.000Z", b: "2026-07-14T09:00:00.000Z" },
      NOW,
    );
    expect(Object.keys(plans).sort()).toEqual(["a", "b"]);
    // Both saw the same hot forecast → the same shortened interval.
    expect(plans.a.intervalDays).toBe(7);
    expect(plans.b.intervalDays).toBe(7);
    expect(plans.a.weatherAdjusted).toBe(true);
  });

  it("omits plants with no care profile — no baseline, no plan, no chip", () => {
    const plans = wateringPlansFor([candidate({ careProfile: null })], { "90210": MILD }, {}, NOW);
    expect(plans).toEqual({});
  });

  it("still plans a plant whose weather is unavailable, on its base schedule", () => {
    const plans = wateringPlansFor([candidate({ zipCode: null })], {}, {}, NOW);
    expect(plans["plant-1"].intervalDays).toBe(10);
    expect(plans["plant-1"].weatherAdjusted).toBe(false);
  });

  it("marks an overdue plant due, anchoring on the last assessment when nothing was logged", () => {
    const plans = wateringPlansFor(
      [candidate({ lastAssessedAt: "2026-06-01T09:00:00.000Z" })],
      { "90210": MILD },
      {},
      NOW,
    );
    expect(plans["plant-1"].isDue).toBe(true);
  });

  it("prefers a logged watering over the last assessment as the anchor", () => {
    const plans = wateringPlansFor(
      [candidate({ lastAssessedAt: "2026-06-01T09:00:00.000Z" })],
      { "90210": MILD },
      { "plant-1": "2026-07-15T09:00:00.000Z" },
      NOW,
    );
    expect(plans["plant-1"].isDue).toBe(false);
  });
});
