// F38 per-plant chat, pure half: the stored conversation for each plant, in
// one AsyncStorage JSON blob keyed by plant id. Unlike the assessment store
// (a flat map by id) this one keys by PLANT and keeps an ARRAY, because the
// only access pattern is "this plant's conversation, in order" — array order
// IS the conversation, so two messages minted in the same millisecond can
// never sort ambiguously. Untrusted on read: a malformed message is dropped,
// never thrown. The AsyncStorage wiring is the thin plant-chat-io.ts.

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  plantId: string;
  role: ChatRole;
  /** What the user asked, or the sanitized answer the model gave. */
  text: string;
  /** ISO timestamp. */
  createdAt: string;
}

/** plantId → conversation, oldest first. */
export type ChatStore = Record<string, ChatMessage[]>;

export const CHAT_STORAGE_KEY = "citrus.plant-chat.v1";

/** Hard cap per plant. A conversation is a convenience, not an archive: the
 * store is a single blob read on every app open, so it must not grow without
 * bound. Oldest messages fall off the front. */
export const MAX_MESSAGES_PER_PLANT = 60;

function trim(messages: ChatMessage[]): ChatMessage[] {
  return messages.length <= MAX_MESSAGES_PER_PLANT
    ? messages
    : messages.slice(messages.length - MAX_MESSAGES_PER_PLANT);
}

/** Append to the plant's conversation (pure — inputs are not mutated). */
export function appendMessage(store: ChatStore, message: ChatMessage): ChatStore {
  const existing = store[message.plantId] ?? [];
  return { ...store, [message.plantId]: trim([...existing, message]) };
}

export function messagesForPlant(store: ChatStore, plantId: string): ChatMessage[] {
  return store[plantId] ?? [];
}

/** Cascade on plant delete: the conversation goes with the plant. */
export function removePlantChat(store: ChatStore, plantId: string): ChatStore {
  const next: ChatStore = {};
  for (const [id, messages] of Object.entries(store)) {
    if (id !== plantId) next[id] = messages;
  }
  return next;
}

function isValidMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    typeof m.plantId === "string" &&
    (m.role === "user" || m.role === "assistant") &&
    typeof m.text === "string" &&
    m.text.length > 0 &&
    typeof m.createdAt === "string"
  );
}

/** Parse the stored blob. Untrusted: malformed JSON, non-array conversations
 * and malformed messages all degrade (dropped / empty store), never throw. */
export function parseChatStore(json: string | null): ChatStore {
  if (!json) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const store: ChatStore = {};
  for (const [plantId, messages] of Object.entries(raw)) {
    if (!Array.isArray(messages)) continue;
    const valid = messages.filter(isValidMessage);
    if (valid.length > 0) store[plantId] = trim(valid);
  }
  return store;
}

export function serializeChatStore(store: ChatStore): string {
  return JSON.stringify(store);
}
