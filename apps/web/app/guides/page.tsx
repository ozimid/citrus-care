import Link from "next/link";
import { authoritativePacks, guideSlug, guideSummary } from "./_lib";

export const metadata = {
  title: "Pruning guides — Citrus Care",
  description:
    "When and how to prune citrus, roses, flowering shrubs and trees — sourced from university extension services and the RHS.",
};

// #6 — the app's sourced rule packs, published as pages. Same data the app
// ships (@citrus/shared), one source of truth.
export default function GuidesIndex() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
        Pruning guides
      </p>
      <h1 className="mt-2 text-3xl font-semibold">When — and where — to prune</h1>
      <p className="mt-3 text-neutral-600 dark:text-neutral-300">
        The same rules the Citrus Care app ships, sourced from university extension services and the
        RHS — not generated, not scraped.
      </p>
      <ul className="mt-8 space-y-4">
        {authoritativePacks().map((pack) => (
          <li
            key={pack.key}
            className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800"
          >
            <Link
              href={`/guides/${guideSlug(pack.key)}`}
              className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
            >
              How to prune a {pack.label.toLowerCase()} →
            </Link>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
              {guideSummary(pack)}
            </p>
          </li>
        ))}
      </ul>
      <div className="mt-10 rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
        <p className="font-medium">Want these rules applied to a photo of your own plant?</p>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          The Citrus Care app runs entirely on your phone — free, no account, no subscription.
        </p>
        <Link
          href="/#get-the-app"
          className="mt-3 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          Download for Android
        </Link>
      </div>
    </main>
  );
}
