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
 * F22 — the value space of `assessments.engine` (migration 0007): which engine
 * produced a diagnosis, plus the reason the on-device model was dropped when
 * one was tried and escalated. Closed on purpose: this column is the D-15
 * go/no-go dataset, so a value nobody can count is worse than no value.
 */
export const assessmentEngineSchema = z.enum([
  "on-device",
  "gemini",
  "gemini:local_timeout",
  "gemini:local_invalid",
  "gemini:local_error",
]);

export type AssessmentEngine = z.infer<typeof assessmentEngineSchema>;

/**
 * What /assess may legitimately be told by a phone. That route always runs
 * Gemini, so an "on-device" claim is false by construction — the phone is only
 * ever the source of the *reason* it escalated, never of the engine identity.
 */
export const clientAssessmentEngineSchema = assessmentEngineSchema.exclude(["on-device"]);

export const assessmentDiagnosisSchema: z.ZodType<AssessmentDiagnosis> = z.object({
  health_score: z.number().int().min(0).max(100),
  summary: z.string().min(1).max(300),
  // Optional for the read path only — see AssessmentDiagnosis.subject.
  subject: assessmentSubjectSchema.optional(),
  subject_note: z.string().max(200).optional(),
  symptoms: z.array(symptomSchema).max(8),
  causes: z.array(causeSchema).max(6),
  recommendations: z.array(recommendationSchema).max(5),
  comparison: z
    .object({
      delta: z.enum(["better", "same", "worse", "unknown"]),
      notes: z.string().min(1).max(400),
    })
    .optional(),
});
