import Link from "next/link";
import { Card } from "@/components/ui/card";
import { healthBand } from "@/app/_lib/health-style";

export interface TimelineItem {
  id: string;
  tree_id: string;
  created_at: string;
  health_score: number;
  summary: string;
  thumbnailUrl: string | null;
}

export function AssessmentTimeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-sm font-medium">No assessments yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Capture your first photo to see this tree&apos;s health history here.
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
              href={`/trees/${it.tree_id}/assessments/${it.id}`}
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
                    <p className="text-sm font-medium">
                      {new Date(it.created_at).toLocaleDateString()}
                    </p>
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
