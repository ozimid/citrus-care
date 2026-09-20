// F39 gallery import: what the user sees between "I picked 12 photos" and the
// review screen. Two honest states and nothing else (D-W8: no percentage bar
// for work we cannot measure): the indeterminate "Loading your photos…" while
// the picker's copies are still arriving, then the determinate "Importing 7 of
// 12…" — a true count, because each asset is persisted before the next starts.
// Holds the screen awake under its own tag so a 30-photo import on a 30 s
// screen timeout never dies half-way (tags never fight another flow's hold).
// Phase 4: after each photo is saved the io looks for a tag code on it (rung
// 3), so the hint under the count says both halves in ONE stable line — the
// count ticking once per photo is the liveness signal; a line that flipped
// twice per photo would be motion, not information. The io still reports the
// phase (ImportPhase) for a future line with a measured expectation; until
// the Phase 0 decode probe exists no duration is claimed here (D-W8).

import { ActivityIndicator, Modal, StyleSheet, Text, View } from "react-native";
import { useKeepAwakeWhile } from "../lib/keep-awake-io";
import type { ImportPhase } from "../lib/photo-queue-io";
import { RADIUS } from "../lib/theme";
import { useTheme } from "../lib/theme-io";

export type ImportProgress =
  /** The picker has returned (or is about to); nothing is counted yet. */
  | { kind: "picking" }
  /** `done` of `total` assets are durable on this phone. `phase` says what
   * the current one is going through; absent means saving. */
  | { kind: "importing"; done: number; total: number; phase?: ImportPhase };

interface Props {
  /** Null = hidden. */
  progress: ImportProgress | null;
}

export function ImportSheet({ progress }: Props) {
  const { t } = useTheme();
  useKeepAwakeWhile(progress !== null, "walk-import");

  const line =
    progress?.kind === "importing"
      ? `Importing ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
      : "Loading your photos…";
  const hint =
    progress?.kind !== "importing"
      ? "Copying them from your gallery."
      : "Each photo is saved on this phone as it arrives, then checked for a tag code.";

  return (
    // Back does nothing on purpose: the import must not be abandoned half-way.
    <Modal visible={progress !== null} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View
          style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${line} ${hint}`}
        >
          <ActivityIndicator color={t.green} size="large" />
          <Text style={[styles.line, { color: t.text }]}>{line}</Text>
          <Text style={[styles.hint, { color: t.sub }]}>{hint}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    padding: 28,
  },
  card: {
    width: "100%",
    maxWidth: 340,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS + 4,
    padding: 24,
    alignItems: "center",
    gap: 12,
  },
  line: { fontSize: 16, fontWeight: "600", textAlign: "center" },
  hint: { fontSize: 13, lineHeight: 18, textAlign: "center" },
});
