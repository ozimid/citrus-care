import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/app/_lib/supabase/server";
import {
  buildSystemPrompt,
  buildUserMessageText,
  assessPhotoWithGemini,
} from "@/app/_lib/gemini";
import { tryConsume } from "@/app/_lib/rate-limit";
import type { Assessment, Plant } from "@citrus/shared";


export const runtime = "nodejs";
export const maxDuration = 60;

const ASSESS_LIMIT_PER_HOUR = 5;
const ASSESS_WINDOW_SEC = 3600;

const assessBodySchema = z.object({
  plantId: z.string().min(1),
  photoPath: z.string().min(3),
  isCutCare: z.boolean().optional(),
});

type PreviousLite = Pick<Assessment, "id" | "health_score" | "diagnosis" | "created_at">;

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = assessBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { plantId, photoPath, isCutCare } = parsed.data;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!photoPath.startsWith(user.id + "/")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rl = await tryConsume({
    supabase,
    key: "assess",
    limit: ASSESS_LIMIT_PER_HOUR,
    windowSec: ASSESS_WINDOW_SEC,
  });
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "Too many assessments. Please try again later.",
        retryAfter: rl.retryAfterSec,
      },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSec) },
      },
    );
  }

  const { data: plantRow } = await supabase
    .from("plants")
    .select("id,user_id,name,plant_type,species,cultivar,location,zip_code,cover_assessment_id,created_at")
    .eq("id", plantId)
    .maybeSingle();
  const plant = plantRow as Plant | null;
  if (!plant) return NextResponse.json({ error: "Plant not found" }, { status: 404 });

  const { data: prevRow } = await supabase
    .from("assessments")
    .select("id,health_score,diagnosis,created_at")
    .eq("plant_id", plantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const previous = prevRow as PreviousLite | null;

  const { data: blob, error: dlErr } = await supabase.storage
    .from("photos")
    .download(photoPath);
  if (dlErr || !blob) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }
  const buf = Buffer.from(await blob.arrayBuffer());
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
    console.error("[/api/assess] Gemini assess failed:", (e as Error).message);
    return NextResponse.json(
      { error: "AI returned an invalid response. Please try again." },
      { status: 502 },
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
    console.error("[/api/assess] Insert failed:", insertErr?.message);
    return NextResponse.json(
      { error: "Failed to save assessment." },
      { status: 500 },
    );
  }

  // Best-effort: set this assessment as the plant's cover photo.
  await supabase
    .from("plants")
    .update({ cover_assessment_id: inserted.id })
    .eq("id", plantId);

  return NextResponse.json({ id: inserted.id });
}

