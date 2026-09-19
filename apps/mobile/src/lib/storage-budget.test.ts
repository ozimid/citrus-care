import { describe, expect, it } from "vitest";
import {
  ASSESSMENT_BYTES_ESTIMATE,
  ASYNC_STORAGE_LIMIT_BYTES,
  ASYNC_STORAGE_SOFT_LIMIT_BYTES,
  canRunBatch,
  formatStorageSize,
  storageSummary,
} from "./storage-budget";

// D-W17: Android's AsyncStorage is one 6 MB SQLite database and every store is
// a whole-blob rewrite, so the cliff is real and today it is silent. The guard
// refuses a batch BEFORE the model spends minutes on it, with copy the user can
// act on; the summary makes the two budgets visible on Profile.

const MiB = 1024 * 1024;

describe("budget constants", () => {
  it("soft limit sits below the Android default hard limit", () => {
    expect(ASYNC_STORAGE_SOFT_LIMIT_BYTES).toBeLessThan(ASYNC_STORAGE_LIMIT_BYTES);
  });
});

describe("canRunBatch", () => {
  it("refuses when the projected records total would pass the soft limit", () => {
    const verdict = canRunBatch(4.9 * MiB, 30);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    // User-safe copy: a full sentence that says what to do, no byte counts,
    // no internal names.
    expect(verdict.reason).toMatch(/^[A-Z].*\.$/);
    expect(verdict.reason).toMatch(/backup/i);
    expect(verdict.reason).not.toMatch(/AsyncStorage|bytes|MiB/);
  });

  it("allows a batch that fits with room to spare", () => {
    expect(canRunBatch(1 * MiB, 30)).toEqual({ ok: true });
    expect(canRunBatch(0, 1)).toEqual({ ok: true });
  });

  it("projects with the per-assessment estimate (the boundary is exact)", () => {
    const room = ASYNC_STORAGE_SOFT_LIMIT_BYTES - 2 * ASSESSMENT_BYTES_ESTIMATE;
    expect(canRunBatch(room, 2).ok).toBe(true);
    expect(canRunBatch(room, 3).ok).toBe(false);
  });
});

describe("formatStorageSize", () => {
  it("shows whole megabytes below a gigabyte", () => {
    expect(formatStorageSize(0)).toBe("0 MB");
    expect(formatStorageSize(431_000_000)).toBe("411 MB");
    expect(formatStorageSize(1023 * MiB)).toBe("1023 MB");
  });

  it("switches to one-decimal gigabytes at 1 GB", () => {
    expect(formatStorageSize(1.4e9)).toBe("1.3 GB");
    expect(formatStorageSize(1024 * MiB)).toBe("1.0 GB");
  });

  it("never renders garbage for a bad measurement", () => {
    expect(formatStorageSize(-5)).toBe("0 MB");
    expect(formatStorageSize(Number.NaN)).toBe("0 MB");
  });
});

describe("storageSummary", () => {
  it("renders both budgets on one line", () => {
    expect(storageSummary(1.2 * MiB, 412 * MiB)).toBe("Records: 1.2 of 6 MB · Photos: 412 MB");
    expect(storageSummary(0, 0)).toBe("Records: 0.0 of 6 MB · Photos: 0 MB");
  });
});
