// On-device engine, IO half (D-15 Stage 2): AsyncStorage for the opt-in
// setting + the RLS-scoped Supabase insert that persists a locally produced
// assessment. Thin by design (README testing policy) — the row shape, the
// state machine and the settings parsing are pure and tested in
// local-engine.ts / local-engine.test.ts.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssessmentDiagnosis } from "@citrus/shared";
import {
  DEFAULT_LOCAL_ENGINE_SETTINGS,
  LOCAL_ENGINE_STORAGE_KEY,
  buildLocalAssessmentRow,
  parseLocalEngineSettings,
  serializeLocalEngineSettings,
  type LocalEngineSettings,
} from "./local-engine";

export async function loadLocalEngineSettings(): Promise<LocalEngineSettings> {
  try {
    return parseLocalEngineSettings(await AsyncStorage.getItem(LOCAL_ENGINE_STORAGE_KEY));
  } catch (e) {
    // A settings read is never worth blocking the app: fall back to "off".
    console.error("[local-engine-io] settings load failed:", (e as Error).message);
    return DEFAULT_LOCAL_ENGINE_SETTINGS;
  }
}

export async function saveLocalEngineSettings(settings: LocalEngineSettings): Promise<void> {
  await AsyncStorage.setItem(LOCAL_ENGINE_STORAGE_KEY, serializeLocalEngineSettings(settings));
}

export interface PersistLocalAssessmentInput {
  plantId: string;
  diagnosis: AssessmentDiagnosis;
  raw: string;
  isCutCare: boolean;
}

/** Insert an on-device diagnosis straight into `assessments` (RLS scopes it to
 * the signed-in user — anon key only, same as every other mobile query), then
 * mirror /assess's wiring: link the previous assessment so timeline deltas keep
 * working, and best-effort update the plant's cover. Returns the new id.
 * Throws on failure — the router treats that as "escalate to Gemini". */
export async function persistLocalAssessment(
  client: SupabaseClient,
  input: PersistLocalAssessmentInput,
): Promise<string> {
  const { data: userData, error: userErr } = await client.auth.getUser();
  const userId = userData?.user?.id;
  if (userErr || !userId) throw new Error("no authenticated user for the local insert");

  // Same lookup as /assess: newest assessment for this plant becomes the
  // comparison anchor (RLS already limits this to the user's own rows).
  const { data: prevRow } = await client
    .from("assessments")
    .select("id")
    .eq("plant_id", input.plantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: inserted, error: insertErr } = await client
    .from("assessments")
    .insert(
      buildLocalAssessmentRow({
        plantId: input.plantId,
        userId,
        diagnosis: input.diagnosis,
        raw: input.raw,
        isCutCare: input.isCutCare,
        previousAssessmentId: (prevRow as { id: string } | null)?.id ?? null,
      }),
    )
    .select("id")
    .single();

  if (insertErr || !inserted) {
    throw new Error(insertErr?.message ?? "local assessment insert returned no row");
  }
  const id = (inserted as { id: string }).id;

  // Best-effort, exactly as /assess does it: a missed cover costs a thumbnail.
  const { error: coverErr } = await client
    .from("plants")
    .update({ cover_assessment_id: id })
    .eq("id", input.plantId);
  if (coverErr) console.error("[local-engine-io] cover update failed:", coverErr.message);

  return id;
}
