# Implementation plan — Citrus Care PWA

Execution order is dependency-ordered. Each task ships as one commit on `main` (trunk-based; no PRs in solo MVP).

## Sequence

1. **scaffold** — Next.js 16 + TS + Tailwind 4 + shadcn/ui; Supabase + Anthropic deps; PWA manifest stub.
2. **db** — Supabase migrations: `profiles`, `trees`, `assessments` + RLS + `photos` storage bucket.
3. **auth** — Supabase auth pages (signup/login), session middleware, protected route group.
4. **trees** — Tree CRUD: list page, add page, detail shell.
5. **capture** — PhotoCapture component (camera + gallery fallback), upload to Storage.
6. **ai-assess** — `app/_lib/claude.ts` (citrus expert prompt + parser) and `POST /api/assess` (loads tree, calls Claude, persists).
7. **assessment-ui** — AssessmentCard rendering health score, symptoms, causes, prioritized actions.
8. **timeline** — Tree detail timeline with photo thumbnails.
9. **comparison** — Pass previous assessment into prompt; render diff vs last.
10. **pwa** — manifest + service worker + offline shell + install prompt.
11. **verify-ship** — Full test pass, five-axis review, simplify, ship to Vercel with rollback note.

## Dependency notes

- `db` blocks `auth`, `trees`, `capture`, `ai-assess` (all need tables/bucket).
- `auth` blocks every protected route.
- `capture` + `ai-assess` are parallelizable but small; ship sequentially for cleaner commits.
- `comparison` requires at least two stored assessments; `timeline` first.

## Verification per task

Every task ends with: tests green (`npm test`), TypeScript clean (`npx tsc --noEmit`), build green (`npm run build`).

## Risks + mitigation

- **Supabase setup** — User must create a Supabase project and paste keys into `.env.local`. The scaffold supplies `.env.example` and the README setup steps.
- **Claude API key** — Same: server-only env var, never inlined.
- **PWA on iOS Safari** — Test installability in TEST phase; document known iOS PWA limits in README.
- **Vision model cost** — Cap input image size client-side before upload.
