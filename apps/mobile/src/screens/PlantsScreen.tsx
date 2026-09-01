import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LocalEngineSetupCard } from "../components/LocalEngineSetupCard";
import { PhotoViewer } from "../components/PhotoViewer";
import { NewPlantSheet } from "../components/NewPlantSheet";
import { bandColor, healthBand } from "../lib/health";
import { gardenTrend, type PlantListItem } from "../lib/plants";
import { todayDigest } from "../lib/today-digest";
import { weatherAlertsFor, type WeatherAlert } from "../lib/weather-alerts";
import { scheduleWeatherAlert } from "../lib/reminders";
import {
  loadWeatherAlertMark,
  notificationScheduler,
  saveWeatherAlertMark,
} from "../lib/reminders-io";
import { pruningPackFor, seasonVerdict, type Hemisphere } from "../lib/pruning-rules";
import { cachedDailyByZip, cachedLocalConditions } from "../lib/weather-io";
import { fetchPlants } from "../lib/plants-io";
import { RADIUS, type Tokens } from "../lib/theme";
import { useTheme } from "../lib/theme-io";
import { distinctZips, wateringPlansFor, type WateringPlan } from "../lib/watering";
import { getWateringLog } from "../lib/watering-io";
import { loadWeatherFor } from "../lib/weather-io";
import type { WeatherSummary } from "../lib/weather";
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
  const [plans, setPlans] = useState<Record<string, WateringPlan>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  /** Full-screen photo (tap a card's thumbnail). */
  const [viewing, setViewing] = useState<{ uri: string; caption?: string } | null>(null);
  /** #5/#8 — tonight's weather alert (if any), for the Today card + a local
   * notification. Deterministic; scheduled only when permission already
   * granted (a list view must never throw a permission prompt). */
  const [alert, setAlert] = useState<WeatherAlert | null>(null);
  const [hemisphere, setHemisphere] = useState<Hemisphere>("northern");

  /**
   * F20 chips, computed for the whole list in one pass AFTER the plants render.
   * The cost is bounded by distinct ZIPs, not cards — twenty plants at one
   * address is one forecast (and usually zero, from the 6h cache). Weather
   * failures are silent by construction: loadWeatherFor returns null and those
   * plants simply fall back to their base schedule.
   */
  const loadPlans = useCallback(async (plants: PlantListItem[]) => {
    const now = new Date();
    const zips = distinctZips(plants);
    const resolved = await Promise.all(zips.map((zip) => loadWeatherFor(zip, now)));
    const weatherByZip: Record<string, WeatherSummary | null> = {};
    zips.forEach((zip, i) => {
      weatherByZip[zip] = resolved[i]?.summary ?? null;
    });
    setPlans(wateringPlansFor(plants, weatherByZip, await getWateringLog(), now));

    // #5 — frost/heat: cross the just-fetched forecast with each plant's own
    // comfort range. Notification is replace-don't-stack and only fires when
    // permission was ALREADY granted.
    try {
      if (zips[0]) {
        const { hemisphere: detected } = await cachedLocalConditions(zips[0], now);
        if (detected) setHemisphere(detected);
      }
      const daily = await cachedDailyByZip(zips);
      const alerts = weatherAlertsFor(
        plants.map((p) => ({
          id: p.id,
          name: p.name,
          location: p.location,
          careProfile: p.careProfile,
          zipCode: p.zipCode,
        })),
        daily,
        now,
      );
      setAlert(alerts[0] ?? null);
      if (alerts[0] && (await notificationScheduler.getPermissions()).granted) {
        // Once per kind+night: the list reloads constantly and a same-night
        // alert's evening slot is already past, so an unguarded sync would
        // re-fire the notification on every refresh.
        const mark = `${alerts[0].kind}:${alerts[0].night.toDateString()}`;
        if ((await loadWeatherAlertMark()) !== mark) {
          await scheduleWeatherAlert(notificationScheduler, { ...alerts[0], now });
          await saveWeatherAlertMark(mark);
        }
      }
    } catch (e) {
      console.error("[PlantsScreen] weather alerts failed:", (e as Error).message);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const plants = await fetchPlants();
      setItems(plants);
      setError(null);
      // Don't block the list on weather — the chips arrive a beat later.
      void loadPlans(plants);
    } catch {
      // fetchPlants already logged the details; show only a generic message.
      setError(GENERIC_LOAD_ERROR);
      setItems((prev) => prev ?? []);
    }
  }, [loadPlans]);

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
      {/* #3 — the north star, visible: "2 of 3 plants improving". */}
      {items && gardenTrend(items) ? (
        <Text style={[styles.trendLine, { color: t.sub }]}>{gardenTrend(items)!.line}</Text>
      ) : null}
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
          ListHeaderComponent={
            <>
              <TodayCard items={items} plans={plans} alert={alert} hemisphere={hemisphere} t={t} />
              <LocalEngineSetupCard />
            </>
          }
          ListEmptyComponent={
            error ? null : <EmptyState t={t} onAdd={() => setAdding(true)} />
          }
          renderItem={({ item }) => (
            <PlantCard
              item={item}
              needsWater={plans[item.id]?.isDue === true}
              t={t}
              scheme={scheme}
              onPress={() => setDetailId(item.id)}
              onViewPhoto={() =>
                item.coverUri ? setViewing({ uri: item.coverUri, caption: item.name }) : setDetailId(item.id)
              }
            />
          )}
        />
      )}
      <PhotoViewer photo={viewing} onClose={() => setViewing(null)} />
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

/** #8 (honest v1) — what needs doing TODAY, from deterministic signals only:
 * a weather alert, watering due, an open prune window. Empty day = no card. */
function TodayCard({
  items,
  plans,
  alert,
  hemisphere,
  t,
}: {
  items: PlantListItem[];
  plans: Record<string, WateringPlan>;
  alert: WeatherAlert | null;
  hemisphere: Hemisphere;
  t: Tokens;
}) {
  const month = new Date().getMonth() + 1;
  const lines = todayDigest({
    alert: alert ? { kind: alert.kind, tempC: alert.tempC, plantNames: alert.plantNames } : null,
    dueWater: items.filter((item) => plans[item.id]?.isDue === true).map((item) => item.name),
    // Real identity, real hemisphere — a pet name must not pick the pack, and
    // a southern grower must not get northern windows (D-P5).
    pruneWindowOpen: items
      .filter(
        (item) =>
          seasonVerdict(
            pruningPackFor({
              name: item.name,
              plant_type: item.plantType,
              species: item.species,
              cultivar: null,
            }),
            month,
            hemisphere,
          ).status === "best",
      )
      .map((item) => item.name),
  });
  if (lines.length === 0) return null;
  return (
    <View style={[styles.todayCard, { backgroundColor: t.card, borderColor: t.border }]}>
      <Text style={[styles.todayLabel, { color: t.sub }]}>TODAY</Text>
      {lines.map((line) => (
        <Text
          key={line.text}
          style={[
            styles.todayLine,
            // The most urgent thing should LOOK like it — the ranking used to
            // exist only in source order (designer finding). The word carries
            // the meaning; the colour just stops it whispering.
            line.kind === "alert" ? { color: t.danger, fontWeight: "600" } : { color: t.text },
          ]}
        >
          {line.text}
        </Text>
      ))}
    </View>
  );
}

function PlantCard({
  item,
  needsWater,
  t,
  scheme,
  onPress,
  onViewPhoto,
}: {
  item: PlantListItem;
  /** F20: this plant's watering plan says it's due (chip appears once the
   * list's weather pass lands — never blocks the card). */
  needsWater: boolean;
  t: Tokens;
  scheme: "light" | "dark";
  onPress: () => void;
  /** Tap on the thumbnail: open the photo full-screen (falls back to detail
   * when the plant has no photo yet). */
  onViewPhoto: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.name}${needsWater ? ", needs water" : ""}`}
      onPress={onPress}
      style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}
    >
      {/* The photo is what tells you WHICH plant "Multiple Trees" is (user
          request 2026-08-31). Its own tap target: thumb → full screen, the
          rest of the card → detail. */}
      <Pressable
        accessibilityRole={item.coverUri ? "imagebutton" : "none"}
        accessibilityLabel={item.coverUri ? `View ${item.name}'s photo full screen` : undefined}
        onPress={onViewPhoto}
        hitSlop={6}
      >
        {item.coverUri ? (
          <Image source={{ uri: item.coverUri }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty, { borderColor: t.border }]}>
            <Text style={styles.thumbGlyph}>🪴</Text>
          </View>
        )}
      </Pressable>
      <View style={styles.cardText}>
        <Text style={[styles.cardName, { color: t.text }]} numberOfLines={1}>
          {item.name}
        </Text>
        {item.subLabel ? (
          <Text style={[styles.cardSub, { color: t.sub }]} numberOfLines={1}>
            {item.subLabel}
          </Text>
        ) : null}
        <View style={styles.chipRow}>
          {item.trend ? <TrendChip trend={item.trend} t={t} scheme={scheme} /> : null}
          {needsWater ? (
            <View style={[styles.trendChip, { backgroundColor: t.green + "22" }]}>
              <Text style={[styles.trendChipText, { color: t.green }]}>💧 Needs water</Text>
            </View>
          ) : null}
        </View>
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
  trendLine: { fontSize: 13, fontWeight: "600", paddingHorizontal: 20, marginTop: -6, marginBottom: 8 },
  todayCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS,
    padding: 14,
    gap: 6,
    marginBottom: 10,
  },
  todayLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  todayLine: { fontSize: 13, lineHeight: 19 },
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
  thumb: { width: 64, height: 64, borderRadius: RADIUS - 2 },
  thumbEmpty: {
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbGlyph: { fontSize: 24 },
  cardText: { flex: 1, gap: 2, alignItems: "flex-start" },
  cardName: { fontSize: 16, fontWeight: "600" },
  cardSub: { fontSize: 13 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
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
