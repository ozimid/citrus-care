import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { CAPTURE_HINT, SNAP_TIPS } from "../lib/capture-modes";
import { RADIUS } from "../lib/theme";

// Viewfinder chrome for the capture screen. F21 deleted the segmented mode
// pill and the three per-mode guide shapes: the user should not have to tell a
// vision model what it is looking at. F35 removed the framing rectangle too
// (it read as a crop preview and nothing is cropped); one honest hint remains.
// keep the "get closer" nudge without asking for a classification. Purely
// presentational — the hint string lives in src/lib/capture-modes.ts (tested).
// The permission state and the F36 tips guide live here too, so the
// viewfinder file stays readable as walk mode lands.


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

/** Camera permission not granted: ask (first time) or point at the device
 * settings (denied for good). Gallery import stays available beneath it. */
export function PermissionState({ denied, onRequest }: { denied: boolean; onRequest: () => void }) {
  return (
    <View style={styles.permission}>
      <Text style={styles.permissionTitle}>
        {denied ? "Camera access is off" : "Camera permission needed"}
      </Text>
      <Text style={styles.permissionBody}>
        {denied
          ? "Enable camera access for Citrus Care in your device settings to photograph plants. You can still import a photo from your gallery below."
          : "Citrus Care uses the camera to photograph your plants for health checks."}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={denied ? () => Linking.openSettings() : onRequest}
        style={styles.permissionButton}
      >
        <Text style={styles.permissionButtonText}>
          {denied ? "Open settings" : "Allow camera"}
        </Text>
      </Pressable>
    </View>
  );
}

/** F36 — the "getting a good photo" guide: shown once on first open, and on
 * demand from the ? button. The tips themselves are pure (capture-modes.ts). */
export function SnapTipsOverlay({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  if (!visible) return null;
  return (
    <View style={styles.tipsOverlay}>
      <View style={styles.tipsCard}>
        <Text style={styles.tipsTitle}>Getting a good photo</Text>
        {SNAP_TIPS.map((tip) => (
          <View key={tip.title} style={styles.tipRow}>
            <Text style={styles.tipGlyph}>{tip.glyph}</Text>
            <View style={styles.tipTextWrap}>
              <Text style={styles.tipTitle}>{tip.title}</Text>
              <Text style={styles.tipBody}>{tip.body}</Text>
            </View>
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close photo tips"
          onPress={onClose}
          style={styles.tipsCta}
        >
          <Text style={styles.tipsCtaText}>Got it</Text>
        </Pressable>
      </View>
    </View>
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
  /** Deliberately shape-neutral: a soft rectangle suits a leaf, a whole tree
   * and a sawn branch end equally, which is the point. */
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
  permission: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 10,
  },
  permissionTitle: { color: "#ffffff", fontSize: 17, fontWeight: "600" },
  permissionBody: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 300,
  },
  permissionButton: {
    marginTop: 8,
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: RADIUS,
    paddingVertical: 12,
    paddingHorizontal: 22,
  },
  permissionButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  tipsOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    padding: 24,
  },
  tipsCard: {
    backgroundColor: "rgba(20,24,20,0.97)",
    borderRadius: RADIUS * 1.5,
    padding: 20,
    gap: 16,
  },
  tipsTitle: { color: "#ffffff", fontSize: 18, fontWeight: "700" },
  tipRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  tipGlyph: { fontSize: 22 },
  tipTextWrap: { flex: 1, gap: 2 },
  tipTitle: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  tipBody: { color: "rgba(255,255,255,0.75)", fontSize: 13, lineHeight: 19 },
  tipsCta: {
    marginTop: 4,
    backgroundColor: "#059669",
    borderRadius: RADIUS,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  tipsCtaText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
});
