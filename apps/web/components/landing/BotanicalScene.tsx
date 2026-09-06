"use client";

import Image from "next/image";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import styles from "./BotanicalScene.module.css";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeToMotion(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const preference = window.matchMedia(reducedMotionQuery);
  preference.addEventListener("change", onChange);
  return () => preference.removeEventListener("change", onChange);
}

function prefersReducedMotion() {
  return typeof window.matchMedia !== "function" || window.matchMedia(reducedMotionQuery).matches;
}

const clamp = (value: number) => Math.max(-1, Math.min(1, value));

export function BotanicalScene() {
  const sceneRef = useRef<HTMLElement>(null);
  const [paused, setPaused] = useState(false);
  // A still image is the safe server/no-JavaScript default.
  const reducedMotion = useSyncExternalStore(subscribeToMotion, prefersReducedMotion, () => true);
  const motionEnabled = !paused && !reducedMotion;

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !motionEnabled) return;

    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;
    let visible = true;

    function paint() {
      frame = 0;
      if (!visible || document.hidden) return;
      const bounds = scene!.getBoundingClientRect();
      if (bounds.bottom < 0 || bounds.top > window.innerHeight) return;
      const scroll = clamp((window.innerHeight * 0.5 - bounds.top - bounds.height * 0.5) / window.innerHeight);
      scene!.style.setProperty("--scene-x", pointerX.toFixed(3));
      scene!.style.setProperty("--scene-y", pointerY.toFixed(3));
      scene!.style.setProperty("--scene-scroll", scroll.toFixed(3));
    }

    function schedulePaint() {
      // Event-driven: no animation loop while the page is idle or offscreen.
      if (!frame && visible && !document.hidden) frame = requestAnimationFrame(paint);
    }

    function move(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      const bounds = scene!.getBoundingClientRect();
      pointerX = clamp(((event.clientX - bounds.left) / bounds.width - 0.5) * 2);
      pointerY = clamp(((event.clientY - bounds.top) / bounds.height - 0.5) * 2);
      schedulePaint();
    }

    function resetPointer() {
      pointerX = 0;
      pointerY = 0;
      schedulePaint();
    }

    function visibilityChanged() {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else {
        schedulePaint();
      }
    }

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) schedulePaint();
    });
    observer.observe(scene);
    scene.addEventListener("pointermove", move, { passive: true });
    scene.addEventListener("pointerleave", resetPointer);
    window.addEventListener("scroll", schedulePaint, { passive: true });
    window.addEventListener("resize", schedulePaint);
    document.addEventListener("visibilitychange", visibilityChanged);
    schedulePaint();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scene.removeEventListener("pointermove", move);
      scene.removeEventListener("pointerleave", resetPointer);
      window.removeEventListener("scroll", schedulePaint);
      window.removeEventListener("resize", schedulePaint);
      document.removeEventListener("visibilitychange", visibilityChanged);
      for (const property of ["--scene-x", "--scene-y", "--scene-scroll"]) {
        scene.style.removeProperty(property);
      }
    };
  }, [motionEnabled]);

  return (
    <figure ref={sceneRef} aria-label="Plant care illustration" data-motion={motionEnabled ? "on" : "off"} className={styles.scene}>
      <div className={styles.backplate} aria-hidden="true" />
      <div className={styles.frame}>
        <div className={styles.photoWindow}>
          <Image
            src="/landing-citrus-assessment.png"
            alt="Illustration of a phone showing plant care beside citrus leaves and pruning tools"
            fill
            preload
            sizes="(min-width: 1024px) 500px, (min-width: 640px) 540px, 100vw"
            className={styles.photo}
          />
        </div>
      </div>
      <button
        type="button"
        aria-label="Image motion"
        aria-pressed={motionEnabled}
        disabled={reducedMotion}
        title={reducedMotion ? "Image motion follows your reduced-motion setting" : motionEnabled ? "Pause image motion" : "Enable image motion"}
        onClick={() => setPaused((current) => !current)}
        className={styles.motionToggle}
      >
        {motionEnabled ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
      </button>
      <figcaption className={styles.caption}>Illustrative walkthrough</figcaption>
    </figure>
  );
}
