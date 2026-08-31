import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CareProfile } from "@citrus/shared";
import { LOCAL_HARD_CEILING_MS, LOCAL_SLOW_THRESHOLD_MS } from "./inference-budget";
import {
  CHAT_FAILED_ERROR,
  CHAT_TIMEOUT_ERROR,
  CHAT_UNAVAILABLE_ERROR,
  CHAT_UNREADABLE_ERROR,
  MAX_ANSWER_CHARS,
  MAX_HISTORY_MESSAGES,
  MAX_QUESTION_CHARS,
  buildPlantChatFacts,
  buildPlantChatSystemPrompt,
  buildPlantChatUserText,
  friendlyChatError,
  historyForNextTurn,
  normalizeQuestion,
  recentHistory,
  runPlantChatTurn,
  sanitizeChatAnswer,
  suggestedQuestions,
  todayLabel,
  unaskedSuggestions,
  type PlantChatDeps,
  type PlantChatFacts,
} from "./plant-chat";
import type { ChatMessage } from "./chat-store";

const PROFILE: CareProfile = {
  base_watering_interval_days: 21,
  water_amount_note: "Until it drains, then let it dry out.",
  sun: "full",
  temp_min_c: 5,
  temp_max_c: 35,
  drought_tolerance: "high",
  indoor_ok: false,
  notes: "Never let it sit in wet soil.",
};

function facts(overrides: Partial<PlantChatFacts> = {}): PlantChatFacts {
  return {
    today: "August 31, 2026",
    name: "Mr Lemon",
    plantType: "tree",
    species: "Meyer lemon",
    cultivar: null,
    location: "Back patio",
    careProfile: PROFILE,
    latest: {
      dateLabel: "Aug 20, 2026",
      score: 62,
      summary: "Some yellowing on older leaves.",
      symptoms: ["Yellowing older leaves", "Leaf curl"],
      recommendations: ["Check drainage"],
      trend: "Worse",
    },
    assessmentCount: 3,
    lastWateredLabel: "Aug 28, 2026",
    nextWaterLabel: "Sep 8, 2026",
    careRules: ["Prune citrus after the last frost, not in autumn.", "Never cut flush with the trunk."],
    hemisphereNote: null,
    quarantineNote: null,
    ...overrides,
  };
}

function msg(role: "user" | "assistant", text: string, id = text): ChatMessage {
  return { id, plantId: "plant-1", role, text, createdAt: "2026-08-31T10:00:00.000Z" };
}

describe("system prompt is about THIS plant", () => {
  it("carries the plant's identity, care numbers, latest reading and rules", () => {
    const prompt = buildPlantChatSystemPrompt(facts());
    expect(prompt).toContain("Mr Lemon");
    expect(prompt).toContain("Meyer lemon");
    expect(prompt).toContain("Back patio");
    expect(prompt).toContain("21");
    expect(prompt).toContain("5");
    expect(prompt).toContain("35");
    expect(prompt).toContain("62");
    expect(prompt).toContain("Yellowing older leaves");
    expect(prompt).toContain("Aug 28, 2026");
    expect(prompt).toContain("Prune citrus after the last frost, not in autumn.");
    expect(prompt).toContain("August 31, 2026");
  });

  it("tells the model the facts are authoritative and to stay on this plant", () => {
    const prompt = buildPlantChatSystemPrompt(facts()).toLowerCase();
    expect(prompt).toContain("only about this plant");
    expect(prompt).toContain("never contradict");
  });

  it("forbids inventing what it does not know", () => {
    const prompt = buildPlantChatSystemPrompt(facts()).toLowerCase();
    expect(prompt).toMatch(/do not (invent|make up)/);
  });

  it("omits sections a plant has no data for instead of writing 'null'", () => {
    const prompt = buildPlantChatSystemPrompt(
      facts({ careProfile: null, latest: null, lastWateredLabel: null, nextWaterLabel: null, species: null, cultivar: null, location: null, careRules: [] }),
    );
    expect(prompt).not.toContain("null");
    expect(prompt).not.toContain("undefined");
    expect(prompt).toContain("Mr Lemon");
    // Honest about the gap rather than silently pretending there is a history.
    expect(prompt).toMatch(/no assessments yet|not been assessed/i);
  });

  it("warns the model when this plant's rules were written for the other hemisphere", () => {
    const prompt = buildPlantChatSystemPrompt(
      facts({ hemisphereNote: "Month names in these rules are six months out for this grower." }),
    );
    expect(prompt).toContain("six months out");
  });

  it("includes a quarantine note when the plant sits in a regulated area", () => {
    const prompt = buildPlantChatSystemPrompt(facts({ quarantineNote: "HLB quarantine: do not move citrus material." }));
    expect(prompt).toContain("HLB quarantine: do not move citrus material.");
  });
});

describe("user text carries the question and a bounded history", () => {
  it("puts the question last, after the conversation so far", () => {
    const text = buildPlantChatUserText([msg("user", "Q1"), msg("assistant", "A1")], "Why yellow?");
    expect(text.indexOf("Q1")).toBeLessThan(text.indexOf("Why yellow?"));
    expect(text).toContain("A1");
    expect(text.trimEnd().endsWith("Why yellow?")).toBe(false);
    expect(text).toContain("Why yellow?");
  });

  it("works with no history at all", () => {
    const text = buildPlantChatUserText([], "First question?");
    expect(text).toContain("First question?");
  });

  it("keeps only the most recent turns", () => {
    const history = Array.from({ length: MAX_HISTORY_MESSAGES + 4 }, (_, i) =>
      msg(i % 2 === 0 ? "user" : "assistant", `m${i}`),
    );
    const kept = recentHistory(history);
    expect(kept).toHaveLength(MAX_HISTORY_MESSAGES);
    expect(kept[kept.length - 1].text).toBe(`m${MAX_HISTORY_MESSAGES + 3}`);
  });

  it("truncates a long stored message so history can't blow the context", () => {
    const kept = recentHistory([msg("user", "x".repeat(5000))]);
    expect(kept[0].text.length).toBeLessThanOrEqual(MAX_QUESTION_CHARS + 1);
  });
});

describe("buildPlantChatFacts", () => {
  const NOW = new Date(2026, 7, 31, 9, 0);

  function detail(overrides: Record<string, unknown> = {}) {
    return {
      plant: {
        id: "plant-1",
        name: "Mr Lemon",
        plant_type: "tree",
        species: "Meyer lemon",
        cultivar: null,
        location: "Back patio",
        zip_code: "90001",
        created_at: "2026-06-01T00:00:00.000Z",
        care_profile: PROFILE,
        ...overrides,
      },
      timeline: [
        {
          id: "a2",
          createdAt: "2026-08-20T10:00:00.000Z",
          dateLabel: "Aug 20, 2026",
          score: 62,
          delta: "worse" as const,
          deltaLabel: "Worse",
          deltaAdvisory: false,
          summary: "Some yellowing on older leaves.",
          localUri: null,
          isCutCare: false,
          diagnosis: {
            health_score: 62,
            summary: "Some yellowing on older leaves.",
            symptoms: [{ label: "Yellowing older leaves", severity: "medium" }],
            causes: [],
            recommendations: [{ priority: 1, action: "Check drainage", detail: "Lift the pot." }],
          },
        },
        {
          id: "a1",
          createdAt: "2026-07-20T10:00:00.000Z",
          dateLabel: "Jul 20, 2026",
          score: 70,
          delta: null,
          deltaLabel: "First",
          deltaAdvisory: false,
          summary: "Healthy.",
          localUri: null,
          isCutCare: false,
          diagnosis: { health_score: 70, summary: "Healthy.", symptoms: [], causes: [], recommendations: [] },
        },
      ],
    };
  }

  it("carries the plant's identity, latest reading and history depth", () => {
    const built = buildPlantChatFacts({ ...detail(), log: {}, weather: null, now: NOW });
    expect(built.name).toBe("Mr Lemon");
    expect(built.species).toBe("Meyer lemon");
    expect(built.assessmentCount).toBe(2);
    expect(built.latest?.score).toBe(62);
    expect(built.latest?.trend).toBe("Worse");
    expect(built.latest?.symptoms).toEqual(["Yellowing older leaves"]);
    expect(built.latest?.recommendations).toEqual(["Check drainage"]);
    expect(built.today).toBe("August 31, 2026");
  });

  it("is honest about a plant with no history and no profile", () => {
    const built = buildPlantChatFacts({
      plant: { ...detail().plant, care_profile: null },
      timeline: [],
      log: {},
      weather: null,
      now: NOW,
    });
    expect(built.latest).toBeNull();
    expect(built.assessmentCount).toBe(0);
    expect(built.careProfile).toBeNull();
    expect(built.nextWaterLabel).toBeNull();
    expect(built.lastWateredLabel).toBeNull();
  });

  it("reads the watering log and works out when water is next due", () => {
    const built = buildPlantChatFacts({
      ...detail(),
      log: { "plant-1": "2026-08-28T10:00:00.000Z" },
      weather: null,
      now: NOW,
    });
    expect(built.lastWateredLabel).toBe("Aug 28, 2026");
    expect(built.nextWaterLabel).not.toBeNull();
  });

  it("refuses a care profile that doesn't validate rather than doing bad math", () => {
    const built = buildPlantChatFacts({
      plant: { ...detail().plant, care_profile: { base_watering_interval_days: "soon" } },
      timeline: [],
      log: {},
      weather: null,
      now: NOW,
    });
    expect(built.careProfile).toBeNull();
  });

  it("attaches the quarantine rule for a citrus plant in a regulated ZIP", () => {
    const built = buildPlantChatFacts({ ...detail(), log: {}, weather: null, now: NOW });
    expect(built.quarantineNote).not.toBeNull();
    expect(built.quarantineNote).toMatch(/quarantine/i);
  });

  it("leaves the quarantine note off everywhere else", () => {
    const built = buildPlantChatFacts({
      plant: { ...detail().plant, zip_code: "10001" },
      timeline: [],
      log: {},
      weather: null,
      now: NOW,
    });
    expect(built.quarantineNote).toBeNull();
  });

  it("gives the answer this plant's own pruning rules to obey", () => {
    const built = buildPlantChatFacts({ ...detail(), log: {}, weather: null, now: NOW });
    expect(built.careRules.length).toBeGreaterThan(0);
    expect(built.careRules.join(" ")).toMatch(/citrus/i);
  });

  it("flags the hemisphere mismatch for a southern grower, and stays quiet otherwise", () => {
    // The month ARRAYS are mirrored, but the rule strings still say things like
    // "September through January" — so a southern grower needs telling.
    const south = buildPlantChatFacts({ ...detail(), log: {}, weather: null, now: NOW, hemisphere: "southern" });
    expect(south.hemisphereNote).toMatch(/six months/i);
    const north = buildPlantChatFacts({ ...detail(), log: {}, weather: null, now: NOW, hemisphere: "northern" });
    expect(north.hemisphereNote).toBeNull();
  });
});

// Both of these lived inline in the screen, and both had bugs there: a failed
// turn's dangling question was replayed into the next prompt (sending the same
// question twice and spending a history slot on an exchange that never
// happened), and the starters vanished after the first answer.
describe("historyForNextTurn", () => {
  it("passes a settled conversation through untouched", () => {
    const settled = [msg("user", "Q1"), msg("assistant", "A1")];
    expect(historyForNextTurn(settled)).toEqual(settled);
  });

  it("drops a trailing question that was never answered", () => {
    const dangling = [msg("user", "Q1"), msg("assistant", "A1"), msg("user", "Q2 failed")];
    expect(historyForNextTurn(dangling).map((m) => m.text)).toEqual(["Q1", "A1"]);
  });

  it("drops only one — two failures in a row still leave a clean history", () => {
    const twice = [msg("user", "Q1"), msg("assistant", "A1"), msg("user", "Q2")];
    expect(historyForNextTurn(historyForNextTurn(twice)).map((m) => m.text)).toEqual(["Q1", "A1"]);
  });

  it("handles an empty conversation", () => {
    expect(historyForNextTurn([])).toEqual([]);
  });
});

describe("unaskedSuggestions", () => {
  it("keeps starters available after the first exchange", () => {
    const asked = suggestedQuestions(facts())[0];
    const remaining = unaskedSuggestions(facts(), [msg("user", asked), msg("assistant", "A")]);
    expect(remaining.length).toBeGreaterThan(0);
    expect(remaining).not.toContain(asked);
  });

  it("drops every starter the user has already asked", () => {
    const all = suggestedQuestions(facts());
    const history = all.flatMap((q) => [msg("user", q), msg("assistant", "A")]);
    expect(unaskedSuggestions(facts(), history)).toEqual([]);
  });

  it("ignores an assistant message that happens to repeat a starter", () => {
    const first = suggestedQuestions(facts())[0];
    expect(unaskedSuggestions(facts(), [msg("assistant", first)])).toContain(first);
  });
});

describe("todayLabel", () => {
  // "Should I prune now?" is answered against a date, so the date has to be
  // the one on the grower's phone. A UTC-based label is a day off all evening
  // for every user west of Greenwich.
  it("formats the phone's LOCAL date in plain words", () => {
    expect(todayLabel(new Date(2026, 7, 31, 22, 30))).toBe("August 31, 2026");
    expect(todayLabel(new Date(2026, 0, 1, 0, 5))).toBe("January 1, 2026");
  });

  it("gives the same label all day", () => {
    expect(todayLabel(new Date(2026, 7, 31, 0, 1))).toBe(todayLabel(new Date(2026, 7, 31, 23, 59)));
  });
});

describe("question normalization", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeQuestion("  why   is   it  yellow? \n")).toBe("why is it yellow?");
  });

  it("returns null for an empty or whitespace-only question", () => {
    expect(normalizeQuestion("")).toBeNull();
    expect(normalizeQuestion("   \n  ")).toBeNull();
  });

  it("caps an over-long question", () => {
    const long = normalizeQuestion("a".repeat(MAX_QUESTION_CHARS + 500));
    expect(long).not.toBeNull();
    expect(long!.length).toBe(MAX_QUESTION_CHARS);
  });
});

describe("answer sanitizing (the model has no responseSchema)", () => {
  it("keeps a normal prose answer as-is", () => {
    expect(sanitizeChatAnswer("Water it deeply once the top inch is dry.")).toBe(
      "Water it deeply once the top inch is dry.",
    );
  });

  it("strips a leading role label", () => {
    expect(sanitizeChatAnswer("Assistant: Water it deeply.")).toBe("Water it deeply.");
    expect(sanitizeChatAnswer("Answer:\nWater it deeply.")).toBe("Water it deeply.");
  });

  it("unwraps markdown code fences", () => {
    expect(sanitizeChatAnswer("```\nWater it deeply.\n```")).toBe("Water it deeply.");
    expect(sanitizeChatAnswer("```text\nWater it deeply.\n```")).toBe("Water it deeply.");
  });

  it("cuts a hallucinated next turn", () => {
    expect(sanitizeChatAnswer("Water it deeply.\n\nUser: and then?\nAssistant: then wait.")).toBe(
      "Water it deeply.",
    );
    expect(sanitizeChatAnswer("Water it deeply.\nQuestion: what about food?")).toBe("Water it deeply.");
  });

  it("refuses an answer that just echoes the prompt back", () => {
    expect(sanitizeChatAnswer("PLANT FACTS\nName: Mr Lemon")).toBeNull();
    expect(sanitizeChatAnswer("")).toBeNull();
    expect(sanitizeChatAnswer("   \n\n  ")).toBeNull();
  });

  it("truncates a runaway answer at a word boundary", () => {
    const answer = sanitizeChatAnswer(`${"word ".repeat(600)}end`);
    expect(answer).not.toBeNull();
    expect(answer!.length).toBeLessThanOrEqual(MAX_ANSWER_CHARS + 1);
    expect(answer!.endsWith("…")).toBe(true);
    expect(answer).not.toContain("word wo…");
  });

  it("collapses runs of blank lines", () => {
    expect(sanitizeChatAnswer("One.\n\n\n\nTwo.")).toBe("One.\n\nTwo.");
  });
});

describe("suggested questions are derived from this plant's state", () => {
  it("offers the plant's own symptom as a starter", () => {
    const suggestions = suggestedQuestions(facts());
    expect(suggestions.some((q) => q.includes("Yellowing older leaves"))).toBe(true);
  });

  it("always offers a pruning question when the plant has pruning rules", () => {
    expect(suggestedQuestions(facts()).some((q) => /prune/i.test(q))).toBe(true);
  });

  it("stays useful for a brand-new plant with no history", () => {
    const suggestions = suggestedQuestions(
      facts({ latest: null, assessmentCount: 0, careProfile: null, careRules: [] }),
    );
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((q) => q.length > 0)).toBe(true);
  });

  // The one question with a legal consequence must not be the one the slice
  // drops. For a symptomatic citrus in a quarantine ZIP — the plant this app
  // was built around — it used to rank 5th of 5.
  it("ranks the quarantine question first, where it cannot be cut", () => {
    const suggestions = suggestedQuestions(
      facts({ quarantineNote: "In an active CA citrus quarantine zone." }),
    );
    expect(suggestions[0]).toMatch(/local citrus rules/i);
    expect(suggestions.length).toBeLessThanOrEqual(4);
  });

  it("never offers more than four, and never duplicates", () => {
    const suggestions = suggestedQuestions(facts());
    expect(suggestions.length).toBeLessThanOrEqual(4);
    expect(new Set(suggestions).size).toBe(suggestions.length);
  });
});

describe("runPlantChatTurn", () => {
  function makeDeps(overrides: Partial<PlantChatDeps> = {}) {
    const generated: { system: string; user: string }[] = [];
    const saved: { plantId: string; role: string; text: string }[] = [];
    const interrupted: string[] = [];
    const deps: PlantChatDeps = {
      isReady: () => true,
      generate: async (args) => {
        generated.push(args);
        return "Water it deeply once the top inch is dry.";
      },
      save: async (message) => {
        saved.push(message);
      },
      interrupt: () => interrupted.push("interrupt"),
      ...overrides,
    };
    return { deps, generated, saved, interrupted };
  }

  const INPUT = { plantId: "plant-1", facts: facts(), history: [], question: "How often do I water?" };

  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("asks with this plant's facts and returns the sanitized answer", async () => {
    const { deps, generated } = makeDeps();
    const answer = await runPlantChatTurn(deps, INPUT);
    expect(answer).toBe("Water it deeply once the top inch is dry.");
    expect(generated).toHaveLength(1);
    expect(generated[0].system).toContain("Mr Lemon");
    expect(generated[0].user).toContain("How often do I water?");
  });

  it("records the question before the answer, so a failed answer still leaves the question", async () => {
    const { deps, saved } = makeDeps();
    await runPlantChatTurn(deps, INPUT);
    expect(saved.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(saved[0].text).toBe("How often do I water?");
    expect(saved[1].text).toBe("Water it deeply once the top inch is dry.");
  });

  it("refuses honestly when the engine isn't ready", async () => {
    const { deps, generated } = makeDeps({ isReady: () => false });
    await expect(runPlantChatTurn(deps, INPUT)).rejects.toThrow(CHAT_UNAVAILABLE_ERROR);
    expect(generated).toHaveLength(0);
  });

  it("turns a model crash into a retryable error, never the raw message", async () => {
    const { deps } = makeDeps({
      generate: async () => {
        throw new Error("vulkan device lost 0xdeadbeef");
      },
    });
    await expect(runPlantChatTurn(deps, INPUT)).rejects.toThrow(CHAT_FAILED_ERROR);
  });

  it("reports unreadable output rather than showing prompt echo to the user", async () => {
    const { deps } = makeDeps({ generate: async () => "PLANT FACTS\nName: Mr Lemon" });
    await expect(runPlantChatTurn(deps, INPUT)).rejects.toThrow(CHAT_UNREADABLE_ERROR);
  });

  it("still returns the answer when saving it fails", async () => {
    const { deps } = makeDeps({
      save: async () => {
        throw new Error("AsyncStorage full");
      },
    });
    await expect(runPlantChatTurn(deps, INPUT)).resolves.toContain("Water it deeply");
  });

  describe("under the shared inference budget", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("hints that it is slow but keeps waiting", async () => {
      const slow: string[] = [];
      const { deps } = makeDeps({
        generate: () =>
          new Promise<string>((resolve) =>
            setTimeout(() => resolve("Deeply, weekly."), LOCAL_SLOW_THRESHOLD_MS + 1_000),
          ),
      });
      const pending = runPlantChatTurn(deps, INPUT, { onSlow: () => slow.push("slow") });
      await vi.advanceTimersByTimeAsync(LOCAL_SLOW_THRESHOLD_MS + 1_000);
      expect(await pending).toBe("Deeply, weekly.");
      expect(slow).toEqual(["slow"]);
    });

    it("interrupts the session and gives up honestly at the ceiling", async () => {
      const { deps, interrupted } = makeDeps({ generate: () => new Promise<string>(() => {}) });
      const pending = runPlantChatTurn(deps, INPUT);
      const assertion = expect(pending).rejects.toThrow(CHAT_TIMEOUT_ERROR);
      await vi.advanceTimersByTimeAsync(LOCAL_HARD_CEILING_MS + 1);
      await assertion;
      expect(interrupted).toEqual(["interrupt"]);
    });
  });
});

describe("error strings are honest and never leak model text", () => {
  it("passes the flow's own strings through", () => {
    for (const message of [
      CHAT_UNAVAILABLE_ERROR,
      CHAT_FAILED_ERROR,
      CHAT_UNREADABLE_ERROR,
      CHAT_TIMEOUT_ERROR,
    ]) {
      expect(friendlyChatError(new Error(message))).toBe(message);
    }
  });

  it("collapses anything else to a generic string", () => {
    const friendly = friendlyChatError(new Error("CUDA error: device-side assert at 0x7ff"));
    expect(friendly).not.toContain("CUDA");
    expect(friendly.length).toBeGreaterThan(0);
  });

  it("mentions retrying rather than a dead end", () => {
    expect(CHAT_FAILED_ERROR.toLowerCase()).toContain("try again");
  });
});
