import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/app/_lib/supabase/server";
import {
  buildSystemPrompt,
  buildUserMessageText,
  callGeminiVision,
  parseAssessment,
} from "@/app/_lib/gemini";
import type { Assessment, Tree } from "@/app/_lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const assessBodySchema = z.object({
  treeId: z.string().min(1),
  photoPath: z.string().min(3),
});

type PreviousLite = Pick<Assessment, "id" | "health_score" | "diagnosis" | "created_at">;

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = assessBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { treeId, photoPath } = parsed.data;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: treeRow } = await supabase
    .from("trees")
    .select("id,user_id,name,cultivar,location,cover_assessment_id,created_at")
    .eq("id", treeId)
    .maybeSingle();
  const tree = treeRow as Tree | null;
  if (!tree) return NextResponse.json({ error: "Tree not found" }, { status: 404 });

  const { data: prevRow } = await supabase
    .from("assessments")
    .select("id,health_score,diagnosis,created_at")
    .eq("tree_id", treeId)
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

  const systemPrompt = buildSystemPrompt();
  const userText = buildUserMessageText({
    tree: { name: tree.name, cultivar: tree.cultivar, location: tree.location },
    previous,
  });

  let raw: string;
  try {
    raw = await callGeminiVision({
      systemPrompt,
      userText,
      imageBase64: base64,
      imageMediaType: "image/jpeg",
    });
  } catch (e) {
    return NextResponse.json(
      { error: `AI call failed: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  let diagnosis;
  try {
    diagnosis = parseAssessment(raw);
  } catch (e) {
    return NextResponse.json(
      { error: `AI returned malformed JSON: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("assessments")
    .insert({
      tree_id: treeId,
      user_id: user.id,
      photo_path: photoPath,
      health_score: diagnosis.health_score,
      symptoms: diagnosis.symptoms,
      diagnosis,
      recommendations: diagnosis.recommendations,
      compared_to_assessment_id: previous?.id ?? null,
      raw_output: raw,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Failed to save assessment" },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: inserted.id });
}
