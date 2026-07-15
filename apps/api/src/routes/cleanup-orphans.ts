import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { getStorage } from "../storage";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const cleanupOrphans = new Hono();

cleanupOrphans.post("/", async (c) => {
  const authHeader = c.req.header("Authorization") ?? null;
  const secret = process.env.CLEANUP_SECRET;

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("[cleanup-orphans] Missing service role keys");
    return c.json({ error: "Server configuration error" }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Active photo paths = every path still referenced by an assessment row.
  const { data: assessments, error: dbErr } = await supabase
    .from("assessments")
    .select("photo_path");

  if (dbErr) {
    console.error("[cleanup-orphans] Failed to fetch assessments:", dbErr.message);
    return c.json({ error: "Database error" }, 500);
  }

  const activePaths = new Set((assessments ?? []).map((a) => a.photo_path));
  const now = Date.now();
  let deletedCount = 0;

  try {
    const storage = getStorage();
    const objects = await storage.listAll();

    for (const obj of objects) {
      // Never delete an object we can't age: a missing timestamp means we
      // cannot prove it is older than the grace window.
      if (!obj.createdAt) continue;
      const createdTime = new Date(obj.createdAt).getTime();
      if (Number.isNaN(createdTime)) continue;

      const isOrphan = !activePaths.has(obj.name);
      const isOld = now - createdTime > ONE_DAY_MS;
      if (isOrphan && isOld) {
        await storage.deletePrefix(obj.name);
        deletedCount++;
        console.log(`[cleanup-orphans] Deleted orphan ${obj.name}`);
      }
    }

    return c.json({ deleted: deletedCount });
  } catch (error) {
    console.error("[cleanup-orphans] Execution failed:", (error as Error).message);
    return c.json({ error: "Cleanup failed" }, 500);
  }
});

export default cleanupOrphans;
