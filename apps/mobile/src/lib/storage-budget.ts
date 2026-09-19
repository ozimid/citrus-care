// D-W17: the phone's record store has a hard edge. Android's AsyncStorage is
// one SQLite database that defaults to 6 MB, every store here is a whole-blob
// JSON rewrite, and a walk adds dozens of assessments in one sitting — so a
// batch that would cross the line must be refused BEFORE the model spends
// minutes on it, and the two budgets (records vs photo files) must be visible
// on Profile instead of failing silently mid-run. Pure; the measuring is
// storage-budget-io.ts.

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

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

/** "0 MB" / "411 MB" / "1.3 GB" — binary units, labelled the way phones do.
 * Sibling of local-engine's formatGigabytes (which trims the trailing ".0"
 * for the setup card); fold the two into one once a copy change is allowed. */
export function formatStorageSize(bytes: number): string {
  const b = safeBytes(bytes);
  if (b === 0) return "0 MB";
  if (b >= GiB) return `${(b / GiB).toFixed(1)} GB`;
  return `${Math.floor(b / MiB)} MB`;
}

/** The Profile → Your data line: records against their cap, photos as-is. */
export function storageSummary(recordBytes: number, photoBytes: number): string {
  const limitMb = Math.round(ASYNC_STORAGE_LIMIT_BYTES / MiB);
  return `Records: ${(safeBytes(recordBytes) / MiB).toFixed(1)} of ${limitMb} MB · Photos: ${formatStorageSize(photoBytes)}`;
}
