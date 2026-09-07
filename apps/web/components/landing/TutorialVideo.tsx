"use client";

import { useId, useRef, useState, useSyncExternalStore } from "react";
import { Download, Play } from "lucide-react";

const VIDEO_SRC = "/media/citrus-care-tutorial-v1.mp4";
const POSTER_SRC = "/media/citrus-care-tutorial-v1.webp";
const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function TutorialVideo() {
  const id = useId();
  const videoRef = useRef<HTMLVideoElement>(null);
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const [activated, setActivated] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  function startVideo() {
    const video = videoRef.current;
    if (!video) return;

    setPlaybackError(null);
    // Assign the file and call play in the same user gesture. Keep src outside
    // React props so the activation render cannot reassign it and abort play.
    video.src = VIDEO_SRC;
    video.controls = true;
    video.tabIndex = 0;
    setActivated(true);
    video.focus({ preventScroll: true });

    const reportFailure = () => setPlaybackError(
      "We couldn’t start the video. Try the player’s play button or download the video below.",
    );
    try {
      void video.play().catch(reportFailure);
    } catch {
      reportFailure();
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0">
      <h2 id={`${id}-title`} className="text-3xl font-semibold leading-tight tracking-tight [overflow-wrap:anywhere] sm:text-4xl">
        Watch how to use Citrus Care
      </h2>
      <p className="mt-3 text-base leading-7 text-stone-600 dark:text-stone-300">
        A one-minute look inside the Android app. Add a plant, take a photo, and review its care record.
      </p>

      <div className="mx-auto mt-6 w-full max-w-[320px]">
        <div className="relative overflow-hidden rounded-[10px] border border-stone-200 bg-stone-950 dark:border-stone-700">
          <video
            ref={videoRef}
            aria-label="Citrus Care app tutorial"
            aria-describedby={playbackError ? `${id}-error` : undefined}
            width={1080}
            height={2392}
            poster={POSTER_SRC}
            preload="none"
            playsInline
            controls={activated}
            tabIndex={activated ? 0 : -1}
            onPlaying={() => setPlaybackError(null)}
            onError={() => setPlaybackError("We couldn’t load the video. You can download it below and try a video player on your device.")}
            className="block h-auto w-full focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-emerald-300"
          >
            {activated && (
              <track
                kind="subtitles"
                src="/media/citrus-care-tutorial-v1.vtt"
                srcLang="en"
                label="English — on-screen steps"
                default
              />
            )}
          </video>
          {!activated && (
            <div className="absolute inset-0 flex items-center justify-center bg-stone-950/15 p-2">
              <button
                type="button"
                disabled={!ready}
                onClick={startVideo}
                className="flex min-h-12 min-w-0 max-w-full flex-col items-center justify-center gap-2 rounded-[10px] bg-emerald-800 px-3 py-3 text-center text-base font-semibold text-white shadow-lg [overflow-wrap:anywhere] hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:cursor-wait disabled:opacity-70 sm:flex-row"
              >
                <Play className="size-5 shrink-0" aria-hidden="true" />
                <span>Play tutorial</span>
              </button>
            </div>
          )}
        </div>

        {playbackError && (
          <p id={`${id}-error`} role="status" className="mt-3 text-sm leading-6 text-stone-600 dark:text-stone-300">
            {playbackError}
          </p>
        )}
        <noscript>
          <p className="mt-3 text-sm leading-6 text-stone-600 dark:text-stone-300">
            Use Download video below to watch without JavaScript.
          </p>
        </noscript>
        <a
          href={VIDEO_SRC}
          download="citrus-care-tutorial-v1.mp4"
          className="mt-3 inline-flex min-h-11 max-w-full items-center gap-2 rounded-md py-2 text-sm font-medium text-emerald-800 underline underline-offset-4 [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700 dark:text-emerald-300 dark:focus-visible:outline-emerald-300"
        >
          <Download className="size-4 shrink-0" aria-hidden="true" />
          <span>Download video</span>
        </a>
        <p className="text-xs leading-5 text-stone-600 dark:text-stone-300">
          MP4 · 1:02 · 9.4 MB. Hosted on this site; loads only when you press Play or download it.
        </p>
      </div>
      <details className="mt-5 rounded-md border border-stone-200 px-4 dark:border-stone-700">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700 dark:focus-visible:outline-emerald-300">
          <h3 className="inline">Follow the recording</h3>
        </summary>
        <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-300">
          These written steps describe the screen recording. English on-screen steps are also available in the player’s subtitle menu.
        </p>
        <ol className="my-4 list-decimal space-y-3 pl-5 text-sm leading-6 text-stone-600 dark:text-stone-300">
          <li><strong>0:00 — Add a plant.</strong> Tap Add plant, choose Flower, and name it Rose 9. Fill in the optional location and ZIP code, then save.</li>
          <li><strong>0:23 — Take a photo.</strong> Open Assess, select Rose 9, and photograph the rose bush. Tap Analyze.</li>
          <li><strong>0:29 — Wait for the assessment.</strong> The app shows “Analyzing on this phone.” Processing time varies by device.</li>
          <li><strong>0:39 — Review the result.</strong> The recording shows a health score of 95, symptoms, likely causes, and suggested care. This is an example result, not a guarantee of accuracy.</li>
          <li><strong>0:46 — Open the plant record.</strong> Rose 9 has watering controls, plant information, and the saved assessment in its timeline.</li>
          <li><strong>0:54 — Return to your garden.</strong> Browse the plant list, open Orange #4, and refresh its plant information.</li>
        </ol>
        <p className="mb-4 text-xs leading-5 text-stone-600 dark:text-stone-300">
          Recorded on Android in August 2026. Screens may differ in newer versions. First-time setup instructions are below under Get the app.
        </p>
      </details>
    </section>
  );
}
