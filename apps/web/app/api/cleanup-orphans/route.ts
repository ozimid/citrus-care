import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const authHeader = req.headers.get("Authorization");
  const secret = process.env.CLEANUP_SECRET;

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("[cleanup-orphans] Missing service role keys");
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Fetch all active photo paths
  const { data: assessments, error: dbErr } = await supabase
    .from("assessments")
    .select("photo_path");

  if (dbErr) {
    console.error("[cleanup-orphans] Failed to fetch assessments:", dbErr.message);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const activePaths = new Set((assessments ?? []).map((a) => a.photo_path));
  let deletedCount = 0;
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  try {
    // 1. List user directories at root
    const { data: userDirs, error: userDirsErr } = await supabase.storage
      .from("photos")
      .list("");

    if (userDirsErr) throw userDirsErr;

    for (const userDir of userDirs ?? []) {
      // Skip files at root, only traverse directory names
      if (!userDir.id && userDir.name) {
        // 2. List plant directories under user
        const { data: plantDirs, error: plantDirsErr } = await supabase.storage
          .from("photos")
          .list(userDir.name);

        if (plantDirsErr) {
          console.error(`[cleanup-orphans] Failed listing userDir ${userDir.name}:`, plantDirsErr.message);
          continue;
        }

        for (const plantDir of plantDirs ?? []) {
          if (!plantDir.id && plantDir.name) {
            // 3. List files under user/plant
            const prefix = `${userDir.name}/${plantDir.name}`;
            const { data: files, error: filesErr } = await supabase.storage
              .from("photos")
              .list(prefix);

            if (filesErr) {
              console.error(`[cleanup-orphans] Failed listing files under ${prefix}:`, filesErr.message);
              continue;
            }

            const pathsToDelete: string[] = [];

            for (const file of files ?? []) {
              // Ignore subfolders if any (only delete actual files which have an ID)
              if (file.id) {
                const fullPath = `${prefix}/${file.name}`;
                const createdTime = file.created_at ? new Date(file.created_at).getTime() : 0;

                if (!activePaths.has(fullPath) && (now - createdTime) > ONE_DAY_MS) {
                  pathsToDelete.push(fullPath);
                }
              }
            }

            if (pathsToDelete.length > 0) {
              const { error: delErr } = await supabase.storage
                .from("photos")
                .remove(pathsToDelete);

              if (delErr) {
                console.error(`[cleanup-orphans] Failed to delete files under ${prefix}:`, delErr.message);
              } else {
                deletedCount += pathsToDelete.length;
                console.log(`[cleanup-orphans] Deleted ${pathsToDelete.length} files under ${prefix}`);
              }
            }
          }
        }
      }
    }

    return NextResponse.json({ deleted: deletedCount });
  } catch (error) {
    console.error("[cleanup-orphans] Execution failed:", (error as Error).message);
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
}
