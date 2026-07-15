#!/usr/bin/env node
// One-off: copy every photo referenced by an assessment from Supabase Storage
// to GCS at the IDENTICAL path (so no DB photo_path values change).
// Run manually/locally — never deployed. Old Supabase bucket is never deleted.
//
//   node scripts/migrate-photos-to-gcs.mjs
//
// Required env (e.g. `set -a; source apps/web/.env.local; set +a` first):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   GCS_PHOTOS_BUCKET, GCS_SERVICE_ACCOUNT_KEY

import { createClient } from "@supabase/supabase-js";
import { Storage } from "@google-cloud/storage";
import crypto from "node:crypto";

function env(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const supabase = createClient(
  env("NEXT_PUBLIC_SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
);
const key = JSON.parse(env("GCS_SERVICE_ACCOUNT_KEY"));
const bucket = new Storage({
  projectId: key.project_id,
  credentials: { client_email: key.client_email, private_key: key.private_key },
}).bucket(env("GCS_PHOTOS_BUCKET"));

const { data: rows, error } = await supabase.from("assessments").select("photo_path");
if (error) {
  console.error("Failed to list assessments:", error.message);
  process.exit(1);
}
const paths = [...new Set((rows ?? []).map((r) => r.photo_path).filter(Boolean))];
console.log(`${paths.length} unique photo paths to migrate`);

let ok = 0;
let skipped = 0;
let failed = 0;

for (const path of paths) {
  try {
    const gcsFile = bucket.file(path);
    const [exists] = await gcsFile.exists();

    const { data: blob, error: dlErr } = await supabase.storage
      .from("photos")
      .download(path);
    if (dlErr || !blob) {
      console.error(`  FAIL (supabase download): ${path} — ${dlErr?.message}`);
      failed++;
      continue;
    }
    const buf = Buffer.from(await blob.arrayBuffer());
    const srcHash = crypto.createHash("md5").update(buf).digest("base64");

    if (exists) {
      const [meta] = await gcsFile.getMetadata();
      if (meta.md5Hash === srcHash) {
        skipped++;
        continue; // already migrated, content identical
      }
      console.error(`  FAIL (exists with DIFFERENT content): ${path}`);
      failed++;
      continue;
    }

    await gcsFile.save(buf, {
      contentType: blob.type || "image/jpeg",
      resumable: false,
    });
    const [meta] = await gcsFile.getMetadata();
    if (meta.md5Hash !== srcHash) {
      console.error(`  FAIL (checksum mismatch after upload): ${path}`);
      failed++;
      continue;
    }
    ok++;
    console.log(`  ok: ${path} (${buf.length} bytes)`);
  } catch (e) {
    console.error(`  FAIL: ${path} — ${e.message}`);
    failed++;
  }
}

console.log(`\nDone. migrated=${ok} already-present=${skipped} failed=${failed}`);
process.exit(failed > 0 ? 1 : 0);
