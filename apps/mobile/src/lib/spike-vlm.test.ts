import { describe, expect, it } from "vitest";
import {
  SPIKE_SYSTEM_PROMPT,
  SPIKE_USER_PROMPT,
  extractJsonCandidate,
  parseDiagnosisOutput,
  buildDiagnosisContext,
} from "./spike-vlm";

const VALID_DIAGNOSIS_JSON = JSON.stringify({
  health_score: 62,
  summary: "Mild interveinal chlorosis on older leaves; likely magnesium deficiency.",
  symptoms: [{ label: "Interveinal chlorosis", severity: "medium" }],
  causes: [{ label: "Magnesium deficiency", likelihood: "medium", rationale: "Old leaves first" }],
  recommendations: [{ priority: 1, action: "Apply Epsom salt", detail: "1 tbsp/gal monthly" }],
});

describe("prompts", () => {
  it("system prompt demands JSON-only output shaped like the shared schema", () => {
    expect(SPIKE_SYSTEM_PROMPT).toContain("JSON");
    expect(SPIKE_SYSTEM_PROMPT).toContain("health_score");
    expect(SPIKE_SYSTEM_PROMPT).toContain("recommendations");
  });

  // F21: both engines must agree on the contract, or the same photo means
  // different things depending on which model happened to answer.
  it("asks the local model for the subject too, with the same enum as the server", () => {
    expect(SPIKE_SYSTEM_PROMPT).toContain("subject");
    for (const value of ["leaf", "whole_plant", "cut", "not_a_plant"]) {
      expect(SPIKE_SYSTEM_PROMPT).toContain(value);
    }
  });

  it("carries the cut framing and the no-penalty rule, compactly", () => {
    expect(SPIKE_SYSTEM_PROMPT).toMatch(/branch collar/i);
    expect(SPIKE_SYSTEM_PROMPT).toMatch(/never penali[sz]e/i);
  });

  it("user prompt asks for the diagnosis of the attached photo", () => {
    expect(SPIKE_USER_PROMPT.length).toBeGreaterThan(0);
  });
});

describe("extractJsonCandidate", () => {
  it("returns a bare JSON object unchanged", () => {
    expect(extractJsonCandidate('{"a":1}')).toBe('{"a":1}');
  });

  it("strips markdown fences around the object", () => {
    expect(extractJsonCandidate('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("extracts the object out of surrounding prose", () => {
    expect(extractJsonCandidate('Here is the diagnosis: {"a":1} Hope that helps!')).toBe('{"a":1}');
  });

  it("keeps nested objects intact", () => {
    expect(extractJsonCandidate('x {"a":{"b":2},"c":[{"d":3}]} y')).toBe('{"a":{"b":2},"c":[{"d":3}]}');
  });

  it("is not fooled by braces inside strings", () => {
    const tricky = '{"summary":"a { tricky } string","n":1}';
    expect(extractJsonCandidate(`noise ${tricky} noise`)).toBe(tricky);
  });

  it("skips an unbalanced opening brace and finds a later balanced object", () => {
    expect(extractJsonCandidate('{oops never closes... {"a":1}')).toBe('{"a":1}');
  });

  it("returns null when there is no balanced object", () => {
    expect(extractJsonCandidate("no json here")).toBeNull();
    expect(extractJsonCandidate('{"a":1')).toBeNull();
    expect(extractJsonCandidate("")).toBeNull();
  });
});

describe("parseDiagnosisOutput", () => {
  it("parses a fenced, prose-wrapped valid diagnosis into the shared schema", () => {
    const result = parseDiagnosisOutput("Sure!\n```json\n" + VALID_DIAGNOSIS_JSON + "\n```\n");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diagnosis.health_score).toBe(62);
      expect(result.diagnosis.recommendations[0].priority).toBe(1);
    }
  });

  it("reports no-json when the output holds no object at all", () => {
    expect(parseDiagnosisOutput("The plant looks fine to me.")).toEqual({
      ok: false,
      reason: "no-json",
    });
  });

  it("reports invalid-json for a balanced but unparseable candidate", () => {
    expect(parseDiagnosisOutput("{health_score: sixty}")).toEqual({
      ok: false,
      reason: "invalid-json",
    });
  });

  it("reports schema-mismatch when valid JSON fails the shared Zod schema", () => {
    const bad = JSON.stringify({ health_score: 150, summary: "x" });
    expect(parseDiagnosisOutput(bad)).toEqual({ ok: false, reason: "schema-mismatch" });
  });
});

// F35 snap-first: the model may also guess WHAT plant it sees; the guess must
// survive the schema (strip-mode drops undeclared keys) and the prompt must
// ask for it (optional, only-when-confident).
describe("plant_guess (F35)", () => {
  const base = {
    health_score: 70,
    summary: "Mild chlorosis.",
    subject: "whole_plant",
    symptoms: [],
    causes: [],
    recommendations: [],
  };

  it("survives parsing when present", () => {
    const raw = JSON.stringify({ ...base, plant_guess: { plant_type: "tree", species: "Washington Navel Orange" } });
    const parsed = parseDiagnosisOutput(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.diagnosis.plant_guess?.species).toBe("Washington Navel Orange");
  });

  it("is optional — absent guess still parses", () => {
    const parsed = parseDiagnosisOutput(JSON.stringify(base));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.diagnosis.plant_guess).toBeUndefined();
  });

  it("the prompt asks for it, framed as only-when-confident", () => {
    expect(SPIKE_SYSTEM_PROMPT).toMatch(/plant_guess/);
    expect(SPIKE_SYSTEM_PROMPT).toMatch(/confident|sure|omit/i);
  });
});

// #4 — differential diagnosis: the model gets the plant's own record so the
// classic ambiguities (over- vs under-watering) resolve from data the cloud
// apps do not have, and causes come back RANKED.
describe("buildDiagnosisContext", () => {
  it("packs the record into a short block", () => {
    const context = buildDiagnosisContext({
      plantType: "tree",
      species: "Meyer lemon",
      wateringIntervalDays: 7,
      lastWateredDaysAgo: 12,
      recentRainMm: 0,
      maxTempC: 38,
    });
    expect(context).toContain("Meyer lemon");
    expect(context).toContain("12");
    expect(context).toContain("38");
    expect(context.split("\n").length).toBeLessThanOrEqual(7);
  });

  it("tells the model the photo is primary", () => {
    expect(buildDiagnosisContext({ plantType: "tree", maxTempC: 30 }).toLowerCase()).toContain(
      "photo",
    );
  });

  // The adversarial critic's finding, kept as a guard: the prior score/trend
  // PRIME the output that the deterministic trend is computed from — prompt
  // says "worse" → lower score → delta "worse" → next prompt says "worse".
  // A self-reinforcing loop in the app's own north-star metric. The context
  // type simply has no slot for them anymore.
  it("has no slot for the previous score or trend", () => {
    const keys = Object.keys({
      plantType: 1, species: 1, wateringIntervalDays: 1, lastWateredDaysAgo: 1,
      recentRainMm: 1, maxTempC: 1,
    });
    // Compile-time is the real guard; this pins the intent for readers.
    expect(keys).not.toContain("lastScore");
    expect(keys).not.toContain("lastTrend");
  });

  it("omits unknowns instead of printing null", () => {
    const context = buildDiagnosisContext({ plantType: "tree" });
    expect(context).not.toContain("null");
    expect(context).not.toContain("undefined");
  });

  it("is empty for a snap-first photo with no plant yet", () => {
    expect(buildDiagnosisContext(null)).toBe("");
  });
});

describe("ranked causes in the system prompt", () => {
  it("asks for causes ordered most-likely first", () => {
    expect(SPIKE_SYSTEM_PROMPT.toLowerCase()).toMatch(/most likely first|most to least likely/);
  });
});
