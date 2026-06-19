import { createClient } from "@/app/_lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { PlantCard } from "@/components/PlantCard";
import type { Plant } from "@/app/_lib/types";

export const dynamic = "force-dynamic";

export default async function PlantsPage() {
  const supabase = await createClient();
  const { data: plants } = await supabase
    .from("plants")
    .select("id,user_id,name,plant_type,species,cultivar,location,cover_assessment_id,created_at")
    .order("created_at", { ascending: false });

  const list = (plants ?? []) as Plant[];

  return (
    <main className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Your plants</h1>
        <a href="/plants/new" className={buttonVariants({ size: "sm" })}>
          Add plant
        </a>
      </div>

      {list.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((p) => (
            <li key={p.id}>
              <PlantCard plant={p} />
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
      <p className="text-sm font-medium">No plants yet</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Add your first plant to start tracking its health.
      </p>
      <a href="/plants/new" className={buttonVariants({ size: "sm" }) + " mt-4"}>
        Add plant
      </a>
    </div>
  );
}

