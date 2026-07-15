# On-device vision LLM in the native app (React Native / Expo) — July 2026

**Question:** can the phone analyze plant photos locally (the product's original architecture), escalating to Gemini only for hard cases?

**Verdict: viable but bleeding-edge — proceed as an evidence-gated spike, keep Gemini as the escalation path from day one.**

## Recommended path (Android first)

- **Runtime:** [`react-native-executorch`](https://docs.swmansion.com/react-native-executorch/) (Software Mansion, ≥ v0.8.0, Apr 2026) — the only purpose-built RN library with a declarative multimodal `useLLM` hook (`imagePath` + text). Cross-platform via ExecuTorch. Needs an EAS dev build (config plugin / prebuild) — not Expo Go.
- **Model:** **Gemma 4 E2B** — ~1.3 GB quantized, native image input, **Apache 2.0** (clean for distribution; avoid Gemma 3n's custom terms + pass-through use policy). Lighter fallback: LFM2.5-VL 450M/1.6B.
- **Model delivery:** runtime download on WiFi via the library's resource fetcher, cached locally — never bundled in the APK.
- **Latency discipline:** never feed the 1600px pipeline image to the local model — downscale long edge to **~512px** for on-device input (full-res balloons latency to minutes; 512px → seconds). Budget **~3–10 s/photo** on a Galaxy Z Fold-class flagship; init the session early and reuse it.
- **Fallback runtime** if executorch disappoints: `llama.rn` (llama.cpp; GGUF + `mmproj` vision — Gemma 3n, SmolVLM, Qwen3-VL; works with Expo via `expo-build-properties` flags, Adreno GPU/Hexagon NPU support). More manual.
- **Avoid:** MediaPipe LLM Inference API — maintenance mode, no RN binding (highest custom-native effort).

## iOS (deferred)

Apple Foundation Models framework (WWDC 2026) accepts on-device image attachments and exposes a `LanguageModel` protocol with Apple/Gemini/Claude conformers — iOS can use the built-in model natively, or share the executorch build.

## Router pattern (Stage 2)

On-device-first with confidence-based escalation is established practice: escalate to the cloud model when calibrated confidence/token-entropy is low, output fails schema validation, or the user requests a second opinion. Keep the router a cheap heuristic, not another model call.

## Go/no-go bar for the Stage 1 spike (agreed before building)

On the user's Galaxy Z Fold, dev build, Gemma 4 E2B @512px input:
- Model download+first session init ≤ 90 s on WiFi (one-time), warm init ≤ 10 s
- Single-photo diagnosis prompt ≤ 15 s
- No OOM/crash across 5 consecutive analyses
- Output parses into `AssessmentDiagnosis` (shared Zod schema) with plausible content on ≥ 3 of 5 real plant photos
NO-GO → record outcome, Gemini stays primary, revisit on the next executorch/Gemma release.

## Sources

- https://swmansion.com/blog/react-native-executorch-v0.8.0-a-library-milestone/
- https://docs.swmansion.com/react-native-executorch/docs/hooks/natural-language-processing/useLLM
- https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/ (Gemma 4, Apache 2.0)
- https://ai.google.dev/gemma/terms (Gemma 3n custom terms — why we prefer Gemma 4)
- https://medium.com/commencis/on-device-ai-with-gemma-3n-on-android-offline-inference-prototype-2a17a44d1c90 (512px latency discipline)
- https://github.com/mybigday/llama.rn/blob/main/README.md (fallback runtime)
- https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference/android (avoided path)
- https://developer.apple.com/videos/play/wwdc2026/241/ (iOS Foundation Models)
- https://tianpan.co/blog/2026-04-10-hybrid-cloud-edge-llm-inference-when-to-run-on-device (router pattern)
