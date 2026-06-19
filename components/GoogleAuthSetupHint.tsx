import {
  CITRUS_SUPABASE_CALLBACK_URL,
  GOOGLE_CLOUD_OAUTH_CLIENT_URL,
  GOOGLE_OAUTH_CLIENT_ID,
} from "@/app/_lib/google-auth-config";
import { getDevRedirectUrlHints } from "@/app/_lib/dev-lan-origins";

export function GoogleAuthSetupHint() {
  if (process.env.NODE_ENV !== "development") return null;

  return (
    <details className="rounded-lg border border-amber-300/60 bg-amber-50/80 p-3 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
      <summary className="cursor-pointer font-medium text-foreground">
        Google setup help (dev only)
      </summary>
      <ol className="mt-3 list-decimal space-y-2 pl-4">
        <li>
          <a
            href={GOOGLE_CLOUD_OAUTH_CLIENT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline"
          >
            Google Cloud OAuth client
          </a>{" "}
          → Authorized redirect URIs → add:
          <div className="mt-1 select-all break-all rounded bg-white/70 p-2 font-mono text-[11px] dark:bg-black/30">
            {CITRUS_SUPABASE_CALLBACK_URL}
          </div>
        </li>
        <li>
          Supabase → URL Configuration → Redirect URLs (and set Site URL to
          whichever device you test on — localhost for Mac, LAN IP for phone):
          <ul className="mt-1 list-disc pl-4 font-mono text-[11px]">
            {getDevRedirectUrlHints().map((url) => (
              <li key={url}>{url}</li>
            ))}
          </ul>
        </li>
        <li>
          Client ID in Supabase:{" "}
          <code className="break-all text-[11px]">{GOOGLE_OAUTH_CLIENT_ID}</code>
        </li>
      </ol>
    </details>
  );
}
