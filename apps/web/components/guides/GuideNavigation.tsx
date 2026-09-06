import Link from "next/link";
import { ArrowLeft, House } from "lucide-react";

const returnLinkClassName =
  "inline-flex min-h-11 items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700 dark:border-neutral-700 dark:text-emerald-300 dark:hover:bg-emerald-950 dark:focus-visible:outline-emerald-300";

export function GuideNavigation({
  includeAllGuides = false,
  position = "top",
}: {
  includeAllGuides?: boolean;
  position?: "top" | "bottom";
}) {
  return (
    <nav
      aria-label={position === "top" ? "Guide navigation" : "Continue exploring"}
      className={`flex flex-wrap gap-3 border-neutral-200 dark:border-neutral-800 ${
        position === "top" ? "mb-8 border-b pb-5" : "mt-10 border-t pt-5"
      }`}
    >
      {includeAllGuides && (
        <Link href="/guides" className={returnLinkClassName}>
          <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
          Back to all guides
        </Link>
      )}
      <Link href="/" className={returnLinkClassName}>
        {includeAllGuides ? (
          <House className="size-4 shrink-0" aria-hidden="true" />
        ) : (
          <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
        )}
        Back to home
      </Link>
    </nav>
  );
}
