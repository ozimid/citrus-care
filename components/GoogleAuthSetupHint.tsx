import {
  CITRUS_SUPABASE_CALLBACK_URL,
  DEV_REDIRECT_URLS,
  GOOGLE_OAUTH_CLIENT_ID,
} from "@/app/_lib/google-auth-config";

export function GoogleAuthSetupHint() {
  if (process.env.NODE_ENV !== "development") return null;

  return (
    <details className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
      <summary className="cursor-pointer font-medium text-foreground">
        First-time Google setup (dev)
      </summary>
      <ol className="mt-3 list-decimal space-y-2 pl-4">
        <li>
          <span className="font-medium text-foreground">Citrus Care Supabase</span> →
          Authentication → Providers → Google → Enable with your Google Cloud
          OAuth client ID + secret.
          <div className="mt-1 break-all font-mono text-[11px]">
            Client ID: {GOOGLE_OAUTH_CLIENT_ID}
          </div>
        </li>
        <li>
          <span className="font-medium text-foreground">Google Cloud Console</span> →
          APIs &amp; Services → Credentials → your OAuth client → Authorized redirect
          URIs → add:
          <div className="mt-1 break-all font-mono text-[11px]">
            {CITRUS_SUPABASE_CALLBACK_URL}
          </div>
        </li>
        <li>
          <span className="font-medium text-foreground">Citrus Care Supabase</span> →
          Authentication → URL Configuration → Site URL{" "}
          <code className="text-[11px]">http://localhost:3002</code> → Redirect URLs:
          <ul className="mt-1 list-disc pl-4 font-mono text-[11px]">
            {DEV_REDIRECT_URLS.map((url) => (
              <li key={url}>{url}</li>
            ))}
          </ul>
        </li>
      </ol>
    </details>
  );
}
