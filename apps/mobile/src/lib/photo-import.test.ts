import { describe, expect, it } from "vitest";
import type { QueuedPhoto } from "./photo-queue";
import {
  applyPlantToRun,
  assignByMarkers,
  classifyScan,
  fileTagToken,
  importSummary,
  markerRunSize,
  orderImportedPhotos,
  parseExifDateTime,
  pickExifDates,
  takenAtFromAsset,
} from "./photo-import";
import { codeDigest } from "./plant-tags";

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

const P1 = "p1-00000001";
const P2 = "p2-00000001";
const P3 = "p3-00000001";

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

describe("applyPlantToRun (rung 1b, D-W3)", () => {
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
    for (const evidence of ["user", "user-run", "code-scan", "tag-card", "marker", "file-tag"] as const) {
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

// Rung 3 (D-W3 / D-W13 / D-W15): an import-side QR hit is a sticker close-up.
// The payload is normalized, digested and thrown away; only bound codes match
// — a human tag is never consulted, so "7" printed on a sticker cannot select
// stake 7.
describe("classifyScan (rung 3, D-W3)", () => {
  const payload = "https://example.com/t/abc?x=1";
  const digest = codeDigest(payload);

  it("is null for no payload and for a payload that normalizes to nothing", () => {
    const plants = [{ id: P1, codes: [digest] }];
    expect(classifyScan(null, plants)).toBeNull();
    expect(classifyScan("", plants)).toBeNull();
    expect(classifyScan("   ", plants)).toBeNull();
    expect(classifyScan("undefined", plants)).toBeNull();
    expect(classifyScan("null", plants)).toBeNull();
  });

  it("names the one owner as a tag card", () => {
    const plants = [{ id: P1, codes: [digest] }, { id: P2, codes: [codeDigest("CC1-OTHER1")] }, { id: P3 }];
    expect(classifyScan(payload, plants)).toEqual({ role: "tag-card", plantId: P1, digest });
  });

  it("normalizes the payload before digesting — whitespace and format characters do not make a new code", () => {
    const plants = [{ id: P1, codes: [digest] }];
    expect(classifyScan(`  ${payload}​\n`, plants)).toEqual({ role: "tag-card", plantId: P1, digest });
  });

  it("is ambiguous with two owners and carries both ids", () => {
    const plants = [{ id: P1, codes: [digest] }, { id: P2, codes: [digest] }];
    expect(classifyScan(payload, plants)).toEqual({ role: "ambiguous", digest, plantIds: [P1, P2] });
  });

  it("is an unknown code with no owner, carrying only the digest — never the payload", () => {
    const result = classifyScan(payload, [{ id: P1, codes: [] }, { id: P2, codes: null }]);
    expect(result).toEqual({ role: "unknown-code", digest });
    expect(JSON.stringify(result)).not.toContain("example.com");
    expect(classifyScan(payload, [])).toEqual({ role: "unknown-code", digest });
  });

  it("never matches a human tag: a sticker that says '7' does not select stake 7", () => {
    const plants = [
      { id: P1, tag: "7", codes: [] as string[] },
      { id: P2, tag: "L3", codes: [] as string[] },
    ];
    expect(classifyScan("7", plants)).toEqual({ role: "unknown-code", digest: codeDigest("7") });
    expect(classifyScan("L3", plants)).toEqual({ role: "unknown-code", digest: codeDigest("L3") });
  });
});

// Rungs 1c / 3 (D-W3): a tag card or a user-marked tree-marker photo hands its
// plant to the photos after it — until the next marker or the next photo the
// user (or a deliberate scan) decided on. Never backwards, never past an
// explicit decision.
describe("assignByMarkers (rungs 1c / 3, D-W3)", () => {
  const CODE_A = codeDigest("CC1-AAAAAA");
  const CODE_B = codeDigest("CC1-BBBBBB");

  function card(id: string, plantId: string, digest: string): QueuedPhoto {
    return item(id, { isMarker: true, plantId, evidence: "marker", codeDigest: digest });
  }

  function marker(id: string, plantId: string): QueuedPhoto {
    return item(id, { isMarker: true, plantId, evidence: "marker" });
  }

  it("[card A, p, p, card B, p] → A, A, B with evidence tag-card; the cards themselves are untouched", () => {
    const items = [card("a", P1, CODE_A), item("p1"), item("p2"), card("b", P2, CODE_B), item("p3")];
    const next = assignByMarkers(items, { a: P1, b: P2 });
    expect(next.map((i) => [i.id, i.plantId, i.evidence])).toEqual([
      ["a", P1, "marker"],
      ["p1", P1, "tag-card"],
      ["p2", P1, "tag-card"],
      ["b", P2, "marker"],
      ["p3", P2, "tag-card"],
    ]);
    expect(next[0]).toBe(items[0]);
    expect(next[3]).toBe(items[3]);
    expect(next.filter((i) => i.isMarker).map((i) => i.id)).toEqual(["a", "b"]);
    // Pure: the input is untouched.
    expect(items[1].plantId).toBeNull();
  });

  it("a user-marked marker (no code) gives evidence marker", () => {
    const next = assignByMarkers([marker("m", P1), item("p1"), item("p2")], { m: P1 });
    expect(next.slice(1).map((i) => [i.plantId, i.evidence])).toEqual([[P1, "marker"], [P1, "marker"]]);
  });

  it("stops at the next explicit item and does not resume after it", () => {
    for (const evidence of ["user", "user-run", "code-scan"] as const) {
      const items = [card("a", P1, CODE_A), item("p1"), item("x", { plantId: P2, evidence }), item("p2")];
      const next = assignByMarkers(items, { a: P1 });
      expect(next.map((i) => [i.id, i.plantId, i.evidence])).toEqual([
        ["a", P1, "marker"],
        ["p1", P1, "tag-card"],
        ["x", P2, evidence],
        ["p2", null, "none"],
      ]);
      expect(next[2]).toBe(items[2]);
      expect(next[3]).toBe(items[3]);
    }
  });

  it("a photo the user explicitly left unassigned also ends the run", () => {
    const items = [marker("m", P1), item("p1"), item("x", { plantId: null, evidence: "user" }), item("p2")];
    const next = assignByMarkers(items, { m: P1 });
    expect(next.map((i) => i.plantId)).toEqual([P1, P1, null, null]);
    expect(next[2]).toBe(items[2]);
  });

  it("leaves the items before the first marker untouched", () => {
    const items = [item("p0"), item("p1", { plantId: null, suggestedPlantId: P2 }), card("a", P1, CODE_A), item("p2")];
    const next = assignByMarkers(items, { a: P1 });
    expect(next[0]).toBe(items[0]);
    expect(next[1]).toBe(items[1]);
    expect(next[3]).toMatchObject({ plantId: P1, evidence: "tag-card" });
  });

  it("overrides suggested, group-propagated and carried items, but not explicit ones", () => {
    const items = [
      card("a", P1, CODE_A),
      item("s", { plantId: null, evidence: "none", suggestedPlantId: P2 }),
      item("g", { plantId: P2, evidence: "group" }),
      item("c", { plantId: P2, evidence: "carried" }),
      item("u", { plantId: P2, evidence: "user" }),
    ];
    const next = assignByMarkers(items, { a: P1 });
    expect(next.map((i) => [i.id, i.plantId, i.evidence])).toEqual([
      ["a", P1, "marker"],
      ["s", P1, "tag-card"],
      ["g", P1, "tag-card"],
      ["c", P1, "tag-card"],
      ["u", P2, "user"],
    ]);
    expect(next[1].suggestedPlantId).toBeNull();
  });

  it("a deciding file-name marker (#L7.jpg) is the user's own token: it is never overridden and it ends the run", () => {
    const items = [card("a", P1, CODE_A), item("p1"), item("f", { plantId: P2, evidence: "file-tag" }), item("p2")];
    const next = assignByMarkers(items, { a: P1 });
    expect(next.map((i) => [i.id, i.plantId, i.evidence])).toEqual([
      ["a", P1, "marker"],
      ["p1", P1, "tag-card"],
      ["f", P2, "file-tag"],
      ["p2", null, "none"],
    ]);
    expect(next[2]).toBe(items[2]);
  });

  it("recomputes an earlier marker propagation instead of treating it as a decision", () => {
    // The user re-marked card A as plant 3: the photos after it must follow.
    const items = [card("a", P3, CODE_A), item("p1", { plantId: P1, evidence: "tag-card" }), item("p2", { plantId: P1, evidence: "marker" })];
    const next = assignByMarkers(items, { a: P3 });
    expect(next.slice(1).map((i) => i.plantId)).toEqual([P3, P3]);
  });

  it("an unknown code (a sticker nobody has bound yet) ends the run and is itself left alone", () => {
    const CODE_X = codeDigest("CC1-XXXXXX");
    const items = [card("a", P1, CODE_A), item("p1"), item("x", { codeDigest: CODE_X }), item("p2"), card("b", P2, CODE_B), item("p3")];
    const next = assignByMarkers(items, { a: P1, b: P2 });
    expect(next.map((i) => [i.id, i.plantId])).toEqual([
      ["a", P1],
      ["p1", P1],
      ["x", null],
      ["p2", null],
      ["b", P2],
      ["p3", P2],
    ]);
    expect(next[2]).toBe(items[2]);
  });

  it("resets the run state of every photo it reassigns", () => {
    const items = [marker("m", P1), item("p1", { status: "failed", attempts: 3, error: "Took too long", timedOut: true, runAnchorIso: "x" })];
    const next = assignByMarkers(items, { m: P1 });
    expect(next[1]).toMatchObject({ plantId: P1, status: "pending", attempts: 0, error: null, timedOut: false, runAnchorIso: null });
  });

  it("with no markers, or markers naming ids that are not in the list, changes nothing", () => {
    const items = [item("p1"), item("p2", { plantId: P2, evidence: "group" })];
    expect(assignByMarkers(items, {})).toEqual(items);
    expect(assignByMarkers(items, { zz: P1 })).toEqual(items);
    expect(assignByMarkers([], { a: P1 })).toEqual([]);
  });
});

describe("markerRunSize (the confirm's number for 'Use as tree marker')", () => {
  it("counts, over the WHOLE walk, every photo the marker would move — other plants' soft photos included — up to the next explicit one", () => {
    const walk = [
      item("p0", { plantId: P2, evidence: "group" }),
      item("m", { plantId: P1, evidence: "user" }),
      item("p1"),
      item("p2", { plantId: P2, evidence: "group" }),
      item("p3", { plantId: P3, evidence: "carried" }),
      item("p4", { plantId: P2, evidence: "user" }),
      item("p5"),
    ];
    expect(markerRunSize(walk, "m", P1)).toBe(3);
    // The same count whichever plant the marker names — the count is about
    // reach, and the input is not mutated.
    expect(markerRunSize(walk, "m", P3)).toBe(3);
    expect(walk[1].isMarker).toBeUndefined();
  });

  it("does not count the marker itself, and is 0 with nothing after it or an unknown id", () => {
    const walk = [item("p0"), item("m", { plantId: P1, evidence: "group" })];
    expect(markerRunSize(walk, "m", P1)).toBe(0);
    expect(markerRunSize(walk, "zz", P1)).toBe(0);
    expect(markerRunSize([], "m", P1)).toBe(0);
  });

  it("counts a photo an earlier card already handed on — re-marking recomputes the run", () => {
    const CODE_A = codeDigest("CC1-AAAAAA");
    const walk = [
      item("a", { isMarker: true, plantId: P1, evidence: "marker", codeDigest: CODE_A }),
      item("p1", { plantId: P1, evidence: "tag-card" }),
      item("m", { plantId: P1, evidence: "tag-card" }),
      item("p2", { plantId: P1, evidence: "tag-card" }),
    ];
    expect(markerRunSize(walk, "m", P2)).toBe(1);
  });
});

// Rung 5 (D-W3 / D-W13): a file name is display text the user may have
// renamed by hand. A marker token decides; a bare tag only suggests; bare
// digits and stock camera names never match anything.
describe("fileTagToken (rung 5, D-W3)", () => {
  const plants = [
    { id: P1, tag: "L3" },
    { id: P2, tag: "7" },
    { id: P3, tag: "ROW A 12" },
  ];

  it("a marker token decides: #L3, TAG-L3, T-L3 — in any case", () => {
    expect(fileTagToken("#L3.jpg", plants)).toEqual({ plantId: P1, decides: true });
    expect(fileTagToken("TAG-L3 lime.jpg", plants)).toEqual({ plantId: P1, decides: true });
    expect(fileTagToken("tag-l3.jpg", plants)).toEqual({ plantId: P1, decides: true });
    expect(fileTagToken("T-L3.jpg", plants)).toEqual({ plantId: P1, decides: true });
    expect(fileTagToken("lemon #l3 (2).jpeg", plants)).toEqual({ plantId: P1, decides: true });
  });

  it("a bare tag with a letter and two or more characters only suggests", () => {
    expect(fileTagToken("L3.jpg", plants)).toEqual({ plantId: P1, decides: false });
    expect(fileTagToken("lime L3 back.jpg", plants)).toEqual({ plantId: P1, decides: false });
    expect(fileTagToken("l3.JPG", plants)).toEqual({ plantId: P1, decides: false });
  });

  it("bare digits never match a numeric tag; a deliberate marker for it does", () => {
    expect(fileTagToken("7.jpg", plants)).toBeNull();
    expect(fileTagToken("07.jpg", plants)).toBeNull();
    expect(fileTagToken("lemon 7.jpg", plants)).toBeNull();
    expect(fileTagToken("#7.jpg", plants)).toEqual({ plantId: P2, decides: true });
    expect(fileTagToken("TAG-7.jpg", plants)).toEqual({ plantId: P2, decides: true });
  });

  it("a one-character tag is never matched bare", () => {
    const one = [{ id: P1, tag: "A" }];
    expect(fileTagToken("A.jpg", one)).toBeNull();
    expect(fileTagToken("#A.jpg", one)).toEqual({ plantId: P1, decides: true });
  });

  it("default camera names match nothing — even a plant tagged with a camera prefix", () => {
    const trap = [...plants, { id: "p4-00000001", tag: "IMG" }, { id: "p5-00000001", tag: "PXL" }, { id: "p6-00000001", tag: "DSC" }];
    for (const name of [
      "IMG_20260919_101502.jpg",
      "PXL_20260919_101502123.MP.jpg",
      "PXL_20260919_101502123.PORTRAIT.jpg",
      "DSC_0042.JPG",
      "DSCN1234.jpg",
      "20260919_101502.jpg",
      "Screenshot_20260919-101502.png",
      "photo.jpg",
    ]) {
      expect(fileTagToken(name, trap), name).toBeNull();
    }
  });

  it("is null when the tag is ambiguous — shared by two plants, or two tokens name two plants", () => {
    expect(fileTagToken("#L3.jpg", [...plants, { id: "p4-00000001", tag: "L3" }])).toBeNull();
    expect(fileTagToken("L3.jpg", [...plants, { id: "p4-00000001", tag: "l3" }])).toBeNull();
    expect(fileTagToken("#L3 #7.jpg", plants)).toBeNull();
    // The same plant named twice is one answer, and a marker form wins over a bare one.
    expect(fileTagToken("L3 #L3.jpg", plants)).toEqual({ plantId: P1, decides: true });
  });

  it("ignores untagged plants and malformed tags", () => {
    const loose = [{ id: P1, tag: "L3" }, { id: P2 }, { id: P3, tag: null }, { id: "p4-00000001", tag: "" }];
    expect(fileTagToken("#L3.jpg", loose)).toEqual({ plantId: P1, decides: true });
    expect(fileTagToken("#.jpg", loose)).toBeNull();
    expect(fileTagToken("TAG-.jpg", loose)).toBeNull();
  });

  it("is null for no name, and looks only at the capped basename (D-W13)", () => {
    expect(fileTagToken(null, plants)).toBeNull();
    expect(fileTagToken(undefined, plants)).toBeNull();
    expect(fileTagToken("", plants)).toBeNull();
    expect(fileTagToken("#L3.jpg", [])).toBeNull();
    expect(fileTagToken("../../#L3.jpg", plants)).toEqual({ plantId: P1, decides: true });
    expect(fileTagToken(`${"x".repeat(80)} #L3.jpg`, plants)).toBeNull();
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
