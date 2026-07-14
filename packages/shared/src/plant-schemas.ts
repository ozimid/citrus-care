import { z } from "zod";

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

