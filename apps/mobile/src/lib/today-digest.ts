// #8 (honest v1) — the Today lines, from sourced/deterministic signals ONLY:
// a weather alert, watering due, an open prune window. Nothing invented; an
// empty day is an empty card, not manufactured urgency.
//
// Each line carries its KIND so the screen can make the most urgent thing look
// like it (designer finding: the ranking existed only in source order). The
// alert line names EVERY plant — this card is the only surface carrying those
// names, and the failure cost of a hidden name is a dead plant.

export interface TodayInput {
  alert: { kind: "frost" | "cold" | "heat"; tempC: number; plantNames: string[] } | null;
  dueWater: string[];
  pruneWindowOpen: string[];
}

export interface TodayLine {
  kind: "alert" | "water" | "prune";
  text: string;
}

const MAX_NAMES = 3;

function truncated(list: string[]): string {
  if (list.length <= MAX_NAMES) return list.join(", ");
  return `${list.slice(0, MAX_NAMES).join(", ")} +${list.length - MAX_NAMES} more`;
}

/** Most urgent first: weather beats watering beats pruning. */
export function todayDigest(input: TodayInput): TodayLine[] {
  const lines: TodayLine[] = [];
  if (input.alert) {
    const names = input.alert.plantNames.join(", ");
    const text =
      input.alert.kind === "frost"
        ? `❄️ Frost ${input.alert.tempC}°C — protect ${names}`
        : input.alert.kind === "cold"
          ? `🥶 Cold night ${input.alert.tempC}°C — consider covering ${names}`
          : `🥵 Heat ${input.alert.tempC}°C — shade ${names}`;
    lines.push({ kind: "alert", text });
  }
  if (input.dueWater.length > 0) lines.push({ kind: "water", text: `💧 Water ${truncated(input.dueWater)}` });
  if (input.pruneWindowOpen.length > 0)
    lines.push({ kind: "prune", text: `✂️ Pruning window open for ${truncated(input.pruneWindowOpen)}` });
  return lines;
}
