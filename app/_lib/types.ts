export type UUID = string;

export interface Tree {
  id: UUID;
  user_id: UUID;
  name: string;
  cultivar: string | null;
  location: string | null;
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
  tree_id: UUID;
  user_id: UUID;
  photo_path: string;
  created_at: string;
  health_score: number;
  symptoms: Symptom[];
  diagnosis: AssessmentDiagnosis;
  recommendations: Recommendation[];
  compared_to_assessment_id: UUID | null;
  raw_output: string;
}
