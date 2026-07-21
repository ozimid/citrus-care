import { z } from "zod";
import type { AssessmentDiagnosis } from "./types";

export const symptomSchema = z.object({
  label: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]),
  notes: z.string().optional(),
});

export const causeSchema = z.object({
  label: z.string().min(1),
  likelihood: z.enum(["low", "medium", "high"]),
  rationale: z.string().min(1),
});

export const recommendationSchema = z.object({
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  action: z.string().min(1),
  detail: z.string().min(1),
});

/** F21 — the subject the model reports having seen. Closed value space: the
 * cut split and the non-plant rejection both key off it, so an unrecognized
 * value is model output we refuse rather than guess at. */
export const assessmentSubjectSchema = z.enum(["leaf", "whole_plant", "cut", "not_a_plant"]);

/**
 * Which engine produced a diagnosis. D-17 collapsed this to the single
 * on-device engine (the `gemini` / `gemini:*` escalation values went with
 * apps/api); kept as a closed enum so a future second engine has a home.
 */
export const assessmentEngineSchema = z.enum(["on-device"]);

export type AssessmentEngine = z.infer<typeof assessmentEngineSchema>;

export const assessmentDiagnosisSchema: z.ZodType<AssessmentDiagnosis> = z.object({
  health_score: z.number().int().min(0).max(100),
  summary: z.string().min(1).max(300),
  // Optional for the read path only — see AssessmentDiagnosis.subject.
  subject: assessmentSubjectSchema.optional(),
  subject_note: z.string().max(200).optional(),
  symptoms: z.array(symptomSchema).max(8),
  causes: z.array(causeSchema).max(6),
  recommendations: z.array(recommendationSchema).max(5),
  /** F35: optional identification of WHAT plant the photo shows — drafts the
   * new-plant form in snap-first capture. Only when the model is confident. */
  plant_guess: z
    .object({
      plant_type: z.string().max(40).optional(),
      species: z.string().max(120).optional(),
    })
    .optional(),
  comparison: z
    .object({
      delta: z.enum(["better", "same", "worse", "unknown"]),
      notes: z.string().min(1).max(400),
    })
    .optional(),
});
