export function formatDate(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "Unknown date";

  // Format: "Jun 18, 2026"
  const formatted = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const now = new Date();
  const diffTime = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays >= 0 && diffDays < 30) {
    if (diffDays === 0) {
      return `${formatted} (today)`;
    } else if (diffDays === 1) {
      return `${formatted} (1 day ago)`;
    } else {
      return `${formatted} (${diffDays} days ago)`;
    }
  }

  return formatted;
}
