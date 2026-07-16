import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCAL_ENGINE_SETTINGS,
  LOCAL_MODEL_DOWNLOAD_WARNING,
  LOCAL_MODEL_REQUIRED_FREE_BYTES,
  LOCAL_MODEL_REQUIREMENTS,
  formatGigabytes,
  hasRoomForLocalModel,
  insufficientStorageMessage,
  localEngineState,
  localEngineStatusLabel,
  localEngineSubtitle,
  needsDownloadWarning,
  parseLocalEngineSettings,
  serializeLocalEngineSettings,
  shouldRouteLocal,
  type LocalEngineRuntime,
  type LocalEngineSettings,
} from "./local-engine";

// D-15 Stage 2: the on-device engine is opt-in (off by default) and the router
// only uses it once the executorch session reports ready. Everything here is
// pure — the AsyncStorage/Supabase wiring lives in local-engine-io.ts.

const OFF: LocalEngineSettings = { enabled: false, downloaded: false };
const ON: LocalEngineSettings = { enabled: true, downloaded: false };
const ON_CACHED: LocalEngineSettings = { enabled: true, downloaded: true };

function runtime(over: Partial<LocalEngineRuntime> = {}): LocalEngineRuntime {
  return { isReady: false, downloadProgress: 0, error: null, ...over };
}

describe("local engine settings (persisted, opt-in)", () => {
  it("defaults to off — the 1.3 GB model is never fetched unasked", () => {
    expect(DEFAULT_LOCAL_ENGINE_SETTINGS).toEqual({ enabled: false, downloaded: false });
    expect(parseLocalEngineSettings(null)).toEqual(DEFAULT_LOCAL_ENGINE_SETTINGS);
  });

  it("round-trips through storage", () => {
    expect(parseLocalEngineSettings(serializeLocalEngineSettings(ON_CACHED))).toEqual(ON_CACHED);
  });

  it("degrades malformed stored data to the default instead of throwing", () => {
    expect(parseLocalEngineSettings("{not json")).toEqual(DEFAULT_LOCAL_ENGINE_SETTINGS);
    expect(parseLocalEngineSettings("[]")).toEqual(DEFAULT_LOCAL_ENGINE_SETTINGS);
    expect(parseLocalEngineSettings('{"enabled":"yes"}')).toEqual(DEFAULT_LOCAL_ENGINE_SETTINGS);
    expect(parseLocalEngineSettings('{"enabled":true}')).toEqual({ enabled: true, downloaded: false });
  });

  it("warns about the download only until the model is cached on this phone", () => {
    expect(needsDownloadWarning(OFF)).toBe(true);
    expect(needsDownloadWarning({ enabled: false, downloaded: true })).toBe(false);
  });
});

describe("localEngineState (settings + executorch runtime → row state)", () => {
  it("is off whenever the user hasn't opted in, whatever the runtime says", () => {
    expect(localEngineState(OFF, runtime({ isReady: true }))).toEqual({ kind: "off" });
    expect(localEngineState(OFF, null)).toEqual({ kind: "off" });
  });

  it("is preparing while the session mounts (enabled, no runtime yet)", () => {
    expect(localEngineState(ON, null)).toEqual({ kind: "preparing" });
  });

  it("reports download progress as a whole percent", () => {
    expect(localEngineState(ON, runtime({ downloadProgress: 0.4237 }))).toEqual({
      kind: "downloading",
      percent: 42,
    });
  });

  it("is preparing once the bytes are down but the session isn't ready", () => {
    expect(localEngineState(ON, runtime({ downloadProgress: 1 }))).toEqual({ kind: "preparing" });
  });

  it("is ready only when the runtime says so", () => {
    expect(localEngineState(ON, runtime({ isReady: true, downloadProgress: 1 }))).toEqual({
      kind: "ready",
    });
  });

  it("is failed on a runtime error — even if it also claims ready", () => {
    expect(localEngineState(ON, runtime({ error: new Error("OOM"), isReady: true }))).toEqual({
      kind: "failed",
    });
  });

  it("routes to the local model in exactly one state: ready", () => {
    expect(shouldRouteLocal({ kind: "ready" })).toBe(true);
    expect(shouldRouteLocal({ kind: "off" })).toBe(false);
    expect(shouldRouteLocal({ kind: "preparing" })).toBe(false);
    expect(shouldRouteLocal({ kind: "downloading", percent: 99 })).toBe(false);
    expect(shouldRouteLocal({ kind: "failed" })).toBe(false);
  });
});

describe("row copy (honest about what disabling does)", () => {
  it("labels every state", () => {
    expect(localEngineStatusLabel({ kind: "off" })).toBe("Off");
    expect(localEngineStatusLabel({ kind: "downloading", percent: 7 })).toBe("Downloading 7%");
    expect(localEngineStatusLabel({ kind: "preparing" })).toBe("Preparing…");
    expect(localEngineStatusLabel({ kind: "ready" })).toBe("Ready");
    expect(localEngineStatusLabel({ kind: "failed" })).toBe("Setup failed");
  });

  it("says the files stay on the phone when switched off after a download", () => {
    const subtitle = localEngineSubtitle({ kind: "off" }, { enabled: false, downloaded: true });
    expect(subtitle).toMatch(/stays on this phone/i);
    expect(subtitle).not.toMatch(/1\.3 GB over WiFi/i);
  });

  it("warns about size and WiFi before the first download", () => {
    expect(localEngineSubtitle({ kind: "off" }, OFF)).toMatch(/1\.3 GB/);
  });

  it("tells the user Gemini is covering them while the local engine is failed", () => {
    expect(localEngineSubtitle({ kind: "failed" }, ON)).toMatch(/Gemini/);
  });
});

// F21 removed localSystemPrompt: with one unified prompt there is no mode to
// specialize on, so the local session uses SPIKE_SYSTEM_PROMPT directly and
// the cut framing lives inside it (spike-vlm.test.ts covers the wording).

// F22 Part 2 — the honest precheck before a 1.3 GB download. Deliberately
// storage only: no RAM gate (expo-device's totalMemory reports total, not
// available — false precision for a new native build), because the router
// already degrades safely (OOM → escalate to Gemini).

describe("hasRoomForLocalModel (free-storage precheck)", () => {
  it("asks for ~2 GB — the 1.3 GB model plus unpacking headroom", () => {
    expect(LOCAL_MODEL_REQUIRED_FREE_BYTES).toBe(2 * 1024 * 1024 * 1024);
  });

  it("blocks the download when the phone is short on space", () => {
    expect(hasRoomForLocalModel(1.4 * 1024 * 1024 * 1024)).toBe(false);
    expect(hasRoomForLocalModel(0)).toBe(false);
  });

  it("allows it at exactly the requirement and above", () => {
    expect(hasRoomForLocalModel(LOCAL_MODEL_REQUIRED_FREE_BYTES)).toBe(true);
    expect(hasRoomForLocalModel(64 * 1024 * 1024 * 1024)).toBe(true);
  });

  it("does not block on an unreadable free-space number", () => {
    // A precheck that can't read the disk must not become a second failure
    // mode: the download itself is the backstop.
    expect(hasRoomForLocalModel(null)).toBe(true);
    expect(hasRoomForLocalModel(NaN)).toBe(true);
  });

  it("tells the user the number they actually have", () => {
    expect(formatGigabytes(1.4 * 1024 * 1024 * 1024)).toBe("1.4 GB");
    expect(formatGigabytes(0)).toBe("0 GB");
    const message = insufficientStorageMessage(1.4 * 1024 * 1024 * 1024);
    expect(message).toContain("2 GB free");
    expect(message).toContain("1.4 GB");
  });
});

describe("stated requirements (numbers come from the research doc)", () => {
  it("states size, free space, the device rule of thumb, and the fallback", () => {
    expect(LOCAL_MODEL_REQUIREMENTS).toContain("1.3 GB");
    expect(LOCAL_MODEL_REQUIREMENTS).toContain("2 GB free");
    expect(LOCAL_MODEL_REQUIREMENTS).toMatch(/8 GB\+ RAM/);
    expect(LOCAL_MODEL_REQUIREMENTS).toMatch(/Android 10\+/);
    expect(LOCAL_MODEL_REQUIREMENTS).toMatch(/falls back to the cloud/i);
  });

  it("repeats them in the pre-download warning — before the 1.3 GB, not after", () => {
    expect(LOCAL_MODEL_DOWNLOAD_WARNING).toContain(LOCAL_MODEL_REQUIREMENTS);
  });
});
