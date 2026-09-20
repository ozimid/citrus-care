import { describe, expect, it } from "vitest";
import {
  parsePhotoIndex,
  photoFileName,
  photoForAssessment,
  photosForPlant,
  removePhotoEntry,
  removePlantPhotos,
  serializePhotoIndex,
  upsertPhoto,
  type PhotoIndex,
  type PhotoIndexEntry,
  latestPhotoForPlant,
} from "./photo-store";

// D-16: photos live only on the phone. The AsyncStorage-backed index maps
// assessmentId → { localUri, plantId, engine, createdAt }; all mapping logic
// here is pure, the IO wrapper (photo-store-io.ts) stays thin.

// D-W16 shapes: the parser refuses keys / plantIds that could not be a path.
const P1 = "p1-00000001";
const A1 = "a1-00000001";
const A2 = "a2-00000001";
const A3 = "a3-00000001";

function entry(overrides: Partial<PhotoIndexEntry> = {}): PhotoIndexEntry {
  return {
    localUri: "file:///docs/photos/p1/a.jpg",
    plantId: "p1",
    engine: "gemini",
    createdAt: "2026-07-15T10:00:00Z",
    ...overrides,
  };
}

describe("upsertPhoto", () => {
  it("adds an entry keyed by assessment id without mutating the input", () => {
    const before: PhotoIndex = {};
    const after = upsertPhoto(before, "a1", entry());
    expect(after["a1"]).toEqual(entry());
    expect(before).toEqual({});
  });

  it("replaces an existing entry for the same assessment (retry / re-link)", () => {
    const first = upsertPhoto({}, "a1", entry());
    const second = upsertPhoto(first, "a1", entry({ localUri: "file:///docs/photos/p1/b.jpg" }));
    expect(second["a1"].localUri).toBe("file:///docs/photos/p1/b.jpg");
    expect(Object.keys(second)).toEqual(["a1"]);
  });
});

describe("removePlantPhotos", () => {
  it("drops every entry belonging to the plant, keeps others, does not mutate", () => {
    const index = upsertPhoto(
      upsertPhoto(upsertPhoto({}, "a1", entry()), "a2", entry({ localUri: "file:///2.jpg" })),
      "b1",
      entry({ plantId: "p2", localUri: "file:///other.jpg" }),
    );
    const after = removePlantPhotos(index, "p1");
    expect(Object.keys(after).sort()).toEqual(["b1"]);
    expect(Object.keys(index).sort()).toEqual(["a1", "a2", "b1"]);
  });

  it("is a no-op for a plant with no photos", () => {
    const index = upsertPhoto({}, "a1", entry());
    expect(removePlantPhotos(index, "unknown-plant")).toEqual(index);
  });
});

describe("photoForAssessment / photosForPlant", () => {
  const index = upsertPhoto(
    upsertPhoto(upsertPhoto({}, "a1", entry()), "a2", entry({ localUri: "file:///2.jpg" })),
    "b1",
    entry({ plantId: "p2" }),
  );

  it("looks up the local photo for an assessment, null when unknown", () => {
    expect(photoForAssessment(index, "a1")?.localUri).toBe("file:///docs/photos/p1/a.jpg");
    expect(photoForAssessment(index, "missing")).toBeNull();
  });

  it("lists a plant's entries", () => {
    expect(photosForPlant(index, "p1").map((e) => e.localUri).sort()).toEqual([
      "file:///2.jpg",
      "file:///docs/photos/p1/a.jpg",
    ]);
    expect(photosForPlant(index, "p3")).toEqual([]);
  });
});

describe("parsePhotoIndex / serializePhotoIndex", () => {
  it("round-trips through JSON", () => {
    const index = upsertPhoto({}, A1, entry({ plantId: P1 }));
    expect(parsePhotoIndex(serializePhotoIndex(index))).toEqual(index);
  });

  it("returns an empty index for null / malformed JSON (never throws)", () => {
    expect(parsePhotoIndex(null)).toEqual({});
    expect(parsePhotoIndex("not-json{")).toEqual({});
    expect(parsePhotoIndex('"a string"')).toEqual({});
    expect(parsePhotoIndex("[1,2]")).toEqual({});
  });

  it("skips malformed entries but keeps valid ones (stored data is untrusted)", () => {
    const stored = JSON.stringify({
      [A1]: entry({ plantId: P1 }),
      [A2]: { localUri: "file:///x.jpg" },
      [A3]: { localUri: 5, plantId: P1, engine: "gemini", createdAt: "t" },
      "not-an-object": "nope",
    });
    expect(Object.keys(parsePhotoIndex(stored))).toEqual([A1]);
  });

  // D-W16: plantId names the photo directory, the key names the assessment —
  // neither may carry a path.
  it("drops entries with an unsafe plantId or an unsafe key, keeps the rest", () => {
    const stored = JSON.stringify({
      [A1]: entry({ plantId: P1 }),
      [A2]: entry({ plantId: "../.." }),
      "..": entry({ plantId: P1 }),
      _inbox: entry({ plantId: P1 }),
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301": entry({ plantId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8" }),
    });
    expect(Object.keys(parsePhotoIndex(stored)).sort()).toEqual(
      ["3f2504e0-4f89-41d3-9a0c-0305e82c3301", A1].sort(),
    );
  });
});

describe("photoFileName", () => {
  it("builds a deterministic jpg name from time + randomness", () => {
    const name = photoFileName(1752573600000, 0.123456789);
    expect(name).toMatch(/^[a-z0-9]+-[a-z0-9]+\.jpg$/);
    expect(photoFileName(1752573600000, 0.123456789)).toBe(name);
  });

  it("differs across time or randomness (collision resistance)", () => {
    expect(photoFileName(1752573600000, 0.1)).not.toBe(photoFileName(1752573600000, 0.2));
    expect(photoFileName(1752573600000, 0.1)).not.toBe(photoFileName(1752573600001, 0.1));
  });
});

describe("latestPhotoForPlant", () => {
  // "Where to prune" reuses the newest photo the user already took instead of
  // demanding a fresh one (device feedback 2026-08-31).
  const index: PhotoIndex = {
    a1: { localUri: "file:///p1/old.jpg", plantId: "p1", engine: "on-device", createdAt: "2026-07-01T00:00:00Z" },
    a2: { localUri: "file:///p1/new.jpg", plantId: "p1", engine: "on-device", createdAt: "2026-08-20T00:00:00Z" },
    b1: { localUri: "file:///p2/x.jpg", plantId: "p2", engine: "on-device", createdAt: "2026-08-25T00:00:00Z" },
  };

  it("returns the plant's newest photo, never another plant's", () => {
    expect(latestPhotoForPlant(index, "p1")?.localUri).toBe("file:///p1/new.jpg");
    expect(latestPhotoForPlant(index, "p3")).toBeNull();
  });

  // Two walk shots can share a second; the winner must not depend on the
  // order AsyncStorage happened to serialize the map in.
  it("breaks a createdAt tie by the index key, whichever order the map is in", () => {
    const same = "2026-08-20T00:00:00Z";
    const forward: PhotoIndex = {
      a1: { localUri: "file:///p1/a1.jpg", plantId: "p1", engine: "on-device", createdAt: same },
      a2: { localUri: "file:///p1/a2.jpg", plantId: "p1", engine: "on-device", createdAt: same },
    };
    const backward: PhotoIndex = { a2: forward.a2, a1: forward.a1 };
    expect(latestPhotoForPlant(forward, "p1")?.localUri).toBe("file:///p1/a2.jpg");
    expect(latestPhotoForPlant(backward, "p1")?.localUri).toBe("file:///p1/a2.jpg");
    expect(photosForPlant(backward, "p1").map((e) => e.localUri)).toEqual([
      "file:///p1/a2.jpg",
      "file:///p1/a1.jpg",
    ]);
  });
});

// F39 Phase 6b — "Undo this walk" removes one assessment at a time; its index
// entry goes with it (the io deletes the file), everything else stays.
describe("removePhotoEntry", () => {
  const index = upsertPhoto(
    upsertPhoto({}, "a1", entry()),
    "a2",
    entry({ localUri: "file:///2.jpg" }),
  );

  it("drops the one entry, keeps the rest, does not mutate", () => {
    const after = removePhotoEntry(index, "a1");
    expect(Object.keys(after)).toEqual(["a2"]);
    expect(Object.keys(index).sort()).toEqual(["a1", "a2"]);
  });

  it("returns the same index for an unknown assessment", () => {
    expect(removePhotoEntry(index, "missing")).toBe(index);
  });
});
