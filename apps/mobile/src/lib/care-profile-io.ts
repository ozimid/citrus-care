// D-17: generate a plant's F20 care profile on-device and store it. Thin
// orchestration (untested by policy) around the pure prompt/parse in
// care-profile-local.ts and the AsyncStorage write in plant-store-io. Every
// failure is swallowed to null — a plant without a profile simply shows no
// watering guidance, exactly as the old fire-and-forget server call behaved.

import type { CareProfile } from "@citrus/shared";
import {
  CARE_PROFILE_SYSTEM_PROMPT,
  buildCareProfileUserText,
  parseCareProfileOutput,
  type CareProfilePlant,
} from "./care-profile-local";
import { setPlantCareProfile } from "./plant-store-io";

/** Text-only generate closure (LocalEngineProvider.generate), narrowed to the
 * fields a care-profile call uses — no image. */
type TextGenerate = (req: { system: string; user: string }) => Promise<string>;

/** Generate the profile on-device (text-only) and, if it parses, store it on
 * the plant. Returns the profile (or null on any failure). */
export async function generateAndStoreCareProfile(
  generate: TextGenerate,
  plant: CareProfilePlant & { id: string },
): Promise<CareProfile | null> {
  try {
    const raw = await generate({
      system: CARE_PROFILE_SYSTEM_PROMPT,
      user: buildCareProfileUserText(plant),
    });
    const profile = parseCareProfileOutput(raw);
    if (profile) await setPlantCareProfile(plant.id, profile);
    return profile;
  } catch (e) {
    console.error("[care-profile-io] on-device generation failed:", (e as Error).message);
    return null;
  }
}
