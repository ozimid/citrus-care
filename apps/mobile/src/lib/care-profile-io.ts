// D-17: generate a plant's F20 care profile on-device and store it. Thin
// orchestration (untested by policy) around the pure prompt/parse in
// care-profile-local.ts and the AsyncStorage write in plant-store-io. Every
// failure is swallowed to null — a plant without a profile simply shows no
// watering guidance, exactly as the old fire-and-forget server call behaved.

import type { CareProfile } from "@citrus/shared";
import {
  LOCAL_HARD_CEILING_MS,
  LOCAL_SLOW_THRESHOLD_MS,
  withInferenceBudget,
} from "./inference-budget";
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

export interface CareProfileEngine {
  generate: TextGenerate;
  /** Free the native session at the ceiling (best-effort). */
  interrupt?: () => void;
}

/**
 * Generate the profile on-device (text-only) and, if it parses, store it on the
 * plant. Returns the profile (or null on any failure).
 *
 * The budget is not optional bookkeeping. Every caller of the shared session
 * must run under the SAME ceiling, because the provider's FIFO queue means each
 * request's clock starts when it is enqueued: with equal ceilings the earliest
 * one always expires first, which is always the one currently running, so an
 * interrupt can only ever hit its own request. One unbudgeted caller breaks
 * that — it can hold the session past another request's ceiling and take the
 * interrupt meant for itself. This call is the one that used to.
 */
export async function generateAndStoreCareProfile(
  engine: CareProfileEngine,
  plant: CareProfilePlant & { id: string },
): Promise<CareProfile | null> {
  try {
    const raw = await withInferenceBudget(
      engine.generate({
        system: CARE_PROFILE_SYSTEM_PROMPT,
        user: buildCareProfileUserText(plant),
      }),
      {
        slowMs: LOCAL_SLOW_THRESHOLD_MS,
        hardMs: LOCAL_HARD_CEILING_MS,
        onHardTimeout: () => engine.interrupt?.(),
      },
    );
    const profile = parseCareProfileOutput(raw);
    if (profile) await setPlantCareProfile(plant.id, profile);
    return profile;
  } catch (e) {
    console.error("[care-profile-io] on-device generation failed:", (e as Error).message);
    return null;
  }
}
