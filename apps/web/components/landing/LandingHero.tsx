import Link from "next/link";
import { ArrowDown, ArrowRight, Download, Leaf, ShieldCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LandingContent } from "@/app/_content/landing";
import { CareWalkthrough } from "./CareWalkthrough";

export interface LandingHeroProps {
  content: LandingContent;
  lanOrigin?: string;
  showLanBookmark?: boolean;
}

export function LandingHero({ content, lanOrigin, showLanBookmark }: LandingHeroProps) {
  const { hero } = content;

  return (
    <section className="landing-hero border-b">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 lg:px-10">
        <nav aria-label="Main navigation" className="flex min-h-22 flex-wrap items-center justify-between gap-x-2 gap-y-3 border-b py-4">
          <Link href="/" className="flex min-h-12 shrink-0 items-center gap-2 text-sm font-semibold tracking-tight sm:text-base">
            <span className="flex size-8 items-center justify-center rounded-full bg-emerald-700 text-white sm:size-10">
              <Leaf className="size-4 sm:size-5" aria-hidden="true" />
            </span>
            Citrus Care
          </Link>
          <div className="flex min-w-0 max-w-full items-center gap-6">
            <a href="#how-it-works" className="hidden min-h-12 items-center text-sm text-muted-foreground hover:text-foreground md:inline-flex">
              How it works
            </a>
            <Link href="/guides" className="hidden min-h-12 items-center text-sm text-muted-foreground hover:text-foreground md:inline-flex">
              Pruning guides
            </Link>
            <a href={hero.primaryCta.href} className={cn(buttonVariants({ variant: "outline" }), "landing-button min-h-11 px-3 text-xs sm:px-4 sm:text-sm")}>
              {hero.primaryCta.label}
              <ArrowDown className="hidden size-4 sm:block" aria-hidden="true" />
            </a>
          </div>
        </nav>

        <div className="grid items-center gap-10 py-12 sm:py-16 lg:grid-cols-[1.04fr_1fr] lg:gap-12 lg:py-20">
          <div className="landing-hero-copy">
            <p className="mb-6 flex items-center gap-2 text-xs font-semibold tracking-wide text-emerald-800 dark:text-emerald-300">
              <span className="size-1.5 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-400" />
              {hero.eyebrow}
            </p>
            <h1 className="max-w-xl text-[clamp(2.65rem,5.5vw,4.5rem)] font-semibold leading-[1.07] tracking-[-0.055em]">
              {hero.title}{" "}
              <span className="block text-emerald-800 dark:text-emerald-300">{hero.titleAccent}</span>
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              {hero.description}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
              <a href={hero.primaryCta.href} className={cn(buttonVariants({ size: "lg" }), "landing-button min-h-12 bg-emerald-800 px-5 text-white hover:bg-emerald-900 dark:bg-emerald-300 dark:text-emerald-950 dark:hover:bg-emerald-200")}>
                <Download className="size-4" aria-hidden="true" />
                {hero.primaryCta.label}
              </a>
              <a href="#how-it-works" className="inline-flex min-h-12 items-center gap-2 text-sm font-medium hover:text-emerald-700 dark:hover:text-emerald-300">
                See how it works <ArrowRight className="size-4" aria-hidden="true" />
              </a>
            </div>
            <p className="mt-4 max-w-sm text-xs leading-5 text-muted-foreground">
              Free Android app · Direct APK install<br />
              One-time ~1.3 GB AI download over Wi-Fi · 6 GB+ RAM
            </p>
            <p className="mt-7 flex items-center gap-2 text-xs font-medium text-emerald-800 dark:text-emerald-300">
              <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
              Your photos never need to leave your phone.
            </p>
            {showLanBookmark && lanOrigin ? (
              <p className="mt-4 text-xs text-muted-foreground">
                Phone bookmark: <a href={lanOrigin} className="break-all font-mono underline">{lanOrigin}</a>
              </p>
            ) : null}
          </div>
          <div className="landing-hero-preview min-w-0">
            <CareWalkthrough />
          </div>
        </div>

        <dl className="grid gap-5 border-t py-7 sm:grid-cols-3 sm:gap-6 sm:py-8">
          {content.stats.map((stat) => (
            <div key={stat.value}>
              <dt className="text-sm font-semibold sm:text-base">{stat.value}</dt>
              <dd className="mt-1 text-xs leading-5 text-muted-foreground sm:text-sm">{stat.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
