"use client";

import { useRef, useSyncExternalStore, type KeyboardEvent } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  applyTheme,
  readStoredTheme,
  type ThemePreference,
} from "@/app/_lib/theme";

const OPTIONS: {
  value: ThemePreference;
  label: string;
  Icon: typeof Sun;
}[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "system", label: "System", Icon: Monitor },
  { value: "dark", label: "Dark", Icon: Moon },
];

const THEME_CHANGE_EVENT = "citrus:themechange";

// The stored preference is external state that differs between server and
// client; useSyncExternalStore reads it without a hydration mismatch. Live OS
// changes and no-flash init are handled by the inline script in app/layout.tsx.
function subscribe(onChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function ThemeToggle() {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const pref = useSyncExternalStore<ThemePreference>(
    subscribe,
    readStoredTheme,
    () => "system",
  );

  function select(next: ThemePreference) {
    applyTheme(next);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (index + 1) % OPTIONS.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (index - 1 + OPTIONS.length) % OPTIONS.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = OPTIONS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    select(OPTIONS[nextIndex].value);
    buttons.current[nextIndex]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center rounded-full border bg-muted/40 p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }, index) => {
        const active = pref === value;
        return (
          <button
            key={value}
            ref={(button) => {
              buttons.current[index] = button;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            tabIndex={active ? 0 : -1}
            onClick={() => select(value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={
              "flex size-11 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 dark:focus-visible:outline-emerald-300 motion-reduce:transition-none " +
              (active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            <Icon className="size-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
