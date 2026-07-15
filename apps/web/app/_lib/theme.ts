export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "theme";

/** Browser-chrome tint (mobile status bar) per resolved theme. Light keeps the historical amber. */
export const THEME_COLOR = { light: "#fef3c7", dark: "#0a0a0a" } as const;

/**
 * Decide whether the `.dark` class should be applied, given the stored
 * preference and whether the OS currently prefers dark. Kept as a pure
 * function so the no-flash inline script and the runtime toggle stay in sync.
 */
export function resolveIsDark(
  stored: string | null,
  systemPrefersDark: boolean,
): boolean {
  if (stored === "dark") return true;
  if (stored === "light") return false;
  return systemPrefersDark; // "system" or unset → follow the OS
}

export function readStoredTheme(): ThemePreference {
  try {
    const t = localStorage.getItem(THEME_STORAGE_KEY);
    if (t === "light" || t === "dark" || t === "system") return t;
  } catch {
    // localStorage can throw (private mode / disabled) — fall through
  }
  return "system";
}

function ensureThemeColorMeta(): HTMLMetaElement {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  return meta;
}

/** Apply a preference to the document: toggle `.dark`, sync the theme-color meta, persist the choice. */
export function applyTheme(pref: ThemePreference): void {
  const systemPrefersDark = window.matchMedia(
    "(prefers-color-scheme: dark)",
  ).matches;
  const isDark = resolveIsDark(pref, systemPrefersDark);
  document.documentElement.classList.toggle("dark", isDark);
  ensureThemeColorMeta().setAttribute(
    "content",
    isDark ? THEME_COLOR.dark : THEME_COLOR.light,
  );
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // ignore persistence failures
  }
}
