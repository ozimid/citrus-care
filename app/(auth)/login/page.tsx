import Link from "next/link";
import { Suspense } from "react";
import { AuthPanel } from "@/components/AuthPanel";
import { GoogleAuthSetupHint } from "@/components/GoogleAuthSetupHint";
import { CITRUS_SUPABASE_CALLBACK_URL } from "@/app/_lib/google-auth-config";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">
          Log in to track your citrus trees.
        </p>
      </div>
      {error === "auth" && (
        <p className="text-sm text-destructive" role="alert">
          Google sign-in failed after redirect. Enable Google under Supabase →
          Authentication → Providers, add{" "}
          <code className="text-xs">{CITRUS_SUPABASE_CALLBACK_URL}</code> to Google
          Cloud redirect URIs, and allow{" "}
          <code className="text-xs">http://localhost:3002/**</code> in Supabase
          redirect URLs.
        </p>
      )}
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
