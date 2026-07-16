import { Hono } from "hono";
import { z } from "zod";
import { getAuth } from "../auth";
import {
  buildSystemPrompt,
  buildUserMessageText,
  assessPhotoWithGemini,
} from "../gemini";
import { tryConsume } from "../rate-limit";
import type { Assessment, Plant } from "@citrus/shared";

const ASSESS_LIMIT_PER_HOUR = 5;
const ASSESS_WINDOW_SEC = 3600;

// D-16: photos live only on the phone. The escalation request carries the
// downscaled JPEG directly; nothing is written to any storage bucket and
// assessments persist with photo_path null.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const assessBodySchema = z.object({
  plantId: z.string().min(1),
  imageBase64: z.string().min(1),
  mime: z.literal("image/jpeg"),
  /** F21: accepted and IGNORED. The cut split is now the model's call
   * (diagnosis.subject), but an un-reloaded phone still posts this flag and a
   * 400 would be a worse answer than quietly ignoring it. Drop after a release. */
  isCutCare: z.boolean().optional(),
  /** "Save anyway" — persist even when the model says it is not a plant. */
  force: z.boolean().optional(),
});

/** Decoded byte size of a base64 string, without decoding it. */
export function base64DecodedBytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

type PreviousLite = Pick<Assessment, "id" | "health_score" | "diagnosis" | "created_at">;

const assess = new Hono();

assess.post("/", async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = assessBodySchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "Invalid input" }, 400);
  }
  const { plantId, imageBase64, mime, force } = parsed.data;

  if (base64DecodedBytes(imageBase64) > MAX_IMAGE_BYTES) {
    return c.json({ error: "Image too large. Please retry." }, 400);
  }

  const auth = await getAuth(c.req.raw);
  if (!auth) {
    return c.json({ error: "Not authenticated" }, 401);
  }
  const { supabase, user } = auth;

  const rl = await tryConsume({
    supabase,
    key: "assess",
    limit: ASSESS_LIMIT_PER_HOUR,
    windowSec: ASSESS_WINDOW_SEC,
  });
  if (!rl.ok) {
    return c.json(
      {
        error: "Too many assessments. Please try again later.",
        retryAfter: rl.retryAfterSec,
      },
      429,
      { "Retry-After": String(rl.retryAfterSec) },
    );
  }

  // RLS-filtered read doubles as the ownership check: another user's plant is
  // invisible to this client, so the row comes back null.
  const { data: plantRow } = await supabase
    .from("plants")
    .select("id,user_id,name,plant_type,species,cultivar,location,zip_code,cover_assessment_id,created_at")
    .eq("id", plantId)
    .maybeSingle();
  const plant = plantRow as Plant | null;
  if (!plant) return c.json({ error: "Plant not found" }, 404);

  const { data: prevRow } = await supabase
    .from("assessments")
    .select("id,health_score,diagnosis,created_at")
    .eq("plant_id", plantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const previous = prevRow as PreviousLite | null;

  const systemPrompt = buildSystemPrompt();
  const userText = buildUserMessageText({
    plant: {
      name: plant.name,
      plant_type: plant.plant_type,
      species: plant.species,
      cultivar: plant.cultivar,
      location: plant.location,
      zip_code: plant.zip_code,
    },
    previous,
  });

  let diagnosis;
  let raw: string;
  try {
    const result = await assessPhotoWithGemini({
      systemPrompt,
      userText,
      imageBase64,
      imageMediaType: mime,
    });
    diagnosis = result.diagnosis;
    raw = result.raw;
  } catch (e) {
    console.error("[/assess] Gemini assess failed:", (e as Error).message);
    return c.json(
      { error: "AI returned an invalid response. Please try again." },
      502,
    );
  }

  // F21: a photo the model reads as non-plant does not belong in a plant's
  // timeline. Hand the diagnosis back unsaved so the client can explain
  // itself and offer "save anyway", which re-posts with force.
  if (diagnosis.subject === "not_a_plant" && !force) {
    return c.json({ rejected: true, diagnosis });
  }

  const isCut = diagnosis.subject === "cut";

  const { data: inserted, error: insertErr } = await supabase
    .from("assessments")
    .insert({
      plant_id: plantId,
      user_id: user.id,
      photo_path: null,
      health_score: diagnosis.health_score,
      symptoms: diagnosis.symptoms,
      diagnosis,
      recommendations: diagnosis.recommendations,
      compared_to_assessment_id: previous?.id ?? null,
      raw_output: raw,
      is_cut_care: isCut,
      cut_health_score: isCut ? diagnosis.health_score : null,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    console.error("[/assess] Insert failed:", insertErr?.message);
    return c.json({ error: "Failed to save assessment." }, 500);
  }

  // Best-effort: set this assessment as the plant's cover photo.
  await supabase
    .from("plants")
    .update({ cover_assessment_id: inserted.id })
    .eq("id", plantId);

  return c.json({ id: inserted.id });
});

export default assess;
