// #5 — night-before frost/heat alerts, pure half. Crosses the forecast the
// app already fetches (anonymous Open-Meteo, the one allowed weather call)
// with each plant's own comfort range from its care profile. Entirely
// deterministic: no model, no server, no new network. The notification wiring
// is reminders.scheduleWeatherAlert; the sync glue lives in the Plants screen
// where the forecast is already in hand.

import type { CareProfile } from "@citrus/shared";
import { isIndoor } from "./watering";
import type { DailyWeather } from "./weather";

export interface AlertCandidate {
  id: string;
  name: string;
  location: string | null;
  careProfile: CareProfile | null;
  zipCode: string | null;
}

/** "Frost" is a METEOROLOGICAL claim: forecast low at or below this. A breach
 * of the AI-generated comfort floor above it is a "cold" snap — honest words
 * for what is actually coming (adversarial critic: temp_min_c is hallucinable
 * and a 3°C night is not frost). */
export const FROST_C = 2;

export interface WeatherAlert {
  kind: "frost" | "cold" | "heat";
  /** The forecast extreme that tripped the alert. */
  tempC: number;
  /** Local midnight of the night/day in question. */
  night: Date;
  plantNames: string[];
}

/** How many forecast days ahead we warn about (tonight + tomorrow night). */
const LOOKAHEAD_DAYS = 2;

/**
 * Which plants need protecting, per upcoming night. Frost: forecast low at or
 * below the plant's comfort floor. Heat: forecast high above its ceiling.
 * Indoor plants never alert — frost is not their problem. One alert per
 * night, most-imminent first; cold beats heat when both trip on the same day
 * (you can shade a plant tomorrow, but tonight's frost kills it tonight).
 */
export function weatherAlertsFor(
  candidates: AlertCandidate[],
  dailyByZip: Record<string, DailyWeather[]>,
  now: Date,
): WeatherAlert[] {
  const alerts: WeatherAlert[] = [];
  for (let offset = 0; offset < LOOKAHEAD_DAYS; offset++) {
    const night = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const key = toKey(night);
    const frost: { names: string[]; tempC: number } = { names: [], tempC: Infinity };
    const cold: { names: string[]; tempC: number } = { names: [], tempC: Infinity };
    const heat: { names: string[]; tempC: number } = { names: [], tempC: -Infinity };

    for (const plant of candidates) {
      const profile = plant.careProfile;
      if (!profile || !plant.zipCode) continue;
      // An inverted range is junk that would trip an alert every day; the
      // schema now rejects it, and this guard covers pre-existing stored rows.
      if (profile.temp_min_c >= profile.temp_max_c) continue;
      if (isIndoor(plant.location, profile)) continue;
      const day = (dailyByZip[plant.zipCode] ?? []).find((d) => d.date === key);
      if (!day) continue;
      if (day.tempMinC <= profile.temp_min_c) {
        // Below the plant's floor — but "frost" only when it's actually near
        // freezing; otherwise it's an honest cold snap.
        const bucket = day.tempMinC <= FROST_C ? frost : cold;
        bucket.names.push(plant.name);
        bucket.tempC = Math.min(bucket.tempC, day.tempMinC);
      } else if (day.tempMaxC > profile.temp_max_c) {
        heat.names.push(plant.name);
        heat.tempC = Math.max(heat.tempC, day.tempMaxC);
      }
    }

    if (frost.names.length > 0) {
      alerts.push({ kind: "frost", tempC: frost.tempC, night, plantNames: frost.names });
    } else if (cold.names.length > 0) {
      alerts.push({ kind: "cold", tempC: cold.tempC, night, plantNames: cold.names });
    } else if (heat.names.length > 0) {
      alerts.push({ kind: "heat", tempC: heat.tempC, night, plantNames: heat.names });
    }
  }
  return alerts;
}

/** "2026-11-11" in LOCAL calendar — matches Open-Meteo's daily date strings. */
function toKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
