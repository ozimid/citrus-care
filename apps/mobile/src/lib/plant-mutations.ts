// Edit-plant payload building (pure/tested). D-17: the update write and the
// delete cascade are thin AsyncStorage orchestration in plants-io.ts; this
// module only maps a validated form to the fields an update touches — and,
// since F39 Phase 3b, decides where a plant lands in a zone's walk order.

import type { NewPlantInput } from "@citrus/shared";
import { getPlant, isWalkOrder, type PlantStore, type StoredPlant } from "./plant-store";
import { normalizeTag } from "./plant-tags";

export const GENERIC_UPDATE_PLANT_ERROR = "Could not save the changes. Please try again.";
export const GENERIC_DELETE_PLANT_ERROR = "Could not delete the plant. Please try again.";

/** The always-written fields: null for every absent optional. */
function editableFields(data: NewPlantInput) {
  return {
    name: data.name,
    plant_type: data.plant_type,
    species: data.species ?? null,
    cultivar: data.cultivar ?? null,
    location: data.location ?? null,
    zip_code: data.zip_code ?? null,
  };
}

/** The editable fields of a plant: null for every absent optional. Never
 * touches id / created_at / care_profile / cover — nor codes / tag_photo /
 * tag_missing, which change only from the plant's Tags card (D-W4) — nor
 * walk_order, which changes only through placeInZone / applyWalkOrders.
 *
 * F39: `tag` (and, Phase 3b, `zone`) is included only when the input carries
 * the field — normalized when set, null to clear. An input without it leaves
 * the stored value alone, so a caller editing just the name can never wipe a
 * stake number or move a tree out of its row. */
export function buildPlantUpdateRow(data: NewPlantInput) {
  return {
    ...editableFields(data),
    ...(data.tag !== undefined ? { tag: normalizeTag(data.tag) } : {}),
    ...(data.zone !== undefined ? { zone: normalizeTag(data.zone) } : {}),
  };
}

// F39 Phase 3b — walk-order placement. A position belongs to a zone, so a
// plant that enters a zone takes the LAST position there (it has no natural
// place yet; one ▲ tap on the Zones sheet moves it), a plant that leaves every
// zone has no position, and a plant whose zone is unchanged keeps its place.

/** Highest walk order in `zone` + 1 (1 for an empty or unordered zone). The
 * plant being placed is skipped by id so a stale copy of it in the list can
 * never count against itself. */
function nextWalkOrder(plants: ReadonlyArray<StoredPlant>, zone: string, excludeId: string): number {
  let max = 0;
  for (const plant of plants) {
    if (plant.id === excludeId || (plant.zone ?? null) !== zone) continue;
    if (isWalkOrder(plant.walk_order) && plant.walk_order > max) max = plant.walk_order;
  }
  return max + 1;
}

/** Set a plant's zone. Unchanged zone → the same plant (same reference, so a
 * caller can skip the write); a new zone → placed last in it; null → unzoned
 * and unplaced. Never mutates. */
export function placeInZone(plants: ReadonlyArray<StoredPlant>, plant: StoredPlant, zone: string | null): StoredPlant {
  if ((plant.zone ?? null) === zone) return plant;
  if (zone === null) return { ...plant, zone: null, walk_order: null };
  return { ...plant, zone, walk_order: nextWalkOrder(plants, zone, plant.id) };
}

/** A freshly built plant (buildStoredPlant sets the zone but no walk_order)
 * takes the last position in its zone; an unzoned one is left as built. */
export function placeNewPlant(plants: ReadonlyArray<StoredPlant>, plant: StoredPlant): StoredPlant {
  const zone = plant.zone ?? null;
  return zone === null ? plant : { ...plant, walk_order: nextWalkOrder(plants, zone, plant.id) };
}

/** The edit sheet's save: the stored plant with the editable fields applied.
 * A zone change re-places the plant (last in the new zone); an input without
 * a zone field keeps zone and position. null when the plant is gone. */
export function applyPlantUpdate(store: PlantStore, plantId: string, data: NewPlantInput): StoredPlant | null {
  const plant = getPlant(store, plantId);
  if (!plant) return null;
  // One owner of the field mapping; the zone is applied through placement,
  // never spread, so a zone change always re-places the plant.
  const { zone, ...row } = buildPlantUpdateRow(data);
  const next: StoredPlant = { ...plant, ...row };
  if (data.zone === undefined) return next;
  return placeInZone(Object.values(store), next, zone ?? null);
}

/** Backup import: an incoming plant with a NEW id that claims a (zone, order)
 * a local plant already holds is unplaced (null — sorts last, by name) before
 * the merge. Without this the parser's duplicate-order repair, which trusts
 * created_at, could keep the imported plant and null the LOCAL one — an import
 * overwriting local data by a side door. Plants whose id exists locally are
 * left alone (the merge keeps the local copy). Never mutates; the same store
 * back when nothing collides. */
export function reconcileImportedWalkOrders(current: PlantStore, incoming: PlantStore): PlantStore {
  const taken = new Set<string>();
  for (const plant of Object.values(current)) {
    if (isWalkOrder(plant.walk_order)) taken.add(JSON.stringify([plant.zone ?? null, plant.walk_order]));
  }
  let next = incoming;
  for (const [id, plant] of Object.entries(incoming)) {
    if (id in current || !isWalkOrder(plant.walk_order)) continue;
    if (taken.has(JSON.stringify([plant.zone ?? null, plant.walk_order]))) {
      next = { ...next, [id]: { ...plant, walk_order: null } };
    }
  }
  return next;
}

/** The Zones sheet's ▲ ▼: write the renumbered positions reorderWalk produced.
 * Unknown ids and anything but a positive integer are skipped, so a stale
 * sheet can never invent a plant or a position the parser would repair away.
 * Never mutates. */
export function applyWalkOrders(
  store: PlantStore,
  updates: ReadonlyArray<{ id: string; walkOrder: number }>,
): PlantStore {
  let next = store;
  for (const { id, walkOrder } of updates) {
    const plant = getPlant(next, id);
    if (!plant || !isWalkOrder(walkOrder)) continue;
    next = { ...next, [id]: { ...plant, walk_order: walkOrder } };
  }
  return next;
}
