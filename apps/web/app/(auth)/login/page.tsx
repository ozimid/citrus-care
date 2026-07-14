import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthPanel } from "@/components/AuthPanel";
import { GoogleAuthSetupHint } from "@/components/GoogleAuthSetupHint";
import { PhoneAuthHint } from "@/components/PhoneAuthHint";
import { createClient } from "@/app/_lib/supabase/server";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/plants");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">
          Log in to track your plants.
        </p>
      </div>
      {error === "auth" && (
        <p className="text-sm text-destructive" role="alert">
          Google sign-in failed. On your phone, set Supabase Site URL to your LAN
          address (see blue box below). On Mac, use localhost.
        </p>
      )}
      <PhoneAuthHint />
      <Suspense fallback={<div className="h-48 animate-pulse rounded-lg bg-muted" />}>
        <AuthPanel />
      </Suspense>
      <GoogleAuthSetupHint />
      <p className="text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link href="/signup" className="font-medium text-amber-700 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
