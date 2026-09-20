import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { useLocalEngine } from "../components/LocalEngineProvider";
import { NewPlantSheet } from "../components/NewPlantSheet";
import { PhotoViewer } from "../components/PhotoViewer";
import { PlantPickerSheet } from "../components/PlantPickerSheet";
import {
  RunToggle,
  TileActionSheet,
  WalkEmptyState,
  WalkReviewFooter,
  type TileAction,
} from "../components/WalkReviewChrome";
import {
  rowKey,
  useWalkQueue,
  WalkSectionHeader,
  WalkSpecialRow,
  WalkTileRow,
  type WalkRow,
  type WalkSection,
} from "../components/WalkReviewSections";
import { applyPlantToRun, markerRunSize } from "../lib/photo-import";
import { byWalkOrder, type QueuedPhoto } from "../lib/photo-queue";
import {
  assignQueuedPhoto,
  bindCodeFromWalk,
  discardMarkerPhotos,
  loadDurations,
  markQueuedAsMarker,
  queuedPhotoUri,
  removeQueuedPhoto,
  unmarkQueuedMarker,
} from "../lib/photo-queue-io";
import { PLANT_CODE_LIMIT_ERROR } from "../lib/plant-store-io";
import { codeOwners } from "../lib/plant-tags";
import { useTheme } from "../lib/theme-io";

// F39 review screen (D-W3, D-W7): every queued photo's plant is visible and
// one tap from being changed BEFORE any model time is spent. Sections are
// "Needs a plant" first, then one per plant; the footer asks "Analyze now /
// Later" every time — and only from here, where the user can see what the
// answer spends twenty minutes on (D-W7). There is deliberately no "Accept
// all". The store math is photo-queue.ts / photo-import.ts (tested); this
// file only reads, renders and calls the io.
//
// Phase 4 (rungs 1c / 3 / 5): a tag card or tree-marker photo is a row that
// says it is deleted when the user leaves and toggles back to a plant photo;
// an unbound code binds from its row; a file-name suggestion accepts from
// its row; the tile sheet can make any photo a tree marker (one confirm that
// says a true, walk-wide number — and is not offered at all in a plant's
// filtered view, where what it would move is not on screen). Marker photos
// are scaffolding — they are deleted on EVERY exit (Analyze now, Later, ✕):
// nothing counts a marker as waiting, so one left behind would be
// unreachable from any card or strip.

const GENERIC_UPDATE_ERROR = "Couldn't update that photo. Please try again.";

interface Props {
  /** Null = every queued photo, whatever walk it came from. */
  walkId: string | null;
  /** Only this plant's photos (PlantDetailScreen's strip). */
  plantFilter?: string;
  onAnalyze: (items: QueuedPhoto[]) => void;
  onLater: () => void;
  onClose: () => void;
  /** The queue changed under a tap (assign / remove / new plant). */
  onChanged?: () => void;
  /** One user-safe line shown above the buttons (import partial, stub). */
  notice?: string | null;
}

type Picker =
  | { kind: "group"; section: WalkSection }
  | { kind: "tile"; item: QueuedPhoto }
  /** Rung 1c, "Use as tree marker": which tree does this photo stand for? */
  | { kind: "marker"; item: QueuedPhoto }
  /** An unbound code (no owners: bind it) or one several plants hold (pick
   * between the owners for this walk — D-W4, nothing is bound). */
  | { kind: "bind"; item: QueuedPhoto; digest: string; owners: string[] }
  | null;

const BIND_FOOT =
  "Tapping a plant binds this code to it. Scanning it will pick that plant from now on — remove it later on that plant's Tag & codes card. This photo becomes a tag card and is deleted when you leave this screen.";
const PICK_OWNER_FOOT =
  "This code is on more than one plant — fix that on a plant's Tag & codes card. Tapping one here only makes this photo its tag card for this walk: the photos after it follow, and this photo is deleted when you leave this screen.";

export function WalkReviewScreen({
  walkId,
  plantFilter,
  onAnalyze,
  onLater,
  onClose,
  onChanged,
  notice = null,
}: Props) {
  const { t, scheme } = useTheme();
  const { state: engine } = useLocalEngine();
  const { queue, plants, items, sections, runnable, needsPlant, summary, guardReason, error, setError, load } =
    useWalkQueue(walkId, plantFilter);
  const [busy, setBusy] = useState(false);
  /** Local acknowledgement of the last change ("Assigned 3 photos to Lemon 3"). */
  const [flash, setFlash] = useState<string | null>(null);
  const [sheetItem, setSheetItem] = useState<QueuedPhoto | null>(null);
  const [picker, setPicker] = useState<Picker>(null);
  const [runOn, setRunOn] = useState(false);
  const [newPlantFor, setNewPlantFor] = useState<QueuedPhoto | null>(null);
  const [viewing, setViewing] = useState<{ uri: string; caption?: string } | null>(null);
  /** D-W8: the measured durations ring behind the footer's "about N min". */
  const [ring, setRing] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadDurations().then((r) => {
      if (!cancelled) setRing(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const nameOf = useCallback(
    (plantId: string | null) => plants.find((p) => p.id === plantId)?.name ?? "that plant",
    [plants],
  );

  /** Every exit — the every-time answer either way, and ✕: the marker
   * photos in view go first (they were never plant photos, and nothing else
   * would ever show them again), then the caller takes over. */
  const settle = useCallback(
    async (then: () => void) => {
      if (!items.some((i) => i.isMarker)) {
        then();
        return;
      }
      setBusy(true);
      try {
        await discardMarkerPhotos(items);
        onChanged?.();
      } finally {
        setBusy(false);
      }
      then();
    },
    [items, onChanged],
  );
  const analyze = useCallback(() => void settle(() => onAnalyze(runnable)), [onAnalyze, runnable, settle]);
  const later = useCallback(() => void settle(onLater), [onLater, settle]);
  const close = useCallback(() => void settle(onClose), [onClose, settle]);

  /** Run an io mutation, then reload; the user only ever sees a generic line
   * (or the one message the io wrote for them, the code cap). `busy` also
   * puts a blocker over the list so a second tap cannot interleave two
   * read-modify-writes of the queue while files are mid-move. */
  const mutate = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      setFlash(null);
      try {
        await work();
        onChanged?.();
      } catch (e) {
        const message = (e as Error).message;
        console.error("[WalkReviewScreen] update failed:", message);
        setError(message === PLANT_CODE_LIMIT_ERROR ? message : GENERIC_UPDATE_ERROR);
      } finally {
        await load();
        setBusy(false);
      }
    },
    [load, onChanged, setError],
  );

  const onPick = useCallback(
    (plantId: string) => {
      const target = picker;
      setPicker(null);
      if (!target) return;
      const name = nameOf(plantId);
      if (target.kind === "bind") {
        void mutate(async () => {
          await bindCodeFromWalk(target.item.walkId, target.digest, plantId);
          setFlash(
            target.owners.length === 0
              ? `Code bound to ${name} — its photos follow`
              : `Tag card for ${name} on this walk — its photos follow`,
          );
        });
        return;
      }
      if (target.kind === "marker") {
        // Counted over the WHOLE walk in display order, never this view: the
        // io applies the marker walk-wide, so the number must be too.
        const walk = Object.values(queue ?? {})
          .filter((i) => i.walkId === target.item.walkId)
          .sort(byWalkOrder);
        const n = markerRunSize(walk, target.item.id, plantId);
        Alert.alert(
          `Use as ${name}'s tree marker?`,
          n === 0
            ? "No photos follow it in this walk. This photo is removed from the walk and deleted when you leave this screen."
            : `Assigns the ${n} ${n === 1 ? "photo" : "photos"} after it to ${name}. This photo is removed from the walk and deleted when you leave this screen.`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Use as marker",
              onPress: () =>
                void mutate(async () => {
                  await markQueuedAsMarker(target.item.id, plantId);
                  setFlash(n === 0 ? `Marked as ${name}'s tree marker` : `Marked as ${name}'s tree marker · ${n} ${n === 1 ? "photo" : "photos"} assigned`);
                }),
            },
          ],
        );
        return;
      }
      void mutate(async () => {
        let changed = 0;
        if (target.kind === "group") {
          for (const item of target.section.items) {
            if (item.isMarker) continue;
            await assignQueuedPhoto(item.id, plantId, "user");
            changed += 1;
          }
        } else if (!runOn) {
          await assignQueuedPhoto(target.item.id, plantId, "user");
          changed = 1;
        } else {
          // D-W3 rung 1b: this photo and the ones after it, until the next one
          // the user assigned by hand. Shooting order within the tapped
          // photo's OWN walk — the all-walks view must not chain into another
          // day's roll.
          const walk = items.filter((i) => i.walkId === target.item.walkId);
          const before = new Map(walk.map((i) => [i.id, i]));
          for (const next of applyPlantToRun(walk, target.item.id, plantId, true)) {
            const prev = before.get(next.id);
            if (prev && (prev.plantId !== next.plantId || prev.evidence !== next.evidence)) {
              await assignQueuedPhoto(next.id, next.plantId, next.evidence);
              changed += 1;
            }
          }
        }
        setFlash(`Assigned ${changed} ${changed === 1 ? "photo" : "photos"} to ${name}`);
      });
    },
    [items, mutate, nameOf, picker, queue, runOn],
  );

  const onTileAction = useCallback(
    (action: TileAction, item: QueuedPhoto) => {
      setSheetItem(null);
      if (action === "assign") {
        // The run toggle keeps its last state: it is visibly checked every
        // time the picker opens and reversible before any compute.
        setPicker({ kind: "tile", item });
      } else if (action === "marker") {
        setPicker({ kind: "marker", item });
      } else if (action === "new-plant") {
        setNewPlantFor(item);
      } else if (action === "view") {
        setViewing({
          uri: queuedPhotoUri(item),
          caption: item.isMarker
            ? item.codeDigest
              ? "Tag card — deleted when you leave this screen"
              : "Tree marker — deleted when you leave this screen"
            : "Waiting for analysis",
        });
      } else {
        Alert.alert("Remove this photo?", "It is deleted from this phone. This can't be undone.", [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => void mutate(() => removeQueuedPhoto(item.id)),
          },
        ]);
      }
    },
    [mutate],
  );

  /** The card's toggle: a plant photo after all, kept and analyzed. */
  const onToggleMarker = useCallback(
    (item: QueuedPhoto) =>
      void mutate(async () => {
        await unmarkQueuedMarker(item.id);
        setFlash(`Kept as a plant photo of ${nameOf(item.plantId)}`);
      }),
    [mutate, nameOf],
  );

  /** No owner: bind the code. Several: a per-walk pick between them (D-W4) —
   * the picker is narrowed to the owners so no third plant can be chosen. */
  const onBind = useCallback(
    (item: QueuedPhoto) => {
      if (item.codeDigest) {
        setPicker({ kind: "bind", item, digest: item.codeDigest, owners: codeOwners(plants, item.codeDigest) });
      }
    },
    [plants],
  );

  /** Rung 5, one tap per photo — the user's own decision from here on. */
  const onAccept = useCallback(
    (item: QueuedPhoto) => {
      const plantId = item.suggestedPlantId;
      if (!plantId) return;
      void mutate(async () => {
        await assignQueuedPhoto(item.id, plantId, "user");
        setFlash(`Assigned 1 photo to ${nameOf(plantId)}`);
      });
    },
    [mutate, nameOf],
  );

  const openTilePicker = useCallback((item: QueuedPhoto) => setPicker({ kind: "tile", item }), []);

  const pickerTitle =
    picker?.kind === "group"
      ? `${picker.section.plantId === null ? "Assign" : "Move"} ${picker.section.items.filter((i) => !i.isMarker).length} photos to…`
      : picker?.kind === "bind"
        ? picker.owners.length > 1
          ? "Which of its plants does this code mean here?"
          : "Which plant has this code?"
        : picker?.kind === "marker"
          ? "Which tree is this a marker for?"
          : "Which plant is this?";

  return (
    <View style={[styles.root, { backgroundColor: t.canvas }]}>
      <View style={styles.headerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={close}
          hitSlop={10}
          style={[styles.back, { borderColor: t.border, backgroundColor: t.card }]}
        >
          <Text style={[styles.backGlyph, { color: t.text }]}>✕</Text>
        </Pressable>
        <Text style={[styles.heading, { color: t.text }]} numberOfLines={1}>
          {plantFilter ? "Photos waiting for analysis" : "Check the plants"}
        </Text>
      </View>
      {error ? (
        <Text style={[styles.errorBanner, { color: t.danger }]} accessibilityLiveRegion="assertive">
          {error}
        </Text>
      ) : null}
      {queue === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={t.green} />
        </View>
      ) : items.length === 0 ? (
        // A failed read is NOT "nothing waiting": the banner is the state
        // then, and the exit stays in the thumb zone either way.
        <WalkEmptyState t={t} onDone={close} silent={error !== null} />
      ) : (
        <View style={styles.listWrap}>
          <SectionList<WalkRow, WalkSection>
            sections={sections}
            keyExtractor={rowKey}
            stickySectionHeadersEnabled={false}
            contentContainerStyle={styles.list}
            renderSectionHeader={({ section }) => (
              <WalkSectionHeader section={section} t={t} scheme={scheme} onReassign={(s) => setPicker({ kind: "group", section: s })} />
            )}
            renderItem={({ item: row, section }) =>
              row.kind === "tiles" ? (
                <WalkTileRow row={row.items} section={section} t={t} scheme={scheme} onTile={setSheetItem} onAssign={openTilePicker} />
              ) : (
                <WalkSpecialRow
                  row={row}
                  section={section}
                  t={t}
                  scheme={scheme}
                  onTile={setSheetItem}
                  onAssign={openTilePicker}
                  onToggleMarker={onToggleMarker}
                  onBind={onBind}
                  onAccept={onAccept}
                />
              )
            }
          />
          {busy ? (
            <View style={styles.blocker} accessibilityLabel="Updating your photos">
              <ActivityIndicator color={t.green} />
            </View>
          ) : null}
        </View>
      )}
      {queue !== null && items.length > 0 ? (
        <WalkReviewFooter
          summary={summary}
          runnable={runnable.length}
          ring={ring}
          needsPlant={needsPlant}
          engine={engine.kind}
          guardReason={guardReason}
          notice={notice}
          flash={flash}
          busy={busy}
          onAnalyze={analyze}
          onLater={later}
          t={t}
        />
      ) : null}

      <TileActionSheet item={sheetItem} t={t} canMark={!plantFilter} onAction={onTileAction} onClose={() => setSheetItem(null)} />
      <PlantPickerSheet
        visible={picker !== null}
        title={pickerTitle}
        plants={picker?.kind === "bind" && picker.owners.length > 1 ? plants.filter((p) => picker.owners.includes(p.id)) : plants}
        selectedId={picker?.kind === "group" ? picker.section.plantId : picker?.item.plantId ?? null}
        onSelect={onPick}
        onClose={() => setPicker(null)}
        onNewPlant={picker?.kind === "tile" ? () => { setNewPlantFor(picker.item); setPicker(null); } : undefined}
        footer={
          picker?.kind === "tile" ? (
            <RunToggle on={runOn} onToggle={() => setRunOn((v) => !v)} t={t} />
          ) : picker?.kind === "bind" ? (
            // The consequence at the decision point — the scan sheet's own
            // wording (TagScanSheet), plus what happens to this photo.
            <Text style={[styles.pickerFoot, { color: t.sub }]}>{picker.owners.length === 0 ? BIND_FOOT : PICK_OWNER_FOOT}</Text>
          ) : null
        }
      />
      <NewPlantSheet
        visible={newPlantFor !== null}
        onClose={() => setNewPlantFor(null)}
        onSaved={(plantId) => {
          const item = newPlantFor;
          setNewPlantFor(null);
          if (item) void mutate(() => assignQueuedPhoto(item.id, plantId, "user"));
        }}
      />
      <PhotoViewer photo={viewing} onClose={() => setViewing(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 68 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, marginBottom: 8 },
  back: { width: 48, height: 48, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  backGlyph: { fontSize: 18, fontWeight: "600" },
  heading: { flex: 1, fontSize: 22, fontWeight: "600", letterSpacing: -0.4 },
  errorBanner: { fontSize: 13, paddingHorizontal: 20, marginBottom: 8 },
  pickerFoot: { fontSize: 13, lineHeight: 18, marginTop: 10, paddingHorizontal: 4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listWrap: { flex: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 16 },
  blocker: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.15)",
  },
});
