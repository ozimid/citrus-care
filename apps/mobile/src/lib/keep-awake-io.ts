// Thin expo-keep-awake side (pure/-io split; untested by policy, exercised via
// expo export). The ONE "hold the screen while the phone works" hook — assess,
// pruning, the model download, and each walk phase — so the tag discipline
// (one tag per flow, so releasing this hold never drops another's) lives in a
// single place instead of a copy per screen. Best-effort on both ends.

import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useEffect } from "react";

/** Hold the screen awake while `active` is true, under `tag`. */
export function useKeepAwakeWhile(active: boolean, tag: string): void {
  useEffect(() => {
    if (!active) return;
    activateKeepAwakeAsync(tag).catch(() => {});
    return () => {
      deactivateKeepAwake(tag).catch(() => {});
    };
  }, [active, tag]);
}
