// Owns the on-device engine's opt-in setting and, when enabled, the lazily
// mounted executorch session (D-15 Stage 2). Sits above the tabs so the model
// loads once and survives tab switches and the capture modal — Profile drives
// the toggle, ReviewScreen reads isReady()/generate() for the assess router.
//
// This file must NOT import react-native-executorch statically: the native
// runtime only exists in dev/EAS builds, so the session is a lazy import
// mounted only after opt-in (same discipline as ProfileScreen's spike row),
// wrapped in an error boundary so a missing native module degrades to
// "Setup failed" (retryable; assessments wait) instead of taking the app down.

import {
  Component,
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import {
  armLoadSentinel,
  clearLoadSentinel,
  loadLoadSentinel,
} from "../lib/local-engine-io";
import {
  DEFAULT_LOCAL_ENGINE_SETTINGS,
  localEngineState,
  shouldRouteLocal,
  type LocalEngineRuntime,
  type LocalEngineSettings,
  type LocalEngineState,
} from "../lib/local-engine";
import { loadLocalEngineSettings, saveLocalEngineSettings } from "../lib/local-engine-io";
import type { LocalGenerate } from "./LocalEngineSession";

const LocalEngineSession = lazy(() =>
  import("./LocalEngineSession").then((m) => ({ default: m.LocalEngineSession })),
);

interface LocalEngineContextValue {
  state: LocalEngineState;
  settings: LocalEngineSettings;
  setEnabled: (enabled: boolean) => void;
  /** Remount the session — retries a failed download/init. */
  retry: () => void;
  /** Stable + live: safe to call long after render (e.g. at the Analyze tap). */
  isReady: () => boolean;
  /** Rejects when the session isn't loaded. Serialized: the single native
   * session runs one request at a time (a diagnosis and a care-profile call
   * never overlap), FIFO. */
  generate: LocalGenerate;
  /** Interrupt the in-flight inference (assess flow's hard ceiling). No-op
   * when nothing is running. */
  interrupt: () => void;
}

const OFF_CONTEXT: LocalEngineContextValue = {
  state: { kind: "off" },
  settings: DEFAULT_LOCAL_ENGINE_SETTINGS,
  setEnabled: () => {},
  retry: () => {},
  isReady: () => false,
  generate: async () => {
    throw new Error("local engine not available");
  },
  interrupt: () => {},
};

const LocalEngineContext = createContext<LocalEngineContextValue>(OFF_CONTEXT);

/** Never throws when unwrapped: no provider simply means "no local engine",
 * a supported state — assess then surfaces its honest "not ready" error. */
export function useLocalEngine(): LocalEngineContextValue {
  return useContext(LocalEngineContext);
}

export function LocalEngineProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<LocalEngineSettings>(DEFAULT_LOCAL_ENGINE_SETTINGS);
  const [runtime, setRuntime] = useState<LocalEngineRuntime | null>(null);
  // P0 (S23): true when the previous model load killed the process (stale
  // sentinel). Blocks the auto-mount until the user explicitly retries.
  const [crashedLastLoad, setCrashedLastLoad] = useState(false);
  // Bumping remounts the session, which re-runs useLLM's load (retry path).
  const [session, setSession] = useState(0);
  const generateRef = useRef<LocalGenerate | null>(null);
  const interruptRef = useRef<(() => void) | null>(null);
  // Single-flight FIFO tail: the native session runs one generate at a time, so
  // every request chains behind the previous (a care-profile call and a
  // diagnosis call must not overlap on the one session).
  const generateTailRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    loadLocalEngineSettings()
      .then(setSettings)
      .catch((e) =>
        console.error("[LocalEngineProvider] settings load failed:", (e as Error).message),
      );
    // Read BEFORE any mount decision: a stale sentinel = last load crashed.
    loadLoadSentinel().then(setCrashedLastLoad);
  }, []);

  const state = localEngineState(settings, runtime, crashedLastLoad);

  // Screen-off suspends the app's network and kills the 1.3 GB model download
  // (user report 2026-07-16) — hold the screen awake for the download only.
  // Tagged so it can't fight other keep-awake users; best-effort on both ends.
  useEffect(() => {
    const TAG = "model-download";
    if (state.kind !== "downloading") return;
    activateKeepAwakeAsync(TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(TAG).catch(() => {});
    };
  }, [state.kind]);
  // Read by the router's isReady() at tap time, not at render time.
  const stateRef = useRef(state);
  stateRef.current = state;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const update = useCallback((next: LocalEngineSettings) => {
    setSettings(next);
    saveLocalEngineSettings(next).catch((e) =>
      console.error("[LocalEngineProvider] settings save failed:", (e as Error).message),
    );
  }, []);

  // Remember that the 1.3 GB landed on this phone: re-enabling later must not
  // warn about a download that won't happen.
  useEffect(() => {
    if (state.kind === "ready" && !settingsRef.current.downloaded) {
      update({ ...settingsRef.current, downloaded: true });
    }
  }, [state.kind, update]);

  const mountAllowed = settings.enabled && !crashedLastLoad;

  useEffect(() => {
    if (!mountAllowed) return;
    armLoadSentinel().catch((e) =>
      console.error("[LocalEngineProvider] sentinel arm failed:", (e as Error).message),
    );
  }, [mountAllowed, session]);

  useEffect(() => {
    if (runtime?.isReady || runtime?.error) {
      clearLoadSentinel().catch((e) =>
        console.error("[LocalEngineProvider] sentinel clear failed:", (e as Error).message),
      );
    }
  }, [runtime?.isReady, runtime?.error]);

  const clearSession = useCallback(() => {
    setRuntime(null);
    generateRef.current = null;
  }, []);

  const setEnabled = useCallback(
    (enabled: boolean) => {
      // Disabling keeps the downloaded files — it only unmounts the session
      // and stops the router from choosing it. Any explicit toggle is consent
      // to try again, so the crash block lifts.
      if (!enabled) clearSession();
      setCrashedLastLoad(false);
      if (!enabled) clearLoadSentinel().catch(() => {});
      update({ ...settingsRef.current, enabled });
    },
    [clearSession, update],
  );

  const retry = useCallback(() => {
    // Explicit retry lifts the crash block; the mount effect re-arms the
    // sentinel, so a second crash is caught the same way.
    setCrashedLastLoad(false);
    clearSession();
    setSession((s) => s + 1);
  }, [clearSession]);

  const value = useMemo<LocalEngineContextValue>(
    () => ({
      state,
      settings,
      setEnabled,
      retry,
      isReady: () => shouldRouteLocal(stateRef.current) && generateRef.current !== null,
      generate: (req) => {
        // Chain behind whatever is already running (FIFO single-flight). The
        // tail swallows errors so one failed request never wedges the queue.
        const run = generateTailRef.current.catch(() => {}).then(() => {
          const fn = generateRef.current;
          if (!fn) throw new Error("local engine session is not loaded");
          return fn(req);
        });
        generateTailRef.current = run.catch(() => {});
        return run;
      },
      interrupt: () => interruptRef.current?.(),
    }),
    [state, settings, setEnabled, retry],
  );

  const onGenerate = useCallback((fn: LocalGenerate | null) => {
    generateRef.current = fn;
  }, []);

  const onInterrupt = useCallback((fn: (() => void) | null) => {
    interruptRef.current = fn;
  }, []);

  const onSessionCrash = useCallback((e: Error) => {
    console.error("[LocalEngineProvider] session failed to mount:", e.message);
    // Surfaces as "Setup failed" — the honest state, and the router escalates.
    setRuntime({ isReady: false, downloadProgress: 0, error: e });
  }, []);

  return (
    <LocalEngineContext.Provider value={value}>
      {children}
      {mountAllowed && (
        // Headless and fallback-less: the session renders nothing, so there is
        // nothing to show while it loads — the Profile row reports progress.
        <SessionBoundary key={session} onError={onSessionCrash}>
          <Suspense fallback={null}>
            <LocalEngineSession
              onRuntime={setRuntime}
              onGenerate={onGenerate}
              onInterrupt={onInterrupt}
            />
          </Suspense>
        </SessionBoundary>
      )}
    </LocalEngineContext.Provider>
  );
}

/** The one thing hooks can't do: catch a lazy-import/native-module failure so
 * the missing runtime never reaches the user as a redbox. */
class SessionBoundary extends Component<
  { children: ReactNode; onError: (e: Error) => void },
  { crashed: boolean }
> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  render() {
    return this.state.crashed ? null : this.props.children;
  }
}
