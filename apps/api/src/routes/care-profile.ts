import { Hono } from "hono";
import { z } from "zod";
import { careProfileSchema } from "@citrus/shared";
import type { Plant } from "@citrus/shared";
import { getAuth } from "../auth";
import { generateCareProfile } from "../gemini";
import { tryConsume } from "../rate-limit";

// F20 — weather-aware watering, step 1: the plant's care baseline.
//
// Gemini is called ONCE per plant, ever: the profile is generated at plant
// creation, stored on plants.care_profile (jsonb, migration 0006) and reused
// forever after. Everything the user actually sees — the weather adjustment,
// the next-water date, the notification — is deterministic math on the phone
// (apps/mobile/src/lib/watering.ts). The model picks a horticultural baseline;
// it never makes a watering decision.
//
// Same boundary order as /assess: parse · auth · rate limit · RLS lookup ·
// Gemini · Zod · persist. Generic client errors, details to console.error.

const CARE_PROFILE_LIMIT_PER_HOUR = 10;
const CARE_PROFILE_WINDOW_SEC = 3600;

const bodySchema = z.object({
  plantId: z.string().min(1),
});

type PlantRow = Pick<
  Plant,
  "id" | "name" | "plant_type" | "species" | "cultivar" | "location" | "zip_code" | "care_profile"
>;

const careProfile = new Hono();

careProfile.post("/", async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "Invalid input" }, 400);
  }
  const { plantId } = parsed.data;

  const auth = await getAuth(c.req.raw);
  if (!auth) {
    return c.json({ error: "Not authenticated" }, 401);
  }
  const { supabase } = auth;

  const rl = await tryConsume({
    supabase,
    key: "care-profile",
    limit: CARE_PROFILE_LIMIT_PER_HOUR,
    windowSec: CARE_PROFILE_WINDOW_SEC,
  });
  if (!rl.ok) {
    return c.json(
      {
        error: "Too many care profile requests. Please try again later.",
        retryAfter: rl.retryAfterSec,
      },
      429,
      { "Retry-After": String(rl.retryAfterSec) },
    );
  }

  // RLS-filtered read doubles as the ownership check (same as /assess).
  const { data: plantRow } = await supabase
    .from("plants")
    .select("id,name,plant_type,species,cultivar,location,zip_code,care_profile")
    .eq("id", plantId)
    .maybeSingle();
  const plant = plantRow as PlantRow | null;
  if (!plant) return c.json({ error: "Plant not found" }, 404);

  // Already generated → serve it back, no model call. Stored jsonb is still
  // untrusted: a profile that no longer parses is treated as absent and
  // regenerated rather than handed to the watering math.
  const existing = careProfileSchema.safeParse(plant.care_profile);
  if (existing.success) {
    return c.json({ careProfile: existing.data });
  }
  if (plant.care_profile != null) {
    console.warn("[/care-profile] stored profile failed schema, regenerating:", plantId);
  }

  let generated;
  try {
    const result = await generateCareProfile({
      name: plant.name,
      plant_type: plant.plant_type,
      species: plant.species,
      cultivar: plant.cultivar,
      location: plant.location,
      zip_code: plant.zip_code,
    });
    generated = result.careProfile;
  } catch (e) {
    console.error("[/care-profile] Gemini care profile failed:", (e as Error).message);
    return c.json({ error: "AI returned an invalid response. Please try again." }, 502);
  }

  const { error: updateErr } = await supabase
    .from("plants")
    .update({ care_profile: generated })
    .eq("id", plantId);

  if (updateErr) {
    console.error("[/care-profile] Update failed:", updateErr.message);
    return c.json({ error: "Failed to save the care profile." }, 500);
  }

  return c.json({ careProfile: generated });
});

export default careProfile;
