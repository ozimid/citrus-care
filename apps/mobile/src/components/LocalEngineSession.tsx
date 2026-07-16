// The live on-device model session (D-15 Stage 2) — headless: it renders
// nothing and exists only to own react-native-executorch's useLLM hook,
// reporting status up and handing a generate() closure to the provider.
//
// Importing this module installs the executorch native runtime, which exists
// only in dev/EAS builds — so LocalEngineProvider imports it LAZILY and mounts
// it only after the user opts in. Everywhere else (Expo Go, opted-out users)
// this file is never evaluated, and a failure to load it degrades to
// "Setup failed" → Gemini, exactly like any other local failure.

import { useEffect } from "react";
import { initExecutorch, models, useLLM } from "react-native-executorch";
import { ExpoResourceFetcher } from "react-native-executorch-expo-resource-fetcher";
import { LOCAL_USER_PROMPT, type LocalEngineRuntime } from "../lib/local-engine";
import { SPIKE_SYSTEM_PROMPT } from "../lib/spike-vlm";

initExecutorch({ resourceFetcher: ExpoResourceFetcher });

/** Gemma 4 E2B multimodal (~1.3 GB quantized, Apache 2.0) — the research
 * doc's pick; vulkan on Android, mlx on iOS, resolved by the model registry.
 * Same model the Stage 1 spike measured against the go/no-go bar. */
const LOCAL_MODEL = models.llm.gemma4_e2b_multimodal();

export type LocalGenerate = (args: { imageUri: string }) => Promise<string>;

interface Props {
  onRuntime: (runtime: LocalEngineRuntime) => void;
  /** Registers (or clears) the generate closure the assess router calls. */
  onGenerate: (fn: LocalGenerate | null) => void;
}

export function LocalEngineSession({ onRuntime, onGenerate }: Props) {
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
    if (!llm.isReady) {
      onGenerate(null);
      return;
    }
    // generate() over sendMessage(): stateless per photo, so one diagnosis
    // never carries context (or latency) from the previous one.
    // One prompt, no mode (F21): the model reports the subject it saw.
    onGenerate(({ imageUri }) =>
      llm.generate([
        { role: "system", content: SPIKE_SYSTEM_PROMPT },
        { role: "user", content: LOCAL_USER_PROMPT, mediaPath: imageUri },
      ]),
    );
    return () => onGenerate(null);
  }, [llm, llm.isReady, onGenerate]);

  return null;
}
