// F39: the Plants-tab card that says photos are waiting. Pending photos are
// not timeline rows and not in a backup (D-W11), so the one place they are
// visible from the home tab has to say both. It has ONE action — Review —
// because "Analyze now / Later" is asked on the screen that shows what the
// answer spends the next twenty minutes on (D-W7), never from here. Owns the
// Modal that hosts the review screen (the PlantToolsCard pattern) — Plants
// only learns "something changed" when the modal closes.

import { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { pendingCount } from "../lib/photo-queue";
import { loadPhotoQueue } from "../lib/photo-queue-io";
import { RADIUS } from "../lib/theme";
import { useTheme } from "../lib/theme-io";
import { BATCH_ANALYSIS_STUB_NOTICE, WalkReviewScreen } from "../screens/WalkReviewScreen";

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
  const [notice, setNotice] = useState<string | null>(null);

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
    setNotice(null);
    void load();
    onChanged();
  }, [load, onChanged]);

  if (count === 0) return null;
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

      <Modal visible={open} animationType="slide" onRequestClose={close}>
        {open ? (
          <WalkReviewScreen
            walkId={null}
            notice={notice}
            // Phase 1: the batch runner lands next; items stay pending.
            onAnalyze={() => setNotice(BATCH_ANALYSIS_STUB_NOTICE)}
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
