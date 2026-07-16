import { Pressable, StyleSheet, Text, View } from "react-native";
import { CAPTURE_HINT } from "../lib/capture-modes";

// Viewfinder chrome for the capture screen. F21 deleted the segmented mode
// pill and the three per-mode guide shapes: the user should not have to tell a
// vision model what it is looking at. One neutral frame and one fixed hint
// keep the "get closer" nudge without asking for a classification. Purely
// presentational — the hint string lives in src/lib/capture-modes.ts (tested).

const GUIDE_COLOR = "rgba(255,255,255,0.85)";

/** One neutral frame for every shot. It says "fill this", not "this must be a
 * leaf" — the subject is the model's call. */
export function GuideOverlay() {
  return (
    <View pointerEvents="none" style={styles.guideArea}>
      <View style={[styles.dashed, styles.frame]} />
    </View>
  );
}

export function CaptureHint() {
  return (
    <View style={styles.hintWrap}>
      <Text style={styles.hint}>{CAPTURE_HINT}</Text>
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
  /** Deliberately shape-neutral: a soft rectangle suits a leaf, a whole tree
   * and a sawn branch end equally, which is the point. */
  frame: { width: 280, height: 380, borderRadius: 28 },
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
