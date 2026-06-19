import { buttonVariants } from "@/components/ui/button";
import { getDevLanOrigins } from "@/app/_lib/dev-lan-origins";

export default function Landing() {
  const lanOrigin = getDevLanOrigins()[0];

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-3">
        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
          Citrus Care
        </p>
        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Photo-driven care for all your trees, flowers, and plants.
        </h1>
        <p className="text-pretty text-base text-muted-foreground sm:text-lg">
          Snap a leaf or stem, get a structured diagnosis, and track recovery over time.
          Now with visual recovery sliders, quarantine alerts, and dedicated branch wound healing diagnostics.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        {/* Full page nav — Next.js <Link> soft-nav breaks on LAN IP in dev */}
        <a
          href="/signup?next=/plants/new"
          className={buttonVariants({ size: "lg" })}
        >
          Get started
        </a>
        <a href="/login" className={buttonVariants({ size: "lg", variant: "outline" })}>
          Log in
        </a>
      </div>
      {lanOrigin && process.env.NODE_ENV === "development" && (
        <p className="text-sm text-muted-foreground">
          On your phone, bookmark{" "}
          <a href={lanOrigin} className="font-mono text-amber-800 underline dark:text-amber-300">
            {lanOrigin}
          </a>
        </p>
      )}
    </main>
  );
}
