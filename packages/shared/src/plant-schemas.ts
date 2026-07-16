import { z } from "zod";
import type { CareProfile } from "./types";

export const PLANT_TYPES = [
  "tree",
  "shrub",
  "flower",
  "succulent",
  "vegetable",
  "herb",
  "vine",
  "other",
] as const;

export const CITRUS_CULTIVARS = [
  "Meyer Lemon",
  "Eureka Lemon",
  "Lisbon Lemon",
  "Persian Lime",
  "Key Lime",
  "Kaffir Lime",
  "Valencia Orange",
  "Navel Orange",
  "Blood Orange",
  "Cara Cara Orange",
  "Mandarin",
  "Satsuma",
  "Clementine",
  "Tangerine",
  "Kumquat",
  "Grapefruit",
  "Pomelo",
  "Bergamot",
  "Yuzu",
  "Calamansi",
  "Other / Unknown",
] as const;

const trimmedString = (max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, "Required")
    .refine((s) => s.length <= max, `Max ${max} characters`);

const optionalString = (max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .transform((s) => (s.length === 0 ? null : s))
    .refine(
      (s) => s === null || s.length <= max,
      `Max ${max} characters`,
    );

export const newPlantSchema = z.object({
  name: trimmedString(80),
  plant_type: z.enum(PLANT_TYPES),
  species: optionalString(80).optional(),
  cultivar: optionalString(60).optional(),
  location: optionalString(80).optional(),
  zip_code: optionalString(10).optional(),
});

export type NewPlantInput = z.infer<typeof newPlantSchema>;

/**
 * F20 care profile (see CareProfile in types.ts). Guards two boundaries with
 * the same shape: Gemini's raw output server-side, and the stored jsonb read
 * back on the phone — neither is trusted.
 *
 * Deliberately tolerant where the model is likely to wobble but the value is
 * still usable (free-text length, non-integer day counts), strict where the
 * watering math would otherwise produce nonsense (interval range, enums).
 */
export const careProfileSchema: z.ZodType<CareProfile> = z.object({
  base_watering_interval_days: z.number().min(1).max(60),
  water_amount_note: z.string().max(300),
  sun: z.enum(["full", "partial", "shade"]),
  temp_min_c: z.number().min(-60).max(70),
  temp_max_c: z.number().min(-60).max(70),
  drought_tolerance: z.enum(["low", "medium", "high"]),
  indoor_ok: z.boolean(),
  notes: z.string().max(600),
});

