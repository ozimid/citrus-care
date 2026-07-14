import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthPanel } from "@/components/AuthPanel";
import { GoogleAuthSetupHint } from "@/components/GoogleAuthSetupHint";
import { PhoneAuthHint } from "@/components/PhoneAuthHint";
import { createClient } from "@/app/_lib/supabase/server";

export default async function SignupPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/plants");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Start growing</h1>
        <p className="text-sm text-muted-foreground">
          Free account. Add your first plant in under a minute.
        </p>
      </div>
      <PhoneAuthHint />
      <Suspense fallback={<div className="h-48 animate-pulse rounded-lg bg-muted" />}>
        <AuthPanel />
      </Suspense>
      <GoogleAuthSetupHint />
      <p className="text-center text-sm text-muted-foreground">
        Already in?{" "}
        <Link href="/login" className="font-medium text-amber-700 hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
