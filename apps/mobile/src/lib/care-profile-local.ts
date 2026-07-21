// D-17: the F20 care profile, generated ON-DEVICE. Ported from the server
// prompt (apps/api/src/gemini.ts buildCareProfile*), trimmed for a ~2B model —
// a text-only Gemma call (no image), text-in / JSON-out. The small local model
// has no responseSchema enforcement, so the tolerant extractor (shared with the
// diagnosis path) + the shared careProfileSchema is the only gate: junk
// degrades to null (no watering guidance), never bad math on a bad baseline.

import { careProfileSchema, type CareProfile } from "@citrus/shared";
import { extractJsonCandidate } from "./spike-vlm";

/** Just the plant identity the profile is derived from. */
export interface CareProfilePlant {
  name: string;
  plant_type: string;
  species: string | null;
  cultivar: string | null;
  location: string | null;
  zip_code: string | null;
}

export const CARE_PROFILE_SYSTEM_PROMPT = `You are a plant care expert. Given a plant's identity, produce a concise, practical watering/care baseline for a home grower.

Rules:
- base_watering_interval_days: the interval in FAIR weather for an established plant in normal soil. Be realistic per species: succulents/cacti 14-30, most trees and shrubs 5-10, herbs and vegetables 1-3, tropical foliage 5-8.
- temp_min_c / temp_max_c: the comfortable range in Celsius. Above temp_max_c the plant is heat-stressed; below temp_min_c it is cold-stressed. Stress thresholds, NOT survival limits.
- drought_tolerance: "high" = stores water, forgives a missed watering (succulent, olive, rosemary); "low" = wilts fast (fern, hydrangea, basil).
- indoor_ok: true only if the plant genuinely thrives indoors year-round.
- water_amount_note: how much per watering, concrete (volume or "until it drains"). <= 140 characters.
- notes: one or two sentences of the single most useful watering/siting habit. <= 300 characters.
- Base the numbers on the species/cultivar given. If vague, choose a sensible middle-of-the-road baseline, not an extreme.
- difficulty: how demanding this plant is for a home grower — "easy", "moderate" or "hard".
- mature_size_note: typical mature size in plain words, e.g. "3-10 ft tall, up to 20 ft spread". <= 110 characters.
- flowering_months / fruiting_months: month NUMBERS (1=Jan .. 12=Dec) typical for a temperate northern-hemisphere climate; [] when not applicable.

Respond with VALID JSON ONLY — no prose, no markdown fences — exactly this shape:
{
  "base_watering_interval_days": <number 1..60>,
  "water_amount_note": "...",
  "sun": "full|partial|shade",
  "temp_min_c": <number>,
  "temp_max_c": <number>,
  "drought_tolerance": "low|medium|high",
  "indoor_ok": <boolean>,
  "notes": "...",
  "difficulty": "easy|moderate|hard",
  "mature_size_note": "...",
  "flowering_months": [<numbers 1..12>],
  "fruiting_months": [<numbers 1..12>]
}`;

export function buildCareProfileUserText(plant: CareProfilePlant): string {
  const lines: string[] = [`Plant Name: ${plant.name}`, `Plant Type: ${plant.plant_type}`];
  if (plant.species) lines.push(`Species: ${plant.species}`);
  if (plant.cultivar) lines.push(`Cultivar: ${plant.cultivar}`);
  if (plant.location) lines.push(`Location: ${plant.location}`);
  if (plant.zip_code) lines.push(`ZIP Code: ${plant.zip_code}`);
  lines.push("", "Return the care profile JSON as specified.");
  return lines.join("\n");
}

/** Extract → JSON.parse → shared Zod schema. Null on any failure (no-json,
 * invalid-json, schema-mismatch) — the caller treats null as "no profile yet". */
export function parseCareProfileOutput(text: string): CareProfile | null {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(candidate);
  } catch {
    return null;
  }
  const parsed = careProfileSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
