// F39 Phase 3b — the Zones sheet's dialog and its two small controls, in
// their own file so ZonesSheet stays under the 250-line guideline. ZoneDialog
// is one form in two shapes: "Move <plant> to…" (a zone), and, with `bulk`,
// "Add several plants" (zone + name pattern + count + type — Hectre's "add a
// group of rows"). Its body SCROLLS: with the number pad up, a raised font
// scale or a long chip row the action row would otherwise sit off-screen and
// the task could not be finished. Logic is walk-order.ts (pure, tested).

import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PLANT_TYPES } from "@citrus/shared";
import { ZONE_FORMAT_ERROR } from "../lib/new-plant";
import { normalizeTag, TAG_MAX_LENGTH } from "../lib/plant-tags";
import { RADIUS, type Tokens } from "../lib/theme";
import { bulkPlantDrafts, MAX_BULK_PLANTS } from "../lib/walk-order";

/** Zone entry (typed, or one tap on an existing zone / "No zone"); with `bulk`, also the name
 * pattern, count and type — the preview names exactly what will be created before the tap does,
 * and the commit button names its own magnitude ("Add 12 plants"). */
export function ZoneDialog({ visible, title, zones, initial, bulk = false, existingNames, submitText, onSubmit, onClose, t }: {
  visible: boolean; title: string; zones: string[]; initial: string | null; bulk?: boolean;
  existingNames?: ReadonlySet<string>; submitText: string; t: Tokens; onClose: () => void;
  onSubmit: (zone: string | null, drafts: string[], plantType: string) => void;
}) {
  const [zone, setZone] = useState("");
  const [pattern, setPattern] = useState("");
  const [count, setCount] = useState("10");
  const [plantType, setPlantType] = useState<string>(PLANT_TYPES[0]);
  // A fresh open starts from the zone it was opened for; the pattern follows it ("NORTH-{n}").
  useEffect(() => { if (visible) { setZone(initial ?? ""); setPattern(initial ? `${initial}-{n}` : ""); setCount("10"); } }, [visible, initial]);
  const zoneValue = zone.trim() ? normalizeTag(zone) : null;
  const zoneBad = zone.trim().length > 0 && zoneValue === null;
  const n = Math.min(MAX_BULK_PLANTS, Math.max(0, Math.floor(Number(count) || 0)));
  const drafts = useMemo(() => (bulk && pattern.trim() ? bulkPlantDrafts(pattern, n, existingNames ?? new Set()) : []), [bulk, pattern, n, existingNames]);
  const canSubmit = !zoneBad && (!bulk || drafts.length > 0);
  const commit = bulk && drafts.length > 0 ? `Add ${drafts.length} plant${drafts.length === 1 ? "" : "s"}` : submitText;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.dialogBackdrop}>
        <ScrollView
          style={[styles.dialogScroll, { backgroundColor: t.card, borderColor: t.border }]}
          contentContainerStyle={styles.dialogContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.title, { color: t.text }]} accessibilityRole="header">{title}</Text>
          <Text style={[styles.label, { color: t.sub }]}>Zone</Text>
          <TextInput accessibilityLabel="Zone name" value={zone} onChangeText={setZone} maxLength={TAG_MAX_LENGTH} autoCapitalize="characters" autoCorrect={false}
            placeholder="e.g. NORTH or ROW A — empty for no zone" placeholderTextColor={t.sub}
            style={[styles.input, { borderColor: zoneBad ? t.danger : t.border, color: t.text, backgroundColor: t.canvas }]} />
          {zoneBad ? <Text style={[styles.error, { color: t.danger }]}>{ZONE_FORMAT_ERROR}</Text> : null}
          <View style={styles.chips}>
            <Chip text="No zone" selected={zone.trim() === ""} onPress={() => setZone("")} t={t} />
            {zones.map((z) => <Chip key={z} text={z} selected={zoneValue === z} onPress={() => setZone(z)} t={t} />)}
          </View>
          {bulk ? (
            <>
              <Text style={[styles.label, { color: t.sub }]}>Name pattern · {"{n}"} becomes the number</Text>
              <TextInput accessibilityLabel="Name pattern" value={pattern} onChangeText={setPattern} maxLength={60} autoCorrect={false}
                placeholder="e.g. A-{n} or Lemon" placeholderTextColor={t.sub}
                style={[styles.input, { borderColor: t.border, color: t.text, backgroundColor: t.canvas }]} />
              <Text style={[styles.label, { color: t.sub }]}>How many (up to {MAX_BULK_PLANTS})</Text>
              <TextInput accessibilityLabel="How many plants" value={count} onChangeText={setCount} keyboardType="number-pad" maxLength={2}
                style={[styles.input, { borderColor: t.border, color: t.text, backgroundColor: t.canvas }]} />
              <Text style={[styles.label, { color: t.sub }]}>Plant type</Text>
              <View style={styles.chips}>
                {PLANT_TYPES.map((type) => (
                  <Chip key={type} text={type.charAt(0).toUpperCase() + type.slice(1)} selected={plantType === type} onPress={() => setPlantType(type)} t={t} />
                ))}
              </View>
              <Text style={[styles.hint, { color: t.sub }]} accessibilityLiveRegion="polite">
                {drafts.length === 0
                  ? "Type a pattern to see the names."
                  : `Will add ${drafts.length}: ${drafts.slice(0, 3).join(", ")}${drafts.length > 3 ? ` … ${drafts[drafts.length - 1]}` : ""}`}
              </Text>
            </>
          ) : null}
          <View style={styles.actions}>
            <Btn text={commit} label={commit} tone="primary" disabled={!canSubmit} onPress={() => onSubmit(zoneValue, drafts, plantType)} t={t} />
            <Btn text="Cancel" label="Cancel" onPress={onClose} t={t} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Chip({ text, selected, onPress, t }: { text: string; selected: boolean; onPress: () => void; t: Tokens }) {
  const style = [styles.chip, { borderColor: selected ? t.green : t.border, backgroundColor: selected ? t.green : "transparent" }];
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={style}>
      <Text style={[styles.chipText, { color: selected ? t.onGreen : t.text }]}>{selected ? "✓ " : ""}{text}</Text>
    </Pressable>
  );
}

/** ≥ 48 dp bordered button; tone carries colour, the text carries the word. */
export function Btn({ text, label, onPress, t, tone = "neutral", disabled = false, square = false }: {
  text: string; label: string; onPress: () => void; t: Tokens; tone?: "neutral" | "primary"; disabled?: boolean; square?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={[styles.button, square ? styles.square : null, { borderColor: tone === "primary" ? t.green : t.border, backgroundColor: tone === "primary" ? t.green : "transparent", opacity: disabled ? 0.4 : 1 }]}>
      <Text style={[styles.buttonText, { color: tone === "primary" ? t.onGreen : t.text }]} numberOfLines={1}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 19, fontWeight: "600", letterSpacing: -0.3, flexShrink: 1 },
  hint: { fontSize: 12, lineHeight: 17 },
  error: { fontSize: 13, fontWeight: "600" },
  button: { borderWidth: 1, borderRadius: RADIUS, minHeight: 48, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  square: { width: 48, paddingHorizontal: 0 },
  buttonText: { fontSize: 14, fontWeight: "600" },
  dialogBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)", padding: 20 },
  /** flexGrow 0: content-sized when short, capped (and scrolling) when tall. */
  dialogScroll: { width: "100%", maxWidth: 380, maxHeight: "100%", flexGrow: 0, borderWidth: StyleSheet.hairlineWidth, borderRadius: RADIUS + 4 },
  dialogContent: { padding: 18, gap: 8 },
  label: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 4 },
  input: { borderWidth: 1, borderRadius: RADIUS, minHeight: 48, paddingHorizontal: 12, fontSize: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, minHeight: 40, justifyContent: "center" },
  chipText: { fontSize: 13, fontWeight: "600" },
  actions: { flexDirection: "row", gap: 8, marginTop: 6 },
});
