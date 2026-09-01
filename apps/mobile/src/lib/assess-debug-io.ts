// #2 — the last diagnosis run's debug record (outcome + raw model text),
// mirroring prune-io's. Stays on the phone; leaves it only inside an email the
// user drafts themself. Thin by policy.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AssessDebugInfo } from "./assess";

const ASSESS_DEBUG_KEY = "citrus.assess-debug.v1";

export async function saveLastAssessDebug(info: AssessDebugInfo): Promise<void> {
  try {
    await AsyncStorage.setItem(ASSESS_DEBUG_KEY, JSON.stringify({ ...info, at: new Date().toISOString() }));
  } catch (e) {
    console.error("[assess-debug-io] save failed:", (e as Error).message);
  }
}

export async function loadLastAssessDebug(): Promise<(AssessDebugInfo & { at?: string }) | null> {
  try {
    const raw = await AsyncStorage.getItem(ASSESS_DEBUG_KEY);
    return raw ? (JSON.parse(raw) as AssessDebugInfo & { at?: string }) : null;
  } catch (e) {
    console.error("[assess-debug-io] load failed:", (e as Error).message);
    return null;
  }
}
