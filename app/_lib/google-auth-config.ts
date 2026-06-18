/** Citrus Care Google Cloud OAuth client (Citrus Care Supabase project). */
export const GOOGLE_OAUTH_CLIENT_ID =
  "203990346092-bdas0vu0jn8hddlegl5n9lm87qsh1p0g.apps.googleusercontent.com";

export const CITRUS_SUPABASE_PROJECT_REF = "nmirgmazkvtxqaklxfjf";

export const CITRUS_SUPABASE_CALLBACK_URL = `https://${CITRUS_SUPABASE_PROJECT_REF}.supabase.co/auth/v1/callback`;

export const DEV_REDIRECT_URLS = [
  "http://localhost:3002/**",
  "http://192.168.1.205:3002/**",
] as const;
