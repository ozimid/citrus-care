import { describe, expect, it } from "vitest";
import {
  deviceCapability,
  LOAD_SENTINEL_STORAGE_KEY,
  firstRunSetupCard,
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
  type LocalEngineState,
} from "./local-engine";

// D-17: the on-device engine is opt-in (off by default) and the ONLY engine —
// assess uses it exactly when the executorch session reports ready; every
// other state is an honest, retryable "not ready", never a fallback.
// Everything here is pure — the AsyncStorage wiring lives in local-engine-io.ts.

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

  it("is honest that assessments can't run while the engine is failed", () => {
    const subtitle = localEngineSubtitle({ kind: "failed" }, ON);
    expect(subtitle).toMatch(/can't run/i);
    expect(subtitle).toMatch(/try again/i);
  });

  it("never promises a cloud fallback anywhere — D-17: Gemma is the only engine", () => {
    const states: LocalEngineState[] = [
      { kind: "off" },
      { kind: "downloading", percent: 50 },
      { kind: "preparing" },
      { kind: "ready" },
      { kind: "failed" },
    ];
    const settingsVariants = [OFF, ON, ON_CACHED, { enabled: false, downloaded: true }];
    const allCopy = [
      LOCAL_MODEL_REQUIREMENTS,
      LOCAL_MODEL_DOWNLOAD_WARNING,
      insufficientStorageMessage(1.4 * 1024 * 1024 * 1024),
      ...states.flatMap((s) => settingsVariants.map((v) => localEngineSubtitle(s, v))),
    ];
    for (const text of allCopy) {
      expect(text).not.toMatch(/gemini|cloud/i);
    }
  });
});

// F21 removed localSystemPrompt: with one unified prompt there is no mode to
// specialize on, so the local session uses SPIKE_SYSTEM_PROMPT directly and
// the cut framing lives inside it (spike-vlm.test.ts covers the wording).

// F22 Part 2 — the honest precheck before a 1.3 GB download. Deliberately
// storage only: no RAM gate (expo-device's totalMemory reports total, not
// available — false precision for a new native build), because a phone that
// can't run the model already fails honestly at assess time (retryable —
// D-17 left nothing to escalate to).

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
  it("states size, free space, the device rule of thumb, and that nothing leaves the phone", () => {
    expect(LOCAL_MODEL_REQUIREMENTS).toContain("1.3 GB");
    expect(LOCAL_MODEL_REQUIREMENTS).toContain("2 GB free");
    expect(LOCAL_MODEL_REQUIREMENTS).toMatch(/8 GB\+ RAM/);
    expect(LOCAL_MODEL_REQUIREMENTS).toMatch(/Android 10\+/);
    expect(LOCAL_MODEL_REQUIREMENTS).toMatch(/nothing is ever sent/i);
  });

  it("repeats them in the pre-download warning — before the 1.3 GB, not after", () => {
    expect(LOCAL_MODEL_DOWNLOAD_WARNING).toContain(LOCAL_MODEL_REQUIREMENTS);
  });
});

// F28: first-run setup guidance — the model download must be offered BEFORE
// the user invests in add-plant → photo → analyze (friend feedback 2026-07-16:
// hit the honest not-ready error at the END of the funnel).
describe("firstRunSetupCard", () => {
  it("offers the download when the engine is off", () => {
    const card = firstRunSetupCard({ kind: "off" });
    expect(card?.cta).toBe("enable");
    expect(card?.body).toMatch(/1\.3 GB/);
    expect(card?.body).toMatch(/nothing leaves/i);
  });

  it("shows live progress while downloading, with no CTA, and promises the screen stays awake", () => {
    const card = firstRunSetupCard({ kind: "downloading", percent: 42 });
    expect(card?.title).toContain("42%");
    expect(card?.cta).toBeNull();
    // The keep-awake promise (user report: screen-off killed the download).
    expect(card?.body).toMatch(/screen.*(stays|stay).*awake/i);
  });

  it("shows a busy state while preparing", () => {
    expect(firstRunSetupCard({ kind: "preparing" })?.cta).toBeNull();
  });

  it("offers retry after a failure, honestly", () => {
    const card = firstRunSetupCard({ kind: "failed" });
    expect(card?.cta).toBe("retry");
    expect(card?.body).not.toMatch(/gemini|cloud/i);
  });

  it("disappears once the engine is ready", () => {
    expect(firstRunSetupCard({ kind: "ready" })).toBeNull();
  });
});

// P0 (S23 crash loop, 2026-07-16): a native crash during model load kills the
// process before any JS error handling — the sentinel is how the NEXT launch
// knows, and "crashed" is the honest state that stops the auto-mount loop.
describe("crash sentinel state", () => {
  const on = { enabled: true, downloaded: true };

  it("enabled + crashed last load = crashed (no auto-mount), regardless of runtime", () => {
    expect(localEngineState(on, null, true)).toEqual({ kind: "crashed" });
  });

  it("disabled wins over the crash flag", () => {
    expect(localEngineState({ enabled: false, downloaded: true }, null, true)).toEqual({
      kind: "off",
    });
  });

  it("no crash flag behaves exactly as before", () => {
    expect(localEngineState(on, null, false)).toEqual({ kind: "preparing" });
  });

  it("crashed status/subtitle are honest — memory hint, retry, no cloud talk", () => {
    expect(localEngineStatusLabel({ kind: "crashed" })).toMatch(/crash/i);
    const sub = localEngineSubtitle({ kind: "crashed" }, { enabled: true, downloaded: true });
    expect(sub).toMatch(/memory/i);
    expect(sub).toMatch(/rest of the app|works without/i);
    expect(sub).not.toMatch(/gemini|cloud/i);
  });

  it("the setup card offers retry after a crash and says it plainly", () => {
    const card = firstRunSetupCard({ kind: "crashed" });
    expect(card?.cta).toBe("retry");
    expect(card?.title).toMatch(/crash/i);
  });

  it("crashed never routes local", () => {
    expect(shouldRouteLocal({ kind: "crashed" })).toBe(false);
  });

  it("sentinel key follows the store naming convention", () => {
    expect(LOAD_SENTINEL_STORAGE_KEY).toBe("citrus.engine-load-sentinel.v1");
  });
});

// F33 pre-flight (user, 2026-07-16): know BEFORE the 1.3 GB download whether
// this phone can plausibly run the model. Injected inputs keep it pure; a
// missing reading must NEVER block a capable phone (permissive on unknown).
describe("deviceCapability", () => {
  const GB = 1073741824;

  it("blocks below 6 GB RAM with an honest reason", () => {
    const v = deviceCapability(4 * GB, 34);
    expect(v.level).toBe("block");
    expect(v.reason).toMatch(/memory|RAM/i);
    expect(v.reason).not.toMatch(/gemini|cloud/i);
  });

  it("warns between 6 and 8 GB", () => {
    expect(deviceCapability(6 * GB, 34).level).toBe("warn");
    expect(deviceCapability(7.5 * GB, 34).level).toBe("warn");
  });

  it("passes 8 GB and above", () => {
    expect(deviceCapability(8 * GB, 34)).toEqual({ level: "ok", reason: null });
    expect(deviceCapability(12 * GB, 34).level).toBe("ok");
  });

  it("warns on Android older than 10 (API 29) even with plenty of RAM", () => {
    const v = deviceCapability(12 * GB, 28);
    expect(v.level).toBe("warn");
    expect(v.reason).toMatch(/Android/i);
  });

  it("is permissive when readings are unavailable", () => {
    expect(deviceCapability(null, null)).toEqual({ level: "ok", reason: null });
    expect(deviceCapability(null, 34)).toEqual({ level: "ok", reason: null });
  });

  it("block beats warn when both apply", () => {
    expect(deviceCapability(4 * GB, 28).level).toBe("block");
  });
});
