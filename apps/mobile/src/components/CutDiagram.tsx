// The cut technique as a PICTURE — the user's ask, verbatim: "show what it
// means... not too much text." Three panels: the right cut flanked by the two
// classic mistakes, each carrying only ✓/✗ and two or three words. Drawn with
// plain Views (no image assets, no SVG dependency), so it is theme-aware and
// weighs nothing.
//
// Two variants matching PruningPack.technique:
//   "bud"    — cut just above an outward bud, slanting away: too high leaves a
//              dying stub, too close kills the bud. (Roses, perennials, soft
//              growth.)
//   "collar" — cut just outside the branch collar: flush cuts wound the trunk,
//              stubs rot. (Trees and woody shrubs.)

import { StyleSheet, Text, View } from "react-native";
import type { Tokens } from "../lib/theme";

interface Props {
  technique: "bud" | "collar";
  t: Tokens;
}

export function CutDiagram({ technique, t }: Props) {
  const Panel = technique === "bud" ? BudPanel : CollarPanel;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={
        technique === "bud"
          ? "Diagram: cut just above a bud, slanting away from it. Cutting too high leaves a stub; too close damages the bud."
          : "Diagram: cut just outside the branch collar. A flush cut wounds the trunk; a long stub rots."
      }
      style={styles.row}
    >
      <Panel kind="good" t={t} />
      <Panel kind="high" t={t} />
      <Panel kind="close" t={t} />
    </View>
  );
}

type Kind = "good" | "high" | "close";

const BUD_CAPTION: Record<Kind, string> = { good: "just above", high: "stub dies", close: "kills bud" };
const COLLAR_CAPTION: Record<Kind, string> = { good: "at collar", high: "stub rots", close: "flush wound" };

/** A stem with a side bud; the red/green bar is where the blade goes. */
function BudPanel({ kind, t }: { kind: Kind; t: Tokens }) {
  const good = kind === "good";
  const color = good ? t.green : t.danger;
  // Where the cut bar sits relative to the bud (top: 8 = bud height ~26).
  const cutTop = kind === "good" ? 16 : kind === "high" ? 0 : 27;
  return (
    <View style={styles.panel}>
      <View style={styles.canvas}>
        <View style={[styles.stem, { backgroundColor: budStem(t) }]} />
        {/* Outward-facing bud */}
        <View style={[styles.bud, { backgroundColor: t.green }]} />
        {/* The cut: slanted away from the bud when correct, flat when wrong */}
        <View
          style={[
            styles.cut,
            { top: cutTop, backgroundColor: color, transform: [{ rotate: good ? "-20deg" : "0deg" }] },
          ]}
        />
      </View>
      <Text style={[styles.mark, { color }]}>{good ? "✓" : "✗"}</Text>
      <Text style={[styles.caption, { color: good ? t.text : t.sub }]} numberOfLines={1}>
        {BUD_CAPTION[kind]}
      </Text>
    </View>
  );
}

/** A trunk with a branch; the bar shows where the blade goes vs the collar. */
function CollarPanel({ kind, t }: { kind: Kind; t: Tokens }) {
  const good = kind === "good";
  const color = good ? t.green : t.danger;
  // Branch runs right from the trunk; the collar is the swelling at its base.
  const cutLeft = kind === "good" ? 22 : kind === "high" ? 44 : 11;
  return (
    <View style={styles.panel}>
      <View style={styles.canvas}>
        <View style={[styles.trunk, { backgroundColor: budStem(t) }]} />
        {/* Collar swelling */}
        <View style={[styles.collar, { backgroundColor: budStem(t) }]} />
        <View style={[styles.branch, { backgroundColor: budStem(t) }]} />
        <View style={[styles.cutVertical, { left: cutLeft, backgroundColor: color }]} />
      </View>
      <Text style={[styles.mark, { color }]}>{good ? "✓" : "✗"}</Text>
      <Text style={[styles.caption, { color: good ? t.text : t.sub }]} numberOfLines={1}>
        {COLLAR_CAPTION[kind]}
      </Text>
    </View>
  );
}

/** Wood color that reads on both themes without a new token. */
function budStem(t: Tokens): string {
  return t.sub;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", gap: 10, marginVertical: 4 },
  panel: { flex: 1, alignItems: "center", gap: 2 },
  canvas: { width: 56, height: 56, position: "relative" },
  // --- bud variant ---
  stem: { position: "absolute", left: 26, top: 6, width: 5, height: 46, borderRadius: 2.5 },
  bud: {
    position: "absolute",
    left: 31,
    top: 24,
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  cut: { position: "absolute", left: 16, width: 26, height: 3, borderRadius: 1.5 },
  // --- collar variant ---
  trunk: { position: "absolute", left: 4, top: 2, width: 8, height: 52, borderRadius: 3 },
  collar: {
    position: "absolute",
    left: 12,
    top: 22,
    width: 8,
    height: 14,
    borderRadius: 4,
    opacity: 0.7,
  },
  branch: { position: "absolute", left: 16, top: 25, width: 36, height: 6, borderRadius: 3 },
  cutVertical: { position: "absolute", top: 16, width: 3, height: 24, borderRadius: 1.5 },
  mark: { fontSize: 14, fontWeight: "800" },
  caption: { fontSize: 10, fontWeight: "600" },
});
