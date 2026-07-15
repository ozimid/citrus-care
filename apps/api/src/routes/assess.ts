import { Hono } from "hono";
import { z } from "zod";
import { getAuth } from "../auth";
import {
  buildSystemPrompt,
  buildUserMessageText,
  assessPhotoWithGemini,
} from "../gemini";
import { tryConsume } from "../rate-limit";
import { getStorage } from "../storage";
import type { Assessment, Plant } from "@citrus/shared";

const ASSESS_LIMIT_PER_HOUR = 5;
const ASSESS_WINDOW_SEC = 3600;

const assessBodySchema = z.object({
  plantId: z.string().min(1),
  photoPath: z.string().min(3),
  isCutCare: z.boolean().optional(),
});

type PreviousLite = Pick<Assessment, "id" | "health_score" | "diagnosis" | "created_at">;

const assess = new Hono();

assess.post("/", async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = assessBodySchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "Invalid input" }, 400);
  }
  const { plantId, photoPath, isCutCare } = parsed.data;

  const auth = await getAuth(c.req.raw);
  if (!auth) {
    return c.json({ error: "Not authenticated" }, 401);
  }
  const { supabase, user } = auth;

  if (!photoPath.startsWith(user.id + "/")) {
    return c.json({ error: "Forbidden" }, 403);
  }

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

  let buf: Buffer;
  try {
    buf = await getStorage().download(photoPath);
  } catch (e) {
    console.error("[/assess] photo download failed:", (e as Error).message);
    return c.json({ error: "Photo not found" }, 404);
  }
  const base64 = buf.toString("base64");

  const systemPrompt = buildSystemPrompt(isCutCare);
  const userText = buildUserMessageText({
    plant: {
      name: plant.name,
      plant_type: plant.plant_type,
      species: plant.species,
      cultivar: plant.cultivar,
      location: plant.location,
      zip_code: plant.zip_code,
    },
    isCutCare,
    previous,
  });

  let diagnosis;
  let raw: string;
  try {
    const result = await assessPhotoWithGemini({
      systemPrompt,
      userText,
      imageBase64: base64,
      imageMediaType: "image/jpeg",
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

  const { data: inserted, error: insertErr } = await supabase
    .from("assessments")
    .insert({
      plant_id: plantId,
      user_id: user.id,
      photo_path: photoPath,
      health_score: diagnosis.health_score,
      symptoms: diagnosis.symptoms,
      diagnosis,
      recommendations: diagnosis.recommendations,
      compared_to_assessment_id: previous?.id ?? null,
      raw_output: raw,
      is_cut_care: !!isCutCare,
      cut_health_score: isCutCare ? diagnosis.health_score : null,
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
