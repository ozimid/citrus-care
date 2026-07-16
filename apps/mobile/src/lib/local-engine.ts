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
 * build, and the router already degrades safely — an OOM escalates to Gemini. */
export const LOCAL_MODEL_REQUIRED_FREE_BYTES = 2 * 1024 * 1024 * 1024;

/** Everything a user should know BEFORE a 1.3 GB download. Size and the 512px
 * latency discipline come from docs/research/on-device-vlm-native.md; the free
 * space is LOCAL_MODEL_REQUIRED_FREE_BYTES. The RAM/OS line is a rule of thumb
 * (the doc's only device data point is a Galaxy Z Fold-class flagship), which
 * is exactly why the last clause is a promise and not a warning. */
export const LOCAL_MODEL_REQUIREMENTS =
  `~${LOCAL_MODEL_SIZE_LABEL} download · needs ~2 GB free · works best on 8 GB+ RAM, Android 10+ · ` +
  `falls back to the cloud automatically if your phone can't keep up`;

/** Shown before the first download so the size/network cost is a choice. */
export const LOCAL_MODEL_DOWNLOAD_WARNING =
  `Downloads a ${LOCAL_MODEL_SIZE_LABEL} model over WiFi (once). After that your photos are analyzed ` +
  `on this phone — nothing is sent anywhere. Anything the local model can't handle still goes to Gemini.` +
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
    `Free some space and try again. Gemini keeps analyzing your photos meanwhile.`
  );
}

export interface LocalEngineSettings {
  /** The user's opt-in. Off means the router never touches the local model. */
  enabled: boolean;
  /** True once the model has finished downloading on this phone — suppresses
   * the size warning on re-enable (the files survive a disable). */
  downloaded: boolean;
}

export const DEFAULT_LOCAL_ENGINE_SETTINGS: LocalEngineSettings = {
  enabled: false,
  downloaded: false,
};

/** Stored settings are untrusted: anything malformed degrades to "off", which
 * is the safe default (Gemini handles everything). Never throws. */
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

/** settings + session status → what the Profile row shows and whether the
 * router may use the local model. `runtime` is null while the (lazily
 * imported) session component hasn't mounted yet. */
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

/** The single gate the router asks: a diagnosis only runs locally when the
 * session is actually loaded. Every other state escalates to Gemini. */
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
 * the downloaded files, and a failed/off engine silently means Gemini. */
export function localEngineSubtitle(
  state: LocalEngineState,
  settings: LocalEngineSettings,
): string {
  switch (state.kind) {
    case "off":
      return settings.downloaded
        ? "Gemini is analyzing your photos. The downloaded model stays on this phone — turn this back on any time, or remove it by deleting the app."
        : `Analyze photos privately on this phone. First use downloads ${LOCAL_MODEL_SIZE_LABEL} over WiFi.`;
    case "downloading":
      return `Downloading ${LOCAL_MODEL_SIZE_LABEL} over WiFi — one time. Gemini handles assessments meanwhile.`;
    case "preparing":
      return "Starting the on-device model…";
    case "ready":
      return "Photos are analyzed on this phone. Anything the local model can't read goes to Gemini automatically.";
    case "failed":
      return "Couldn't set up the on-device model — Gemini is handling your assessments. Tap to try again.";
  }
}

// F21 removed localSystemPrompt(isCutCare): with the prompt unified there is
// no mode to specialize on, so the session sends SPIKE_SYSTEM_PROMPT as-is —
// the cut framing lives inside it and applies when the model reads a cut.

export const LOCAL_USER_PROMPT = SPIKE_USER_PROMPT;
