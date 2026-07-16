import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy — Citrus Care",
  description: "Citrus Care collects nothing. There is no account and no server.",
};

// D-17: the privacy note is short because there is almost nothing to say —
// no account, no server, no analytics. Everything lives on the phone.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16 sm:px-8">
      <Link href="/" className="text-sm text-emerald-700 underline dark:text-emerald-300">
        ← Back to Citrus Care
      </Link>
      <h1 className="mt-6 text-3xl font-semibold">Privacy</h1>
      <p className="mt-4 text-sm text-muted-foreground">Last updated: July 2026</p>

      <div className="mt-8 space-y-6 text-base leading-7 text-foreground">
        <p>
          Citrus Care is an Android app that runs entirely on your phone. It has no accounts, no
          servers, and no analytics. This note is short because there is almost nothing to tell.
        </p>

        <section>
          <h2 className="text-xl font-semibold">What we collect</h2>
          <p className="mt-2 text-muted-foreground">
            Nothing. We do not have a server to send anything to. We never see your photos, your
            plants, or how you use the app.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Where your data lives</h2>
          <p className="mt-2 text-muted-foreground">
            Your plants, diagnoses, and photos are stored only on your device. Photos are analyzed
            by an AI model that runs on the phone — they are never uploaded. Because nothing is
            synced, uninstalling the app or losing the phone loses the data, so the app lets you
            export a backup file to keep wherever you like.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Network use</h2>
          <p className="mt-2 text-muted-foreground">
            The app makes two kinds of network request, neither of which carries personal data: a
            one-time download of the on-device AI model, and — if you add a ZIP code to a plant —
            an anonymous weather forecast lookup (Open-Meteo) to time watering. No account or
            identifier is attached to either.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Contact</h2>
          <p className="mt-2 text-muted-foreground">
            Questions about this app or this note can be sent to the developer.
          </p>
        </section>
      </div>
    </main>
  );
}
