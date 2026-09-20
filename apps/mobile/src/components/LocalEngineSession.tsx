// The live on-device model session (D-15 Stage 2) — headless: it renders
// nothing and exists only to own react-native-executorch's useLLM hook,
// reporting status up and handing a generate() closure to the provider.
//
// Importing this module installs the executorch native runtime, which exists
// only in dev/EAS builds — so LocalEngineProvider imports it LAZILY and mounts
// it only after the user opts in. Everywhere else (Expo Go, opted-out users)
// this file is never evaluated, and a failure to load it degrades to
// "Setup failed" — retryable, exactly like any other local failure (D-17).

import { useEffect, useMemo } from "react";
import { initExecutorch, models, useLLM } from "react-native-executorch";
import { ExpoResourceFetcher } from "react-native-executorch-expo-resource-fetcher";
import type { LocalEngineRuntime } from "../lib/local-engine";
import type { ModelId } from "../lib/model-catalogue";

initExecutorch({ resourceFetcher: ExpoResourceFetcher });

/** THE single model swap point (F40): the registry entry for the model this
 * phone is set to run. Both are multimodal LLMs on the same hook — LFM2.5-VL
 * 450M (Liquid AI, xnnpack) or Gemma 4 E2B (Google, vulkan on Android) — so
 * the prompts, the FIFO mutex and the budget are unchanged by the choice.
 * Anything the catalogue doesn't recognise can't reach here: ModelId is the
 * only input, and model-catalogue's parse falls back to the default.
 *
 * Prompts and the go/no-go bar were tuned on Gemma; neither model has been
 * measured on real plant photos, which is exactly what the setup copy says. */
export function localModelFor(id: ModelId) {
  return id === "gemma4-e2b"
    ? models.llm.gemma4_e2b_multimodal()
    : models.llm.lfm2_5_vl_450m();
}

/** The Stage 1 measurement lab (VlmSpikeScreen) stays pinned to Gemma on
 * purpose: its numbers are only comparable against the model they were taken
 * on. The app itself never reads this — it goes through localModelFor(). */
export const LOCAL_MODEL = models.llm.gemma4_e2b_multimodal();

/** One generation request. `imageUri` set = a multimodal (diagnosis) call;
 * absent = a text-only (care-profile) call — both models are LLMs with vision,
 * so mediaPath is optional. The prompts live in the pure lib modules and are
 * passed in, keeping this session dumb and stateless per call. */
export interface LocalGenerateRequest {
  system: string;
  user: string;
  imageUri?: string;
}

export type LocalGenerate = (req: LocalGenerateRequest) => Promise<string>;

interface Props {
  /** Which model to load. The provider remounts this component when it
   * changes, so a session never straddles two models. */
  modelId: ModelId;
  onRuntime: (runtime: LocalEngineRuntime) => void;
  /** Registers (or clears) the generate closure the router / care profile call. */
  onGenerate: (fn: LocalGenerate | null) => void;
  /** Registers (or clears) interrupt() — frees the session at the hard ceiling. */
  onInterrupt: (fn: (() => void) | null) => void;
}

export function LocalEngineSession({ modelId, onRuntime, onGenerate, onInterrupt }: Props) {
  // useLLM reloads on the model's source strings, not on object identity, but
  // memoizing keeps the hook's dependency list quiet and the intent obvious.
  const model = useMemo(() => localModelFor(modelId), [modelId]);
  const llm = useLLM({ model });

  useEffect(() => {
    onRuntime({
      isReady: llm.isReady,
      downloadProgress: llm.downloadProgress,
      error: llm.error ?? null,
    });
  }, [llm.isReady, llm.downloadProgress, llm.error, onRuntime]);

  useEffect(() => {
    if (llm.error) console.error("[LocalEngineSession] model load failed:", String(llm.error));
  }, [llm.error]);

  useEffect(() => {
    onInterrupt(() => llm.interrupt());
    return () => onInterrupt(null);
  }, [llm, onInterrupt]);

  useEffect(() => {
    if (!llm.isReady) {
      onGenerate(null);
      return;
    }
    // generate() over sendMessage(): stateless per call, so no request carries
    // context (or latency) from the previous one. mediaPath only when an image
    // is supplied — a care-profile call is pure text on the same model.
    onGenerate(({ system, user, imageUri }) =>
      llm.generate([
        { role: "system", content: system },
        { role: "user", content: user, ...(imageUri ? { mediaPath: imageUri } : {}) },
      ]),
    );
    return () => onGenerate(null);
  }, [llm, llm.isReady, onGenerate]);

  return null;
}
