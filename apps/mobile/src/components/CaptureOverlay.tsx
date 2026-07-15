import { Pressable, StyleSheet, Text, View } from "react-native";
import { CAPTURE_MODES, captureMode, type CaptureModeKey } from "../lib/capture-modes";

// Viewfinder chrome for the capture screen (design doc §6): a segmented mode
// pill, a per-mode guide drawn with plain Views (dashed ellipse ≈ leaf, large
// dashed ellipse + trunk lines ≈ whole plant, dashed circle ≈ pruning cut),
// and the guidance hint. Purely presentational — mode state lives in
// CaptureScreen; the strings live in src/lib/capture-modes.ts (tested).

const GUIDE_COLOR = "rgba(255,255,255,0.85)";

export function ModePill({
  mode,
  onSelect,
}: {
  mode: CaptureModeKey;
  onSelect: (mode: CaptureModeKey) => void;
}) {
  return (
    <View style={styles.pill}>
      {CAPTURE_MODES.map((m) => {
        const selected = m.key === mode;
        return (
          <Pressable
            key={m.key}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onSelect(m.key)}
            style={[styles.pillSegment, selected ? styles.pillSegmentSelected : null]}
          >
            <Text style={[styles.pillText, { opacity: selected ? 1 : 0.75 }]}>{m.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function GuideOverlay({ mode }: { mode: CaptureModeKey }) {
  const guide = captureMode(mode).guide;
  return (
    <View pointerEvents="none" style={styles.guideArea}>
      {guide === "leaf-ellipse" ? <View style={[styles.dashed, styles.leaf]} /> : null}
      {guide === "plant-frame" ? (
        <View style={styles.plantWrap}>
          <View style={[styles.dashed, styles.plant]} />
          <View style={styles.trunk}>
            <View style={styles.trunkLine} />
            <View style={styles.trunkLine} />
          </View>
        </View>
      ) : null}
      {guide === "cut-circle" ? <View style={[styles.dashed, styles.cut]} /> : null}
    </View>
  );
}

export function ModeHint({ mode }: { mode: CaptureModeKey }) {
  return (
    <View style={styles.hintWrap}>
      <Text style={styles.hint}>{captureMode(mode).hint}</Text>
    </View>
  );
}

/** Translucent round chrome button (close/retake/gallery) shared by the
 * capture and review screens. */
export function RoundButton({
  label,
  glyph,
  onPress,
  size = 40,
  disabled = false,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  size?: number;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.roundButton,
        { width: size, height: size, borderRadius: size / 2, opacity: disabled ? 0.4 : 1 },
      ]}
    >
      <Text style={[styles.roundButtonGlyph, { fontSize: size >= 56 ? 22 : 16 }]}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 999,
    padding: 4,
    gap: 2,
  },
  pillSegment: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  pillSegmentSelected: { backgroundColor: "rgba(255,255,255,0.28)" },
  pillText: { color: "#ffffff", fontSize: 13, fontWeight: "600" },
  guideArea: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  dashed: {
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: GUIDE_COLOR,
  },
  leaf: { width: 220, height: 320, borderRadius: 160 },
  plantWrap: { alignItems: "center" },
  plant: { width: 280, height: 430, borderRadius: 215 },
  trunk: { flexDirection: "row", gap: 16, marginTop: -60 },
  trunkLine: { width: 2, height: 64, backgroundColor: GUIDE_COLOR },
  cut: { width: 220, height: 220, borderRadius: 110 },
  hintWrap: {
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: 320,
  },
  hint: { color: "#ffffff", fontSize: 13, fontWeight: "500", textAlign: "center" },
  roundButton: {
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  roundButtonGlyph: { color: "#ffffff", fontWeight: "600" },
});
