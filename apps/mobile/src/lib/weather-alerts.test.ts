import { describe, expect, it } from "vitest";
import type { CareProfile } from "@citrus/shared";
import type { DailyWeather } from "./weather";
import { weatherAlertsFor, type AlertCandidate } from "./weather-alerts";

const PROFILE: CareProfile = {
  base_watering_interval_days: 7,
  water_amount_note: "x",
  sun: "full",
  temp_min_c: 4,
  temp_max_c: 35,
  drought_tolerance: "medium",
  indoor_ok: false,
  notes: "x",
};

function candidate(overrides: Partial<AlertCandidate> = {}): AlertCandidate {
  return { id: "p1", name: "Mr Lemon", location: "Patio", careProfile: PROFILE, zipCode: "90001", ...overrides };
}

function day(date: string, min: number, max: number): DailyWeather {
  return { date, tempMinC: min, tempMaxC: max, precipMm: 0, humidity: null };
}

const NOW = new Date(2026, 10, 11, 9, 0); // Nov 11 local

describe("weatherAlertsFor", () => {
  it("calls it FROST only at a meteorological threshold, never on the AI value alone", () => {
    // temp_min_c is a Gemma-generated comfort floor — hallucinable. "Frost"
    // must mean near-freezing air, not "below a number the model made up"
    // (adversarial critic). 2°C ≤ FROST_C → frost for both at-risk plants.
    const alerts = weatherAlertsFor(
      [candidate(), candidate({ id: "p2", name: "Rosa", careProfile: { ...PROFILE, temp_min_c: 0 } })],
      { "90001": [day("2026-11-11", 1, 12), day("2026-11-12", 6, 14)] },
      NOW,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("frost");
    expect(alerts[0].plantNames).toContain("Mr Lemon");
  });

  it("downgrades an above-freezing comfort breach to an honest cold-snap", () => {
    // 3°C is below Mr Lemon's 4°C floor but is NOT frost — the wording must
    // not claim weather that is not coming.
    const alerts = weatherAlertsFor(
      [candidate()],
      { "90001": [day("2026-11-11", 3, 12)] },
      NOW,
    );
    expect(alerts[0]).toMatchObject({ kind: "cold", tempC: 3, plantNames: ["Mr Lemon"] });
  });

  it("ignores a profile whose range is inverted — junk in, silence out", () => {
    const inverted = { ...PROFILE, temp_min_c: 35, temp_max_c: 5 };
    expect(
      weatherAlertsFor([candidate({ careProfile: inverted })], { "90001": [day("2026-11-11", 20, 25)] }, NOW),
    ).toEqual([]);
  });

  it("looks one night ahead too, and groups plants into one alert per night", () => {
    const alerts = weatherAlertsFor(
      [candidate(), candidate({ id: "p2", name: "Kumquat" })],
      { "90001": [day("2026-11-11", 10, 15), day("2026-11-12", 1, 12)] },
      NOW,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].plantNames).toEqual(["Mr Lemon", "Kumquat"]);
    expect(alerts[0].kind).toBe("frost");
    expect(alerts[0].night.getDate()).toBe(12);
  });

  it("flags a heat spike above the plant's comfort ceiling", () => {
    const alerts = weatherAlertsFor(
      [candidate()],
      { "90001": [day("2026-11-11", 20, 39)] },
      NOW,
    );
    expect(alerts[0]).toMatchObject({ kind: "heat", tempC: 39 });
  });

  it("never warns for indoor plants — frost is not their problem", () => {
    expect(
      weatherAlertsFor(
        [candidate({ location: "Indoor shelf" })],
        { "90001": [day("2026-11-11", -5, 10)] },
        NOW,
      ),
    ).toEqual([]);
  });

  it("is silent with no profile, no zip, no forecast, or mild weather", () => {
    expect(weatherAlertsFor([candidate({ careProfile: null })], { "90001": [day("2026-11-11", -5, 5)] }, NOW)).toEqual([]);
    expect(weatherAlertsFor([candidate({ zipCode: null })], {}, NOW)).toEqual([]);
    expect(weatherAlertsFor([candidate()], { "90001": [day("2026-11-11", 10, 20)] }, NOW)).toEqual([]);
  });
});
