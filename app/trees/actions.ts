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

  if (error || !data) {
    console.error("[createTree] Insert failed:", error?.message);
    return { error: "Failed to create tree." };
  }

  revalidatePath("/trees");
  redirect(`/trees/${data.id}`);
}

export async function deleteTree(treeId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("trees").delete().eq("id", treeId);
  if (error) {
    console.error("[deleteTree] Delete failed:", error.message);
    throw new Error("Failed to delete tree.");
  }
  revalidatePath("/trees");
  redirect("/trees");
}
