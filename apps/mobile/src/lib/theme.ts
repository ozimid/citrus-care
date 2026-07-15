// Visual tokens per the native design doc §5 (carry-over from
// apps/web/app/globals.css): neutral canvas, emerald brand, 10pt radius,
// light + dark from day one.

import { useColorScheme } from "react-native";

export interface Tokens {
  canvas: string;
  card: string;
  border: string;
  text: string;
  sub: string;
  green: string;
  onGreen: string;
  danger: string;
}

export const themes: Record<"light" | "dark", Tokens> = {
  light: {
    canvas: "#eef0ed",
    card: "#ffffff",
    border: "#dfe3dd",
    text: "#191c19",
    sub: "#5c635c",
    green: "#059669",
    onGreen: "#ffffff",
    danger: "#dc2626",
  },
  dark: {
    canvas: "#0d0f0d",
    card: "#161a16",
    border: "#262b26",
    text: "#f1f3f0",
    sub: "#a7ada5",
    green: "#34d399",
    onGreen: "#06281b",
    danger: "#f87171",
  },
};

export const RADIUS = 10;

export function useTheme(): { t: Tokens; scheme: "light" | "dark" } {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return { t: themes[scheme], scheme };
}
