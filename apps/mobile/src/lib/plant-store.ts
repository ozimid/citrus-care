// Local-first plant store, pure half (D-17): plants live ONLY on the phone now
// — no Supabase, no accounts. A single AsyncStorage JSON blob keyed by plant id
// (same Record pattern as photo-store), read back through a never-throwing
// parser because stored data is untrusted. The AsyncStorage wiring is the thin
// plant-store-io.ts; store-adapters.ts reshapes these into the row shapes the
// list/detail mappers already consume, so those mappers stay verbatim.

import type { CareProfile } from "@citrus/shared";
import { isSafeBasename, isSafeRecordId } from "./local-id";
import { MAX_CODES_PER_PLANT, isCodeDigest, normalizeTag } from "./plant-tags";

/** The on-device plant record: the plants columns minus user_id (there are no
 * users anymore). care_profile is carried as-is — it is re-validated by
 * parseStoredCareProfile downstream, so a malformed profile is not a malformed
 * plant. */
export interface StoredPlant {
  id: string;
  name: string;
  plant_type: string;
  species: string | null;
  cultivar: string | null;
  location: string | null;
  zip_code: string | null;
  cover_assessment_id: string | null;
  care_profile: CareProfile | null;
  created_at: string;
  // F39 Garden Walk (D-W4) — two identifiers, both optional so every plant
  // written before F39 keeps parsing byte-for-byte. Absent means "never set".
  /** The human tag written on the stake or disc: normalizeTag output, unique. */
  tag?: string | null;
  /** SHA-256 digests of bound sticker payloads (plant-tags codeDigest), ≤ 8.
   * Never the payload itself — a URL on a sticker is never stored. */
  codes?: string[];
  /** Basename (photoFileName shape) of the photo of this plant's tag, in the
   * plant's own photo directory. */
  tag_photo?: string | null;
  /** The user flagged the physical tag as lost/unreadable — shown on the card
   * and the picker until they re-tag. */
  tag_missing?: boolean;
  // F39 Phase 3b — zones + a stored walk order (research §4). A walk order
  // RANKS plants for the viewfinder's Next/Prev; it never decides where a
  // photo goes. Both optional so pre-3b records round-trip byte-for-byte.
  /** Zone / row label ("NORTH", "ROW 2"): normalizeTag output — same alphabet
   * and cap as a tag, but many plants share one. */
  zone?: string | null;
  /** Position within the zone's walk: a positive integer, unique per zone.
   * null = not placed yet (sorts last, by name). */
  walk_order?: number | null;
}

/** plantId → plant. */
export type PlantStore = Record<string, StoredPlant>;

export const PLANT_STORAGE_KEY = "citrus.plants.v1";

export function upsertPlant(store: PlantStore, plant: StoredPlant): PlantStore {
  return { ...store, [plant.id]: plant };
}

export function removePlant(store: PlantStore, plantId: string): PlantStore {
  const next: PlantStore = {};
  for (const [id, plant] of Object.entries(store)) {
    if (id !== plantId) next[id] = plant;
  }
  return next;
}

export function getPlant(store: PlantStore, plantId: string): StoredPlant | null {
  return store[plantId] ?? null;
}

/** Bind a code digest: appended once, in order. A plant already holding the
 * digest, or holding MAX_CODES_PER_PLANT of them, comes back unchanged (same
 * reference) so the caller can tell nothing was written. */
export function addPlantCode(plant: StoredPlant, digest: string): StoredPlant {
  const codes = plant.codes ?? [];
  if (codes.includes(digest) || codes.length >= MAX_CODES_PER_PLANT) return plant;
  return { ...plant, codes: [...codes, digest] };
}

export function removePlantCode(plant: StoredPlant, digest: string): StoredPlant {
  return { ...plant, codes: (plant.codes ?? []).filter((c) => c !== digest) };
}

/** Plants newest-first — the order fetchPlants used to get from Postgres. */
export function allPlants(store: PlantStore): StoredPlant[] {
  return Object.values(store).sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

/** care_profile is intentionally NOT validated here (it degrades to null in the
 * mapper): a bad profile must not discard an otherwise-valid plant. The id IS
 * gated (D-W16): it names photos/{id}/ on disk, so a stored or imported record
 * that could not have been minted here is not a plant. */
function isValidStoredPlant(value: unknown): value is StoredPlant {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    isSafeRecordId(p.id) &&
    typeof p.name === "string" &&
    typeof p.plant_type === "string" &&
    typeof p.created_at === "string" &&
    (p.species === null || typeof p.species === "string") &&
    (p.cultivar === null || typeof p.cultivar === "string") &&
    (p.location === null || typeof p.location === "string") &&
    (p.zip_code === null || typeof p.zip_code === "string") &&
    (p.cover_assessment_id === null || typeof p.cover_assessment_id === "string")
  );
}

/** Only digests survive, deduped, in order, capped — a stored code list is the
 * one place a sticker's bytes could otherwise creep back in (D-W13). */
function repairCodes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (isCodeDigest(entry) && !out.includes(entry)) out.push(entry);
    if (out.length === MAX_CODES_PER_PLANT) break;
  }
  return out;
}

/** The one shape `StoredPlant.walk_order` may hold: a positive safe integer. */
export function isWalkOrder(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** F39: the identifier fields are REPAIRED, not validated — a plant is still
 * the plant when its tag is malformed. Only fields that are present are
 * touched, so a pre-F39 record round-trips without invented keys. */
function repairIdentifiers(plant: StoredPlant): StoredPlant {
  const raw: Record<string, unknown> = { ...plant };
  const out: StoredPlant = { ...plant };
  if ("tag" in raw) out.tag = normalizeTag(raw.tag);
  if ("codes" in raw) out.codes = repairCodes(raw.codes);
  if ("tag_photo" in raw) out.tag_photo = isSafeBasename(raw.tag_photo) ? raw.tag_photo : null;
  if ("tag_missing" in raw) out.tag_missing = raw.tag_missing === true;
  // Phase 3b: a zone is a tag-shaped label; an order is a positive integer.
  if ("zone" in raw) out.zone = normalizeTag(raw.zone);
  if ("walk_order" in raw) out.walk_order = isWalkOrder(raw.walk_order) ? raw.walk_order : null;
  return out;
}

/** Oldest first, id as the tiebreak — the order the walk-order repair trusts. */
function byCreatedAtAsc(a: StoredPlant, b: StoredPlant): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Two plants in one zone cannot share a position (a hand-edited or merged
 * blob could say so): the earlier-created plant keeps it and the later one is
 * unplaced (null — sorts last, by name) until the user reorders. Absent and
 * null zones are one zone, so the unzoned list is walkable too. */
function repairWalkOrders(store: PlantStore): PlantStore {
  const seen = new Set<string>();
  let next = store;
  for (const plant of Object.values(store).filter((p) => isWalkOrder(p.walk_order)).sort(byCreatedAtAsc)) {
    const key = JSON.stringify([plant.zone ?? null, plant.walk_order]);
    if (seen.has(key)) next = { ...next, [plant.id]: { ...plant, walk_order: null } };
    else seen.add(key);
  }
  return next;
}

/** Parse the stored blob. Untrusted: malformed JSON or malformed plants degrade
 * (dropped / empty store), never throw. */
export function parsePlantStore(json: string | null): PlantStore {
  if (!json) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const store: PlantStore = {};
  for (const [id, plant] of Object.entries(raw)) {
    // A key that disagrees with its record is a hand-edited or corrupt blob;
    // keeping it would let two names reach one directory.
    if (isValidStoredPlant(plant) && plant.id === id) store[id] = repairIdentifiers(plant);
  }
  return repairWalkOrders(store);
}

export function serializePlantStore(store: PlantStore): string {
  return JSON.stringify(store);
}
