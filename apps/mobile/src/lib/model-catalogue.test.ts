import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ID,
  LEGACY_MODEL_ID,
  MODEL_CATALOGUE,
  formatModelBytes,
  hasRoomFor,
  modelAttribution,
  modelLicenceLinks,
  modelSpec,
  modelTestingNote,
  modelThatFits,
  parseModelChoice,
  requiredFreeBytesFor,
  serializeModelChoice,
  type ModelId,
} from "./model-catalogue";

// F40 "Choose your model". The catalogue is the ONE place a model's size is
// stated; every copy string in the app derives from it. It exists because the
// app shipped a lie: "~1.3 GB download · needs ~2 GB free" while the Android
// Gemma build is 4,371,419,520 B of .pte + 32,169,868 B of tokenizer. A user
// with 2.5 GB free passed the precheck and then filled their phone.
//
// Byte counts below are content-length readings taken against the exact URLs
// react-native-executorch 0.9.2 resolves (see the report in git history):
//   gemma4_e2b_multimodal → .../e2b/vulkan/gemma_4_e2b_vulkan_8da4w.pte
//   lfm2_5_vl_450m        → .../vl_450m/xnnpack/lfm_2_5_vl_450m_xnnpack_8da4w.pte

const GiB = 1024 ** 3;

describe("MODEL_CATALOGUE (the regression that catches a size lie)", () => {
  it("states Gemma at its REAL size — at least 4 GiB, never 1.3 GB", () => {
    const gemma = MODEL_CATALOGUE["gemma4-e2b"];
    expect(gemma.bytes).toBeGreaterThanOrEqual(4 * GiB);
    // Exact measured sum: 4,371,419,520 (.pte) + 32,169,868 (tokenizer).
    expect(gemma.bytes).toBe(4_403_589_388);
  });

  it("states the Liquid AI model at its real size — 700 MB or less", () => {
    const lfm = MODEL_CATALOGUE["lfm2-5-vl-450m"];
    expect(lfm.bytes).toBeLessThanOrEqual(700 * 1_000_000);
    // Exact measured sum: 648,917,376 (.pte) + 4,733,040 (tokenizer).
    expect(lfm.bytes).toBe(653_650_416);
  });

  it("defaults a NEW install to the light model", () => {
    expect(DEFAULT_MODEL_ID).toBe("lfm2-5-vl-450m");
  });

  it("labels every entry from its own byte count — no hand-typed size strings", () => {
    for (const spec of Object.values(MODEL_CATALOGUE)) {
      expect(spec.sizeLabel).toBe(formatModelBytes(spec.bytes));
      expect(spec.requiredFreeBytes).toBe(requiredFreeBytesFor(spec.id));
      expect(spec.requiredFreeLabel).toBe(formatModelBytes(spec.requiredFreeBytes));
    }
  });

  it("keys each entry by its own id, and names a maker and a licence", () => {
    for (const [id, spec] of Object.entries(MODEL_CATALOGUE)) {
      expect(spec.id).toBe(id);
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.maker.length).toBeGreaterThan(0);
      expect(spec.licence.length).toBeGreaterThan(0);
      expect(spec.licenceUrl).toMatch(/^https:\/\//);
      expect(spec.minRamBytes).toBeGreaterThan(0);
    }
  });

  it("never claims either model is better at plants, and never hand-types a size in prose", () => {
    for (const spec of Object.values(MODEL_CATALOGUE)) {
      // Nothing has been measured — the blurb may talk about size class and
      // memory, never about accuracy.
      expect(spec.blurb).not.toMatch(/\bbetter\b|\bmore accurate\b|\bsmarter\b|\bbest\b/i);
      // Sizes come from sizeLabel next to the blurb, never from the prose.
      expect(spec.blurb).not.toMatch(/\d\s*[KMGT]i?B\b/);
    }
  });

  // The blurbs used to assert a symmetry that is false: this app's prompts and
  // its pruning box format were written and tuned against Gemma, and the light
  // model has never run them here. That is the one KNOWN asymmetry, and it is
  // about provenance, not quality — so it must be stated, and no speed or
  // accuracy claim may be dressed up as measured.
  it("states the provenance asymmetry, and claims no timing it never took", () => {
    expect(MODEL_CATALOGUE["gemma4-e2b"].blurb).toMatch(/prompt/i);
    expect(MODEL_CATALOGUE["lfm2-5-vl-450m"].blurb).toMatch(/not been measured|never run/i);
    // "fastest per photo" was a measurement nobody made.
    expect(MODEL_CATALOGUE["lfm2-5-vl-450m"].blurb).not.toMatch(/\bfastest\b/i);
  });

  it("keeps the light model's RAM bar under a nominal 4 GB phone's real reading", () => {
    // Device.totalMemory is ActivityManager's totalMem — kernel reservations
    // excluded — so a phone sold as "4 GB RAM" reports roughly 3.5-3.8 GiB.
    // The light model exists FOR those phones: its bar must sit below that, or
    // the 654 MB option is blocked on exactly the hardware it was added for.
    expect(MODEL_CATALOGUE["lfm2-5-vl-450m"].minRamBytes).toBeLessThan(3.5 * GiB);
    expect(MODEL_CATALOGUE["gemma4-e2b"].minRamBytes).toBeGreaterThan(
      MODEL_CATALOGUE["lfm2-5-vl-450m"].minRamBytes,
    );
  });

  it("names the one model a pre-F40 install could have downloaded", () => {
    expect(LEGACY_MODEL_ID).toBe("gemma4-e2b");
  });
});

// A "not enough space" refusal must name the way out when there is one: the
// app's own lighter model. Nothing here starts a download — it only reports
// which model WOULD fit.
describe("modelThatFits", () => {
  it("names the lighter model when the heavy one doesn't fit", () => {
    expect(modelThatFits("gemma4-e2b", 2_500_000_000)).toBe("lfm2-5-vl-450m");
  });

  it("is null when nothing else fits either", () => {
    expect(modelThatFits("gemma4-e2b", 100_000_000)).toBeNull();
  });

  it("never names the model that was just refused", () => {
    expect(modelThatFits("lfm2-5-vl-450m", 1_000_000_000)).toBeNull();
  });

  it("is null on an unreadable reading — nothing was refused, so nothing is offered", () => {
    expect(modelThatFits("gemma4-e2b", null)).toBeNull();
    expect(modelThatFits("gemma4-e2b", NaN)).toBeNull();
  });
});

// Trust calibration: the old copy claimed "the difference is size and download
// time, not accuracy" and "neither model has been tested on real plant photos".
// Both assert a parity nobody measured — and the second is contradicted by the
// repo's own record (docs/design/plant-tools.md §4c, D-P2, prune-plan.ts's
// Gemma box_2d convention). Say what is true instead.
describe("modelTestingNote", () => {
  const note = modelTestingNote();

  it("refuses to assert accuracy parity", () => {
    expect(note).not.toMatch(/not accuracy/i);
    expect(note).not.toMatch(/neither model has been tested/i);
  });

  it("says the comparison was never made, and names the provenance asymmetry", () => {
    expect(note).toMatch(/have not compared|haven't compared/i);
    expect(note).toMatch(/prompt/i);
    expect(note).toContain(MODEL_CATALOGUE["gemma4-e2b"].label);
    expect(note).toContain(MODEL_CATALOGUE["lfm2-5-vl-450m"].label);
  });

  it("hand-types no size — the sizes live next to each option", () => {
    expect(note).not.toMatch(/\d\s*[KMGT]i?B\b/);
  });
});

// Naming a licence the user cannot open is hedging placed where the lawyer
// reads it, not where the user does — and shipping the licence text is the
// LFM Open License v1.0's own requirement (§4(a), §4(d)).
describe("modelLicenceLinks", () => {
  it("offers one reachable link per catalogue entry", () => {
    const links = modelLicenceLinks();
    expect(links).toHaveLength(Object.keys(MODEL_CATALOGUE).length);
    for (const link of links) {
      const spec = MODEL_CATALOGUE[link.id];
      expect(link.licence).toBe(spec.licence);
      expect(link.url).toBe(spec.licenceUrl);
      expect(link.url).toMatch(/^https:\/\//);
      expect(link.label).toContain(spec.licence);
    }
  });
});

describe("formatModelBytes (ONE convention: decimal GB/MB, as Android counts)", () => {
  it("uses one decimal for GB", () => {
    expect(formatModelBytes(4_403_589_388)).toBe("4.4 GB");
    expect(formatModelBytes(1_000_000_000)).toBe("1.0 GB");
    expect(formatModelBytes(5_950_000_000)).toBe("6.0 GB");
  });

  it("uses whole MB below a gigabyte", () => {
    expect(formatModelBytes(653_650_416)).toBe("654 MB");
    expect(formatModelBytes(900_000_000)).toBe("900 MB");
    expect(formatModelBytes(1_000_000)).toBe("1 MB");
  });

  it("promotes to GB rather than printing 1000 MB", () => {
    expect(formatModelBytes(999_999_999)).toBe("1.0 GB");
    expect(formatModelBytes(999_400_000)).toBe("999 MB");
  });

  it("reads a broken measurement as nothing, never as junk", () => {
    expect(formatModelBytes(0)).toBe("0 MB");
    expect(formatModelBytes(-1)).toBe("0 MB");
    expect(formatModelBytes(NaN)).toBe("0 MB");
    expect(formatModelBytes(Infinity)).toBe("0 MB");
  });
});

describe("requiredFreeBytesFor (real size + honest unpack headroom)", () => {
  const ids: ModelId[] = ["lfm2-5-vl-450m", "gemma4-e2b"];

  it("is the model's size x1.35, rounded up to 50 MB", () => {
    for (const id of ids) {
      const required = requiredFreeBytesFor(id);
      expect(required).toBe(Math.ceil((modelSpec(id).bytes * 1.35) / 50_000_000) * 50_000_000);
      expect(required % 50_000_000).toBe(0);
    }
  });

  it("is never less than the download itself", () => {
    for (const id of ids) {
      expect(requiredFreeBytesFor(id)).toBeGreaterThanOrEqual(modelSpec(id).bytes);
    }
  });

  it("demands ~6 GB for Gemma — not the flat 2 GiB the app used to claim", () => {
    expect(requiredFreeBytesFor("gemma4-e2b")).toBe(5_950_000_000);
    expect(requiredFreeBytesFor("gemma4-e2b")).toBeGreaterThan(2 * GiB);
    expect(requiredFreeBytesFor("lfm2-5-vl-450m")).toBe(900_000_000);
  });
});

describe("hasRoomFor (per model; an unknown reading NEVER blocks)", () => {
  it("does not block when free space is unreadable", () => {
    expect(hasRoomFor("gemma4-e2b", null)).toBe(true);
    expect(hasRoomFor("gemma4-e2b", NaN)).toBe(true);
    expect(hasRoomFor("lfm2-5-vl-450m", null)).toBe(true);
  });

  it("blocks a phone that cannot hold the model", () => {
    expect(hasRoomFor("gemma4-e2b", 2.5 * 1_000_000_000)).toBe(false);
    expect(hasRoomFor("gemma4-e2b", 0)).toBe(false);
    expect(hasRoomFor("lfm2-5-vl-450m", 500_000_000)).toBe(false);
  });

  it("allows it at exactly the requirement and above", () => {
    expect(hasRoomFor("gemma4-e2b", requiredFreeBytesFor("gemma4-e2b"))).toBe(true);
    expect(hasRoomFor("lfm2-5-vl-450m", requiredFreeBytesFor("lfm2-5-vl-450m"))).toBe(true);
  });

  it("is per model — the same phone can hold the light one and not the heavy one", () => {
    const free = 2.5 * 1_000_000_000;
    expect(hasRoomFor("lfm2-5-vl-450m", free)).toBe(true);
    expect(hasRoomFor("gemma4-e2b", free)).toBe(false);
  });
});

describe("modelSpec / the stored choice (untrusted read)", () => {
  it("falls back to the default for an unknown id", () => {
    expect(modelSpec("nope" as ModelId).id).toBe(DEFAULT_MODEL_ID);
    expect(modelSpec(undefined as unknown as ModelId).id).toBe(DEFAULT_MODEL_ID);
  });

  it("round-trips a choice through storage", () => {
    for (const id of Object.keys(MODEL_CATALOGUE) as ModelId[]) {
      expect(parseModelChoice(serializeModelChoice(id))).toBe(id);
    }
  });

  it("degrades garbage, unknown ids and null to 'not chosen yet'", () => {
    expect(parseModelChoice(null)).toBeNull();
    expect(parseModelChoice("")).toBeNull();
    expect(parseModelChoice("   ")).toBeNull();
    expect(parseModelChoice("gemini-pro")).toBeNull();
    expect(parseModelChoice('{"id":"gemma4-e2b"}')).toBeNull();
    expect(parseModelChoice("GEMMA4-E2B")).toBeNull();
  });

  it("tolerates surrounding whitespace on a real id", () => {
    expect(parseModelChoice(" gemma4-e2b ")).toBe("gemma4-e2b");
  });

  // A stored choice is an untrusted string, and Object.prototype's own keys
  // are reachable through `in` / `[]` on a plain object literal: without an
  // own-property check "constructor" parses as a model id and modelSpec hands
  // the UI the Object constructor, whose .sizeLabel is undefined.
  it("does not mistake Object.prototype keys for model ids", () => {
    for (const key of ["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf"]) {
      expect(parseModelChoice(key)).toBeNull();
      expect(modelSpec(key as ModelId).id).toBe(DEFAULT_MODEL_ID);
      expect(typeof modelSpec(key as ModelId).sizeLabel).toBe("string");
    }
  });
});

describe("modelAttribution (LFM Open License v1.0 requires it)", () => {
  it("names both models, both makers and both licences", () => {
    const text = modelAttribution();
    expect(text).toContain(MODEL_CATALOGUE["lfm2-5-vl-450m"].label);
    expect(text).toContain(MODEL_CATALOGUE["gemma4-e2b"].label);
    expect(text).toContain("Liquid AI");
    expect(text).toContain("Google");
    expect(text).toContain("LFM Open License v1.0");
    // Gemma 4 is Apache-2.0 (Google's own licence page, verified 2026-09-19),
    // unlike Gemma 1-3 under the bespoke Gemma Terms. Naming the wrong licence
    // in an attribution line is exactly the kind of claim that must not drift.
    expect(text).toContain("Apache-2.0");
  });

  it("stays one short paragraph and claims no endorsement", () => {
    const text = modelAttribution();
    expect(text).not.toContain("\n");
    expect(text.length).toBeLessThan(400);
    expect(text).toMatch(/endors/i);
  });
});
