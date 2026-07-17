// F28: first-run setup card at the top of the Plants list. Walks a new user
// into the one-time model download BEFORE they hit add-plant → photo →
// analyze → "not ready" (the end-of-funnel error a friend hit on day one).
// Renders nothing once the engine is ready — long-time users never see it.

import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import {
  LOCAL_MODEL_DOWNLOAD_WARNING,
  firstRunSetupCard,
  hasRoomForLocalModel,
  insufficientStorageMessage,
  needsDownloadWarning,
} from "../lib/local-engine";
import { availableDiskSpaceBytes, deviceCapabilitySnapshot } from "../lib/local-engine-io";
import { RADIUS } from "../lib/theme";
import { useTheme } from "../lib/theme-io";
import { useLocalEngine } from "./LocalEngineProvider";

export function LocalEngineSetupCard() {
  const { t } = useTheme();
  const { state, settings, setEnabled, retry } = useLocalEngine();
  const card = firstRunSetupCard(state);
  if (!card) return null;

  // Same guarded enable as Profile's LocalEngineCard: check free space before
  // a 1.3 GB download, and say the download warning once.
  function enable() {
    // F33 pre-flight: phones that can't plausibly run the model find out in
    // one second, not after a 1.3 GB download.
    const capability = deviceCapabilitySnapshot();
    if (capability.level === "block") {
      Alert.alert("This phone can't run the AI", capability.reason ?? undefined);
      return;
    }
    const warnPrefix = capability.level === "warn" && capability.reason ? capability.reason + "\n\n" : "";
    if (!needsDownloadWarning(settings)) {
      if (warnPrefix) {
        Alert.alert("Heads up", capability.reason ?? "", [
          { text: "Not now", style: "cancel" },
          { text: "Try anyway", onPress: () => setEnabled(true) },
        ]);
        return;
      }
      setEnabled(true);
      return;
    }
    const available = availableDiskSpaceBytes();
    if (available !== null && !hasRoomForLocalModel(available)) {
      Alert.alert("Not enough space", insufficientStorageMessage(available));
      return;
    }
    Alert.alert("One-time download", warnPrefix + LOCAL_MODEL_DOWNLOAD_WARNING, [
      { text: "Not now", style: "cancel" },
      { text: "Download", onPress: () => setEnabled(true) },
    ]);
  }

  const busy = card.cta === null;
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.green }]}>
      <View style={styles.titleRow}>
        {busy ? <ActivityIndicator color={t.green} /> : <Text style={styles.leafGlyph}>🍃</Text>}
        <Text style={[styles.title, { color: t.text }]}>{card.title}</Text>
      </View>
      <Text style={[styles.body, { color: t.sub }]}>{card.body}</Text>
      {card.cta !== null && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={card.cta === "enable" ? "Download the AI" : "Try setup again"}
          onPress={card.cta === "enable" ? enable : retry}
          style={[styles.cta, { backgroundColor: t.green }]}
        >
          <Text style={[styles.ctaText, { color: t.onGreen }]}>
            {card.cta === "enable" ? "Download the AI" : "Try again"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: RADIUS,
    borderWidth: 1.5,
    padding: 16,
    marginBottom: 12,
    gap: 8,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  leafGlyph: { fontSize: 16 },
  title: { fontSize: 16, fontWeight: "700" },
  body: { fontSize: 13, lineHeight: 19 },
  cta: {
    marginTop: 4,
    borderRadius: RADIUS,
    paddingVertical: 11,
    alignItems: "center",
  },
  ctaText: { fontSize: 15, fontWeight: "600" },
});
