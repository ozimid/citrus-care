import Link from "next/link";
import { Suspense } from "react";
import { AuthPanel } from "@/components/AuthPanel";
import { GoogleAuthSetupHint } from "@/components/GoogleAuthSetupHint";

export default function SignupPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Start growing</h1>
        <p className="text-sm text-muted-foreground">
          Free account. Add your first tree in under a minute.
        </p>
      </div>
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
