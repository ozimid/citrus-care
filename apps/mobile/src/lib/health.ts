// Health-score bands. Thresholds MUST mirror apps/web/app/_lib/health-style.ts
// (<40 Poor, <70 Fair, >=70 Good) so a plant never shows a different band on
// mobile than on web. Colors follow the native design doc §5 token mapping
// (emerald brand / amber warning / red destructive, light+dark pairs).

export type HealthBandKey = "poor" | "fair" | "good";

export interface HealthBand {
  key: HealthBandKey;
  label: "Poor" | "Fair" | "Good";
}

export function healthBand(score: number): HealthBand {
  const s = Math.max(0, Math.min(100, score));
  if (s < 40) return { key: "poor", label: "Poor" };
  if (s < 70) return { key: "fair", label: "Fair" };
  return { key: "good", label: "Good" };
}

const BAND_COLORS: Record<HealthBandKey, { light: string; dark: string }> = {
  good: { light: "#059669", dark: "#34d399" },
  fair: { light: "#d97706", dark: "#fbbf24" },
  poor: { light: "#dc2626", dark: "#f87171" },
};

export function bandColor(key: HealthBandKey, scheme: "light" | "dark"): string {
  return BAND_COLORS[key][scheme];
}
