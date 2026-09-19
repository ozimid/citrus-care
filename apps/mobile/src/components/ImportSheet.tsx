// F39 gallery import: what the user sees between "I picked 12 photos" and the
// review screen. Two honest states and nothing else (D-W8: no percentage bar
// for work we cannot measure): the indeterminate "Loading your photos…" while
// the picker's copies are still arriving, then the determinate "Importing 7 of
// 12…" — a true count, because each asset is persisted before the next starts.
// Holds the screen awake under its own tag so a 30-photo import on a 30 s
// screen timeout never dies half-way (tags never fight another flow's hold).

import { ActivityIndicator, Modal, StyleSheet, Text, View } from "react-native";
import { useKeepAwakeWhile } from "../lib/keep-awake-io";
import { RADIUS } from "../lib/theme";
import { useTheme } from "../lib/theme-io";

export type ImportProgress =
  /** The picker has returned (or is about to); nothing is counted yet. */
  | { kind: "picking" }
  /** `done` of `total` assets are durable on this phone. */
  | { kind: "importing"; done: number; total: number };

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

  return (
    // Back does nothing on purpose: the import must not be abandoned half-way.
    <Modal visible={progress !== null} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View
          style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}
          accessibilityLiveRegion="polite"
          accessibilityLabel={line}
        >
          <ActivityIndicator color={t.green} size="large" />
          <Text style={[styles.line, { color: t.text }]}>{line}</Text>
          <Text style={[styles.hint, { color: t.sub }]}>
            {progress?.kind === "importing"
              ? "Each photo is saved on this phone as it arrives."
              : "Copying them from your gallery."}
          </Text>
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
