// Full-screen photo view — the "let me actually SEE the plant" answer to
// 56px timeline thumbnails and text-only dashboard cards (user request
// 2026-08-31). The saved photos are 1600px JPEGs, so rendering one at
// resizeMode="contain" on a phone screen IS the full-quality view; no
// zoom library is needed for that, and adding one would cost a native
// dependency (pinch-zoom is a follow-up if the contain view isn't enough).
//
// Deliberately dumb: a Modal, the photo, a caption, a close button, and
// tap-anywhere-to-dismiss — the same gesture every gallery app has taught.

import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "react-native";

interface Props {
  /** Null = closed. */
  photo: { uri: string; caption?: string } | null;
  onClose: () => void;
}

export function PhotoViewer({ photo, onClose }: Props) {
  return (
    <Modal
      visible={photo !== null}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      {photo ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          onPress={onClose}
          style={styles.backdrop}
        >
          <Image
            source={{ uri: photo.uri }}
            style={styles.photo}
            resizeMode="contain"
            accessibilityLabel={photo.caption ?? "Plant photo, full screen"}
          />
          <View style={styles.chrome} pointerEvents="none">
            {photo.caption ? <Text style={styles.caption}>{photo.caption}</Text> : null}
            <Text style={styles.hint}>Tap anywhere to close</Text>
          </View>
        </Pressable>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.96)",
    justifyContent: "center",
  },
  photo: { width: "100%", height: "100%" },
  chrome: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingBottom: 40,
    gap: 4,
    alignItems: "center",
  },
  caption: { color: "#ffffff", fontSize: 14, fontWeight: "600", textAlign: "center" },
  hint: { color: "rgba(255,255,255,0.55)", fontSize: 12 },
});
