import { describe, expect, it } from "vitest";
import type { AssessmentDiagnosis } from "@citrus/shared";
import type { StoredAssessment } from "./assessment-store";
import type { StoredPlant } from "./plant-store";
import {
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

function stores(overrides: Partial<BackupStores> = {}): BackupStores {
  return {
    plants: { p1: plant("p1") },
    assessments: { a1: assessment("a1", "p1") },
    wateringLog: { p1: "2026-07-14T00:00:00Z" },
    photoIndex: { a1: { localUri: "file:///x.jpg", plantId: "p1", engine: "on-device", createdAt: "2026-07-15T00:00:00Z" } },
    ...overrides,
  };
}

describe("buildBackup / serializeBackup / parseBackup", () => {
  it("round-trips the four stores through a JSON document", () => {
    const doc = buildBackup(stores(), "2026-07-15T12:00:00Z");
    expect(doc.exportedAt).toBe("2026-07-15T12:00:00Z");
    expect(parseBackup(serializeBackup(doc))).toEqual(stores());
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
    const parsed = parseBackup(JSON.stringify(doc));
    expect(Object.keys(parsed!.plants)).toEqual(["good"]);
  });

  it("tolerates missing sections (empty stores)", () => {
    const parsed = parseBackup(JSON.stringify({ app: "citrus-care", version: 1, exportedAt: "t" }));
    expect(parsed).toEqual({ plants: {}, assessments: {}, wateringLog: {}, photoIndex: {} });
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
