import Link from "next/link";
import { createClient } from "@/app/_lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { TreeCard } from "@/components/TreeCard";
import type { Tree } from "@/app/_lib/types";

export const dynamic = "force-dynamic";

export default async function TreesPage() {
  const supabase = await createClient();
  const { data: trees } = await supabase
    .from("trees")
    .select("id,user_id,name,cultivar,location,cover_assessment_id,created_at")
    .order("created_at", { ascending: false });

  const list = (trees ?? []) as Tree[];

  return (
    <main className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Your trees</h1>
        <Link href="/trees/new" className={buttonVariants({ size: "sm" })}>
          Add tree
        </Link>
      </div>

      {list.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((t) => (
            <li key={t.id}>
              <TreeCard tree={t} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
      <p className="text-sm font-medium">No trees yet</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Add your first citrus tree to start tracking its health.
      </p>
      <Link
        href="/trees/new"
        className={buttonVariants({ size: "sm" }) + " mt-4"}
      >
        Add tree
      </Link>
    </div>
  );
}
