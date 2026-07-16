// D-15 Stage 1 spike, pure half of the on-device diagnosis attempt: the
// compact plant-diagnosis prompt (a distilled cousin of the server prompt in
// apps/api/src/gemini.ts) plus a tolerant JSON extractor and the shared-schema
// parse. A small local model has no responseSchema enforcement like Gemini's
// structured output, so the extractor must survive prose and markdown fences.
// The react-native-executorch wiring lives in VlmSpikeScreen (lazy-loaded).

import { assessmentDiagnosisSchema, type AssessmentDiagnosis } from "@citrus/shared";

/** Compact system prompt: same diagnosis intent, subject contract and output
 * shape as the server's expert prompt (apps/api/src/gemini.ts), trimmed for a
 * ~2B on-device model. Both engines must agree on `subject` — it drives the
 * cut split and the non-plant rejection no matter which model answered. */
export const SPIKE_SYSTEM_PROMPT = `You are a plant care expert. Say what the photo shows, diagnose it, and prescribe prioritized care actions for a home grower.

First set "subject" to what you actually see:
- "leaf": a close-up of one or a few leaves.
- "whole_plant": a whole plant, tree or shrub — judge vigor, canopy and structure.
- "cut": a pruning cut or bark wound — judge the cut itself, not the tree.
- "not_a_plant": no plant or plant part in the photo at all.
Give a short reason in "subject_note".

Rules:
- NEVER penalize a photo for being a whole-plant shot instead of a leaf close-up, or the reverse. Diagnose what is actually there. Only genuine problems — too dark, badly blurred, no plant visible — lower the score for quality.
- Mobile nutrients (N, K, Mg) show on OLD leaves first; immobile (Fe, Mn, Zn, Ca) on NEW leaves first.
- Yellow leaves are ambiguous: consider overwatering, root rot, pH lockout, pests, cold, and light before nutrient deficiency.
- For a cut: a correct cut is just outside the branch collar; a flush cut (too close to the trunk) or a long stub both heal badly. Look for decay, borer holes, or callous forming over the edges.
- For "not_a_plant": health_score 0, say what you see in the summary, leave the lists empty.
- At most 3 symptoms, 3 causes, 3 recommendations (priority 1 = most important). Be concrete and concise; summary <= 250 characters.

Respond with VALID JSON ONLY — no prose, no markdown fences — exactly this shape:
{
  "health_score": <integer 0..100>,
  "summary": "<plain English>",
  "subject": "leaf|whole_plant|cut|not_a_plant",
  "subject_note": "<short reason>",
  "symptoms": [{"label": "...", "severity": "low|medium|high"}],
  "causes": [{"label": "...", "likelihood": "low|medium|high", "rationale": "..."}],
  "recommendations": [{"priority": 1, "action": "...", "detail": "..."}]
}`;

export const SPIKE_USER_PROMPT =
  "Say what this photo shows and diagnose its health. Reply with the JSON object only.";

/** Tolerant JSON extraction: return the first balanced {...} object found in
 * the text (brace-counting that respects strings and escapes), so fenced or
 * prose-wrapped output still yields a candidate. Null when nothing balances. */
export function extractJsonCandidate(text: string): string | null {
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    const end = findBalancedEnd(text, start);
    if (end !== -1) return text.slice(start, end + 1);
  }
  return null;
}

function findBalancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
    } else if (ch === "\\") {
      escaped = true;
    } else if (ch === '"') {
      inString = !inString;
    } else if (!inString) {
      if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) return i;
    }
  }
  return -1;
}

export type DiagnosisParseResult =
  | { ok: true; diagnosis: AssessmentDiagnosis }
  | { ok: false; reason: "no-json" | "invalid-json" | "schema-mismatch" };

/** Extract → JSON.parse → shared Zod schema. The failure reason feeds the
 * spike's parse-success tally (and, later, the Stage 2 escalation heuristic). */
export function parseDiagnosisOutput(text: string): DiagnosisParseResult {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return { ok: false, reason: "no-json" };
  let raw: unknown;
  try {
    raw = JSON.parse(candidate);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  const parsed = assessmentDiagnosisSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "schema-mismatch" };
  return { ok: true, diagnosis: parsed.data };
}
