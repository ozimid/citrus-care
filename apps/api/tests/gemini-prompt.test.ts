import { describe, expect, it } from "vitest";
import {
  buildCareProfileSystemPrompt,
  buildCareProfileUserText,
  buildSystemPrompt,
  buildUserMessageText,
  parseAssessment,
  parseCareProfile,
} from "../src/gemini";
import { assessmentDiagnosisSchema, careProfileSchema } from "@citrus/shared";
import type { Assessment } from "@citrus/shared";

/** Minimal diagnosis that satisfies every field the schema has always had —
 * the base the F21 subject cases vary. */
const DIAGNOSIS_OK = {
  health_score: 70,
  summary: "Healthy enough.",
  symptoms: [],
  causes: [],
  recommendations: [],
};

describe("buildSystemPrompt", () => {
  it("frames the model as a plant expert with structured output rules", () => {
    const p = buildSystemPrompt();
    expect(p.toLowerCase()).toContain("plant");
    expect(p).toMatch(/JSON/);
    expect(p).toMatch(/health_score/);
    expect(p).toMatch(/old.*leaves|new.*leaves|pattern/i);
  });

  // F21: the user no longer pre-classifies the photo — the model does. One
  // prompt, no isCutCare branch: buildSystemPrompt takes no arguments at all.
  it("takes no arguments — there is exactly one prompt", () => {
    expect(buildSystemPrompt.length).toBe(0);
  });

  it("asks the model to identify the subject first, with the schema's enum values", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("subject");
    for (const value of ["leaf", "whole_plant", "cut", "not_a_plant"]) {
      expect(p).toContain(value);
    }
  });

  it("keeps the cut-anatomy expertise inside the one prompt (it applies when subject is cut)", () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/branch collar/i);
    expect(p).toMatch(/flush cut/i);
    expect(p).toMatch(/stub/i);
    expect(p).toMatch(/callous|sealant|aftercare/i);
  });

  // The defect that motivated F21: a tree shot in "Leaf" mode came back as
  // "image quality is poor". Framing is never a defect.
  it("forbids penalizing a photo for being a whole-plant shot rather than a leaf close-up", () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/never penali[sz]e/i);
    expect(p).toMatch(/whole-plant|whole plant/i);
  });
});

describe("buildUserMessageText", () => {
  it("includes tree name and cultivar when present", () => {
    const t = buildUserMessageText({
      plant: {
        name: "Mr Lemon",
        plant_type: "tree",
        species: null,
        cultivar: "Meyer Lemon",
        location: "patio",
        zip_code: null,
      },
      previous: null,
    });
    expect(t).toContain("Mr Lemon");
    expect(t).toContain("Meyer Lemon");
    expect(t).toContain("patio");
  });

  it("includes previous assessment summary when provided", () => {
    const prev: Pick<Assessment, "health_score" | "diagnosis" | "created_at"> = {
      health_score: 60,
      diagnosis: {
        health_score: 60,
        summary: "Old leaves yellowing; suspect nitrogen.",
        symptoms: [],
        causes: [],
        recommendations: [],
      },
      created_at: "2026-01-01T00:00:00Z",
    };
    const t = buildUserMessageText({
      plant: {
        name: "X",
        plant_type: "tree",
        species: null,
        cultivar: null,
        location: null,
        zip_code: null,
      },
      previous: prev,
    });
    expect(t).toContain("Previous assessment");
    expect(t).toContain("60");
    expect(t).toContain("nitrogen");
  });

  // F21: no mode reaches the model. It was the mode line that turned a tree
  // photo into "poor quality" — the model was told to expect a leaf.
  it("never tells the model what kind of shot to expect", () => {
    const t = buildUserMessageText({
      plant: {
        name: "X",
        plant_type: "tree",
        species: null,
        cultivar: null,
        location: null,
        zip_code: null,
      },
      previous: null,
    });
    expect(t).not.toMatch(/Assessment Mode/i);
    expect(t).not.toMatch(/Pruning Cut or Branch Wound/i);
  });
});

describe("parseAssessment", () => {
  it("parses a valid JSON response", () => {
    const raw = JSON.stringify({
      health_score: 72,
      summary: "Mostly OK, some interveinal chlorosis on old leaves.",
      symptoms: [
        { label: "Interveinal chlorosis", severity: "medium" },
      ],
      causes: [
        {
          label: "Iron deficiency",
          likelihood: "high",
          rationale: "Pattern matches Fe deficiency in citrus.",
        },
      ],
      recommendations: [
        { priority: 1, action: "Foliar Fe spray", detail: "Apply chelated iron." },
      ],
    });
    const out = parseAssessment(raw);
    expect(out.health_score).toBe(72);
    expect(out.causes[0].label).toContain("Iron");
  });

  it("carries the detected subject through (F21)", () => {
    const out = parseAssessment(
      JSON.stringify({ ...DIAGNOSIS_OK, subject: "cut", subject_note: "Sawn branch end." }),
    );
    expect(out.subject).toBe("cut");
    expect(out.subject_note).toBe("Sawn branch end.");
  });

  it("throws when the model invents a subject outside the enum", () => {
    expect(() => parseAssessment(JSON.stringify({ ...DIAGNOSIS_OK, subject: "shrub" }))).toThrow();
  });

  it("strips ```json fences if the model wraps the JSON (defense-in-depth)", () => {
    const json = JSON.stringify({
      health_score: 50,
      summary: "ok",
      symptoms: [],
      causes: [],
      recommendations: [],
    });
    const wrapped = "```json\n" + json + "\n```";
    expect(parseAssessment(wrapped).health_score).toBe(50);
  });

  it("throws on invalid schema", () => {
    expect(() => parseAssessment("{}")).toThrow();
    expect(() =>
      parseAssessment(JSON.stringify({ health_score: 9001 })),
    ).toThrow();
  });

  it("rejects health_score outside 0..100", () => {
    const bad = JSON.stringify({
      health_score: -5,
      summary: "x",
      symptoms: [],
      causes: [],
      recommendations: [],
    });
    expect(() => parseAssessment(bad)).toThrow();
  });
});

describe("assessmentDiagnosisSchema", () => {
  it("requires the core fields", () => {
    const r = assessmentDiagnosisSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  // F21: the model reports what it saw. is_cut_care is derived from this
  // instead of a user toggle, so the value space is closed.
  it("accepts each detected subject", () => {
    for (const subject of ["leaf", "whole_plant", "cut", "not_a_plant"]) {
      expect(assessmentDiagnosisSchema.safeParse({ ...DIAGNOSIS_OK, subject }).success).toBe(true);
    }
  });

  it("rejects a subject outside the enum (model output is never trusted)", () => {
    expect(assessmentDiagnosisSchema.safeParse({ ...DIAGNOSIS_OK, subject: "tree" }).success).toBe(
      false,
    );
    expect(assessmentDiagnosisSchema.safeParse({ ...DIAGNOSIS_OK, subject: 3 }).success).toBe(false);
  });

  it("carries an optional short subject_note explaining the call", () => {
    const parsed = assessmentDiagnosisSchema.safeParse({
      ...DIAGNOSIS_OK,
      subject: "whole_plant",
      subject_note: "Full canopy and trunk visible, no single leaf in focus.",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.subject_note).toContain("canopy");
    expect(assessmentDiagnosisSchema.safeParse({ ...DIAGNOSIS_OK, subject_note: 12 }).success).toBe(
      false,
    );
  });

  // Rows written before F21 have no subject. The schema also guards the read
  // path (timeline taps, the assess round-trip), so requiring it would make
  // every historical assessment unopenable.
  it("still parses a pre-F21 diagnosis that has no subject", () => {
    expect(assessmentDiagnosisSchema.safeParse(DIAGNOSIS_OK).success).toBe(true);
  });
});

// F20: the care profile is generated by Gemini ONCE per plant at creation; the
// weather adjustment on top of it is deterministic math on the phone. Model
// output is untrusted until careProfileSchema parses it (hard rule).

const CARE_PROFILE_OK = {
  base_watering_interval_days: 10,
  water_amount_note: "About 2L until it drains from the base.",
  sun: "full",
  temp_min_c: -2,
  temp_max_c: 32,
  drought_tolerance: "medium",
  indoor_ok: false,
  notes: "Citrus prefer a deep soak then a dry-back.",
};

describe("buildCareProfileUserText", () => {
  it("gives the model the plant identity it needs to pick a baseline", () => {
    const t = buildCareProfileUserText({
      name: "Mr Lemon",
      plant_type: "tree",
      species: "Citrus limon",
      cultivar: "Meyer Lemon",
      location: "South patio",
      zip_code: "90210",
    });
    expect(t).toContain("Mr Lemon");
    expect(t).toContain("Citrus limon");
    expect(t).toContain("Meyer Lemon");
    expect(t).toContain("South patio");
    expect(t).toContain("90210");
  });

  it("omits absent optional fields rather than printing null", () => {
    const t = buildCareProfileUserText({
      name: "Fern",
      plant_type: "other",
      species: null,
      cultivar: null,
      location: null,
      zip_code: null,
    });
    expect(t).toContain("Fern");
    expect(t).not.toContain("null");
  });
});

describe("buildCareProfileSystemPrompt", () => {
  it("asks for a JSON care profile keyed on the fields the watering math needs", () => {
    const p = buildCareProfileSystemPrompt();
    expect(p).toMatch(/JSON/);
    expect(p).toContain("base_watering_interval_days");
    expect(p).toContain("drought_tolerance");
    expect(p).toContain("temp_max_c");
    expect(p).toContain("indoor_ok");
  });
});

describe("parseCareProfile", () => {
  it("parses a valid care profile", () => {
    const out = parseCareProfile(JSON.stringify(CARE_PROFILE_OK));
    expect(out.base_watering_interval_days).toBe(10);
    expect(out.drought_tolerance).toBe("medium");
    expect(out.sun).toBe("full");
    expect(out.indoor_ok).toBe(false);
  });

  it("strips ```json fences if the model wraps the JSON (defense-in-depth)", () => {
    const wrapped = "```json\n" + JSON.stringify(CARE_PROFILE_OK) + "\n```";
    expect(parseCareProfile(wrapped).base_watering_interval_days).toBe(10);
  });

  it("throws on non-JSON and on a schema mismatch", () => {
    expect(() => parseCareProfile("not json at all")).toThrow();
    expect(() => parseCareProfile("{}")).toThrow();
  });
});

describe("careProfileSchema", () => {
  it("rejects a watering interval outside 1..60 days", () => {
    expect(
      careProfileSchema.safeParse({ ...CARE_PROFILE_OK, base_watering_interval_days: 0 }).success,
    ).toBe(false);
    expect(
      careProfileSchema.safeParse({ ...CARE_PROFILE_OK, base_watering_interval_days: 61 }).success,
    ).toBe(false);
    expect(
      careProfileSchema.safeParse({ ...CARE_PROFILE_OK, base_watering_interval_days: 60 }).success,
    ).toBe(true);
  });

  it("rejects sun / drought_tolerance values outside the enums", () => {
    expect(careProfileSchema.safeParse({ ...CARE_PROFILE_OK, sun: "dappled" }).success).toBe(false);
    expect(
      careProfileSchema.safeParse({ ...CARE_PROFILE_OK, drought_tolerance: "extreme" }).success,
    ).toBe(false);
  });

  it("requires indoor_ok to be a real boolean, not a stringified one", () => {
    expect(careProfileSchema.safeParse({ ...CARE_PROFILE_OK, indoor_ok: "true" }).success).toBe(
      false,
    );
  });
});
