import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/app/_lib/supabase/server";
import { AssessmentCard } from "@/components/AssessmentCard";
import type { Assessment, Plant } from "@/app/_lib/types";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/app/_lib/date-utils";

export const dynamic = "force-dynamic";

export default async function AssessmentDetailPage({
  params,
}: {
  params: Promise<{ id: string; assessmentId: string }>;
}) {
  const { id, assessmentId } = await params;
  const supabase = await createClient();

  const [{ data: plantData }, { data: aRow }] = await Promise.all([
    supabase
      .from("plants")
      .select("id,user_id,name,plant_type,species,cultivar,location,cover_assessment_id,created_at")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("assessments")
      .select(
        "id,plant_id,user_id,photo_path,created_at,health_score,symptoms,diagnosis,recommendations,compared_to_assessment_id,raw_output,is_cut_care,cut_health_score",
      )
      .eq("id", assessmentId)
      .eq("plant_id", id)
      .maybeSingle(),
  ]);

  const plant = plantData as Plant | null;
  const assessment = aRow as Assessment | null;
  if (!plant || !assessment) notFound();

  const { data: signed } = await supabase.storage
    .from("photos")
    .createSignedUrl(assessment.photo_path, 60 * 60);

  return (
    <main className="space-y-6">
      <div className="space-y-1">
        <Link
          href={`/plants/${plant.id}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {plant.name}
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Assessment · {formatDate(assessment.created_at)}
          </h1>
          {assessment.is_cut_care && (
            <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
              Pruning Wound
            </Badge>
          )}
        </div>
      </div>

      <AssessmentCard assessment={assessment} photoUrl={signed?.signedUrl ?? null} />
    </main>
  );
}

