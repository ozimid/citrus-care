#!/usr/bin/env node
// One-off: verify every photo referenced by an assessment exists in GCS with a
// size matching the Supabase original. Must report clean BEFORE any cutover.
// Read-only — touches nothing.
//
//   node scripts/verify-photo-migration.mjs
//
// Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//               GCS_PHOTOS_BUCKET, GCS_SERVICE_ACCOUNT_KEY

import { createClient } from "@supabase/supabase-js";
import { Storage } from "@google-cloud/storage";

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
console.log(`Verifying ${paths.length} unique photo paths...`);

const problems = [];
for (const path of paths) {
  try {
    const [exists] = await bucket.file(path).exists();
    if (!exists) {
      problems.push(`MISSING in GCS: ${path}`);
      continue;
    }
    const [meta] = await bucket.file(path).getMetadata();
    const { data: blob } = await supabase.storage.from("photos").download(path);
    if (blob && Number(meta.size) !== blob.size) {
      problems.push(`SIZE MISMATCH: ${path} (gcs=${meta.size} supabase=${blob.size})`);
    }
  } catch (e) {
    problems.push(`ERROR: ${path} — ${e.message}`);
  }
}

if (problems.length === 0) {
  console.log(`CLEAN — all ${paths.length} photos verified in GCS. Safe to cut over.`);
  process.exit(0);
}
console.error(`\n${problems.length} problem(s):`);
for (const p of problems) console.error("  " + p);
console.error("\nDO NOT cut over until this report is clean.");
process.exit(1);
