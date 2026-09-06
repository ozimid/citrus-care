import Link from "next/link";
import { landingContent } from "@/app/_content/landing";
import { notFound } from "next/navigation";
import { GuideNavigation } from "@/components/guides/GuideNavigation";
import { allGuideSlugs, monthRange, packForSlug } from "../_lib";

export function generateStaticParams() {
  return allGuideSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const pack = packForSlug((await params).slug);
  if (!pack) return {};
  return {
    title: `How to prune a ${pack.label.toLowerCase()} — Citrus Care`,
    description: `When to prune a ${pack.label.toLowerCase()} (${monthRange(pack.bestMonths)} in the northern hemisphere — add six months south), the rules, and the mistakes to avoid — sourced from extension services and the RHS.`,
  };
}

// One sourced rule pack as a page — the identical data the app ships.
export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const pack = packForSlug((await params).slug);
  if (!pack) notFound();

  return (
    <main className="mx-auto max-w-2xl px-6 py-8 sm:py-12">
      <GuideNavigation includeAllGuides />
      <h1 className="mt-4 text-3xl font-semibold">How to prune a {pack.label.toLowerCase()}</h1>

      <div className="mt-6 rounded-xl border border-emerald-600/40 bg-emerald-600/5 p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
          When
        </p>
        <p className="mt-1 font-medium">
          Best: {monthRange(pack.bestMonths)}{" "}
          <span className="font-normal text-neutral-600 dark:text-neutral-300">
            (northern hemisphere — southern hemisphere: add six months)
          </span>
        </p>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          {pack.seasonNote.charAt(0).toUpperCase() + pack.seasonNote.slice(1)}. Dead, damaged or
          diseased wood can come off in any month.
          {pack.alwaysAllowedCaveat ? ` ${pack.alwaysAllowedCaveat}` : ""}
        </p>
      </div>

      <div className="mt-10 rounded-xl border border-red-600/40 bg-red-600/5 p-5">
        <h2 className="text-xl font-semibold text-red-700 dark:text-red-400">Never</h2>
        <ul className="mt-3 space-y-2">
          {pack.never.map((rule) => (
            <li key={rule} className="text-sm leading-6 text-neutral-800 dark:text-neutral-200">
              ✗ {rule}
            </li>
          ))}
        </ul>
      </div>

      <h2 className="mt-10 text-xl font-semibold">The rules</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Months in these rules are northern-hemisphere — in the southern hemisphere, shift them by
        six.
      </p>
      <ul className="mt-3 space-y-2">
        {pack.rules.map((rule) => (
          <li key={rule} className="text-sm leading-6 text-neutral-800 dark:text-neutral-200">
            • {rule}
          </li>
        ))}
      </ul>

      <p className="mt-10 text-sm text-neutral-500">
        Sourced from US university cooperative-extension services and the RHS, then adversarially
        fact-checked —{" "}
        <a
          href="https://github.com/ozimid/citrus-care/blob/main/docs/research/pruning-rules.md"
          className="text-emerald-700 hover:underline dark:text-emerald-400"
        >
          every rule carries its source
        </a>
        .
      </p>

      <div className="mt-8 rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
        <p className="font-medium">Want these rules applied to a photo of your own plant?</p>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          The Citrus Care app runs entirely on your phone — free, no account, no subscription, and
          your photos never leave the device.
        </p>
        <a
          href={landingContent.getApp.download.href}
          className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600"
        >
          Download for Android
        </a>
        <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-300">Direct APK download · 161 MB · Android only</p>
        <Link
          href="/#get-the-app"
          className="mt-1 inline-flex min-h-11 items-center text-sm text-emerald-700 underline underline-offset-4 dark:text-emerald-400"
        >
          Installation instructions
        </Link>
      </div>
      <GuideNavigation includeAllGuides position="bottom" />
    </main>
  );
}
