import * as Application from "expo-application";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalEngine } from "../components/LocalEngineProvider";
import { CutDiagram } from "../components/CutDiagram";
import { LocalEngineSetupCard } from "../components/LocalEngineSetupCard";
import { bandColor } from "../lib/health";
import { formatTimelineDate } from "../lib/plant-detail";
import { PruneOverlay } from "../components/PruneOverlay";
import { downscalePhoto } from "../lib/photo-io";
import { latestPhotoForPlant } from "../lib/photo-store";
import { loadPhotoIndex, savePlantPhoto } from "../lib/photo-store-io";
import {
  MARKS_CAVEAT,
  MARKS_FIRST_RUN_NOTICE,
  drawableMarkCount,
  friendlyPruneError,
} from "../lib/prune-plan";
import { runPruneAnalysis, type PruneAnalysisDeps, type PrunePhase } from "../lib/prune-flow";
import {
  loadLatestPrunePlan,
  loadMarksNoticeSeen,
  markMarksNoticeSeen,
  persistPrunePlan,
  saveLastPruneDebug,
  toggleCut,
} from "../lib/prune-io";
import type { PruneDebugInfo } from "../lib/prune-flow";
import { buildPruneDebugMailto, buildPruneVideoSearchUrl } from "../lib/support";
import { cutProgress, type StoredPrunePlan } from "../lib/prune-store";
import {
  bestWindowLabel,
  nextPruneWindowStart,
  promptRulesFor,
  pruningPackFor,
  seasonVerdict,
  type Hemisphere,
  type SeasonStatus,
} from "../lib/pruning-rules";
import { formatLocalReminderDate, schedulePruneReminder } from "../lib/reminders";
import { notificationScheduler } from "../lib/reminders-io";
import { RADIUS, type Tokens } from "../lib/theme";
import { useTheme } from "../lib/theme-io";
import { cachedLocalConditions } from "../lib/weather-io";

// F23 "Where to prune" — photograph the plant, and the on-device model marks
// where to cut on the photo.
//
// The screen is deliberately ordered so the trustworthy part comes first: the
// SEASON verdict and the species RULES are deterministic (pruning-rules.ts,
// grounded in extension-service research), and they are on screen whether or
// not the model produces a single usable mark. The AI marks come after, under
// a caveat. A plan with zero placeable marks is still a useful screen.

const PHASE_LABEL: Record<PrunePhase, string> = {
  saving: "Saving photo…",
  analyzing: "Working out the cuts on this phone…",
};
const SLOW_LABEL = "Still working. This one is taking longer than usual.";
const PHOTO_ERROR = "Couldn't process that photo. Please try again.";
const NOT_A_PLANT =
  "That photo doesn't look like a plant, so there's nothing to mark. Take another one showing the branches.";

interface PlantInput {
  id: string;
  name: string;
  plant_type: string;
  species: string | null;
  cultivar: string | null;
  /** Only used to work out the hemisphere from the cached geocode. */
  zip_code?: string | null;
}

interface Props {
  plant: PlantInput;
  onClose: () => void;
  /** A plan was stored — the detail screen should reload its summary row. */
  onChanged?: () => void;
}

export function PruneScreen({ plant, onClose, onChanged }: Props) {
  const { t, scheme } = useTheme();
  const localEngine = useLocalEngine();
  const [record, setRecord] = useState<StoredPrunePlan | null>(null);
  const [phase, setPhase] = useState<PrunePhase | null>(null);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);
  const [activeCut, setActiveCut] = useState<number | null>(null);
  // Pruning windows are stored northern-hemisphere (every source behind them
  // is). The cached geocode is the only hemisphere signal the app has offline;
  // northern stands until it says otherwise, and every verdict states the
  // condition as well as the months.
  const [hemisphere, setHemisphere] = useState<Hemisphere>("northern");
  const [noticeSeen, setNoticeSeen] = useState(true);
  /** F23 reminders: idle → setting → set(dateLabel) | note(message). */
  const [rulesOpen, setRulesOpen] = useState(false);
  /** The plant's newest on-phone photo — the default thing to analyse. */
  const [latest, setLatest] = useState<{ uri: string; dateLabel: string } | null>(null);
  /** The last shot analysed, kept so "Try again" never demands a re-take.
   * `durable` = already in the photo store, so a retry must not re-copy it. */
  const lastShotRef = useRef<{ uri: string; width: number; height: number; durable: boolean } | null>(
    null,
  );
  /** What the last run actually did (raw model text included, stays on-phone). */
  const [debug, setDebug] = useState<PruneDebugInfo | null>(null);
  const [reminder, setReminder] = useState<
    | { kind: "idle" }
    | { kind: "setting" }
    | { kind: "set"; dateLabel: string }
    | { kind: "note"; message: string }
  >({ kind: "idle" });

  /** Guards the picker + downscale window that `phase` cannot see. */
  const busyRef = useRef(false);

  const pack = useMemo(() => pruningPackFor(plant), [plant]);
  const season = useMemo(
    () => seasonVerdict(pack, new Date().getMonth() + 1, hemisphere),
    [hemisphere, pack],
  );
  const busy = phase !== null;
  // Reactive, unlike isReady(): the screen can gate the camera on it instead of
  // discovering the problem after the walk to the plant and the shot.
  const engineReady = localEngine.state.kind === "ready";
  /** Amber from the shared health bands, not a hardcoded hex. */
  const caution = bandColor("fair", scheme);
  const busyLabel = slow ? SLOW_LABEL : phase ? PHASE_LABEL[phase] : "";

  useEffect(() => {
    let cancelled = false;
    loadLatestPrunePlan(plant.id)
      .then((latest) => {
        if (!cancelled) setRecord(latest);
      })
      .catch((e) => console.error("[PruneScreen] plan load failed:", (e as Error).message));
    loadPhotoIndex()
      .then((index) => {
        const entry = latestPhotoForPlant(index, plant.id);
        if (!cancelled && entry) {
          setLatest({ uri: entry.localUri, dateLabel: formatTimelineDate(entry.createdAt) });
        }
      })
      .catch((e) => console.error("[PruneScreen] photo index load failed:", (e as Error).message));
    loadMarksNoticeSeen().then((seen) => {
      if (!cancelled) setNoticeSeen(seen);
    });
    cachedLocalConditions(plant.zip_code ?? null)
      .then(({ hemisphere: detected }) => {
        if (!cancelled && detected) setHemisphere(detected);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [plant.id, plant.zip_code]);

  const buildDeps = useCallback(
    (): PruneAnalysisDeps => ({
      isReady: localEngine.isReady,
      savePhoto: savePlantPhoto,
      // Device V&V round 3 (2026-08-31): the model's own words were "the
      // image is too small and lacks sufficient detail". It was right — this
      // used to shrink every photo to 512px (the DIAGNOSIS discipline, where a
      // leaf close-up survives it). Branch structure does not. The saved photo
      // is already the 1600px pipeline JPEG; the vision encoder resizes to its
      // own fixed input internally, so hand it everything we have.
      prepare: async (uri) => uri,
      generate: ({ imageUri, system, user }) =>
        localEngine.generate({ system, user, imageUri }),
      persist: persistPrunePlan,
      interrupt: localEngine.interrupt,
    }),
    [localEngine],
  );

  const analyze = useCallback(
    async (photo: { uri: string; width: number; height: number; durable?: boolean }) => {
      lastShotRef.current = { ...photo, durable: photo.durable === true };
      setError(null);
      setRejected(false);
      setSlow(false);
      setActiveCut(null);
      setDebug(null);
      try {
        const result = await runPruneAnalysis(
          buildDeps(),
          {
            plantId: plant.id,
            photoUri: photo.uri,
            photoAspect: photo.height > 0 ? photo.width / photo.height : 1,
            ruleClass: pack.key,
            rules: promptRulesFor(plant, new Date().getMonth() + 1, hemisphere),
            savedUri: photo.durable ? photo.uri : null,
          },
          {
            onPhase: setPhase,
            onSlow: () => setSlow(true),
            // The saved copy is the durable one — a retry reuses it instead of
            // copying the photo into storage again (critic finding).
            onPhotoSaved: (localUri) => {
              lastShotRef.current = { ...photo, uri: localUri, durable: true };
            },
            // What the model actually said, kept on the phone — the difference
            // between "it failed" and knowing why (device feedback 2026-08-31).
            onDebug: (info) => {
              setDebug(info);
              void saveLastPruneDebug(info);
            },
          },
        );
        if (result.status === "rejected") {
          setRejected(true);
          return;
        }
        setRecord(await loadLatestPrunePlan(plant.id));
        onChanged?.();
      } catch (e) {
        setError(friendlyPruneError(e));
      } finally {
        setPhase(null);
        setSlow(false);
      }
    },
    [buildDeps, hemisphere, onChanged, pack.key, plant],
  );

  /** Analyse the photo the user already took — RN gives us its size. */
  const useLatestPhoto = useCallback(() => {
    if (!latest || busyRef.current) return;
    busyRef.current = true;
    Image.getSize(
      latest.uri,
      (width, height) => {
        busyRef.current = false;
        void analyze({ uri: latest.uri, width, height, durable: true });
      },
      (e) => {
        busyRef.current = false;
        console.error("[PruneScreen] latest photo unreadable:", String(e));
        setError(PHOTO_ERROR);
      },
    );
  }, [analyze, latest]);

  const retrySameShot = useCallback(() => {
    if (lastShotRef.current) void analyze(lastShotRef.current);
  }, [analyze]);

  const emailDetails = useCallback(() => {
    if (!debug) return;
    Linking.openURL(buildPruneDebugMailto(Application.nativeApplicationVersion, debug)).catch((e) =>
      console.error("[PruneScreen] mailto failed:", (e as Error).message),
    );
  }, [debug]);

  const capture = useCallback(
    async (source: "camera" | "gallery") => {
      // The picker and the downscale run BEFORE runPruneAnalysis reports a
      // phase, so without this the buttons stay live for a second or two with
      // nothing on screen changing — and a second tap queues a second analysis
      // and stores a second plan.
      if (busyRef.current) return;
      busyRef.current = true;
      // A new capture invalidates the previous shot: if the picker or the
      // downscale fails, "Try again — same photo" must not quietly retry the
      // OLD photo the user thinks they just replaced (critic finding).
      lastShotRef.current = null;
      setError(null);
      setRejected(false);
      try {
        const result =
          source === "camera"
            ? await ImagePicker.launchCameraAsync({ quality: 1 })
            : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
        if (result.canceled || !result.assets[0]) return;
        const asset = result.assets[0];
        const prepared = await downscalePhoto(asset.uri, {
          width: asset.width,
          height: asset.height,
        });
        await analyze(prepared);
      } catch (e) {
        console.error("[PruneScreen] capture failed:", (e as Error).message);
        setError(PHOTO_ERROR);
      } finally {
        busyRef.current = false;
      }
    },
    [analyze],
  );

  // A 25-120s run against a 30s screen timeout, with both hands full of
  // secateurs. The download already holds the screen awake; inference is the
  // flow where the phone actually gets put down.
  useEffect(() => {
    if (!busy) return;
    activateKeepAwakeAsync("prune-analysis").catch(() => {});
    return () => {
      deactivateKeepAwake("prune-analysis").catch(() => {});
    };
  }, [busy]);

  const tick = useCallback(async (planId: string, index: number) => {
    try {
      setRecord(await toggleCut(planId, index));
    } catch (e) {
      console.error("[PruneScreen] tick failed:", (e as Error).message);
    }
  }, []);

  const remindMe = useCallback(async () => {
    setReminder({ kind: "setting" });
    try {
      const windowStart = nextPruneWindowStart(pack, new Date(), hemisphere);
      const outcome = await schedulePruneReminder(notificationScheduler, {
        plantId: plant.id,
        plantName: plant.name,
        packLabel: pack.label,
        windowStart,
      });
      if (outcome.ok) {
        setReminder({ kind: "set", dateLabel: formatLocalReminderDate(outcome.date) });
      } else {
        setReminder({
          kind: "note",
          message: "Notifications are off for Citrus Care — enable them in your device settings.",
        });
      }
    } catch (e) {
      console.error("[PruneScreen] prune reminder failed:", (e as Error).message);
      setReminder({ kind: "note", message: "Couldn't set the reminder. Please try again." });
    }
  }, [hemisphere, pack, plant.id, plant.name]);

  const progress = record ? cutProgress(record) : null;
  /** What is actually ON the photo — not what the plan contains. Tested in
   * prune-plan.test.ts; two bugs came from having it inline here. */
  const drawnMarks = record ? drawableMarkCount(record.plan) : 0;

  return (
    <View style={[styles.root, { backgroundColor: t.canvas }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to plant"
          onPress={onClose}
          hitSlop={10}
          style={[styles.back, { borderColor: t.border, backgroundColor: t.card }]}
        >
          <Text style={[styles.backGlyph, { color: t.text }]}>‹</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={[styles.heading, { color: t.text }]} numberOfLines={1}>
            Where to prune
          </Text>
          <Text style={[styles.sub, { color: t.sub }]} numberOfLines={1}>
            {plant.name} · {pack.label}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Deterministic, always right: the season and the species rules. */}
        {/* Deterministic and certainly correct — the verdict is a WORD plus the
            window, readable at arm's length. Device feedback 2026-08-31: the
            full verdict sentence read as generic filler, so the paragraph is
            gone — it still feeds the model prompt, humans get the short form. */}
        <View style={[styles.card, { backgroundColor: t.card, borderColor: seasonColor(season.status, t, caution) }]}>
          <View style={styles.seasonHead}>
            <Text style={[styles.seasonWord, { color: seasonColor(season.status, t, caution) }]}>
              {SEASON_WORD[season.status]}
            </Text>
            <Text style={[styles.seasonWindow, { color: t.text }]}>Best: {bestWindowLabel(pack, hemisphere)}</Text>
          </View>
          <Text style={[styles.seasonNote, { color: t.sub }]} numberOfLines={2}>
            {pack.seasonNote.charAt(0).toUpperCase() + pack.seasonNote.slice(1)}. Dead, damaged or
            diseased wood: any time.{pack.alwaysAllowedCaveat ? ` ${pack.alwaysAllowedCaveat}` : ""}
          </Text>
          {reminder.kind === "set" ? (
            <Text style={[styles.reminderSet, { color: t.green }]}>
              ✓ Reminder set · {reminder.dateLabel}
            </Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remind me when the pruning window opens"
              disabled={reminder.kind === "setting"}
              onPress={remindMe}
              hitSlop={8}
              style={styles.remindRow}
            >
              <Text style={[styles.remindText, { color: t.green, opacity: reminder.kind === "setting" ? 0.5 : 1 }]}>
                {reminder.kind === "setting"
                  ? "Setting reminder…"
                  : `🔔 Remind me when the window opens · ${formatLocalReminderDate(nextPruneWindowStart(pack, new Date(), hemisphere))}`}
              </Text>
            </Pressable>
          )}
          {reminder.kind === "note" ? (
            <Text style={[styles.seasonNote, { color: t.sub }]}>{reminder.message}</Text>
          ) : null}
        </View>

        {/* Renders nothing once the model is ready. Without it the only way out
            of "AI isn't set up" is a sentence pointing at a tab this modal
            cannot reach — after the walk to the plant and the photo. */}
        <LocalEngineSetupCard />

        {record && !busy ? (
          <>
            <Text style={[styles.footerNote, { color: t.sub }]}>
              Plan from {formatTimelineDate(record.createdAt)}
            </Text>
            {/* Only doubt is surfaced, and it sits ABOVE the marks it describes.
                A model asserting "high" about its own coordinates has no
                calibration behind it; saying it is unsure is information. */}
            {/* The prompt is season-scoped, but the SCREEN enforces it too: a
                model that invents shaping cuts in a closed window gets them
                labelled, deterministically (adversarial critic, verified). */}
            {drawnMarks > 0 && season.status === "avoid" ? (
              <Text style={[styles.confidence, { color: t.danger }]}>
                Out of season — WAIT above still applies. Only dead, damaged or diseased wood should
                come off now; treat any other suggestion below as next-window planning.
              </Text>
            ) : null}
            {drawnMarks > 0 && record.plan.confidence === "low" ? (
              <Text style={[styles.confidence, { color: caution }]}>
                The AI says it is unsure where these go — treat them as a rough area only.
              </Text>
            ) : null}
            <PruneOverlay
              photoUri={record.photoUri}
              photoAspect={record.photoAspect}
              // "unclear" is the model saying it cannot make the branches out.
              // Believing it is the whole point of asking: keep the summary,
              // the steps and the rules, draw nothing.
              cuts={record.plan.subject === "unclear" ? [] : record.plan.cuts}
              doneCuts={record.doneCuts}
              activeIndex={activeCut}
              onSelectCut={(index) => setActiveCut(index === activeCut ? null : index)}
              t={t}
              activeColor={caution}
            />
            {/* Only when marks were actually drawn. Saying "these mark the
                likely area" under a photo with nothing on it spends the hedge's
                credibility on the run where it does not matter. */}
            {drawnMarks > 0 ? (
              <Text style={[styles.caveat, { color: t.text }]}>{MARKS_CAVEAT}</Text>
            ) : (
              <View style={[styles.card, { backgroundColor: t.card, borderColor: caution }]}>
                <Text style={[styles.cardLabel, { color: caution }]}>
                  {record.plan.subject === "unclear" ? "COULDN'T READ THIS PHOTO" : "NOTHING MARKED"}
                </Text>
                <Text style={[styles.cutText, { color: t.text }]}>
                  {record.plan.subject === "unclear"
                    ? "Couldn't make out the branches. Retake: whole branch in frame, even light."
                    : record.plan.cuts.length > 0
                      ? `It suggested ${record.plan.cuts.length} cut${record.plan.cuts.length === 1 ? "" : "s"} but couldn't place them on the photo. The steps below still apply.`
                      : "It found nothing specific to cut in this photo. The rules below still apply."}
                </Text>
              </View>
            )}
            {!noticeSeen && drawnMarks > 0 ? (
              <View style={[styles.card, { backgroundColor: t.card, borderColor: t.danger }]}>
                <Text style={[styles.cutText, { color: t.text }]}>{MARKS_FIRST_RUN_NOTICE}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Got it"
                  onPress={() => {
                    setNoticeSeen(true);
                    void markMarksNoticeSeen();
                  }}
                >
                  <Text style={[styles.noticeCta, { color: t.green }]}>Got it</Text>
                </Pressable>
              </View>
            ) : null}

            {/* Device feedback 2026-08-31: the summary card was "too much
                text". Two lines, no card, no label — the marks and the steps
                are the content. */}
            <Text style={[styles.summary, { color: t.sub }]} numberOfLines={2}>
              {record.plan.summary}
            </Text>

            {record.plan.cuts.map((cut, index) => {
              const done = record.doneCuts.includes(index);
              return (
                <Pressable
                  key={index}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: done }}
                  accessibilityLabel={`${cut.label}. ${cut.action}`}
                  onPress={() => tick(record.id, index)}
                  style={[
                    styles.card,
                    styles.cutRow,
                    {
                      backgroundColor: t.card,
                      borderColor: activeCut === index ? caution : t.border,
                      opacity: done ? 0.6 : 1,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.cutBadge,
                      { backgroundColor: done ? t.sub : t.green },
                      cut.x === undefined && { backgroundColor: t.border },
                    ]}
                  >
                    <Text style={[styles.cutBadgeText, cut.x === undefined && { color: t.sub }]}>
                      {done ? "✓" : index + 1}
                    </Text>
                  </View>
                  <View style={styles.cutBody}>
                    <Text
                      style={[
                        styles.cutLabel,
                        { color: t.text, textDecorationLine: done ? "line-through" : "none" },
                      ]}
                    >
                      {cut.label}
                    </Text>
                    <Text style={[styles.cutText, { color: t.text }]}>{cut.action}</Text>
                    <Text style={[styles.cutText, { color: t.sub }]}>{cut.reason}</Text>
                    {/* Informative only when SOME marks were drawn and this one
                        was not. When none were, the banner above says it once. */}
                    {drawnMarks > 0 && cut.x === undefined ? (
                      <Text style={[styles.cutText, { color: t.sub, fontStyle: "italic" }]}>
                        Not marked on the photo — find this one from the description.
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}

            {record.plan.general_steps.length > 0 ? (
              <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
                <Text style={[styles.cardLabel, { color: t.sub }]}>ALSO</Text>
                {record.plan.general_steps.map((step) => (
                  <Text key={step} style={[styles.cutText, { color: t.text }]}>
                    • {step}
                  </Text>
                ))}
              </View>
            ) : null}
          </>
        ) : null}

        {/* The rules the model was given. Device feedback 2026-08-31: the full
            list read as a wall of text, so the DANGEROUS half (the nevers) is
            always visible and the how-to expands on demand — hidden detail,
            never hidden warnings. The model still gets every rule. */}
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[styles.cardLabel, { color: t.sub }]}>
            {pack.label.toUpperCase()} · SOURCED RULES
          </Text>
          {/* The technique as a picture — ✓ flanked by the two classic
              mistakes. Carries what a paragraph used to (user request:
              show it, don't say it). */}
          <CutDiagram technique={pack.technique} t={t} />
          {pack.never.map((rule) => (
            <Text key={rule} style={[styles.cutText, { color: t.danger }]}>
              • {rule}
            </Text>
          ))}
          {rulesOpen
            ? pack.rules.map((rule) => (
                <Text key={rule} style={[styles.cutText, { color: t.text }]}>
                  • {rule}
                </Text>
              ))
            : null}
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Watch how to prune a ${pack.label.toLowerCase()} on YouTube`}
            onPress={() =>
              Linking.openURL(buildPruneVideoSearchUrl(pack.label)).catch((e) =>
                console.error("[PruneScreen] video link failed:", (e as Error).message),
              )
            }
            hitSlop={8}
            style={styles.remindRow}
          >
            <Text style={[styles.remindText, { color: t.green }]}>▶️ Watch how it&apos;s done</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: rulesOpen }}
            accessibilityLabel={rulesOpen ? "Hide the how-to rules" : `Show all ${pack.rules.length} how-to rules`}
            onPress={() => setRulesOpen(!rulesOpen)}
            hitSlop={8}
            style={styles.remindRow}
          >
            <Text style={[styles.remindText, { color: t.green }]}>
              {rulesOpen ? "Hide how-to" : `Show how-to (${pack.rules.length} rules)`}
            </Text>
          </Pressable>
          {/* The season line above is mirrored, but month names INSIDE a rule
              are not — say so rather than let a southern grower read
              "September through January" as their own calendar. */}
          {hemisphere === "southern" ? (
            <Text style={[styles.confidence, { color: t.sub }]}>
              These rules were written for the northern hemisphere: any month named inside one is six
              months out for you. The season line at the top is already adjusted.
            </Text>
          ) : null}
        </View>

      </ScrollView>

      {/* The one control lives in the thumb's reach and stays there, instead of
          at the end of a scroll that can run to eighteen rule bullets. The wait
          and any failure sit with it, so recovery is never a scroll away — and
          during a run the scroll body is the season and the sourced rules,
          which is the most relevant thing the wait could be filled with. */}
      <View style={[styles.footer, { borderTopColor: t.border, backgroundColor: t.canvas }]}>
        {error ? (
          <Text style={[styles.footerError, { color: t.onGreen, backgroundColor: t.danger }]}>{error}</Text>
        ) : null}
        {error && lastShotRef.current ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try again with the same photo"
            disabled={busy || !engineReady}
            onPress={retrySameShot}
            style={[styles.primary, { backgroundColor: t.green, opacity: busy || !engineReady ? 0.6 : 1 }]}
          >
            <Text style={[styles.primaryText, { color: t.onGreen }]}>↻ Try again — same photo</Text>
          </Pressable>
        ) : null}
        {(error || (record && drawnMarks === 0)) && debug ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Email the run details to feedback"
            onPress={emailDetails}
            hitSlop={8}
          >
            <Text style={[styles.footerNote, { color: t.green, fontWeight: "600" }]}>
              ✉️ Send the details — helps fix it
            </Text>
          </Pressable>
        ) : null}
        {rejected ? (
          <Text style={[styles.footerError, { color: t.onGreen, backgroundColor: t.danger }]}>{NOT_A_PLANT}</Text>
        ) : null}
        {!engineReady && !busy ? (
          <Text style={[styles.footerNote, { color: t.sub }]}>
            The on-device AI isn&apos;t ready, so it can&apos;t mark a photo yet — set it up above. The
            season and the rules don&apos;t need it.
          </Text>
        ) : null}
        {progress && progress.total > 0 ? (
          <Text style={[styles.footerNote, { color: t.sub }]}>
            {progress.done} of {progress.total} cuts done
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            busy
              ? busyLabel
              : !record && latest
                ? `Mark my latest photo from ${latest.dateLabel}`
                : record
                  ? "Take a new photo"
                  : "Take a photo to mark the cuts"
          }
          disabled={busy || !engineReady}
          onPress={() => {
            // The photo from the assessment they just did is the default —
            // pressing "Where to prune" must not demand a re-shoot (device
            // feedback 2026-08-31).
            if (!record && latest) useLatestPhoto();
            else void capture("camera");
          }}
          style={[
            styles.primary,
            // Once a plan is on screen, the loudest control must not be the one
            // that replaces it.
            record
              ? { borderWidth: 1, borderColor: t.border }
              : { backgroundColor: t.green },
            { opacity: busy || !engineReady ? 0.6 : 1 },
          ]}
        >
          {busy ? (
            <View style={styles.primaryBusy}>
              <ActivityIndicator color={record ? t.text : t.onGreen} />
              <Text style={[styles.primaryText, { color: record ? t.text : t.onGreen }]}>{busyLabel}</Text>
            </View>
          ) : (
            <Text style={[styles.primaryText, { color: record ? t.text : t.onGreen }]}>
              {record
                ? "📷 New photo"
                : latest
                  ? `✂️ Mark my latest photo · ${latest.dateLabel}`
                  : "📷 Photograph the plant"}
            </Text>
          )}
        </Pressable>
        {!busy ? (
          <View style={styles.secondaryRow}>
            {!record && latest ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Take a new photo instead"
                disabled={!engineReady}
                onPress={() => capture("camera")}
                style={[styles.secondary, { borderColor: t.border, opacity: engineReady ? 1 : 0.6 }]}
              >
                <Text style={[styles.secondaryText, { color: t.text }]}>📷 New photo</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose a photo from the gallery"
              disabled={!engineReady}
              onPress={() => capture("gallery")}
              style={[styles.secondary, { borderColor: t.border, opacity: engineReady ? 1 : 0.6 }]}
            >
              <Text style={[styles.secondaryText, { color: t.text }]}>🖼️ From gallery</Text>
            </Pressable>
          </View>
        ) : null}
        {!busy && !record ? (
          <Text style={[styles.footerNote, { color: t.sub }]}>
            About a minute on this phone. The first run is slower.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** The verdict as a word, so colour is never the only carrier — the same
 * pairing the health bands use. */
const SEASON_WORD: Record<SeasonStatus, string> = {
  best: "BEST TIME",
  ok: "OK NOW",
  avoid: "WAIT",
  off_season: "CHECK THE RULES",
};

function seasonColor(status: SeasonStatus, t: Tokens, caution: string): string {
  if (status === "best") return t.green;
  if (status === "avoid") return t.danger;
  if (status === "ok") return caution;
  return t.border;
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 68 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, marginBottom: 10 },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  backGlyph: { fontSize: 22, fontWeight: "600", marginTop: -2 },
  headerText: { flex: 1, gap: 2 },
  heading: { fontSize: 20, fontWeight: "600", letterSpacing: -0.3 },
  sub: { fontSize: 12 },
  scroll: { paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  card: { borderWidth: 1, borderRadius: RADIUS, padding: 14, gap: 6 },
  cardLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  seasonLine: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  seasonHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
  },
  seasonWord: { fontSize: 17, fontWeight: "800", letterSpacing: 0.3 },
  seasonWindow: { fontSize: 14, fontWeight: "600" },
  seasonNote: { fontSize: 12, lineHeight: 17 },
  remindRow: { minHeight: 44, justifyContent: "center" },
  remindText: { fontSize: 13, fontWeight: "600" },
  reminderSet: { fontSize: 13, fontWeight: "600", paddingVertical: 12 },
  summary: { fontSize: 14, lineHeight: 20 },
  confidence: { fontSize: 12, lineHeight: 17 },
  noticeCta: { fontSize: 14, fontWeight: "700", marginTop: 4 },
  caveat: { fontSize: 12, lineHeight: 17 },
  cutRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  cutBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  cutBadgeText: { color: "#ffffff", fontSize: 13, fontWeight: "800" },
  cutBody: { flex: 1, gap: 3 },
  cutLabel: { fontSize: 14, fontWeight: "700" },
  cutText: { fontSize: 13, lineHeight: 19 },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 10,
  },
  footerNote: { fontSize: 12, lineHeight: 17 },
  secondaryRow: { flexDirection: "row", gap: 10 },
  footerError: {
    fontSize: 13,
    lineHeight: 19,
    borderRadius: RADIUS,
    paddingHorizontal: 12,
    paddingVertical: 8,
    overflow: "hidden",
  },
  primaryBusy: { flexDirection: "row", alignItems: "center", gap: 10 },
  primary: { borderRadius: RADIUS, minHeight: 50, alignItems: "center", justifyContent: "center" },
  primaryText: { fontSize: 16, fontWeight: "600" },
  secondary: {
    flex: 1,
    borderWidth: 1,
    borderRadius: RADIUS,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { fontSize: 14, fontWeight: "600" },
});
