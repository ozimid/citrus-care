import { describe, expect, it } from "vitest";
import { isSafeBasename, isSafeRecordId, newLocalId, newestFirst } from "./local-id";
import { photoFileName } from "./photo-store";

describe("newLocalId", () => {
  it("is deterministic given the same time + randomness", () => {
    expect(newLocalId(1752573600000, 0.123456789)).toBe(newLocalId(1752573600000, 0.123456789));
  });

  it("looks like a lowercase base36 id", () => {
    expect(newLocalId(1752573600000, 0.5)).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
  });

  it("differs across time or randomness (collision resistance)", () => {
    expect(newLocalId(1752573600000, 0.1)).not.toBe(newLocalId(1752573600000, 0.2));
    expect(newLocalId(1752573600000, 0.1)).not.toBe(newLocalId(1752573600001, 0.1));
  });
});

// D-W16: record ids become directory names on disk, so every parse boundary
// runs them through this gate. Legacy (Gemini-era) rows carry UUIDs — those
// must pass too, or a restore would silently drop old thumbnails.
describe("isSafeRecordId", () => {
  it("accepts newLocalId output and RFC-4122 UUIDs (any case)", () => {
    expect(isSafeRecordId(newLocalId(Date.now(), Math.random()))).toBe(true);
    expect(isSafeRecordId(newLocalId(1752573600000, 0.999999999))).toBe(true);
    expect(isSafeRecordId("3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(true);
    expect(isSafeRecordId("3F2504E0-4F89-41D3-9A0C-0305E82C3301")).toBe(true);
  });

  it("rejects traversal, the inbox name, separators, empties and junk", () => {
    expect(isSafeRecordId("..")).toBe(false);
    expect(isSafeRecordId(".")).toBe(false);
    expect(isSafeRecordId("_inbox")).toBe(false);
    expect(isSafeRecordId("a/b")).toBe(false);
    expect(isSafeRecordId("a\\b")).toBe(false);
    expect(isSafeRecordId("")).toBe(false);
    expect(isSafeRecordId("x".repeat(100))).toBe(false);
    expect(isSafeRecordId("p1")).toBe(false);
    expect(isSafeRecordId(42)).toBe(false);
    expect(isSafeRecordId(null)).toBe(false);
    expect(isSafeRecordId(undefined)).toBe(false);
  });
});

describe("isSafeBasename", () => {
  it("accepts only photoFileName output", () => {
    expect(isSafeBasename(photoFileName(Date.now(), Math.random()))).toBe(true);
    expect(isSafeBasename("x1-00000001.jpg")).toBe(true);
    expect(isSafeBasename("x.jpg")).toBe(false);
    expect(isSafeBasename("..")).toBe(false);
    expect(isSafeBasename("../x1-00000001.jpg")).toBe(false);
    expect(isSafeBasename("x1-00000001.png")).toBe(false);
    expect(isSafeBasename("x1-00000001.jpg/")).toBe(false);
    expect(isSafeBasename("")).toBe(false);
    expect(isSafeBasename(7)).toBe(false);
  });
});

// One "newest first" for the timeline, the photo index, the comparison anchor
// and the backup carrier: createdAt desc, then the record key desc, so two
// walk shots in the same second sort the same way everywhere.
describe("newestFirst", () => {
  it("orders by createdAt desc, then by key desc, and is 0 for equal pairs", () => {
    const t0 = "2026-08-20T00:00:00Z";
    const t1 = "2026-08-20T00:00:01Z";
    expect(newestFirst(t0, "a", t1, "b")).toBeGreaterThan(0);
    expect(newestFirst(t1, "a", t0, "b")).toBeLessThan(0);
    expect(newestFirst(t1, "ax", t1, "ay")).toBeGreaterThan(0);
    expect(newestFirst(t1, "ay", t1, "ax")).toBeLessThan(0);
    expect(newestFirst(t1, "ax", t1, "ax")).toBe(0);
  });
});
