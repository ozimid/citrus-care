import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LocalEngineSetupCard } from "../components/LocalEngineSetupCard";
import { PhotoViewer } from "../components/PhotoViewer";
import { NewPlantSheet } from "../components/NewPlantSheet";
import { PendingWalkCard } from "../components/PendingWalkCard";
import { TodayCard } from "../components/TodayCard";
import { ZonesSheet } from "../components/ZonesSheet";
import { bandColor, healthBand } from "../lib/health";
import { gardenTrend, type PlantListItem } from "../lib/plants";
import { loadPlantsSort, savePlantsSort, type PlantsSort } from "../lib/plants-sort-io";
import { groupByZone, sortByStaleness } from "../lib/walk-order";
import { weatherAlertsFor, type WeatherAlert } from "../lib/weather-alerts";
import { scheduleWeatherAlert } from "../lib/reminders";
import {
  loadWeatherAlertMark,
  notificationScheduler,
  saveWeatherAlertMark,
} from "../lib/reminders-io";
import type { Hemisphere } from "../lib/pruning-rules";
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
// F39 Phase 3b (research §4, "structure beats search"): once one plant has a
// zone the list becomes sections — one per zone, walk order inside, unzoned
// last — so the rows read the way the garden is walked. A remembered sort
// toggle swaps that structure for triage: "Needs a check" ranks the WHOLE
// garden in one section (never assessed first, then longest ago), each card
// naming its zone; "Zones" opens the editor. The grouping and both orders are
// walk-order.ts (pure, tested); the toggle's memory is plants-sort-io.

const GENERIC_LOAD_ERROR = "Could not load your plants. Pull to retry.";

interface PlantSection {
  /** null = the single unlabelled section of a garden with no zones. */
  title: string | null;
  data: PlantListItem[];
}

export function PlantsScreen({ refreshToken = 0 }: { refreshToken?: number }) {
  const { t, scheme } = useTheme();
  const [items, setItems] = useState<PlantListItem[] | null>(null);
  const [plans, setPlans] = useState<Record<string, WateringPlan>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [zonesOpen, setZonesOpen] = useState(false);
  const [sort, setSort] = useState<PlantsSort>("newest");
  const [detailId, setDetailId] = useState<string | null>(null);
  /** Full-screen photo (tap a card's thumbnail). */
  const [viewing, setViewing] = useState<{ uri: string; caption?: string } | null>(null);
  /** #5/#8 — tonight's weather alert (if any), for the Today card + a local
   * notification. Deterministic; scheduled only when permission already
   * granted (a list view must never throw a permission prompt). */
  const [alert, setAlert] = useState<WeatherAlert | null>(null);
  const [hemisphere, setHemisphere] = useState<Hemisphere>("northern");
  /** F39: bumps per load so the pending-walk card re-reads the queue. */
  const [loadCount, setLoadCount] = useState(0);

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
    setLoadCount((c) => c + 1);
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

  // The remembered sort (degrades to "newest").
  useEffect(() => {
    let cancelled = false;
    loadPlantsSort().then((saved) => {
      if (!cancelled) setSort(saved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const pickSort = useCallback((next: PlantsSort) => {
    setSort(next);
    void savePlantsSort(next);
  }, []);

  /** Two genuine views. Structure: sections appear as soon as one plant has a
   * zone (until then one unlabelled section in today's order). Triage: "Needs
   * a check" ranks the whole garden in ONE section — confining it to a zone
   * would discard exactly the comparison it computes (the longest-unchecked
   * tree three sections down would sit under freshly checked ones). */
  const zoned = useMemo(() => (items ?? []).some((p) => p.zone), [items]);
  const sections = useMemo<PlantSection[]>(() => {
    const list = items ?? [];
    // An empty garden gets NO sections: SectionList counts a header and a
    // footer slot per section, so one empty section would hide the empty state.
    if (list.length === 0) return [];
    if (sort === "stale") return [{ title: zoned ? "Needs a check first · all zones" : null, data: sortByStaleness(list) }];
    if (!zoned) return [{ title: null, data: list }];
    return groupByZone(list).map((group) => ({ title: group.zone ?? "No zone", data: group.items }));
  }, [items, sort, zoned]);

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
      {items !== null ? (
        <View style={styles.toolbar}>
          {/* The sort needs two plants to mean anything; Zones is always here —
              "Add several plants…" lives behind it, and an empty garden is
              exactly when thirty numbered trees get created at once. */}
          {items.length > 1 ? (
            <View style={[styles.segment, { borderColor: t.border }]} accessibilityRole="radiogroup">
              <SortOption text={zoned ? "Walk order" : "Newest"} selected={sort === "newest"} onPress={() => pickSort("newest")} t={t} />
              <SortOption text="Needs a check" selected={sort === "stale"} onPress={() => pickSort("stale")} t={t} />
            </View>
          ) : (
            <View style={styles.toolbarFlex} />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Zones and walk order"
            onPress={() => setZonesOpen(true)}
            style={[styles.zonesButton, { borderColor: t.border, backgroundColor: t.card }]}
          >
            <Text style={[styles.zonesButtonText, { color: t.text }]}>Zones ▸</Text>
          </Pressable>
        </View>
      ) : null}
      {items === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={t.green} />
        </View>
      ) : (
        <SectionList<PlantListItem, PlantSection>
          sections={sections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={items.length === 0 ? styles.emptyGrow : styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.green} />
          }
          ListHeaderComponent={
            <>
              <TodayCard items={items} plans={plans} alert={alert} hemisphere={hemisphere} t={t} />
              {/* F39: photos waiting for analysis (hidden when none). */}
              <PendingWalkCard onChanged={load} refreshToken={loadCount} />
              <LocalEngineSetupCard />
            </>
          }
          ListEmptyComponent={
            error ? null : <EmptyState t={t} onAdd={() => setAdding(true)} />
          }
          renderSectionHeader={({ section }) =>
            section.title ? (
              <Text style={[styles.sectionHeader, { color: t.sub }]} accessibilityRole="header">
                {section.title} · {section.data.length}
              </Text>
            ) : null
          }
          renderItem={({ item }) => (
            <PlantCard
              item={item}
              // Phase 6: only a LOGGED watering earns "Needs water". A plan
              // anchored on the day the plant was added is a projection, and
              // every never-watered plant would fly the chip at once.
              needsWater={plans[item.id]?.isDue === true && plans[item.id]?.anchor === "log"}
              tagMissing={item.tagMissing}
              showZone={sort === "stale" && zoned}
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
      {/* F39 Phase 3b: zones, walk order, bulk add, zone-wide code binding. */}
      <ZonesSheet visible={zonesOpen} onClose={() => setZonesOpen(false)} onChanged={load} />
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
  needsWater,
  tagMissing,
  showZone,
  t,
  scheme,
  onPress,
  onViewPhoto,
}: {
  item: PlantListItem;
  /** Phase 3b: in the flat triage view the section no longer says where the
   * plant stands, so the card does. */
  showZone: boolean;
  /** F20: this plant's watering plan says it's due (chip appears once the
   * list's weather pass lands — never blocks the card). */
  needsWater: boolean;
  /** F39: the physical tag is flagged missing on the record. */
  tagMissing: boolean;
  t: Tokens;
  scheme: "light" | "dark";
  onPress: () => void;
  /** Tap on the thumbnail: open the photo full-screen (falls back to detail
   * when the plant has no photo yet). */
  onViewPhoto: () => void;
}) {
  const tag = item.tag ?? null;
  const amber = bandColor("fair", scheme);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.name}${tag ? `, number ${tag}` : ""}${showZone && item.zone ? `, zone ${item.zone}` : ""}${needsWater ? ", needs water" : ""}${tagMissing ? ", tag missing" : ""}`}
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
        <View style={styles.cardNameRow}>
          <Text style={[styles.cardName, { color: t.text }]} numberOfLines={1}>
            {item.name}
          </Text>
          {/* F39 (D-W4): the number on the stake — how a walk photo finds
              this plant. */}
          {tag ? (
            <View style={[styles.tagChip, { borderColor: t.border }]}>
              <Text style={[styles.tagChipText, { color: t.text }]} numberOfLines={1}>
                #{tag}
              </Text>
            </View>
          ) : null}
          {showZone && item.zone ? (
            <View style={[styles.tagChip, { borderColor: t.border }]}>
              <Text style={[styles.tagChipText, { color: t.sub }]} numberOfLines={1}>
                {item.zone}
              </Text>
            </View>
          ) : null}
        </View>
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
          {tagMissing ? (
            <Text style={[styles.tagMissing, { color: amber }]}>⚠ tag missing</Text>
          ) : null}
        </View>
      </View>
      <HealthRing score={item.latestScore} t={t} scheme={scheme} />
    </Pressable>
  );
}

/** One half of the sort toggle: a ≥ 48 dp radio whose selected state is a
 * fill AND a check mark, so it reads without colour. */
function SortOption({ text, selected, onPress, t }: { text: string; selected: boolean; onPress: () => void; t: Tokens }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`Sort by ${text}`}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.segmentOption, { backgroundColor: selected ? t.green : "transparent" }]}
    >
      <Text style={[styles.segmentText, { color: selected ? t.onGreen : t.text }]} numberOfLines={1}>
        {selected ? "✓ " : ""}
        {text}
      </Text>
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
  toolbar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 20, marginBottom: 10 },
  toolbarFlex: { flex: 1 },
  segment: { flex: 1, flexDirection: "row", borderWidth: 1, borderRadius: RADIUS, overflow: "hidden" },
  segmentOption: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  segmentText: { fontSize: 13, fontWeight: "600" },
  zonesButton: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: RADIUS,
    alignItems: "center",
    justifyContent: "center",
  },
  zonesButtonText: { fontSize: 14, fontWeight: "600" },
  sectionHeader: { fontSize: 12, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginTop: 6 },
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
  cardNameRow: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "stretch" },
  cardName: { fontSize: 16, fontWeight: "600", flexShrink: 1 },
  tagChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    maxWidth: 120,
  },
  tagChipText: { fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] },
  tagMissing: { fontSize: 11, fontWeight: "700", marginTop: 3, paddingVertical: 2 },
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
