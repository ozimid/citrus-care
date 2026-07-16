import { GoogleGenAI, Type } from "@google/genai";
import { assessmentDiagnosisSchema, careProfileSchema } from "@citrus/shared";
import type { Assessment, AssessmentDiagnosis, CareProfile, Plant } from "@citrus/shared";

export function buildSystemPrompt(isCutCare?: boolean): string {
  if (isCutCare) {
    return `You are a plant care expert specializing in pruning and branch wound healing. You diagnose the health of a pruning cut or branch wound from a photo and prescribe prioritized care actions for home growers.

Diagnostic rules — apply these BEFORE recommending anything:
1. Evaluate the CUT ANATOMY: Is it cut cleanly? Is the branch collar preserved? Is there a long stub remaining, or is it a dangerous flush cut?
   - Branch-collar preservation: A correct cut is just outside the branch collar at a 45-degree angle.
   - Flush cut: Too close to the trunk (destructive to collar tissue, bad).
   - Long stub: Leftover branch portion (prevents natural healing, bad).
2. Assess wound health: Look for signs of decay, pests, wood-borer entry, disease infection, or successful callous formation (healing bark rolled over the edges).
3. Recommend specific aftercare actions (e.g., applying specialized breathable waterproof wound sealant/paste, cleaning tools, re-pruning to a correct collar cut if a stub remains).
4. Cap recommendations at 3. Order by priority (1 = most important).
5. Be concrete (amount, frequency) and concise: summary <= 250 characters; at most 3 symptoms, 3 causes, 3 recommendations; keep rationales under 120 characters each.

Output rules:
- Respond with VALID JSON ONLY. No prose, no markdown fences.
- Conform exactly to this shape:
{
  "health_score": <integer 0..100 representing cut quality/wound health>,
  "summary": "<<=250 chars plain English>",
  "symptoms": [{"label": "...", "severity": "low|medium|high", "notes": "?"}],
  "causes":   [{"label": "...", "likelihood": "low|medium|high", "rationale": "why this fits the photo"}],
  "recommendations": [{"priority": 1|2|3, "action": "...", "detail": "..."}],
  "comparison": {"delta": "better|same|worse|unknown", "notes": "..."}   // OMIT entirely if no previous assessment was provided
}`;
  }

  return `You are a plant care expert. You diagnose problems from a single photo and prescribe prioritized care actions for home growers.

Diagnostic rules — apply these BEFORE recommending anything:
1. Consider the plant type (e.g. tree, shrub, flower, succulent, vegetable, herb, vine, other) and species. Nutrient and watering requirements vary wildly.
2. Note WHICH leaves show the symptom if applicable: old/lower vs new/upper. Mobile nutrients (N, K, Mg, P) show on OLD leaves first. Immobile nutrients (Fe, Mn, Zn, Ca, S, B) show on NEW leaves first.
3. Note the PATTERN: uniform yellowing, interveinal chlorosis, blotchy, leaf curl, spots, drop, or shrivelling (e.g. in succulents).
4. Yellow leaves are AMBIGUOUS. Consider overwatering, root rot, pH lockout, pest damage, cold stress, and light conditions before assuming nutrient deficiency.
5. If the photo is low quality, dark, blurry, or shows non-plant material, set health_score conservatively and say so in the summary.
6. Cap recommendations at 3. Order by priority (1 = most important). Be concrete (amount, frequency).
7. Be concise: summary <= 250 characters; at most 3 symptoms, 3 causes, 3 recommendations; keep rationales under 120 characters each.

Output rules:
- Respond with VALID JSON ONLY. No prose, no markdown fences.
- Conform exactly to this shape:
{
  "health_score": <integer 0..100>,
  "summary": "<<=250 chars plain English>",
  "symptoms": [{"label": "...", "severity": "low|medium|high", "notes": "?"}],
  "causes":   [{"label": "...", "likelihood": "low|medium|high", "rationale": "why this fits the photo"}],
  "recommendations": [{"priority": 1|2|3, "action": "...", "detail": "..."}],
  "comparison": {"delta": "better|same|worse|unknown", "notes": "..."}   // OMIT entirely if no previous assessment was provided
}`;
}

export function buildUserMessageText(args: {
  plant: {
    name: string;
    plant_type: string;
    species: string | null;
    cultivar: string | null;
    location: string | null;
    zip_code?: string | null;
  };
  isCutCare?: boolean;
  previous: Pick<Assessment, "health_score" | "diagnosis" | "created_at"> | null;
}): string {
  const lines: string[] = [];
  lines.push(`Plant Name: ${args.plant.name}`);
  lines.push(`Plant Type: ${args.plant.plant_type}`);
  if (args.plant.species) lines.push(`Species: ${args.plant.species}`);
  if (args.plant.cultivar) lines.push(`Cultivar: ${args.plant.cultivar}`);
  if (args.plant.location) lines.push(`Location: ${args.plant.location}`);
  if (args.plant.zip_code) lines.push(`ZIP Code: ${args.plant.zip_code}`);
  if (args.isCutCare) lines.push("Assessment Mode: Pruning Cut or Branch Wound healing");

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


// ------------------------------------------------------------------
// F20 — care profile: ONE text call per plant, at creation. The model supplies
// only the horticultural baseline; the weather adjustment and the next-water
// date are deterministic math on the phone (src/lib/watering.ts).
// ------------------------------------------------------------------

export type CareProfilePlant = Pick<
  Plant,
  "name" | "plant_type" | "species" | "cultivar" | "location" | "zip_code"
>;

export function buildCareProfileSystemPrompt(): string {
  return `You are a plant care expert. Given a plant's identity, you produce a concise, practical care baseline for a home grower.

Rules:
1. base_watering_interval_days is the interval in FAIR weather for an established plant in normal soil. Be realistic per species: succulents/cacti 14-30, most trees and shrubs 5-10, herbs and vegetables 1-3, tropical foliage 5-8.
2. temp_min_c / temp_max_c are the comfortable range. Above temp_max_c the plant is heat-stressed; below temp_min_c it is cold-stressed. These are stress thresholds, NOT survival limits.
3. drought_tolerance: "high" = stores water and forgives a missed watering (succulent, olive, rosemary); "low" = wilts fast and resents drying out (fern, hydrangea, basil).
4. indoor_ok: true only if the plant genuinely thrives indoors year-round.
5. water_amount_note: how much per watering, concrete (volume or a rule like "until it drains"). <= 140 characters.
6. notes: one or two sentences of the single most useful watering/siting habit for this plant. <= 300 characters.
7. Base the numbers on the species/cultivar given. If the plant is vague, choose a sensible middle-of-the-road baseline rather than an extreme.

Output rules:
- Respond with VALID JSON ONLY. No prose, no markdown fences.
- Conform exactly to this shape:
{
  "base_watering_interval_days": <number 1..60>,
  "water_amount_note": "...",
  "sun": "full|partial|shade",
  "temp_min_c": <number, degrees Celsius>,
  "temp_max_c": <number, degrees Celsius>,
  "drought_tolerance": "low|medium|high",
  "indoor_ok": <boolean>,
  "notes": "..."
}`;
}

export function buildCareProfileUserText(plant: CareProfilePlant): string {
  const lines: string[] = [];
  lines.push(`Plant Name: ${plant.name}`);
  lines.push(`Plant Type: ${plant.plant_type}`);
  if (plant.species) lines.push(`Species: ${plant.species}`);
  if (plant.cultivar) lines.push(`Cultivar: ${plant.cultivar}`);
  if (plant.location) lines.push(`Location: ${plant.location}`);
  if (plant.zip_code) lines.push(`ZIP Code: ${plant.zip_code}`);
  lines.push("");
  lines.push("Return the care profile JSON as specified.");
  return lines.join("\n");
}

export function parseCareProfile(raw: string): CareProfile {
  const cleaned = stripJsonFences(raw).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      `Gemini returned non-JSON: ${(e as Error).message} :: ${cleaned.slice(0, 200)}`,
    );
  }
  return careProfileSchema.parse(parsed);
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
          priority: { type: Type.INTEGER, minimum: 1, maximum: 3 },
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

  let lastError: unknown = null;
  const maxRetries = 2;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
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
          maxOutputTokens: 4096,
        },
      });

      const text = response.text;
      if (!text) throw new Error("Gemini returned no text content");

      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason === "MAX_TOKENS") {
        console.warn("[gemini] response truncated (MAX_TOKENS)");
      }

      return text;
    } catch (e) {
      lastError = e;
      console.warn(`[gemini] API call attempt ${attempt} failed:`, (e as Error).message);
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini API call failed after retries");
}

const careProfileResponseSchema = {
  type: Type.OBJECT,
  properties: {
    base_watering_interval_days: { type: Type.NUMBER, minimum: 1, maximum: 60 },
    water_amount_note: { type: Type.STRING },
    sun: { type: Type.STRING, enum: ["full", "partial", "shade"] },
    temp_min_c: { type: Type.NUMBER },
    temp_max_c: { type: Type.NUMBER },
    drought_tolerance: { type: Type.STRING, enum: ["low", "medium", "high"] },
    indoor_ok: { type: Type.BOOLEAN },
    notes: { type: Type.STRING },
  },
  required: [
    "base_watering_interval_days",
    "water_amount_note",
    "sun",
    "temp_min_c",
    "temp_max_c",
    "drought_tolerance",
    "indoor_ok",
    "notes",
  ],
};

/** Text-only sibling of callGeminiVision — same client, same MODEL, same
 * retry shape. No image: the care profile is derived from plant identity. */
async function callGeminiText(args: {
  systemPrompt: string;
  userText: string;
}): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  let lastError: unknown = null;
  const maxRetries = 2;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: "user", parts: [{ text: args.userText }] }],
        config: {
          systemInstruction: args.systemPrompt,
          responseMimeType: "application/json",
          responseSchema: careProfileResponseSchema,
          maxOutputTokens: 1024,
        },
      });

      const text = response.text;
      if (!text) throw new Error("Gemini returned no text content");
      return text;
    } catch (e) {
      lastError = e;
      console.warn(`[gemini] care-profile attempt ${attempt} failed:`, (e as Error).message);
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini API call failed after retries");
}

/** The one and only Gemini call a plant's watering guidance ever needs. */
export async function generateCareProfile(
  plant: CareProfilePlant,
): Promise<{ careProfile: CareProfile; raw: string }> {
  const raw = await callGeminiText({
    systemPrompt: buildCareProfileSystemPrompt(),
    userText: buildCareProfileUserText(plant),
  });
  return { careProfile: parseCareProfile(raw), raw };
}

export async function assessPhotoWithGemini(args: {
  systemPrompt: string;
  userText: string;
  imageBase64: string;
  imageMediaType: "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif";
}): Promise<{ diagnosis: AssessmentDiagnosis; raw: string }> {
  let raw = await callGeminiVision(args);
  try {
    return { diagnosis: parseAssessment(raw), raw };
  } catch (firstErr) {
    console.warn("[gemini] parse failed, retrying:", (firstErr as Error).message);
    raw = await callGeminiVision({
      ...args,
      userText:
        args.userText +
        "\n\nReturn COMPLETE valid JSON only. Be very concise — short summary and brief fields.",
    });
    return { diagnosis: parseAssessment(raw), raw };
  }
}
