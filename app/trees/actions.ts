"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/app/_lib/supabase/server";
import { newTreeSchema } from "@/app/_lib/tree-schemas";

export type TreeFormState = { error?: string };

export async function createTree(
  _prev: TreeFormState,
  formData: FormData,
): Promise<TreeFormState> {
  const parsed = newTreeSchema.safeParse({
    name: formData.get("name") ?? "",
    cultivar: formData.get("cultivar") ?? "",
    location: formData.get("location") ?? "",
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
    .from("trees")
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      cultivar: parsed.data.cultivar ?? null,
      location: parsed.data.location ?? null,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to create" };

  revalidatePath("/trees");
  redirect(`/trees/${data.id}`);
}

export async function deleteTree(treeId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("trees").delete().eq("id", treeId);
  if (error) throw new Error(error.message);
  revalidatePath("/trees");
  redirect("/trees");
}
