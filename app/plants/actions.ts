"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/app/_lib/supabase/server";
import { newPlantSchema } from "@/app/_lib/plant-schemas";

export type PlantFormState = { error?: string };

export async function createPlant(
  _prev: PlantFormState,
  formData: FormData,
): Promise<PlantFormState> {
  const parsed = newPlantSchema.safeParse({
    name: formData.get("name") ?? "",
    plant_type: formData.get("plant_type") ?? "",
    species: formData.get("species") ?? "",
    cultivar: formData.get("cultivar") ?? "",
    location: formData.get("location") ?? "",
    zip_code: formData.get("zip_code") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data, error } = await supabase
    .from("plants")
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      plant_type: parsed.data.plant_type,
      species: parsed.data.species ?? null,
      cultivar: parsed.data.cultivar ?? null,
      location: parsed.data.location ?? null,
      zip_code: parsed.data.zip_code ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[createPlant] Insert failed:", error?.message);
    return { error: "Failed to create plant." };
  }

  revalidatePath("/plants");
  redirect(`/plants/${data.id}`);
}

export async function deletePlant(plantId: string) {
  const supabase = await createClient();

  // Get photo paths of assessments for storage cleanup
  const { data: assessments } = await supabase
    .from("assessments")
    .select("photo_path")
    .eq("plant_id", plantId);

  if (assessments && assessments.length > 0) {
    const paths = assessments.map((a) => a.photo_path);
    const { error: storageError } = await supabase.storage
      .from("photos")
      .remove(paths);
    if (storageError) {
      console.error("[deletePlant] Storage cleanup failed:", storageError.message);
    }
  }

  const { error } = await supabase.from("plants").delete().eq("id", plantId);
  if (error) {
    console.error("[deletePlant] Delete failed:", error.message);
    throw new Error("Failed to delete plant.");
  }
  revalidatePath("/plants");
  redirect("/plants");
}

export async function updatePlant(
  plantId: string,
  _prev: PlantFormState,
  formData: FormData,
): Promise<PlantFormState> {
  const parsed = newPlantSchema.safeParse({
    name: formData.get("name") ?? "",
    plant_type: formData.get("plant_type") ?? "",
    species: formData.get("species") ?? "",
    cultivar: formData.get("cultivar") ?? "",
    location: formData.get("location") ?? "",
    zip_code: formData.get("zip_code") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("plants")
    .update({
      name: parsed.data.name,
      plant_type: parsed.data.plant_type,
      species: parsed.data.species ?? null,
      cultivar: parsed.data.cultivar ?? null,
      location: parsed.data.location ?? null,
      zip_code: parsed.data.zip_code ?? null,
    })
    .eq("id", plantId)
    .eq("user_id", user.id);

  if (error) {
    console.error("[updatePlant] Update failed:", error.message);
    return { error: "Failed to update plant." };
  }

  revalidatePath(`/plants/${plantId}`);
  revalidatePath("/plants");
  redirect(`/plants/${plantId}`);
}


