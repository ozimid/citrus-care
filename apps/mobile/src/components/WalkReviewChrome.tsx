// The review screen's chrome (F39): the per-tile action sheet, the picker's
// run toggle, the empty state and the fixed footer. The footer asks the
// every-time question (D-W7): engine off/failed/crashed swaps the primary for
// the setup card and makes Later the primary; preparing/downloading and the
// store guard (D-W17) disable it with the reason beside it — never a silent
// grey button.

import { Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import type { LocalEngineState } from "../lib/local-engine";
import type { QueuedPhoto } from "../lib/photo-queue";
import { queuedPhotoUri } from "../lib/photo-queue-io";
import { RADIUS, type Tokens } from "../lib/theme";
import { expectedCopy } from "../lib/walk-runner";
import { LocalEngineSetupCard } from "./LocalEngineSetupCard";

/** D-W8: the commitment before the wait — "about N min" measured from the last
 * runs once there is history, else the per-photo ceiling in plain words
 * (expectedCopy, tested; never a multiple of the 120 s kill). */
function waitLine(runnable: number, ring: number[]): string {
  if (runnable === 0) return "Each photo takes up to 2 minutes to analyze on this phone.";
  return expectedCopy(runnable, ring);
}
function staysWaitingLine(needsPlant: number): string {
  return needsPlant === 1
    ? "1 photo stays waiting — it still needs a plant."
    : `${needsPlant} photos stay waiting — they still need a plant.`;
}
const STARTING_REASON = "The AI is starting — Analyze now unlocks in a moment";
const NOTHING_RUNNABLE_REASON = "Assign a plant to at least one photo first";

export type TileAction = "assign" | "marker" | "new-plant" | "view" | "remove";

/** The only per-photo menu: assign, use as tree marker (rung 1c), new plant,
 * view, remove (the one confirm). A tag card / marker row keeps view and
 * remove only — its "Keep photo" toggle is on the row itself. `canMark` is
 * false where the view cannot show what a marker would move (a plant's own
 * strip shows one plant; the marker applies to the whole walk) — the row is
 * then not offered at all rather than offered blind. */
export function TileActionSheet({
  item,
  t,
  canMark,
  onAction,
  onClose,
}: {
  item: QueuedPhoto | null;
  t: Tokens;
  canMark: boolean;
  onAction: (action: TileAction, item: QueuedPhoto) => void;
  onClose: () => void;
}) {
  const rows: { action: TileAction; label: string; danger?: true }[] = [
    ...(item?.isMarker
      ? []
      : [
          { action: "assign" as const, label: item?.plantId ? "Assign to another plant…" : "Assign this photo…" },
          ...(canMark ? [{ action: "marker" as const, label: "Use as tree marker…" }] : []),
          { action: "new-plant" as const, label: "New plant…" },
        ]),
    { action: "view", label: "View photo" },
    { action: "remove", label: "Remove photo", danger: true },
  ];
  return (
    <Modal visible={item !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable accessibilityLabel="Close" style={styles.sheetBackdropTouch} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: t.card }]}>
          {item ? (
            <Image source={{ uri: queuedPhotoUri(item) }} style={styles.sheetPreview} resizeMode="cover" />
          ) : null}
          {rows.map((r) => (
            <Pressable
              key={r.action}
              accessibilityRole="button"
              accessibilityLabel={r.label}
              onPress={() => item && onAction(r.action, item)}
              style={[styles.sheetRow, { borderBottomColor: t.border }]}
            >
              <Text style={[styles.sheetRowText, { color: r.danger ? t.danger : t.text }]}>{r.label}</Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={[styles.sheetCancel, { borderColor: t.border }]}
          >
            <Text style={[styles.sheetCancelText, { color: t.sub }]}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** D-W3 rung 1b, as the picker's footer: one tap turns "this photo" into
 * "this photo and the ones shot after it, until the next one I assign". */
export function RunToggle({ on, onToggle, t }: { on: boolean; onToggle: () => void; t: Tokens }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel="Also the photos after this one, until the next one I assign"
      onPress={onToggle}
      style={[styles.toggle, { borderColor: on ? t.green : t.border }]}
    >
      <Text style={[styles.toggleBox, { color: on ? t.green : t.sub }]}>{on ? "☑" : "☐"}</Text>
      <Text style={[styles.toggleText, { color: t.text }]}>
        Also the photos after this one, until the next one I assign
      </Text>
    </Pressable>
  );
}

/** `silent` when a read failed: the banner above is the state then, and this
 * only keeps the one-handed exit where the footer would be. */
export function WalkEmptyState({ t, onDone, silent = false }: { t: Tokens; onDone: () => void; silent?: boolean }) {
  return (
    <View style={styles.emptyRoot}>
      <View style={styles.center}>
        {silent ? null : (
          <>
            <Text style={[styles.emptyTitle, { color: t.text }]}>Nothing waiting</Text>
            <Text style={[styles.emptyBody, { color: t.sub }]}>
              These photos were analyzed, moved to another plant, or removed.
            </Text>
          </>
        )}
      </View>
      <View style={[styles.footer, { backgroundColor: t.card, borderTopColor: t.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Done"
          onPress={onDone}
          style={[styles.primary, { backgroundColor: t.green }]}
        >
          <Text style={[styles.primaryText, { color: t.onGreen }]}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface FooterProps {
  /** importSummary output — "12 photos · 10 assigned · 2 need a plant". */
  summary: string;
  /** runnableItems(...).length — what Analyze now would start. */
  runnable: number;
  /** The measured per-photo durations (loadDurations) behind the estimate. */
  ring: number[];
  /** Photos Analyze now leaves behind — said in words, not inferred from a count. */
  needsPlant: number;
  engine: LocalEngineState["kind"];
  /** canRunBatch's reason when the record store is too full; null when ok. */
  guardReason: string | null;
  /** A one-line, user-safe message from the parent (e.g. a partial import).
   * Stays for the whole review — a per-tap acknowledgement never replaces it. */
  notice: string | null;
  /** The screen's own acknowledgement of the last tap ("Assigned 3 photos to
   * Lemon 3") — its own line, under the parent's. */
  flash: string | null;
  busy: boolean;
  onAnalyze: () => void;
  onLater: () => void;
  t: Tokens;
}

export function WalkReviewFooter({
  summary,
  runnable,
  ring,
  needsPlant,
  engine,
  guardReason,
  notice,
  flash,
  busy,
  onAnalyze,
  onLater,
  t,
}: FooterProps) {
  const engineDown = engine === "off" || engine === "failed" || engine === "crashed";
  const starting = engine === "preparing" || engine === "downloading";
  const reason =
    guardReason ?? (starting ? STARTING_REASON : runnable === 0 ? NOTHING_RUNNABLE_REASON : null);
  const canAnalyze = !engineDown && reason === null && !busy;
  return (
    <View style={[styles.footer, { backgroundColor: t.card, borderTopColor: t.border }]}>
      <Text style={[styles.summary, { color: t.text }]} accessibilityLiveRegion="polite">
        {summary}
      </Text>
      {engineDown ? null : <Text style={[styles.wait, { color: t.sub }]}>{waitLine(runnable, ring)}</Text>}
      {notice ? (
        <Text
          style={[styles.notice, { color: t.text, borderColor: t.green }]}
          accessibilityLiveRegion="polite"
        >
          {notice}
        </Text>
      ) : null}
      {flash ? (
        <Text
          style={[styles.notice, { color: t.text, borderColor: t.green }]}
          accessibilityLiveRegion="polite"
        >
          {flash}
        </Text>
      ) : null}
      {engineDown ? (
        <LocalEngineSetupCard />
      ) : (
        <>
          {reason ? <Text style={[styles.reason, { color: guardReason ? t.danger : t.text }]}>{reason}</Text> : null}
          {needsPlant > 0 && runnable > 0 ? (
            <Text style={[styles.reason, { color: t.text }]}>{staysWaitingLine(needsPlant)}</Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Analyze now, ${runnable} ${runnable === 1 ? "photo" : "photos"}`}
            accessibilityState={{ disabled: !canAnalyze }}
            disabled={!canAnalyze}
            onPress={onAnalyze}
            style={[styles.primary, { backgroundColor: t.green, opacity: canAnalyze ? 1 : 0.45 }]}
          >
            <Text style={[styles.primaryText, { color: t.onGreen }]}>Analyze now ({runnable})</Text>
          </Pressable>
        </>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Later — keep the photos waiting on this phone"
        disabled={busy}
        onPress={onLater}
        style={[
          styles.secondary,
          engineDown
            ? { backgroundColor: t.green, borderColor: t.green }
            : { borderColor: t.border, backgroundColor: t.card },
        ]}
      >
        <Text style={[styles.secondaryText, { color: engineDown ? t.onGreen : t.text }]}>
          Later — find them on the Plants tab
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sheetBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheetBackdropTouch: { flex: 1 },
  sheet: {
    borderTopLeftRadius: RADIUS + 6,
    borderTopRightRadius: RADIUS + 6,
    paddingTop: 14,
    paddingHorizontal: 20,
    paddingBottom: 34,
    gap: 2,
  },
  sheetPreview: { width: 72, height: 72, borderRadius: RADIUS - 2, alignSelf: "center", marginBottom: 8 },
  sheetRow: { minHeight: 52, justifyContent: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  sheetRowText: { fontSize: 16, fontWeight: "600" },
  sheetCancel: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: RADIUS,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetCancelText: { fontSize: 15, fontWeight: "600" },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    marginTop: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: RADIUS,
  },
  toggleBox: { fontSize: 20 },
  toggleText: { flex: 1, fontSize: 14, lineHeight: 19 },
  emptyRoot: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: "600" },
  emptyBody: { fontSize: 14, lineHeight: 20, textAlign: "center", maxWidth: 280 },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 8,
  },
  summary: { fontSize: 15, fontWeight: "700" },
  wait: { fontSize: 12, lineHeight: 17 },
  notice: {
    fontSize: 13,
    lineHeight: 18,
    borderWidth: 1,
    borderRadius: RADIUS,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  reason: { fontSize: 14, lineHeight: 19, fontWeight: "600" },
  primary: { borderRadius: RADIUS, minHeight: 50, alignItems: "center", justifyContent: "center" },
  primaryText: { fontSize: 16, fontWeight: "600" },
  secondary: {
    borderWidth: 1,
    borderRadius: RADIUS,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { fontSize: 15, fontWeight: "600" },
});
