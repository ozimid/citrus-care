import { notFound } from "next/navigation";
import { createClient } from "@/app/_lib/supabase/server";
import { AssessClient } from "./assess-client";
import type { Tree } from "@/app/_lib/types";

export const dynamic = "force-dynamic";

export default async function AssessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("trees")
    .select("id,user_id,name,cultivar,location,cover_assessment_id,created_at")
    .eq("id", id)
    .maybeSingle();

  const tree = data as Tree | null;
  if (!tree) notFound();

  return (
    <main className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Assess {tree.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          Aim for a single leaf or a small cluster in good daylight. The AI
          weighs symptom location (old vs new leaves) and pattern before
          recommending.
        </p>
      </div>

      <AssessClient treeId={tree.id} />
    </main>
  );
}
