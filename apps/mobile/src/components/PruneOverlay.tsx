// F23 — the photo with the cuts marked on it. Each mark is a dashed halo over
// the REGION the model pointed at, plus a numbered arrow that stops at the
// halo's edge. The number keys straight into the step list underneath, so the
// arrow never has to carry the instruction on its own.
//
// The arrow points AT the region and never into it. That is the whole design:
// an arrowhead landing on a pixel inside the halo is a crosshair, and a
// crosshair claims a precision this model tier does not have — localizing thin
// elongated structures against cluttered self-similar backgrounds is its
// documented failure mode (docs/research/pruning-rules.md). Stopping at the
// boundary says "the branch is in here", which is the strongest honest claim
// available while still being the arrow a grower actually asked for.
//
// Two more decisions that keep the marks honest:
//  - The image is rendered at the photo's OWN aspect ratio and stretched to
//    fill it. Cuts are percentages of the photo, so any crop-to-fit would slide
//    every mark off the branch it was pointing at. Stretch keeps mark and pixel
//    in the same coordinate space even if the stored aspect is wrong — a
//    visibly squashed photo beats a confidently misplaced arrow.
//  - The arrow approaches from whichever side has room (prune-plan's
//    placeMark), so a mark near an edge stays readable instead of being
//    clipped. That side is a layout choice and says nothing about the plant.

import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { PruneCut } from "@citrus/shared";
import { placeMark } from "../lib/prune-plan";
import type { Tokens } from "../lib/theme";

const BADGE = 28;
const SHAFT = 18;
const HEAD = 7;
const GROUP_HEIGHT = BADGE;

/** A cut we agreed to draw: coordinates present and trusted. */
type PlacedCut = PruneCut & { x: number; y: number };

interface Props {
  photoUri: string;
  /** width / height of the photo the cuts were measured against. */
  photoAspect: number;
  cuts: PruneCut[];
  doneCuts: number[];
  /** Highlighted mark (the step the grower is on), or null. */
  activeIndex: number | null;
  onSelectCut: (index: number) => void;
  t: Tokens;
  /** Caution color from the shared health bands — amber, theme-aware. */
  activeColor: string;
}

export function PruneOverlay({
  photoUri,
  photoAspect,
  cuts,
  doneCuts,
  activeIndex,
  onSelectCut,
  t,
  activeColor,
}: Props) {
  // Only cuts we were willing to place are drawn — but they keep their ORIGINAL
  // index, so badge 2 is still step 2 even when step 1 had no usable location.
  const placed = cuts
    .map((cut, index) => ({ cut, index }))
    .filter(
      (entry): entry is { cut: PlacedCut; index: number } =>
        entry.cut.x !== undefined && entry.cut.y !== undefined,
    );

  return (
    <View style={[styles.frame, { aspectRatio: photoAspect, borderColor: t.border }]}>
      <Image
        source={{ uri: photoUri }}
        style={StyleSheet.absoluteFill}
        resizeMode="stretch"
        accessibilityLabel="Photo of the plant with the suggested cut areas marked"
      />
      {placed.map(({ cut, index }) => (
        <Mark
          key={index}
          cut={cut}
          index={index}
          done={doneCuts.includes(index)}
          active={activeIndex === index}
          onPress={() => onSelectCut(index)}
          t={t}
          activeColor={activeColor}
        />
      ))}
    </View>
  );
}

function Mark({
  cut,
  index,
  done,
  active,
  onPress,
  t,
  activeColor,
}: {
  cut: PlacedCut;
  index: number;
  done: boolean;
  active: boolean;
  onPress: () => void;
  t: Tokens;
  activeColor: string;
}) {
  const place = placeMark(cut);
  const color = done ? "#64748b" : active ? activeColor : t.green;
  const { box } = place;

  // Clamp the ORIGIN and derive the extent from the clamped value: using the
  // raw width would translate the halo instead of clipping it, sliding it off
  // the region it is meant to mark.
  const top = Math.max(0, Math.min(100, box.top));
  const left = Math.max(0, Math.min(100, box.left));

  return (
    <>
      <View
        pointerEvents="none"
        style={[
          styles.halo,
          {
            top: `${top}%`,
            left: `${left}%`,
            width: `${Math.max(0, Math.min(100 - left, box.right - left))}%`,
            height: `${Math.max(0, Math.min(100 - top, box.bottom - top))}%`,
            borderColor: color,
            backgroundColor: `${color}22`,
            opacity: done ? 0.5 : 1,
          },
        ]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Cut ${index + 1}: ${cut.label}${done ? ", done" : ""}. Marks the area only — find the branch yourself.`}
        accessibilityState={{ selected: active }}
        onPress={onPress}
        hitSlop={12}
        style={[
          styles.group,
          // The arrow hangs off the region's edge; its tip touches the boundary.
          place.side === "left"
            ? { right: `${100 - place.tipX}%` }
            : { left: `${place.tipX}%` },
          {
            top: `${place.tipY}%`,
            marginTop: -GROUP_HEIGHT / 2,
            flexDirection: place.side === "left" ? "row" : "row-reverse",
          },
        ]}
      >
        <View style={[styles.badge, { backgroundColor: color }]}>
          <Text style={styles.badgeText}>{done ? "✓" : index + 1}</Text>
        </View>
        <View style={[styles.shaft, { backgroundColor: color }]} />
        <View
          style={
            place.side === "left"
              ? [styles.headBase, styles.headRight, { borderLeftColor: color }]
              : [styles.headBase, styles.headLeft, { borderRightColor: color }]
          }
        />
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  halo: {
    position: "absolute",
    borderWidth: 2,
    borderRadius: 8,
    borderStyle: "dashed",
  },
  frame: {
    width: "100%",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  group: {
    position: "absolute",
    alignItems: "center",
    height: GROUP_HEIGHT,
  },
  badge: {
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    alignItems: "center",
    justifyContent: "center",
    // A white ring so the badge reads on a dark leaf and a bright sky alike.
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.92)",
  },
  badgeText: { color: "#ffffff", fontSize: 13, fontWeight: "800" },
  shaft: { width: SHAFT, height: 3 },
  headBase: {
    width: 0,
    height: 0,
    borderTopWidth: HEAD,
    borderBottomWidth: HEAD,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
  },
  headRight: { borderLeftWidth: HEAD * 1.4 },
  headLeft: { borderRightWidth: HEAD * 1.4 },
});
