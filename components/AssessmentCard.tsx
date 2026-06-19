import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { healthBand } from "@/app/_lib/health-style";
import type { Assessment } from "@/app/_lib/types";

const severityTone: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-800",
};

const likelihoodTone = severityTone;

export function AssessmentCard({
  assessment,
  photoUrl,
}: {
  assessment: Assessment;
  photoUrl: string | null;
}) {
  const d = assessment.diagnosis;
  const band = healthBand(d.health_score);

  return (
    <Card className="overflow-hidden p-0">
      {photoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt="Plant photo"
          className="aspect-square w-full object-cover"
        />
      )}

      <div className="space-y-4 p-5">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {assessment.is_cut_care ? "Pruning Cut Health" : "Health"}
            </p>
            <p className={`text-3xl font-semibold ${band.color}`}>
              {d.health_score}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                / 100
              </span>
            </p>
          </div>

          <Badge className={`${band.bg} ${band.color}`}>{band.label}</Badge>
        </div>

        <p className="text-sm leading-relaxed">{d.summary}</p>

        {d.comparison && (
          <>
            <Separator />
            <Section title="Compared to last time">
              <p className="text-sm">
                <span className="font-medium capitalize">{d.comparison.delta}</span>{" "}
                — {d.comparison.notes}
              </p>
            </Section>
          </>
        )}

        {d.symptoms.length > 0 && (
          <>
            <Separator />
            <Section title="Symptoms">
              <ul className="space-y-2">
                {d.symptoms.map((s, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 rounded px-2 py-0.5 text-xs ${severityTone[s.severity]}`}
                    >
                      {s.severity}
                    </span>
                    <span className="text-sm">
                      {s.label}
                      {s.notes ? (
                        <span className="text-muted-foreground"> — {s.notes}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          </>
        )}

        {d.causes.length > 0 && (
          <>
            <Separator />
            <Section title="Likely causes">
              <ul className="space-y-2">
                {d.causes.map((c, i) => (
                  <li key={i} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${likelihoodTone[c.likelihood]}`}
                      >
                        {c.likelihood}
                      </span>
                      <span className="text-sm font-medium">{c.label}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{c.rationale}</p>
                  </li>
                ))}
              </ul>
            </Section>
          </>
        )}

        {d.recommendations.length > 0 && (
          <>
            <Separator />
            <Section title="What to do">
              <ol className="space-y-2">
                {d.recommendations
                  .slice()
                  .sort((a, b) => a.priority - b.priority)
                  .map((r, i) => (
                    <li key={i} className="rounded-md bg-muted/40 p-3">
                      <p className="text-sm font-medium">
                        {r.priority}. {r.action}
                      </p>
                      <p className="text-sm text-muted-foreground">{r.detail}</p>
                    </li>
                  ))}
              </ol>
            </Section>
          </>
        )}
      </div>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}
