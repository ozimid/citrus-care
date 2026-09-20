import { Fragment, useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { AssessmentDiagnosis } from "@citrus/shared";
import { BeforeAfterSlider } from "../components/BeforeAfterSlider";
import { PhotoViewer } from "../components/PhotoViewer";
import { NewPlantSheet } from "../components/NewPlantSheet";
import { PendingPhotosStrip } from "../components/PendingPhotosStrip";
import { QuarantineCard } from "../components/QuarantineCard";
import { PlantInfoCard } from "../components/PlantInfoCard";
import { PlantTagsCard } from "../components/PlantTagsCard";
import { PlantToolsCard } from "../components/PlantToolsCard";
import { WateringCard } from "../components/WateringCard";
import { bandColor, healthBand } from "../lib/health";
import {
  attachLocalPhotos,
  parseTimelineDiagnosis,
  PLANT_DETAIL_LOAD_ERROR,
  sliderPair,
  trendChipLabel,
  type PlantDetailData,
  type TimelineDelta,
  type TimelineEntry,
} from "../lib/plant-detail";
import { GENERIC_DELETE_PLANT_ERROR } from "../lib/plant-mutations";
import { deletePlantWithPhotos, deleteWalkIo, fetchPlantDetail } from "../lib/plants-io";
import { assessmentsForWalk } from "../lib/assessment-store";
import { loadAssessmentStore } from "../lib/assessment-store-io";
import { newestFirst } from "../lib/local-id";
import { loadPhotoIndex } from "../lib/photo-store-io";
import { plantSubLabel } from "../lib/plants";
import { RADIUS, type Tokens } from "../lib/theme";
import { useTheme } from "../lib/theme-io";
import { CaptureScreen } from "./CaptureScreen";
import { DiagnosisScreen } from "./DiagnosisScreen";

// Plant detail (design doc §4 row 6), presented as a Modal over the Plants
// tab: header with health ring + trend chip, quarantine alert, before/after
// slider (2+ local photos), reverse-chron timeline with delta chips, and the
// edit / delete / assess actions. All query + mapping logic is the tested
// src/lib/plant-detail.ts; mutations are src/lib/plant-mutations.ts. Photos
// come from the on-phone store (D-16) — plain file uris, no auth headers;
// assessments without a local photo render a neutral placeholder.

const ROW_OPEN_ERROR = "Couldn't open this assessment. Please try again.";
/** deleteWalkIo removes one assessment at a time, so a failure part-way leaves
 * part of the walk gone — the message must not claim nothing happened. */
const UNDO_WALK_ERROR_BODY =
  "Some of the walk may already be removed. Check the timeline, then try again.";

/** F39 Phase 6b — the "Undo this walk" offer: the walk this plant was most
 * recently ANALYZED in. Not the newest row by effective time: the headline
 * case is a roll imported from last month, whose rows sit below every later
 * single shot and would otherwise never be undoable. `rowIds` are this plant's
 * rows from that walk, so the link sits under the timeline group it removes. */
interface WalkUndo {
  walkId: string;
  /** Every assessment the walk produced, across all plants. */
  count: number;
  plants: number;
  rowIds: Set<string>;
}

interface Props {
  plantId: string;
  onClose: () => void;
  /** List-visible data changed (edit / delete / new assessment) — the Plants
   * tab behind this modal should reload. */
  onChanged: () => void;
}

export function PlantDetailScreen({ plantId, onClose, onChanged }: Props) {
  const { t, scheme } = useTheme();
  const [data, setData] = useState<PlantDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [viewing, setViewing] = useState<{ diagnosis: AssessmentDiagnosis; entry: TimelineEntry } | null>(null);
  /** Full-screen photo (tap a timeline thumbnail). */
  const [viewingPhoto, setViewingPhoto] = useState<{ uri: string; caption?: string } | null>(null);
  /** F39: bumps per load so the pending-photos strip re-reads the queue. */
  const [loadCount, setLoadCount] = useState(0);
  /** F39 Phase 6b: null when the newest assessment is not part of a walk (or
   * the walk produced nothing else) — then there is nothing to undo as a unit. */
  const [walkUndo, setWalkUndo] = useState<WalkUndo | null>(null);
  const [undoingWalk, setUndoingWalk] = useState(false);

  const load = useCallback(async () => {
    setLoadCount((c) => c + 1);
    try {
      const [detail, index, store] = await Promise.all([
        fetchPlantDetail(plantId),
        // Join the synced assessments to their on-phone photos (D-16).
        loadPhotoIndex(),
        // The walk id rides the stored record, not the timeline row.
        loadAssessmentStore(),
      ]);
      setData({ ...detail, timeline: attachLocalPhotos(detail.timeline, index) });
      // The walk this plant was analyzed in last (createdAt — when the rows
      // were written), so an imported old roll is undoable even though its
      // rows are dated months back.
      const walkId = Object.values(store)
        .filter((a) => a.plantId === plantId && a.walkId)
        .sort((a, b) => newestFirst(a.createdAt, a.id, b.createdAt, b.id))[0]?.walkId;
      const walk = walkId ? assessmentsForWalk(store, walkId) : [];
      setWalkUndo(
        walkId && walk.length > 0
          ? {
              walkId,
              count: walk.length,
              plants: new Set(walk.map((a) => a.plantId)).size,
              rowIds: new Set(walk.filter((a) => a.plantId === plantId).map((a) => a.id)),
            }
          : null,
      );
      setError(null);
    } catch {
      // fetchPlantDetail already logged the details.
      setError(PLANT_DETAIL_LOAD_ERROR);
    }
  }, [plantId]);

  useEffect(() => {
    load();
  }, [load]);

  const openRow = useCallback((entry: TimelineEntry) => {
    const diagnosis = parseTimelineDiagnosis(entry.diagnosis);
    if (!diagnosis) {
      setError(ROW_OPEN_ERROR);
      return;
    }
    setError(null);
    setViewing({ diagnosis, entry });
  }, []);

  const confirmDelete = useCallback(() => {
    if (!data) return;
    Alert.alert(
      `Delete ${data.plant.name}?`,
      "This removes the plant, all of its assessments, the photos stored on this phone, and any photos waiting for analysis. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              await deletePlantWithPhotos(plantId);
              onChanged();
              onClose();
            } catch {
              // deletePlantWithPhotos already logged the details.
              setError(GENERIC_DELETE_PLANT_ERROR);
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  }, [data, onChanged, onClose, plantId]);

  /** Undo the whole walk this plant was analyzed in last — every plant it
   * touched, their photos on this phone, covers repointed (deleteWalkIo).
   * Queued, not-yet-analyzed photos are untouched: nothing was scored. */
  const confirmUndoWalk = useCallback(() => {
    if (!walkUndo) return;
    const { walkId, count, plants } = walkUndo;
    const scope = plants > 1 ? ` across ${plants} plants` : "";
    const rows = count === 1 ? "1 assessment" : `${count} assessments`;
    Alert.alert(
      "Undo this walk?",
      `This removes ${rows} from this walk${scope}, and their photos stored on this phone. Photos still waiting for analysis are kept. This can't be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Undo walk",
          style: "destructive",
          onPress: async () => {
            setUndoingWalk(true);
            try {
              await deleteWalkIo(walkId);
              onChanged();
              await load();
            } catch (e) {
              console.error("[PlantDetailScreen] undo walk failed:", (e as Error).message);
              // Say it where the tap happened: the link sits deep in the
              // timeline, and a banner above the ScrollView is off-screen.
              onChanged();
              await load();
              Alert.alert("Couldn't undo this walk", UNDO_WALK_ERROR_BODY);
            } finally {
              setUndoingWalk(false);
            }
          },
        },
      ],
    );
  }, [load, onChanged, walkUndo]);

  const plant = data?.plant ?? null;
  const timeline = data?.timeline ?? [];
  // The "Undo this walk" link goes under the walk's contiguous group — from
  // its first row in the timeline down to where the group ends. The group is
  // not necessarily at the top: an imported roll sits at its shooting date.
  let undoAfterIndex = walkUndo ? timeline.findIndex((e) => walkUndo.rowIds.has(e.id)) : -1;
  while (
    undoAfterIndex >= 0 &&
    undoAfterIndex + 1 < timeline.length &&
    walkUndo?.rowIds.has(timeline[undoAfterIndex + 1].id)
  ) {
    undoAfterIndex += 1;
  }
  const pair = data ? sliderPair(timeline) : null;
  const trend = data ? trendChipLabel(timeline) : null;
  const latest = timeline[0] ?? null;
  // F39 Phase 3: tag, codes, tag photo and the missing flag ride the detail
  // row (plantDetailRowFromStore) — one read, one record, for the header chip,
  // the Tags card and the edit sheet alike.
  const tag = plant?.tag ?? null;
  const tagMissing = plant?.tag_missing === true;
  const amber = bandColor("fair", scheme);

  return (
    <View style={[styles.root, { backgroundColor: t.canvas }]}>
      <View style={styles.headerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to plants"
          onPress={onClose}
          hitSlop={10}
          style={[styles.back, { borderColor: t.border, backgroundColor: t.card }]}
        >
          <Text style={[styles.backGlyph, { color: t.text }]}>‹</Text>
        </Pressable>
        <View style={styles.headerText}>
          <View style={styles.headingRow}>
            <Text style={[styles.heading, { color: t.text }]} numberOfLines={1}>
              {plant?.name ?? " "}
            </Text>
            {/* F39 (D-W4): the number on the stake, and the flag when the
                physical tag is gone — colour plus the word, both. */}
            {tag ? (
              <View style={[styles.tagChip, { borderColor: t.border }]} accessibilityLabel={`Number ${tag}`}>
                <Text style={[styles.tagChipText, { color: t.text }]} numberOfLines={1}>
                  #{tag}
                </Text>
              </View>
            ) : null}
            {tagMissing ? (
              <View style={[styles.tagChip, { borderColor: amber, backgroundColor: amber + "22" }]}>
                <Text style={[styles.tagChipText, { color: amber }]} numberOfLines={1}>
                  ⚠ Tag missing
                </Text>
              </View>
            ) : null}
          </View>
          {plant ? (
            <Text style={[styles.subLabel, { color: t.sub }]} numberOfLines={1}>
              {plantSubLabel(plant) || "No details provided"}
            </Text>
          ) : null}
        </View>
        <HealthRing score={latest?.score ?? null} t={t} scheme={scheme} />
      </View>

      {error ? <Text style={[styles.errorBanner, { color: t.danger }]}>{error}</Text> : null}

      {data === null && !error ? (
        <View style={styles.center}>
          <ActivityIndicator color={t.green} />
        </View>
      ) : plant ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          {trend ? (
            <View style={[styles.trendChip, { borderColor: deltaColor(latest?.delta ?? null, t, scheme) }]}>
              <Text style={[styles.trendChipText, { color: deltaColor(latest?.delta ?? null, t, scheme) }]}>
                {trend}
              </Text>
            </View>
          ) : null}

          <QuarantineCard plant={plant} t={t} scheme={scheme} />

          {/* F20 — weather-aware watering. Renders from the plant row's care
              profile + the ZIP's cached forecast; degrades to a hint (no ZIP)
              or a retry (no profile) rather than an error. */}
          <WateringCard plant={plant} createdAt={plant.created_at} t={t} onProfileGenerated={load} />

          {/* F37 — the AI-generated plant reference (difficulty, light, temps,
              size, seasons). Renders only once a care profile exists. */}
          <PlantInfoCard plant={plant} t={t} onProfileGenerated={load} />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Assess this plant"
            onPress={() => setCapturing(true)}
            style={[styles.assess, { backgroundColor: t.green }]}
          >
            <Text style={[styles.assessText, { color: t.onGreen }]}>
              {timeline.length === 0 ? "📷 Assess now" : "📷 Assess this plant"}
            </Text>
          </Pressable>

          {/* F38 + F23 — the two per-plant on-device tools (ask / prune). */}
          <PlantToolsCard plant={plant} t={t} onChanged={load} />

          {/* F39 (D-W4) — how a walk photo finds this plant: stake number,
              bound codes, tag photo, tag-missing flag. */}
          <PlantTagsCard
            plant={plant}
            t={t}
            scheme={scheme}
            onChanged={() => {
              load();
              onChanged();
            }}
          />

          <View style={styles.secondaryRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit plant"
              onPress={() => setEditing(true)}
              style={[styles.secondary, { borderColor: t.border, backgroundColor: t.card }]}
            >
              <Text style={[styles.secondaryText, { color: t.text }]}>Edit</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete plant"
              disabled={deleting}
              onPress={confirmDelete}
              style={[styles.secondary, { borderColor: t.danger, opacity: deleting ? 0.6 : 1 }]}
            >
              {deleting ? (
                <ActivityIndicator color={t.danger} />
              ) : (
                <Text style={[styles.secondaryText, { color: t.danger }]}>Delete</Text>
              )}
            </Pressable>
          </View>

          {/* F39: this plant's photos still waiting for analysis (hidden when
              none). Not timeline rows — nothing is scored yet. */}
          <PendingPhotosStrip
            plantId={plantId}
            refreshToken={loadCount}
            onChanged={() => {
              load();
              onChanged();
            }}
          />

          {pair ? (
            <BeforeAfterSlider
              before={{ source: { uri: pair.before.localUri! }, dateLabel: pair.before.dateLabel }}
              after={{ source: { uri: pair.after.localUri! }, dateLabel: pair.after.dateLabel }}
              t={t}
            />
          ) : null}

          <Text style={[styles.sectionTitle, { color: t.sub }]}>TIMELINE</Text>
          {timeline.length === 0 ? (
            <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
              <Text style={[styles.emptyTitle, { color: t.text }]}>No assessments yet</Text>
              <Text style={[styles.emptyBody, { color: t.sub }]}>
                Capture your first photo to see this plant's health history here.
              </Text>
            </View>
          ) : (
            timeline.map((entry, i) => (
              <Fragment key={entry.id}>
                <TimelineRowCard
                  entry={entry}
                  onPress={() => openRow(entry)}
                  onViewPhoto={
                    entry.localUri
                      ? () =>
                          setViewingPhoto({
                            uri: entry.localUri!,
                            caption: `${data?.plant.name ?? "Plant"} · ${entry.dateLabel}`,
                          })
                      : undefined
                  }
                  t={t}
                  scheme={scheme}
                />
                {/* F39 Phase 6b: a misattributed walk is the failure mode
                    (garden-walk.md §2) — one confirmed tap takes the whole
                    run back out, under the rows it would remove. */}
                {i === undoAfterIndex && walkUndo ? (
                  <Pressable
                    accessibilityRole="button"
                    // An explicit label replaces the children in the a11y tree,
                    // so the blast radius has to be IN it — this deletes rows
                    // and photo files on plants that are not on this screen.
                    accessibilityLabel={
                      `Undo this walk. Removes ${walkUndo.count} ${walkUndo.count === 1 ? "assessment" : "assessments"}` +
                      (walkUndo.plants > 1 ? ` on ${walkUndo.plants} plants` : "") +
                      `, ${walkUndo.rowIds.size} of them here, and their photos`
                    }
                    accessibilityState={{ disabled: undoingWalk }}
                    disabled={undoingWalk}
                    onPress={confirmUndoWalk}
                    hitSlop={8}
                    style={[styles.undoWalk, { opacity: undoingWalk ? 0.6 : 1 }]}
                  >
                    {undoingWalk ? (
                      <ActivityIndicator color={t.danger} />
                    ) : (
                      <Text style={[styles.undoWalkText, { color: t.danger }]}>Undo this walk</Text>
                    )}
                    {/* The part on screen first — "5 assessments" under two
                        visible rows reads as a miscount, not as a warning. */}
                    <Text style={[styles.undoWalkMeta, { color: t.text }]}>
                      {walkUndo.plants > 1
                        ? `${walkUndo.rowIds.size} here · ${walkUndo.count} in all`
                        : `${walkUndo.count} ${walkUndo.count === 1 ? "assessment" : "assessments"}`}
                    </Text>
                  </Pressable>
                ) : null}
              </Fragment>
            ))
          )}
        </ScrollView>
      ) : null}

      <PhotoViewer photo={viewingPhoto} onClose={() => setViewingPhoto(null)} />

      {plant ? (
        <NewPlantSheet
          visible={editing}
          plant={plant}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
            onChanged();
          }}
        />
      ) : null}

      {/* Nested modals: capture + a historical diagnosis, both over the detail. */}
      <Modal visible={capturing} animationType="slide" onRequestClose={() => setCapturing(false)}>
        <CaptureScreen
          initialPlantId={plantId}
          onClose={() => setCapturing(false)}
          onAssessed={() => {
            load();
            onChanged();
          }}
        />
      </Modal>
      <Modal
        visible={viewing !== null}
        animationType="slide"
        onRequestClose={() => setViewing(null)}
      >
        {viewing && plant ? (
          <DiagnosisScreen
            diagnosis={viewing.diagnosis}
            plantId={plant.id}
            plantName={plant.name}
            onDone={() => setViewing(null)}
          />
        ) : null}
      </Modal>
    </View>
  );
}

function TimelineRowCard({
  entry,
  onPress,
  onViewPhoto,
  t,
  scheme,
}: {
  entry: TimelineEntry;
  onPress: () => void;
  /** Tap on the thumbnail: the photo full-screen (row tap stays the diagnosis). */
  onViewPhoto?: () => void;
  t: Tokens;
  scheme: "light" | "dark";
}) {
  const band = healthBand(entry.score);
  const scoreColor = bandColor(band.key, scheme);
  const chipColor = entry.delta ? deltaColor(entry.delta, t, scheme) : t.sub;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Assessment on ${entry.dateLabel}, health ${entry.score}`}
      onPress={onPress}
      style={[styles.card, styles.row, { backgroundColor: t.card, borderColor: t.border }]}
    >
      {/* Local photo when this phone has one; neutral placeholder otherwise.
          The thumb is its own target: photo full-screen, row → diagnosis. */}
      {entry.localUri && onViewPhoto ? (
        <Pressable
          accessibilityRole="imagebutton"
          accessibilityLabel={`View the ${entry.dateLabel} photo full screen`}
          onPress={onViewPhoto}
          hitSlop={6}
        >
          <Image
            source={{ uri: entry.localUri }}
            style={styles.thumb}
            accessibilityLabel="Assessment photo"
          />
        </Pressable>
      ) : (
        <View style={[styles.thumb, { backgroundColor: t.border }]} />
      )}
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowDate, { color: t.text }]} numberOfLines={1}>
            {entry.dateLabel}
          </Text>
          <Text style={[styles.rowScore, { color: scoreColor }]}>{entry.score}</Text>
        </View>
        <View style={styles.rowMeta}>
          {entry.deltaLabel ? (
            <View style={[styles.deltaChip, { backgroundColor: chipColor + "22" }]}>
              <Text style={[styles.deltaChipText, { color: chipColor }]}>{entry.deltaLabel}</Text>
            </View>
          ) : null}
        </View>
        {entry.summary ? (
          <Text style={[styles.rowSummary, { color: t.sub }]} numberOfLines={2}>
            {entry.summary}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function HealthRing({
  score,
  t,
  scheme,
}: {
  score: number | null;
  t: Tokens;
  scheme: "light" | "dark";
}) {
  if (score === null) {
    return (
      <View
        accessibilityLabel="No assessments yet"
        style={[styles.ring, { borderColor: t.border, borderStyle: "dashed" }]}
      >
        <Text style={[styles.ringText, { color: t.sub }]}>–</Text>
      </View>
    );
  }
  const band = healthBand(score);
  const color = bandColor(band.key, scheme);
  return (
    <View
      accessibilityLabel={`Health ${score}, ${band.label}`}
      style={[styles.ring, { borderColor: color }]}
    >
      <Text style={[styles.ringText, { color }]}>{score}</Text>
    </View>
  );
}

/** Web badge colors: Better emerald, Same amber, Worse red, Unknown/none gray. */
function deltaColor(delta: TimelineDelta | null, t: Tokens, scheme: "light" | "dark"): string {
  if (delta === "better") return bandColor("good", scheme);
  if (delta === "same") return bandColor("fair", scheme);
  if (delta === "worse") return bandColor("poor", scheme);
  return t.sub;
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 68 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  backGlyph: { fontSize: 22, fontWeight: "600", marginTop: -2 },
  headerText: { flex: 1, gap: 2 },
  headingRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  heading: { fontSize: 22, fontWeight: "600", letterSpacing: -0.4, flexShrink: 1 },
  tagChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    maxWidth: 160,
  },
  tagChipText: { fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] },
  subLabel: { fontSize: 13 },
  errorBanner: { fontSize: 13, paddingHorizontal: 20, marginBottom: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { paddingHorizontal: 20, paddingBottom: 40, gap: 12 },
  trendChip: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  trendChipText: { fontSize: 13, fontWeight: "700" },
  assess: {
    borderRadius: RADIUS,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  assessText: { fontSize: 16, fontWeight: "600" },
  secondaryRow: { flexDirection: "row", gap: 10 },
  secondary: {
    flex: 1,
    borderWidth: 1,
    borderRadius: RADIUS,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { fontSize: 14, fontWeight: "600" },
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginTop: 4 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS,
    padding: 14,
    gap: 4,
  },
  row: { flexDirection: "row", gap: 12, alignItems: "center" },
  thumb: { width: 56, height: 56, borderRadius: RADIUS - 3 },
  rowBody: { flex: 1, gap: 3 },
  rowTop: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
  },
  rowDate: { fontSize: 14, fontWeight: "600", flexShrink: 1 },
  rowScore: { fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  rowMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  deltaChip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  deltaChipText: { fontSize: 11, fontWeight: "700" },
  rowSummary: { fontSize: 13, lineHeight: 18 },
  emptyTitle: { fontSize: 15, fontWeight: "600" },
  emptyBody: { fontSize: 13, lineHeight: 19 },
  undoWalk: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    // A destructive control: a full 48 dp target, not a 32 dp one padded out
    // by hit slop.
    minHeight: 48,
    paddingHorizontal: 4,
    marginTop: -4,
  },
  undoWalkText: { fontSize: 13, fontWeight: "600", textDecorationLine: "underline" },
  undoWalkMeta: { fontSize: 12 },
  ring: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3.5,
    alignItems: "center",
    justifyContent: "center",
  },
  ringText: { fontSize: 13, fontWeight: "700" },
});
