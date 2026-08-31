// F38 chat, IO half: AsyncStorage wiring for the conversation, plus the one
// read the facts builder can't do for itself (the cached forecast). Thin by
// policy — the prompt, the sanitizer, the turn and the facts assembly are all
// pure and tested (plant-chat.ts), and the store is pure and tested
// (chat-store.ts).
//
// Deliberately imports nothing from plants-io: the plant read belongs to the
// screen (same shape as PlantDetailScreen's fetch → pure mapper), which keeps
// the delete cascade in plants-io free to call deletePlantChat here without a
// module cycle.
//
// The cached-conditions read (weather + hemisphere, no network) lives in
// weather-io, where the cache belongs; the screen composes the two.

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CHAT_STORAGE_KEY,
  appendMessage,
  messagesForPlant,
  parseChatStore,
  removePlantChat,
  serializeChatStore,
  type ChatMessage,
  type ChatRole,
  type ChatStore,
} from "./chat-store";
import { newLocalId } from "./local-id";

/** Reads degrade to an empty conversation — a corrupt blob must not wedge the
 * screen. */
export async function loadChatStore(): Promise<ChatStore> {
  try {
    return parseChatStore(await AsyncStorage.getItem(CHAT_STORAGE_KEY));
  } catch (e) {
    console.error("[plant-chat-io] chat load failed:", (e as Error).message);
    return {};
  }
}

export async function saveChatStore(store: ChatStore): Promise<void> {
  await AsyncStorage.setItem(CHAT_STORAGE_KEY, serializeChatStore(store));
}

export async function loadPlantChat(plantId: string): Promise<ChatMessage[]> {
  return messagesForPlant(await loadChatStore(), plantId);
}

/** Append one message. Wired as runPlantChatTurn's `save` dep, where a throw is
 * caught and logged — the answer on screen is never lost to a store write. */
export async function appendChatMessage(message: {
  plantId: string;
  role: ChatRole;
  text: string;
}): Promise<void> {
  const store = await loadChatStore();
  await saveChatStore(
    appendMessage(store, {
      id: newLocalId(Date.now(), Math.random()),
      plantId: message.plantId,
      role: message.role,
      text: message.text,
      createdAt: new Date().toISOString(),
    }),
  );
}

/** Cascade on plant delete. */
export async function deletePlantChat(plantId: string): Promise<void> {
  await saveChatStore(removePlantChat(await loadChatStore(), plantId));
}
