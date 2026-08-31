// The time budget every on-device call runs under (D-17). Extracted from the
// assess flow when the chat (F38) and pruning (F23) calls needed the same
// deal: there is no cloud to escalate to, so a slow phone must be told it is
// slow rather than cut off, and a stuck session must be freed rather than
// waited on forever. Pure — the interrupt is injected by the caller.

/** On a mid-range phone the first inference (cold model) is legitimately slow,
 * so past this we only change the UI copy — we do NOT abandon the result. */
export const LOCAL_SLOW_THRESHOLD_MS = 25_000;

/** Safety valve: past this the model is stuck. The caller interrupt()s the
 * single native session so the next attempt isn't blocked. */
export const LOCAL_HARD_CEILING_MS = 120_000;

/** Distinct type, not a message string: a model that threw with unlucky
 * wording must not be mistaken for the ceiling firing. */
export class InferenceTimeoutError extends Error {
  constructor(hardMs: number = LOCAL_HARD_CEILING_MS) {
    super(`on-device inference exceeded ${hardMs}ms`);
    this.name = "InferenceTimeoutError";
  }
}

export interface InferenceBudget {
  slowMs: number;
  hardMs: number;
  /** Fires once when the call passes slowMs; the call keeps running. */
  onSlow?: () => void;
  /** Fires at hardMs, before the rejection — free the native session here. */
  onHardTimeout?: () => void;
}

/** Run `promise` with two timers: a soft `slowMs` that only fires `onSlow` (a
 * UI hint), and a hard `hardMs` that fires `onHardTimeout` and rejects with
 * InferenceTimeoutError. The abandoned inference keeps running in the native
 * runtime — that is what onHardTimeout's interrupt() is for. */
export function withInferenceBudget<T>(promise: Promise<T>, budget: InferenceBudget): Promise<T> {
  const slowTimer = setTimeout(() => budget.onSlow?.(), budget.slowMs);
  let hardTimer: ReturnType<typeof setTimeout>;
  const ceiling = new Promise<never>((_, reject) => {
    hardTimer = setTimeout(() => {
      budget.onHardTimeout?.();
      reject(new InferenceTimeoutError(budget.hardMs));
    }, budget.hardMs);
  });
  return Promise.race([promise, ceiling]).finally(() => {
    clearTimeout(slowTimer);
    clearTimeout(hardTimer);
  });
}
