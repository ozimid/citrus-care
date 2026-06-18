import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/app/_lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Tree } from "@/app/_lib/types";

export const dynamic = "force-dynamic";

export default async function TreeDetailPage({
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
          Assess now
        </Link>
      </div>

      <Card className="p-6">
        <p className="text-sm font-medium">Timeline</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Assessments will appear here once you capture a photo.
        </p>
      </Card>
    </main>
  );
}
