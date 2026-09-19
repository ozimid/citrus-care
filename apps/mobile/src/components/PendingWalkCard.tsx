// F39: the Plants-tab card that says photos are waiting. Pending photos are
// not timeline rows and not in a backup (D-W11), so the one place they are
// visible from the home tab has to say both. It has ONE action — Review —
// because "Analyze now / Later" is asked on the screen that shows what the
// answer spends the next twenty minutes on (D-W7), never from here. Owns the
// Modal that hosts the review screen (the PlantToolsCard pattern) — Plants
// only learns "something changed" when the modal closes. "Analyze now" on the
// review swaps in WalkRunScreen inside the same Modal; it runs the photos one
// at a time (D-W5) and the card reloads once, when the run's summary closes.

import { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { pendingCount, type QueuedPhoto } from "../lib/photo-queue";
import { loadPhotoQueue } from "../lib/photo-queue-io";
import type { PlantListItem } from "../lib/plants";
import { fetchPlants } from "../lib/plants-io";
import { RADIUS } from "../lib/theme";
import { useTheme } from "../lib/theme-io";
import { WalkReviewScreen } from "../screens/WalkReviewScreen";
import { WalkRunScreen } from "../screens/WalkRunScreen";

interface Props {
  /** The review modal closed — the list may need a reload. */
  onChanged: () => void;
  /** Bump to re-read the queue (the Plants list reloaded). */
  refreshToken?: number;
}

export function PendingWalkCard({ onChanged, refreshToken = 0 }: Props) {
  const { t } = useTheme();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  /** The review handed off to the run: its runnable photos and the plants they name. */
  const [run, setRun] = useState<{ items: QueuedPhoto[]; plants: PlantListItem[] } | null>(null);

  const load = useCallback(async () => {
    // loadPhotoQueue degrades to {} — a read failure hides the card, never
    // throws into the list.
    setCount(pendingCount(await loadPhotoQueue()));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const close = useCallback(() => {
    setOpen(false);
    setRun(null);
    void load();
    onChanged();
  }, [load, onChanged]);

  const startRun = useCallback(async (items: QueuedPhoto[]) => {
    let plants: PlantListItem[] = [];
    try {
      plants = await fetchPlants();
    } catch {
      // fetchPlants already logged; the run names what it can.
    }
    setRun({ items, plants });
  }, []);

  // Never while the modal is up: the run removes records as it goes, and a
  // reload landing at zero must not unmount the screen doing the work.
  if (count === 0 && !open) return null;
  const line = count === 1 ? "1 photo is waiting to be analyzed" : `${count} photos are waiting to be analyzed`;

  return (
    <View
      style={[styles.card, { backgroundColor: t.card, borderColor: t.green }]}
      accessibilityLiveRegion="polite"
    >
      <Text style={[styles.title, { color: t.text }]}>📥 {line}</Text>
      <Text style={[styles.body, { color: t.sub }]}>Saved on this phone. Not in a backup until analyzed.</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Review the ${count} waiting ${count === 1 ? "photo" : "photos"}`}
        onPress={() => setOpen(true)}
        style={[styles.button, { borderColor: t.green, backgroundColor: t.green }]}
      >
        <Text style={[styles.buttonText, { color: t.onGreen }]}>
          Review {count} {count === 1 ? "photo" : "photos"}
        </Text>
      </Pressable>

      {/* While the run is up, WalkRunScreen's own Modal owns the hardware back
          (stop after this photo) — this one must not close underneath it. */}
      <Modal visible={open} animationType="slide" onRequestClose={run ? () => {} : close}>
        {open && run ? (
          <WalkRunScreen items={run.items} plants={run.plants} onFinished={() => {}} onClose={close} />
        ) : open ? (
          <WalkReviewScreen
            walkId={null}
            onAnalyze={(items) => void startRun(items)}
            onLater={close}
            onClose={close}
            onChanged={load}
          />
        ) : null}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1.5,
    borderRadius: RADIUS,
    padding: 14,
    gap: 6,
    marginBottom: 10,
  },
  title: { fontSize: 15, fontWeight: "700" },
  body: { fontSize: 13, lineHeight: 18 },
  button: {
    marginTop: 4,
    borderWidth: 1,
    borderRadius: RADIUS,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { fontSize: 15, fontWeight: "600" },
});
