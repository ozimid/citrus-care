import Image from "next/image";
import Link from "next/link";
import {
  Camera,
  CheckCircle2,
  Coffee,
  Download,
  History,
  Leaf,
  Lock,
  Scissors,
  ShieldAlert,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import type { LandingContent } from "@/app/_content/landing";

const modeIcons = {
  leaf: Leaf,
  scissors: Scissors,
  shield: ShieldAlert,
  history: History,
} as const;

interface LandingPageProps {
  content: LandingContent;
  lanOrigin?: string;
  showLanBookmark?: boolean;
}

export function LandingPage({
  content,
  lanOrigin,
  showLanBookmark = false,
}: LandingPageProps) {
  return (
    <main className="bg-background text-foreground">
      <HeroSection content={content} lanOrigin={lanOrigin} showLanBookmark={showLanBookmark} />
      <WorkflowSection content={content} />
      <CareModesSection content={content} />
      <FocusSection content={content} />
      <GetAppSection content={content} />
      <PrivacySection content={content} />
      <SupportSection content={content} />
      <Footer />
    </main>
  );
}

function HeroSection({
  content,
  lanOrigin,
  showLanBookmark,
}: LandingPageProps) {
  const { hero } = content;

  return (
    <section className="relative isolate flex min-h-[76svh] overflow-hidden">
      <Image
        src="/landing-citrus-assessment.png"
        alt="Citrus Care assessment shown on a phone beside citrus leaves and pruning tools"
        fill
        priority
        sizes="100vw"
        className="absolute inset-0 -z-20 size-full object-cover"
      />
      <div className="absolute inset-0 -z-10 bg-neutral-950/48" />

      <div className="mx-auto flex w-full max-w-6xl flex-col px-5 py-5 text-white sm:px-8 lg:px-10">
        <nav className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex size-8 items-center justify-center rounded-md bg-white/14 ring-1 ring-white/25">
              <Leaf className="size-4" aria-hidden="true" />
            </span>
            Citrus Care
          </Link>
          <a
            href={hero.primaryCta.href}
            className={cn(
              buttonVariants({ size: "sm" }),
              "bg-white text-neutral-950 hover:bg-white/90",
            )}
          >
            {hero.primaryCta.label}
          </a>
        </nav>

        <div className="flex flex-1 flex-col justify-center py-16 sm:py-20 lg:max-w-3xl">
          <p className="mb-4 inline-flex w-fit items-center gap-2 rounded-md bg-white/14 px-3 py-1 text-sm font-medium ring-1 ring-white/20">
            <Sparkles className="size-4" aria-hidden="true" />
            {hero.eyebrow}
          </p>
          <h1 className="text-5xl font-semibold leading-none sm:text-6xl lg:text-7xl">
            {hero.title}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-white/86 sm:text-lg">
            {hero.description}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={hero.primaryCta.href}
              className={cn(
                buttonVariants({ size: "lg" }),
                "bg-lime-300 text-neutral-950 hover:bg-lime-200",
              )}
            >
              <Camera className="size-4" aria-hidden="true" />
              {hero.primaryCta.label}
            </a>
          </div>

          {showLanBookmark && lanOrigin ? (
            <p className="mt-5 text-sm text-white/76">
              Phone bookmark:{" "}
              <a href={lanOrigin} className="font-mono underline">
                {lanOrigin}
              </a>
            </p>
          ) : null}
        </div>

        <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-md bg-white/18 ring-1 ring-white/18">
          {content.stats.map((stat) => (
            <div key={stat.label} className="bg-neutral-950/38 p-3 sm:p-4">
              <dt className="text-xl font-semibold sm:text-2xl">{stat.value}</dt>
              <dd className="mt-1 text-xs leading-5 text-white/78 sm:text-sm">
                {stat.label}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function WorkflowSection({ content }: { content: LandingContent }) {
  return (
    <section className="border-b bg-white py-14 dark:bg-background sm:py-18">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.15fr] lg:px-10">
        <div>
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            Care loop
          </p>
          <h2 className="mt-3 max-w-md text-3xl font-semibold leading-tight sm:text-4xl">
            From symptom photo to recovery record.
          </h2>
        </div>
        <div className="grid gap-3">
          {content.workflow.map((step, index) => (
            <article
              key={step.title}
              className="grid gap-3 rounded-md border bg-background p-4 sm:grid-cols-[3rem_1fr] sm:p-5"
            >
              <div className="flex size-10 items-center justify-center rounded-md bg-emerald-100 text-sm font-semibold text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-200">
                {index + 1}
              </div>
              <div>
                <h3 className="font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {step.description}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function CareModesSection({ content }: { content: LandingContent }) {
  return (
    <section className="bg-[#f6f8f1] py-14 dark:bg-[#151812] sm:py-18">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 lg:px-10">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
              Diagnostic modes
            </p>
            <h2 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight sm:text-4xl">
              Built for the messy middle of plant care.
            </h2>
          </div>
          <a href="#get-the-app" className={buttonVariants({ variant: "outline" })}>
            Get the app
          </a>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {content.careModes.map((mode) => {
            const Icon = modeIcons[mode.icon];

            return (
              <article key={mode.title} className="rounded-md border bg-background p-5">
                <div className="flex size-10 items-center justify-center rounded-md bg-lime-100 text-lime-900 dark:bg-lime-400/15 dark:text-lime-200">
                  <Icon className="size-5" aria-hidden="true" />
                </div>
                <h3 className="mt-4 font-semibold">{mode.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {mode.description}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function FocusSection({ content }: { content: LandingContent }) {
  return (
    <section className="border-b bg-background py-14 sm:py-18">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 sm:px-8 lg:grid-cols-[1fr_0.8fr] lg:px-10">
        <div>
          <p className="text-sm font-medium text-red-700 dark:text-red-300">
            Practical coverage
          </p>
          <h2 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight sm:text-4xl">
            Keep the everyday observations close to the diagnosis.
          </h2>
          <div className="mt-6 flex flex-wrap gap-2">
            {content.focusAreas.map((area) => (
              <span
                key={area}
                className="rounded-md border bg-muted/35 px-3 py-1.5 text-sm text-muted-foreground"
              >
                {area}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-md border bg-muted/25 p-5">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-md bg-red-100 text-red-900 dark:bg-red-400/15 dark:text-red-200">
              <CheckCircle2 className="size-5" aria-hidden="true" />
            </div>
            <h3 className="font-semibold">Production-minded foundation</h3>
          </div>
          <ul className="mt-5 space-y-3">
            {content.proof.map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-6 text-muted-foreground">
                <CheckCircle2
                  className={cn("mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-300")}
                  aria-hidden="true"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function GetAppSection({ content }: { content: LandingContent }) {
  const { getApp } = content;

  return (
    <section id="get-the-app" className="bg-[#f6f8f1] py-14 dark:bg-[#151812] sm:py-18">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 lg:px-10">
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
          On your phone
        </p>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight sm:text-4xl">
          {getApp.title}
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
          {getApp.description}
        </p>

        <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
          <div className="rounded-md border bg-background p-5">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-md bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-200">
                <Smartphone className="size-5" aria-hidden="true" />
              </div>
              <h3 className="font-semibold">Android</h3>
            </div>
            <a
              href={getApp.download.href}
              className={cn(
                buttonVariants({ size: "lg" }),
                "mt-5 w-full bg-emerald-600 text-white hover:bg-emerald-500",
              )}
            >
              <Download className="size-4" aria-hidden="true" />
              {getApp.download.label}
            </a>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {getApp.download.note}
            </p>
            <a
              href={getApp.download.source.href}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-sm font-medium text-emerald-700 underline dark:text-emerald-300"
            >
              {getApp.download.source.label}
            </a>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-md border bg-background p-5">
              <h3 className="font-semibold">Before you install</h3>
              <ul className="mt-4 space-y-3">
                {getApp.requirements.map((item) => (
                  <li key={item} className="flex gap-3 text-sm leading-6 text-muted-foreground">
                    <CheckCircle2
                      className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-300"
                      aria-hidden="true"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-md border bg-background p-5">
              <h3 className="font-semibold">Installing</h3>
              <ol className="mt-4 space-y-3">
                {getApp.installSteps.map((step, index) => (
                  <li key={step} className="flex gap-3 text-sm leading-6 text-muted-foreground">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PrivacySection({ content }: { content: LandingContent }) {
  const { privacy } = content;
  return (
    <section id="privacy" className="border-b bg-background py-14 sm:py-18">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 lg:px-10">
        <div className="max-w-2xl rounded-md border bg-muted/25 p-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-md bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-200">
              <Lock className="size-5" aria-hidden="true" />
            </div>
            <h2 className="text-2xl font-semibold">{privacy.title}</h2>
          </div>
          <p className="mt-4 text-base leading-7 text-muted-foreground">{privacy.body}</p>
          <Link href="/privacy" className="mt-4 inline-block text-sm font-medium text-emerald-700 underline dark:text-emerald-300">
            Read the full privacy note
          </Link>
        </div>
      </div>
    </section>
  );
}

function SupportSection({ content }: { content: LandingContent }) {
  const { support } = content;
  return (
    <section className="bg-[#f6f8f1] py-14 dark:bg-[#151812] sm:py-18">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 lg:px-10">
        <div className="flex max-w-2xl flex-col gap-4">
          <h2 className="text-2xl font-semibold">{support.title}</h2>
          <p className="text-base leading-7 text-muted-foreground">{support.body}</p>
          <a
            href={support.cta.href}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ size: "lg" }), "w-fit bg-amber-400 text-neutral-950 hover:bg-amber-300")}
          >
            <Coffee className="size-4" aria-hidden="true" />
            {support.cta.label}
          </a>
          <p className="text-sm text-muted-foreground">
            {support.feedback.prompt}{" "}
            <a
              href={support.feedback.href}
              className="font-medium text-emerald-700 underline dark:text-emerald-300"
            >
              {support.feedback.label}
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-6 sm:px-8 lg:px-10">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Leaf className="size-4" aria-hidden="true" />
          Citrus Care
        </p>
        <div className="flex items-center gap-4">
          <Link href="/privacy" className="text-sm text-muted-foreground underline">
            Privacy
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </footer>
  );
}
