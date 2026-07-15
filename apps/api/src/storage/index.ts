import { SupabaseStorage } from "./supabase";
import { GcsStorage } from "./gcs";

export type StoredObject = { name: string; createdAt: string | null };

/**
 * Photo storage abstraction. All photo I/O in apps/api flows through this
 * interface; the concrete backend is chosen at runtime by env (see getStorage).
 * Callers are responsible for the ownership check on every path — neither
 * backend enforces per-object access control.
 */
export interface PhotoStorage {
  /** Signed URL the client PUTs the raw bytes to (short TTL). */
  getUploadUrl(path: string, contentType: string): Promise<string>;
  /** Signed URL the client GETs the object from, valid for expirySec seconds. */
  getReadUrl(path: string, expirySec: number): Promise<string>;
  /** Download the object bytes (used server-side to feed Gemini). */
  download(path: string): Promise<Buffer>;
  /** Delete every object under a prefix (or a single object by full path). */
  deletePrefix(prefix: string): Promise<void>;
  /** Flat list of every object in the bucket, with creation timestamps. */
  listAll(): Promise<StoredObject[]>;
}

export { SupabaseStorage } from "./supabase";
export { GcsStorage } from "./gcs";

let cached: { gcs: boolean; impl: PhotoStorage } | null = null;

/**
 * Return the active storage backend. GCS the moment `GCS_PHOTOS_BUCKET` is set,
 * otherwise Supabase Storage (today's behavior). The switch is env-only — no
 * code change is needed to flip once the GCS bucket + service-account key exist.
 * The instance is cached; it is re-selected only if the env flag changes (keeps
 * tests that toggle env honest without leaking one backend into the other).
 */
export function getStorage(): PhotoStorage {
  const gcs = !!process.env.GCS_PHOTOS_BUCKET;
  if (cached && cached.gcs === gcs) return cached.impl;
  const impl = gcs ? new GcsStorage() : new SupabaseStorage();
  cached = { gcs, impl };
  return impl;
}
