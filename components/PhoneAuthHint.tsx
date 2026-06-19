"use client";

import { useSyncExternalStore } from "react";
import { SUPABASE_URL_CONFIG_URL } from "@/app/_lib/google-auth-config";

function subscribe() {
  return () => {};
}

function getLanOrigin(): string | null {
  if (typeof window === "undefined") return null;
  const { protocol, host } = window.location;
  const isLan =
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    /^\d+\.\d+\.\d+\.\d+/.test(host);
  if (!isLan) return null;
  return `${protocol}//${host}`;
}

export function PhoneAuthHint() {
  const origin = useSyncExternalStore(subscribe, getLanOrigin, () => null);
  if (!origin || process.env.NODE_ENV !== "development") return null;

  return (
    <div
      className="rounded-lg border border-sky-300/70 bg-sky-50/90 p-3 text-xs text-sky-950 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100"
      role="note"
    >
      <p className="font-medium text-foreground">
        After Google, you get sent to localhost?
      </p>
      <p className="mt-1 text-muted-foreground">
        The app already asks Supabase to return to{" "}
        <code className="break-all">{origin}/auth/callback</code>. Supabase
        ignores that when <strong>Site URL</strong> is still{" "}
        <code>localhost</code> or this IP is missing from Redirect URLs — then
        it falls back to localhost (broken on a real phone).
      </p>
      <p className="mt-2 font-medium text-foreground">
        <a
          href={SUPABASE_URL_CONFIG_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Open Supabase URL Configuration
        </a>
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-4">
        <li>
          <span className="text-muted-foreground">Site URL →</span>{" "}
          <code className="select-all break-all">{origin}</code>
        </li>
        <li>
          <span className="text-muted-foreground">Redirect URLs → add</span>{" "}
          <code className="select-all break-all">{`${origin}/**`}</code>
        </li>
      </ul>
      <p className="mt-2 text-muted-foreground">
        Save, wait ~30s, hard-refresh, then sign in again. Tip: on your Mac you
        can also use this IP instead of localhost so one Site URL works for
        both.
      </p>
    </div>
  );
}
