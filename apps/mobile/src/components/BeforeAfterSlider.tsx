import { useRef, useState } from "react";
import { Image, PanResponder, StyleSheet, Text, View, type ImageURISource } from "react-native";
import { INITIAL_SLIDER_POSITION, sliderPositionFromX } from "../lib/slider";
import { RADIUS, type Tokens } from "../lib/theme";

// Before/after recovery slider (web BeforeAfterSlider parity): the "after"
// photo fills the stage, the "before" photo sits in a width-clipped overlay,
// and a PanResponder drags the divider. All geometry math lives in the tested
// src/lib/slider.ts; this file is only rendering + gesture wiring.

export interface SliderPhoto {
  source: ImageURISource;
  dateLabel: string;
}

interface Props {
  before: SliderPhoto;
  after: SliderPhoto;
  t: Tokens;
}

export function BeforeAfterSlider({ before, after, t }: Props) {
  const [position, setPosition] = useState(INITIAL_SLIDER_POSITION);
  const [width, setWidth] = useState(0);
  // The PanResponder closure is created once; it reads the width via ref.
  const widthRef = useRef(0);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) =>
        setPosition(sliderPositionFromX(evt.nativeEvent.locationX, widthRef.current)),
      onPanResponderMove: (evt) =>
        setPosition(sliderPositionFromX(evt.nativeEvent.locationX, widthRef.current)),
    }),
  ).current;

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
      <Text style={[styles.title, { color: t.sub }]}>VISUAL RECOVERY COMPARISON</Text>
      <Text style={[styles.hint, { color: t.sub }]}>
        Drag the handle to compare the first assessment with the latest.
      </Text>
      <View
        {...pan.panHandlers}
        accessibilityLabel="Before and after comparison slider"
        onLayout={(e) => {
          widthRef.current = e.nativeEvent.layout.width;
          setWidth(e.nativeEvent.layout.width);
        }}
        style={styles.stage}
      >
        <Image
          source={after.source}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          accessibilityLabel="Latest photo"
        />
        {/* Before photo: clip box grows/shrinks with the handle; the image
            inside keeps the full stage width so it never squishes. */}
        <View style={[styles.clip, { width: `${position}%` }]} pointerEvents="none">
          {width > 0 ? (
            <Image
              source={before.source}
              style={{ width, height: "100%" }}
              resizeMode="cover"
              accessibilityLabel="First photo"
            />
          ) : null}
        </View>
        <View style={[styles.tag, styles.tagLeft]} pointerEvents="none">
          <Text style={styles.tagText}>Before · {before.dateLabel}</Text>
        </View>
        <View style={[styles.tag, styles.tagRight]} pointerEvents="none">
          <Text style={styles.tagText}>After · {after.dateLabel}</Text>
        </View>
        <View style={[styles.divider, { left: `${position}%` }]} pointerEvents="none">
          <View style={styles.handle}>
            <Text style={styles.handleGlyph}>↔</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS,
    padding: 16,
    gap: 6,
  },
  title: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  hint: { fontSize: 12, lineHeight: 17, marginBottom: 4 },
  stage: {
    aspectRatio: 16 / 9,
    borderRadius: RADIUS - 4,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  clip: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    overflow: "hidden",
  },
  divider: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 3,
    marginLeft: -1.5,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  handle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  handleGlyph: { color: "#111111", fontSize: 13, fontWeight: "700" },
  tag: {
    position: "absolute",
    top: 8,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
    zIndex: 1,
  },
  tagLeft: { left: 8 },
  tagRight: { right: 8 },
  tagText: { color: "#ffffff", fontSize: 10, fontWeight: "600" },
});
