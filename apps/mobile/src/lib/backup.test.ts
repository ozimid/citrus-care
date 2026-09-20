import { describe, expect, it } from "vitest";
import type { AssessmentDiagnosis } from "@citrus/shared";
import type { StoredAssessment } from "./assessment-store";
import type { ChatMessage } from "./chat-store";
import type { StoredPlant } from "./plant-store";
import { codeDigest } from "./plant-tags";
import {
  BACKUP_PHOTO_BYTES_ESTIMATE,
  BACKUP_PHOTO_CAP_BYTES,
  base64ToBytes,
  buildBackup,
  mergeBackup,
  parseBackup,
  selectBackupPhotos,
  serializeBackup,
  type BackupPhotoCandidate,
  type BackupStores,
} from "./backup";

// D-17: with no cloud, the manual export/import is the only backup. The file is
// untrusted on import, so parseBackup reuses each store's tolerant parser
// (malformed entries dropped, never thrown), and merge NEVER overwrites local
// data — an import can only add plants/history, not clobber newer edits.

// D-W16: every id in a backup is gated on import (it can name a directory), so
// the fixtures use the shape the app actually mints.
const P1 = "p1-00000001";
const P2 = "p2-00000001";
const A1 = "a1-00000001";
const A2 = "a2-00000001";
const FILE = "x1-00000001.jpg";

function diagnosis(): AssessmentDiagnosis {
  return { health_score: 80, summary: "ok", subject: "leaf", symptoms: [], causes: [], recommendations: [] };
}

function plant(id: string): StoredPlant {
  return {
    id,
    name: `Plant ${id}`,
    plant_type: "tree",
    species: null,
    cultivar: null,
    location: null,
    zip_code: null,
    cover_assessment_id: null,
    care_profile: null,
    created_at: "2026-07-15T00:00:00Z",
  };
}

function assessment(id: string, plantId: string): StoredAssessment {
  return { id, plantId, createdAt: "2026-07-15T00:00:00Z", diagnosis: diagnosis(), comparedToId: null, engine: "on-device" };
}

function chatMessage(id: string, plantId = P1): ChatMessage {
  return { id, plantId, role: "user", text: `question ${id}`, createdAt: "2026-07-15T00:00:00Z" };
}

function stores(overrides: Partial<BackupStores> = {}): BackupStores {
  return {
    plants: { [P1]: plant(P1) },
    assessments: { [A1]: assessment(A1, P1) },
    wateringLog: { [P1]: "2026-07-14T00:00:00Z" },
    photoIndex: { [A1]: { localUri: "file:///x.jpg", plantId: P1, engine: "on-device", createdAt: "2026-07-15T00:00:00Z" } },
    chat: { [P1]: [chatMessage("m1")] },
    ...overrides,
  };
}

describe("buildBackup / serializeBackup / parseBackup", () => {
  it("round-trips every store through a JSON document", () => {
    const doc = buildBackup(stores(), "2026-07-15T12:00:00Z");
    expect(doc.exportedAt).toBe("2026-07-15T12:00:00Z");
    expect(parseBackup(serializeBackup(doc))).toEqual({ stores: stores(), photos: [] });
  });

  it("returns null for non-JSON, a non-object, or a foreign document", () => {
    expect(parseBackup("not-json{")).toBeNull();
    expect(parseBackup("[1,2]")).toBeNull();
    expect(parseBackup(JSON.stringify({ app: "something-else", plants: {} }))).toBeNull();
  });

  it("drops malformed entries via the store parsers (untrusted file)", () => {
    const doc = {
      app: "citrus-care",
      version: 1,
      exportedAt: "t",
      // A safe key with a matching id, so the SHAPE check is what drops it.
      plants: { [P1]: plant(P1), [P2]: { id: P2 } },
      assessments: {},
      wateringLog: {},
      photoIndex: {},
    };
    const parsed = parseBackup(JSON.stringify(doc))?.stores;
    expect(Object.keys(parsed!.plants)).toEqual([P1]);
  });

  it("tolerates missing sections (empty stores)", () => {
    const parsed = parseBackup(JSON.stringify({ app: "citrus-care", version: 1, exportedAt: "t" }))?.stores;
    expect(parsed).toEqual({ plants: {}, assessments: {}, wateringLog: {}, photoIndex: {}, chat: {} });
  });

  // D-W11: the photo queue is NOT in the backup. Its photos have no assessment
  // yet, the photo carrier is keyed by assessment id, and a queue record on a
  // dead uri is worse than none. The on-card copy says "Not in a backup until
  // analyzed" for the same reason.
  it("carries no photo-queue section (D-W11)", () => {
    const doc = buildBackup(stores(), "2026-09-19T12:00:00Z");
    const keys = Object.keys(doc);
    expect(keys.filter((k) => /queue/i.test(k))).toEqual([]);
    expect(keys).not.toContain("photoQueue");
    expect(serializeBackup(doc)).not.toMatch(/photoQueue|photo-queue/);
  });
});

describe("mergeBackup", () => {
  it("adds new entries and KEEPS existing ones on id collision (never overwrites)", () => {
    const current = stores({ plants: { [P1]: { ...plant(P1), name: "Local edit" } } });
    const incoming = stores({
      plants: { [P1]: { ...plant(P1), name: "Backup version" }, [P2]: plant(P2) },
    });
    const { merged, added } = mergeBackup(current, incoming);
    // P1 kept the local edit; P2 was added.
    expect(merged.plants[P1].name).toBe("Local edit");
    expect(merged.plants[P2].name).toBe(`Plant ${P2}`);
    expect(added.plants).toBe(1);
  });

  it("counts new assessments and does not mutate the inputs", () => {
    const current = stores();
    const incoming = stores({ assessments: { [A1]: assessment(A1, P1), [A2]: assessment(A2, P1) } });
    const { added } = mergeBackup(current, incoming);
    expect(added.assessments).toBe(1);
    expect(Object.keys(current.assessments)).toEqual([A1]);
  });
});

// F29: photos travel INSIDE the backup (base64) — a restore on a new phone
// brings the pictures back, not just the index (user request 2026-07-16).
describe("backup v2 photos", () => {
  const photo = {
    assessmentId: A1,
    plantId: P1,
    fileName: FILE,
    base64: "aGVsbG8=",
  };

  it("round-trips photos through the document", () => {
    const doc = buildBackup(stores(), "2026-07-16T00:00:00Z", [photo]);
    const parsed = parseBackup(serializeBackup(doc));
    expect(parsed?.photos).toEqual([photo]);
  });

  it("a v1 backup (no photos field) parses with an empty photo list", () => {
    const parsed = parseBackup(JSON.stringify({ app: "citrus-care", version: 1, exportedAt: "t" }));
    expect(parsed?.photos).toEqual([]);
  });

  it("drops malformed photo entries without throwing", () => {
    const doc = {
      app: "citrus-care",
      version: 2,
      exportedAt: "t",
      photos: [photo, { assessmentId: 5 }, "junk", { ...photo, base64: 7 }],
    };
    expect(parseBackup(JSON.stringify(doc))?.photos).toEqual([photo]);
  });
});

// F38: the per-plant conversation travels with the backup. Pruning plans do
// NOT — their photo is the plan, and the photo carrier is keyed to assessments,
// so a restored plan would open on a dead image.
describe("backup v3 chat", () => {
  it("round-trips a conversation", () => {
    const doc = buildBackup(stores(), "2026-08-31T00:00:00Z");
    expect(parseBackup(serializeBackup(doc))?.stores.chat).toEqual({ [P1]: [chatMessage("m1")] });
  });

  it("parses an older backup with no chat section as an empty conversation store", () => {
    const doc = { app: "citrus-care", version: 2, exportedAt: "t", plants: {}, assessments: {} };
    expect(parseBackup(JSON.stringify(doc))?.stores.chat).toEqual({});
  });

  it("drops malformed messages through the store's own parser", () => {
    const doc = {
      app: "citrus-care",
      version: 3,
      exportedAt: "t",
      chat: { p1: [chatMessage("good"), { id: "bad" }], p2: "not an array" },
    };
    const parsed = parseBackup(JSON.stringify(doc))?.stores.chat;
    expect(parsed).toEqual({ p1: [chatMessage("good")] });
  });

  it("keeps the local conversation on collision — an import never clobbers it", () => {
    const current = stores({ chat: { [P1]: [chatMessage("local")] } });
    const incoming = stores({ chat: { [P1]: [chatMessage("from-backup")], [P2]: [chatMessage("m2", P2)] } });
    const { merged } = mergeBackup(current, incoming);
    expect(merged.chat[P1]).toEqual([chatMessage("local")]);
    expect(merged.chat[P2]).toHaveLength(1);
  });
});

// D-W16: a backup is a file anyone can edit, and every id in it can end up as
// a directory name under photos/. The parser must let nothing through that the
// app could not have minted — while a valid neighbour in the same file still
// restores.
describe("backup import refuses path-shaped ids", () => {
  const valid = { assessmentId: A1, plantId: P1, fileName: FILE, base64: "aGVsbG8=" };
  const doc = {
    app: "citrus-care",
    version: 3,
    exportedAt: "t",
    plants: { "..": plant(".."), _inbox: plant("_inbox"), [P1]: plant(P1) },
    assessments: { [A1]: assessment(A1, P1), "..": assessment("..", P1), [A2]: assessment(A2, "../..") },
    photoIndex: {
      [A1]: { localUri: "file:///x.jpg", plantId: P1, engine: "on-device", createdAt: "t" },
      "..": { localUri: "file:///x.jpg", plantId: P1, engine: "on-device", createdAt: "t" },
      [A2]: { localUri: "file:///x.jpg", plantId: "../..", engine: "on-device", createdAt: "t" },
    },
    photos: [
      valid,
      { ...valid, plantId: "../..", fileName: ".." },
      { ...valid, assessmentId: ".." },
      { ...valid, plantId: "_inbox" },
      { ...valid, fileName: "../x1-00000001.jpg" },
      { ...valid, fileName: "x.jpg" },
    ],
  };

  it("parses to only the valid plant, assessment, index entry and photo", () => {
    const parsed = parseBackup(JSON.stringify(doc));
    expect(Object.keys(parsed!.stores.plants)).toEqual([P1]);
    expect(Object.keys(parsed!.stores.assessments)).toEqual([A1]);
    expect(Object.keys(parsed!.stores.photoIndex)).toEqual([A1]);
    expect(parsed!.photos).toEqual([valid]);
  });

  it("adds zero of the crafted records on merge", () => {
    const parsed = parseBackup(JSON.stringify(doc))!;
    const empty: BackupStores = { plants: {}, assessments: {}, wateringLog: {}, photoIndex: {}, chat: {} };
    const { merged, added } = mergeBackup(empty, parsed.stores);
    expect(added).toEqual({ plants: 1, assessments: 1 });
    expect(Object.keys(merged.plants)).toEqual([P1]);
  });
});

// D-W11: export base64-encodes every carried photo into ONE string, so a walk
// season would make the document too large to build in memory. The carrier is
// capped by bytes, newest first, and the card says "N of M" honestly.
describe("selectBackupPhotos", () => {
  function candidate(id: string, createdAt: string, bytes: number | null): BackupPhotoCandidate {
    return { assessmentId: id, plantId: P1, localUri: `file:///${id}.jpg`, createdAt, bytes };
  }

  it("keeps the newest photos while they fit, and reports the total", () => {
    const candidates = [
      candidate("c1", "2026-01-01T00:00:00Z", 50),
      candidate("c3", "2026-03-01T00:00:00Z", 50),
      candidate("c2", "2026-02-01T00:00:00Z", 50),
    ];
    const { selected, total } = selectBackupPhotos(candidates, 120);
    expect(selected.map((c) => c.assessmentId)).toEqual(["c3", "c2"]);
    expect(total).toBe(3);
    // Pure: the input order is untouched.
    expect(candidates.map((c) => c.assessmentId)).toEqual(["c1", "c3", "c2"]);
  });

  it("stops at the first photo that would not fit (the kept set is a newest-first prefix)", () => {
    const candidates = [
      candidate("c3", "2026-03-01T00:00:00Z", 100),
      candidate("c2", "2026-02-01T00:00:00Z", 50),
      candidate("c1", "2026-01-01T00:00:00Z", 10),
    ];
    expect(selectBackupPhotos(candidates, 120).selected.map((c) => c.assessmentId)).toEqual(["c3"]);
  });

  it("breaks a createdAt tie by assessment id, higher first", () => {
    const t = "2026-03-01T00:00:00Z";
    const { selected } = selectBackupPhotos([candidate("ca", t, 10), candidate("cb", t, 10)], 10);
    expect(selected.map((c) => c.assessmentId)).toEqual(["cb"]);
  });

  it("counts an unknown size as the estimate", () => {
    const candidates = [
      candidate("c1", "2026-01-01T00:00:00Z", null),
      candidate("c2", "2026-02-01T00:00:00Z", null),
      candidate("c3", "2026-03-01T00:00:00Z", null),
    ];
    const { selected } = selectBackupPhotos(candidates, 2 * BACKUP_PHOTO_BYTES_ESTIMATE);
    expect(selected.map((c) => c.assessmentId)).toEqual(["c3", "c2"]);
  });

  it("never drops the newest photo, even when it alone exceeds the cap", () => {
    const { selected, total } = selectBackupPhotos([candidate("c1", "2026-01-01T00:00:00Z", 999)], 10);
    expect(selected).toHaveLength(1);
    expect(total).toBe(1);
    expect(selectBackupPhotos([], 10)).toEqual({ selected: [], total: 0 });
  });

  it("defaults to the 120 MB cap", () => {
    const big = candidate("c1", "2026-01-01T00:00:00Z", BACKUP_PHOTO_CAP_BYTES - 1);
    const small = candidate("c0", "2025-01-01T00:00:00Z", 2);
    expect(selectBackupPhotos([big, small]).selected.map((c) => c.assessmentId)).toEqual(["c1"]);
  });
});

describe("base64ToBytes", () => {
  it("decodes standard base64", () => {
    expect(Array.from(base64ToBytes("aGVsbG8="))).toEqual([104, 101, 108, 108, 111]);
  });
  it("handles padding-free input", () => {
    expect(Array.from(base64ToBytes("aGk"))).toEqual([104, 105]);
  });
});

// F39 D-W4 / D-W11: the human tag and the bound-code DIGESTS ride the plant
// store into backup v3 with no version bump — the payloads themselves never
// existed on disk, so a backup cannot leak them. A v3 file written before F39
// has no such fields and must parse exactly as before.
describe("backup v3 carries tags and code digests (F39)", () => {
  const DIGEST = codeDigest("CC1-TEST01");

  it("round-trips a tagged, coded plant with its tag photo and tag-missing flag", () => {
    const tagged: StoredPlant = { ...plant(P1), tag: "L3", codes: [DIGEST], tag_photo: FILE, tag_missing: true };
    const doc = buildBackup(stores({ plants: { [P1]: tagged } }), "2026-09-19T12:00:00Z");
    const parsed = parseBackup(serializeBackup(doc));
    expect(parsed?.stores.plants[P1]).toEqual(tagged);
    // Only the digest travels — never anything that looks like a payload.
    expect(serializeBackup(doc)).not.toContain("CC1-TEST01");
  });

  it("parses a v3 file written before tags existed, leaving the fields absent", () => {
    const doc = { app: "citrus-care", version: 3, exportedAt: "t", plants: { [P1]: plant(P1) }, assessments: {} };
    const parsed = parseBackup(JSON.stringify(doc))!.stores.plants[P1];
    expect(parsed).toEqual(plant(P1));
    expect("tag" in parsed).toBe(false);
    expect("codes" in parsed).toBe(false);
  });

  it("repairs a crafted plant's identifiers instead of dropping the plant", () => {
    const doc = {
      app: "citrus-care",
      version: 3,
      exportedAt: "t",
      plants: { [P1]: { ...plant(P1), tag: "l3!", codes: ["not-a-digest", DIGEST, DIGEST], tag_photo: "../etc" } },
    };
    const parsed = parseBackup(JSON.stringify(doc))!.stores.plants[P1];
    expect(parsed.name).toBe(`Plant ${P1}`);
    expect(parsed).toMatchObject({ tag: null, codes: [DIGEST], tag_photo: null });
  });

  it("merge keeps the local plant's tag and codes on collision (import never overwrites)", () => {
    const local: StoredPlant = { ...plant(P1), tag: "L3", codes: [DIGEST] };
    const incoming: StoredPlant = { ...plant(P1), tag: "L9", codes: [] };
    const { merged } = mergeBackup(stores({ plants: { [P1]: local } }), stores({ plants: { [P1]: incoming } }));
    expect(merged.plants[P1].tag).toBe("L3");
    expect(merged.plants[P1].codes).toEqual([DIGEST]);
  });
});
