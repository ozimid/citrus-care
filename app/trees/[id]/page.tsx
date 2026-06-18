import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/app/_lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import {
  AssessmentTimeline,
  type TimelineItem,
} from "@/components/AssessmentTimeline";
import type { Tree } from "@/app/_lib/types";

export const dynamic = "force-dynamic";

interface TimelineRow {
  id: string;
  created_at: string;
  health_score: number;
  photo_path: string;
  diagnosis: { summary?: string } | null;
}

export default async function TreeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: treeRow } = await supabase
    .from("trees")
    .select("id,user_id,name,cultivar,location,cover_assessment_id,created_at")
    .eq("id", id)
    .maybeSingle();
  const tree = treeRow as Tree | null;
  if (!tree) notFound();

  const { data: rows } = await supabase
    .from("assessments")
    .select("id,created_at,health_score,photo_path,diagnosis")
    .eq("tree_id", id)
    .order("created_at", { ascending: false });

  const assessments = (rows ?? []) as TimelineRow[];

  const items: TimelineItem[] = await Promise.all(
    assessments.map(async (a) => {
      const { data: signed } = await supabase.storage
        .from("photos")
        .createSignedUrl(a.photo_path, 60 * 60);
      return {
        id: a.id,
        tree_id: tree.id,
        created_at: a.created_at,
        health_score: a.health_score,
        summary: a.diagnosis?.summary ?? "",
        thumbnailUrl: signed?.signedUrl ?? null,
      };
    }),
  );

  return (
    <main className="space-y-6">
      <div className="space-y-1">
        <Link href="/trees" className="text-sm text-muted-foreground hover:underline">
          ← All trees
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{tree.name}</h1>
        <p className="text-sm text-muted-foreground">
          {tree.cultivar ?? "Unknown cultivar"}
          {tree.location ? ` · ${tree.location}` : ""}
        </p>
      </div>

      <div className="flex gap-3">
        <Link
          href={`/trees/${tree.id}/assess`}
          className={buttonVariants({ size: "lg" })}
        >
          {items.length === 0 ? "Assess now" : "Re-assess"}
        </Link>
      </div>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Timeline
        </h2>
        <AssessmentTimeline items={items} />
      </section>
    </main>
  );
}
