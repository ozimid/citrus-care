import { useCallback, useState } from "react";
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
  useWalkQueue,
  WalkSectionHeader,
  WalkTileRow,
  type WalkSection,
} from "../components/WalkReviewSections";
import { applyPlantToRun } from "../lib/photo-import";
import type { QueuedPhoto } from "../lib/photo-queue";
import { assignQueuedPhoto, queuedPhotoUri, removeQueuedPhoto } from "../lib/photo-queue-io";
import { useTheme } from "../lib/theme-io";

// F39 review screen (D-W3, D-W7): every queued photo's plant is visible and
// one tap from being changed BEFORE any model time is spent. Sections are
// "Needs a plant" first, then one per plant; the footer asks "Analyze now /
// Later" every time — and only from here, where the user can see what the
// answer spends twenty minutes on (D-W7). There is deliberately no "Accept
// all". The store math is photo-queue.ts (tested); this file only reads,
// renders and calls the io.

const GENERIC_UPDATE_ERROR = "Couldn't update that photo. Please try again.";
/** Phase 1 stands in for the batch runner; the review is complete without it. */
export const BATCH_ANALYSIS_STUB_NOTICE = "Batch analysis arrives in the next step.";

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
  | null;

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

  const analyze = useCallback(() => onAnalyze(runnable), [onAnalyze, runnable]);

  /** Run an io mutation, then reload; the user only ever sees the generic line.
   * `busy` also puts a blocker over the list so a second tap cannot interleave
   * two read-modify-writes of the queue while files are mid-move. */
  const mutate = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      setFlash(null);
      try {
        await work();
        onChanged?.();
      } catch (e) {
        console.error("[WalkReviewScreen] update failed:", (e as Error).message);
        setError(GENERIC_UPDATE_ERROR);
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
      const name = plants.find((p) => p.id === plantId)?.name ?? "that plant";
      void mutate(async () => {
        let changed = 0;
        if (target.kind === "group") {
          for (const item of target.section.items) {
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
    [items, mutate, picker, plants, runOn],
  );

  const onTileAction = useCallback(
    (action: TileAction, item: QueuedPhoto) => {
      setSheetItem(null);
      if (action === "assign") {
        // The run toggle keeps its last state: it is visibly checked every
        // time the picker opens and reversible before any compute.
        setPicker({ kind: "tile", item });
      } else if (action === "new-plant") {
        setNewPlantFor(item);
      } else if (action === "view") {
        setViewing({ uri: queuedPhotoUri(item), caption: "Waiting for analysis" });
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

  return (
    <View style={[styles.root, { backgroundColor: t.canvas }]}>
      <View style={styles.headerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
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
        <WalkEmptyState t={t} onDone={onClose} silent={error !== null} />
      ) : (
        <View style={styles.listWrap}>
          <SectionList
            sections={sections}
            keyExtractor={(row) => row.map((i) => i.id).join("|")}
            stickySectionHeadersEnabled={false}
            contentContainerStyle={styles.list}
            renderSectionHeader={({ section }) => (
              <WalkSectionHeader section={section} t={t} scheme={scheme} onReassign={(s) => setPicker({ kind: "group", section: s })} />
            )}
            renderItem={({ item, index, section }) => (
              <WalkTileRow
                row={item}
                rowIndex={index}
                section={section}
                t={t}
                scheme={scheme}
                onTile={setSheetItem}
                onAssign={(target) => setPicker({ kind: "tile", item: target })}
              />
            )}
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
          needsPlant={needsPlant}
          engine={engine.kind}
          guardReason={guardReason}
          notice={flash ?? notice}
          busy={busy}
          onAnalyze={analyze}
          onLater={onLater}
          t={t}
        />
      ) : null}

      <TileActionSheet item={sheetItem} t={t} onAction={onTileAction} onClose={() => setSheetItem(null)} />
      <PlantPickerSheet
        visible={picker !== null}
        title={
          picker?.kind === "group"
            ? `${picker.section.plantId === null ? "Assign" : "Move"} ${picker.section.items.length} photos to…`
            : "Which plant is this?"
        }
        plants={plants}
        selectedId={picker?.kind === "group" ? picker.section.plantId : picker?.item.plantId ?? null}
        onSelect={onPick}
        onClose={() => setPicker(null)}
        onNewPlant={picker?.kind === "tile" ? () => { setNewPlantFor(picker.item); setPicker(null); } : undefined}
        footer={
          picker?.kind === "tile" ? <RunToggle on={runOn} onToggle={() => setRunOn((v) => !v)} t={t} /> : null
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
