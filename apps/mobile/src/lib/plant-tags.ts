// F39 Garden Walk — the two identifiers on a plant record (design contract
// docs/design/garden-walk.md, D-W3 / D-W4 / D-W13). Pure, tested.
//
// TAG — the human number or short label the user writes on a stake or an
//   aluminium disc ("7", "L3", "ROW A 12"). Whitelisted, ≤ 24, unique, typed or
//   tapped on the picker's numeric grid. Co-primary: it is what every
//   professional inventory keys on, and it needs no printer.
// CODE — any pre-printed QR sticker the user binds to a plant by scanning it.
//   The payload is untrusted physical-world input (a URL, a tracking id, a
//   broken encoder's "undefined"): it is normalized, digested with SHA-256 and
//   thrown away. Only the digest is stored, compared, or shown (4 hex chars).
//   A payload NEVER matches a human tag — "7" printed on a sticker must not
//   select stake 7 — and only exactly one owner decides (D-W3).

import { sha256Hex } from "./sha256";

export const TAG_MAX_LENGTH = 24;
export const CODE_MAX_LENGTH = 256;
export const MAX_CODES_PER_PLANT = 8;
/** Two decodes of the same digest inside this window are one scan (a double
 * tap on "Scan tag", or two frames of the same sticker). */
export const SCAN_REPEAT_WINDOW_MS = 2_500;
/** An app-generated code encodes NO meaning — just a namespace the user can
 * write on a blank or print elsewhere; it is bound like any other sticker. */
export const GENERATED_CODE_PREFIX = "CC1-";
/** 32 symbols with no 0/O/1/I, so a hand-copied code has no look-alikes. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const GENERATED_CODE_LENGTH = 6;

const TAG_RE = /^[A-Z0-9 _.#-]+$/;
/** Unicode format characters (RLO, ZWSP, BOM, …) and controls — the bytes a
 * malicious or merely broken sticker can hide in a payload. */
const FORMAT_AND_CONTROL_RE = /[\p{Cf}\p{Cc}]/gu;
const DIGEST_RE = /^[0-9a-f]{64}$/;

/** NFKC → trim → collapse whitespace → uppercase; null when empty, over 24, or
 * outside the whitelist. Accepts unknown because it also gates stored data. */
export function normalizeTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const tag = raw.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
  if (tag.length === 0 || tag.length > TAG_MAX_LENGTH || !TAG_RE.test(tag)) return null;
  return tag;
}

/** D-W13: NFKC → strip format + control characters → trim → cap 256 → reject
 * empty and the literal "null"/"undefined". The result is opaque — a URL stays
 * a string, never parsed, never opened — and exists only to be digested. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.normalize("NFKC").replace(FORMAT_AND_CONTROL_RE, "").trim();
  if (code.length === 0 || code.length > CODE_MAX_LENGTH) return null;
  const lower = code.toLowerCase();
  if (lower === "null" || lower === "undefined") return null;
  return code;
}

/** The only form a code is ever stored in. */
export function codeDigest(normalized: string): string {
  return sha256Hex(normalized);
}

/** True for the one shape `StoredPlant.codes` may hold (64 lowercase hex). */
export function isCodeDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST_RE.test(value);
}

/** What the UI shows for a code: a 4-hex handle, never the digest or payload. */
export function codeDisplay(digest: string): string {
  return `code · ${digest.slice(0, 4)}`;
}

interface CodedPlant {
  id: string;
  codes?: ReadonlyArray<string> | null;
}

interface TaggedPlant {
  tag?: string | null;
}

interface IdTaggedPlant extends TaggedPlant {
  id: string;
}

/** Every plant that holds this digest (normally 0 or 1; 2+ is a data problem
 * the UI resolves by asking). */
export function codeOwners(plants: ReadonlyArray<CodedPlant>, digest: string): string[] {
  return plants.filter((p) => Array.isArray(p.codes) && p.codes.includes(digest)).map((p) => p.id);
}

/** Exactly one owner decides; none or several → null (D-W3). */
export function plantByCode(plants: ReadonlyArray<CodedPlant>, digest: string): string | null {
  const owners = codeOwners(plants, digest);
  return owners.length === 1 ? owners[0] : null;
}

/** The one plant with this human tag (compared after normalizeTag on both
 * sides); null when none, several, or the tag is invalid. */
export function plantByTag(plants: ReadonlyArray<IdTaggedPlant>, tag: string): string | null {
  const wanted = normalizeTag(tag);
  if (wanted === null) return null;
  const matches = plants.filter((p) => normalizeTag(p.tag) === wanted).map((p) => p.id);
  return matches.length === 1 ? matches[0] : null;
}

/** True when a plant OTHER than `selfId` already holds this tag. */
export function tagConflict(plants: ReadonlyArray<IdTaggedPlant>, tag: string, selfId?: string): boolean {
  const wanted = normalizeTag(tag);
  if (wanted === null) return false;
  return plants.some((p) => p.id !== selfId && normalizeTag(p.tag) === wanted);
}

/** The smallest unused positive integer, as a string — what a pre-numbered
 * aluminium tag pack hands out next. Non-numeric tags do not count. */
export function suggestNextTag(plants: ReadonlyArray<TaggedPlant>): string {
  const used = new Set<number>();
  for (const p of plants) {
    if (typeof p.tag === "string" && /^\d+$/.test(p.tag.trim())) {
      const n = Number(p.tag);
      if (n > 0 && Number.isSafeInteger(n)) used.add(n);
    }
  }
  let next = 1;
  while (used.has(next)) next++;
  return String(next);
}

/** "CC1-" + 6 symbols from CODE_ALPHABET. `random` is injected ([0, 1)) so the
 * output is testable; a value outside the range is clamped, never a hole. */
export function generatePlantCode(random: () => number): string {
  let out = GENERATED_CODE_PREFIX;
  for (let i = 0; i < GENERATED_CODE_LENGTH; i++) {
    const r = random();
    const idx = Math.floor((Number.isFinite(r) ? r : 0) * CODE_ALPHABET.length);
    out += CODE_ALPHABET[Math.min(CODE_ALPHABET.length - 1, Math.max(0, idx))];
  }
  return out;
}

export interface ScanState {
  /** The previous scan's digest and clock, for the repeat window. */
  lastDigest: string | null;
  lastAtMs: number;
  nowMs: number;
  /** Digests the user answered "Not now" to this session — the bind prompt
   * stays quiet for them, but a code that has since been bound still binds. */
  dismissed: ReadonlySet<string>;
}

export type ScanInterpretation =
  | { kind: "ignored"; reason: "repeat" | "invalid" | "no-plants" | "dismissed" }
  | { kind: "bound"; plantId: string; digest: string }
  | { kind: "ambiguous"; digest: string; plantIds: string[] }
  | { kind: "unknown"; digest: string; display: string };

/** What one decoded payload means for the viewfinder. The payload itself never
 * leaves this function: every branch carries at most its digest. A bound code
 * always names its owner — switching the chip to that plant is the caller's
 * job (D-W3: the viewfinder never asks to move a code; that lives on the Tags
 * card). Plants' human tags are never consulted. */
export function interpretScan(
  plants: ReadonlyArray<CodedPlant>,
  payload: unknown,
  state: ScanState,
): ScanInterpretation {
  const normalized = normalizeCode(payload);
  if (normalized === null) return { kind: "ignored", reason: "invalid" };
  if (plants.length === 0) return { kind: "ignored", reason: "no-plants" };
  const digest = codeDigest(normalized);
  if (state.lastDigest === digest && state.nowMs - state.lastAtMs <= SCAN_REPEAT_WINDOW_MS) {
    return { kind: "ignored", reason: "repeat" };
  }
  const owners = codeOwners(plants, digest);
  if (owners.length === 1) return { kind: "bound", plantId: owners[0], digest };
  if (state.dismissed.has(digest)) return { kind: "ignored", reason: "dismissed" };
  if (owners.length > 1) return { kind: "ambiguous", digest, plantIds: owners };
  return { kind: "unknown", digest, display: codeDisplay(digest) };
}

/** Sort comparator for the picker's tag grid: numeric-aware ("L2" < "L10",
 * "9" < "10"), untagged plants last. */
export function numericTagOrder(a: TaggedPlant, b: TaggedPlant): number {
  const ta = typeof a.tag === "string" ? a.tag : null;
  const tb = typeof b.tag === "string" ? b.tag : null;
  if (ta === null && tb === null) return 0;
  if (ta === null) return 1;
  if (tb === null) return -1;
  return ta.localeCompare(tb, undefined, { numeric: true, sensitivity: "base" });
}
