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
//
// Import-side identification (D-W3 rungs 1c / 3 / 5): a QR hit on an imported
// photo is a tag card (classifyScan), a card or a user-marked tree marker hands
// its plant to the photos after it (assignByMarkers), and a marker token the
// user typed into a file name decides while a bare tag only suggests
// (fileTagToken). A payload matches bound codes only — never a human tag.
// The picker, file moves and per-asset persistence are in photo-queue-io.ts.

import { assignedPhoto, isDecidingEvidence, type AssignEvidence, type QueuedPhoto } from "./photo-queue";
import { codeDigest, codeOwners, normalizeCode, normalizeTag } from "./plant-tags";

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

/** Rung 3 (D-W3, D-W15): what a QR payload decoded from an imported photo
 * means. At 800 px only a sticker close-up decodes, so a hit is a TAG CARD by
 * default (the review row has a "Plant photo" toggle). Every branch carries
 * the digest only — the payload never leaves classifyScan (D-W13). */
export type ImportScan =
  | { role: "tag-card"; plantId: string; digest: string }
  | { role: "unknown-code"; digest: string }
  | { role: "ambiguous"; digest: string; plantIds: string[] }
  | null;

/** No payload, or one that normalizes to nothing → null (no code). Exactly one
 * owner decides; several is a data problem the review resolves by asking; none
 * is a sticker nobody has bound yet. Human tags are never consulted. */
export function classifyScan(
  payload: string | null,
  plants: ReadonlyArray<{ id: string; codes?: ReadonlyArray<string> | null }>,
): ImportScan {
  const normalized = normalizeCode(payload);
  if (normalized === null) return null;
  const digest = codeDigest(normalized);
  const owners = codeOwners(plants, digest);
  if (owners.length === 1) return { role: "tag-card", plantId: owners[0], digest };
  if (owners.length > 1) return { role: "ambiguous", digest, plantIds: owners };
  return { role: "unknown-code", digest };
}

/** Evidence that ends a marker run: a decision made on that photo itself —
 * the user's tap, run or scan, or a marker token the user typed into the file
 * name (`file-tag` is only ever set for the deciding form, rung 5). A
 * marker/tag-card badge is a propagation result and is recomputed instead. */
const EXPLICIT: ReadonlyArray<AssignEvidence> = ["user", "user-run", "code-scan", "file-tag"];

/** Rungs 1c / 3 (D-W3): `items` is the display order; `markers` maps the id
 * of each tag card or user-marked marker photo to its plant. From a marker
 * on, every following photo that is unassigned, suggested or only weakly
 * assigned (group / carried / an earlier marker pass) takes that
 * plant — `tag-card` when the marker carries a code digest, `marker` when the
 * user marked it — until the next marker, the next explicit item, or a
 * sticker nobody has bound yet (a code digest with no marker entry: the next
 * tree's card, plant unknown — chaining past it would hand its photos to the
 * previous tree). Photos before the first marker, the markers themselves and
 * every stop are returned as the same objects. Never backwards. */
export function assignByMarkers(items: QueuedPhoto[], markers: Record<string, string>): QueuedPhoto[] {
  let current: { plantId: string; evidence: AssignEvidence } | null = null;
  return items.map((item) => {
    const markerPlant = markers[item.id];
    if (typeof markerPlant === "string") {
      current = { plantId: markerPlant, evidence: item.codeDigest !== null ? "tag-card" : "marker" };
      return item;
    }
    if (item.isMarker || item.codeDigest !== null || EXPLICIT.includes(item.evidence)) {
      current = null;
      return item;
    }
    return current === null ? item : assignedPhoto(item, current.plantId, current.evidence);
  });
}

/** The number the "Use as tree marker" confirm states: how many photos of
 * `walk` (ONE walk, in display order — never a filtered view, because the
 * io applies the marker walk-wide) marking `markerId` for `plantId` would
 * move. The same pure pass the io runs, counted; the marker itself is not
 * counted, and the input is not mutated. Unknown id → 0. */
export function markerRunSize(walk: QueuedPhoto[], markerId: string, plantId: string): number {
  if (!walk.some((i) => i.id === markerId)) return 0;
  const marked = walk.map((i) => (i.id === markerId ? { ...i, isMarker: true as const, plantId, evidence: "marker" as const } : i));
  const markers: Record<string, string> = {};
  for (const i of marked) if (i.isMarker && i.plantId !== null) markers[i.id] = i.plantId;
  // Counted on plant or evidence, not object identity: a same-plant photo an
  // earlier card already handed on is re-created by the pass but not moved.
  return assignByMarkers(marked, markers).filter(
    (after, index) =>
      after.id !== markerId && (after.plantId !== marked[index].plantId || after.evidence !== marked[index].evidence),
  ).length;
}

/** Tokens: the capped basename without its extension, split here. */
const TOKEN_SPLIT_RE = /[^A-Za-z0-9#-]+/;
const EXTENSION_RE = /\.[A-Za-z0-9]{1,5}$/;
/** The marker forms the user types on purpose: "#L3", "TAG-L3", "T-L3". */
const MARKER_PREFIX_RE = /^(#|TAG-|T-)/i;
/** What stock cameras, messengers and file formats write into a name — never
 * a tag, whatever a plant happens to be tagged. */
const CAMERA_TOKENS: ReadonlySet<string> = new Set([
  "IMG", "PXL", "DSC", "DSCN", "DSCF", "DCIM", "MVIMG", "PANO", "PORTRAIT", "NIGHT", "MP", "RAW", "HDR", "BURST",
  "PHOTO", "IMAGE", "PICTURE", "SCREENSHOT", "SIGNAL", "WA", "WHATSAPP", "TELEGRAM", "COPY", "EDIT", "EDITED", "ORIGINAL", "TAG",
  "JPG", "JPEG", "PNG", "HEIC", "HEIF", "WEBP", "DNG", "GIF", "BMP", "TIF", "TIFF",
]);

type TagHit = { plantId: string; decides: boolean } | "ambiguous" | null;

function tagHit(byTag: ReadonlyMap<string, string[]>, tag: string | null, decides: boolean): TagHit {
  const owners = tag === null ? undefined : byTag.get(tag);
  if (!owners) return null;
  return owners.length === 1 ? { plantId: owners[0], decides } : "ambiguous";
}

/** Rung 5 (D-W3, D-W13): a tag the user typed into the file name. A marker
 * form ("#L3", "TAG-L3", "T-L3") equal to a plant's tag DECIDES; a bare token
 * equal to a tag that has a letter and at least two characters only SUGGESTS.
 * Bare digits never match a numeric tag ("7.jpg" is any photo), stock camera
 * names match nothing, and a tag two plants share — or two tokens naming two
 * plants — is null. Only the capped basename is ever looked at. */
export function fileTagToken(
  fileName: string | null | undefined,
  plants: ReadonlyArray<{ id: string; tag?: string | null }>,
): { plantId: string; decides: boolean } | null {
  if (typeof fileName !== "string" || plants.length === 0) return null;
  const byTag = new Map<string, string[]>();
  for (const plant of plants) {
    const tag = normalizeTag(plant.tag);
    if (tag !== null) byTag.set(tag, [...(byTag.get(tag) ?? []), plant.id]);
  }
  const capped = fileName.slice(0, MAX_FILE_NAME);
  const base = capped.slice(capped.lastIndexOf("/") + 1).replace(EXTENSION_RE, "");
  let plantId: string | null = null;
  let decides = false;
  for (const token of base.split(TOKEN_SPLIT_RE)) {
    const upper = token.toUpperCase();
    if (upper.length === 0 || CAMERA_TOKENS.has(upper)) continue;
    const marker = MARKER_PREFIX_RE.exec(token);
    const hits: TagHit[] = [
      marker ? tagHit(byTag, normalizeTag(token.slice(marker[0].length)), true) : null,
      upper.length >= 2 && /[A-Z]/.test(upper) ? tagHit(byTag, normalizeTag(token), false) : null,
    ];
    for (const hit of hits) {
      if (hit === null) continue;
      if (hit === "ambiguous" || (plantId !== null && plantId !== hit.plantId)) return null;
      plantId = hit.plantId;
      decides = decides || hit.decides;
    }
  }
  return plantId === null ? null : { plantId, decides };
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
