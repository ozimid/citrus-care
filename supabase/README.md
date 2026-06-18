# Supabase setup

1. Create a Supabase project (free tier is fine).
2. Open **SQL editor** in the Supabase dashboard.
3. Run each migration in order:
   - `migrations/0001_init.sql` — profiles, trees, assessments + RLS
   - `migrations/0002_storage_photos.sql` — private `photos` bucket + per-user RLS
4. Copy keys from **Project Settings → API** into `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server only; never expose)

## Conventions

- Photo objects are stored under `<user_id>/<tree_id>/<uuid>.jpg`.
- Storage RLS enforces user ownership via the first folder segment.
- All tables have RLS on; never query with the service role key from user-facing code paths.
