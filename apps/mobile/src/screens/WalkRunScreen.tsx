import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, FlatList, Image, Modal, StyleSheet, Text, View } from "react-native";
import type { AssessmentDiagnosis } from "@citrus/shared";
import { buildAssessDeps } from "../components/assess-deps";
import { useLocalEngine } from "../components/LocalEngineProvider";
import { PhotoViewer } from "../components/PhotoViewer";
import {
  isOutcome, latestAssessedFor, needsUser, needsUserCount, outcomesOf, PAUSED_LINE, remainingOf, setWalkCovers, useWriteLock, WalkItemRow,
  WalkItemSheet, WalkItemsHeader, WalkRunHeader, WalkSummary,
  type RowState, type SheetAction,
} from "../components/WalkSummary";
import { persistDeferredAssessment, runAssess, type AssessDeps, type AssessPhase, type AssessResult } from "../lib/assess";
import { saveLastAssessDebug } from "../lib/assess-debug-io";
import { loadAssessmentStore } from "../lib/assessment-store-io";
import { useKeepAwakeWhile } from "../lib/keep-awake-io";
import { persistLocalAssessment } from "../lib/local-engine-io";
import { pushDuration, type QueuedPhoto } from "../lib/photo-queue";
import {
  completeQueued, loadDurations, loadPhotoQueue, markAnalyzingIo, markFailedIo, markPendingIo, markRejectedIo, queuedPhotoUri, recordDuration,
  removeQueuedPhoto, setRunActive,
} from "../lib/photo-queue-io";
import { linkPhotoToAssessment } from "../lib/photo-store-io";
import type { PlantListItem } from "../lib/plants";
import { loadDiagnosisContext } from "../lib/plants-io";
import { batchReminderPlan, scheduleReminder } from "../lib/reminders";
import { notificationScheduler } from "../lib/reminders-io";
import { useTheme } from "../lib/theme-io";
import {
  anchorsByPlant, runWalk, summarizeWalk, withStoredDiagnosis,
  type ItemOutcome, type WalkControl, type WalkHooks, type WalkRunResult, type WalkRunnerDeps, type WalkSummaryRow,
} from "../lib/walk-runner";
import { DiagnosisScreen } from "./DiagnosisScreen";

// F39 — the run (D-W5): every queued photo through the single-shot assess flow,
// one at a time, under the shared 25 s / 120 s budget. The sequencing, the
// breaker and every label are walk-runner.ts (pure, tested); this screen wires
// the production deps per photo (D-W6 anchor, D-W9 no cover writes), persists
// marks through photo-queue-io, and renders (the pieces are WalkSummary.tsx).
// No Close while it runs — the only control is "Stop after this photo";
// leaving the app requests the same (D-W18). Covers are set once per plant at
// the end (D-W9), then the summary offers the one bulk reminder (D-W10) and a
// way back to the photos that still need a decision. The model closure lives
// in assess-deps.ts — never here.

const SHEET_ERROR = "Couldn't update that photo. Please try again.";

interface Props {
  items: QueuedPhoto[];
  plants: PlantListItem[];
  /** The user left the summary; N assessments landed in this run. */
  onFinished: (assessedCount: number) => void;
  onClose: () => void;
}

export function WalkRunScreen({ items, plants, onFinished, onClose }: Props) {
  const { t, scheme } = useTheme();
  const localEngine = useLocalEngine();
  const lock = useWriteLock();
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const rowsRef = useRef(rows);
  const [current, setCurrent] = useState<{ index: number; item: QueuedPhoto } | null>(null);
  const [phase, setPhase] = useState<AssessPhase | null>(null);
  const [slow, setSlow] = useState(false);
  const [ring, setRing] = useState<number[]>([]);
  const [stopping, setStopping] = useState(false);
  const [paused, setPaused] = useState(false);
  const [result, setResult] = useState<WalkRunResult | null>(null);
  /** Post-run: the summary hands off to the list of photos that need a decision. */
  const [showItems, setShowItems] = useState(false);
  const [sheet, setSheet] = useState<{ item: QueuedPhoto; outcome: ItemOutcome } | null>(null);
  const [viewing, setViewing] = useState<{ uri: string; caption?: string } | null>(null);
  const [opened, setOpened] = useState<{ row: WalkSummaryRow; diagnosis: AssessmentDiagnosis } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const stopRef = useRef(false);
  const retryRef = useRef(new Set<string>());
  /** The anchor each photo was marked with — per (plant, walk) by the runner (D-W6). */
  const anchorsRef = useRef<Record<string, string>>({});
  const startedRef = useRef(false);
  const running = result === null;

  const setRow = useCallback((id: string, state: RowState) => {
    rowsRef.current = { ...rowsRef.current, [id]: state };
    setRows(rowsRef.current);
  }, []);
  const nameOf = useCallback((plantId: string | null) => plants.find((p) => p.id === plantId)?.name ?? "Plant", [plants]);
  const requestStop = useCallback(() => void ((stopRef.current = true), setStopping(true)), []);
  /** The result the summary reads, derived from the rows (in memory, D-W18). */
  const finalResult = useCallback(
    (run: Omit<WalkRunResult, "outcomes" | "remaining">): WalkRunResult => ({
      ...run, outcomes: outcomesOf(items, rowsRef.current), remaining: remainingOf(items, rowsRef.current),
    }),
    [items],
  );
  /** A post-run row action (score / retry / remove) re-derives the summary. */
  const refreshSummary = useCallback(() => setResult((prev) => (prev ? finalResult(prev) : prev)), [finalResult]);

  useKeepAwakeWhile(running, "walk-analysis");
  useEffect(() => () => void (stopRef.current = true), []); // a host unmounting us mid-run ends the headless run after this photo
  // D-W18: leaving the app requests stop-after-current; the screen says so.
  useEffect(() => {
    if (!running) return;
    const sub = AppState.addEventListener("change", (s) => void (s !== "active" && (requestStop(), setPaused(true))));
    return () => sub.remove();
  }, [requestStop, running]);

  /** Per-photo production wiring with this walk's anchor (D-W6) and no cover
   * writes (D-W9); a record whose dims were unreadable is measured here. */
  const depsFor = useCallback(async (item: QueuedPhoto, anchorIso: string, context: string): Promise<AssessDeps> => {
    const known = { width: item.width, height: item.height };
    const size = item.needsDims ? await Image.getSize(queuedPhotoUri(item)).catch(() => known) : known;
    const base = buildAssessDeps(localEngine, size, context, {
      persist: (a) => lock(() => persistLocalAssessment(a, { compareBeforeIso: anchorIso, updateCover: false })),
    });
    return { ...base, linkPhoto: (id, entry) => lock(() => linkPhotoToAssessment(id, entry)) };
  }, [localEngine, lock]);

  /** The assess flow returns the model's raw parse; the deterministic
   * better/same/worse is injected on persist and only the id comes back — so
   * the outcome the summary, the bulk reminder and the opened diagnosis read
   * is the STORED row. A failed read keeps the model's (no delta, never a wrong one). */
  const stored = useCallback(async (result: AssessResult): Promise<AssessResult> => {
    if (result.status !== "assessed") return result;
    try {
      return withStoredDiagnosis(result, await loadAssessmentStore());
    } catch (e) {
      console.error("[WalkRunScreen] stored diagnosis not read:", (e as Error).message);
      return result;
    }
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    setRunActive(true);
    let ringNow: number[] = [];
    const deps: WalkRunnerDeps = {
      assess: async (item, anchorIso) => {
        const plantId = item.plantId as string;
        const uri = queuedPhotoUri(item);
        const assessDeps = await depsFor(item, anchorIso, await loadDiagnosisContext(plantId));
        return stored(await runAssess(assessDeps, { plantId, photoUri: uri, savedUri: uri, force: false }, { onDebug: (d) => void saveLastAssessDebug(d) }));
      },
      markAnalyzing: (item, nowIso, anchorIso) => {
        anchorsRef.current[item.id] = anchorIso;
        return lock(() => markAnalyzingIo(item.id, nowIso, anchorIso));
      },
      markAssessed: (item) => lock(() => completeQueued(item.id)),
      markRejected: (item, diagnosis) => lock(() => markRejectedIo(item.id, diagnosis)),
      markFailed: (item, error, timedOut) => lock(() => markFailedIo(item.id, error, timedOut)),
      // restoreAttempts: the engine never ran, so the count goes back to what it was (D-W2 caps runs).
      markPending: (item, options) => lock(() => markPendingIo(item.id, options?.restoreAttempts ? { attempts: item.attempts } : undefined)),
      whenIdle: localEngine.whenIdle,
      now: Date.now,
    };
    const control: WalkControl = { requested: () => stopRef.current, stopAfterCurrent: requestStop };
    const hooks: WalkHooks = {
      onItemStart: (_i, item) => void (setCurrent({ index: items.findIndex((x) => x.id === item.id), item }), setPhase(null), setSlow(false), setRow(item.id, "analyzing")),
      onPhase: setPhase,
      onSlow: () => setSlow(true),
      onItemEnd: (_index, outcome) => {
        setRow(outcome.id, outcome);
        if (outcome.kind !== "assessed") return;
        setRing((ringNow = pushDuration(ringNow, outcome.durationMs)));
        // The ring is an estimate, not the record: a failed write is logged, never a storage-error.
        recordDuration(outcome.durationMs).catch((e: Error) => console.error("[WalkRunScreen] duration not recorded:", e.message));
      },
    };
    (async () => {
      setRing((ringNow = await loadDurations()));
      let run = await runWalk(items, deps, control, hooks);
      // The user's retries run after the walk, on the persisted records (which
      // carry the anchor); only a walk that finished on its own earns them.
      // Loop until none are left — a Retry tapped during the last photo, or a
      // photo that failed again in a retry pass, is honoured, never silently
      // dropped — and drain the write lock first so an in-flight Retry write
      // (whose .then adds the id) is seen.
      while (run.endedBy === "complete") {
        await lock(() => Promise.resolve());
        if (retryRef.current.size === 0) break;
        const q = await loadPhotoQueue();
        const again = items.filter((i) => retryRef.current.has(i.id)).map((i) => q[i.id] ?? i);
        retryRef.current.clear();
        const next = await runWalk(again, deps, control, hooks);
        run = { ...next, durationsMs: [...run.durationsMs, ...next.durationsMs] };
      }
      await setWalkCovers(items, rowsRef.current);
      setCurrent(null);
      setResult(finalResult(run));
    })()
      .catch((e: Error) => void (console.error("[WalkRunScreen] run failed:", e.message), setCurrent(null), setResult(finalResult({ endedBy: "storage-error", durationsMs: [] }))))
      .finally(() => setRunActive(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs exactly once, over the items the review handed us
  }, []);

  const onSheetAction = useCallback((action: SheetAction) => {
    const target = sheet;
    setSheet(null);
    setNotice(null);
    if (!target) return;
    const { item, outcome } = target;
    const plantId = item.plantId as string;
    const uri = queuedPhotoUri(item);
    const fail = (e: Error) => void (console.error("[WalkRunScreen] row action failed:", e.message), setNotice(SHEET_ERROR));
    if (action === "view") {
      setViewing({ uri, caption: nameOf(plantId) });
    } else if (action === "retry") {
      // Mid-run: queued for the retry pass. Post-run: simply back to waiting — the Plants card picks it up.
      lock(() => markPendingIo(item.id, { attempts: 0 })).then(() => void (retryRef.current.add(item.id), setRow(item.id, "retry"), refreshSummary()), fail);
    } else if (action === "remove") {
      Alert.alert("Remove this photo?", "It is deleted from this phone. This can't be undone.", [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => lock(() => removeQueuedPhoto(item.id)).then(() => void (setRow(item.id, "removed"), refreshSummary()), fail) },
      ]);
    } else if (outcome.kind === "rejected") {
      // F21: the user's override — the kept diagnosis is written as-is, no
      // second inference — against the anchor THIS photo was marked with
      // (per plant+walk, D-W6); the persisted record carries it too.
      (async () => {
        const anchor = anchorsRef.current[item.id] ?? (await lock(() => loadPhotoQueue()))[item.id]?.runAnchorIso ?? new Date().toISOString();
        const deps = await depsFor(item, anchor, "");
        const assessmentId = await persistDeferredAssessment(deps, { plantId, photoUri: uri, savedUri: uri, diagnosis: outcome.diagnosis, raw: "" });
        await lock(() => completeQueued(item.id));
        const { diagnosis } = await stored({ status: "assessed", assessmentId, diagnosis: outcome.diagnosis, localUri: uri });
        setRow(item.id, { kind: "assessed", id: item.id, plantId, assessmentId, diagnosis, durationMs: 0 });
        // Post-run the D-W9 cover pass has already happened: redo it for this plant only (best-effort).
        if (!running) await setWalkCovers(items.filter((i) => i.plantId === plantId), rowsRef.current);
        refreshSummary();
      })().catch(fail);
    }
  }, [depsFor, items, lock, nameOf, refreshSummary, running, setRow, sheet, stored]);

  const summaryRows = useMemo(
    () => (result ? summarizeWalk(result.outcomes, plants, anchorsByPlant(result.outcomes, anchorsRef.current)) : []),
    [plants, result],
  );
  const assessedCount = result ? result.outcomes.filter((o) => o.kind === "assessed").length : 0;
  const openDiagnosis = useCallback((row: WalkSummaryRow) => {
    const latest = result ? latestAssessedFor(result.outcomes, row.plantId) : null;
    if (latest) setOpened({ row, diagnosis: latest.diagnosis });
  }, [result]);
  /** D-W10: the one bulk offer; replace-don't-stack lives in scheduleReminder,
   * and the first call is the one that asks for permission. */
  const remindAll = useCallback(async () => {
    let scheduled = 0;
    for (const plan of batchReminderPlan(summaryRows)) {
      if (!(await scheduleReminder(notificationScheduler, plan)).ok) return { scheduled, denied: true };
      scheduled += 1;
    }
    return { scheduled, denied: false };
  }, [summaryRows]);
  const finish = useCallback(() => void (onFinished(assessedCount), onClose()), [assessedCount, onClose, onFinished]);

  const listItems = running ? items.filter((i) => rows[i.id] !== "removed") : items.filter((i) => needsUser(rows[i.id]));
  const needsYou = needsUserCount(items, rows);

  return (
    // Its own Modal so the hardware back reaches THIS onRequestClose (RN's Android Modal consumes
    // the key; a BackHandler listener under the host's Modal never fires). Running → stop after this photo.
    <Modal visible animationType="none" onRequestClose={running ? requestStop : showItems ? () => setShowItems(false) : finish}>
      {result && !showItems ? (
        <WalkSummary
          result={result} rows={summaryRows} note={paused ? PAUSED_LINE : null} needsYou={needsYou} onShowItems={() => setShowItems(true)}
          onOpenDiagnosis={openDiagnosis} onRemindAll={remindAll} onDone={finish} t={t} scheme={scheme}
        />
      ) : (
        <View style={[styles.root, { backgroundColor: t.canvas }]}>
          {result ? (
            <WalkItemsHeader count={needsYou} onBack={() => setShowItems(false)} t={t} />
          ) : (
            <WalkRunHeader
              total={items.length} index={current?.index ?? null} plantName={nameOf(current?.item.plantId ?? null)} slow={slow} ring={ring}
              done={items.length - remainingOf(items, rows)} stopping={stopping} paused={paused} onStop={requestStop} t={t}
            />
          )}
          {notice ? <Text style={[styles.notice, { color: t.danger }]} accessibilityLiveRegion="assertive">{notice}</Text> : null}
          <FlatList
            data={listItems}
            keyExtractor={(i) => i.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <WalkItemRow
                item={item} position={items.indexOf(item) + 1} total={items.length} state={rows[item.id] ?? "waiting"} plantName={nameOf(item.plantId)}
                phase={phase} slow={slow} running={running} t={t} scheme={scheme}
                onMore={(target) => void (isOutcome(rows[target.id]) && setSheet({ item: target, outcome: rows[target.id] as ItemOutcome }))}
              />
            )}
          />
        </View>
      )}
      {/* Modals, so they are reachable from the summary AND the list (a post-run action's error stays visible). */}
      <Modal visible={opened !== null} animationType="slide" onRequestClose={() => setOpened(null)}>
        {opened ? <DiagnosisScreen diagnosis={opened.diagnosis} plantId={opened.row.plantId} plantName={opened.row.plantName} onDone={() => setOpened(null)} /> : null}
      </Modal>
      <WalkItemSheet target={sheet} plantName={nameOf(sheet?.item.plantId ?? null)} running={running} onAction={onSheetAction} onClose={() => setSheet(null)} t={t} />
      <PhotoViewer photo={viewing} onClose={() => setViewing(null)} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 68 },
  notice: { fontSize: 13, paddingHorizontal: 20, marginBottom: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 8 },
});
