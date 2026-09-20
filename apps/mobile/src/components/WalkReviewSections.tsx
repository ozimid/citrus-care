// The review screen's list (F39 / D-W3): sections grouped by decision state
// then plant, and thumbnail-only tile rows. The sheets and footer are
// WalkReviewChrome.tsx. No store logic lives here — the queue math is
// photo-queue.ts / photo-import.ts.
//
// Phase 4 adds three kinds of full-width row, kept in display order between
// the tiles because each one is ABOUT its neighbours: a TAG CARD (a code
// decoded on import) or a TREE MARKER (a photo the user marked) — it hands
// its plant to the photos after it and is DELETED when the user leaves the
// review, which the row says in those words; one "Keep photo" makes it a
// plant photo again — an UNBOUND CODE ("Bind to a plant" — a sticker no
// plant holds yet, shown only as its 4-hex handle, D-W4) and a FILE-NAME
// SUGGESTION ("{plant}? · Accept" — one tap each; there is no "Accept all").

import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { bandColor } from "../lib/health";
import { importSummary } from "../lib/photo-import";
import { byWalkOrder, runnableItems, type AssignEvidence, type PhotoQueue, type QueuedPhoto } from "../lib/photo-queue";
import { loadPhotoQueue, queuedPhotoUri } from "../lib/photo-queue-io";
import { codeDisplay, codeOwners } from "../lib/plant-tags";
import type { PlantListItem } from "../lib/plants";
import { fetchPlants } from "../lib/plants-io";
import { canRunBatch } from "../lib/storage-budget";
import { measureRecordBytes } from "../lib/storage-budget-io";
import { RADIUS, type Tokens } from "../lib/theme";

/** One comparator for the whole feature: the io orders a walk the same way
 * for the marker pass, so what the user sees is what propagates. */
export { byWalkOrder } from "../lib/photo-queue";

const GENERIC_LOAD_ERROR = "Couldn't load your photos. Close and try again.";

export const TILE_COLUMNS = 3;

/** A SectionList row. Tiles are the default; the three special rows each hold
 * exactly one photo and their own one-tap action. */
export type WalkRow =
  | { kind: "tiles"; items: QueuedPhoto[] }
  /** A decoded tag card or a user-marked tree marker — deleted on exit (rungs 1c / 3). */
  | { kind: "marker"; item: QueuedPhoto }
  /** An import-side code with no single owner: `owners` is 0 or ≥ 2. */
  | { kind: "code"; item: QueuedPhoto; owners: number }
  /** A file-name tag suggests a plant for an unassigned photo (rung 5). */
  | { kind: "suggested"; item: QueuedPhoto; plantName: string };

export function rowKey(row: WalkRow): string {
  return row.kind === "tiles" ? row.items.map((i) => i.id).join("|") : `${row.kind}:${row.item.id}`;
}

export interface WalkSection {
  key: string;
  /** Null = the amber "Needs a plant" section. */
  plantId: string | null;
  /** The plant's name for screen readers; null for the unassigned section. */
  plantName: string | null;
  title: string;
  /** Every record in the section, cards included, in display order. */
  items: QueuedPhoto[];
  /** The rows the SectionList renders. */
  data: WalkRow[];
}

/** Which special row a record is, if any. Priority: a marker is a marker
 * whatever else it carries; a code the viewfinder scanned (code-scan) had its
 * one owner then and is a plant photo; a suggestion shows only where nothing
 * has decided. */
function specialRow(item: QueuedPhoto, plants: PlantListItem[]): WalkRow | null {
  if (item.isMarker) return { kind: "marker", item };
  if (item.codeDigest !== null && item.evidence !== "code-scan") {
    const owners = codeOwners(plants, item.codeDigest).length;
    if (owners !== 1) return { kind: "code", item, owners };
  }
  if (item.plantId === null && item.suggestedPlantId !== null) {
    const plantName = plants.find((p) => p.id === item.suggestedPlantId)?.name;
    if (plantName) return { kind: "suggested", item, plantName };
  }
  return null;
}

/** Tiles in rows of TILE_COLUMNS, with each special row where it falls in
 * display order — a card sits before the photos it names. */
function rowsFor(list: QueuedPhoto[], plants: PlantListItem[]): WalkRow[] {
  const rows: WalkRow[] = [];
  let tiles: QueuedPhoto[] = [];
  const flush = () => {
    for (let i = 0; i < tiles.length; i += TILE_COLUMNS) rows.push({ kind: "tiles", items: tiles.slice(i, i + TILE_COLUMNS) });
    tiles = [];
  };
  for (const item of list) {
    const special = specialRow(item, plants);
    if (special) {
      flush();
      rows.push(special);
    } else {
      tiles.push(item);
    }
  }
  flush();
  return rows;
}

/** "Meyer lemon · 4 photos · 1 tag card · 1 marker" — a card (a code decoded
 * on import) or a marker (a photo the user marked) is not a photo of the
 * plant and is not counted as one; the two are named apart here as the rows
 * and the confirm name them. */
function plantSectionTitle(name: string, list: QueuedPhoto[]): string {
  const cards = list.filter((i) => i.isMarker && i.codeDigest !== null).length;
  const markers = list.filter((i) => i.isMarker && i.codeDigest === null).length;
  const photos = list.length - cards - markers;
  const parts = [name];
  if (photos > 0 || (cards === 0 && markers === 0)) parts.push(`${photos} ${photos === 1 ? "photo" : "photos"}`);
  if (cards > 0) parts.push(`${cards} ${cards === 1 ? "tag card" : "tag cards"}`);
  if (markers > 0) parts.push(`${markers} ${markers === 1 ? "marker" : "markers"}`);
  return parts.join(" · ");
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
      data: rowsFor(unassigned, plants),
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
      title: plantSectionTitle(nameOf(plantId), list),
      items: list,
      data: rowsFor(list, plants),
    });
  }
  return sections;
}

/** The review's data: the queue narrowed to one walk and/or one plant, the
 * plants for names, the sections, what "Analyze now" would run, the footer's
 * summary and the D-W17 store guard. Reads degrade to an honest banner.
 * `items` includes the marker photos (the screen deletes them on the way
 * out); the counts do not — a card is not a photo waiting for a plant. */
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
  const photos = items.filter((i) => !i.isMarker);
  const assigned = photos.filter((i) => i.plantId !== null).length;
  const needsPlant = photos.length - assigned;
  const summary = importSummary({ total: photos.length, assigned, needsPlant, failed: 0 });

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

/** D-W3: every automated assignment wears its evidence until the run commits
 * it — colour AND a word, both ways. Amber is the ONE coloured badge, for
 * the two soft rungs (a time-gap group, a carried chip): on a walk where
 * most tiles carry a badge, the guess must stay the loud thing. The
 * deterministic ones (a tag code, a tree marker, a file-name token) wear a
 * plain near-black pill with white text (17:1) — they still say where they
 * came from, but they are not what to check first. */
function evidenceBadge(evidence: AssignEvidence): { text: string; soft: boolean; spoken: string } | null {
  switch (evidence) {
    case "group":
    case "carried":
      return { text: "GUESS", soft: true, spoken: "plant guessed — check it" };
    case "tag-card":
      return { text: "CODE", soft: false, spoken: "plant from a tag code" };
    case "marker":
      return { text: "MARKER", soft: false, spoken: "plant from a tree marker" };
    case "file-tag":
      return { text: "FILE", soft: false, spoken: "plant from the file name" };
    default:
      return null;
  }
}

/** Near-black ink for the deterministic pills and for the word on amber. */
const BADGE_INK = "#1c1917";

function EvidenceBadge({ badge, amber }: { badge: { text: string; soft: boolean }; amber: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: badge.soft ? amber : BADGE_INK }]}>
      <Text style={[styles.badgeText, { color: badge.soft ? BADGE_INK : "#ffffff" }]}>{badge.text}</Text>
    </View>
  );
}

/** One row of thumbnails. An unassigned tile opens the plant picker on tap
 * (the blocking state costs one tap, not three); an assigned one opens the
 * options sheet; long-press is the sheet either way. */
export function WalkTileRow({
  row,
  section,
  t,
  scheme,
  onTile,
  onAssign,
}: {
  row: QueuedPhoto[];
  section: WalkSection;
  t: Tokens;
  scheme: "light" | "dark";
  onTile: (item: QueuedPhoto) => void;
  onAssign: (item: QueuedPhoto) => void;
}) {
  const amber = bandColor("fair", scheme);
  // Positions for the screen reader count plant photos only — a card between
  // two tiles is not "photo 3 of 7".
  const photos = section.items.filter((i) => !i.isMarker);
  const fillers = Array.from({ length: TILE_COLUMNS - row.length });
  return (
    <View style={styles.row}>
      {row.map((item) => {
        const badge = evidenceBadge(item.evidence);
        const position = photos.indexOf(item) + 1;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Photo ${position} of ${photos.length}, ${section.plantName ?? "needs a plant"}${
              badge ? `, ${badge.spoken}` : ""
            }${item.status === "failed" ? ", analysis failed" : ""}. ${
              item.plantId === null ? "Tap to choose the plant." : "Tap for options."
            } Hold for options.`}
            onPress={() => (item.plantId === null ? onAssign(item) : onTile(item))}
            onLongPress={() => onTile(item)}
            style={[styles.tile, { borderColor: t.border, backgroundColor: t.border }]}
          >
            <Image source={{ uri: queuedPhotoUri(item) }} style={styles.tileImage} />
            {badge ? <EvidenceBadge badge={badge} amber={amber} /> : null}
          </Pressable>
        );
      })}
      {fillers.map((_, i) => (
        <View key={`f${i}`} style={styles.tileFiller} />
      ))}
    </View>
  );
}

/** A full-width row for one photo that needs a word, not just a thumbnail:
 * a tag card / tree marker ("Keep photo" — else it is deleted when the user
 * leaves, and the row says so), an unbound code ("Bind to a plant" / "Pick
 * one") or a file-name suggestion ("Accept"). One action each, ≥ 48 dp, as
 * plain text on a plain border: a coloured 13 pt label would be the least
 * readable text on a sunlit screen, on the very buttons that gate the wait.
 * The two rows that still need a decision carry the amber rule and wash the
 * "Needs a plant" header uses, so amber keeps its one meaning; the suggestion
 * also wears the amber GUESS badge on its thumbnail, where the eye lands.
 * The thumbnail behaves like a tile (tap: choose the plant when it has none,
 * else options; hold: options). */
export function WalkSpecialRow({
  row,
  section,
  t,
  scheme,
  onTile,
  onAssign,
  onToggleMarker,
  onBind,
  onAccept,
}: {
  row: Exclude<WalkRow, { kind: "tiles" }>;
  section: WalkSection;
  t: Tokens;
  scheme: "light" | "dark";
  onTile: (item: QueuedPhoto) => void;
  onAssign: (item: QueuedPhoto) => void;
  onToggleMarker: (item: QueuedPhoto) => void;
  onBind: (item: QueuedPhoto) => void;
  onAccept: (item: QueuedPhoto) => void;
}) {
  const { item } = row;
  const amber = bandColor("fair", scheme);
  const plant = section.plantName ?? "this plant";
  let title: string;
  let sub: string;
  let action: string;
  let spoken: string;
  let onAction: () => void;
  if (row.kind === "marker") {
    title = item.codeDigest ? "Tag card" : "Tree marker";
    sub = `The photos after it go to ${plant}. This one is deleted when you leave this screen.`;
    action = "Keep photo";
    spoken = `Keep this as a plant photo of ${plant} instead of deleting it`;
    onAction = () => onToggleMarker(item);
  } else if (row.kind === "code") {
    const handle = codeDisplay(item.codeDigest ?? "");
    title = row.owners === 0 ? "Unknown code" : `Code on ${row.owners} plants`;
    sub = row.owners === 0 ? `${handle} · no plant has this code yet` : `${handle} · pick which one this photo means here`;
    action = row.owners === 0 ? "Bind to a plant" : "Pick one";
    spoken = row.owners === 0 ? "Bind this code to a plant" : "Pick which plant this code means here";
    onAction = () => onBind(item);
  } else {
    title = `${row.plantName}?`;
    sub = "From the file name — tap Accept if this is right";
    action = "Accept";
    spoken = `Accept: this is ${row.plantName}`;
    onAction = () => onAccept(item);
  }
  // A card or marker is decided; the other two rows still wait on the user.
  const undecided = row.kind !== "marker";
  return (
    <View
      style={[
        styles.special,
        { backgroundColor: undecided ? amber + "22" : t.card, borderColor: t.border },
        undecided ? { borderLeftWidth: 4, borderLeftColor: amber } : null,
      ]}
    >
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={`${title}. ${item.plantId === null ? "Tap to choose the plant." : "Tap for options."} Hold for options.`}
        onPress={() => (item.plantId === null ? onAssign(item) : onTile(item))}
        onLongPress={() => onTile(item)}
        style={[styles.specialThumbWrap, { borderColor: t.border, backgroundColor: t.border }]}
      >
        <Image source={{ uri: queuedPhotoUri(item) }} style={styles.tileImage} />
        {row.kind === "suggested" ? <EvidenceBadge badge={{ text: "GUESS", soft: true }} amber={amber} /> : null}
      </Pressable>
      <View style={styles.specialText}>
        <Text style={[styles.specialTitle, { color: t.text }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.specialSub, { color: t.sub }]} numberOfLines={3}>
          {sub}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={spoken}
        onPress={onAction}
        style={[styles.specialAction, { borderColor: t.border, backgroundColor: t.card }]}
      >
        <Text style={[styles.specialActionText, { color: t.text }]}>{action}</Text>
      </Pressable>
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
  // minHeight + padding, never a fixed height: the word scales with the OS
  // font size and must not clip at 1.3×.
  badge: {
    position: "absolute", top: 4, right: 4, minHeight: 18, paddingVertical: 1, paddingHorizontal: 5, borderRadius: 9,
    alignItems: "center", justifyContent: "center",
  },
  badgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.4 },
  special: {
    flexDirection: "row", alignItems: "center", gap: 10, minHeight: 64, marginBottom: 6,
    padding: 8, borderRadius: RADIUS, borderWidth: StyleSheet.hairlineWidth,
  },
  specialThumbWrap: { width: 56, height: 56, borderRadius: RADIUS - 2, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  specialText: { flex: 1, gap: 2 },
  specialTitle: { fontSize: 14, fontWeight: "700" },
  specialSub: { fontSize: 12, lineHeight: 16 },
  specialAction: {
    minHeight: 48, minWidth: 88, paddingHorizontal: 12, borderWidth: 1, borderRadius: RADIUS,
    alignItems: "center", justifyContent: "center",
  },
  specialActionText: { fontSize: 13, fontWeight: "700" },
});
