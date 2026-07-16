import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import type { PlantListItem } from "../lib/plants";
import { RADIUS } from "../lib/theme";
import { useTheme } from "../lib/theme-io";

// Simple picker sheet: the capture FAB needs a target plant when the user has
// more than one (preselected automatically when there is exactly one — see
// preselectedPlantId in src/lib/capture-modes.ts).

interface Props {
  visible: boolean;
  plants: PlantListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function PlantPickerSheet({ visible, plants, selectedId, onSelect, onClose }: Props) {
  const { t } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel="Close" style={styles.backdropTouch} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: t.card }]}>
          <Text style={[styles.title, { color: t.text }]}>Which plant is this?</Text>
          <FlatList
            data={plants}
            keyExtractor={(item) => item.id}
            style={styles.list}
            renderItem={({ item }) => {
              const selected = item.id === selectedId;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onSelect(item.id)}
                  style={[styles.row, { borderBottomColor: t.border }]}
                >
                  <View style={styles.rowText}>
                    <Text style={[styles.rowName, { color: selected ? t.green : t.text }]}>
                      {item.name}
                    </Text>
                    {item.subLabel ? (
                      <Text style={[styles.rowSub, { color: t.sub }]} numberOfLines={1}>
                        {item.subLabel}
                      </Text>
                    ) : null}
                  </View>
                  {selected ? <Text style={{ color: t.green }}>✓</Text> : null}
                </Pressable>
              );
            }}
          />
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={[styles.cancel, { borderColor: t.border }]}
          >
            <Text style={[styles.cancelText, { color: t.sub }]}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  backdropTouch: { flex: 1 },
  sheet: {
    borderTopLeftRadius: RADIUS + 6,
    borderTopRightRadius: RADIUS + 6,
    paddingTop: 18,
    paddingHorizontal: 20,
    paddingBottom: 34,
    maxHeight: "70%",
  },
  title: { fontSize: 19, fontWeight: "600", letterSpacing: -0.3, marginBottom: 8 },
  list: { flexGrow: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, gap: 2 },
  rowName: { fontSize: 16, fontWeight: "600" },
  rowSub: { fontSize: 12 },
  cancel: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: RADIUS,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { fontSize: 15, fontWeight: "600" },
});
