import { describe, expect, it } from "vitest";
import type { QueuedPhoto } from "./photo-queue";
import {
  applyPlantToRun,
  importSummary,
  orderImportedPhotos,
  parseExifDateTime,
  pickExifDates,
  takenAtFromAsset,
} from "./photo-import";

// D-W13: EXIF and file names are untrusted physical-world input. The whitelist
// lives in code, the raw object is dropped by the io the moment this runs, and
// a date is parsed as the DEVICE-LOCAL wall clock the camera wrote — never
// string-sliced into a fake "Z" instant.

describe("pickExifDates (whitelist)", () => {
  it("keeps only the five date fields and drops everything else, GPS first of all", () => {
    const exif = {
      DateTimeOriginal: "2026:09:19 10:15:33",
      SubSecTimeOriginal: "123",
      OffsetTimeOriginal: "+02:00",
      DateTimeDigitized: "2026:09:19 10:15:34",
      DateTime: "2026:09:19 10:16:00",
      GPSLatitude: 50.45,
      GPSLongitude: 30.52,
      GPSLatitudeRef: "N",
      UserComment: "my garden",
      ImageDescription: "lemon tree",
      Make: "Samsung",
      Orientation: 6,
    };
    expect(pickExifDates(exif)).toEqual({
      original: "2026:09:19 10:15:33",
      subsec: "123",
      offset: "+02:00",
      digitized: "2026:09:19 10:15:34",
      dateTime: "2026:09:19 10:16:00",
    });
    expect(Object.keys(pickExifDates(exif)).join(" ")).not.toMatch(/gps|comment|description/i);
  });

  it("returns an empty object for anything that is not an object, and skips non-string values", () => {
    expect(pickExifDates(null)).toEqual({});
    expect(pickExifDates(undefined)).toEqual({});
    expect(pickExifDates("2026:09:19 10:15:33")).toEqual({});
    expect(pickExifDates([1, 2])).toEqual({});
    expect(pickExifDates({ DateTimeOriginal: 20260919, DateTime: "2026:09:19 10:16:00" })).toEqual({
      dateTime: "2026:09:19 10:16:00",
    });
  });
});

describe("parseExifDateTime (local instant)", () => {
  it("builds the instant with the local Date constructor — the camera's wall clock", () => {
    expect(parseExifDateTime("2026:09:19 10:15:33")).toBe(new Date(2026, 8, 19, 10, 15, 33).toISOString());
  });

  it("adds the sub-second part as milliseconds", () => {
    expect(parseExifDateTime("2026:09:19 10:15:33", "123")).toBe(new Date(2026, 8, 19, 10, 15, 33, 123).toISOString());
    expect(parseExifDateTime("2026:09:19 10:15:33", "5")).toBe(new Date(2026, 8, 19, 10, 15, 33, 500).toISOString());
    expect(parseExifDateTime("2026:09:19 10:15:33", "junk")).toBe(new Date(2026, 8, 19, 10, 15, 33).toISOString());
  });

  it("honours OffsetTimeOriginal when it is well-formed, building the instant from that offset", () => {
    expect(parseExifDateTime("2026:09:19 10:15:33", undefined, "+02:00")).toBe("2026-09-19T08:15:33.000Z");
    expect(parseExifDateTime("2026:09:19 10:15:33", "250", "-05:30")).toBe("2026-09-19T15:45:33.250Z");
    // A malformed offset falls back to local time rather than guessing.
    expect(parseExifDateTime("2026:09:19 10:15:33", undefined, "UTC+2")).toBe(new Date(2026, 8, 19, 10, 15, 33).toISOString());
  });

  it("rejects anything that is not exactly the EXIF shape", () => {
    expect(parseExifDateTime("2026-09-19 10:15:33")).toBeNull();
    expect(parseExifDateTime("2026:09:19T10:15:33")).toBeNull();
    expect(parseExifDateTime(" 2026:09:19 10:15:33")).toBeNull();
    expect(parseExifDateTime("2026:09:19 10:15:33Z")).toBeNull();
    expect(parseExifDateTime("")).toBeNull();
    expect(parseExifDateTime(20260919)).toBeNull();
    expect(parseExifDateTime(null)).toBeNull();
    expect(parseExifDateTime(undefined)).toBeNull();
  });

  it("rejects the all-zero date some cameras write, and out-of-range fields", () => {
    expect(parseExifDateTime("0000:00:00 00:00:00")).toBeNull();
    expect(parseExifDateTime("2026:13:01 10:00:00")).toBeNull();
    expect(parseExifDateTime("2026:09:32 10:00:00")).toBeNull();
    expect(parseExifDateTime("2026:09:19 24:00:00")).toBeNull();
    expect(parseExifDateTime("2026:09:19 10:60:00")).toBeNull();
  });
});

describe("takenAtFromAsset (the chain)", () => {
  it("prefers DateTimeOriginal with its sub-second and offset", () => {
    const asset = {
      exif: { DateTimeOriginal: "2026:09:19 10:15:33", SubSecTimeOriginal: "42", OffsetTimeOriginal: "+02:00", DateTime: "2026:09:19 11:00:00" },
      fileName: "IMG_20260101_000000.jpg",
    };
    expect(takenAtFromAsset(asset)).toBe("2026-09-19T08:15:33.420Z");
  });

  it("falls back to DateTimeDigitized, then DateTime", () => {
    expect(takenAtFromAsset({ exif: { DateTimeDigitized: "2026:09:19 10:15:34", DateTime: "2026:09:19 11:00:00" } })).toBe(
      new Date(2026, 8, 19, 10, 15, 34).toISOString(),
    );
    expect(takenAtFromAsset({ exif: { DateTime: "2026:09:19 11:00:00" } })).toBe(new Date(2026, 8, 19, 11, 0, 0).toISOString());
  });

  it("reads a stock-camera file name when EXIF has no date (local wall clock)", () => {
    expect(takenAtFromAsset({ exif: {}, fileName: "IMG_20260919_101533.jpg" })).toBe(new Date(2026, 8, 19, 10, 15, 33).toISOString());
    expect(takenAtFromAsset({ fileName: "PXL_20260919-101533.MP.jpg" })).toBe(new Date(2026, 8, 19, 10, 15, 33).toISOString());
    expect(takenAtFromAsset({ exif: { DateTimeOriginal: "garbage" }, fileName: "20260919_101533.jpg" })).toBe(
      new Date(2026, 8, 19, 10, 15, 33).toISOString(),
    );
  });

  it("is null when nothing is known — never a fake 'now'", () => {
    expect(takenAtFromAsset({})).toBeNull();
    expect(takenAtFromAsset({ exif: null, fileName: null })).toBeNull();
    expect(takenAtFromAsset({ fileName: "photo.jpg" })).toBeNull();
    expect(takenAtFromAsset({ fileName: "IMG_2026091_101533.jpg" })).toBeNull();
    expect(takenAtFromAsset({ fileName: "IMG_20261319_101533.jpg" })).toBeNull();
  });
});

describe("orderImportedPhotos", () => {
  it("puts known times first, ascending, then unknowns in the order the user picked them", () => {
    const items = [
      { id: "a", takenAt: null },
      { id: "b", takenAt: "2026-09-19T08:00:30.000Z" },
      { id: "c", takenAt: null },
      { id: "d", takenAt: "2026-09-19T08:00:10.000Z" },
      { id: "e", takenAt: "2026-09-19T08:00:10.000Z" },
    ];
    expect(orderImportedPhotos(items).map((i) => i.id)).toEqual(["d", "e", "b", "a", "c"]);
    // Pure: the input is untouched.
    expect(items.map((i) => i.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("is stable for equal times and handles the empty list", () => {
    const t = "2026-09-19T08:00:10.000Z";
    const items = [{ id: "z", takenAt: t }, { id: "y", takenAt: t }, { id: "x", takenAt: t }];
    expect(orderImportedPhotos(items).map((i) => i.id)).toEqual(["z", "y", "x"]);
    expect(orderImportedPhotos([])).toEqual([]);
  });
});

describe("applyPlantToRun (rung 1b, D-W3)", () => {
  const P1 = "p1-00000001";
  const P2 = "p2-00000001";

  function item(id: string, overrides: Partial<QueuedPhoto> = {}): QueuedPhoto {
    return {
      id,
      walkId: "w1-00000001",
      groupId: id,
      plantId: null,
      evidence: "none",
      suggestedPlantId: null,
      basename: "x1-00000001.jpg",
      width: 1600,
      height: 1200,
      takenAt: null,
      addedAt: "2026-09-19T08:00:00.000Z",
      source: "gallery",
      codeDigest: null,
      fileName: null,
      status: "pending",
      startedAt: null,
      runAnchorIso: null,
      attempts: 0,
      error: null,
      timedOut: false,
      rejectedDiagnosis: null,
      ...overrides,
    };
  }

  it("assigns just the tapped photo when the run toggle is off", () => {
    const items = [item("a"), item("b"), item("c")];
    const next = applyPlantToRun(items, "b", P1, false);
    expect(next.map((i) => [i.plantId, i.evidence])).toEqual([[null, "none"], [P1, "user"], [null, "none"]]);
    expect(items[1].plantId).toBeNull();
  });

  it("carries the plant to the following unassigned or suggested photos until the next explicit one", () => {
    const items = [
      item("a"),
      item("b"),
      item("c", { plantId: null, evidence: "none", suggestedPlantId: P2 }),
      item("d", { plantId: P2, evidence: "group" }),
      item("e", { plantId: P2, evidence: "user" }),
      item("f"),
    ];
    const next = applyPlantToRun(items, "b", P1, true);
    expect(next.map((i) => [i.id, i.plantId, i.evidence])).toEqual([
      ["a", null, "none"],
      ["b", P1, "user"],
      ["c", P1, "user-run"],
      ["d", P1, "user-run"],
      ["e", P2, "user"],
      ["f", null, "none"],
    ]);
    expect(next[2].suggestedPlantId).toBeNull();
  });

  it("stops at every kind of explicit evidence", () => {
    for (const evidence of ["user", "user-run", "code-scan", "tag-card", "marker"] as const) {
      const items = [item("a"), item("b", { plantId: P2, evidence }), item("c")];
      const next = applyPlantToRun(items, "a", P1, true);
      expect(next[1].plantId).toBe(P2);
      expect(next[2].plantId).toBeNull();
    }
  });

  it("resets the run state of every photo it reassigns", () => {
    const items = [
      item("a", { status: "failed", attempts: 3, error: "Took too long", timedOut: true, runAnchorIso: "x" }),
      item("b", { status: "failed", attempts: 2, runAnchorIso: "y" }),
    ];
    const next = applyPlantToRun(items, "a", P1, true);
    for (const i of next) {
      expect(i).toMatchObject({ status: "pending", attempts: 0, error: null, timedOut: false, runAnchorIso: null });
    }
  });

  it("returns the list unchanged when the start id is unknown", () => {
    const items = [item("a"), item("b")];
    expect(applyPlantToRun(items, "zz", P1, true)).toEqual(items);
  });
});

describe("importSummary", () => {
  it("reads as one honest line", () => {
    expect(importSummary({ total: 12, assigned: 10, needsPlant: 2, failed: 0 })).toBe("12 photos · 10 assigned · 2 need a plant");
    expect(importSummary({ total: 12, assigned: 10, needsPlant: 1, failed: 1 })).toBe(
      "12 photos · 10 assigned · 1 needs a plant · 1 couldn't be imported",
    );
  });

  it("handles singulars and drops empty parts", () => {
    expect(importSummary({ total: 1, assigned: 1, needsPlant: 0, failed: 0 })).toBe("1 photo · 1 assigned");
    expect(importSummary({ total: 3, assigned: 0, needsPlant: 3, failed: 0 })).toBe("3 photos · 3 need a plant");
    expect(importSummary({ total: 0, assigned: 0, needsPlant: 0, failed: 2 })).toBe("0 photos · 2 couldn't be imported");
  });
});
