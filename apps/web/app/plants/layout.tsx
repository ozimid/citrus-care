import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/app/_lib/supabase/server";
import { HeaderAuth } from "@/components/HeaderAuth";

export default async function PlantsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { count } = await supabase
    .from("plants")
    .select("*", { count: "exact", head: true });

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/plants" className="text-base font-semibold text-emerald-700">
            Citrus Care
          </Link>
          {count !== null && (
            <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">
              {count} {count === 1 ? "plant" : "plants"}
            </span>
          )}
        </div>
        <HeaderAuth />
      </header>
      {children}
    </div>
  );
}

