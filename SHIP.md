# Ship checklist — Citrus Care PWA

## Pre-flight

- [ ] `npm test` passes (Vitest, 37 tests at last run)
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run lint` clean
- [ ] `npm run build` succeeds locally
- [ ] `npx playwright test` — landing + redirect smoke (requires `npx playwright install chromium` once)
- [ ] `.env.local` has all four env vars (Supabase URL, anon key, service role, Gemini key)

## Supabase

1. Create a Supabase project (free tier).
2. SQL editor → run `supabase/migrations/0001_init.sql`.
3. SQL editor → run `supabase/migrations/0002_storage_photos.sql`.
4. SQL editor → run `supabase/migrations/0003_rate_limits.sql`.
5. Verify in dashboard: tables `profiles`, `trees`, `assessments`, `rate_limits` exist with RLS on; bucket `photos` is private.
6. **Google OAuth:** Authentication → Providers → Google → Enable. Use Google Cloud OAuth client; redirect URI = `https://<project-ref>.supabase.co/auth/v1/callback`.
7. **Auth URLs:** Site URL + Redirect URLs include `http://localhost:3002` (dev) and production domain (prod).
8. Copy URL + anon key + service role key into `.env.local`.

## Deploy to Vercel

1. `git push` to a GitHub repo (currently local-only).
2. In Vercel → New Project → import the repo.
3. Framework: Next.js (auto-detected).
4. Add Environment Variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GEMINI_API_KEY` (from https://aistudio.google.com/apikey)
   - (Turnstile keys are NOT needed — removed with email signup when auth went Google-only; see PRD F12)
5. Deploy.
6. Add the deployed origin to Supabase **Auth → URL Configuration → Site URL** (and Redirect URLs).

## Go / No-Go

Go when ALL are true:
- Landing page loads and `/login`, `/signup` work.
- Signup creates an auth user and a `profiles` row (trigger fires).
- `/plants` is protected (anonymous redirects to `/login`).
- Add plant → plant appears in list and on detail page.
- Capture photo → photo uploads to Storage under `photos/<user_id>/<plant_id>/…`.
- AI returns a structured assessment in under ~15 s.
- Assessment renders with health score, symptoms, causes, recommendations.
- Re-assess on the same plant shows a `comparison` section.

## Rollback

Vercel: open the prior deployment → **Promote to Production**. Takes ~10 s.

DB changes (if any): there are only two migrations and both are forward-only. If you need to fully reset, drop tables in reverse order:
```sql
drop table if exists public.assessments;
drop table if exists public.plants;
drop table if exists public.profiles;
delete from storage.buckets where id = 'photos';
```

## Post-launch monitoring (manual at MVP scale)

- Watch Vercel function logs for /api/assess errors and Gemini 502s.
- Watch Google AI Studio for Gemini token spend.
- Watch Supabase dashboard for storage usage (photo bucket).
