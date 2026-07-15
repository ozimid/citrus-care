"use client";

import { useSyncExternalStore } from "react";
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
  const pref = useSyncExternalStore<ThemePreference>(
    subscribe,
    readStoredTheme,
    () => "system",
  );

  function select(next: ThemePreference) {
    applyTheme(next);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center rounded-full border bg-muted/40 p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = pref === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => select(value)}
            className={
              "flex size-6 items-center justify-center rounded-full transition-colors " +
              (active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
