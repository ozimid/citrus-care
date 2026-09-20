// F39 — the run's pieces around WalkRunScreen: the row-state helpers it derives
// its view from, the write lock and the D-W9 cover step it runs at the end,
// then the presentational half — the header the user watches for twenty
// minutes (D-W8 copy: a true count, a phase, "about N min" from measured
// durations — never a percentage), the per-photo row, the row's "…" sheet,
// and the end-of-run summary (D-W10: reminders are offered here, never
// scheduled by the runner). Every string is decided by walk-runner.ts
// (tested); this file renders and derives, so WalkRunScreen stays the
// orchestration it is.

import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { assessmentsForWalk, latestAssessmentId, type AssessmentStore } from "../lib/assessment-store";
import { loadAssessmentStore } from "../lib/assessment-store-io";
import { bandColor, healthBand } from "../lib/health";
import { MAX_AUTO_ATTEMPTS, pickWalkCover, type QueuedPhoto } from "../lib/photo-queue";
import { queuedPhotoUri } from "../lib/photo-queue-io";
import { formatTimelineDate } from "../lib/plant-detail";
import { setPlantCover } from "../lib/plant-store-io";
import { deleteWalkIo } from "../lib/plants-io";
import { batchReminderPlan, cancelReminder, RECHECK_REMINDER_KIND } from "../lib/reminders";
import { notificationScheduler } from "../lib/reminders-io";
import { RADIUS, type Tokens } from "../lib/theme";
import {
  WALK_SLOW_LABEL,
  estimateRemainingMs,
  formatMinutes,
  phaseLabel,
  progressLabel,
  summaryCounts,
  summaryHeadline,
  type ItemOutcome,
  type WalkRunResult,
  type WalkSummaryRow,
} from "../lib/walk-runner";

/** One photo's place in the run. "retry" = the user asked for a re-run after
 * the walk; "removed" = gone from the queue and the list. */
export type RowState = "waiting" | "analyzing" | "retry" | "removed" | ItemOutcome;

export function isOutcome(state: RowState | undefined): state is ItemOutcome {
  return typeof state === "object";
}

/** The run's outcomes so far, in run order. */
export function outcomesOf(items: QueuedPhoto[], rows: Record<string, RowState>): ItemOutcome[] {
  return items.map((i) => rows[i.id]).filter(isOutcome);
}

/** Photos the run has not finished (waiting, analyzing, or queued for a retry). */
export function remainingOf(items: QueuedPhoto[], rows: Record<string, RowState>): number {
  return items.filter((i) => !isOutcome(rows[i.id]) && rows[i.id] !== "removed").length;
}

/** A row the user still has a decision on after the run: not a plant (score
 * it anyway?), failed (retry?), or one they already sent back to waiting. A
 * rejected photo is otherwise stranded — never runnable, never "waiting". */
export function needsUser(state: RowState | undefined): boolean {
  return isOutcome(state) ? state.kind !== "assessed" : state === "retry";
}

export function needsUserCount(items: QueuedPhoto[], rows: Record<string, RowState>): number {
  return items.filter((i) => needsUser(rows[i.id])).length;
}

/** The plant's newest assessed outcome of the run — what a summary row opens. */
export function latestAssessedFor(outcomes: ItemOutcome[], plantId: string): Extract<ItemOutcome, { kind: "assessed" }> | null {
  const latest = outcomes.filter((o) => o.kind === "assessed" && o.plantId === plantId).pop();
  return latest?.kind === "assessed" ? latest : null;
}

/** One promise chain for every store write of the run — the runner's marks and
 * persists AND the row sheet's remove / score-anyway — so a tap mid-item never
 * interleaves with a mark's read-modify-write of the same blob. Inference runs
 * outside it; only the writes queue. */
export function useWriteLock() {
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  return useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const run = tail.current.then(work, work);
    tail.current = run.catch(() => {});
    return run;
  }, []);
}

/** D-W9: one cover per plant, whole-plant first, once the run is over.
 * Phase 5: "newest" is effective time everywhere else (the timeline, the
 * trend, the comparison anchor), so a roll imported from July must not take
 * the card thumbnail off a September photo. The run only claims the cover
 * when one of ITS shots is the plant's newest row; otherwise the existing
 * cover stands. Best-effort per plant. */
export async function setWalkCovers(items: QueuedPhoto[], rows: Record<string, RowState>): Promise<void> {
  const byPlant = new Map<string, { assessmentId: string; subject: string; takenAt: string | null }[]>();
  for (const item of items) {
    const o = rows[item.id];
    if (isOutcome(o) && o.kind === "assessed") {
      byPlant.set(o.plantId, [...(byPlant.get(o.plantId) ?? []), { assessmentId: o.assessmentId, subject: o.diagnosis.subject ?? "", takenAt: item.takenAt }]);
    }
  }
  if (byPlant.size === 0) return;
  // Best-effort: with no store `latest` is null and the pre-Phase-5 behaviour
  // (the run sets the cover) stands. A thumbnail must never fail the run — the
  // caller reads a throw here as "storage-error" for every photo.
  let store: AssessmentStore = {};
  try {
    store = await loadAssessmentStore();
  } catch (e) {
    console.error("[WalkSummary] cover guard could not read the store:", (e as Error).message);
  }
  for (const [plantId, shots] of byPlant) {
    const cover = pickWalkCover(shots);
    if (!cover) continue;
    const latest = latestAssessmentId(store, plantId);
    if (latest && !shots.some((s) => s.assessmentId === latest)) continue;
    await setPlantCover(plantId, cover).catch((e: Error) => console.error("[WalkSummary] cover not set:", e.message));
  }
}

/** Best-effort: drop the recheck reminders this summary scheduled for these
 * plants once their assessments are undone. Cancelling a notification is never
 * worth an error in front of the user (the cancelWateringReminders stance);
 * only rows tagged `recheck` are touched, so a legacy kind-less reminder from
 * a diagnosis screen is left alone. */
async function cancelRecheckReminders(plantIds: string[]): Promise<void> {
  if (plantIds.length === 0) return;
  const wanted = new Set(plantIds);
  try {
    for (const req of await notificationScheduler.getScheduled()) {
      const data = req.content.data ?? {};
      if (data.kind === RECHECK_REMINDER_KIND && typeof data.plantId === "string" && wanted.has(data.plantId)) {
        await cancelReminder(notificationScheduler, req.identifier);
      }
    }
  } catch (e) {
    console.error("[WalkSummary] recheck reminders not cancelled:", (e as Error).message);
  }
}

// D-W8: true by construction — the AppState listener requests stop-after-
// current on ANY background transition, so the line states the rule and its
// consequence before it happens, not after.
const LEAVE_LINE =
  "Keep Citrus Care open and the screen on. If you leave the app, the run pauses after this photo — finished photos are saved.";
/** D-W18. Android reports screen-off and an app switch as the same
 * background transition, so the note names both rather than guessing. */
export const PAUSED_LINE = "Paused — Citrus Care went to the background (you left, or the screen turned off). Finished photos are saved.";
const STOPPING_LINE = "Finishing this photo, then stopping — up to 2 minutes";
const STOPPING_ESTIMATE = "Stopping after this photo";
/** D-W8's no-history tier, repeated from the review footer so the promise the
 * user is waiting on is on the screen they are waiting on. */
const NO_HISTORY_LINE = "Up to 2 minutes per photo — often much less";
const REMIND_DENIED_NOTE =
  "Notifications are off for Citrus Care. Enable them in your device settings to get reminders.";
const REMIND_FAILED_NOTE = "Couldn't set the reminders. Please try again.";
/** Phase 6b. Generic and honest (CLAUDE.md): details go to console.error. */
const UNDO_FAILED_NOTE = "Couldn't undo this walk. Please try again.";

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- Header ----

interface HeaderProps {
  total: number;
  /** 0-based index of the photo being analyzed; null between items / at the end. */
  index: number | null;
  plantName: string;
  slow: boolean;
  ring: number[];
  done: number;
  stopping: boolean;
  paused: boolean;
  onStop: () => void;
  t: Tokens;
}

export function WalkRunHeader({ total, index, plantName, slow, ring, done, stopping, paused, onStop, t }: HeaderProps) {
  const position = index === null ? Math.min(done + 1, total) : index + 1;
  const remaining = Math.max(total - done, 0);
  const estimate = estimateRemainingMs(ring, remaining);
  // Once a stop is requested the estimate would contradict the button below it.
  const estimateLine = stopping
    ? STOPPING_ESTIMATE
    : estimate === null
      ? `${NO_HISTORY_LINE} · ${remaining} to go`
      : `${capitalize(formatMinutes(estimate))} left`;
  return (
    <View style={styles.header}>
      <Text style={[styles.heading, { color: t.text }]}>Analyzing your walk</Text>
      <Text
        style={[styles.progress, { color: t.text }]}
        accessibilityLiveRegion="polite"
        accessibilityLabel={`Photo ${position} of ${total}, ${plantName}, ${slow ? "still analyzing, this one is taking longer" : "analyzing"}`}
      >
        {progressLabel(position, total, plantName, slow)}
      </Text>
      <Text style={[styles.estimate, { color: t.sub }]}>{estimateLine}</Text>
      <Text style={[styles.leave, { color: t.text }]}>{LEAVE_LINE}</Text>
      {paused ? (
        <Text style={[styles.paused, { color: t.text, borderColor: t.green }]} accessibilityLiveRegion="polite">
          {PAUSED_LINE}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={stopping ? STOPPING_LINE : "Stop after this photo"}
        accessibilityState={{ disabled: stopping }}
        disabled={stopping}
        onPress={onStop}
        style={[styles.stop, { borderColor: stopping ? t.border : t.text, opacity: stopping ? 0.7 : 1 }]}
      >
        <Text style={[styles.stopText, { color: t.text }]}>{stopping ? STOPPING_LINE : "Stop after this photo"}</Text>
      </Pressable>
    </View>
  );
}

// ---- Post-run list header ----

/** The list after the summary: only the photos the user still has a say on. */
export function WalkItemsHeader({ count, onBack, t }: { count: number; onBack: () => void; t: Tokens }) {
  return (
    <View style={styles.header}>
      <Text style={[styles.heading, { color: t.text }]} accessibilityRole="header">Photos that need you</Text>
      <Text style={[styles.estimate, { color: t.sub }]}>
        {count === 1 ? "1 photo" : `${count} photos`} · tap … on a photo to score it, retry, or remove it
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to summary" onPress={onBack} style={[styles.stop, { borderColor: t.text }]}>
        <Text style={[styles.stopText, { color: t.text }]}>Back to summary</Text>
      </Pressable>
    </View>
  );
}

// ---- Rows ----

function rowCopy(
  item: QueuedPhoto,
  state: RowState,
  phase: "saving" | "analyzing" | null,
  slow: boolean,
  running: boolean,
  scheme: "light" | "dark",
  t: Tokens,
) {
  const tries = `${Math.min(item.attempts + 1, MAX_AUTO_ATTEMPTS)} of ${MAX_AUTO_ATTEMPTS} tries`;
  if (state === "waiting") return { text: "⏳ Waiting", spoken: "waiting", color: t.sub, more: false };
  if (state === "analyzing") {
    return {
      text: `▶ ${slow ? WALK_SLOW_LABEL : phaseLabel(phase ?? "analyzing", false)}`,
      spoken: slow ? "still analyzing, taking longer" : "analyzing",
      color: t.text,
      more: false,
    };
  }
  if (state === "retry") {
    // After the run there is no "after the walk": the record is pending again
    // and surfaces on the Plants card.
    return running
      ? { text: "↻ Will retry after the walk", spoken: "will retry after the walk", color: t.text, more: false }
      : { text: "↻ Back to waiting — find it on the Plants tab", spoken: "back to waiting, find it on the Plants tab", color: t.text, more: false };
  }
  if (state === "removed") return { text: "Removed", spoken: "removed", color: t.sub, more: false };
  if (state.kind === "assessed") {
    const band = healthBand(state.diagnosis.health_score);
    return {
      text: `✓ ${state.diagnosis.health_score} · ${band.label}`,
      spoken: `scored ${state.diagnosis.health_score}, ${band.label}`,
      color: bandColor(band.key, scheme),
      more: false,
    };
  }
  if (state.kind === "rejected") {
    return { text: "⚠ Didn't look like a plant — kept as a photo, not scored", spoken: "didn't look like a plant, kept as a photo, not scored", color: bandColor("fair", scheme), more: true };
  }
  if (state.timedOut) {
    return { text: `⏱ Took too long (2 min) — skipped · ${tries}`, spoken: `took too long, skipped, ${tries}`, color: t.danger, more: true };
  }
  return { text: `✗ Couldn't analyze · ${tries}`, spoken: `couldn't analyze, ${tries}`, color: t.danger, more: true };
}

interface RowProps {
  item: QueuedPhoto;
  position: number;
  total: number;
  state: RowState;
  plantName: string;
  phase: "saving" | "analyzing" | null;
  slow: boolean;
  /** False once the summary is up — changes what a Retry means. */
  running: boolean;
  onMore: (item: QueuedPhoto) => void;
  t: Tokens;
  scheme: "light" | "dark";
}

export function WalkItemRow({ item, position, total, state, plantName, phase, slow, running, onMore, t, scheme }: RowProps) {
  const copy = rowCopy(item, state, phase, slow, running, scheme, t);
  return (
    <View
      style={[styles.row, { backgroundColor: t.card, borderColor: state === "analyzing" ? t.green : t.border }]}
      accessible
      accessibilityLabel={`Photo ${position} of ${total}, ${plantName}, ${copy.spoken}`}
    >
      <Image source={{ uri: queuedPhotoUri(item) }} style={[styles.thumb, { backgroundColor: t.border }]} />
      <View style={styles.rowBody}>
        <Text style={[styles.rowPlant, { color: t.sub }]} numberOfLines={1}>{plantName}</Text>
        <Text style={[styles.rowState, { color: copy.color }]}>{copy.text}</Text>
      </View>
      {copy.more ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`More options for photo ${position}`}
          onPress={() => onMore(item)}
          hitSlop={8}
          style={styles.more}
        >
          <Text style={[styles.moreGlyph, { color: t.text }]}>…</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---- Row sheet ----

export type SheetAction = "score" | "retry" | "view" | "remove";

interface SheetProps {
  target: { item: QueuedPhoto; outcome: ItemOutcome } | null;
  plantName: string;
  /** False once the summary is up: a Retry then sends the photo back to waiting. */
  running: boolean;
  onAction: (action: SheetAction) => void;
  onClose: () => void;
  t: Tokens;
}

/** Rejected → "Score it anyway" (the user's override, F21); failed → Retry.
 * No "Retake" anywhere: a walk photo may have come from the gallery. */
export function WalkItemSheet({ target, plantName, running, onAction, onClose, t }: SheetProps) {
  const rows: { action: SheetAction; label: string; danger?: true }[] = target
    ? [
        ...(target.outcome.kind === "rejected"
          ? [{ action: "score" as const, label: `Score it anyway (adds a health score to ${plantName}'s timeline)` }]
          : [{ action: "retry" as const, label: running ? "Retry after the walk" : "Retry — it goes back to waiting" }]),
        { action: "view", label: "View photo" },
        { action: "remove", label: "Remove photo", danger: true },
      ]
    : [];
  return (
    <Modal visible={target !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable accessibilityLabel="Close" style={styles.sheetBackdropTouch} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: t.card }]}>
          {target ? <Image source={{ uri: queuedPhotoUri(target.item) }} style={styles.sheetPreview} resizeMode="cover" /> : null}
          {rows.map((r) => (
            <Pressable
              key={r.action}
              accessibilityRole="button"
              accessibilityLabel={r.label}
              onPress={() => onAction(r.action)}
              style={[styles.sheetRow, { borderBottomColor: t.border }]}
            >
              <Text style={[styles.sheetRowText, { color: r.danger ? t.danger : t.text }]}>{r.label}</Text>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" onPress={onClose} style={[styles.sheetCancel, { borderColor: t.border }]}>
            <Text style={[styles.sheetCancelText, { color: t.sub }]}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ---- Summary ----

type RemindState =
  | { kind: "idle" }
  | { kind: "setting" }
  /** `ok` false = denied or failed: the note explains, the button stays (a
   * re-tap is idempotent — scheduleReminder replaces, never stacks). */
  | { kind: "done"; message: string; ok: boolean };

interface SummaryProps {
  result: WalkRunResult;
  rows: WalkSummaryRow[];
  /** One line above the headline — the paused note. */
  note?: string | null;
  /** Photos the user still has a say on (not a plant / failed); 0 hides the link. */
  needsYou?: number;
  onShowItems?: () => void;
  onOpenDiagnosis: (row: WalkSummaryRow) => void;
  onRemindAll: () => Promise<{ scheduled: number; denied: boolean }>;
  /** Phase 6b: the walks whose assessments this run landed (usually one;
   * "Analyze all pending" can mix walks). Empty / absent hides "Undo this walk". */
  walkIds?: string[];
  onDone: () => void;
  t: Tokens;
  scheme: "light" | "dark";
}

type UndoState = { kind: "idle" } | { kind: "busy" } | { kind: "failed"; message: string };

/** Phase 6b — the whole walk's assessments, photos included, taken back. The
 * count in the confirm is read from the STORE, not the run's outcomes: a walk
 * resumed across two runs has rows this run never saw, and they go too — so
 * the dialog names how many plants it reaches and that it can't be undone,
 * word for word the way PlantDetailScreen's does. */
async function confirmUndoWalk(walkIds: string[]): Promise<boolean> {
  const store = await loadAssessmentStore();
  const all = walkIds.flatMap((id) => assessmentsForWalk(store, id));
  if (all.length === 0) return false;
  const plants = new Set(all.map((a) => a.plantId)).size;
  const which = walkIds.length === 1 ? "this walk" : "these walks";
  const rows = all.length === 1 ? "1 assessment" : `${all.length} assessments`;
  const on = plants === 1 ? "1 plant" : `${plants} plants`;
  return new Promise((resolve) => {
    Alert.alert(
      `Undo ${which}?`,
      `This removes ${rows} on ${on}, and their photos stored on this phone. Photos still waiting for analysis are kept. This can't be undone.`,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Undo walk", style: "destructive", onPress: () => resolve(true) },
      ],
      // Android back / tap-outside dismisses without a button: settle as a
      // cancel, or the button would stay busy forever.
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

function deltaLine(row: WalkSummaryRow): string | null {
  if (!row.delta) return null;
  const vs = row.anchorDate ? ` · vs. before ${formatTimelineDate(row.anchorDate)}` : "";
  return `${capitalize(row.delta)}${vs}`;
}

/** Mirrors PlantDetailScreen's delta chip: better→good, same→fair, worse→poor
 * — the app's colour+word pairing, so "Worse" is never visually "Better". */
function deltaColor(delta: WalkSummaryRow["delta"], t: Tokens, scheme: "light" | "dark"): string {
  if (delta === "better") return bandColor("good", scheme);
  if (delta === "same") return bandColor("fair", scheme);
  if (delta === "worse") return bandColor("poor", scheme);
  return t.sub;
}

function photosPart(row: WalkSummaryRow): string {
  return `${row.count} ${row.count === 1 ? "photo" : "photos"}`;
}

/** What went wrong for this plant — rendered in the text colour, apart from the
 * count, because it is the part the user has to act on. */
function issuesPart(row: WalkSummaryRow): string | null {
  const parts: string[] = [];
  if (row.rejected) parts.push(`${row.rejected} wasn't a plant`);
  if (row.timedOut) parts.push(`${row.timedOut} took too long`);
  if (row.failed) parts.push(`${row.failed} couldn't be analyzed`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function countsLine(row: WalkSummaryRow): string {
  const issues = issuesPart(row);
  return issues ? `${photosPart(row)} · ${issues}` : photosPart(row);
}

export function WalkSummary({
  result,
  rows,
  note = null,
  needsYou = 0,
  onShowItems,
  onOpenDiagnosis,
  onRemindAll,
  walkIds = [],
  onDone,
  t,
  scheme,
}: SummaryProps) {
  const [remind, setRemind] = useState<RemindState>({ kind: "idle" });
  const [undo, setUndo] = useState<UndoState>({ kind: "idle" });
  const scorable = rows.filter((r) => r.latestScore !== null).length;
  const assessed = result.outcomes.some((o) => o.kind === "assessed");

  /** Confirm (with the store's true count) → deleteWalkIo per walk → leave.
   * A failure keeps the summary up with an honest note; nothing is half-done
   * silently (each assessment is removed whole, in order). */
  async function undoWalk() {
    setUndo({ kind: "busy" });
    try {
      if (!(await confirmUndoWalk(walkIds))) {
        setUndo({ kind: "idle" });
        return;
      }
      for (const walkId of walkIds) await deleteWalkIo(walkId);
      // The re-check reminders this summary just set point at assessments that
      // no longer exist — nothing else would ever clear them. "done" and not
      // ok still means some may have been scheduled before the failure.
      if (remind.kind === "done") {
        await cancelRecheckReminders(batchReminderPlan(rows).map((p) => p.plantId));
      }
      onDone();
    } catch (e) {
      console.error("[WalkSummary] undo walk failed:", (e as Error).message);
      setUndo({ kind: "failed", message: UNDO_FAILED_NOTE });
    }
  }
  const counts = summaryCounts(result);
  // The same register as DiagnosisScreen's rationale: say WHY the intervals
  // differ, when they do (suggestedReminderInterval: lower score or a worse
  // trend → sooner).
  const varied = new Set(batchReminderPlan(rows).map((p) => p.interval)).size > 1;

  async function remindAll() {
    setRemind({ kind: "setting" });
    try {
      const { scheduled, denied } = await onRemindAll();
      if (denied) {
        setRemind({ kind: "done", message: REMIND_DENIED_NOTE, ok: false });
        return;
      }
      const who = `${scheduled} ${scheduled === 1 ? "plant" : "plants"}`;
      setRemind({ kind: "done", message: `✓ Reminders set for ${who}${varied ? " — sooner for the ones doing worse" : ""}`, ok: true });
    } catch (e) {
      console.error("[WalkSummary] reminders failed:", (e as Error).message);
      setRemind({ kind: "done", message: REMIND_FAILED_NOTE, ok: false });
    }
  }

  const remindSettled = remind.kind === "done" && remind.ok;

  return (
    <View style={[styles.summaryRoot, { backgroundColor: t.canvas }]}>
      <ScrollView contentContainerStyle={styles.summaryScroll}>
        {note ? <Text style={[styles.summaryNote, { color: t.sub }]}>{note}</Text> : null}
        <Text style={[styles.headline, { color: t.text }]} accessibilityRole="header" accessibilityLiveRegion="polite">
          {summaryHeadline(result)}
        </Text>
        {counts ? <Text style={[styles.counts, { color: t.text }]}>{counts}</Text> : null}
        {rows.map((row) => {
          const band = row.latestScore === null ? null : healthBand(row.latestScore);
          const color = band ? bandColor(band.key, scheme) : t.sub;
          const delta = deltaLine(row);
          const issues = issuesPart(row);
          const openable = row.latestScore !== null;
          return (
            <Pressable
              key={row.plantId}
              accessibilityRole={openable ? "button" : undefined}
              accessibilityLabel={
                `${row.plantName}, ${countsLine(row)}` +
                (band ? `, latest score ${row.latestScore}, ${band.label}` : ", no score") +
                (delta ? `, ${delta}` : "") +
                (openable ? ". Opens the diagnosis" : "")
              }
              disabled={!openable}
              onPress={() => onOpenDiagnosis(row)}
              style={[styles.plantRow, { backgroundColor: t.card, borderColor: t.border }]}
            >
              <View style={styles.plantBody}>
                <Text style={[styles.plantName, { color: t.text }]} numberOfLines={1}>{row.plantName}</Text>
                <Text style={styles.plantCounts}>
                  <Text style={{ color: t.sub }}>{photosPart(row)}</Text>
                  {issues ? <Text style={{ color: t.text }}>{` · ${issues}`}</Text> : null}
                </Text>
                {delta ? <Text style={[styles.plantDelta, { color: deltaColor(row.delta, t, scheme) }]}>{delta}</Text> : null}
              </View>
              <Text style={[styles.plantScore, { color }]}>{band ? `${row.latestScore} · ${band.label}` : "—"}</Text>
            </Pressable>
          );
        })}

        {scorable > 0 ? (
          <>
            {remindSettled ? null : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remind me to re-check these ${scorable} ${scorable === 1 ? "plant" : "plants"}`}
                disabled={remind.kind === "setting"}
                onPress={remindAll}
                style={[styles.remind, { borderColor: t.green, opacity: remind.kind === "setting" ? 0.6 : 1 }]}
              >
                {remind.kind === "setting" ? (
                  <ActivityIndicator color={t.green} />
                ) : (
                  <Text style={[styles.remindText, { color: t.green }]}>
                    🔔 Remind me to re-check {scorable === 1 ? "this plant" : `these ${scorable} plants`}
                  </Text>
                )}
              </Pressable>
            )}
            {remind.kind === "done" ? (
              <Text style={[styles.remindNote, { color: remind.ok ? t.sub : t.text }]} accessibilityLiveRegion="polite">
                {remind.message}
              </Text>
            ) : null}
          </>
        ) : null}

        {onShowItems && needsYou > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Photos that need you, ${needsYou}`}
            onPress={onShowItems}
            style={[styles.remind, { borderColor: t.text }]}
          >
            <Text style={[styles.remindText, { color: t.text }]}>Photos that need you ({needsYou})</Text>
          </Pressable>
        ) : null}

        <Pressable accessibilityRole="button" accessibilityLabel="Back to plants" onPress={onDone} style={[styles.done, { backgroundColor: t.green }]}>
          <Text style={[styles.doneText, { color: t.onGreen }]}>Back to plants</Text>
        </Pressable>

        {/* Phase 6b: last, quiet and destructive-coloured — the way back when a
            photo landed on the wrong tree. Word + colour, never colour alone. */}
        {assessed && walkIds.length > 0 ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={walkIds.length === 1 ? "Undo this walk" : "Undo these walks"}
              accessibilityHint="Removes every assessment from this walk and deletes its photos"
              accessibilityState={{ disabled: undo.kind === "busy" }}
              disabled={undo.kind === "busy"}
              onPress={undoWalk}
              style={[styles.undo, { borderColor: t.danger, opacity: undo.kind === "busy" ? 0.6 : 1 }]}
            >
              {undo.kind === "busy" ? (
                <ActivityIndicator color={t.danger} />
              ) : (
                <Text style={[styles.remindText, { color: t.danger }]}>{walkIds.length === 1 ? "Undo this walk" : "Undo these walks"}</Text>
              )}
            </Pressable>
            {undo.kind === "failed" ? (
              <Text style={[styles.remindNote, { color: t.text }]} accessibilityLiveRegion="assertive">
                {undo.message}
              </Text>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 12, gap: 6 },
  heading: { fontSize: 22, fontWeight: "600", letterSpacing: -0.4 },
  progress: { fontSize: 15, fontWeight: "600", lineHeight: 21 },
  estimate: { fontSize: 13 },
  leave: { fontSize: 13, lineHeight: 18 },
  paused: { fontSize: 13, lineHeight: 18, borderWidth: 1, borderRadius: RADIUS, paddingHorizontal: 12, paddingVertical: 8 },
  stop: { marginTop: 6, borderWidth: 1, borderRadius: RADIUS, minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  stopText: { fontSize: 15, fontWeight: "600", textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: RADIUS, padding: 10, minHeight: 64 },
  thumb: { width: 44, height: 44, borderRadius: RADIUS - 4 },
  rowBody: { flex: 1, gap: 2 },
  rowPlant: { fontSize: 12, fontWeight: "600" },
  rowState: { fontSize: 14, fontWeight: "600", lineHeight: 19 },
  more: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  moreGlyph: { fontSize: 22, fontWeight: "700" },
  sheetBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheetBackdropTouch: { flex: 1 },
  sheet: { borderTopLeftRadius: RADIUS + 6, borderTopRightRadius: RADIUS + 6, paddingTop: 14, paddingHorizontal: 20, paddingBottom: 34, gap: 2 },
  sheetPreview: { width: 72, height: 72, borderRadius: RADIUS - 2, alignSelf: "center", marginBottom: 8 },
  sheetRow: { minHeight: 52, justifyContent: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  sheetRowText: { fontSize: 16, fontWeight: "600", lineHeight: 22 },
  sheetCancel: { marginTop: 12, borderWidth: 1, borderRadius: RADIUS, minHeight: 48, alignItems: "center", justifyContent: "center" },
  sheetCancelText: { fontSize: 15, fontWeight: "600" },
  summaryRoot: { flex: 1, paddingTop: 68 },
  summaryScroll: { paddingHorizontal: 20, paddingBottom: 40, gap: 12 },
  summaryNote: { fontSize: 13, lineHeight: 18 },
  headline: { fontSize: 20, fontWeight: "600", lineHeight: 27, letterSpacing: -0.3 },
  counts: { fontSize: 15, lineHeight: 21 },
  plantRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: RADIUS, padding: 14, minHeight: 64 },
  plantBody: { flex: 1, gap: 2 },
  plantName: { fontSize: 15, fontWeight: "600" },
  plantCounts: { fontSize: 12, lineHeight: 17 },
  plantDelta: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
  plantScore: { fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  remind: { borderWidth: 1, borderRadius: RADIUS, minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 4, paddingHorizontal: 12 },
  remindText: { fontSize: 15, fontWeight: "600", textAlign: "center" },
  remindNote: { fontSize: 13, textAlign: "center", lineHeight: 18, marginTop: 4 },
  done: { borderRadius: RADIUS, minHeight: 50, alignItems: "center", justifyContent: "center" },
  doneText: { fontSize: 16, fontWeight: "600" },
  undo: { borderWidth: 1, borderRadius: RADIUS, minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 12, paddingHorizontal: 12 },
});
