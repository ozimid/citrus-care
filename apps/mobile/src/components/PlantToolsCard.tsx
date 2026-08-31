// The two on-device tools that act on one plant rather than on one photo:
// F38 "Ask about this plant" and F23 "Where to prune". Both open as modals over
// the plant detail screen, and both own their own state — the detail screen
// only tells them which plant it is showing.
//
// Grouped in one component so the detail screen (already the longest in the
// app) gains a row and two lines rather than two flows.

import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { RADIUS, type Tokens } from "../lib/theme";
import { PlantChatScreen } from "../screens/PlantChatScreen";
import { PruneScreen } from "../screens/PruneScreen";

interface PlantInput {
  id: string;
  name: string;
  plant_type: string;
  species: string | null;
  cultivar: string | null;
  zip_code?: string | null;
}

interface Props {
  plant: PlantInput;
  t: Tokens;
  /** A pruning plan was stored — the detail screen may want to reload. */
  onChanged?: () => void;
}

export function PlantToolsCard({ plant, t, onChanged }: Props) {
  const [asking, setAsking] = useState(false);
  const [pruning, setPruning] = useState(false);

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Ask a question about ${plant.name}`}
        onPress={() => setAsking(true)}
        style={[styles.tool, { borderColor: t.border, backgroundColor: t.card }]}
      >
        <Text style={styles.glyph}>💬</Text>
        <Text style={[styles.label, { color: t.text }]}>Ask about it</Text>
        <Text style={[styles.hint, { color: t.sub }]} numberOfLines={1}>
          Answers from this plant&apos;s own record
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Show where to prune ${plant.name}`}
        onPress={() => setPruning(true)}
        style={[styles.tool, { borderColor: t.border, backgroundColor: t.card }]}
      >
        <Text style={styles.glyph}>✂️</Text>
        <Text style={[styles.label, { color: t.text }]}>Where to prune</Text>
        <Text style={[styles.hint, { color: t.sub }]} numberOfLines={1}>
          Cuts marked on your photo
        </Text>
      </Pressable>

      <Modal visible={asking} animationType="slide" onRequestClose={() => setAsking(false)}>
        <PlantChatScreen plantId={plant.id} plantName={plant.name} onClose={() => setAsking(false)} />
      </Modal>
      <Modal visible={pruning} animationType="slide" onRequestClose={() => setPruning(false)}>
        <PruneScreen plant={plant} onClose={() => setPruning(false)} onChanged={onChanged} />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10 },
  tool: {
    flex: 1,
    borderWidth: 1,
    borderRadius: RADIUS,
    padding: 12,
    gap: 2,
    minHeight: 84,
    justifyContent: "center",
  },
  glyph: { fontSize: 18 },
  label: { fontSize: 14, fontWeight: "700" },
  hint: { fontSize: 11 },
});
