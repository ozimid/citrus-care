import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InferenceTimeoutError,
  LOCAL_HARD_CEILING_MS,
  LOCAL_SLOW_THRESHOLD_MS,
  withInferenceBudget,
} from "./inference-budget";

// The two-timer budget every on-device call shares (diagnosis, care profile,
// chat, pruning plan): a soft hint that only changes the copy, and a hard
// ceiling that frees the single native session and gives up honestly.

describe("withInferenceBudget", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with the value when the call finishes in time", async () => {
    const pending = withInferenceBudget(Promise.resolve("done"), {
      slowMs: LOCAL_SLOW_THRESHOLD_MS,
      hardMs: LOCAL_HARD_CEILING_MS,
    });
    expect(await pending).toBe("done");
  });

  it("fires onSlow but keeps waiting past the slow threshold", async () => {
    const slow: string[] = [];
    const pending = withInferenceBudget(
      new Promise<string>((resolve) => setTimeout(() => resolve("late"), LOCAL_SLOW_THRESHOLD_MS + 5_000)),
      {
        slowMs: LOCAL_SLOW_THRESHOLD_MS,
        hardMs: LOCAL_HARD_CEILING_MS,
        onSlow: () => slow.push("hint"),
      },
    );
    await vi.advanceTimersByTimeAsync(LOCAL_SLOW_THRESHOLD_MS + 5_000);
    expect(await pending).toBe("late");
    expect(slow).toEqual(["hint"]);
  });

  it("rejects with InferenceTimeoutError and calls onHardTimeout at the ceiling", async () => {
    const interrupted: string[] = [];
    const pending = withInferenceBudget(new Promise<string>(() => {}), {
      slowMs: LOCAL_SLOW_THRESHOLD_MS,
      hardMs: LOCAL_HARD_CEILING_MS,
      onHardTimeout: () => interrupted.push("interrupt"),
    });
    const assertion = expect(pending).rejects.toBeInstanceOf(InferenceTimeoutError);
    await vi.advanceTimersByTimeAsync(LOCAL_HARD_CEILING_MS + 1);
    await assertion;
    expect(interrupted).toEqual(["interrupt"]);
  });

  it("keeps a result that lands just inside the ceiling", async () => {
    const pending = withInferenceBudget(
      new Promise<string>((resolve) => setTimeout(() => resolve("just made it"), LOCAL_HARD_CEILING_MS - 1)),
      { slowMs: LOCAL_SLOW_THRESHOLD_MS, hardMs: LOCAL_HARD_CEILING_MS },
    );
    await vi.advanceTimersByTimeAsync(LOCAL_HARD_CEILING_MS);
    expect(await pending).toBe("just made it");
  });

  it("does not fire onSlow once the call has already finished", async () => {
    const slow: string[] = [];
    const pending = withInferenceBudget(Promise.resolve("fast"), {
      slowMs: LOCAL_SLOW_THRESHOLD_MS,
      hardMs: LOCAL_HARD_CEILING_MS,
      onSlow: () => slow.push("hint"),
    });
    await pending;
    await vi.advanceTimersByTimeAsync(LOCAL_HARD_CEILING_MS * 2);
    expect(slow).toEqual([]);
  });

  it("propagates the original rejection rather than masking it as a timeout", async () => {
    const pending = withInferenceBudget(Promise.reject(new Error("native OOM")), {
      slowMs: LOCAL_SLOW_THRESHOLD_MS,
      hardMs: LOCAL_HARD_CEILING_MS,
    });
    await expect(pending).rejects.toThrow("native OOM");
  });

  it("gives the slow hint room before the ceiling", () => {
    expect(LOCAL_SLOW_THRESHOLD_MS).toBeLessThan(LOCAL_HARD_CEILING_MS);
  });
});
