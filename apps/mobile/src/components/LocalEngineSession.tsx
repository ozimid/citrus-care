// The live on-device model session (D-15 Stage 2) — headless: it renders
// nothing and exists only to own react-native-executorch's useLLM hook,
// reporting status up and handing a generate() closure to the provider.
//
// Importing this module installs the executorch native runtime, which exists
// only in dev/EAS builds — so LocalEngineProvider imports it LAZILY and mounts
// it only after the user opts in. Everywhere else (Expo Go, opted-out users)
// this file is never evaluated, and a failure to load it degrades to
// "Setup failed" — retryable, exactly like any other local failure (D-17).

import { useEffect } from "react";
import { initExecutorch, models, useLLM } from "react-native-executorch";
import { ExpoResourceFetcher } from "react-native-executorch-expo-resource-fetcher";
import type { LocalEngineRuntime } from "../lib/local-engine";

initExecutorch({ resourceFetcher: ExpoResourceFetcher });

/** Gemma 4 E2B multimodal (~1.3 GB quantized, Apache 2.0) — the research
 * doc's pick; vulkan on Android, mlx on iOS, resolved by the model registry.
 * Same model the Stage 1 spike measured against the go/no-go bar.
 *
 * THE single model swap point: the spike screen imports this constant, so a
 * future substitution (a newer multimodal registry entry, or a self-hosted
 * .pte via a custom source) changes app + measurement lab together. Prompts
 * and the go/no-go bar are tuned per model — re-run the spike before shipping
 * a swap. */
export const LOCAL_MODEL = models.llm.gemma4_e2b_multimodal();

/** One generation request. `imageUri` set = a multimodal (diagnosis) call;
 * absent = a text-only (care-profile) call — Gemma 4 is an LLM with vision, so
 * mediaPath is optional. The prompts live in the pure lib modules and are
 * passed in, keeping this session dumb and stateless per call. */
export interface LocalGenerateRequest {
  system: string;
  user: string;
  imageUri?: string;
}

export type LocalGenerate = (req: LocalGenerateRequest) => Promise<string>;

interface Props {
  onRuntime: (runtime: LocalEngineRuntime) => void;
  /** Registers (or clears) the generate closure the router / care profile call. */
  onGenerate: (fn: LocalGenerate | null) => void;
  /** Registers (or clears) interrupt() — frees the session at the hard ceiling. */
  onInterrupt: (fn: (() => void) | null) => void;
}

export function LocalEngineSession({ onRuntime, onGenerate, onInterrupt }: Props) {
  const llm = useLLM({ model: LOCAL_MODEL });

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
