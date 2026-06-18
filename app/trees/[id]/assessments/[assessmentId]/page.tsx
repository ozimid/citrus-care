import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/app/_lib/supabase/server";
import { AssessmentCard } from "@/components/AssessmentCard";
import type { Assessment, Tree } from "@/app/_lib/types";

export const dynamic = "force-dynamic";

export default async function AssessmentDetailPage({
  params,
}: {
  params: Promise<{ id: string; assessmentId: string }>;
}) {
  const { id, assessmentId } = await params;
  const supabase = await createClient();

  const [{ data: treeData }, { data: aRow }] = await Promise.all([
    supabase
      .from("trees")
      .select("id,user_id,name,cultivar,location,cover_assessment_id,created_at")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("assessments")
      .select(
        "id,tree_id,user_id,photo_path,created_at,health_score,symptoms,diagnosis,recommendations,compared_to_assessment_id,raw_output",
      )
      .eq("id", assessmentId)
      .eq("tree_id", id)
      .maybeSingle(),
  ]);

  const tree = treeData as Tree | null;
  const assessment = aRow as Assessment | null;
  if (!tree || !assessment) notFound();

  const { data: signed } = await supabase.storage
    .from("photos")
    .createSignedUrl(assessment.photo_path, 60 * 60);

  return (
    <main className="space-y-6">
      <div className="space-y-1">
        <Link
          href={`/trees/${tree.id}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {tree.name}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Assessment · {new Date(assessment.created_at).toLocaleDateString()}
        </h1>
      </div>

      <AssessmentCard assessment={assessment} photoUrl={signed?.signedUrl ?? null} />
    </main>
  );
}
