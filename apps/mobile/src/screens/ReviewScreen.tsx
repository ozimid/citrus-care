import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { RoundButton } from "../components/CaptureOverlay";
import { captureMode, type CaptureModeKey } from "../lib/capture-modes";
import type { PreparedPhoto } from "../lib/photo-io";
import { RADIUS, useTheme } from "../lib/theme";

// Post-capture review (design doc §3: capture → analyzing → result). This
// wave ends here: the photo is already downscaled (1600px JPEG q0.85), the
// mode and plant are chosen, and "Analyze" stays disabled until the /assess
// wiring lands in the next build. Nothing is uploaded or stored.

interface Props {
  photo: PreparedPhoto;
  plantName: string;
  mode: CaptureModeKey;
  onRetake: () => void;
  onClose: () => void;
}

export function ReviewScreen({ photo, plantName, mode, onRetake, onClose }: Props) {
  const { t } = useTheme();
  return (
    <View style={styles.root}>
      <Image
        source={{ uri: photo.uri }}
        style={StyleSheet.absoluteFill}
        resizeMode="contain"
        accessibilityLabel="Captured photo"
      />
      <View style={styles.topBar}>
        <RoundButton label="Retake" glyph="‹" onPress={onRetake} />
        <View style={styles.chip}>
          <Text style={styles.chipText} numberOfLines={1}>
            🪴 {plantName} · {captureMode(mode).label}
          </Text>
        </View>
        <RoundButton label="Close" glyph="✕" onPress={onClose} />
      </View>
      <View style={styles.bottomArea}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Analyze (next build)"
          disabled
          style={[styles.analyze, { backgroundColor: t.green, opacity: 0.5 }]}
        >
          <Text style={[styles.analyzeText, { color: t.onGreen }]}>Analyze (next build)</Text>
        </Pressable>
        <Text style={styles.note}>Analysis lands in the next build — nothing is uploaded yet.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 62,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  chip: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  chipText: { color: "#ffffff", fontSize: 14, fontWeight: "600" },
  bottomArea: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: 42,
    paddingHorizontal: 24,
    gap: 12,
  },
  analyze: {
    borderRadius: RADIUS,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  analyzeText: { fontSize: 16, fontWeight: "600" },
  note: { color: "rgba(255,255,255,0.75)", fontSize: 12, textAlign: "center" },
});
