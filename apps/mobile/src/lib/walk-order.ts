// F39 Phase 3b — zones + a stored walk order (design contract
// docs/design/garden-walk.md §4; research docs/research/plant-tagging-garden-walk.md
// §4). Pure, tested.
//
// The one rule: a walk order RANKS, it never COMMITS. These helpers answer
// "which plant is first / next / previous in this zone" and how the Plants
// list is grouped and sorted. Nothing here assigns a photo to a plant — the
// viewfinder's chip moves only on an explicit Next / Prev tap (evidence
// "user"), never after a shot — so nothing here can misattribute one. A
// skipped tree costs one more tap; a silent auto-advance would shift every
// later photo onto the wrong tree.

/** The fields the walk needs from a plant (PlantListItem carries them). */
export interface WalkPlant {
  id: string;
  zone?: string | null;
  walkOrder?: number | null;
  name: string;
}

/** "Add several plants" cap — one bulk entry is a row, not a whole orchard. */
export const MAX_BULK_PLANTS = 50;

function zoneOf(item: { zone?: string | null }): string | null {
  return typeof item.zone === "string" && item.zone.length > 0 ? item.zone : null;
}

function orderOf(item: { walkOrder?: number | null }): number | null {
  const order = item.walkOrder;
  return typeof order === "number" && Number.isSafeInteger(order) && order > 0 ? order : null;
}

/** Numeric-aware ("ROW 2" < "ROW 10"), case-insensitive — the same ordering
 * the picker's tag grid uses (numericTagOrder), because zones read like tags. */
function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** Zones alphabetical (numeric-aware); the unzoned group (null) last. */
export function compareZones(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareText(a, b);
}

/** Within a zone: walk order ascending, unplaced plants (null) last, then name. */
export function compareWalkPosition(
  a: { walkOrder?: number | null; name: string },
  b: { walkOrder?: number | null; name: string },
): number {
  const oa = orderOf(a);
  const ob = orderOf(b);
  if (oa !== ob) {
    if (oa === null) return 1;
    if (ob === null) return -1;
    return oa - ob;
  }
  return compareText(a.name, b.name);
}

/** The Plants list's sections: one per zone in zone order, each in walk order;
 * plants without a zone form the last section (zone null) — present only when
 * there are any. Never mutates the input. */
export function groupByZone<T extends { zone?: string | null; walkOrder?: number | null; name: string }>(
  items: T[],
): { zone: string | null; items: T[] }[] {
  const byZone = new Map<string | null, T[]>();
  for (const item of items) {
    const zone = zoneOf(item);
    const list = byZone.get(zone) ?? [];
    list.push(item);
    byZone.set(zone, list);
  }
  return [...byZone.entries()]
    .sort(([a], [b]) => compareZones(a, b))
    .map(([zone, list]) => ({ zone, items: [...list].sort(compareWalkPosition) }));
}

function stepInWalk(items: ReadonlyArray<WalkPlant>, currentId: string | null, step: 1 | -1): string | null {
  if (items.length === 0) return null;
  const groups = groupByZone([...items]);
  const current = currentId === null ? undefined : items.find((item) => item.id === currentId);
  // Nothing in focus (or the plant is gone): start at the top of the walk.
  if (!current) return groups[0].items[0].id;
  const group = groups.find((g) => g.zone === zoneOf(current)) ?? groups[0];
  const index = group.items.findIndex((item) => item.id === current.id);
  const n = group.items.length;
  return group.items[(index + step + n) % n].id;
}

/** The plant after `currentId` within its zone's walk order, wrapping at the
 * end. null → the first plant of the first zone; unknown id → the same. Null
 * only when there are no plants. Answers the question; the caller's tap is
 * what moves the chip. */
export function nextInWalk(items: ReadonlyArray<WalkPlant>, currentId: string | null): string | null {
  return stepInWalk(items, currentId, 1);
}

/** The plant before `currentId` within its zone, wrapping at the start. */
export function prevInWalk(items: ReadonlyArray<WalkPlant>, currentId: string | null): string | null {
  return stepInWalk(items, currentId, -1);
}

/** "Needs a check" order: never-assessed plants first (by name), then the
 * oldest assessment first, then name. ISO timestamps compare as strings, the
 * same way the stores order them. Returns a new array. */
export function sortByStaleness<T extends { lastAssessedAt: string | null; name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.lastAssessedAt === null || b.lastAssessedAt === null) {
      if (a.lastAssessedAt === b.lastAssessedAt) return compareText(a.name, b.name);
      return a.lastAssessedAt === null ? -1 : 1;
    }
    if (a.lastAssessedAt !== b.lastAssessedAt) return a.lastAssessedAt < b.lastAssessedAt ? -1 : 1;
    return compareText(a.name, b.name);
  });
}

/** "Add several plants": expand a name pattern into `count` fresh names.
 * `{n}` is the counter ("A-{n}"); a plain prefix means "<prefix>-{n}"; an empty
 * pattern means "Plant {n}". Numbers are zero-padded to the width of `count`
 * so the names sort in walk order by themselves ("A-01" … "A-30"). Names the
 * garden already has (case-insensitive) are skipped and the counter moves on,
 * so the caller still gets `count` new plants. Count is capped at 50. */
export function bulkPlantDrafts(pattern: string, count: number, existingNames: ReadonlySet<string>): string[] {
  const n = Number.isFinite(count) ? Math.min(Math.floor(count), MAX_BULK_PLANTS) : 0;
  if (n <= 0) return [];
  const trimmed = pattern.trim();
  const template = trimmed.length === 0 ? "Plant {n}" : trimmed.includes("{n}") ? trimmed : `${trimmed}-{n}`;
  const width = String(n).length;
  const taken = new Set(Array.from(existingNames, (name) => name.trim().toLowerCase()));
  const out: string[] = [];
  // Every counter value past n + |taken| is necessarily fresh, so the loop is bounded.
  const limit = n + taken.size;
  for (let i = 1; out.length < n && i <= limit; i++) {
    const name = template.split("{n}").join(String(i).padStart(width, "0"));
    const key = name.toLowerCase();
    if (taken.has(key)) continue;
    taken.add(key);
    out.push(name);
  }
  return out;
}

/** Move one plant up or down within its zone and renumber the whole zone
 * 1..n (gaps closed; unplaced plants sort last in the order given). Moving the
 * first item up or the last item down changes nothing but the numbering. The
 * result is the full list of writes for that zone, so one save fixes every
 * position at once. */
export function reorderWalk(
  items: ReadonlyArray<{ id: string; walkOrder?: number | null }>,
  id: string,
  direction: "up" | "down",
): { id: string; walkOrder: number }[] {
  const ordered = items
    .map((item, index) => ({ id: item.id, order: orderOf(item), index }))
    .sort((a, b) => {
      if (a.order === b.order) return a.index - b.index;
      if (a.order === null) return 1;
      if (b.order === null) return -1;
      return a.order - b.order;
    });
  const from = ordered.findIndex((item) => item.id === id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from >= 0 && to >= 0 && to < ordered.length) {
    [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
  }
  return ordered.map((item, i) => ({ id: item.id, walkOrder: i + 1 }));
}
