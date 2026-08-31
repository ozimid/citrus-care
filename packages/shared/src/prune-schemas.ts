import { z } from "zod";

/**
 * F23 — the pruning plan the on-device model returns for a photo: a short read
 * of the plant plus the individual cuts it thinks the grower should make, each
 * with a point on the photo so the app can draw a marker there.
 *
 * Two things this contract is deliberately strict about:
 *  - The model is asked for `box_2d` — [y_min, x_min, y_max, x_max] integers on
 *    a 1000x1000 grid, y first — because that is the convention Gemma 4 was
 *    TRAINED to emit (docs/research/pruning-rules.md). Percentages and 0-1
 *    floats are off-distribution. Everything is normalized to percentages of
 *    the photo before it reaches this schema, so the app never has to think in
 *    two coordinate systems at once.
 *  - Every cut carries `action` and `reason` text. The marker is an aid; the
 *    sentence is the instruction. If the point is wrong the grower can still
 *    read what to do — and that asymmetry is the whole safety argument for
 *    drawing marks from a ~2B model at all.
 *
 * Everything except `summary` and `cuts` is optional-with-a-default: a missing
 * field must degrade the plan, never lose it (the local model has no
 * responseSchema, so each required key is one more way to get nothing back).
 */

export const pruneCutSchema = z.object({
  /** Short name for the cut, e.g. "Crossing branch". */
  label: z.string().min(1).max(60),
  /** What to actually do, e.g. "Cut just outside the collar, on the trunk side". */
  action: z.string().min(1).max(200),
  /** Why this cut helps the plant. */
  reason: z.string().min(1).max(240),
  /** 1 = do this first. */
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** Percent of the photo's width, from the LEFT edge. Centre of `box` when
   * the model gave one. OPTIONAL on purpose: a cut whose coordinates we refuse
   * to trust keeps its advice and simply has no marker. The sentence is the
   * instruction; the mark is the aid, so the aid is what goes missing. */
  x: z.number().min(0).max(100).optional(),
  /** Percent of the photo's height, from the TOP edge. */
  y: z.number().min(0).max(100).optional(),
  /** The REGION the model pointed at, in percentages of the photo. Present
   * whenever the model answered in its trained `box_2d` convention. Drawn as a
   * halo rather than a crosshair: the box's size is the only uncertainty
   * signal the model gives us, and discarding it would be claiming a precision
   * this model tier does not have. */
  box: z
    .object({
      top: z.number().min(0).max(100),
      left: z.number().min(0).max(100),
      bottom: z.number().min(0).max(100),
      right: z.number().min(0).max(100),
    })
    .optional(),
});

export type PruneCut = z.infer<typeof pruneCutSchema>;

/** What the model says it could see — the same honesty valve as the diagnosis
 * path's `subject`, so "I can't make out the branches" is a first-class answer
 * instead of five invented cuts. */
export const pruneSubjectSchema = z.enum(["plant", "unclear", "not_a_plant"]);

export type PruneSubject = z.infer<typeof pruneSubjectSchema>;

export const prunePlanSchema = z.object({
  summary: z.string().min(1).max(400),
  subject: pruneSubjectSchema.optional(),
  /** The model's own confidence in the MARKS (not in the advice). */
  confidence: z.enum(["low", "medium", "high"]).optional(),
  cuts: z.array(pruneCutSchema).max(6).default([]),
  /** Advice with no single point on the photo: sterilise tools, wait for
   * spring, remove suckers at the base, and so on. */
  general_steps: z.array(z.string().min(1).max(200)).max(4).default([]),
});

export type PrunePlan = z.infer<typeof prunePlanSchema>;
