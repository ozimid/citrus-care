// F20 — the deterministic core. Gemini generates a plant's care profile ONCE
// (POST /care-profile); from then on EVERY watering decision the user sees is
// made here, by arithmetic, on the phone. No model in this path: same inputs,
// same answer, and every rule below is a test in watering.test.ts.
//
// Pure module (no react-native/expo imports) so vitest runs it in Node; the
// AsyncStorage wiring is the thin watering-io.ts.

import { careProfileSchema, type CareProfile } from "@citrus/shared";
import type { AuthorizedFetch } from "./api";
import type { WeatherSummary } from "./weather";

/** Above careProfile.temp_max_c the plant is heat-stressed: water sooner. */
export const HOT_SHORTEN_FACTOR = 0.7;
/** Indoors the heat is buffered by the building — a milder version of the rule. */
export const HOT_INDOOR_SHORTEN_FACTOR = 0.85;
/** Rain past this in the last 24-48h means the soil is already wet. */
export const HEAVY_RAIN_MM = 5;
export const RAIN_EXTEND_FACTOR = 1.5;
export const DROUGHT_HIGH_FACTOR = 1.2;
export const DROUGHT_LOW_FACTOR = 0.8;

export const MIN_INTERVAL_DAYS = 1;
export const MAX_INTERVAL_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export const WATERING_LOG_STORAGE_KEY = "citrus.watering-log.v1";

/**
 * Where the plant lives. An explicit location wins over the profile's
 * indoor_ok — the user knows where they put it; indoor_ok only says the plant
 * *could* live inside, which is a fallback, not a fact.
 */
export function isIndoor(location: string | null | undefined, careProfile: CareProfile): boolean {
  if (typeof location === "string" && location.trim().length > 0) {
    return location.toLowerCase().includes("indoor");
  }
  return careProfile.indoor_ok;
}

export interface WateringInput {
  careProfile: CareProfile;
  /** plants.location — the indoor/outdoor signal. */
  location: string | null;
  /** Null when unavailable (no ZIP, offline, cold cache) → plain baseline. */
  weather: WeatherSummary | null;
  /** ISO, from the local watering log. */
  lastWateredAt: string | null;
  /** ISO, the newest assessment — a decent proxy when nothing was logged. */
  lastAssessedAt: string | null;
  now: Date;
}

export interface WateringPlan {
  /** Fair-weather interval straight from the profile. */
  baseIntervalDays: number;
  /** Weather- and tolerance-adjusted interval, clamped to [1, 60]. */
  intervalDays: number;
  nextWaterDueAt: string;
  /** One line of plain English explaining the adjustment. */
  reason: string;
  isDue: boolean;
  /** Negative = overdue by that many days. */
  daysUntilDue: number;
  /** True when weather actually moved the interval (drives the card's chip). */
  weatherAdjusted: boolean;
}

function clamp(days: number): number {
  return Math.min(MAX_INTERVAL_DAYS, Math.max(MIN_INTERVAL_DAYS, days));
}

/**
 * Round to whole days on the DECIMAL intent of the rules, not on IEEE754
 * residue: 10 * 0.7 * 1.5 is 10.499999999999998 in binary floating point, and
 * a bare Math.round would answer 10 where the rule plainly says 10.5 → 11.
 * Collapsing the noise at 6dp first keeps the .5 boundary decided by the rule.
 */
function roundDays(value: number): number {
  return Math.round(Number(value.toFixed(6)));
}

function dayWord(n: number): string {
  return n === 1 ? "day" : "days";
}

/** 6.25 → "6.3", 12 → "12" (no trailing ".0" in the reason string). */
function mm(value: number): string {
  return String(Math.round(value * 10) / 10);
}

export function wateringPlan(input: WateringInput): WateringPlan {
  const { careProfile, weather, now } = input;
  const base = careProfile.base_watering_interval_days;
  const indoor = isIndoor(input.location, careProfile);

  const hot = weather !== null && weather.maxTempC > careProfile.temp_max_c;
  // Rain only counts for plants actually standing in it.
  const rained = weather !== null && !indoor && weather.recentPrecipMm > HEAVY_RAIN_MM;

  let factor = 1;
  if (hot) factor *= indoor ? HOT_INDOOR_SHORTEN_FACTOR : HOT_SHORTEN_FACTOR;
  if (rained) factor *= RAIN_EXTEND_FACTOR;
  if (careProfile.drought_tolerance === "high") factor *= DROUGHT_HIGH_FACTOR;
  else if (careProfile.drought_tolerance === "low") factor *= DROUGHT_LOW_FACTOR;

  const intervalDays = clamp(roundDays(base * factor));

  const anchorIso = input.lastWateredAt ?? input.lastAssessedAt;
  const anchor = anchorIso ? new Date(anchorIso) : now;
  const anchorMs = isNaN(anchor.getTime()) ? now.getTime() : anchor.getTime();
  const dueMs = anchorMs + intervalDays * DAY_MS;

  return {
    baseIntervalDays: base,
    intervalDays,
    nextWaterDueAt: new Date(dueMs).toISOString(),
    reason: buildReason({ hot, rained, weather, base, intervalDays }),
    isDue: now.getTime() >= dueMs,
    daysUntilDue: Math.ceil((dueMs - now.getTime()) / DAY_MS),
    weatherAdjusted: hot || rained,
  };
}

function buildReason(args: {
  hot: boolean;
  rained: boolean;
  weather: WeatherSummary | null;
  base: number;
  intervalDays: number;
}): string {
  const { hot, rained, weather, base, intervalDays } = args;
  const drivers: string[] = [];
  if (hot && weather) drivers.push(`Hot week (${Math.round(weather.maxTempC)}°C)`);
  if (rained && weather) drivers.push(`Heavy rain (${mm(weather.recentPrecipMm)}mm)`);

  // No weather driver: the interval is just the plant's own rhythm.
  if (drivers.length === 0) return `Every ${intervalDays} ${dayWord(intervalDays)}`;

  const diff = intervalDays - base;
  const tail =
    diff < 0
      ? `water ${-diff} ${dayWord(-diff)} sooner`
      : diff > 0
        ? `wait ${diff} ${dayWord(diff)} longer`
        : `no change to the usual ${intervalDays}-day rhythm`;
  return `${drivers.join(" · ")} — ${tail}`;
}

/** The care_profile jsonb read back from Postgres is untrusted (same rule as
 * the stored diagnosis): junk means "no profile", never bad math. */
export function parseStoredCareProfile(raw: unknown): CareProfile | null {
  const parsed = careProfileSchema.safeParse(raw);
  if (!parsed.success) {
    if (raw != null) {
      console.error("[parseStoredCareProfile] stored profile failed schema:", parsed.error.message);
    }
    return null;
  }
  return parsed.data;
}

/**
 * Ask the API to generate (or return) this plant's care profile — the one
 * Gemini call a plant ever makes for watering. Called fire-and-forget after
 * plant creation, so EVERY failure is silent and null: a plant without a
 * profile simply shows no watering guidance, and the next visit retries.
 */
export async function requestCareProfile(
  api: AuthorizedFetch,
  plantId: string,
): Promise<CareProfile | null> {
  try {
    const res = await api("/care-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plantId }),
    });
    if (!res.ok) {
      console.error("[requestCareProfile] request failed with status:", res.status);
      return null;
    }
    const body = (await res.json()) as { careProfile?: unknown };
    // The server Zod-validated Gemini's output before storing; this re-parse
    // guards the round trip with the same shared schema (assess.ts precedent).
    return parseStoredCareProfile(body.careProfile);
  } catch (e) {
    console.error("[requestCareProfile] request errored:", (e as Error).message);
    return null;
  }
}

/** plantId → ISO timestamp of the last "Watered today" tap. Local-only, like
 * photos (D-16): the phone owns it, nothing is synced. */
export type WateringLog = Record<string, string>;

export function markWatered(log: WateringLog, plantId: string, at: Date): WateringLog {
  return { ...log, [plantId]: at.toISOString() };
}

export function lastWateredAt(log: WateringLog, plantId: string): string | null {
  return log[plantId] ?? null;
}

export function parseWateringLog(json: string | null): WateringLog {
  if (!json) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const log: WateringLog = {};
  for (const [plantId, at] of Object.entries(raw)) {
    if (typeof at === "string" && !isNaN(new Date(at).getTime())) log[plantId] = at;
  }
  return log;
}

export function serializeWateringLog(log: WateringLog): string {
  return JSON.stringify(log);
}
