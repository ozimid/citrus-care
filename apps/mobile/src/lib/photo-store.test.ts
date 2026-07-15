import { describe, expect, it } from "vitest";
import {
  parsePhotoIndex,
  photoFileName,
  photoForAssessment,
  photosForPlant,
  removePlantPhotos,
  serializePhotoIndex,
  upsertPhoto,
  type PhotoIndex,
  type PhotoIndexEntry,
} from "./photo-store";

// D-16: photos live only on the phone. The AsyncStorage-backed index maps
// assessmentId → { localUri, plantId, engine, createdAt }; all mapping logic
// here is pure, the IO wrapper (photo-store-io.ts) stays thin.

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
    const index = upsertPhoto({}, "a1", entry());
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
      good: entry(),
      "missing-fields": { localUri: "file:///x.jpg" },
      "wrong-types": { localUri: 5, plantId: "p", engine: "gemini", createdAt: "t" },
      "not-an-object": "nope",
    });
    expect(Object.keys(parsePhotoIndex(stored))).toEqual(["good"]);
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
