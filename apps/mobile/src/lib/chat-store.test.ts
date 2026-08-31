import { describe, expect, it } from "vitest";
import {
  CHAT_STORAGE_KEY,
  MAX_MESSAGES_PER_PLANT,
  appendMessage,
  messagesForPlant,
  parseChatStore,
  removePlantChat,
  serializeChatStore,
  type ChatMessage,
} from "./chat-store";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    plantId: "plant-1",
    role: "user",
    text: "Why are the leaves yellow?",
    createdAt: "2026-08-31T10:00:00.000Z",
    ...overrides,
  };
}

describe("chat store shape", () => {
  it("keeps conversation order per plant and isolates plants", () => {
    let store = appendMessage({}, message({ id: "m1", text: "Q1" }));
    store = appendMessage(store, message({ id: "m2", role: "assistant", text: "A1" }));
    store = appendMessage(store, message({ id: "m3", plantId: "plant-2", text: "other plant" }));

    expect(messagesForPlant(store, "plant-1").map((m) => m.text)).toEqual(["Q1", "A1"]);
    expect(messagesForPlant(store, "plant-2").map((m) => m.text)).toEqual(["other plant"]);
    expect(messagesForPlant(store, "plant-3")).toEqual([]);
  });

  it("does not mutate the store it is given", () => {
    const before = appendMessage({}, message());
    const snapshot = JSON.parse(JSON.stringify(before));
    appendMessage(before, message({ id: "m2" }));
    expect(before).toEqual(snapshot);
  });

  it("caps a plant's history at MAX_MESSAGES_PER_PLANT, dropping the oldest", () => {
    let store = {};
    for (let i = 0; i < MAX_MESSAGES_PER_PLANT + 5; i++) {
      store = appendMessage(store, message({ id: `m${i}`, text: `msg ${i}` }));
    }
    const kept = messagesForPlant(store, "plant-1");
    expect(kept).toHaveLength(MAX_MESSAGES_PER_PLANT);
    expect(kept[0].text).toBe("msg 5");
    expect(kept[kept.length - 1].text).toBe(`msg ${MAX_MESSAGES_PER_PLANT + 4}`);
  });

  it("drops a plant's whole conversation on cascade delete", () => {
    let store = appendMessage({}, message());
    store = appendMessage(store, message({ id: "m2", plantId: "plant-2" }));
    const next = removePlantChat(store, "plant-1");
    expect(messagesForPlant(next, "plant-1")).toEqual([]);
    expect(messagesForPlant(next, "plant-2")).toHaveLength(1);
  });
});

describe("chat store persistence (untrusted on read)", () => {
  it("round-trips through serialize/parse", () => {
    const store = appendMessage({}, message());
    expect(parseChatStore(serializeChatStore(store))).toEqual(store);
  });

  it("degrades to an empty store for null, junk, and non-object JSON", () => {
    expect(parseChatStore(null)).toEqual({});
    expect(parseChatStore("not json{")).toEqual({});
    expect(parseChatStore("[1,2,3]")).toEqual({});
    expect(parseChatStore('"a string"')).toEqual({});
  });

  it("drops malformed messages but keeps the valid ones around them", () => {
    const raw = JSON.stringify({
      "plant-1": [
        message({ id: "good" }),
        { id: "no-role", plantId: "plant-1", text: "x", createdAt: "2026-08-31T10:00:00.000Z" },
        { ...message({ id: "bad-role" }), role: "system" },
        { ...message({ id: "empty" }), text: "" },
        message({ id: "good-2", role: "assistant" }),
      ],
      "plant-2": "not an array",
    });
    const store = parseChatStore(raw);
    expect(messagesForPlant(store, "plant-1").map((m) => m.id)).toEqual(["good", "good-2"]);
    expect(store["plant-2"]).toBeUndefined();
  });

  it("trims an over-long stored conversation on read", () => {
    const tooMany = Array.from({ length: MAX_MESSAGES_PER_PLANT + 3 }, (_, i) =>
      message({ id: `m${i}`, text: `msg ${i}` }),
    );
    const store = parseChatStore(JSON.stringify({ "plant-1": tooMany }));
    expect(messagesForPlant(store, "plant-1")).toHaveLength(MAX_MESSAGES_PER_PLANT);
    expect(messagesForPlant(store, "plant-1")[0].text).toBe("msg 3");
  });

  it("names its storage key so a rename is a deliberate migration", () => {
    expect(CHAT_STORAGE_KEY).toBe("citrus.plant-chat.v1");
  });
});
