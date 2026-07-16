import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { apiFetch } from "../lib/api-io";
import { cancelWateringReminders, scheduleWateringReminder, syncWateringReminder } from "../lib/reminders";
import { notificationScheduler } from "../lib/reminders-io";
import { RADIUS, type Tokens } from "../lib/theme";
import {
  dueLabel,
  lastWateredAt,
  parseStoredCareProfile,
  requestCareProfile,
  wateringPlan,
  type WateringPlan,
} from "../lib/watering";
import { getWateringLog, recordWatered } from "../lib/watering-io";
import { loadWeatherFor } from "../lib/weather-io";

// F20 — the watering card on plant detail. Everything it shows is deterministic
// math (src/lib/watering.ts) on top of three inputs: the plant's care profile
// (Gemini, once, at creation), the ZIP's forecast (Open-Meteo, cached 6h) and
// the local watering log. The model is never in this path.
//
// The three degraded states are deliberate and quiet, because watering guidance
// is an enhancement — never an error:
//   no ZIP          → a hint telling the user how to turn the feature on
//   no care profile → "generating…" plus a quiet retry
//   no weather      → the card still renders on the plant's base schedule
// The card only disappears when there is genuinely nothing to say.

interface PlantInput {
  id: string;
  name: string;
  location: string | null;
  zip_code: string | null;
  care_profile?: unknown;
}

type Phase =
  | { kind: "loading" }
  | { kind: "no-zip" }
  | { kind: "no-profile"; retrying: boolean }
  | { kind: "ready"; plan: WateringPlan; place: string | null; stale: boolean };

interface Props {
  plant: PlantInput;
  /** Newest assessment timestamp — the watering anchor when nothing is logged. */
  lastAssessedAt: string | null;
  t: Tokens;
  /** The stored profile changed (a retry generated one) — reload the plant row. */
  onProfileGenerated?: () => void;
}

export function WateringCard({ plant, lastAssessedAt, t, onProfileGenerated }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [reminderSet, setReminderSet] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Memoized on the raw jsonb: parseStoredCareProfile returns a fresh object
  // every call, and compute() depends on its identity — re-parsing per render
  // would re-fire the effect forever.
  const profile = useMemo(() => parseStoredCareProfile(plant.care_profile), [plant.care_profile]);
  const zip = plant.zip_code;

  /** Recompute from the three inputs. Weather comes from the 6h cache, so
   * re-opening the plant costs nothing. */
  const compute = useCallback(async () => {
    if (!profile) {
      setPhase({ kind: "no-profile", retrying: false });
      return;
    }
    if (!zip || zip.trim().length === 0) {
      setPhase({ kind: "no-zip" });
      return;
    }
    const now = new Date();
    // loadWeatherFor never throws: null just means the plain base schedule.
    const [weather, log] = await Promise.all([loadWeatherFor(zip, now), getWateringLog()]);
    const plan = wateringPlan({
      careProfile: profile,
      location: plant.location,
      weather: weather?.summary ?? null,
      lastWateredAt: lastWateredAt(log, plant.id),
      lastAssessedAt,
      now,
    });
    setPhase({
      kind: "ready",
      plan,
      place: weather?.coordinates.label || null,
      stale: weather?.stale ?? false,
    });

    // Keep an ALREADY-permitted reminder in step with the new due date. This
    // never prompts — that only happens on the "Remind me" tap below.
    const outcome = await syncWateringReminder(notificationScheduler, {
      plantId: plant.id,
      plantName: plant.name,
      dueAt: new Date(plan.nextWaterDueAt),
      reason: plan.reason,
      now,
    });
    setReminderSet(outcome.ok);
  }, [lastAssessedAt, plant.id, plant.location, plant.name, profile, zip]);

  useEffect(() => {
    compute();
  }, [compute]);

  /** Quiet retry: the profile is generated once, fire-and-forget, at plant
   * creation — if that call was lost (offline, rate limit) this is the recovery. */
  const retryProfile = useCallback(async () => {
    setPhase({ kind: "no-profile", retrying: true });
    const generated = await requestCareProfile(apiFetch, plant.id);
    if (generated) {
      onProfileGenerated?.();
      return; // The reloaded plant row re-renders the card with a profile.
    }
    // requestCareProfile already logged the details; stay in the same state.
    setPhase({ kind: "no-profile", retrying: false });
  }, [onProfileGenerated, plant.id]);

  const watered = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await recordWatered(plant.id);
      // Any pending nudge is now stale; compute() re-schedules from the new
      // due date if the user had reminders on.
      await cancelWateringReminders(notificationScheduler, plant.id);
      await compute();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [compute, plant.id]);

  const remindMe = useCallback(async () => {
    if (phase.kind !== "ready") return;
    setError(null);
    // The one place notification permission is ever requested for watering
    // (contextual opt-in, design doc open question 2).
    const outcome = await scheduleWateringReminder(notificationScheduler, {
      plantId: plant.id,
      plantName: plant.name,
      dueAt: new Date(phase.plan.nextWaterDueAt),
      reason: phase.plan.reason,
    });
    if (outcome.ok) setReminderSet(true);
    else setError("Enable notifications in Settings to get watering reminders.");
  }, [phase, plant.id, plant.name]);

  if (phase.kind === "loading") return null;

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: t.text }]}>💧 Watering</Text>
        {phase.kind === "ready" && phase.plan.isDue ? (
          <View style={[styles.chip, { backgroundColor: t.green + "22" }]}>
            <Text style={[styles.chipText, { color: t.green }]}>Needs water</Text>
          </View>
        ) : null}
      </View>

      {phase.kind === "no-zip" ? (
        <Text style={[styles.body, { color: t.sub }]}>
          Add a ZIP code to this plant for weather-aware watering.
        </Text>
      ) : phase.kind === "no-profile" ? (
        <>
          <Text style={[styles.body, { color: t.sub }]}>Care profile is generating…</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry care profile"
            disabled={phase.retrying}
            onPress={retryProfile}
            style={[styles.secondary, { borderColor: t.border, opacity: phase.retrying ? 0.6 : 1 }]}
          >
            {phase.retrying ? (
              <ActivityIndicator color={t.sub} />
            ) : (
              <Text style={[styles.secondaryText, { color: t.sub }]}>Retry</Text>
            )}
          </Pressable>
        </>
      ) : (
        <>
          <Text style={[styles.due, { color: t.text }]}>{dueLabel(phase.plan)}</Text>
          <Text style={[styles.body, { color: t.sub }]}>{phase.plan.reason}</Text>
          {phase.place ? (
            <Text style={[styles.meta, { color: t.sub }]}>
              {phase.place}
              {phase.stale ? " · last known forecast" : ""}
            </Text>
          ) : null}
          {error ? <Text style={[styles.meta, { color: t.danger }]}>{error}</Text> : null}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Watered today"
              disabled={busy}
              onPress={watered}
              style={[styles.primary, { backgroundColor: t.green, opacity: busy ? 0.6 : 1 }]}
            >
              {busy ? (
                <ActivityIndicator color={t.onGreen} />
              ) : (
                <Text style={[styles.primaryText, { color: t.onGreen }]}>Watered today</Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={reminderSet ? "Watering reminder set" : "Remind me to water"}
              disabled={reminderSet}
              onPress={remindMe}
              style={[styles.secondary, { borderColor: t.border }]}
            >
              <Text style={[styles.secondaryText, { color: t.sub }]}>
                {reminderSet ? "Reminder set ✓" : "Remind me"}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS,
    padding: 14,
    gap: 6,
  },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { fontSize: 15, fontWeight: "600" },
  chip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { fontSize: 11, fontWeight: "700" },
  due: { fontSize: 15, fontWeight: "600" },
  body: { fontSize: 13, lineHeight: 19 },
  meta: { fontSize: 12 },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  primary: {
    flex: 1,
    borderRadius: RADIUS,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { fontSize: 14, fontWeight: "600" },
  secondary: {
    flex: 1,
    borderWidth: 1,
    borderRadius: RADIUS,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { fontSize: 14, fontWeight: "600" },
});
