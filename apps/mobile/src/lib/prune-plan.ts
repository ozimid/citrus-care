// F23 pruning plan, pure half: the prompt that asks the on-device model where
// to cut, and the tolerant parse that turns its answer into markers we are
// willing to draw on the user's photo.
//
// The safety argument for drawing marks from a ~2B model at all: the SENTENCE
// is the instruction and the MARK is an aid. Every cut carries action + reason
// text, so a point that lands on the wrong branch degrades to "a mark in the
// wrong place next to correct advice" rather than "cut here" pointing at the
// trunk. That is also why a cut with unusable coordinates is dropped instead of
// being pinned to a guessed position — a marker we can't place is a marker we
// don't draw, and the text survives either way.
//
// Tolerance is deliberate and one-directional: we accept the three coordinate
// conventions a small model actually emits (0-100, 0-1, 0-1000) and normalize
// them, we truncate over-long strings, and we clamp a nonsense priority —
// because losing a whole plan to one sloppy field is the worse failure. What we
// never do is invent a value the model didn't give.

import { prunePlanSchema, type PruneCut, type PrunePlan } from "@citrus/shared";
import { extractJsonCandidate } from "./spike-vlm";

export const PRUNE_UNAVAILABLE_ERROR =
  "On-device AI isn't ready on this phone yet. Set it up in Profile, then try again.";
export const PRUNE_PHOTO_SAVE_ERROR = "Couldn't save that photo. Please try again.";
export const PRUNE_ANALYSIS_FAILED_ERROR =
  "Your phone couldn't work out the cuts — it may be low on memory. Close other apps and try again.";
export const PRUNE_UNREADABLE_ERROR =
  "Couldn't read a clear pruning plan from the photo. Step back, get the whole branch in frame in good light, and try again.";
export const PRUNE_TIMEOUT_ERROR =
  "This is taking too long on this phone. Try again with a simpler, closer photo.";
export const PRUNE_PERSIST_ERROR = "Couldn't save the pruning plan. Please try again.";
const GENERIC_ERROR = "Something went wrong. Please try again.";

const FLOW_ERRORS = new Set([
  PRUNE_UNAVAILABLE_ERROR,
  PRUNE_PHOTO_SAVE_ERROR,
  PRUNE_ANALYSIS_FAILED_ERROR,
  PRUNE_UNREADABLE_ERROR,
  PRUNE_TIMEOUT_ERROR,
  PRUNE_PERSIST_ERROR,
]);

/** Said next to every overlay. The model points at roughly where it means; the
 * grower owns the actual cut. */
export const MARKS_CAVEAT =
  "These mark the likely area, not the exact cut — this model points roughly. Read the step, find the spot on the plant yourself, then cut.";

/** Said once, the first time an overlay appears: an irreversible physical
 * action deserves an explicit disclosure, not just a caption. */
export const MARKS_FIRST_RUN_NOTICE =
  "Heads up: the highlighted areas are an on-device estimate and can be wrong. The written steps are the instruction — confirm the branch yourself before you cut.";

/** The species rules this plan must obey, assembled by prune-io from
 * pruning-rules.ts. Plain strings so this module never has to know which
 * plant class they came from. */
export interface PrunePromptRules {
  /** "Citrus tree", "Rose", "Flowering shrub"… — used in the prompt and title. */
  className: string;
  /** Deterministic season verdict for today, e.g. "Late August: deadhead only". */
  seasonLine: string;
  rules: string[];
  never: string[];
}

/** The prompt. Two jobs, in this order: obey the rule pack (which is correct by
 * construction — it comes from extension-service research, not from the model),
 * and mark the photo (which is a best effort). Told plainly to return no cuts
 * rather than produce plausible ones. */
export function buildPrunePromptSystem(rules: PrunePromptRules): string {
  const lines = [
    `You are a pruning expert helping a home grower prune one plant: a ${rules.className}. You are looking at their photo of it.`,
    "",
    "SEASON RIGHT NOW",
    rules.seasonLine,
    "",
    `PRUNING RULES FOR A ${rules.className.toUpperCase()} — these are correct; follow them exactly`,
    ...rules.rules.map((rule) => `- ${rule}`),
    ...rules.never.map((rule) => `- ${rule}`),
    "",
    "YOUR TASK",
    "- Look at the photo and find at most 3 specific cuts this grower should make, in priority order (1 = do first).",
    "- For each cut give \"box_2d\": [y_min, x_min, y_max, x_max] — a box around the branch or stem to cut, as whole numbers between 0 and 1000, where 0 is the TOP edge (for y) or the LEFT edge (for x) and 1000 is the bottom or right edge. Y COMES FIRST.",
    "- Draw the box tightly around the spot where the blade should go, not around the whole plant and not around the leaf you are describing. A tight box is more useful than a big one.",
    "- Do not invent cuts to fill the list. If the photo does not clearly show a cut worth making, return an empty \"cuts\" list and explain why in the summary.",
    "- If the season says not to prune now, say so in the summary and keep \"cuts\" empty unless a cut is urgent (dead, broken or diseased wood is always allowed).",
    "- Set \"subject\": \"plant\" if you can see the plant clearly, \"unclear\" if the photo is too blurry, dark or far away to place a cut, \"not_a_plant\" if there is no plant in it.",
    "- Set \"confidence\" to how sure you are that your points land on the right branches: \"low\", \"medium\" or \"high\". Be honest — \"low\" is a useful answer.",
    "- Use \"general_steps\" for advice with no single spot on the photo (tool hygiene, timing, feeding after the cut).",
    "",
    "Respond with VALID JSON ONLY — no prose, no markdown fences — exactly this shape:",
    "{",
    '  "summary": "<one or two short sentences, <= 160 characters>",',
    '  "subject": "plant|unclear|not_a_plant",',
    '  "confidence": "low|medium|high",',
    '  "cuts": [{"label": "<short name>", "action": "<what to do here>", "reason": "<why>", "priority": 1, "box_2d": [<y_min>, <x_min>, <y_max>, <x_max>]}],',
    '  "general_steps": ["<advice with no single spot>"]',
    "}",
  ];
  return lines.join("\n");
}

export const PRUNE_USER_PROMPT =
  "Where should I cut this plant? Mark the cuts on the photo and reply with the JSON object only.";

/** The prompt asks for three, so three is what we draw. The research lists
 * "more boxes than requested" as a drop condition: a model that ignores the
 * limit is a model whose extra boxes are guesses. */
export const MAX_CUTS = 3;
const MAX_STEPS = 4;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Accept the coordinate conventions a small model actually emits and land them
 * all on percent-of-photo. Null = unusable, which drops the marker (never the
 * plan, and never a guessed position). */
export function normalizeCoordinate(value: unknown): number | null {
  const raw =
    typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  if (!Number.isFinite(raw) || raw < 0) return null;
  // A non-integer <= 1 can only be the 0-1 fraction convention: 0.25 is a
  // quarter across, not a quarter of one percent.
  if (raw <= 1 && !Number.isInteger(raw)) return round1(raw * 100);
  if (raw <= 100) return round1(raw);
  // Gemma-family models are trained on a normalized 0-1000 grid; accept it.
  if (raw <= 1000) return round1(raw / 10);
  return null;
}

/** A box bigger than this fraction of the photo is not guidance. It is the
 * documented small-VLM failure — one huge box over a whole quadrant — so we
 * drop the mark and keep the text (docs/research/pruning-rules.md). */
const MAX_BOX_AREA_FRACTION = 0.55;

/** …and a degenerate sliver is the other tell. */
const MIN_BOX_AREA_FRACTION = 0.0005;

export interface PruneBox {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** `box_2d` is [y_min, x_min, y_max, x_max] on a 0-1000 grid — Gemma 4's
 * trained convention, y FIRST (the single most common integration bug). Read
 * strictly on that grid: the prompt asks for it explicitly and exemplifies it,
 * so a value is far likelier to be a 0-1000 coordinate than a percentage.
 * Null = unusable, which drops the marker and keeps the plan's text. */
export function normalizeBox(value: unknown): PruneBox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const grid = value.map((n) => (typeof n === "number" ? n : Number(n)));
  if (grid.some((n) => !Number.isFinite(n) || n < 0 || n > 1000)) return null;
  // All four values <= 100 used to be refused as ambiguous between the grid we
  // asked for and percentages. Device V&V (2026-08-31, the user's own rose)
  // showed what that buys: the model answers in percentages anyway, every box
  // was dropped, and the photo rendered with NOTHING marked — the useless
  // state. So a percent-shaped answer is now read AS percentages (y,x,y,x
  // order kept). The residual risk — a true 1000-grid box that happens to fit
  // 0-100 — is a ≤10%×10% region drawn top-left: small, visible and checkable,
  // where the old behaviour was no information at all. Regions carry their own
  // size, so this loosening never creates a crosshair.
  const scale = grid.every((n) => n <= 100) ? 1 : 10;
  const [yMin, xMin, yMax, xMax] = grid.map((n) => round1(n / scale));
  if (yMax <= yMin || xMax <= xMin) return null;
  const area = ((yMax - yMin) / 100) * ((xMax - xMin) / 100);
  if (area > MAX_BOX_AREA_FRACTION || area < MIN_BOX_AREA_FRACTION) return null;
  return { top: yMin, left: xMin, bottom: yMax, right: xMax };
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

function priority(value: unknown): 1 | 2 | 3 {
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw)) return 2;
  return Math.min(3, Math.max(1, Math.round(raw))) as 1 | 2 | 3;
}

/** One normalized cut, plus whether we had to throw its location away. A cut
 * with no usable location is still a cut: it goes in the step list without a
 * badge, because "remove the branch crossing the centre" helps a grower whether
 * or not we can point at it. Only a cut with no ADVICE is worthless. */
interface NormalizedCut {
  cut: PruneCut;
  lostLocation: boolean;
}

function normalizeCut(value: unknown): NormalizedCut | null {
  if (typeof value !== "object" || value === null) return null;
  const c = value as Record<string, unknown>;

  // The advice is what makes a cut worth keeping — no label/action/reason, no cut.
  const label = text(c.label, 60);
  const action = text(c.action, 200);
  const reason = text(c.reason, 240);
  if (!label || !action || !reason) return null;

  const base = { label, action, reason, priority: priority(c.priority) };

  // The trained format first; a bare x/y point is the fallback for a model that
  // ignored it. Either way, an unusable location costs the marker only.
  if ("box_2d" in c) {
    const box = normalizeBox(c.box_2d);
    if (!box) return { cut: base, lostLocation: true };
    return {
      cut: {
        ...base,
        x: round1((box.left + box.right) / 2),
        y: round1((box.top + box.bottom) / 2),
        box,
      },
      lostLocation: false,
    };
  }

  const x = normalizeCoordinate(c.x);
  const y = normalizeCoordinate(c.y);
  if (x === null || y === null) return { cut: base, lostLocation: true };
  return { cut: { ...base, x, y }, lostLocation: false };
}

const SUBJECTS = new Set(["plant", "unclear", "not_a_plant"]);
const CONFIDENCES = new Set(["low", "medium", "high"]);

interface Preprocessed {
  candidate: Record<string, unknown>;
  dropped: number;
}

/** Reshape the model's object into something the schema can accept without
 * lowering the schema's standards: normalize coordinates, truncate strings,
 * clamp priorities, trim over-long lists, drop unrecognized enum values. */
function preprocess(raw: unknown): Preprocessed {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { candidate: {}, dropped: 0 };
  }
  const r = raw as Record<string, unknown>;
  const rawCuts = Array.isArray(r.cuts) ? r.cuts : [];
  const normalized = rawCuts
    .map(normalizeCut)
    .filter((entry): entry is NormalizedCut => entry !== null);
  // `dropped` counts MARKERS we refused to draw, not cuts we threw away.
  const dropped = normalized.filter((entry) => entry.lostLocation).length;
  const cuts = normalized.map((entry) => entry.cut);

  const steps = (Array.isArray(r.general_steps) ? r.general_steps : [])
    .map((step) => text(step, 200))
    .filter((step): step is string => step !== null)
    .slice(0, MAX_STEPS);

  const candidate: Record<string, unknown> = {
    summary: text(r.summary, 400),
    // Stable sort: priority first, model order within a priority.
    // Stable sort by priority, then hold the model to the three it was asked
    // for. Placeable cuts win a tie so the trimmed ones are the least useful.
    cuts: cuts
      .map((cut, i) => ({ cut, i }))
      .sort(
        (a, b) =>
          a.cut.priority - b.cut.priority ||
          Number(a.cut.x === undefined) - Number(b.cut.x === undefined) ||
          a.i - b.i,
      )
      .map(({ cut }) => cut)
      .slice(0, MAX_CUTS),
    general_steps: steps,
  };
  if (typeof r.subject === "string" && SUBJECTS.has(r.subject)) candidate.subject = r.subject;
  if (typeof r.confidence === "string" && CONFIDENCES.has(r.confidence)) {
    candidate.confidence = r.confidence;
  }
  return { candidate, dropped };
}

export type PrunePlanParseResult =
  | { ok: true; plan: PrunePlan; dropped: number }
  | { ok: false; reason: "no-json" | "invalid-json" | "schema-mismatch" };

/** Extract → JSON.parse → tolerant reshape → shared Zod schema. The failure
 * reason is logged, never shown: the screen gets PRUNE_UNREADABLE_ERROR. */
export function parsePrunePlanOutput(raw: string): PrunePlanParseResult {
  const candidate = extractJsonCandidate(raw);
  if (!candidate) return { ok: false, reason: "no-json" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  const { candidate: reshaped, dropped } = preprocess(parsed);
  const result = prunePlanSchema.safeParse(reshaped);
  if (!result.success) return { ok: false, reason: "schema-mismatch" };
  return { ok: true, plan: result.data, dropped };
}

/** Keep a badge (and the arrow hanging off it) inside the photo. Exported so
 * the test can assert the real margin rather than a vacuous "inside 0..100",
 * which any value including zero would satisfy. */
export const EDGE_MARGIN = 6;

/** Halo drawn around a bare point, in percent of the photo. Deliberately
 * generous: a point carries no size signal at all, so the mark must not look
 * more certain than a real box. */
const POINT_HALO_PERCENT = 12;

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

/** The region a mark occupies: the model's own box when it gave one, otherwise
 * a generous halo around the point. Clamped into the photo. */
export function haloBox(cut: { x: number; y: number; box?: PruneBox }): PruneBox {
  if (cut.box) return cut.box;
  const half = POINT_HALO_PERCENT / 2;
  return {
    top: clamp(cut.y - half),
    left: clamp(cut.x - half),
    bottom: clamp(cut.y + half),
    right: clamp(cut.x + half),
  };
}

export interface MarkPlacement {
  box: PruneBox;
  /** Which side the arrow approaches from. A layout choice — it says nothing
   * about the plant, only about where there is room. */
  side: "left" | "right";
  /** Where the arrowhead stops: the region's EDGE, never its centre. */
  tipX: number;
  tipY: number;
}

/**
 * Pure layout for one mark. The arrow points AT the region and stops at its
 * boundary; it never lands on a pixel inside it. That is the whole difference
 * between "the branch is in here" and "cut exactly there", and only the first
 * is a claim this model tier can support (design doc D-P3).
 */
export function placeMark(cut: { x: number; y: number; box?: PruneBox }): MarkPlacement {
  const box = haloBox(cut);
  const centreX = (box.left + box.right) / 2;
  const side = centreX > 60 ? "left" : "right";
  return {
    box,
    side,
    tipX: clamp(side === "left" ? box.left : box.right, EDGE_MARGIN, 100 - EDGE_MARGIN),
    tipY: clamp((box.top + box.bottom) / 2, EDGE_MARGIN, 100 - EDGE_MARGIN),
  };
}

/**
 * How many marks are actually drawn on the photo — which is NOT the same as how
 * many cuts the plan contains. Two different things are gated on this: whether
 * the "these mark the likely area" caveat is true, and whether the one-time
 * disclosure is spent. Both were wrong when this lived inline in the screen.
 *
 * `subject: "unclear"` collapses it to zero whatever the coordinates say —
 * believing the model when it reports it cannot read the photo is the entire
 * point of having asked.
 */
export function drawableMarkCount(plan: PrunePlan): number {
  if (plan.subject === "unclear") return 0;
  return plan.cuts.filter((cut) => cut.x !== undefined && cut.y !== undefined).length;
}

export function friendlyPruneError(e: unknown): string {
  if (e instanceof Error && FLOW_ERRORS.has(e.message)) return e.message;
  return GENERIC_ERROR;
}
