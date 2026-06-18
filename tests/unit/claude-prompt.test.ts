import { describe, expect, it } from "vitest";
import {
  buildSystemPrompt,
  buildUserMessageText,
  parseAssessment,
  assessmentDiagnosisSchema,
} from "@/app/_lib/claude";
import type { Assessment } from "@/app/_lib/types";

describe("buildSystemPrompt", () => {
  it("frames the model as a citrus expert with structured output rules", () => {
    const p = buildSystemPrompt();
    expect(p.toLowerCase()).toContain("citrus");
    expect(p).toMatch(/JSON/);
    expect(p).toMatch(/health_score/);
    expect(p).toMatch(/old.*leaves|new.*leaves|pattern/i);
  });
});

describe("buildUserMessageText", () => {
  it("includes tree name and cultivar when present", () => {
    const t = buildUserMessageText({
      tree: { name: "Mr Lemon", cultivar: "Meyer Lemon", location: "patio" },
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
      tree: { name: "X", cultivar: null, location: null },
      previous: prev,
    });
    expect(t).toContain("Previous assessment");
    expect(t).toContain("60");
    expect(t).toContain("nitrogen");
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

  it("strips ```json fences if the model wraps the JSON", () => {
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
});
