import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./sha256";

// F39 (D-W4/D-W13): a scanned code is stored ONLY as the SHA-256 of its
// normalized payload, so the digest is the one thing that must be right. Hermes
// has no WebCrypto digest and expo-crypto would be a native dependency (D-W12),
// hence a pure implementation — pinned here to the FIPS 180-4 test vectors and
// cross-checked against node:crypto on UTF-8 input.

describe("sha256Hex — FIPS 180-4 vectors", () => {
  it("one block: 'abc'", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("the empty message", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("two blocks: the 448-bit message (padding spills into a second block)", () => {
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("the 896-bit message", () => {
    expect(
      sha256Hex("abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu"),
    ).toBe("cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1");
  });

  it("a million 'a's (many blocks, length field well past one byte)", () => {
    expect(sha256Hex("a".repeat(1_000_000))).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
  });
});

describe("sha256Hex — UTF-8 input", () => {
  it("hashes the UTF-8 bytes, not the UTF-16 code units", () => {
    expect(sha256Hex("héllo wörld €")).toBe("a3260bb658a2bce4e8e8b9cd613904a51582e107bd16c453b5530bd56be4937a");
    // A surrogate pair is one 4-byte sequence.
    expect(sha256Hex("🍋")).toBe("9b75dacc581cbbf5ddffde5fdca608c93c8e2a1cf5fb0f81cda0401988a09cc3");
  });

  it("agrees with node:crypto across lengths that straddle every padding boundary", () => {
    for (let n = 0; n <= 130; n++) {
      const s = "x".repeat(n);
      expect(sha256Hex(s), `length ${n}`).toBe(createHash("sha256").update(s, "utf8").digest("hex"));
    }
  });

  it("agrees with node:crypto on mixed code points, including astral and lone surrogates", () => {
    // Deterministic LCG so the run is reproducible; lone surrogates are
    // replaced with U+FFFD by both TextEncoder and node, so ours must too.
    let seed = 20260919;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let round = 0; round < 40; round++) {
      let s = "";
      const len = Math.floor(next() * 40);
      for (let i = 0; i < len; i++) {
        const r = next();
        const cp =
          r < 0.4
            ? 0x20 + Math.floor(next() * 0x5f) // ASCII
            : r < 0.7
              ? 0x80 + Math.floor(next() * 0x77f) // 2-byte
              : r < 0.9
                ? 0x800 + Math.floor(next() * 0xf7ff) // 3-byte (surrogate range handled below)
                : 0x10000 + Math.floor(next() * 0xffff); // 4-byte
        s += cp >= 0xd800 && cp <= 0xdfff ? "\ud83c" : String.fromCodePoint(cp);
      }
      if (round % 7 === 0) s += "\ud800"; // a lone high surrogate at the end
      expect(sha256Hex(s), JSON.stringify(s)).toBe(createHash("sha256").update(s, "utf8").digest("hex"));
    }
  });

  it("is always 64 lowercase hex characters", () => {
    for (const s of ["", "a", "CC1-TEST01", "https://example.com/t/abc?x=1"]) {
      expect(sha256Hex(s)).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
