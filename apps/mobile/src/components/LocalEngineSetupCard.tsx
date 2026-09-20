// F28: first-run setup card at the top of the Plants list. Walks a new user
// into the one-time model download BEFORE they hit add-plant → photo →
// analyze → "not ready" (the end-of-funnel error a friend hit on day one).
// Renders nothing once the engine is ready — long-time users never see it.
//
// F40: the download is now a CHOICE, made here, before a byte is fetched —
// two models, each with its real size straight out of the catalogue, its
// maker and its licence. Every size on this card is computed; none is typed.

import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import {
  firstRunSetupCard,
  insufficientStorageMessage,
  localModelDownloadWarning,
  modelWeightsLikelyPresent,
} from "../lib/local-engine";
import { availableDiskSpaceBytes, deviceCapabilitySnapshot } from "../lib/local-engine-io";
import {
  MODEL_CATALOGUE,
  formatModelBytes,
  hasRoomFor,
  modelSpec,
  modelTestingNote,
  modelThatFits,
  type ModelId,
} from "../lib/model-catalogue";
import { RADIUS } from "../lib/theme";
import { useTheme } from "../lib/theme-io";
import { useLocalEngine } from "./LocalEngineProvider";

export function LocalEngineSetupCard() {
  const { t } = useTheme();
  const { state, settings, modelId, modelResolved, setModelId, downloadedIds, setEnabled, retry } =
    useLocalEngine();
  // The pick is local until the user commits: tapping an option must not
  // remount a session or rewrite the stored choice on its own.
  const [picked, setPicked] = useState<ModelId | null>(null);
  const card = firstRunSetupCard(state, picked ?? modelId);
  if (!card) return null;

  const selected = picked ?? modelId;
  const spec = modelSpec(selected);
  // Not `downloadedIds.includes(...)`: that listing degrades to [] on a read
  // failure and is [] until it lands, which would put a pre-F40 Gemma user
  // behind a ~6 GB free-space check for a download that will never happen.
  const alreadyHere = modelWeightsLikelyPresent(selected, downloadedIds, settings);
  // The chooser stays up in the recovery states too: switching to the lighter
  // model is the real fix for both "setup didn't finish" (disk) and "crashed
  // last time" (memory), and offering only "Try again" hides it. Null cta =
  // busy (downloading/preparing), where there is nothing to choose.
  const choosing = card.cta !== null;
  // A changed pick in a recovery state is an enable, not a retry — commit()
  // remounts through the provider's model key, which retries by construction.
  const switching = picked !== null && picked !== modelId;
  const action: "enable" | "retry" = card.cta === "enable" || switching ? "enable" : "retry";

  // Same guarded enable as Profile's LocalEngineCard: check free space for the
  // SELECTED model before its download, and say the download warning once.
  function enable() {
    // F33 pre-flight: phones that can't plausibly run the model find out in
    // one second, not after a multi-gigabyte download.
    const capability = deviceCapabilitySnapshot(selected);
    if (capability.level === "block") {
      Alert.alert("This phone can't run the AI", capability.reason ?? undefined);
      return;
    }
    const warnPrefix = capability.level === "warn" && capability.reason ? capability.reason + "\n\n" : "";
    // Weights already on this phone: nothing to download, nothing to warn about.
    if (alreadyHere) {
      if (warnPrefix) {
        Alert.alert("Heads up", capability.reason ?? "", [
          { text: "Not now", style: "cancel" },
          { text: "Try anyway", onPress: commit },
        ]);
        return;
      }
      commit();
      return;
    }
    const available = availableDiskSpaceBytes();
    if (available !== null && !hasRoomFor(selected, available)) {
      // Not a dead end when the app's own lighter model would fit: name it and
      // offer it. setPicked, never commit — no download starts from inside an
      // error dialog; the user still taps the CTA themselves.
      const fits = modelThatFits(selected, available);
      const buttons = fits
        ? [
            { text: "Free some space", style: "cancel" as const },
            { text: `Use ${modelSpec(fits).label}`, onPress: () => setPicked(fits) },
          ]
        : [{ text: "OK", style: "cancel" as const }];
      Alert.alert("Not enough space", insufficientStorageMessage(selected, available, fits), buttons);
      return;
    }
    Alert.alert("One-time download", warnPrefix + localModelDownloadWarning(selected), [
      { text: "Not now", style: "cancel" },
      { text: `Download ${spec.sizeLabel}`, onPress: commit },
    ]);
  }

  /** Commit the pick, then turn the engine on — in that order, so the session
   * mounts on the model the user actually chose. */
  function commit() {
    setModelId(selected);
    setEnabled(true);
  }

  const busy = card.cta === null;
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.green }]}>
      <View style={styles.titleRow}>
        {busy ? <ActivityIndicator color={t.green} /> : <Text style={styles.leafGlyph}>🍃</Text>}
        <Text style={[styles.title, { color: t.text }]}>{card.title}</Text>
      </View>
      <Text style={[styles.body, { color: t.sub }]}>{card.body}</Text>

      {choosing ? (
        <View style={styles.options}>
          <Text style={[styles.optionsLabel, { color: t.sub }]}>Choose a model</Text>
          {(Object.keys(MODEL_CATALOGUE) as ModelId[]).map((id) => (
            <ModelOption
              key={id}
              id={id}
              selected={id === selected}
              downloaded={modelWeightsLikelyPresent(id, downloadedIds, settings)}
              onPress={() => setPicked(id)}
            />
          ))}
          <Text style={[styles.note, { color: t.sub }]}>{modelTestingNote()}</Text>
        </View>
      ) : null}

      {card.cta !== null && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            action === "enable"
              ? alreadyHere
                ? `Use ${spec.label}, already on this phone`
                : `Download ${spec.label}, ${spec.sizeLabel}`
              : "Try setup again"
          }
          // Until resolveStartupModel() answers, `modelId` is a placeholder —
          // committing it would persist a guess as the user's choice. Retry
          // commits nothing, so it stays live.
          disabled={action === "enable" && !modelResolved}
          onPress={action === "enable" ? enable : retry}
          style={[
            styles.cta,
            { backgroundColor: t.green, opacity: action === "enable" && !modelResolved ? 0.6 : 1 },
          ]}
        >
          <Text style={[styles.ctaText, { color: t.onGreen }]}>
            {action === "enable"
              ? alreadyHere
                ? `Use ${spec.label}`
                : `Download ${spec.label} · ${spec.sizeLabel}`
              : "Try again"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** One choice row: the model, what it costs to download, who made it and under
 * what licence. Selection is marked with a word as well as a colour — "In use"
 * / "Selected" — so it survives a colour-blind reader and a dark theme. */
function ModelOption({
  id,
  selected,
  downloaded,
  onPress,
}: {
  id: ModelId;
  selected: boolean;
  downloaded: boolean;
  onPress: () => void;
}) {
  const { t } = useTheme();
  const spec = modelSpec(id);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${spec.label} by ${spec.maker}, ${spec.sizeLabel}${downloaded ? ", already on this phone" : ""}`}
      onPress={onPress}
      style={[
        styles.option,
        { borderColor: selected ? t.green : t.border, backgroundColor: t.canvas },
      ]}
    >
      <View style={styles.optionHead}>
        <Text style={[styles.optionTitle, { color: t.text }]} numberOfLines={1}>
          {spec.label}
        </Text>
        <Text style={[styles.optionSize, { color: selected ? t.green : t.sub }]}>
          {selected ? "Selected · " : ""}
          {downloaded ? "already here" : spec.sizeLabel}
        </Text>
      </View>
      <Text style={[styles.optionMeta, { color: t.sub }]}>
        {spec.maker} · {spec.licence}
      </Text>
      <Text style={[styles.optionBlurb, { color: t.sub }]}>{spec.blurb}</Text>
      <Text style={[styles.optionBlurb, { color: t.sub }]}>
        Needs {spec.requiredFreeLabel} free to install ({formatModelBytes(spec.bytes)} of files).
      </Text>
    </Pressable>
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
  options: { gap: 8, marginTop: 2 },
  optionsLabel: { fontSize: 12, fontWeight: "600" },
  option: {
    borderWidth: 1.5,
    borderRadius: RADIUS,
    padding: 12,
    minHeight: 48,
    gap: 2,
  },
  optionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  optionTitle: { fontSize: 14, fontWeight: "700", flexShrink: 1 },
  optionSize: { fontSize: 12, fontWeight: "700" },
  optionMeta: { fontSize: 11, lineHeight: 16 },
  optionBlurb: { fontSize: 12, lineHeight: 17 },
  note: { fontSize: 11, lineHeight: 16 },
  cta: {
    marginTop: 4,
    borderRadius: RADIUS,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { fontSize: 15, fontWeight: "600" },
});
