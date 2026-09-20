import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deviceCapability,
  LOAD_SENTINEL_STORAGE_KEY,
  firstRunSetupCard,
  DEFAULT_LOCAL_ENGINE_SETTINGS,
  localModelDownloadWarning,
  localModelRequirements,
  hasRoomForLocalModel,
  insufficientStorageMessage,
  localEngineState,
  localEngineStatusLabel,
  localEngineSubtitle,
  modelWeightsLikelyPresent,
  needsDownloadWarning,
  parseLocalEngineSettings,
  serializeLocalEngineSettings,
  shouldRouteLocal,
  type LocalEngineRuntime,
  type LocalEngineSettings,
  type LocalEngineState,
} from "./local-engine";
import {
  DEFAULT_MODEL_ID,
  MODEL_CATALOGUE,
  formatModelBytes,
  requiredFreeBytesFor,
  type ModelId,
} from "./model-catalogue";

// D-17: the on-device engine is opt-in (off by default) and the ONLY engine —
// assess uses it exactly when the executorch session reports ready; every
// other state is an honest, retryable "not ready", never a fallback.
// Everything here is pure — the AsyncStorage wiring lives in local-engine-io.ts.
//
// F40: the model is a CHOICE, so every string that states a size takes a
// ModelId and reads model-catalogue.ts. No size is hand-typed here any more —
// the last "~1.3 GB download · needs ~2 GB free" was false by 3 GB.

const OFF: LocalEngineSettings = { enabled: false, downloaded: false };
const ON: LocalEngineSettings = { enabled: true, downloaded: false };
const ON_CACHED: LocalEngineSettings = { enabled: true, downloaded: true };

const ALL_MODEL_IDS = Object.keys(MODEL_CATALOGUE) as ModelId[];
const GEMMA = MODEL_CATALOGUE["gemma4-e2b"];
const LFM = MODEL_CATALOGUE["lfm2-5-vl-450m"];

function runtime(over: Partial<LocalEngineRuntime> = {}): LocalEngineRuntime {
  return { isReady: false, downloadProgress: 0, error: null, ...over };
}

describe("local engine settings (persisted, opt-in)", () => {
  it("defaults to off — a multi-gigabyte model is never fetched unasked", () => {
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
    const subtitle = localEngineSubtitle(
      { kind: "off" },
      { enabled: false, downloaded: true },
      DEFAULT_MODEL_ID,
    );
    expect(subtitle).toMatch(/stays on this phone/i);
    expect(subtitle).not.toContain(LFM.sizeLabel);
  });

  it("warns about size and WiFi before the first download, with the CHOSEN model's real size", () => {
    expect(localEngineSubtitle({ kind: "off" }, OFF, "gemma4-e2b")).toContain(GEMMA.sizeLabel);
    expect(localEngineSubtitle({ kind: "off" }, OFF, "lfm2-5-vl-450m")).toContain(LFM.sizeLabel);
    // The lie this feature exists to kill.
    expect(localEngineSubtitle({ kind: "off" }, OFF, "gemma4-e2b")).not.toContain("1.3 GB");
  });

  it("names the model being downloaded, at its real size", () => {
    for (const id of ALL_MODEL_IDS) {
      expect(localEngineSubtitle({ kind: "downloading", percent: 5 }, ON, id)).toContain(
        MODEL_CATALOGUE[id].sizeLabel,
      );
    }
  });

  it("is honest that assessments can't run while the engine is failed", () => {
    const subtitle = localEngineSubtitle({ kind: "failed" }, ON, DEFAULT_MODEL_ID);
    expect(subtitle).toMatch(/can't run/i);
    expect(subtitle).toMatch(/try again/i);
  });

  it("never promises a cloud fallback anywhere — D-17: the on-device model is the only engine", () => {
    const states: LocalEngineState[] = [
      { kind: "off" },
      { kind: "downloading", percent: 50 },
      { kind: "preparing" },
      { kind: "ready" },
      { kind: "failed" },
    ];
    const settingsVariants = [OFF, ON, ON_CACHED, { enabled: false, downloaded: true }];
    const allCopy = ALL_MODEL_IDS.flatMap((id) => [
      localModelRequirements(id),
      localModelDownloadWarning(id),
      insufficientStorageMessage(id, 1_400_000_000),
      ...states.flatMap((s) => settingsVariants.map((v) => localEngineSubtitle(s, v, id))),
    ]);
    for (const text of allCopy) {
      expect(text).not.toMatch(/gemini|cloud/i);
    }
  });
});

// F21 removed localSystemPrompt: with one unified prompt there is no mode to
// specialize on, so the local session uses SPIKE_SYSTEM_PROMPT directly and
// the cut framing lives inside it (spike-vlm.test.ts covers the wording).

// F22 Part 2 / F40 — the honest precheck before a multi-gigabyte download.
// Deliberately storage only here: the RAM verdict is deviceCapability's job,
// against the phone's real reading rather than a rule of thumb in a string.
// The requirement is now per model and derived from the measured download —
// the old flat 2 GiB constant let a 2.5 GB phone start a 4.4 GB download.

describe("hasRoomForLocalModel (free-storage precheck, per model)", () => {
  it("asks for the model's REAL size plus headroom — Gemma is over 4 GiB, not 1.3 GB", () => {
    expect(GEMMA.bytes).toBeGreaterThanOrEqual(4 * 1024 ** 3);
    expect(requiredFreeBytesFor("gemma4-e2b")).toBeGreaterThan(GEMMA.bytes);
    expect(requiredFreeBytesFor("gemma4-e2b")).not.toBe(2 * 1024 ** 3);
    expect(requiredFreeBytesFor("lfm2-5-vl-450m")).toBeLessThan(requiredFreeBytesFor("gemma4-e2b"));
  });

  it("blocks the download when the phone is short on space for THAT model", () => {
    expect(hasRoomForLocalModel("gemma4-e2b", 2_500_000_000)).toBe(false);
    expect(hasRoomForLocalModel("gemma4-e2b", 0)).toBe(false);
    expect(hasRoomForLocalModel("lfm2-5-vl-450m", 500_000_000)).toBe(false);
    // The same phone that cannot take the heavy one can take the light one.
    expect(hasRoomForLocalModel("lfm2-5-vl-450m", 2_500_000_000)).toBe(true);
  });

  it("allows it at exactly the requirement and above", () => {
    for (const id of ALL_MODEL_IDS) {
      expect(hasRoomForLocalModel(id, requiredFreeBytesFor(id))).toBe(true);
      expect(hasRoomForLocalModel(id, 64 * 1024 ** 3)).toBe(true);
    }
  });

  it("does not block on an unreadable free-space number", () => {
    // A precheck that can't read the disk must not become a second failure
    // mode: the download itself is the backstop.
    expect(hasRoomForLocalModel("gemma4-e2b", null)).toBe(true);
    expect(hasRoomForLocalModel("gemma4-e2b", NaN)).toBe(true);
  });

  it("tells the user the requirement and the number they actually have, in ONE unit convention", () => {
    const message = insufficientStorageMessage("gemma4-e2b", 1_400_000_000);
    expect(message).toContain(GEMMA.requiredFreeLabel);
    expect(message).toContain(formatModelBytes(1_400_000_000));
    expect(message).not.toContain("2 GB free");
  });

  // A refusal that only says "go delete photos" is a dead end when the app's
  // own lighter model would fit — name it, with its real requirement.
  it("names the model that WOULD fit, when one does", () => {
    const message = insufficientStorageMessage("gemma4-e2b", 2_500_000_000, "lfm2-5-vl-450m");
    expect(message).toContain(LFM.label);
    expect(message).toContain(LFM.requiredFreeLabel);
  });

  it("says nothing about an alternative when there isn't one", () => {
    const message = insufficientStorageMessage("gemma4-e2b", 100_000_000, null);
    expect(message).not.toContain(LFM.label);
    // And never offers the very model that was just refused.
    expect(insufficientStorageMessage("gemma4-e2b", 100_000_000, "gemma4-e2b")).toBe(
      insufficientStorageMessage("gemma4-e2b", 100_000_000),
    );
  });
});

// The disk listing behind `downloadedIds` is best-effort: it degrades to [] on
// any read failure and is [] until the async read lands. Treating that as "no
// weights on this phone" hard-blocks a pre-F40 Gemma user behind a ~6 GB free
// space check for a download that would never happen.
describe("modelWeightsLikelyPresent", () => {
  const downloaded: LocalEngineSettings = { enabled: false, downloaded: true };
  const fresh: LocalEngineSettings = { enabled: false, downloaded: false };

  it("trusts a positive listing", () => {
    expect(modelWeightsLikelyPresent("gemma4-e2b", ["gemma4-e2b"], fresh)).toBe(true);
    expect(modelWeightsLikelyPresent("lfm2-5-vl-450m", ["lfm2-5-vl-450m"], fresh)).toBe(true);
  });

  it("falls back to the pre-F40 flag when the listing is empty (read failed, or not in yet)", () => {
    expect(modelWeightsLikelyPresent("gemma4-e2b", [], downloaded)).toBe(true);
  });

  it("never lets the legacy flag vouch for the model it could not have been", () => {
    // Pre-F40 there was exactly one model, so `downloaded: true` can only ever
    // have meant Gemma.
    expect(modelWeightsLikelyPresent("lfm2-5-vl-450m", [], downloaded)).toBe(false);
  });

  it("trusts a listing that positively found the OTHER model", () => {
    // A non-empty listing is a successful read: absence is real absence.
    expect(modelWeightsLikelyPresent("gemma4-e2b", ["lfm2-5-vl-450m"], downloaded)).toBe(false);
  });

  it("is false on a genuinely fresh phone", () => {
    expect(modelWeightsLikelyPresent("gemma4-e2b", [], fresh)).toBe(false);
    expect(modelWeightsLikelyPresent("lfm2-5-vl-450m", [], fresh)).toBe(false);
  });
});

describe("stated requirements (every number comes from the catalogue)", () => {
  it("states this model's real download size and free-space requirement", () => {
    for (const id of ALL_MODEL_IDS) {
      const spec = MODEL_CATALOGUE[id];
      const text = localModelRequirements(id);
      expect(text).toContain(spec.sizeLabel);
      expect(text).toContain(spec.requiredFreeLabel);
      expect(text).toMatch(/Android/);
      expect(text).toMatch(/nothing is ever sent/i);
    }
  });

  it("repeats them in the pre-download warning — before the download, not after", () => {
    for (const id of ALL_MODEL_IDS) {
      expect(localModelDownloadWarning(id)).toContain(localModelRequirements(id));
      expect(localModelDownloadWarning(id)).toContain(MODEL_CATALOGUE[id].sizeLabel);
    }
  });

  it("never states the old, false numbers again", () => {
    for (const id of ALL_MODEL_IDS) {
      for (const text of [localModelRequirements(id), localModelDownloadWarning(id)]) {
        expect(text).not.toContain("1.3 GB");
        expect(text).not.toContain("2 GB free");
      }
    }
  });
});

// The regression that would have caught the lie: a size typed into a string
// literal is a size that can drift from the bytes actually downloaded. Every
// size in this module must come from model-catalogue.ts.
describe("no hand-typed size strings", () => {
  it("local-engine.ts states no size except through the catalogue", () => {
    // Comments are stripped first: this guard is about shipped COPY, and the
    // header comment quotes the old false numbers on purpose, as the record of
    // what went wrong.
    const code = readFileSync(join(__dirname, "local-engine.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    const literals = code.match(/\d[\d.,]*\s*[KMGT]i?B\b/g) ?? [];
    expect(literals, `hand-typed sizes: ${literals.join(", ")}`).toEqual([]);
  });
});

// F28: first-run setup guidance — the model download must be offered BEFORE
// the user invests in add-plant → photo → analyze (friend feedback 2026-07-16:
// hit the honest not-ready error at the END of the funnel).
describe("firstRunSetupCard", () => {
  it("offers the download when the engine is off, at the chosen model's real size", () => {
    const card = firstRunSetupCard({ kind: "off" }, "gemma4-e2b");
    expect(card?.cta).toBe("enable");
    expect(card?.body).toContain(GEMMA.sizeLabel);
    expect(card?.body).not.toContain("1.3 GB");
    expect(card?.body).toMatch(/nothing leaves/i);
    expect(firstRunSetupCard({ kind: "off" }, "lfm2-5-vl-450m")?.body).toContain(LFM.sizeLabel);
  });

  it("shows live progress while downloading, with no CTA, and promises the screen stays awake", () => {
    const card = firstRunSetupCard({ kind: "downloading", percent: 42 }, DEFAULT_MODEL_ID);
    expect(card?.title).toContain("42%");
    expect(card?.cta).toBeNull();
    // The keep-awake promise (user report: screen-off killed the download).
    expect(card?.body).toMatch(/screen.*(stays|stay).*awake/i);
  });

  it("shows a busy state while preparing", () => {
    expect(firstRunSetupCard({ kind: "preparing" }, DEFAULT_MODEL_ID)?.cta).toBeNull();
  });

  it("offers retry after a failure, honestly", () => {
    const card = firstRunSetupCard({ kind: "failed" }, DEFAULT_MODEL_ID);
    expect(card?.cta).toBe("retry");
    expect(card?.body).not.toMatch(/gemini|cloud/i);
  });

  // Both recovery states have the same real fix the retry button can't reach:
  // a smaller model. "Setup didn't finish" is usually disk, "crashed last
  // time" is usually memory — the light model asks for less of both.
  it("points both recovery states at the other model, not just at retry", () => {
    expect(firstRunSetupCard({ kind: "failed" }, DEFAULT_MODEL_ID)?.body).toMatch(
      /other model|smaller model/i,
    );
    expect(firstRunSetupCard({ kind: "crashed" }, DEFAULT_MODEL_ID)?.body).toMatch(
      /other model|smaller model/i,
    );
  });

  it("disappears once the engine is ready", () => {
    expect(firstRunSetupCard({ kind: "ready" }, DEFAULT_MODEL_ID)).toBeNull();
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
    const sub = localEngineSubtitle({ kind: "crashed" }, { enabled: true, downloaded: true }, DEFAULT_MODEL_ID);
    expect(sub).toMatch(/memory/i);
    expect(sub).toMatch(/rest of the app|works without/i);
    expect(sub).not.toMatch(/gemini|cloud/i);
  });

  it("the setup card offers retry after a crash and says it plainly", () => {
    const card = firstRunSetupCard({ kind: "crashed" }, DEFAULT_MODEL_ID);
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

// F33 pre-flight (user, 2026-07-16): know BEFORE the download whether this
// phone can plausibly run the model. Injected inputs keep it pure; a missing
// reading must NEVER block a capable phone (permissive on unknown).
// F40: the RAM gate is per model — a 450M model runs where a 4.4 GB one cannot,
// so the threshold comes from the catalogue's minRamBytes.
describe("deviceCapability", () => {
  const GB = 1073741824;

  it("blocks below the chosen model's minimum RAM, with an honest reason", () => {
    const v = deviceCapability(4 * GB, 34, "gemma4-e2b");
    expect(v.level).toBe("block");
    expect(v.reason).toMatch(/memory|RAM/i);
    expect(v.reason).not.toMatch(/gemini|cloud/i);
    // The reason quotes the size that would be wasted — from the catalogue.
    expect(v.reason).toContain(GEMMA.sizeLabel);
    expect(v.reason).not.toContain("1.3 GB");
  });

  it("warns in the band just above the minimum", () => {
    expect(deviceCapability(6 * GB, 34, "gemma4-e2b").level).toBe("warn");
    expect(deviceCapability(7.5 * GB, 34, "gemma4-e2b").level).toBe("warn");
  });

  it("passes comfortably above it", () => {
    expect(deviceCapability(8 * GB, 34, "gemma4-e2b")).toEqual({ level: "ok", reason: null });
    expect(deviceCapability(12 * GB, 34, "gemma4-e2b").level).toBe("ok");
  });

  it("is kinder about the light model — it runs where the heavy one is blocked", () => {
    expect(deviceCapability(4 * GB, 34, "lfm2-5-vl-450m").level).toBe("warn");
    expect(deviceCapability(2 * GB, 34, "lfm2-5-vl-450m").level).toBe("block");
    expect(deviceCapability(6 * GB, 34, "lfm2-5-vl-450m").level).toBe("ok");
  });

  it("does NOT block a nominal 4 GB phone from the light model", () => {
    // expo-device reads ActivityManager's totalMem, which excludes the memory
    // the kernel reserves — a phone sold as "4 GB RAM" reports ~3.5-3.8 GiB.
    // The 654 MB model exists for exactly those phones; a bar it cannot clear
    // would block the option on the hardware it was added for.
    expect(deviceCapability(3.6 * GB, 34, "lfm2-5-vl-450m").level).not.toBe("block");
    expect(deviceCapability(3.5 * GB, 34, "lfm2-5-vl-450m").level).not.toBe("block");
  });

  it("warns on Android older than 10 (API 29) even with plenty of RAM", () => {
    const v = deviceCapability(12 * GB, 28, "gemma4-e2b");
    expect(v.level).toBe("warn");
    expect(v.reason).toMatch(/Android/i);
  });

  it("is permissive when readings are unavailable", () => {
    expect(deviceCapability(null, null, "gemma4-e2b")).toEqual({ level: "ok", reason: null });
    expect(deviceCapability(null, 34, "gemma4-e2b")).toEqual({ level: "ok", reason: null });
  });

  it("block beats warn when both apply", () => {
    expect(deviceCapability(4 * GB, 28, "gemma4-e2b").level).toBe("block");
  });

  it("takes the model id from the caller — there is no default to quote the wrong size", () => {
    // Same phone, same Android, opposite verdicts: the bar is the model's.
    expect(deviceCapability(5 * GB, 34, "lfm2-5-vl-450m").level).toBe("ok");
    expect(deviceCapability(5 * GB, 34, "gemma4-e2b").level).toBe("block");
  });
});
