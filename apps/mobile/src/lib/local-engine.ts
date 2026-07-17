// On-device engine (D-15 Stage 2), pure half: the opt-in setting + the
// state machine that turns the executorch session's runtime status into a
// Profile row. Off by default — the 1.3 GB Gemma 4 E2B download is never
// started unasked (docs/research/on-device-vlm-native.md). The AsyncStorage
// wiring is the thin local-engine-io.ts; the executorch session itself lives
// in components/LocalEngineSession.tsx (native, dev-build only).

import { SPIKE_USER_PROMPT } from "./spike-vlm";

export const LOCAL_ENGINE_STORAGE_KEY = "citrus.local-engine.v1";

/** Quantized Gemma 4 E2B, per the research doc's model choice. */
export const LOCAL_MODEL_SIZE_LABEL = "1.3 GB";

/** F22 — free space the precheck demands before starting the download: the
 * 1.3 GB payload plus room to unpack/cache it without wedging the phone.
 * Deliberately storage-only. There is NO RAM gate: expo-device's totalMemory
 * reports total, not available (false precision), it would cost a new native
 * build, and a phone that truly can't run the model already fails honestly at
 * assess time with a retryable error — a wrong guess here would block capable
 * phones for good. */
export const LOCAL_MODEL_REQUIRED_FREE_BYTES = 2 * 1024 * 1024 * 1024;

/** Everything a user should know BEFORE a 1.3 GB download. Size and the 512px
 * latency discipline come from docs/research/on-device-vlm-native.md; the free
 * space is LOCAL_MODEL_REQUIRED_FREE_BYTES. The RAM/OS line is a rule of thumb
 * (the doc's only device data point is a Galaxy Z Fold-class flagship); the
 * last clause is the D-17 deal stated plainly — this model is the only engine,
 * so nothing is ever sent off the phone, and nothing covers for it either. */
export const LOCAL_MODEL_REQUIREMENTS =
  `~${LOCAL_MODEL_SIZE_LABEL} download · needs ~2 GB free · works best on 8 GB+ RAM, Android 10+ · ` +
  `does every assessment on this phone — nothing is ever sent anywhere`;

/** Shown before the first download so the size/network cost is a choice. */
export const LOCAL_MODEL_DOWNLOAD_WARNING =
  `Downloads a ${LOCAL_MODEL_SIZE_LABEL} model over WiFi (once). This model does every assessment: ` +
  `your photos are analyzed on this phone and nothing is sent anywhere, ever. ` +
  `If an analysis fails, you just retry — there is no fallback.` +
  `\n\n${LOCAL_MODEL_REQUIREMENTS}`;

/** "1.4 GB" — GB as everyone's storage settings mean it. */
export function formatGigabytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return `${Number(gb.toFixed(1))} GB`;
}

/** F22 precheck: is there room for the model? `null`/NaN means the free-space
 * read failed — never block on that. A precheck that can't read the disk must
 * not become a second failure mode; the download itself is the backstop. */
export function hasRoomForLocalModel(availableBytes: number | null): boolean {
  if (availableBytes === null || Number.isNaN(availableBytes)) return true;
  return availableBytes >= LOCAL_MODEL_REQUIRED_FREE_BYTES;
}

/** Said once, in the Alert, with the user's actual number. Not an error — a
 * phone that is full is a fact about the phone, not a fault to log. */
export function insufficientStorageMessage(availableBytes: number): string {
  return (
    `The on-device model needs about 2 GB free — you have ${formatGigabytes(availableBytes)}. ` +
    `Free some space and try again — assessments can't run without it.`
  );
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
 * safe default (never start a 1.3 GB download on a guess — the assess flow
 * tells the user how to set the engine up). Never throws. */
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
  | { kind: "preparing" }
  | { kind: "ready" }
  | { kind: "failed" };

/** settings + session status → what the Profile row shows and whether an
 * assessment can run at all. `runtime` is null while the (lazily imported)
 * session component hasn't mounted yet. */
export function localEngineState(
  settings: LocalEngineSettings,
  runtime: LocalEngineRuntime | null,
): LocalEngineState {
  if (!settings.enabled) return { kind: "off" };
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
    case "failed":
      return "Setup failed";
  }
}

/** Row subtitle. Honest about the two things a user can't see: disabling keeps
 * the downloaded files, and a failed/off engine means assessments don't run at
 * all — there is no fallback (D-17). */
/** F28 first-run guidance: the Plants screen offers the model download BEFORE
 * the user walks the add-plant → photo → analyze funnel into a not-ready
 * error (friend feedback 2026-07-16). Null once ready — the card vanishes. */
export function firstRunSetupCard(
  state: LocalEngineState,
): { title: string; body: string; cta: "enable" | "retry" | null } | null {
  switch (state.kind) {
    case "off":
      return {
        title: "Set up the plant doctor",
        body: "One-time download of the on-device AI (~1.3 GB, Wi-Fi recommended). After that, every diagnosis runs right on your phone — nothing leaves it.",
        cta: "enable",
      };
    case "downloading":
      return {
        title: `Downloading the AI — ${state.percent}%`,
        body: "Keep the app open. Assessments unlock the moment it finishes.",
        cta: null,
      };
    case "preparing":
      return { title: "Getting the AI ready…", body: "A few seconds.", cta: null };
    case "failed":
      return {
        title: "AI setup didn't finish",
        body: "Check free space and your connection, then try again.",
        cta: "retry",
      };
    case "ready":
      return null;
  }
}

export function localEngineSubtitle(
  state: LocalEngineState,
  settings: LocalEngineSettings,
): string {
  switch (state.kind) {
    case "off":
      return settings.downloaded
        ? "Assessments are paused while this is off. The downloaded model stays on this phone — turn this back on any time, or remove it by deleting the app."
        : `Assessments run entirely on this phone and need this model. First use downloads ${LOCAL_MODEL_SIZE_LABEL} over WiFi.`;
    case "downloading":
      return `Downloading ${LOCAL_MODEL_SIZE_LABEL} over WiFi — one time. Assessments will work as soon as it finishes.`;
    case "preparing":
      return "Starting the on-device model…";
    case "ready":
      return "Photos are analyzed on this phone — nothing is sent anywhere, ever.";
    case "failed":
      return "Couldn't set up the on-device model — assessments can't run until this is fixed. Tap to try again.";
  }
}

// F21 removed localSystemPrompt(isCutCare): with the prompt unified there is
// no mode to specialize on, so the session sends SPIKE_SYSTEM_PROMPT as-is —
// the cut framing lives inside it and applies when the model reads a cut.

export const LOCAL_USER_PROMPT = SPIKE_USER_PROMPT;
