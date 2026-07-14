import Link from "next/link";
import { Card } from "@/components/ui/card";
import { healthBand } from "@/app/_lib/health-style";
import { formatDate } from "@/app/_lib/date-utils";

export interface TimelineItem {
  id: string;
  plant_id: string;
  created_at: string;
  health_score: number;
  summary: string;
  thumbnailUrl: string | null;
  comparisonDelta?: "better" | "same" | "worse" | "unknown" | null;
}

const getDeltaBadge = (delta: string) => {
  switch (delta) {
    case "better":
      return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/10">🟢 Better</span>;
    case "same":
      return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/10">🟡 Same</span>;
    case "worse":
      return <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/10">🔴 Worse</span>;
    case "unknown":
    default:
      return <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10">⚪ Unknown</span>;
  }
};

export function AssessmentTimeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-sm font-medium">No assessments yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Capture your first photo to see this plant&apos;s health history here.
        </p>
      </Card>
    );
  }

  return (
    <ol className="space-y-3">
      {items.map((it, idx) => {
        const band = healthBand(it.health_score);
        const prev = items[idx + 1];
        const delta = prev ? it.health_score - prev.health_score : null;
        return (
          <li key={it.id}>
            <Link
              href={`/plants/${it.plant_id}/assessments/${it.id}`}
              className="block"
            >
              <Card className="flex items-center gap-4 overflow-hidden p-3 transition-colors hover:bg-muted/30">
                {it.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.thumbnailUrl}
                    alt=""
                    className="size-16 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <div className="size-16 shrink-0 rounded-md bg-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">
                        {formatDate(it.created_at)}
                      </p>
                      {it.comparisonDelta && getDeltaBadge(it.comparisonDelta)}
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className={`text-sm font-semibold ${band.color}`}>
                        {it.health_score}
                      </span>
                      {delta !== null && delta !== 0 && (
                        <span
                          className={`text-xs ${delta > 0 ? "text-emerald-700" : "text-red-700"}`}
                        >
                          {delta > 0 ? "+" : ""}
                          {delta}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {it.summary}
                  </p>
                </div>
              </Card>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

