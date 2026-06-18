import { z } from "zod";

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

export const newTreeSchema = z.object({
  name: trimmedString(80),
  cultivar: optionalString(60).optional(),
  location: optionalString(80).optional(),
});

export type NewTreeInput = z.infer<typeof newTreeSchema>;
