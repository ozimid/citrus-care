// F36 Snap Tips seen-flag, IO half (thin, untested by policy). Read degrades
// to TRUE (seen) and the write is best-effort — a broken storage layer must
// never turn the one-time guide into a permanent nag.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { SNAP_TIPS_SEEN_KEY } from "./capture-modes";

export async function loadSnapTipsSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SNAP_TIPS_SEEN_KEY)) !== null;
  } catch (e) {
    console.error("[capture] snap-tips flag read failed:", (e as Error).message);
    return true;
  }
}

export async function markSnapTipsSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(SNAP_TIPS_SEEN_KEY, new Date().toISOString());
  } catch (e) {
    console.error("[capture] snap-tips flag save failed:", (e as Error).message);
  }
}
