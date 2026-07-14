export interface HealthBand {
  label: "Poor" | "Fair" | "Good";
  color: string;
  bg: string;
}

export function healthBand(score: number): HealthBand {
  const s = Math.max(0, Math.min(100, score));
  if (s < 40) return { label: "Poor", color: "text-red-700", bg: "bg-red-100" };
  if (s < 70) return { label: "Fair", color: "text-amber-700", bg: "bg-amber-100" };
  return { label: "Good", color: "text-emerald-700", bg: "bg-emerald-100" };
}
