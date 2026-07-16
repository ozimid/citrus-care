import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { AssessmentDiagnosis } from "@citrus/shared";
import { EngineBadge } from "../components/EngineBadge";
import { bandColor, healthBand, type HealthBandKey } from "../lib/health";
import { subjectLabel } from "../lib/plant-detail";
import { formatReminderDate, scheduleReminder } from "../lib/reminders";
import { notificationScheduler } from "../lib/reminders-io";
import { RADIUS, useTheme, type Tokens } from "../lib/theme";

// Diagnosis result screen (design doc §4 row 9, mirroring the web
// AssessmentCard): score ring in the shared band colors, band label, summary,
// symptom chips, likely causes, ranked care-plan cards (first emphasized), a
// contextual "remind me" CTA (permission asked at tap — design doc open
// question 2), and a primary CTA back to Plants. The assessment is already
// persisted server-side by /assess, so "save to timeline" is implicit.

const REMINDER_DENIED_NOTE =
  "Notifications are off for Citrus Care. Enable them in your device settings to get reminders.";
const REMINDER_FAILED_NOTE = "Couldn't set the reminder. Please try again.";

/** Severity/likelihood reuse the shared health-band colors: low→good,
 * medium→fair, high→poor (web parity: emerald/amber/red chips). */
const LEVEL_BAND: Record<"low" | "medium" | "high", HealthBandKey> = {
  low: "good",
  medium: "fair",
  high: "poor",
};

type ReminderState =
  | { kind: "idle" }
  | { kind: "setting" }
  | { kind: "set"; dateLabel: string }
  | { kind: "note"; message: string };

interface Props {
  diagnosis: AssessmentDiagnosis;
  plantId: string;
  plantName: string;
  /** Which engine produced this diagnosis (D-15 Stage 2 provenance badge).
   * Fresh results pass their own engine; a reopened timeline row passes the
   * stored assessments.engine (F22, migration 0007), which is null — and so
   * renders no badge — only for rows written before that column existed. */
  engine?: string | null;
  onDone: () => void;
}

export function DiagnosisScreen({ diagnosis, plantId, plantName, engine, onDone }: Props) {
  const { t, scheme } = useTheme();
  const [reminder, setReminder] = useState<ReminderState>({ kind: "idle" });

  const band = healthBand(diagnosis.health_score);
  const color = bandColor(band.key, scheme);
  const recommendations = diagnosis.recommendations.slice().sort((a, b) => a.priority - b.priority);

  async function remindMe() {
    setReminder({ kind: "setting" });
    try {
      const outcome = await scheduleReminder(notificationScheduler, {
        plantId,
        plantName,
        interval: "2w",
      });
      if (outcome.ok) {
        setReminder({ kind: "set", dateLabel: formatReminderDate(outcome.date) });
      } else {
        setReminder({ kind: "note", message: REMINDER_DENIED_NOTE });
      }
    } catch (e) {
      console.error("[DiagnosisScreen] reminder failed:", (e as Error).message);
      setReminder({ kind: "note", message: REMINDER_FAILED_NOTE });
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: t.canvas }]}>
      <View style={styles.header}>
        <Text style={[styles.heading, { color: t.text }]}>Diagnosis</Text>
        <View style={[styles.contextChip, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[styles.contextChipText, { color: t.sub }]} numberOfLines={1}>
            🪴 {plantName}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.card, styles.scoreCard, { backgroundColor: t.card, borderColor: t.border }]}>
          <View style={[styles.scoreRing, { borderColor: color }]}>
            <Text style={[styles.scoreValue, { color }]}>{diagnosis.health_score}</Text>
            <Text style={[styles.scoreOutOf, { color: t.sub }]}>/ 100</Text>
          </View>
          <Text style={[styles.scoreKind, { color: t.sub }]}>
            {diagnosis.subject === "cut" ? "PRUNING CUT HEALTH" : "HEALTH"}
          </Text>
          <View style={[styles.bandBadge, { backgroundColor: color + "22" }]}>
            <Text style={[styles.bandBadgeText, { color }]}>{band.label}</Text>
          </View>
          <Text style={[styles.summary, { color: t.text }]}>{diagnosis.summary}</Text>
          {/* F21: what the model says it saw — the answer to a question the
              user used to have to answer first. Absent on pre-F21 rows. */}
          <View style={styles.badgeRow}>
            {diagnosis.subject ? (
              <View
                accessibilityLabel={`Detected: ${subjectLabel(diagnosis.subject)}`}
                style={[styles.engineBadge, { borderColor: t.border }]}
              >
                <Text style={[styles.engineBadgeText, { color: t.sub }]}>
                  Detected: {subjectLabel(diagnosis.subject)}
                </Text>
              </View>
            ) : null}
            <EngineBadge t={t} engine={engine} />
          </View>
        </View>

        {diagnosis.comparison ? (
          <Card t={t} title="Compared to last time">
            <Text style={[styles.body, { color: t.text }]}>
              <Text style={{ fontWeight: "600", color: deltaColor(diagnosis.comparison.delta, t, scheme) }}>
                {capitalize(diagnosis.comparison.delta)}
              </Text>
              {" — "}
              {diagnosis.comparison.notes}
            </Text>
          </Card>
        ) : null}

        {diagnosis.symptoms.length > 0 ? (
          <Card t={t} title="Symptoms">
            <View style={styles.chipWrap}>
              {diagnosis.symptoms.map((s, i) => {
                const chip = bandColor(LEVEL_BAND[s.severity], scheme);
                return (
                  <View key={i} style={[styles.chip, { backgroundColor: chip + "22" }]}>
                    <Text style={[styles.chipText, { color: chip }]}>{s.label}</Text>
                  </View>
                );
              })}
            </View>
          </Card>
        ) : null}

        {diagnosis.causes.length > 0 ? (
          <Card t={t} title="Likely causes">
            <View style={styles.causeList}>
              {diagnosis.causes.map((c, i) => {
                const chip = bandColor(LEVEL_BAND[c.likelihood], scheme);
                return (
                  <View key={i} style={styles.cause}>
                    <View style={styles.causeHead}>
                      <View style={[styles.levelTag, { backgroundColor: chip + "22" }]}>
                        <Text style={[styles.levelTagText, { color: chip }]}>{c.likelihood}</Text>
                      </View>
                      <Text style={[styles.causeLabel, { color: t.text }]}>{c.label}</Text>
                    </View>
                    <Text style={[styles.body, { color: t.sub }]}>{c.rationale}</Text>
                  </View>
                );
              })}
            </View>
          </Card>
        ) : null}

        {recommendations.length > 0 ? (
          <Card t={t} title="What to do">
            <View style={styles.planList}>
              {recommendations.map((r, i) => (
                <View
                  key={i}
                  style={[
                    styles.plan,
                    { backgroundColor: t.canvas, borderColor: t.border },
                    i === 0 && { borderColor: t.green, backgroundColor: t.green + "11" },
                  ]}
                >
                  {i === 0 ? (
                    <Text style={[styles.planFirst, { color: t.green }]}>DO THIS FIRST</Text>
                  ) : null}
                  <Text style={[styles.planAction, { color: t.text }]}>
                    {r.priority}. {r.action}
                  </Text>
                  <Text style={[styles.body, { color: t.sub }]}>{r.detail}</Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        {reminder.kind === "set" ? (
          <View style={[styles.reminderSet, { borderColor: t.green }]}>
            <Text style={[styles.reminderSetText, { color: t.green }]}>
              ✓ Reminder set · {reminder.dateLabel}
            </Text>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remind me in 2 weeks"
            disabled={reminder.kind === "setting"}
            onPress={remindMe}
            style={[styles.remind, { borderColor: t.green, opacity: reminder.kind === "setting" ? 0.6 : 1 }]}
          >
            {reminder.kind === "setting" ? (
              <ActivityIndicator color={t.green} />
            ) : (
              <Text style={[styles.remindText, { color: t.green }]}>🔔 Remind me in 2 weeks</Text>
            )}
          </Pressable>
        )}
        {reminder.kind === "note" ? (
          <Text style={[styles.reminderNote, { color: t.sub }]}>{reminder.message}</Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to plants"
          onPress={onDone}
          style={[styles.done, { backgroundColor: t.green }]}
        >
          <Text style={[styles.doneText, { color: t.onGreen }]}>Back to plants</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Card({ t, title, children }: { t: Tokens; title: string; children: React.ReactNode }) {
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
      <Text style={[styles.cardTitle, { color: t.sub }]}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function deltaColor(delta: "better" | "same" | "worse" | "unknown", t: Tokens, scheme: "light" | "dark"): string {
  if (delta === "better") return bandColor("good", scheme);
  if (delta === "worse") return bandColor("poor", scheme);
  return t.sub;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 68 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    marginBottom: 12,
    gap: 12,
  },
  heading: { fontSize: 24, fontWeight: "600", letterSpacing: -0.4 },
  contextChip: {
    flexShrink: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  contextChipText: { fontSize: 13, fontWeight: "600" },
  scroll: { paddingHorizontal: 20, paddingBottom: 40, gap: 12 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS,
    padding: 16,
    gap: 10,
  },
  cardTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  scoreCard: { alignItems: "center", gap: 8 },
  scoreRing: {
    width: 116,
    height: 116,
    borderRadius: 58,
    borderWidth: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreValue: { fontSize: 36, fontWeight: "700", fontVariant: ["tabular-nums"] },
  scoreOutOf: { fontSize: 12 },
  scoreKind: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  bandBadge: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  bandBadgeText: { fontSize: 13, fontWeight: "700" },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6 },
  engineBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  engineBadgeText: { fontSize: 11, fontWeight: "600", letterSpacing: 0.2 },
  summary: { fontSize: 14, lineHeight: 21, textAlign: "center" },
  body: { fontSize: 13, lineHeight: 19 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  chipText: { fontSize: 13, fontWeight: "600" },
  causeList: { gap: 12 },
  cause: { gap: 4 },
  causeHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  levelTag: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  levelTagText: { fontSize: 11, fontWeight: "700" },
  causeLabel: { fontSize: 14, fontWeight: "600", flexShrink: 1 },
  planList: { gap: 10 },
  plan: {
    borderWidth: 1,
    borderRadius: RADIUS,
    padding: 12,
    gap: 4,
  },
  planFirst: { fontSize: 10, fontWeight: "700", letterSpacing: 0.8 },
  planAction: { fontSize: 14, fontWeight: "600" },
  remind: {
    borderWidth: 1,
    borderRadius: RADIUS,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  remindText: { fontSize: 15, fontWeight: "600" },
  reminderSet: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: RADIUS,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  reminderSetText: { fontSize: 15, fontWeight: "600" },
  reminderNote: { fontSize: 12, textAlign: "center", lineHeight: 17 },
  done: {
    borderRadius: RADIUS,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  doneText: { fontSize: 16, fontWeight: "600" },
});
