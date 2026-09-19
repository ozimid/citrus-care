// F39: a plant's own photos that are waiting for analysis, shown on the detail
// screen above the timeline. They are not timeline rows (no score, no date of
// record) and D-W1 keeps them out of the assessment store, so the strip is the
// only place a plant's pending shots are visible. Tap → full screen; long
// press → remove (the one confirm); Review → the sectioned review, narrowed
// to this plant.

import { useCallback, useEffect, useState } from "react";
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { queuedForPlant, type QueuedPhoto } from "../lib/photo-queue";
import { loadPhotoQueue, queuedPhotoUri, removeQueuedPhoto } from "../lib/photo-queue-io";
import { RADIUS } from "../lib/theme";
import { useTheme } from "../lib/theme-io";
import { BATCH_ANALYSIS_STUB_NOTICE, WalkReviewScreen } from "../screens/WalkReviewScreen";
import { PhotoViewer } from "./PhotoViewer";
import { byWalkOrder } from "./WalkReviewSections";

const GENERIC_REMOVE_ERROR = "Couldn't remove that photo. Please try again.";

interface Props {
  plantId: string;
  /** The queue changed — the detail screen may want to reload. */
  onChanged: () => void;
  /** Bump to re-read the queue (the detail screen reloaded). */
  refreshToken?: number;
}

export function PendingPhotosStrip({ plantId, onChanged, refreshToken = 0 }: Props) {
  const { t } = useTheme();
  const [items, setItems] = useState<QueuedPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ uri: string; caption?: string } | null>(null);

  const load = useCallback(async () => {
    setItems(queuedForPlant(await loadPhotoQueue(), plantId).sort(byWalkOrder));
  }, [plantId]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const confirmRemove = useCallback(
    (item: QueuedPhoto) => {
      Alert.alert("Remove this photo?", "It is deleted from this phone. This can't be undone.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await removeQueuedPhoto(item.id);
              setError(null);
              onChanged();
            } catch (e) {
              console.error("[PendingPhotosStrip] remove failed:", (e as Error).message);
              setError(GENERIC_REMOVE_ERROR);
            } finally {
              void load();
            }
          },
        },
      ]);
    },
    [load, onChanged],
  );

  const closeReview = useCallback(() => {
    setReviewing(false);
    setNotice(null);
    void load();
    onChanged();
  }, [load, onChanged]);

  if (items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: t.sub }]}>WAITING FOR ANALYSIS ({items.length})</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Review the ${items.length} waiting ${items.length === 1 ? "photo" : "photos"}`}
          onPress={() => setReviewing(true)}
          hitSlop={8}
          style={styles.review}
        >
          <Text style={[styles.reviewText, { color: t.green }]}>Review</Text>
        </Pressable>
      </View>
      {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {items.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="imagebutton"
            accessibilityLabel="Photo waiting for analysis. Tap to view, hold to remove."
            onPress={() => setViewing({ uri: queuedPhotoUri(item), caption: "Waiting for analysis" })}
            onLongPress={() => confirmRemove(item)}
            style={[styles.thumbWrap, { borderColor: t.border, backgroundColor: t.border }]}
          >
            <Image source={{ uri: queuedPhotoUri(item) }} style={styles.thumb} />
          </Pressable>
        ))}
      </ScrollView>
      <Text style={[styles.hint, { color: t.sub }]}>Not scored yet · not in a backup until analyzed</Text>

      <PhotoViewer photo={viewing} onClose={() => setViewing(null)} />
      <Modal visible={reviewing} animationType="slide" onRequestClose={closeReview}>
        {reviewing ? (
          <WalkReviewScreen
            walkId={null}
            plantFilter={plantId}
            notice={notice}
            // Phase 1: the batch runner lands next; items stay pending.
            onAnalyze={() => setNotice(BATCH_ANALYSIS_STUB_NOTICE)}
            onLater={closeReview}
            onClose={closeReview}
            onChanged={load}
          />
        ) : null}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  review: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  reviewText: { fontSize: 14, fontWeight: "600" },
  error: { fontSize: 13 },
  strip: { gap: 8 },
  thumbWrap: { width: 80, height: 80, borderRadius: RADIUS - 2, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  thumb: { width: "100%", height: "100%" },
  hint: { fontSize: 12 },
});
