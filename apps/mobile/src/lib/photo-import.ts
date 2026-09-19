// F39 Garden Walk — gallery import, pure half. Everything a stock-camera roll
// tells us about a photo is untrusted physical-world input (D-W13): the EXIF
// block passes through the whitelist below the moment the picker returns it
// and the raw object is dropped (GPS keys are never read, stored or logged);
// a file name is display text, capped, never a path segment.
//
// A photo's time is the DEVICE-LOCAL wall clock the camera wrote, built with
// the local Date constructor — never string-sliced into a fake "Z" instant —
// unless the camera also wrote its UTC offset, in which case that offset is
// the truth. Unknown stays null: a gallery photo never gets a fake "now".
// The picker, file moves and per-asset persistence are in photo-queue-io.ts.

import { assignedPhoto, isDecidingEvidence, type QueuedPhoto } from "./photo-queue";

/** The five EXIF fields this app reads. Nothing else survives the pick. */
export interface ExifDates {
  original?: string;
  subsec?: string;
  offset?: string;
  digitized?: string;
  dateTime?: string;
}

const EXIF_DATE_KEYS: ReadonlyArray<[keyof ExifDates, string]> = [
  ["original", "DateTimeOriginal"],
  ["subsec", "SubSecTimeOriginal"],
  ["offset", "OffsetTimeOriginal"],
  ["digitized", "DateTimeDigitized"],
  ["dateTime", "DateTime"],
];

/** Whitelist. Applied immediately by the io; the raw EXIF object is then gone. */
export function pickExifDates(exif: unknown): ExifDates {
  if (typeof exif !== "object" || exif === null || Array.isArray(exif)) return {};
  const source = exif as Record<string, unknown>;
  const dates: ExifDates = {};
  for (const [field, key] of EXIF_DATE_KEYS) {
    const value = source[key];
    if (typeof value === "string") dates[field] = value;
  }
  return dates;
}

const EXIF_DATETIME_RE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const EXIF_OFFSET_RE = /^[+-]\d{2}:\d{2}$/;

/** SubSecTime is the digits AFTER the decimal point ("42" → 0.42 s). */
function subsecMs(subsec: unknown): number {
  const digits = typeof subsec === "string" ? /^\d{1,3}/.exec(subsec)?.[0] : undefined;
  return digits ? Number(digits.padEnd(3, "0")) : 0;
}

/** EXIF "YYYY:MM:DD HH:MM:SS" → ISO instant, or null. Anchored: anything that
 * is not exactly that shape, the all-zero date some cameras write, or a field
 * out of range is refused rather than guessed at. */
export function parseExifDateTime(value: unknown, subsec?: unknown, offset?: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = EXIF_DATETIME_RE.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  if (y === 0 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const ms = subsecMs(subsec);
  const date =
    typeof offset === "string" && EXIF_OFFSET_RE.test(offset)
      ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${String(ms).padStart(3, "0")}${offset}`)
      : new Date(y, mo - 1, d, h, mi, s, ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** D-W13: a file name is never a path; only this much is ever looked at. */
const MAX_FILE_NAME = 80;
/** IMG_20260919_101533.jpg, PXL_20260919-101533.MP.jpg, 20260919_101533.jpg. */
const FILE_NAME_DATE_RE = /(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/;

/** The chain: DateTimeOriginal (+ sub-second, + offset) › DateTimeDigitized ›
 * DateTime › a stock-camera file name (local wall clock) › null. */
export function takenAtFromAsset(asset: { exif?: unknown; fileName?: string | null }): string | null {
  const dates = pickExifDates(asset.exif);
  const fromExif =
    parseExifDateTime(dates.original, dates.subsec, dates.offset) ??
    parseExifDateTime(dates.digitized) ??
    parseExifDateTime(dates.dateTime);
  if (fromExif) return fromExif;
  if (typeof asset.fileName !== "string") return null;
  const m = FILE_NAME_DATE_RE.exec(asset.fileName.slice(0, MAX_FILE_NAME));
  return m ? parseExifDateTime(`${m[1]}:${m[2]}:${m[3]} ${m[4]}:${m[5]}:${m[6]}`) : null;
}

/** Known shooting times first, ascending (stable); photos with no known time
 * follow in the order the user picked them. The input is not mutated. */
export function orderImportedPhotos<T extends { takenAt: string | null; fileName?: string | null }>(items: T[]): T[] {
  const known = items
    .filter((item) => item.takenAt !== null)
    .sort((a, b) => (a.takenAt! < b.takenAt! ? -1 : a.takenAt! > b.takenAt! ? 1 : 0));
  return [...known, ...items.filter((item) => item.takenAt === null)];
}

/** Rung 1b (D-W3): "Assign this photo — and the ones after it, until the next
 * one I assign". `items` is the display order. The tapped photo takes `user`;
 * with the run on, the following photos that were unassigned, suggested or
 * only weakly assigned take `user-run`, stopping at the next photo that
 * carries deciding evidence of its own. Unknown start id → unchanged. */
export function applyPlantToRun(items: QueuedPhoto[], startId: string, plantId: string, untilNextExplicit: boolean): QueuedPhoto[] {
  const start = items.findIndex((item) => item.id === startId);
  if (start < 0) return items;
  let end = items.length;
  if (untilNextExplicit) {
    const next = items.findIndex((item, index) => index > start && isDecidingEvidence(item.evidence));
    if (next >= 0) end = next;
  } else {
    end = start + 1;
  }
  return items.map((item, index) => {
    if (index === start) return assignedPhoto(item, plantId, "user");
    if (index > start && index < end) return assignedPhoto(item, plantId, "user-run");
    return item;
  });
}

/** "12 photos · 10 assigned · 2 need a plant · 1 couldn't be imported" — empty
 * parts are left out, the total is always said. */
export function importSummary(c: { total: number; assigned: number; needsPlant: number; failed: number }): string {
  const parts = [`${c.total} ${c.total === 1 ? "photo" : "photos"}`];
  if (c.assigned > 0) parts.push(`${c.assigned} assigned`);
  if (c.needsPlant > 0) parts.push(`${c.needsPlant} ${c.needsPlant === 1 ? "needs" : "need"} a plant`);
  if (c.failed > 0) parts.push(`${c.failed} couldn't be imported`);
  return parts.join(" · ");
}
