import { PRUNING_PACKS, type PruningPack, type PruningPackKey } from "@citrus/shared";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** URL slugs for the four authoritative packs — the only ones published as
 * pages. The extrapolated packs stay in-app, where their advisory framing
 * travels with them. */
const SLUGS: Partial<Record<PruningPackKey, string>> = {
  citrus: "citrus-tree",
  rose: "roses",
  flowering_shrub: "flowering-shrubs",
  tree_shrub: "trees-and-shrubs",
};

export function authoritativePacks(): PruningPack[] {
  return Object.values(PRUNING_PACKS).filter((pack) => pack.authoritative);
}

export function guideSlug(key: PruningPackKey): string {
  return SLUGS[key] ?? key;
}

export function allGuideSlugs(): string[] {
  return authoritativePacks().map((pack) => guideSlug(pack.key));
}

export function packForSlug(slug: string): PruningPack | null {
  const entry = (Object.entries(SLUGS) as Array<[PruningPackKey, string]>).find(([, s]) => s === slug);
  return entry ? PRUNING_PACKS[entry[0]] : null;
}

export function monthRange(months: number[]): string {
  const sorted = [...months].sort((a, b) => a - b);
  if (sorted.length === 0) return "—";
  const contiguous = sorted.every((m, i) => i === 0 || m === sorted[i - 1] + 1);
  return contiguous && sorted.length > 1
    ? `${MONTHS[sorted[0] - 1]}–${MONTHS[sorted[sorted.length - 1] - 1]}`
    : sorted.map((m) => MONTHS[m - 1]).join(", ");
}

export function guideSummary(pack: PruningPack): string {
  return `Best window: ${monthRange(pack.bestMonths)} (northern hemisphere) — ${pack.seasonNote}.`;
}
