import { notFound } from "next/navigation";
import { createClient } from "@/app/_lib/supabase/server";
import { EditPlantForm } from "./edit-plant-form";
import type { Plant } from "@citrus/shared";

export const dynamic = "force-dynamic";

export default async function EditPlantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("plants")
    .select("id,user_id,name,plant_type,species,cultivar,location,zip_code,cover_assessment_id,created_at")
    .eq("id", id)
    .maybeSingle();

  const plant = data as Plant | null;
  if (!plant) notFound();

  return (
    <main className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Edit {plant.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          Modify this plant record below. Keep details accurate to help the AI.
        </p>
      </div>
      <EditPlantForm plant={plant} />
    </main>
  );
}
