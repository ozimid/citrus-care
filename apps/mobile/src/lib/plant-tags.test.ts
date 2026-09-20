import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  CODE_MAX_LENGTH,
  GENERATED_CODE_PREFIX,
  MAX_CODES_PER_PLANT,
  SCAN_REPEAT_WINDOW_MS,
  TAG_MAX_LENGTH,
  codeDigest,
  codeDisplay,
  codeOwners,
  generatePlantCode,
  interpretScan,
  isCodeDigest,
  normalizeCode,
  normalizeTag,
  numericTagOrder,
  plantByCode,
  plantByTag,
  suggestNextTag,
  tagConflict,
} from "./plant-tags";

// F39 Garden Walk, D-W4 + D-W13: two identifiers on the plant record. The human
// TAG is a whitelisted short string the user types ("7", "L3"); a CODE is any
// pre-printed QR sticker's payload, stored only as a SHA-256 digest and matched
// compare-only. A scanned payload is untrusted physical-world input: it is
// normalized, digested and thrown away — never stored, rendered in full, or
// matched against a human tag (D-W3).

const DIGEST_TEST01 = "9a98add769947735eafb88d06b16aa348c7c0e193a49300223cd24daf7f3d30f";
const OTHER_DIGEST = "b".repeat(64);

describe("constants", () => {
  it("pin the contract values the UI and the store are built against", () => {
    expect(TAG_MAX_LENGTH).toBe(24);
    expect(CODE_MAX_LENGTH).toBe(256);
    expect(MAX_CODES_PER_PLANT).toBe(8);
    expect(SCAN_REPEAT_WINDOW_MS).toBe(2_500);
    expect(GENERATED_CODE_PREFIX).toBe("CC1-");
    // No 0/O/1/I — the characters a hand-written code confuses.
    expect(CODE_ALPHABET).toBe("23456789ABCDEFGHJKLMNPQRSTUVWXYZ");
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(CODE_ALPHABET).not.toMatch(/[01OI]/);
  });
});

describe("normalizeTag", () => {
  it("trims, collapses whitespace and uppercases", () => {
    expect(normalizeTag("  l3 ")).toBe("L3");
    expect(normalizeTag("row  a\t7")).toBe("ROW A 7");
    expect(normalizeTag("7")).toBe("7");
  });

  it("applies NFKC so a fullwidth stake number reads like the ASCII one", () => {
    expect(normalizeTag("Ｌ３")).toBe("L3");
  });

  it("accepts the whitelist: letters, digits, space, - _ . #", () => {
    expect(normalizeTag("A-1 B_2.3#4")).toBe("A-1 B_2.3#4");
  });

  it("rejects anything outside the whitelist, empty, or over 24 characters", () => {
    expect(normalizeTag("L3!")).toBeNull();
    expect(normalizeTag("L/3")).toBeNull();
    expect(normalizeTag("émile")).toBeNull();
    expect(normalizeTag("")).toBeNull();
    expect(normalizeTag("   ")).toBeNull();
    expect(normalizeTag("A".repeat(24))).toBe("A".repeat(24));
    expect(normalizeTag("A".repeat(25))).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(normalizeTag(7)).toBeNull();
    expect(normalizeTag(null)).toBeNull();
    expect(normalizeTag(undefined)).toBeNull();
    expect(normalizeTag({ tag: "L3" })).toBeNull();
  });
});

describe("normalizeCode (D-W13 — untrusted payload)", () => {
  it("returns the trimmed payload for an ordinary sticker", () => {
    expect(normalizeCode("  CC1-TEST01\n")).toBe("CC1-TEST01");
  });

  it("applies NFKC", () => {
    expect(normalizeCode("ＣＣ１-ＴＥＳＴ０１")).toBe("CC1-TEST01");
  });

  it("strips format characters (RLO U+202E, ZWSP U+200B) and control characters", () => {
    expect(normalizeCode("CC1-\u202eTEST01")).toBe("CC1-TEST01");
    expect(normalizeCode("CC1-\u200bTEST\u200b01")).toBe("CC1-TEST01");
    expect(normalizeCode("CC1-\u0007TEST\u0000\u001f01")).toBe("CC1-TEST01");
    // Nothing but format/control characters is nothing.
    expect(normalizeCode("\u200b\u202e\u0000")).toBeNull();
  });

  it("rejects the literal strings 'null' and 'undefined' (case-insensitive) — a broken encoder's output", () => {
    expect(normalizeCode("null")).toBeNull();
    expect(normalizeCode("NULL")).toBeNull();
    expect(normalizeCode(" undefined ")).toBeNull();
    expect(normalizeCode("Undefined")).toBeNull();
  });

  it("caps at 256 characters: 256 is kept, 257 is rejected", () => {
    expect(normalizeCode("x".repeat(256))).toBe("x".repeat(256));
    expect(normalizeCode("x".repeat(257))).toBeNull();
  });

  it("keeps a URL-shaped payload opaque — no parsing, no unwrapping, same string", () => {
    const url = "https://example.com/t/abc?x=1&y=%20";
    expect(normalizeCode(url)).toBe(url);
  });

  it("rejects empty strings and non-strings", () => {
    expect(normalizeCode("")).toBeNull();
    expect(normalizeCode("   ")).toBeNull();
    expect(normalizeCode(123)).toBeNull();
    expect(normalizeCode(null)).toBeNull();
    expect(normalizeCode(undefined)).toBeNull();
    expect(normalizeCode(["CC1-TEST01"])).toBeNull();
  });
});

describe("codeDigest / codeDisplay / isCodeDigest", () => {
  it("is the SHA-256 of the normalized payload, stable across calls", () => {
    expect(codeDigest("CC1-TEST01")).toBe(DIGEST_TEST01);
    expect(codeDigest("CC1-TEST01")).toBe(codeDigest("CC1-TEST01"));
    expect(codeDigest("CC1-TEST02")).not.toBe(DIGEST_TEST01);
  });

  it("is always 64 lowercase hex", () => {
    expect(codeDigest("https://example.com/t/abc?x=1")).toMatch(/^[0-9a-f]{64}$/);
    expect(isCodeDigest(DIGEST_TEST01)).toBe(true);
    expect(isCodeDigest(DIGEST_TEST01.toUpperCase())).toBe(false);
    expect(isCodeDigest(DIGEST_TEST01.slice(1))).toBe(false);
    expect(isCodeDigest(`${DIGEST_TEST01}0`)).toBe(false);
    expect(isCodeDigest(42)).toBe(false);
    expect(isCodeDigest(null)).toBe(false);
  });

  it("displays only a 4-hex prefix — never the digest, never the payload", () => {
    expect(codeDisplay(DIGEST_TEST01)).toBe("code · 9a98");
    expect(codeDisplay(DIGEST_TEST01)).not.toContain(DIGEST_TEST01);
    expect(codeDisplay(DIGEST_TEST01).length).toBeLessThan(16);
  });
});

describe("plantByCode / codeOwners", () => {
  const plants = [
    { id: "a", codes: [DIGEST_TEST01] },
    { id: "b", codes: [OTHER_DIGEST] },
    { id: "c" },
    { id: "d", codes: null },
  ];

  it("resolves a digest to its single owner", () => {
    expect(plantByCode(plants, DIGEST_TEST01)).toBe("a");
    expect(codeOwners(plants, DIGEST_TEST01)).toEqual(["a"]);
  });

  it("returns null when no plant owns the digest", () => {
    expect(plantByCode(plants, "c".repeat(64))).toBeNull();
    expect(codeOwners(plants, "c".repeat(64))).toEqual([]);
  });

  it("returns null when two plants own it — exactly one owner decides (D-W3)", () => {
    const dup = [...plants, { id: "e", codes: [DIGEST_TEST01] }];
    expect(plantByCode(dup, DIGEST_TEST01)).toBeNull();
    expect(codeOwners(dup, DIGEST_TEST01)).toEqual(["a", "e"]);
  });
});

describe("plantByTag / tagConflict", () => {
  const plants = [
    { id: "a", tag: "L3" },
    { id: "b", tag: "7" },
    { id: "c", tag: null },
    { id: "d" },
  ];

  it("finds the one plant with that tag, case- and whitespace-insensitively", () => {
    expect(plantByTag(plants, "L3")).toBe("a");
    expect(plantByTag(plants, " l3 ")).toBe("a");
    expect(plantByTag(plants, "7")).toBe("b");
  });

  it("returns null for no match, an invalid tag, or a duplicated tag", () => {
    expect(plantByTag(plants, "L4")).toBeNull();
    expect(plantByTag(plants, "L3!")).toBeNull();
    expect(plantByTag(plants, "")).toBeNull();
    expect(plantByTag([...plants, { id: "e", tag: "L3" }], "L3")).toBeNull();
  });

  it("reports a conflict when another plant holds the tag, ignoring the plant itself", () => {
    expect(tagConflict(plants, "l3")).toBe(true);
    expect(tagConflict(plants, "L3", "a")).toBe(false);
    expect(tagConflict(plants, "L3", "b")).toBe(true);
    expect(tagConflict(plants, "L9")).toBe(false);
    expect(tagConflict(plants, "L3!")).toBe(false);
  });
});

describe("suggestNextTag", () => {
  it("suggests '1' for an untagged garden", () => {
    expect(suggestNextTag([])).toBe("1");
    expect(suggestNextTag([{ tag: null }, { tag: "L3" }])).toBe("1");
  });

  it("fills the smallest gap, ignoring non-numeric tags", () => {
    expect(suggestNextTag([{ tag: "1" }, { tag: "2" }, { tag: "L3" }, { tag: "4" }])).toBe("3");
    expect(suggestNextTag([{ tag: "1" }, { tag: "2" }, { tag: "3" }])).toBe("4");
    expect(suggestNextTag([{ tag: "2" }, { tag: "3" }])).toBe("1");
  });

  it("treats leading zeros as the same number and ignores zero / negatives", () => {
    expect(suggestNextTag([{ tag: "01" }, { tag: "2" }])).toBe("3");
    expect(suggestNextTag([{ tag: "0" }, { tag: "-1" }])).toBe("1");
  });
});

describe("generatePlantCode", () => {
  it("has the CC1- prefix and six characters from the alphabet", () => {
    let seed = 42;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const code = generatePlantCode(random);
    expect(code).toMatch(/^CC1-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    // The six generated symbols never use a look-alike (the "1" in the prefix is fixed text).
    expect(code.slice(GENERATED_CODE_PREFIX.length)).not.toMatch(/[01OI]/);
  });

  it("is deterministic for the same random sequence and covers both ends of the alphabet", () => {
    const seq = (values: number[]) => {
      let i = 0;
      return () => values[i++ % values.length];
    };
    expect(generatePlantCode(seq([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]))).toBe(
      generatePlantCode(seq([0.1, 0.2, 0.3, 0.4, 0.5, 0.6])),
    );
    expect(generatePlantCode(() => 0)).toBe("CC1-222222");
    expect(generatePlantCode(() => 0.999999)).toBe("CC1-ZZZZZZ");
    // A misbehaving random (>= 1) is clamped, never an undefined character.
    expect(generatePlantCode(() => 1)).toBe("CC1-ZZZZZZ");
  });

  it("survives its own normalization unchanged — it is already a clean payload", () => {
    const code = generatePlantCode(() => 0.5);
    expect(normalizeCode(code)).toBe(code);
  });
});

describe("interpretScan", () => {
  const owner = { id: "a", name: "Meyer lemon", tag: "L3", codes: [DIGEST_TEST01] };
  const lime = { id: "b", name: "Lime", tag: "7", codes: [] as string[] };
  const plants = [owner, lime];
  const state = (overrides: Partial<Parameters<typeof interpretScan>[2]> = {}) => ({
    lastDigest: null,
    lastAtMs: 0,
    nowMs: 100_000,
    dismissed: new Set<string>(),
    ...overrides,
  });

  it("binds to the code's single owner", () => {
    expect(interpretScan(plants, "CC1-TEST01", state())).toEqual({
      kind: "bound",
      plantId: "a",
      digest: DIGEST_TEST01,
    });
  });

  it("NEVER matches a human tag — a payload equal to a stake number is an unknown code", () => {
    expect(interpretScan(plants, "7", state()).kind).toBe("unknown");
    expect(interpretScan(plants, "L3", state()).kind).toBe("unknown");
  });

  it("reports an unknown code with its display prefix and never the payload", () => {
    const url = "https://evil.example/track?id=123";
    const result = interpretScan(plants, url, state());
    const digest = codeDigest(url);
    expect(result).toEqual({ kind: "unknown", digest, display: codeDisplay(digest) });
    expect(JSON.stringify(result)).not.toContain("evil.example");
  });

  it("reports ambiguity when two plants own the code, listing them", () => {
    const dup = [...plants, { id: "c", codes: [DIGEST_TEST01] }];
    expect(interpretScan(dup, "CC1-TEST01", state())).toEqual({
      kind: "ambiguous",
      digest: DIGEST_TEST01,
      plantIds: ["a", "c"],
    });
  });

  it("ignores a repeat of the same digest within the 2 500 ms window, and not after", () => {
    const seen = { lastDigest: DIGEST_TEST01, lastAtMs: 100_000 };
    expect(interpretScan(plants, "CC1-TEST01", state({ ...seen, nowMs: 100_001 }))).toEqual({
      kind: "ignored",
      reason: "repeat",
    });
    expect(interpretScan(plants, "CC1-TEST01", state({ ...seen, nowMs: 102_500 })).kind).toBe("ignored");
    expect(interpretScan(plants, "CC1-TEST01", state({ ...seen, nowMs: 102_501 })).kind).toBe("bound");
    // A different code right after is not a repeat.
    expect(interpretScan(plants, "CC1-OTHER", state({ ...seen, nowMs: 100_001 })).kind).toBe("unknown");
  });

  it("ignores an invalid payload", () => {
    for (const bad of ["", "   ", "null", "undefined", "\u200b", 123, undefined, null, "x".repeat(257)]) {
      expect(interpretScan(plants, bad, state())).toEqual({ kind: "ignored", reason: "invalid" });
    }
  });

  it("ignores every scan when there are no plants to bind to", () => {
    expect(interpretScan([], "CC1-TEST01", state())).toEqual({ kind: "ignored", reason: "no-plants" });
  });

  it("ignores a code the user dismissed this session — unless it has since been bound", () => {
    const unknownDigest = codeDigest("CC1-OTHER");
    const dismissed = new Set([unknownDigest, DIGEST_TEST01]);
    expect(interpretScan(plants, "CC1-OTHER", state({ dismissed }))).toEqual({
      kind: "ignored",
      reason: "dismissed",
    });
    // Dismissal suppresses the bind prompt, not a real binding.
    expect(interpretScan(plants, "CC1-TEST01", state({ dismissed })).kind).toBe("bound");
    // An ambiguous code that was dismissed stays quiet too.
    const dup = [...plants, { id: "c", codes: [DIGEST_TEST01] }];
    expect(interpretScan(dup, "CC1-TEST01", state({ dismissed }))).toEqual({
      kind: "ignored",
      reason: "dismissed",
    });
  });

  it("does not mutate the dismissed set or the plants", () => {
    const dismissed = new Set<string>();
    const copy = plants.map((p) => ({ ...p, codes: [...p.codes] }));
    interpretScan(plants, "CC1-OTHER", state({ dismissed }));
    expect(dismissed.size).toBe(0);
    expect(plants).toEqual(copy);
  });
});

describe("numericTagOrder", () => {
  it("orders tags numerically ('L2' < 'L3' < 'L10', '9' < '10') and puts untagged plants last", () => {
    const list = [{ tag: "L10" }, { tag: null }, { tag: "L2" }, {}, { tag: "10" }, { tag: "9" }, { tag: "L3" }];
    expect([...list].sort(numericTagOrder).map((p) => p.tag ?? "-")).toEqual(["9", "10", "L2", "L3", "L10", "-", "-"]);
  });

  it("is 0 for two untagged plants and antisymmetric for tagged ones", () => {
    expect(numericTagOrder({}, { tag: null })).toBe(0);
    expect(Math.sign(numericTagOrder({ tag: "2" }, { tag: "10" }))).toBe(-1);
    expect(Math.sign(numericTagOrder({ tag: "10" }, { tag: "2" }))).toBe(1);
    expect(Math.sign(numericTagOrder({ tag: "2" }, { tag: null }))).toBe(-1);
  });
});
