export type UUID = string;

/**
 * F20 — the per-plant care baseline. Gemini generates this ONCE, at plant
 * creation (`POST /care-profile`); everything downstream (weather adjustment,
 * next-water date) is deterministic math on the phone, so the model never sees
 * a watering decision. Stored as jsonb on plants.care_profile (migration 0006).
 */
export interface CareProfile {
  /** Fair-weather baseline between waterings, 1..60 days. */
  base_watering_interval_days: number;
  water_amount_note: string;
  sun: "full" | "partial" | "shade";
  temp_min_c: number;
  /** Above this the plant is heat-stressed — the watering math shortens. */
  temp_max_c: number;
  drought_tolerance: "low" | "medium" | "high";
  indoor_ok: boolean;
  notes: string;
}

export interface Plant {
  id: UUID;
  user_id: UUID;
  name: string;
  plant_type: string;
  species: string | null;
  cultivar: string | null;
  location: string | null;
  zip_code: string | null;
  cover_assessment_id: UUID | null;
  /** Null until /care-profile has generated one (F20). */
  care_profile: CareProfile | null;
  created_at: string;
}

export type HealthSeverity = "low" | "medium" | "high";

export interface Symptom {
  label: string;
  severity: HealthSeverity;
  notes?: string;
}

export interface Cause {
  label: string;
  likelihood: "low" | "medium" | "high";
  rationale: string;
}

export interface Recommendation {
  priority: 1 | 2 | 3;
  action: string;
  detail: string;
}

/**
 * F21 — what the model says it actually photographed. The user used to pick
 * this before the shot (Leaf / Whole plant / Cut) and the choice conditioned
 * the prompt, so a tree shot in "Leaf" mode came back as a quality complaint.
 * A vision model is the thing that is good at this; the app adapts to its
 * answer. `assessments.is_cut_care` is derived from `subject === "cut"`.
 */
export type AssessmentSubject = "leaf" | "whole_plant" | "cut" | "not_a_plant";

export interface AssessmentDiagnosis {
  health_score: number;
  summary: string;
  /**
   * Optional ONLY for the read path: every assessment written since F21 has
   * one (Gemini's responseSchema requires it), but rows from before it do not,
   * and the same schema guards timeline taps and the assess round-trip —
   * requiring it would make every historical assessment unopenable.
   */
  subject?: AssessmentSubject;
  /** Short "why I read it that way" note from the model. */
  subject_note?: string;
  symptoms: Symptom[];
  causes: Cause[];
  recommendations: Recommendation[];
  comparison?: {
    delta: "better" | "same" | "worse" | "unknown";
    notes: string;
  };
}

export interface Assessment {
  id: UUID;
  plant_id: UUID;
  user_id: UUID;
  /** Legacy bucket path. Null since D-16 — photos live only on the phone. */
  photo_path: string | null;
  created_at: string;
  health_score: number;
  symptoms: Symptom[];
  diagnosis: AssessmentDiagnosis;
  recommendations: Recommendation[];
  compared_to_assessment_id: UUID | null;
  raw_output: string;
  is_cut_care: boolean;
  cut_health_score: number | null;
}

