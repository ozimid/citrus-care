import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function Landing() {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-3">
        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
          Citrus Care
        </p>
        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Photo-driven care for every citrus tree you own.
        </h1>
        <p className="text-pretty text-base text-muted-foreground sm:text-lg">
          Snap a leaf, get a structured diagnosis, and watch the tree improve
          over time. Designed for lemons, oranges, limes, and the rest of the
          family.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/signup" className={buttonVariants({ size: "lg" })}>
          Get started
        </Link>
        <Link
          href="/login"
          className={buttonVariants({ size: "lg", variant: "outline" })}
        >
          Log in
        </Link>
      </div>
    </main>
  );
}
