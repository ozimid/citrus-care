// Storage budget, IO half (F39 / D-W17): how many bytes this app's records
// occupy in AsyncStorage. Android's default AsyncStorage database is 6 MB and
// every store here is one whole-blob JSON, so the pure storage-budget.ts turns
// this number into the Profile line and the "Analyze now" guard. Thin and
// untested by policy; degrades to 0 — a failed measurement never blocks a
// screen.

import AsyncStorage from "@react-native-async-storage/async-storage";

const RECORD_KEY_PREFIX = "citrus.";

/** UTF-8 byte length when the runtime can say so, else the JS length (a lower
 * bound — record JSON is overwhelmingly ASCII). */
function byteLength(value: string): number {
  return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(value).length : value.length;
}

/** Sum of the stored values under every `citrus.` key. */
export async function measureRecordBytes(): Promise<number> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(RECORD_KEY_PREFIX));
    if (keys.length === 0) return 0;
    const pairs = await AsyncStorage.multiGet(keys);
    let total = 0;
    for (const [, value] of pairs) {
      if (typeof value === "string") total += byteLength(value);
    }
    return total;
  } catch (e) {
    console.error("[storage-budget-io] record measurement failed:", (e as Error).message);
    return 0;
  }
}
