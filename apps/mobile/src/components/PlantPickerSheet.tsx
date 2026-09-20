import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { filterPlantsByQuery } from "../lib/capture-modes";
import { bandColor } from "../lib/health";
import { numericTagOrder } from "../lib/plant-tags";
import type { PlantListItem } from "../lib/plants";
import { RADIUS, type Tokens } from "../lib/theme";
import { useTheme } from "../lib/theme-io";

// Plant picker sheet: the capture FAB needs a target plant when the user has
// more than one (preselected automatically when there is exactly one — see
// preselectedPlantId in src/lib/capture-modes.ts). F39 grew it for a garden of
// thirty: a search field ("Name or number" — a numbered stake is typed in two
// digits), a cover thumbnail per row so five lemon trees are told apart by
// their photo, and two optional slots the walk review uses — a footer (the
// "also the photos after this one" toggle) and a "New plant…" row.
// Phase 3 (D-W4): the human number on the stake is co-primary, so the sheet
// opens on a 56 dp numeric tag grid — one gloved tap when the plants are
// numbered — above the search field, and every row wears its "#7" chip. A
// plant flagged "tag missing" says so on its row and tile (amber + ⚠ + the
// words), so a stake that fell off is not picked by a number nobody can see.
// Ranking (exact tag › tag prefix › name/species) is filterPlantsByQuery's.

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
  /** The numeric tag grid above the search field. Default: shown as soon as
   * at least one plant carries a tag. */
  showTagGrid?: boolean;
}

/** Two rows of 56 dp tiles plus a peek of the third — enough to say "this
 * scrolls" without pushing the search field off the sheet. */
const TAG_GRID_MAX_HEIGHT = 56 * 2 + 8 + 12;

export function PlantPickerSheet({
  visible,
  plants,
  selectedId,
  onSelect,
  onClose,
  title = "Which plant is this?",
  footer,
  onNewPlant,
  showTagGrid,
}: Props) {
  const { t, scheme } = useTheme();
  const amber = bandColor("fair", scheme);
  const [query, setQuery] = useState("");
  // A fresh open starts unfiltered — the last search must not hide the list.
  useEffect(() => {
    if (visible) setQuery("");
  }, [visible]);
  const shown = useMemo(() => filterPlantsByQuery(plants, query), [plants, query]);
  const tagged = useMemo(
    () => plants.filter((plant) => typeof plant.tag === "string" && plant.tag.length > 0).sort(numericTagOrder),
    [plants],
  );
  const gridShown = showTagGrid ?? tagged.length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel="Close" style={styles.backdropTouch} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: t.card }]}>
          <Text style={[styles.title, { color: t.text }]}>{title}</Text>
          {gridShown && tagged.length > 0 ? (
            <TagGrid plants={tagged} selectedId={selectedId} onSelect={onSelect} t={t} amber={amber} />
          ) : null}
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
              const tag = item.tag ?? null;
              const missing = item.tagMissing === true;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}${tag ? `, number ${tag}` : ""}${missing ? ", tag missing" : ""}${item.subLabel ? `, ${item.subLabel}` : ""}`}
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
                    <View style={styles.rowNameLine}>
                      <Text
                        style={[styles.rowName, { color: selected ? t.green : t.text }]}
                        numberOfLines={1}
                      >
                        {item.name}
                      </Text>
                      {tag ? (
                        <View style={[styles.tagChip, { borderColor: missing ? amber : selected ? t.green : t.border }]}>
                          <Text style={[styles.tagChipText, { color: missing ? amber : selected ? t.green : t.text }]} numberOfLines={1}>
                            {missing ? `⚠ #${tag}` : `#${tag}`}
                          </Text>
                        </View>
                      ) : null}
                      {missing ? (
                        <Text style={[styles.rowMissing, { color: amber }]} numberOfLines={1}>
                          tag missing
                        </Text>
                      ) : null}
                    </View>
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

/** The numbers on the stakes, in the order they read outdoors ("L2, L3,
 * L10"), each a 56 dp tile: colour AND the ✓ word carry the selected state;
 * an amber border AND ⚠ carry "tag missing". */
function TagGrid({
  plants,
  selectedId,
  onSelect,
  t,
  amber,
}: {
  plants: PlantListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  t: Tokens;
  amber: string;
}) {
  return (
    <ScrollView
      style={styles.gridScroll}
      contentContainerStyle={styles.grid}
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
      accessibilityLabel="Plant numbers"
    >
      {plants.map((plant) => {
        const selected = plant.id === selectedId;
        const missing = plant.tagMissing === true;
        return (
          <Pressable
            key={plant.id}
            accessibilityRole="button"
            accessibilityLabel={`Number ${plant.tag}, ${plant.name}${missing ? ", tag missing" : ""}${selected ? ", selected" : ""}`}
            accessibilityState={{ selected }}
            onPress={() => onSelect(plant.id)}
            style={[
              styles.tile,
              {
                borderColor: missing ? amber : selected ? t.green : t.border,
                borderWidth: missing ? 2 : 1,
                backgroundColor: selected ? t.green : t.canvas,
              },
            ]}
          >
            <Text
              style={[styles.tileText, { color: selected ? t.onGreen : t.text }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {plant.tag}
            </Text>
            {selected ? (
              <Text style={[styles.tileCheck, { color: t.onGreen }]}>✓</Text>
            ) : missing ? (
              <Text style={[styles.tileCheck, { color: amber }]}>⚠</Text>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
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
  gridScroll: { flexGrow: 0, maxHeight: TAG_GRID_MAX_HEIGHT, marginBottom: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: {
    width: 56,
    height: 56,
    borderRadius: RADIUS,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  tileText: { fontSize: 17, fontWeight: "700", fontVariant: ["tabular-nums"] },
  tileCheck: { fontSize: 10, fontWeight: "700", marginTop: -2 },
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
  rowNameLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowName: { fontSize: 16, fontWeight: "600", flexShrink: 1 },
  rowSub: { fontSize: 12 },
  rowMissing: { fontSize: 11, fontWeight: "700" },
  tagChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    maxWidth: 120,
  },
  tagChipText: { fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] },
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
