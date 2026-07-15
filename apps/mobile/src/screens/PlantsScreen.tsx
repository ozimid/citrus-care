import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { NewPlantSheet } from "../components/NewPlantSheet";
import { bandColor, healthBand } from "../lib/health";
import { fetchPlants, type PlantListItem } from "../lib/plants";
import { supabase } from "../lib/supabase";
import { RADIUS, useTheme, type Tokens } from "../lib/theme";
import { PlantDetailScreen } from "./PlantDetailScreen";

// Plants tab per the native design doc §3/§4: card rows with name, species
// line, latest-trend chip and a health ring colored by the shared score
// bands. RLS scopes the query to the signed-in user; pull-to-refresh re-runs
// it. Tapping a card opens the plant detail modal; the "Add plant" button
// (header + empty state) opens the new-plant sheet.

const GENERIC_LOAD_ERROR = "Could not load your plants. Pull to retry.";

export function PlantsScreen({ refreshToken = 0 }: { refreshToken?: number }) {
  const { t, scheme } = useTheme();
  const [items, setItems] = useState<PlantListItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const plants = await fetchPlants(supabase);
      setItems(plants);
      setError(null);
    } catch {
      // fetchPlants already logged the details; show only a generic message.
      setError(GENERIC_LOAD_ERROR);
      setItems((prev) => prev ?? []);
    }
  }, []);

  // refreshToken bumps when a new assessment lands (App.tsx) so the fresh
  // score is already on screen when the capture modal closes.
  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <View style={[styles.container, { backgroundColor: t.canvas }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.heading, { color: t.text }]}>Your plants</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add plant"
          onPress={() => setAdding(true)}
          style={[styles.addButton, { backgroundColor: t.green }]}
        >
          <Text style={[styles.addButtonText, { color: t.onGreen }]}>＋ Add plant</Text>
        </Pressable>
      </View>
      {error ? <Text style={[styles.errorBanner, { color: t.danger }]}>{error}</Text> : null}
      {items === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={t.green} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={items.length === 0 ? styles.emptyGrow : styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.green} />
          }
          ListEmptyComponent={
            error ? null : <EmptyState t={t} onAdd={() => setAdding(true)} />
          }
          renderItem={({ item }) => (
            <PlantCard item={item} t={t} scheme={scheme} onPress={() => setDetailId(item.id)} />
          )}
        />
      )}
      <NewPlantSheet
        visible={adding}
        onClose={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          load();
        }}
      />
      {/* Plant detail over the tab (Modal pattern like the capture flow). */}
      <Modal
        visible={detailId !== null}
        animationType="slide"
        onRequestClose={() => setDetailId(null)}
      >
        {detailId ? (
          <PlantDetailScreen
            plantId={detailId}
            onClose={() => setDetailId(null)}
            onChanged={load}
          />
        ) : null}
      </Modal>
    </View>
  );
}

function PlantCard({
  item,
  t,
  scheme,
  onPress,
}: {
  item: PlantListItem;
  t: Tokens;
  scheme: "light" | "dark";
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.name}`}
      onPress={onPress}
      style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}
    >
      <View style={styles.cardText}>
        <Text style={[styles.cardName, { color: t.text }]} numberOfLines={1}>
          {item.name}
        </Text>
        {item.subLabel ? (
          <Text style={[styles.cardSub, { color: t.sub }]} numberOfLines={1}>
            {item.subLabel}
          </Text>
        ) : null}
        {item.trend ? <TrendChip trend={item.trend} t={t} scheme={scheme} /> : null}
      </View>
      <HealthRing score={item.latestScore} t={t} scheme={scheme} />
    </Pressable>
  );
}

/** "Better"/"Same"/"Worse"/"Unknown"/"First assessment" in the web badge colors. */
function TrendChip({ trend, t, scheme }: { trend: string; t: Tokens; scheme: "light" | "dark" }) {
  const color =
    trend === "Better"
      ? bandColor("good", scheme)
      : trend === "Same"
        ? bandColor("fair", scheme)
        : trend === "Worse"
          ? bandColor("poor", scheme)
          : t.sub;
  return (
    <View style={[styles.trendChip, { backgroundColor: color + "22" }]}>
      <Text style={[styles.trendChipText, { color }]}>{trend}</Text>
    </View>
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

function EmptyState({ t, onAdd }: { t: Tokens; onAdd: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={[styles.emptyTitle, { color: t.text }]}>No plants yet</Text>
      <Text style={[styles.emptyBody, { color: t.sub }]}>
        Add your first plant to start tracking its health.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add plant"
        onPress={onAdd}
        style={[styles.emptyCta, { backgroundColor: t.green }]}
      >
        <Text style={[styles.emptyCtaText, { color: t.onGreen }]}>Add plant</Text>
      </Pressable>
    </View>
  );
}

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 68 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    marginBottom: 12,
    gap: 12,
  },
  heading: {
    fontSize: 24,
    fontWeight: "600",
    letterSpacing: -0.4,
  },
  addButton: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addButtonText: { fontSize: 13, fontWeight: "600" },
  errorBanner: { fontSize: 13, paddingHorizontal: 20, marginBottom: 8 },
  listContent: { paddingHorizontal: 20, paddingBottom: 24, gap: 10 },
  emptyGrow: { flexGrow: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 8 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS,
    padding: 16,
  },
  cardText: { flex: 1, gap: 2, alignItems: "flex-start" },
  cardName: { fontSize: 16, fontWeight: "600" },
  cardSub: { fontSize: 13 },
  trendChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 3,
  },
  trendChipText: { fontSize: 11, fontWeight: "700" },
  ring: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3.5,
    alignItems: "center",
    justifyContent: "center",
  },
  ringText: { fontSize: 13, fontWeight: "700", fontFamily: MONO },
  emptyTitle: { fontSize: 15, fontWeight: "600" },
  emptyBody: { fontSize: 14, lineHeight: 20, textAlign: "center", maxWidth: 280 },
  emptyCta: {
    marginTop: 8,
    borderRadius: RADIUS,
    paddingVertical: 11,
    paddingHorizontal: 22,
    minHeight: 44,
    justifyContent: "center",
  },
  emptyCtaText: { fontSize: 14, fontWeight: "600" },
});
