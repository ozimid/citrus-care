// Thin react-native side of theme.ts (pure/-io split): resolves the OS color
// scheme into the token set. Untested by policy — exercised via expo export.

import { useColorScheme } from "react-native";
import { themes, type Tokens } from "./theme";

export function useTheme(): { t: Tokens; scheme: "light" | "dark" } {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return { t: themes[scheme], scheme };
}
