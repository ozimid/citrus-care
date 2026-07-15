import { describe, expect, it } from "vitest";
import {
  MAX_RUN_LOG,
  RUN_LOG_STORAGE_KEY,
  SPIKE_BAR,
  appendRun,
  classifyInit,
  formatMs,
  parseRunLog,
  parseTally,
  runPassesBar,
  serializeRunLog,
  type SpikeRun,
} from "./spike-metrics";

function run(kind: SpikeRun["kind"], ms: number, parseOk?: boolean): SpikeRun {
  return { at: "2026-07-15T12:00:00.000Z", kind, ms, ...(parseOk === undefined ? {} : { parseOk }) };
}

describe("SPIKE_BAR", () => {
  it("mirrors the go/no-go bar from docs/research/on-device-vlm-native.md", () => {
    expect(SPIKE_BAR.coldInitMaxMs).toBe(90_000);
    expect(SPIKE_BAR.warmInitMaxMs).toBe(10_000);
    expect(SPIKE_BAR.inferenceMaxMs).toBe(15_000);
    expect(SPIKE_BAR.parseWindow).toBe(5);
    expect(SPIKE_BAR.parseMinPass).toBe(3);
  });
});

describe("classifyInit", () => {
  it("is cold when a download was observed, warm when files came from cache", () => {
    expect(classifyInit(true)).toBe("cold");
    expect(classifyInit(false)).toBe("warm");
  });
});

describe("runPassesBar", () => {
  it("cold init passes at <=90s and fails above", () => {
    expect(runPassesBar(run("init-cold", 90_000))).toBe(true);
    expect(runPassesBar(run("init-cold", 90_001))).toBe(false);
  });

  it("warm init passes at <=10s and fails above", () => {
    expect(runPassesBar(run("init-warm", 10_000))).toBe(true);
    expect(runPassesBar(run("init-warm", 10_001))).toBe(false);
  });

  it("inference passes at <=15s and fails above (time bar only; parse is tallied separately)", () => {
    expect(runPassesBar(run("inference", 15_000, true))).toBe(true);
    expect(runPassesBar(run("inference", 15_001, true))).toBe(false);
    // A fast run whose output failed to parse still passes the TIME bar.
    expect(runPassesBar(run("inference", 3_000, false))).toBe(true);
  });
});

describe("appendRun", () => {
  it("prepends (newest first) without mutating the input", () => {
    const log = [run("inference", 5_000, true)];
    const next = appendRun(log, run("init-warm", 2_000));
    expect(next).toHaveLength(2);
    expect(next[0].kind).toBe("init-warm");
    expect(log).toHaveLength(1);
  });

  it("caps the log at MAX_RUN_LOG, dropping the oldest", () => {
    let log: SpikeRun[] = [];
    for (let i = 0; i < MAX_RUN_LOG + 3; i++) {
      log = appendRun(log, run("inference", i, true));
    }
    expect(log).toHaveLength(MAX_RUN_LOG);
    expect(log[0].ms).toBe(MAX_RUN_LOG + 2); // newest kept
    expect(log[log.length - 1].ms).toBe(3); // oldest three dropped
  });
});

describe("parseTally", () => {
  it("is pending with no inference runs", () => {
    expect(parseTally([run("init-cold", 40_000)])).toEqual({ passed: 0, total: 0, verdict: "pending" });
  });

  it("counts parse successes over the most recent window of 5 inference runs only", () => {
    // newest-first log: 2 ok + 1 fail recent, plus old runs beyond the window
    const log = [
      run("inference", 1, true),
      run("init-warm", 2_000),
      run("inference", 2, false),
      run("inference", 3, true),
      run("inference", 4, true),
      run("inference", 5, true),
      run("inference", 6, false), // 6th inference — outside the window
    ];
    expect(parseTally(log)).toEqual({ passed: 4, total: 5, verdict: "pass" });
  });

  it("passes as soon as 3 successes exist even before 5 runs", () => {
    const log = [run("inference", 1, true), run("inference", 2, true), run("inference", 3, true)];
    expect(parseTally(log)).toEqual({ passed: 3, total: 3, verdict: "pass" });
  });

  it("fails once the full window holds fewer than 3 successes", () => {
    const log = [
      run("inference", 1, false),
      run("inference", 2, false),
      run("inference", 3, false),
      run("inference", 4, true),
      run("inference", 5, true),
    ];
    expect(parseTally(log)).toEqual({ passed: 2, total: 5, verdict: "fail" });
  });

  it("is pending while under 5 runs and under 3 successes", () => {
    const log = [run("inference", 1, false), run("inference", 2, true)];
    expect(parseTally(log)).toEqual({ passed: 1, total: 2, verdict: "pending" });
  });
});

describe("run log (de)serialization", () => {
  it("round-trips a log", () => {
    const log = [run("init-cold", 42_000), run("inference", 9_000, true)];
    expect(parseRunLog(serializeRunLog(log))).toEqual(log);
  });

  it("degrades untrusted storage to an empty log, never throws", () => {
    expect(parseRunLog(null)).toEqual([]);
    expect(parseRunLog("")).toEqual([]);
    expect(parseRunLog("not json")).toEqual([]);
    expect(parseRunLog('{"an":"object"}')).toEqual([]);
  });

  it("drops malformed entries but keeps valid ones", () => {
    const good = run("inference", 1_000, true);
    const json = JSON.stringify([good, { kind: "inference" }, 7, { at: "x", kind: "nope", ms: 1 }]);
    expect(parseRunLog(json)).toEqual([good]);
  });

  it("exports a versioned storage key", () => {
    expect(RUN_LOG_STORAGE_KEY).toBe("citrus.vlm-spike-runs.v1");
  });
});

describe("formatMs", () => {
  it("renders sub-second values in ms", () => {
    expect(formatMs(812)).toBe("812 ms");
    expect(formatMs(0)).toBe("0 ms");
  });

  it("renders seconds with one decimal under a minute", () => {
    expect(formatMs(12_340)).toBe("12.3 s");
    expect(formatMs(1_000)).toBe("1.0 s");
  });

  it("renders minutes + whole seconds from a minute up", () => {
    expect(formatMs(92_000)).toBe("1m 32s");
    expect(formatMs(60_000)).toBe("1m 0s");
  });
});
