// Owns the on-device engine's opt-in setting and, when enabled, the lazily
// mounted executorch session (D-15 Stage 2). Sits above the tabs so the model
// loads once and survives tab switches and the capture modal — Profile drives
// the toggle, ReviewScreen reads isReady()/generate() for the assess router,
// and a batch runner (F39) reads whenIdle() to wait out the FIFO tail.
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
import { useKeepAwakeWhile } from "../lib/keep-awake-io";
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
import { DEFAULT_MODEL_ID, type ModelId } from "../lib/model-catalogue";
import {
  downloadedModelIds,
  resolveStartupModel,
  saveModelChoice,
} from "../lib/model-choice-io";
import type { LocalGenerate } from "./LocalEngineSession";

/** How long a model switch waits for an interrupted generation to return
 * before remounting anyway. The interrupt lands in well under a second in
 * practice; this is only the ceiling that keeps the control from hanging. */
const SWITCH_DRAIN_MS = 2000;

const LocalEngineSession = lazy(() =>
  import("./LocalEngineSession").then((m) => ({ default: m.LocalEngineSession })),
);

export interface LocalEngineContextValue {
  state: LocalEngineState;
  settings: LocalEngineSettings;
  /** F40 — the model this phone runs. Resolved once at startup: an explicit
   * choice, else whatever weights are already here (a pre-F40 Gemma install
   * keeps Gemma), else the catalogue's default. */
  modelId: ModelId;
  /** False until resolveStartupModel() has answered — `modelId` is a DEFAULT
   * placeholder in that window, so nothing may persist it as a choice. A
   * pre-F40 Gemma user who taps the toggle then would be switched to the light
   * model for good: an explicit stored choice beats the on-disk inference on
   * every later launch. Controls that commit a model gate on this. */
  modelResolved: boolean;
  /** Switch models: persists the choice and remounts the session on the new
   * one. The old model's files stay on the phone until they are deleted. */
  setModelId: (id: ModelId) => void;
  /** Which models have weights on this phone — what makes "download" vs
   * "already here" honest, per model. Best-effort: [] when the read fails. */
  downloadedIds: ModelId[];
  /** Re-read the weights on disk (after a download or a delete). */
  refreshDownloaded: () => void;
  setEnabled: (enabled: boolean) => void;
  /** Remount the session — retries a failed download/init. */
  retry: () => void;
  /** Stable + live: safe to call long after render (e.g. at the Analyze tap). */
  isReady: () => boolean;
  /** Rejects when the session isn't loaded. Serialized: the single native
   * session runs one request at a time (a diagnosis and a care-profile call
   * never overlap), FIFO.
   *
   * INVARIANT for every caller: run the call under withInferenceBudget with the
   * shared LOCAL_HARD_CEILING_MS. Each request's clock starts when it is
   * ENQUEUED, so with equal ceilings the earliest one always expires first —
   * and the earliest is always the one currently running, so interrupt() can
   * only ever hit its own request. A caller that skips the budget can hold the
   * session past another request's ceiling and take an interrupt meant for
   * itself. (care-profile-io was that caller until 2026-08-31.) */
  generate: LocalGenerate;
  /** Interrupt the in-flight inference (assess flow's hard ceiling). No-op
   * when nothing is running. */
  interrupt: () => void;
  /** Resolves once every request enqueued so far has settled — fulfilled,
   * rejected or interrupted. The read side of the same FIFO: a batch runner
   * awaits it before its first item and after any timeout, because an
   * interrupt() only makes the native generate() return once it honours the
   * stop, so the next item's clock must not start while a killed request may
   * still hold the session (F39 / D-W5). Never rejects. */
  whenIdle: () => Promise<void>;
}

const OFF_CONTEXT: LocalEngineContextValue = {
  state: { kind: "off" },
  settings: DEFAULT_LOCAL_ENGINE_SETTINGS,
  modelId: DEFAULT_MODEL_ID,
  // No provider = no engine: there is no resolved model, and nothing here can
  // commit one, so the controls that would gate on this stay disabled.
  modelResolved: false,
  setModelId: () => {},
  downloadedIds: [],
  refreshDownloaded: () => {},
  setEnabled: () => {},
  retry: () => {},
  isReady: () => false,
  generate: async () => {
    throw new Error("local engine not available");
  },
  interrupt: () => {},
  whenIdle: () => Promise.resolve(),
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
  // null until resolveStartupModel() answers — the session must not mount on a
  // guess, or a pre-F40 Gemma phone would start re-downloading the other model.
  const [modelId, setModelIdState] = useState<ModelId | null>(null);
  const [downloadedIds, setDownloadedIds] = useState<ModelId[]>([]);
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

  const refreshDownloaded = useCallback(() => {
    downloadedModelIds()
      .then(setDownloadedIds)
      .catch((e) =>
        console.error("[LocalEngineProvider] weights listing failed:", (e as Error).message),
      );
  }, []);

  useEffect(() => {
    loadLocalEngineSettings()
      .then(setSettings)
      .catch((e) =>
        console.error("[LocalEngineProvider] settings load failed:", (e as Error).message),
      );
    // Read BEFORE any mount decision: a stale sentinel = last load crashed.
    loadLoadSentinel().then(setCrashedLastLoad);
    // Likewise BEFORE any mount: which model this phone runs (F40).
    resolveStartupModel()
      .then(setModelIdState)
      .catch((e) => {
        console.error("[LocalEngineProvider] model choice load failed:", (e as Error).message);
        setModelIdState(DEFAULT_MODEL_ID);
      });
    refreshDownloaded();
  }, [refreshDownloaded]);

  const state = localEngineState(settings, runtime, crashedLastLoad);

  // Screen-off suspends the app's network and kills a multi-gigabyte model
  // download (user report 2026-07-16) — hold the screen awake for it only.
  useKeepAwakeWhile(state.kind === "downloading", "model-download");
  // Read by the router's isReady() at tap time, not at render time.
  const stateRef = useRef(state);
  stateRef.current = state;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const modelIdRef = useRef(modelId);
  modelIdRef.current = modelId;

  const update = useCallback((next: LocalEngineSettings) => {
    setSettings(next);
    saveLocalEngineSettings(next).catch((e) =>
      console.error("[LocalEngineProvider] settings save failed:", (e as Error).message),
    );
  }, []);

  // Remember that a model landed on this phone: re-enabling later must not
  // warn about a download that won't happen. Per-model truth lives in
  // downloadedIds (re-read the moment a session reports ready); this flag is
  // kept for the pre-F40 installs whose only model was Gemma.
  useEffect(() => {
    if (state.kind !== "ready") return;
    if (!settingsRef.current.downloaded) update({ ...settingsRef.current, downloaded: true });
    refreshDownloaded();
  }, [state.kind, update, refreshDownloaded]);

  // Never mount on a guessed model (F40): a pre-F40 Gemma phone would start
  // downloading the other one before resolveStartupModel() could answer.
  const mountAllowed = settings.enabled && !crashedLastLoad && modelId !== null;

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
      // Turning it on commits to a model: whatever is about to be downloaded
      // becomes the stored choice, so the next launch never has to infer it.
      // But NOT while the startup resolve is still in flight — modelId is a
      // placeholder default then, and persisting it would silently switch a
      // pre-F40 Gemma phone to the light model (a stored choice outranks the
      // on-disk inference for ever after). The resolved value gets persisted
      // by the next explicit action; the UI gates on `modelResolved` too.
      if (enabled && modelIdRef.current !== null) {
        saveModelChoice(modelIdRef.current).catch((e) =>
          console.error("[LocalEngineProvider] model choice save failed:", (e as Error).message),
        );
      }
      update({ ...settingsRef.current, enabled });
    },
    [clearSession, update],
  );

  /** Switch models. Persists first (so a crash mid-switch still lands on the
   * model the user picked), then remounts the session — the old one is torn
   * down by the key change, exactly like retry(). The previous model's files
   * are left alone: Profile → Free up space is the only thing that deletes.
   *
   * The remount must NOT happen under a running generation. The key change
   * unmounts LocalEngineSession, useLLM's cleanup calls controller.delete(),
   * and delete() THROWS while the native model is generating ("You cannot
   * delete the model now. You need to interrupt it first.") — from a commit-
   * phase cleanup, with the boundary itself being torn down. Background
   * generation is reachable from a screen the user can leave (the care-profile
   * call), so this is not hypothetical. Interrupt, let the FIFO tail settle,
   * then swap — and give the new session a FRESH tail, or its first request
   * would queue behind the abandoned promise for ever. */
  const setModelId = useCallback(
    (id: ModelId) => {
      saveModelChoice(id).catch((e) =>
        console.error("[LocalEngineProvider] model choice save failed:", (e as Error).message),
      );
      if (modelIdRef.current === id) return;
      // Claimed immediately so a second tap can't queue a second swap.
      modelIdRef.current = id;
      interruptRef.current?.();
      const settled = generateTailRef.current.then(
        () => undefined,
        () => undefined,
      );
      const swap = () => {
        generateTailRef.current = Promise.resolve();
        setModelIdState(id);
        setCrashedLastLoad(false);
        clearSession();
        setSession((s) => s + 1);
      };
      // Bounded wait: an interrupt only makes the native call return once it
      // honours the stop. If it never does, the switch still has to happen —
      // a control that silently does nothing is worse than the rare throw the
      // boundary already catches.
      void Promise.race([
        settled,
        new Promise<void>((resolve) => setTimeout(resolve, SWITCH_DRAIN_MS)),
      ]).then(swap);
    },
    [clearSession],
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
      modelId: modelId ?? DEFAULT_MODEL_ID,
      modelResolved: modelId !== null,
      setModelId,
      downloadedIds,
      refreshDownloaded,
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
      // The tail already swallows errors; settle to void either way.
      whenIdle: () => generateTailRef.current.then(() => undefined, () => undefined),
    }),
    [state, settings, modelId, setModelId, downloadedIds, refreshDownloaded, setEnabled, retry],
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
      {mountAllowed && modelId !== null && (
        // Headless and fallback-less: the session renders nothing, so there is
        // nothing to show while it loads — the Profile row reports progress.
        // The model id is part of the key: switching models tears the old
        // session down and builds a new one, never swaps weights underneath a
        // live one — setModelId interrupts and drains the FIFO tail before it
        // lets the key change, so the unmount never meets a running generate.
        <SessionBoundary key={`${modelId}:${session}`} onError={onSessionCrash}>
          <Suspense fallback={null}>
            <LocalEngineSession
              modelId={modelId}
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
