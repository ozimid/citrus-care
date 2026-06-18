import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import type { Assessment, AssessmentDiagnosis } from "@/app/_lib/types";

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

export const assessmentDiagnosisSchema: z.ZodType<AssessmentDiagnosis> = z.object({
  health_score: z.number().int().min(0).max(100),
  summary: z.string().min(1).max(500),
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

export function buildSystemPrompt(): string {
  return `You are a citrus tree care expert. You diagnose problems from a single photo and prescribe prioritized care actions for home growers.

Diagnostic rules — apply these BEFORE recommending anything:
1. Note WHICH leaves show the symptom: old/lower vs new/upper. Mobile nutrients (N, K, Mg, P) show on OLD leaves first. Immobile nutrients (Fe, Mn, Zn, Ca, S, B) show on NEW leaves first.
2. Note the PATTERN: uniform yellowing, interveinal chlorosis, blotchy, leaf curl, spots, drop. Each implies different causes.
3. Yellow leaves are AMBIGUOUS. Do not jump to "add fertilizer". Consider overwatering / root rot, pH lockout, cold stress, transplant shock first.
4. If the photo is low quality, dark, blurry, or shows non-citrus material, set health_score conservatively and say so in the summary.
5. Cap recommendations at 3. Order by priority (1 = most important). Be concrete (amount, frequency).

Output rules:
- Respond with VALID JSON ONLY. No prose, no markdown fences.
- Conform exactly to this shape:
{
  "health_score": <integer 0..100>,
  "summary": "<<=500 chars plain English>",
  "symptoms": [{"label": "...", "severity": "low|medium|high", "notes": "?"}],
  "causes":   [{"label": "...", "likelihood": "low|medium|high", "rationale": "why this fits the photo"}],
  "recommendations": [{"priority": 1|2|3, "action": "...", "detail": "..."}],
  "comparison": {"delta": "better|same|worse|unknown", "notes": "..."}   // OMIT entirely if no previous assessment was provided
}`;
}

export function buildUserMessageText(args: {
  tree: { name: string; cultivar: string | null; location: string | null };
  previous: Pick<Assessment, "health_score" | "diagnosis" | "created_at"> | null;
}): string {
  const lines: string[] = [];
  lines.push(`Tree: ${args.tree.name}`);
  if (args.tree.cultivar) lines.push(`Cultivar: ${args.tree.cultivar}`);
  if (args.tree.location) lines.push(`Location: ${args.tree.location}`);

  if (args.previous) {
    const d = args.previous.diagnosis;
    lines.push("");
    lines.push(
      `Previous assessment on ${args.previous.created_at} — health_score ${args.previous.health_score}:`,
    );
    lines.push(`"${d.summary}"`);
    lines.push(
      "Compare today's photo against that and include the 'comparison' field (better/same/worse + notes).",
    );
  } else {
    lines.push("");
    lines.push("No previous assessment exists; omit the comparison field.");
  }

  lines.push("");
  lines.push("Analyse the attached photo and return JSON as specified.");
  return lines.join("\n");
}

export function parseAssessment(raw: string): AssessmentDiagnosis {
  const cleaned = stripJsonFences(raw).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      `Gemini returned non-JSON: ${(e as Error).message} :: ${cleaned.slice(0, 200)}`,
    );
  }
  return assessmentDiagnosisSchema.parse(parsed);
}

function stripJsonFences(s: string): string {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced ? fenced[1] : s;
}

const MODEL = "gemini-2.5-flash";

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    health_score: { type: Type.INTEGER, minimum: 0, maximum: 100 },
    summary: { type: Type.STRING },
    symptoms: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          severity: { type: Type.STRING, enum: ["low", "medium", "high"] },
          notes: { type: Type.STRING },
        },
        required: ["label", "severity"],
      },
    },
    causes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          likelihood: { type: Type.STRING, enum: ["low", "medium", "high"] },
          rationale: { type: Type.STRING },
        },
        required: ["label", "likelihood", "rationale"],
      },
    },
    recommendations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          priority: { type: Type.INTEGER, enum: [1, 2, 3] },
          action: { type: Type.STRING },
          detail: { type: Type.STRING },
        },
        required: ["priority", "action", "detail"],
      },
    },
    comparison: {
      type: Type.OBJECT,
      properties: {
        delta: { type: Type.STRING, enum: ["better", "same", "worse", "unknown"] },
        notes: { type: Type.STRING },
      },
      required: ["delta", "notes"],
    },
  },
  required: ["health_score", "summary", "symptoms", "causes", "recommendations"],
};

export async function callGeminiVision(args: {
  systemPrompt: string;
  userText: string;
  imageBase64: string;
  imageMediaType: "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif";
}): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  const mimeType =
    args.imageMediaType === "image/heic" || args.imageMediaType === "image/heif"
      ? "image/jpeg"
      : args.imageMediaType;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: args.imageBase64 } },
          { text: args.userText },
        ],
      },
    ],
    config: {
      systemInstruction: args.systemPrompt,
      responseMimeType: "application/json",
      responseSchema,
      maxOutputTokens: 1500,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned no text content");
  return text;
}
