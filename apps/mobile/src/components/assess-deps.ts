// Wires the assess flow (lib/assess.ts) to the real photo store, the on-device
// session and the local assessment store. Lives in components, NOT src/lib, on
// purpose: it holds the one `localEngine.generate(` closure, and arch-guard's
// D-P9 sweep treats any src/lib module that calls the model as a flow that must
// carry its own inference budget. This is wiring — the budget runs inside
// runAssess. Size and context are per call so a batch runner can build
// per-photo deps from the same production wiring.

import type { AssessDeps, LocalAssessDeps } from "../lib/assess";
import { LOCAL_USER_PROMPT } from "../lib/local-engine";
import { persistLocalAssessment } from "../lib/local-engine-io";
import { SPIKE_MAX_DIMENSION } from "../lib/photo";
import { downscalePhoto } from "../lib/photo-io";
import { linkPhotoToAssessment, savePlantPhoto } from "../lib/photo-store-io";
import { SPIKE_SYSTEM_PROMPT } from "../lib/spike-vlm";
import type { LocalEngineContextValue } from "./LocalEngineProvider";

/**
 * @param size the photo's already-known dimensions (the saved copy shares them)
 * @param context the plant's own record folded into the prompt ("" for none —
 *   snap-first, or a plant whose record couldn't be read)
 * @param overrides a batch swaps `persist` for one with its own anchor/cover
 *   options; everything else stays the production wiring
 */
export function buildAssessDeps(
  localEngine: LocalEngineContextValue,
  size: { width: number; height: number },
  context: string,
  overrides?: { persist?: LocalAssessDeps["persist"] },
): AssessDeps {
  return {
    savePhoto: savePlantPhoto,
    linkPhoto: linkPhotoToAssessment,
    local: {
      isReady: localEngine.isReady,
      // 512px long edge for the local model (full-res turns seconds into
      // minutes — research doc).
      prepare: async (uri) => (await downscalePhoto(uri, size, SPIKE_MAX_DIMENSION)).uri,
      // The diagnosis prompts live in the pure lib modules; the session is
      // given them per call (F21: one prompt, the model reports subject).
      generate: ({ imageUri }) =>
        localEngine.generate({
          system: SPIKE_SYSTEM_PROMPT,
          user: context ? `${LOCAL_USER_PROMPT}\n\n${context}` : LOCAL_USER_PROMPT,
          imageUri,
        }),
      interrupt: localEngine.interrupt,
      // The phone inserts the row itself into the local store.
      persist: overrides?.persist ?? persistLocalAssessment,
    },
  };
}
