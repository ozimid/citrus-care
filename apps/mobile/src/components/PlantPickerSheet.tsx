import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { filterPlantsByQuery } from "../lib/capture-modes";
import type { PlantListItem } from "../lib/plants";
import { RADIUS } from "../lib/theme";
import { useTheme } from "../lib/theme-io";

// Plant picker sheet: the capture FAB needs a target plant when the user has
// more than one (preselected automatically when there is exactly one — see
// preselectedPlantId in src/lib/capture-modes.ts). F39 grew it for a garden of
// thirty: a search field ("Name or number" — a numbered stake is typed in two
// digits), a cover thumbnail per row so five lemon trees are told apart by
// their photo, and two optional slots the walk review uses — a footer (the
// "also the photos after this one" toggle) and a "New plant…" row.

interface Props {
  visible: boolean;
  plants: PlantListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  /** Default "Which plant is this?" — the review asks per group. */
  title?: string;
  /** Rendered between the list and Cancel (e.g. a run toggle). */
  footer?: ReactNode;
  /** When set, a "New plant…" row closes the list. */
  onNewPlant?: () => void;
}

export function PlantPickerSheet({
  visible,
  plants,
  selectedId,
  onSelect,
  onClose,
  title = "Which plant is this?",
  footer,
  onNewPlant,
}: Props) {
  const { t } = useTheme();
  const [query, setQuery] = useState("");
  // A fresh open starts unfiltered — the last search must not hide the list.
  useEffect(() => {
    if (visible) setQuery("");
  }, [visible]);
  const shown = useMemo(() => filterPlantsByQuery(plants, query), [plants, query]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel="Close" style={styles.backdropTouch} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: t.card }]}>
          <Text style={[styles.title, { color: t.text }]}>{title}</Text>
          {/* No autofocus: the keyboard must not jump a gloved thumb. */}
          <TextInput
            accessibilityLabel="Search plants by name or number"
            placeholder="Name or number"
            placeholderTextColor={t.sub}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            style={[styles.search, { borderColor: t.border, color: t.text, backgroundColor: t.canvas }]}
          />
          <FlatList
            data={shown}
            keyExtractor={(item) => item.id}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={[styles.empty, { color: t.sub }]}>
                {query ? "No plant matches that." : "No plants yet."}
              </Text>
            }
            renderItem={({ item }) => {
              const selected = item.id === selectedId;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}${item.subLabel ? `, ${item.subLabel}` : ""}`}
                  accessibilityState={{ selected }}
                  onPress={() => onSelect(item.id)}
                  style={[styles.row, { borderBottomColor: t.border }]}
                >
                  {item.coverUri ? (
                    <Image source={{ uri: item.coverUri }} style={styles.thumb} />
                  ) : (
                    <View style={[styles.thumb, styles.thumbEmpty, { borderColor: t.border }]}>
                      <Text style={styles.thumbGlyph}>🪴</Text>
                    </View>
                  )}
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
            ListFooterComponent={
              onNewPlant ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="New plant"
                  onPress={onNewPlant}
                  style={[styles.row, { borderBottomColor: t.border }]}
                >
                  <View style={[styles.thumb, styles.thumbEmpty, { borderColor: t.green }]}>
                    <Text style={[styles.thumbGlyph, { color: t.green }]}>＋</Text>
                  </View>
                  <Text style={[styles.rowName, { color: t.green }]}>New plant…</Text>
                </Pressable>
              ) : null
            }
          />
          {footer ?? null}
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
    maxHeight: "78%",
  },
  title: { fontSize: 19, fontWeight: "600", letterSpacing: -0.3, marginBottom: 8 },
  search: {
    borderWidth: 1,
    borderRadius: RADIUS,
    minHeight: 48,
    paddingHorizontal: 14,
    fontSize: 16,
    marginBottom: 6,
  },
  list: { flexGrow: 0 },
  empty: { fontSize: 14, paddingVertical: 16, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: 40, height: 40, borderRadius: RADIUS - 3 },
  thumbEmpty: {
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbGlyph: { fontSize: 18 },
  rowText: { flex: 1, gap: 2 },
  rowName: { fontSize: 16, fontWeight: "600" },
  rowSub: { fontSize: 12 },
  cancel: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: RADIUS,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { fontSize: 15, fontWeight: "600" },
});
