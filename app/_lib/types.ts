export type UUID = string;

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

export interface AssessmentDiagnosis {
  health_score: number;
  summary: string;
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
  photo_path: string;
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

