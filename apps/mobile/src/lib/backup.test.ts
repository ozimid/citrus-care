import { describe, expect, it } from "vitest";
import type { AssessmentDiagnosis } from "@citrus/shared";
import type { StoredAssessment } from "./assessment-store";
import type { ChatMessage } from "./chat-store";
import type { StoredPlant } from "./plant-store";
import {
  base64ToBytes,
  buildBackup,
  mergeBackup,
  parseBackup,
  serializeBackup,
  type BackupStores,
} from "./backup";

// D-17: with no cloud, the manual export/import is the only backup. The file is
// untrusted on import, so parseBackup reuses each store's tolerant parser
// (malformed entries dropped, never thrown), and merge NEVER overwrites local
// data — an import can only add plants/history, not clobber newer edits.

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

function chatMessage(id: string, plantId = "p1"): ChatMessage {
  return { id, plantId, role: "user", text: `question ${id}`, createdAt: "2026-07-15T00:00:00Z" };
}

function stores(overrides: Partial<BackupStores> = {}): BackupStores {
  return {
    plants: { p1: plant("p1") },
    assessments: { a1: assessment("a1", "p1") },
    wateringLog: { p1: "2026-07-14T00:00:00Z" },
    photoIndex: { a1: { localUri: "file:///x.jpg", plantId: "p1", engine: "on-device", createdAt: "2026-07-15T00:00:00Z" } },
    chat: { p1: [chatMessage("m1")] },
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
      plants: { good: plant("good"), bad: { id: "bad" } },
      assessments: {},
      wateringLog: {},
      photoIndex: {},
    };
    const parsed = parseBackup(JSON.stringify(doc))?.stores;
    expect(Object.keys(parsed!.plants)).toEqual(["good"]);
  });

  it("tolerates missing sections (empty stores)", () => {
    const parsed = parseBackup(JSON.stringify({ app: "citrus-care", version: 1, exportedAt: "t" }))?.stores;
    expect(parsed).toEqual({ plants: {}, assessments: {}, wateringLog: {}, photoIndex: {}, chat: {} });
  });
});

describe("mergeBackup", () => {
  it("adds new entries and KEEPS existing ones on id collision (never overwrites)", () => {
    const current = stores({ plants: { p1: { ...plant("p1"), name: "Local edit" } } });
    const incoming = stores({
      plants: { p1: { ...plant("p1"), name: "Backup version" }, p2: plant("p2") },
    });
    const { merged, added } = mergeBackup(current, incoming);
    // p1 kept the local edit; p2 was added.
    expect(merged.plants.p1.name).toBe("Local edit");
    expect(merged.plants.p2.name).toBe("Plant p2");
    expect(added.plants).toBe(1);
  });

  it("counts new assessments and does not mutate the inputs", () => {
    const current = stores();
    const incoming = stores({ assessments: { a1: assessment("a1", "p1"), a2: assessment("a2", "p1") } });
    const { added } = mergeBackup(current, incoming);
    expect(added.assessments).toBe(1);
    expect(Object.keys(current.assessments)).toEqual(["a1"]);
  });
});

// F29: photos travel INSIDE the backup (base64) — a restore on a new phone
// brings the pictures back, not just the index (user request 2026-07-16).
describe("backup v2 photos", () => {
  const photo = {
    assessmentId: "a1",
    plantId: "p1",
    fileName: "x.jpg",
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
    expect(parseBackup(serializeBackup(doc))?.stores.chat).toEqual({ p1: [chatMessage("m1")] });
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
    const current = stores({ chat: { p1: [chatMessage("local")] } });
    const incoming = stores({ chat: { p1: [chatMessage("from-backup")], p2: [chatMessage("m2", "p2")] } });
    const { merged } = mergeBackup(current, incoming);
    expect(merged.chat.p1).toEqual([chatMessage("local")]);
    expect(merged.chat.p2).toHaveLength(1);
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
