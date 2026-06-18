import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/app/_lib/supabase/server";
import { HeaderAuth } from "@/components/HeaderAuth";

export default async function TreesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/trees" className="text-base font-semibold text-amber-700">
          Citrus Care
        </Link>
        <HeaderAuth />
      </header>
      {children}
    </div>
  );
}
