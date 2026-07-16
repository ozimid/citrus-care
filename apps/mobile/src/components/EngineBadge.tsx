// F22 — the provenance badge, shared by the fresh diagnosis (DiagnosisScreen)
// and the stored timeline rows (PlantDetailScreen). It lived inside
// DiagnosisScreen while the engine was ephemeral; persisting the engine gave
// it a second caller, and a badge rendered in two places from one column
// should not be two components that drift.
//
// Provenance, stated plainly: emerald when the phone did it, neutral when
// Gemini did. An escalation says nothing extra — that a local attempt was made
// and dropped is our problem, not the user's — and a pre-F22 row renders no
// badge at all (engineBadgeLabel returns null; "Unknown" on every historical
// row is noise, not information).

import { StyleSheet, Text, View } from "react-native";
import { engineBadgeLabel, engineKind } from "../lib/local-engine";
import type { Tokens } from "../lib/theme";

export function EngineBadge({
  t,
  engine,
}: {
  t: Tokens;
  /** Raw column value: "on-device" | "gemini" | "gemini:<reason>" | null. */
  engine: string | null | undefined;
}) {
  const label = engineBadgeLabel(engine);
  if (!label) return null;
  const onDevice = engineKind(engine) === "on-device";
  const color = onDevice ? t.green : t.sub;
  return (
    <View
      accessibilityLabel={onDevice ? "Analyzed on this device" : "Analyzed by Gemini"}
      style={[styles.badge, { borderColor: color + "55" }]}
    >
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 11, fontWeight: "600", letterSpacing: 0.2 },
});
