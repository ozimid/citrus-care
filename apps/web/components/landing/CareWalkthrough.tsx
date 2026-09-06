"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Camera, Droplets, Leaf } from "lucide-react";
import { BotanicalScene } from "./BotanicalScene";

const steps = ["Photo", "Insights", "Progress"] as const;

export function CareWalkthrough() {
  const [activeStep, setActiveStep] = useState(0);
  const id = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % steps.length;
        break;
      case "ArrowLeft":
        next = (index + steps.length - 1) % steps.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = steps.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    setActiveStep(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="overflow-hidden rounded-[10px] border border-stone-200 bg-[#fffdf8] shadow-xl shadow-emerald-950/5 dark:border-stone-700 dark:bg-[#1c241e]">
      <BotanicalScene />

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300">
            <Leaf className="size-4" aria-hidden="true" />
          </span>
          <p className="text-sm font-semibold">Meyer lemon</p>
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400">Sample plant</p>
      </div>

      <div
        role="tablist"
        aria-label="Explore the care loop"
        className="mx-4 grid grid-cols-[repeat(3,minmax(0,1fr))] rounded-[10px] border border-stone-200 bg-stone-100/80 p-1 dark:border-stone-700 dark:bg-stone-900/60 sm:mx-5"
      >
        {steps.map((step, index) => (
          <button
            key={step}
            ref={(element) => { tabRefs.current[index] = element; }}
            type="button"
            role="tab"
            id={`${id}-tab-${index}`}
            aria-controls={`${id}-panel-${index}`}
            aria-selected={activeStep === index}
            tabIndex={activeStep === index ? 0 : -1}
            onClick={() => setActiveStep(index)}
            onKeyDown={(event) => navigateTabs(event, index)}
            className="min-h-11 min-w-0 cursor-pointer rounded-[6px] px-1 py-2 text-sm font-medium text-stone-600 [overflow-wrap:anywhere] transition-colors hover:text-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 aria-selected:bg-white aria-selected:text-emerald-800 aria-selected:shadow-sm dark:text-stone-400 dark:hover:text-emerald-200 dark:focus-visible:outline-emerald-300 dark:aria-selected:bg-stone-700 dark:aria-selected:text-emerald-200"
          >
            {step}
          </button>
        ))}
      </div>

      {/* Shared grid cell reserves the tallest panel's natural height, including
          enlarged text. Invisible panels still size the grid but stay inert. */}
      <div className="grid min-w-0">
        {steps.map((step, index) => (
          <div
            key={step}
            role="tabpanel"
            id={`${id}-panel-${index}`}
            aria-labelledby={`${id}-tab-${index}`}
            aria-hidden={activeStep !== index}
            inert={activeStep !== index}
            tabIndex={activeStep === index ? 0 : -1}
            className={`col-start-1 row-start-1 min-h-[236px] min-w-0 p-4 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-emerald-700 dark:focus-visible:outline-emerald-300 sm:p-5 ${activeStep === index ? "visible" : "invisible"}`}
          >
            <div className={activeStep === index ? "care-demo-panel" : undefined}>
              {index === 0 && (
                <>
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">01 / Notice something different</p>
                  <h2 className="mt-2 text-xl font-semibold tracking-tight">Start with a photo</h2>
                  <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-300">
                    A yellowing leaf. A new spot. Capture what you see and keep a record for this plant.
                  </p>
                  <div className="mt-4 flex items-center gap-3 rounded-[10px] border border-stone-200 bg-white/60 px-3 py-3 dark:border-stone-700 dark:bg-white/5">
                    <Camera className="size-5 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
                    <p className="text-sm text-stone-600 dark:text-stone-300">Your photos stay on your phone.</p>
                  </div>
                </>
              )}
              {index === 1 && (
                <>
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">02 / Sample insight</p>
                  <h2 className="mt-2 text-xl font-semibold tracking-tight">Understand the likely causes</h2>
                  <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-300">
                    Yellowing has several possible causes. Use the suggestions as a starting point for a closer look.
                  </p>
                  <div className="mt-4 flex items-center gap-3 rounded-[10px] border border-emerald-200 bg-emerald-50 px-3 py-3 dark:border-emerald-800 dark:bg-emerald-400/5">
                    <Droplets className="size-5 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
                    <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">Check soil moisture first.</p>
                  </div>
                </>
              )}
              {index === 2 && (
                <>
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">03 / A record to return to</p>
                  <h2 className="mt-2 text-xl font-semibold tracking-tight">See what changes over time</h2>
                  <div className="mt-3 rounded-[10px] border border-stone-200 bg-white/60 px-3 py-2 dark:border-stone-700 dark:bg-white/5">
                    <p className="text-xs text-stone-600 dark:text-stone-300">Sample scores: <span className="font-semibold text-emerald-800 dark:text-emerald-200">48 → 62 → 76</span></p>
                    <svg viewBox="0 0 320 54" aria-hidden="true" className="mt-1 h-12 w-full overflow-visible text-emerald-600 dark:text-emerald-300">
                      <path d="M12 46H308" fill="none" stroke="currentColor" strokeOpacity="0.15" />
                      <path d="M12 42L160 26L308 10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" pathLength="1" className={activeStep === index ? "care-demo-trend" : undefined} />
                      <g fill="currentColor">
                        <circle cx="12" cy="42" r="3.5" />
                        <circle cx="160" cy="26" r="3.5" />
                        <circle cx="308" cy="10" r="3.5" />
                      </g>
                    </svg>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-stone-500 dark:text-stone-400">
                    Example only. Actual trends may go up or down.
                  </p>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
