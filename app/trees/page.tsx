import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function TreesPage() {
  return (
    <main className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Your trees</h1>
        <Link href="/trees/new" className={buttonVariants({ size: "sm" })}>
          Add tree
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        Tree list arrives in the next step. You are signed in — auth works.
      </p>
    </main>
  );
}
