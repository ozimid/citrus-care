// F39 Phase 3b — zones + stored walk order (research §4: at 200 trees "structure
// beats search"). A zone is a label on the plant record ("NORTH", "ROW A"); the
// walk order is a stored integer inside it. Both are the user's — the model never
// touches them — and the order only RANKS: Prev/Next move the viewfinder chip
// along it, nothing advances by itself (design §5). This sheet is the one editor:
// ▲ ▼ per plant (no drag — gloves), "Move to zone…", "Add several plants…"
// (Hectre's "add a group of rows") and "Scan codes · N" — a scan-only pass
// through the zone's still-unbound plants in order, no plant photos. Logic:
// walk-order.ts (pure, tested); writes go through plants-io and are reported
// via onChanged. The dialog and the small controls live in ZoneDialog.tsx.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { PlantListItem } from "../lib/plants";
import { fetchPlants, insertPlantsBulk, setPlantZone, setWalkOrders } from "../lib/plants-io";
import { RADIUS } from "../lib/theme";
import { useTheme } from "../lib/theme-io";
import { groupByZone, reorderWalk } from "../lib/walk-order";
import { CaptureScreen } from "../screens/CaptureScreen";
import { Btn, ZoneDialog } from "./ZoneDialog";

const LOAD_ERROR = "Could not load your plants. Close and try again.";
const SAVE_ERROR = "Couldn't save that change. Please try again.";

/** onChanged: a zone, an order or the plant list changed — the host reloads. */
interface Props { visible: boolean; onClose: () => void; onChanged: () => void }

export function ZonesSheet({ visible, onClose, onChanged }: Props) {
  const { t } = useTheme();
  const [plants, setPlants] = useState<PlantListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState<PlantListItem | null>(null);
  /** The bulk form, seeded with the zone it was opened from. */
  const [adding, setAdding] = useState<{ zone: string | null } | null>(null);
  /** The bind pass: plant ids in walk order. */
  const [binding, setBinding] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    try {
      setPlants(await fetchPlants());
      setError(null);
    } catch {
      setError(LOAD_ERROR); // fetchPlants logged the details.
      setPlants((prev) => prev ?? []);
    }
  }, []); // Reads degrade to the last list (or empty); the error line says so.
  useEffect(() => void (visible && load()), [visible, load]);

  const groups = useMemo(() => groupByZone(plants ?? []), [plants]);
  const zones = useMemo(() => groups.map((g) => g.zone).filter((z): z is string => z !== null), [groups]);
  const existingNames = useMemo(() => new Set((plants ?? []).map((p) => p.name)), [plants]);

  /** A zone move or a bulk add: the sheet dims until the store is re-read. */
  const write = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        await load();
        onChanged();
      } catch (e) {
        console.error("[ZonesSheet] write failed:", (e as Error).message);
        setError(SAVE_ERROR);
      } finally {
        setBusy(false);
      }
    },
    [load, onChanged],
  );

  /** ▲ ▼ are optimistic and local: reorderWalk already returns the zone's full
   * renumbering, so the rows move at once and the write lands behind them —
   * moving a plant twelve rows must not be twelve dimmed round-trips through
   * three store reads. A failed write says so and reloads the truth. */
  const reorder = useCallback(
    (group: PlantListItem[], id: string, direction: "up" | "down") => {
      const orders = reorderWalk(group, id, direction);
      const byId = new Map(orders.map((o) => [o.id, o.walkOrder]));
      setPlants((prev) => prev?.map((p) => (byId.has(p.id) ? { ...p, walkOrder: byId.get(p.id)! } : p)) ?? prev);
      setError(null);
      setWalkOrders(orders).then(onChanged).catch((e: Error) => {
        console.error("[ZonesSheet] reorder failed:", e.message);
        setError(SAVE_ERROR);
        void load();
      });
    },
    [load, onChanged],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel="Close" style={styles.backdropTouch} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: t.card }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: t.text }]} accessibilityRole="header">Zones & walk order</Text>
            {/* Neutral: closing is not what this sheet is for — the one green is "Add several plants". */}
            <Btn text="Done" label="Close zones" onPress={onClose} t={t} />
          </View>
          <Text style={[styles.hint, { color: t.sub }]}>
            The order Prev / Next walk through in the viewfinder. It only suggests the next tree — a photo never moves it.
          </Text>
          {error ? <Text style={[styles.error, { color: t.danger }]} accessibilityLiveRegion="assertive">{error}</Text> : null}
          {plants === null ? (
            <ActivityIndicator color={t.green} style={styles.spinner} />
          ) : (
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {plants.length === 0 && !error ? <Text style={[styles.hint, { color: t.sub }]}>No plants yet — add several below.</Text> : null}
              {groups.map((group) => {
                // Only the plants still without a code are worth a scan pass; a
                // replacement sticker is re-bound from that plant's own Tags card.
                const unbound = group.items.filter((p) => p.codeCount === 0);
                const n = group.items.length;
                return (
                  <View key={group.zone ?? " none"} style={styles.group}>
                    <View style={styles.groupHead}>
                      <Text style={[styles.groupTitle, { color: t.text }]} accessibilityRole="header">
                        {group.zone ?? "No zone"} · {n}
                      </Text>
                      {unbound.length > 0 ? (
                        <Btn
                          text={`Scan codes · ${unbound.length}`}
                          label={`Scan codes for the ${unbound.length} plant${unbound.length === 1 ? "" : "s"} in ${group.zone ?? "no zone"} without one, one at a time, no photos`}
                          disabled={busy}
                          onPress={() => setBinding(unbound.map((p) => p.id))}
                          t={t}
                        />
                      ) : null}
                    </View>
                    {group.items.map((plant, i) => (
                      <View key={plant.id} style={[styles.row, { borderColor: t.border }]}>
                        <Text style={[styles.order, { color: t.sub }]}>{i + 1}</Text>
                        <Text style={[styles.name, { color: t.text }]} numberOfLines={1}>{plant.name}{plant.tag ? ` · #${plant.tag}` : ""}</Text>
                        <Btn text="▲" label={`Move ${plant.name} up, currently ${i + 1} of ${n}`} square disabled={i === 0} t={t}
                          onPress={() => reorder(group.items, plant.id, "up")} />
                        <Btn text="▼" label={`Move ${plant.name} down, currently ${i + 1} of ${n}`} square disabled={i === n - 1} t={t}
                          onPress={() => reorder(group.items, plant.id, "down")} />
                        <Btn text="Zone…" label={`Move ${plant.name} to another zone`} disabled={busy} onPress={() => setMoving(plant)} t={t} />
                      </View>
                    ))}
                  </View>
                );
              })}
            </ScrollView>
          )}
          {/* Outside the scroll: the sheet's creation action stays in the thumb zone at 50 plants. */}
          {plants !== null ? (
            <Btn text="＋ Add several plants…" label="Add several plants at once" tone="primary" disabled={busy} onPress={() => setAdding({ zone: null })} t={t} />
          ) : null}
          {busy ? <ActivityIndicator color={t.green} style={styles.spinner} /> : null}
        </View>
      </View>

      <ZoneDialog visible={moving !== null} title={`Move ${moving?.name ?? ""} to…`} zones={zones} initial={moving?.zone ?? null}
        submitText="Move" onClose={() => setMoving(null)} t={t}
        onSubmit={(zone) => { const plant = moving; setMoving(null); if (plant) void write(() => setPlantZone(plant.id, zone)); }} />
      <ZoneDialog visible={adding !== null} title="Add several plants" zones={zones} initial={adding?.zone ?? null} bulk
        existingNames={existingNames} submitText="Add" onClose={() => setAdding(null)} t={t}
        onSubmit={(zone, drafts, plantType) => { setAdding(null); void write(() => insertPlantsBulk(drafts.map((name) => ({ name, plant_type: plantType, zone })))); }} />
      <Modal visible={binding !== null} animationType="slide" onRequestClose={() => setBinding(null)}>
        <CaptureScreen scanTargets={binding ?? []} onClose={() => { setBinding(null); void load(); onChanged(); }} />
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  backdropTouch: { flex: 1 },
  sheet: { borderTopLeftRadius: RADIUS + 6, borderTopRightRadius: RADIUS + 6, paddingTop: 18, paddingHorizontal: 20, paddingBottom: 34, maxHeight: "88%", gap: 8 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  title: { fontSize: 19, fontWeight: "600", letterSpacing: -0.3, flexShrink: 1 },
  hint: { fontSize: 12, lineHeight: 17 },
  error: { fontSize: 13, fontWeight: "600" },
  spinner: { alignSelf: "flex-start", marginVertical: 8 },
  list: { flexGrow: 0 },
  listContent: { gap: 14, paddingBottom: 8 },
  group: { gap: 4 },
  groupHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 48 },
  groupTitle: { fontSize: 15, fontWeight: "700", flexShrink: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 56, paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  order: { width: 24, fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"], textAlign: "right" },
  name: { flex: 1, fontSize: 15, fontWeight: "600" },
});
