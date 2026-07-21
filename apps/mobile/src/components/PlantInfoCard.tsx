// F37 (competitor-inspired): the Plant Info card — difficulty, light/temp/
// drought preferences, mature size and the flowering/fruiting seasons, all
// from the SAME on-device care profile F20 already generates (several of
// these fields existed and were never rendered). Honestly labeled: this is
// AI-generated reference, not editorial content.

import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { generateAndStoreCareProfile } from "../lib/care-profile-io";
import { RADIUS, type Tokens } from "../lib/theme";
import { monthsLabel, parseStoredCareProfile } from "../lib/watering";
import { useLocalEngine } from "./LocalEngineProvider";

interface PlantInput {
  id: string;
  name: string;
  plant_type: string;
  species: string | null;
  cultivar: string | null;
  location: string | null;
  zip_code: string | null;
  care_profile?: unknown;
}

interface Props {
  plant: PlantInput;
  t: Tokens;
  /** The stored profile changed (regenerate) — reload the plant row. */
  onProfileGenerated?: () => void;
}

const DIFFICULTY_LABEL = { easy: "🟢 Easy", moderate: "🟡 Moderate", hard: "🔴 Demanding" } as const;
const SUN_LABEL = { full: "Full sun", partial: "Partial sun", shade: "Shade" } as const;
const DROUGHT_LABEL = {
  low: "Wilts fast — keep moist",
  medium: "Average",
  high: "Forgives a missed watering",
} as const;

export function PlantInfoCard({ plant, t, onProfileGenerated }: Props) {
  const localEngine = useLocalEngine();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const profile = useMemo(() => parseStoredCareProfile(plant.care_profile), [plant.care_profile]);

  const regenerate = useCallback(async () => {
    if (!localEngine.isReady()) {
      setNote("Turn on On-device AI in Profile to refresh this.");
      return;
    }
    setNote(null);
    setBusy(true);
    const generated = await generateAndStoreCareProfile(localEngine.generate, plant);
    setBusy(false);
    if (generated) onProfileGenerated?.();
    else setNote("Couldn't refresh right now — try again later.");
  }, [localEngine, onProfileGenerated, plant]);

  // No profile yet: the WateringCard already owns that empty state + CTA.
  if (!profile) return null;

  const flowering = monthsLabel(profile.flowering_months);
  const fruiting = monthsLabel(profile.fruiting_months);
  const rows: [string, string][] = [];
  if (profile.difficulty) rows.push(["Difficulty", DIFFICULTY_LABEL[profile.difficulty]]);
  rows.push(["Light", SUN_LABEL[profile.sun]]);
  rows.push(["Comfortable temps", `${profile.temp_min_c}–${profile.temp_max_c} °C`]);
  rows.push(["Drought tolerance", DROUGHT_LABEL[profile.drought_tolerance]]);
  if (profile.mature_size_note) rows.push(["Mature size", profile.mature_size_note]);
  if (flowering) rows.push(["Flowers", flowering]);
  if (fruiting) rows.push(["Fruits", fruiting]);
  rows.push(["Indoors", profile.indoor_ok ? "Thrives indoors" : "Better outdoors"]);

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
      <Text style={[styles.label, { color: t.sub }]}>Plant info</Text>
      {rows.map(([key, value]) => (
        <View key={key} style={styles.row}>
          <Text style={[styles.key, { color: t.sub }]}>{key}</Text>
          <Text style={[styles.value, { color: t.text }]} numberOfLines={2}>
            {value}
          </Text>
        </View>
      ))}
      {note ? <Text style={[styles.note, { color: t.sub }]}>{note}</Text> : null}
      <View style={styles.footerRow}>
        <Text style={[styles.footer, { color: t.sub }]}>
          AI-generated reference — verify anything critical.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Regenerate plant info"
          onPress={regenerate}
          disabled={busy}
          hitSlop={8}
        >
          <Text style={[styles.regen, { color: t.green, opacity: busy ? 0.5 : 1 }]}>
            {busy ? "Refreshing…" : "↻ Refresh"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: RADIUS,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  label: { fontSize: 13, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  key: { fontSize: 14 },
  value: { fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  note: { fontSize: 12 },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginTop: 2,
  },
  footer: { fontSize: 11, flexShrink: 1 },
  regen: { fontSize: 13, fontWeight: "600" },
});
