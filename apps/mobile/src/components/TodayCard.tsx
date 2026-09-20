import { StyleSheet, Text, View } from "react-native";
import { type PlantListItem } from "../lib/plants";
import { pruningPackFor, seasonVerdict, type Hemisphere } from "../lib/pruning-rules";
import { RADIUS, type Tokens } from "../lib/theme";
import { todayDigest } from "../lib/today-digest";
import type { WateringPlan } from "../lib/watering";
import type { WeatherAlert } from "../lib/weather-alerts";

/** #8 (honest v1) — what needs doing TODAY, from deterministic signals only:
 * a weather alert, watering due, an open prune window. Empty day = no card.
 * Rendered as the Plants list header; the digest lines themselves are pure
 * and tested in today-digest.ts. */
export function TodayCard({
  items,
  plans,
  alert,
  hemisphere,
  t,
}: {
  items: PlantListItem[];
  plans: Record<string, WateringPlan>;
  alert: WeatherAlert | null;
  hemisphere: Hemisphere;
  t: Tokens;
}) {
  const month = new Date().getMonth() + 1;
  const lines = todayDigest({
    alert: alert ? { kind: alert.kind, tempC: alert.tempC, plantNames: alert.plantNames } : null,
    // Phase 6: a plan anchored on the day the plant was added is a projection,
    // not a due date — "Water: A, B, C" on day one of every plant would be a
    // number the app made up. Only a logged watering makes the list.
    dueWater: items
      .filter((item) => plans[item.id]?.isDue === true && plans[item.id]?.anchor === "log")
      .map((item) => item.name),
    // Real identity, real hemisphere — a pet name must not pick the pack, and
    // a southern grower must not get northern windows (D-P5).
    pruneWindowOpen: items
      .filter(
        (item) =>
          seasonVerdict(
            pruningPackFor({
              name: item.name,
              plant_type: item.plantType,
              species: item.species,
              cultivar: null,
            }),
            month,
            hemisphere,
          ).status === "best",
      )
      .map((item) => item.name),
  });
  if (lines.length === 0) return null;
  return (
    <View style={[styles.todayCard, { backgroundColor: t.card, borderColor: t.border }]}>
      <Text style={[styles.todayLabel, { color: t.sub }]}>TODAY</Text>
      {lines.map((line) => (
        <Text
          key={line.text}
          style={[
            styles.todayLine,
            // The most urgent thing should LOOK like it — the ranking used to
            // exist only in source order (designer finding). The word carries
            // the meaning; the colour just stops it whispering.
            line.kind === "alert" ? { color: t.danger, fontWeight: "600" } : { color: t.text },
          ]}
        >
          {line.text}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  todayCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS,
    padding: 14,
    gap: 6,
    marginBottom: 10,
  },
  todayLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  todayLine: { fontSize: 13, lineHeight: 19 },
});
