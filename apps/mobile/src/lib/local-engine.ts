// On-device engine (D-15 Stage 2), pure half: the opt-in setting + the
// state machine that turns the executorch session's runtime status into a
// Profile row. Off by default — a multi-gigabyte model download is never
// started unasked (docs/research/on-device-vlm-native.md). The AsyncStorage
// wiring is the thin local-engine-io.ts; the executorch session itself lives
// in components/LocalEngineSession.tsx (native, dev-build only).
//
// F40: the model is the user's choice, so every string here that states a size
// takes a ModelId and reads model-catalogue.ts. NO size is written by hand in
// this file — that is exactly how the app came to promise "~1.3 GB download ·
// needs ~2 GB free" for a download three times that big.

import {
  LEGACY_MODEL_ID,
  formatModelBytes,
  hasRoomFor,
  modelSpec,
  type ModelId,
} from "./model-catalogue";
import { SPIKE_USER_PROMPT } from "./spike-vlm";

export const LOCAL_ENGINE_STORAGE_KEY = "citrus.local-engine.v1";

/** Present in AsyncStorage = the last model load never reported back — the
 * process died mid-load (native OOM/driver crash bypasses all JS handling).
 * The next launch sees it and refuses to auto-mount (P0: S23 crash loop). */
export const LOAD_SENTINEL_STORAGE_KEY = "citrus.engine-load-sentinel.v1";

/** Everything a user should know BEFORE the download: the measured size, the
 * free space it really needs, and the D-17 deal stated plainly — this model is
 * the only engine, so nothing is ever sent off the phone and nothing covers
 * for it either. The RAM rule of thumb deliberately is NOT here any more:
 * deviceCapability gives the same verdict against the phone's actual reading,
 * which beats a generic number in a sentence. */
export function localModelRequirements(id: ModelId): string {
  const spec = modelSpec(id);
  return (
    `~${spec.sizeLabel} download · needs ${spec.requiredFreeLabel} free · Android 10+ · ` +
    `does every assessment on this phone — nothing is ever sent anywhere`
  );
}

/** Shown before the first download so the size/network cost is a choice. */
export function localModelDownloadWarning(id: ModelId): string {
  const spec = modelSpec(id);
  return (
    `Downloads ${spec.label} — ${spec.sizeLabel} over WiFi (once). This model does every ` +
    `assessment: your photos are analyzed on this phone and nothing is sent anywhere, ever. ` +
    `If an analysis fails, you just retry — there is no fallback.` +
    `\n\n${localModelRequirements(id)}`
  );
}

/** F22 precheck: is there room for THIS model? `null`/NaN means the free-space
 * read failed — never block on that. A precheck that can't read the disk must
 * not become a second failure mode; the download itself is the backstop. */
export function hasRoomForLocalModel(id: ModelId, availableBytes: number | null): boolean {
  return hasRoomFor(id, availableBytes);
}

/** Said once, in the Alert, with the user's actual number — in the catalogue's
 * unit convention, so the requirement and the reading are comparable. Not an
 * error: a phone that is full is a fact about the phone, not a fault to log. */
export function insufficientStorageMessage(
  id: ModelId,
  availableBytes: number,
  /** The model that WOULD fit (modelThatFits). Passing it turns a dead end
   * into a choice: "go delete photos" is the wrong only-option when the app's
   * own lighter model installs on the space the phone already has. */
  alternative?: ModelId | null,
): string {
  const spec = modelSpec(id);
  const base =
    `${spec.label} needs about ${spec.requiredFreeLabel} free — you have ` +
    `${formatModelBytes(availableBytes)}. Free some space and try again — ` +
    `assessments can't run without it.`;
  if (!alternative || alternative === id) return base;
  const alt = modelSpec(alternative);
  return (
    `${base}\n\n${alt.label} would fit — it needs ${alt.requiredFreeLabel} free ` +
    `(${alt.sizeLabel} to download).`
  );
}

/** Are this model's weights already on this phone?
 *
 * `downloadedIds` is a best-effort disk listing: it degrades to [] on any read
 * failure and is [] until the async read lands. Reading that as "nothing is
 * downloaded" hard-blocks a pre-F40 Gemma user behind a ~6 GB free-space check
 * for a download that would never happen — so an EMPTY list falls back to the
 * old persisted flag, which could only ever have meant Gemma. A non-empty list
 * is a successful read, and absence from it is real absence. */
export function modelWeightsLikelyPresent(
  id: ModelId,
  downloadedIds: readonly ModelId[],
  settings: LocalEngineSettings,
): boolean {
  if (downloadedIds.includes(id)) return true;
  return downloadedIds.length === 0 && settings.downloaded && id === LEGACY_MODEL_ID;
}

export interface LocalEngineSettings {
  /** The user's opt-in. Off means the model is never loaded — and since it is
   * the only engine (D-17), assessments don't run. */
  enabled: boolean;
  /** True once the model has finished downloading on this phone — suppresses
   * the size warning on re-enable (the files survive a disable). */
  downloaded: boolean;
}

export const DEFAULT_LOCAL_ENGINE_SETTINGS: LocalEngineSettings = {
  enabled: false,
  downloaded: false,
};

/** Stored settings are untrusted: anything malformed degrades to "off", the
 * safe default (never start a gigabyte-scale download on a guess — the assess
 * flow tells the user how to set the engine up). Never throws. */
export function parseLocalEngineSettings(json: string | null): LocalEngineSettings {
  if (!json) return DEFAULT_LOCAL_ENGINE_SETTINGS;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return DEFAULT_LOCAL_ENGINE_SETTINGS;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return DEFAULT_LOCAL_ENGINE_SETTINGS;
  }
  const r = raw as Record<string, unknown>;
  return {
    enabled: r.enabled === true,
    downloaded: r.downloaded === true,
  };
}

export function serializeLocalEngineSettings(settings: LocalEngineSettings): string {
  return JSON.stringify(settings);
}

export function needsDownloadWarning(settings: LocalEngineSettings): boolean {
  return !settings.downloaded;
}

/** Structural slice of react-native-executorch's useLLM return value — the
 * only three fields the state machine needs, so this module stays pure. */
export interface LocalEngineRuntime {
  isReady: boolean;
  /** 0..1 from the library's resource fetcher. */
  downloadProgress: number;
  error: unknown;
}

export type LocalEngineState =
  | { kind: "off" }
  | { kind: "downloading"; percent: number }
  | { kind: "crashed" }
  | { kind: "preparing" }
  | { kind: "ready" }
  | { kind: "failed" };

/** settings + session status → what the Profile row shows and whether an
 * assessment can run at all. `runtime` is null while the (lazily imported)
 * session component hasn't mounted yet. */
export function localEngineState(
  settings: LocalEngineSettings,
  runtime: LocalEngineRuntime | null,
  crashedLastLoad = false,
): LocalEngineState {
  if (!settings.enabled) return { kind: "off" };
  // A stale load sentinel means the previous mount crashed the whole process —
  // stay unmounted and honest until the user explicitly retries.
  if (crashedLastLoad) return { kind: "crashed" };
  if (!runtime) return { kind: "preparing" };
  // Error wins over isReady: a session that errored can't be trusted to infer.
  if (runtime.error) return { kind: "failed" };
  if (runtime.isReady) return { kind: "ready" };
  const p = runtime.downloadProgress;
  if (p > 0 && p < 1) {
    return { kind: "downloading", percent: Math.min(100, Math.max(0, Math.round(p * 100))) };
  }
  return { kind: "preparing" };
}

/** The single gate the assess flow asks: a diagnosis only runs when the
 * session is actually loaded. Every other state means no assessment — an
 * honest, retryable "not ready" error, never a fallback (D-17). */
export function shouldRouteLocal(state: LocalEngineState): boolean {
  return state.kind === "ready";
}

export function localEngineStatusLabel(state: LocalEngineState): string {
  switch (state.kind) {
    case "off":
      return "Off";
    case "downloading":
      return `Downloading ${state.percent}%`;
    case "preparing":
      return "Preparing…";
    case "ready":
      return "Ready";
    case "crashed":
      return "Stopped after a crash";
    case "failed":
      return "Setup failed";
  }
}

/** F33 pre-flight capability verdict, computed BEFORE the download. Inputs
 * injected (expo-device reads live in the io half) so this stays pure.
 * F40: the RAM bar comes from the chosen model's `minRamBytes` — a 450M model
 * runs on phones a multi-gigabyte one never will, so one global threshold
 * would either block capable phones or wave through doomed ones.
 * Honest limits of the check: total RAM is a coarse gate — it catches phones
 * that were never going to work, but a passing phone can still fail at load
 * (runtime/driver class failures, e.g. the S23 report). That first load is
 * crash-sentinel-protected, so trying is safe. Unknown readings never block.
 *
 * `id` is required, not defaulted: the RAM bar and the wasted-download size
 * are the chosen model's, and a caller that forgot which model it is asking
 * about would quietly quote the wrong one — the bug this feature exists to
 * kill. */
export function deviceCapability(
  totalMemoryBytes: number | null,
  androidApiLevel: number | null,
  id: ModelId,
): { level: "ok" | "warn" | "block"; reason: string | null } {
  const spec = modelSpec(id);
  const EDGE_BAND_BYTES = 2 * 1024 ** 3;
  if (totalMemoryBytes !== null && totalMemoryBytes < spec.minRamBytes) {
    return {
      level: "block",
      reason:
        `This phone doesn't have enough memory (RAM) for ${spec.label} — the download would ` +
        `only waste ${spec.sizeLabel}. Everything else in the app still works.`,
    };
  }
  if (totalMemoryBytes !== null && totalMemoryBytes < spec.minRamBytes + EDGE_BAND_BYTES) {
    return {
      level: "warn",
      reason:
        "This phone's memory is on the edge for the on-device AI. You can try — the app recovers safely if it doesn't work.",
    };
  }
  if (androidApiLevel !== null && androidApiLevel < 29) {
    return {
      level: "warn",
      reason:
        "This Android version is older than the AI runtime is tested on. You can try — the app recovers safely if it doesn't work.",
    };
  }
  return { level: "ok", reason: null };
}

/** F28 first-run guidance: the Plants screen offers the model download BEFORE
 * the user walks the add-plant → photo → analyze funnel into a not-ready
 * error (friend feedback 2026-07-16). Null once ready — the card vanishes. */
export function firstRunSetupCard(
  state: LocalEngineState,
  id: ModelId,
): { title: string; body: string; cta: "enable" | "retry" | null } | null {
  const spec = modelSpec(id);
  switch (state.kind) {
    case "off":
      return {
        title: "Set up the plant doctor",
        body:
          `One-time download of ${spec.label} (${spec.sizeLabel}, Wi-Fi recommended). ` +
          `After that, every diagnosis runs right on your phone — nothing leaves it.`,
        cta: "enable",
      };
    case "downloading":
      return {
        title: `Downloading the AI — ${state.percent}%`,
        body: "Keep the app open — the screen stays awake until it finishes. Assessments unlock the moment it does.",
        cta: null,
      };
    case "preparing":
      return { title: "Getting the AI ready…", body: "A few seconds.", cta: null };
    // Both recovery states have a fix the retry button cannot reach: the
    // other model. "Didn't finish" is usually disk, "crashed" is usually
    // memory, and the light model asks for far less of both — so the chooser
    // stays on screen here and the copy points at it.
    case "failed":
      return {
        title: "AI setup didn't finish",
        body: "Check free space and your connection, then try again — or choose the other model below.",
        cta: "retry",
      };
    case "crashed":
      return {
        title: "The AI crashed this phone last time",
        body: "It may not have enough free memory. Close other apps and retry, or switch to the smaller model below — it asks for less memory. You can also leave it off; the rest of the app works without it.",
        cta: "retry",
      };
    case "ready":
      return null;
  }
}

/** Row subtitle. Honest about the two things a user can't see: disabling keeps
 * the downloaded files, and a failed/off engine means assessments don't run at
 * all — there is no fallback (D-17). */
export function localEngineSubtitle(
  state: LocalEngineState,
  settings: LocalEngineSettings,
  id: ModelId,
): string {
  const spec = modelSpec(id);
  switch (state.kind) {
    case "off":
      return settings.downloaded
        ? "Assessments are paused while this is off. The downloaded model stays on this phone — turn this back on any time, or remove it to free the space."
        : `Assessments run entirely on this phone and need this model. First use downloads ${spec.sizeLabel} over WiFi.`;
    case "downloading":
      return `Downloading ${spec.sizeLabel} over WiFi — one time. Assessments will work as soon as it finishes.`;
    case "preparing":
      return "Starting the on-device model…";
    case "ready":
      return "Photos are analyzed on this phone — nothing is sent anywhere, ever.";
    case "crashed":
      return "Loading the model crashed the app last time — this phone may not have enough free memory. The rest of the app works without it. Tap to try again.";
    case "failed":
      return "Couldn't set up the on-device model — assessments can't run until this is fixed. Tap to try again.";
  }
}

// F21 removed localSystemPrompt(isCutCare): with the prompt unified there is
// no mode to specialize on, so the session sends SPIKE_SYSTEM_PROMPT as-is —
// the cut framing lives inside it and applies when the model reads a cut.

export const LOCAL_USER_PROMPT = SPIKE_USER_PROMPT;
