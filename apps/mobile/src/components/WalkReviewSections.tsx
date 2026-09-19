// The review screen's list (F39 / D-W3): sections grouped by decision state
// then plant, and thumbnail-only tile rows. The sheets and footer are
// WalkReviewChrome.tsx. No store logic lives here — the queue math is
// photo-queue.ts.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { bandColor } from "../lib/health";
import { importSummary } from "../lib/photo-import";
import { runnableItems, type PhotoQueue, type QueuedPhoto } from "../lib/photo-queue";
import { loadPhotoQueue, queuedPhotoUri } from "../lib/photo-queue-io";
import type { PlantListItem } from "../lib/plants";
import { fetchPlants } from "../lib/plants-io";
import { canRunBatch } from "../lib/storage-budget";
import { measureRecordBytes } from "../lib/storage-budget-io";
import { RADIUS, type Tokens } from "../lib/theme";

const GENERIC_LOAD_ERROR = "Couldn't load your photos. Close and try again.";

export const TILE_COLUMNS = 3;

export interface WalkSection {
  key: string;
  /** Null = the amber "Needs a plant" section. */
  plantId: string | null;
  /** The plant's name for screen readers; null for the unassigned section. */
  plantName: string | null;
  title: string;
  items: QueuedPhoto[];
  /** `items` chunked into rows of TILE_COLUMNS for the SectionList. */
  data: QueuedPhoto[][];
}

/** The walk's own order: shooting time (unknown last), then arrival, then id —
 * so two same-second shots never swap between reloads. */
export function byWalkOrder(a: QueuedPhoto, b: QueuedPhoto): number {
  if (a.takenAt !== b.takenAt) {
    if (a.takenAt === null) return 1;
    if (b.takenAt === null) return -1;
    return a.takenAt < b.takenAt ? -1 : 1;
  }
  if (a.addedAt !== b.addedAt) return a.addedAt < b.addedAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function chunk<T>(list: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < list.length; i += size) rows.push(list.slice(i, i + size));
  return rows;
}

/** "Needs a plant (N)" first, then one section per assigned plant in name
 * order. A plant the store no longer knows is named honestly, not hidden. */
export function buildWalkSections(items: QueuedPhoto[], plants: PlantListItem[]): WalkSection[] {
  const ordered = [...items].sort(byWalkOrder);
  const unassigned = ordered.filter((i) => i.plantId === null);
  const byPlant = new Map<string, QueuedPhoto[]>();
  for (const item of ordered) {
    if (item.plantId === null) continue;
    byPlant.set(item.plantId, [...(byPlant.get(item.plantId) ?? []), item]);
  }
  const nameOf = (id: string) => plants.find((p) => p.id === id)?.name ?? "Unknown plant";
  const sections: WalkSection[] = [];
  if (unassigned.length > 0) {
    sections.push({
      key: "_unassigned",
      plantId: null,
      plantName: null,
      title: `Needs a plant (${unassigned.length})`,
      items: unassigned,
      data: chunk(unassigned, TILE_COLUMNS),
    });
  }
  const plantIds = [...byPlant.keys()].sort((a, b) =>
    nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true, sensitivity: "base" }),
  );
  for (const plantId of plantIds) {
    const list = byPlant.get(plantId)!;
    sections.push({
      key: plantId,
      plantId,
      plantName: nameOf(plantId),
      title: `${nameOf(plantId)} · ${list.length} ${list.length === 1 ? "photo" : "photos"}`,
      items: list,
      data: chunk(list, TILE_COLUMNS),
    });
  }
  return sections;
}

/** The review's data: the queue narrowed to one walk and/or one plant, the
 * plants for names, the sections, what "Analyze now" would run, the footer's
 * summary and the D-W17 store guard. Reads degrade to an honest banner. */
export function useWalkQueue(walkId: string | null, plantFilter?: string) {
  const [queue, setQueue] = useState<PhotoQueue | null>(null);
  const [plants, setPlants] = useState<PlantListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardReason, setGuardReason] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [q, p] = await Promise.all([loadPhotoQueue(), fetchPlants()]);
      setQueue(q);
      setPlants(p);
      setError(null);
    } catch (e) {
      console.error("[WalkReviewScreen] load failed:", (e as Error).message);
      setError(GENERIC_LOAD_ERROR);
      setQueue((prev) => prev ?? {});
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo(
    () =>
      Object.values(queue ?? {})
        .filter((i) => (walkId === null || i.walkId === walkId) && (!plantFilter || i.plantId === plantFilter))
        .sort(byWalkOrder),
    [queue, walkId, plantFilter],
  );
  const sections = useMemo(() => buildWalkSections(items, plants), [items, plants]);
  const runnable = useMemo(
    () => (queue ? runnableItems(queue, { walkId: walkId ?? undefined, plantId: plantFilter }) : []),
    [queue, walkId, plantFilter],
  );
  const assigned = items.filter((i) => i.plantId !== null).length;
  const needsPlant = items.length - assigned;
  const summary = importSummary({ total: items.length, assigned, needsPlant, failed: 0 });

  // D-W17: refuse a batch the record store cannot hold, before any model time.
  useEffect(() => {
    let cancelled = false;
    measureRecordBytes().then((bytes) => {
      if (cancelled) return;
      const verdict = canRunBatch(bytes, runnable.length);
      setGuardReason(verdict.ok ? null : verdict.reason);
    });
    return () => {
      cancelled = true;
    };
  }, [runnable.length]);

  return { queue, plants, items, sections, runnable, needsPlant, summary, guardReason, error, setError, load };
}

/** Header ≥ 48 dp. Either kind assigns the whole group on tap (rung 1,
 * explicit per group — not "Accept all"). The "Needs a plant" header carries
 * its amber in the band and a left rule, never in the glyphs: title text at
 * 15 pt over the amber wash must clear 4.5:1 in sunlight. */
export function WalkSectionHeader({
  section,
  t,
  scheme,
  onReassign,
}: {
  section: WalkSection;
  t: Tokens;
  scheme: "light" | "dark";
  onReassign: (section: WalkSection) => void;
}) {
  const amber = bandColor("fair", scheme);
  if (section.plantId === null) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${section.title}. Assign all of them to one plant, or tap a photo to assign it alone.`}
        onPress={() => onReassign(section)}
        style={[styles.header, styles.headerUnassigned, { backgroundColor: amber + "22", borderLeftColor: amber }]}
      >
        <Text style={[styles.headerTitle, { color: t.text }]}>⚠ {section.title}</Text>
        <Text style={[styles.headerHint, { color: t.green }]}>Assign all</Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${section.title}. Change the plant for all of them.`}
      onPress={() => onReassign(section)}
      style={[styles.header, { backgroundColor: t.card }]}
    >
      <Text style={[styles.headerTitle, { color: t.text }]} numberOfLines={1}>
        🪴 {section.title}
      </Text>
      <Text style={[styles.headerHint, { color: t.green }]}>Change plant</Text>
    </Pressable>
  );
}

/** One row of thumbnails. An unassigned tile opens the plant picker on tap
 * (the blocking state costs one tap, not three); an assigned one opens the
 * options sheet; long-press is the sheet either way. An amber GUESS pill marks
 * the two soft rungs (group propagation, a carried chip) so an automated guess
 * is visible — colour AND word — until the user confirms or the run commits
 * it (D-W3). */
export function WalkTileRow({
  row,
  rowIndex,
  section,
  t,
  scheme,
  onTile,
  onAssign,
}: {
  row: QueuedPhoto[];
  /** This row's index within its section — positions for the screen reader. */
  rowIndex: number;
  section: WalkSection;
  t: Tokens;
  scheme: "light" | "dark";
  onTile: (item: QueuedPhoto) => void;
  onAssign: (item: QueuedPhoto) => void;
}) {
  const amber = bandColor("fair", scheme);
  const fillers = Array.from({ length: TILE_COLUMNS - row.length });
  return (
    <View style={styles.row}>
      {row.map((item, i) => {
        const soft = item.evidence === "group" || item.evidence === "carried";
        const position = rowIndex * TILE_COLUMNS + i + 1;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Photo ${position} of ${section.items.length}, ${section.plantName ?? "needs a plant"}${
              soft ? ", plant guessed — check it" : ""
            }${item.status === "failed" ? ", analysis failed" : ""}. ${
              item.plantId === null ? "Tap to choose the plant." : "Tap for options."
            } Hold for options.`}
            onPress={() => (item.plantId === null ? onAssign(item) : onTile(item))}
            onLongPress={() => onTile(item)}
            style={[styles.tile, { borderColor: t.border, backgroundColor: t.border }]}
          >
            <Image source={{ uri: queuedPhotoUri(item) }} style={styles.tileImage} />
            {soft ? (
              <View style={[styles.badge, { backgroundColor: amber }]}>
                <Text style={styles.badgeText}>GUESS</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
      {fillers.map((_, i) => (
        <View key={`f${i}`} style={styles.tileFiller} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 48, marginTop: 10, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: RADIUS, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10,
  },
  headerUnassigned: { borderLeftWidth: 4 },
  headerTitle: { fontSize: 15, fontWeight: "700", flexShrink: 1 },
  headerHint: { fontSize: 12, fontWeight: "600" },
  row: { flexDirection: "row", gap: 6, marginBottom: 6 },
  tile: { flex: 1, aspectRatio: 1, borderRadius: RADIUS - 2, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  tileFiller: { flex: 1, aspectRatio: 1 },
  tileImage: { width: "100%", height: "100%" },
  badge: {
    position: "absolute", top: 4, right: 4, height: 16, paddingHorizontal: 5, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
  },
  badgeText: { color: "#1c1917", fontSize: 9, fontWeight: "800", letterSpacing: 0.4 },
});
