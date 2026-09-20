// Capture-screen flags, IO half (thin, untested by policy).
// F36 Snap Tips seen-flag: read degrades to TRUE (seen) and the write is
// best-effort — a broken storage layer must never turn the one-time guide
// into a permanent nag.
// F39 walk mode (D-W7): remembered across opens; read degrades to FALSE — a
// mode that changes what the shutter does must never switch itself on.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { SNAP_TIPS_SEEN_KEY, WALK_MODE_KEY } from "./capture-modes";

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

export async function loadWalkMode(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(WALK_MODE_KEY)) === "on";
  } catch (e) {
    console.error("[capture] walk-mode flag read failed:", (e as Error).message);
    return false;
  }
}

export async function saveWalkMode(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(WALK_MODE_KEY, on ? "on" : "off");
  } catch (e) {
    console.error("[capture] walk-mode flag save failed:", (e as Error).message);
  }
}
