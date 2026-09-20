// D-W17: the phone's record store has a hard edge. Android's AsyncStorage is
// one SQLite database that defaults to 6 MB, every store here is a whole-blob
// JSON rewrite, and a walk adds dozens of assessments in one sitting — so a
// batch that would cross the line must be refused BEFORE the model spends
// minutes on it, and the two budgets (records vs photo files) must be visible
// on Profile instead of failing silently mid-run. Pure; the measuring is
// storage-budget-io.ts.

import { formatModelBytes } from "./model-catalogue";

const MiB = 1024 * 1024;

/** Android AsyncStorage default database size (`AsyncStorage_db_size_in_MB`). */
export const ASYNC_STORAGE_LIMIT_BYTES = 6 * MiB;
/** Refuse new work above this — headroom for the rewrite of a growing blob. */
export const ASYNC_STORAGE_SOFT_LIMIT_BYTES = 5 * MiB;
/** Generous per-assessment estimate (measured 1.5–4 KB) for projecting a batch. */
export const ASSESSMENT_BYTES_ESTIMATE = 4 * 1024;

const RECORDS_FULL_REASON =
  "This phone's plant records are nearly full. Export a backup and remove old plants before analyzing more photos.";

/** Would `itemCount` more assessments push the records past the soft limit?
 * The reason is a complete, user-safe sentence — shown verbatim. */
export function canRunBatch(
  recordBytes: number,
  itemCount: number,
): { ok: true } | { ok: false; reason: string } {
  const projected = recordBytes + itemCount * ASSESSMENT_BYTES_ESTIMATE;
  if (projected > ASYNC_STORAGE_SOFT_LIMIT_BYTES) return { ok: false, reason: RECORDS_FULL_REASON };
  return { ok: true };
}

/** A bad measurement (negative, NaN, Infinity) reads as nothing, never as junk. */
function safeBytes(bytes: number): number {
  return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}

/** The Profile → Your data line: records against their cap, photos as-is.
 *
 * ONE size convention for space on the phone (F40): the photo total goes
 * through the catalogue's decimal formatModelBytes, the same formatter every
 * model size and the free-space check use, and the same units Android's
 * Storage screen counts in. This file used to carry its own BINARY formatter,
 * so the identical byte count read ~7% smaller here than in the model sizes
 * two cards above it.
 *
 * The records figure stays binary deliberately: it is a ratio against
 * Android's own AsyncStorage cap (`AsyncStorage_db_size_in_MB`, which the
 * platform counts in MiB), not a number the user compares with the Storage
 * screen — both sides of "1.2 of 6 MB" are in that same platform unit. */
export function storageSummary(recordBytes: number, photoBytes: number): string {
  const limitMb = Math.round(ASYNC_STORAGE_LIMIT_BYTES / MiB);
  return `Records: ${(safeBytes(recordBytes) / MiB).toFixed(1)} of ${limitMb} MB · Photos: ${formatModelBytes(safeBytes(photoBytes))}`;
}
