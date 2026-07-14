# CLAUDE.md — Citrus Care v1

## What this is
Photo-driven citrus tree care PWA. User snaps a leaf/tree photo, Gemini 2.5 Flash returns a structured diagnosis (health score, symptoms, causes, ranked actions); each tree has a timeline; re-assessment shows better/same/worse vs the prior.

## Tech Stack
- **Frontend:** Next.js 16 (App Router), React 19, Tailwind CSS 4, shadcn/ui (`@base-ui/react` primitives)
- **Backend:** Next.js Route Handlers + Server Actions
- **AI:** Google Gemini API (`@google/genai`, model `gemini-2.5-flash`, structured output via `responseSchema`)
- **Database:** Supabase (Postgres + Auth + Storage + RLS on every user-visible table)
- **Auth:** Google OAuth via Supabase (server routes `app/auth/google`, `app/auth/callback`)
- **Testing:** Vitest (unit), Playwright (e2e)
- **CI:** GitHub Actions (typecheck + lint + vitest on push/PR)
- **Deploy:** Fly.io (`fly.toml` in repo root)

## Repo structure (monorepo — strict separation, decision D-12)
- `apps/web/` — Next.js app: frontend AND its backend-for-frontend (route handlers, server actions, `app/_lib`) — colocated by framework design
- `apps/mobile/` — Expo/React Native app (D-11). **Not an npm workspace** — own `npm install` inside the folder (React version isolation)
- `packages/shared/` — types + Zod schemas shared web ↔ mobile (`@citrus/shared`)
- `supabase/` — database: migrations, RLS, storage config
- Root `Dockerfile` + `fly.toml` deploy `apps/web`

## Commands (run from repo root — proxies to apps/web)
```bash
npm run dev               # Next dev (port 3002)
npm run build             # Production build — note: build script does `unset NODE_ENV` before next build
npm run lint              # ESLint
npm test                  # Vitest (run mode)
npm run e2e               # Playwright e2e
npm run typecheck         # tsc --noEmit
```

## Path Aliases
- `@/*` → `apps/web/` root (within the web app)
- `@citrus/shared` → `packages/shared/src`

## Key Files
- `apps/web/app/_lib/gemini.ts` — Gemini vision call + citrus expert prompt + Zod + responseSchema
- `apps/web/app/_lib/rate-limit.ts` — Postgres `rate_limits` table helper (`tryConsume`)
- `apps/web/app/_lib/supabase/{client,server,middleware}.ts` — Supabase clients
- `apps/web/app/api/assess/route.ts` — main AI endpoint (auth · ownership · rate limit · download · Gemini · parse · insert)
- `apps/web/app/auth/{google,callback}/route.ts` — Google OAuth
- `apps/web/components/AuthPanel.tsx` — sign-in UI
- `apps/web/app/plants/...` — plant list / new / detail / assess / single-assessment pages
- `apps/web/proxy.ts` — Next.js 16 proxy (was `middleware.ts`); session refresh + redirects
- `supabase/migrations/*.sql` — schema, RLS, photos bucket, rate_limits
- `apps/web/tests/unit/*.test.ts` — schemas, prompts, image utils, health bands, assess route, rate limit
- `apps/web/tests/e2e/*.spec.ts` — landing + protected redirect

## AI-agent workflow (which skill, when)

Use the installed Claude Code skills instead of improvising the equivalent step by hand:

| Moment | Skill |
|---|---|
| Building a feature (test-first) | `tdd` |
| Stuck on a hard bug / regression | `diagnosing-bugs` |
| Before calling anything "done" | `verify` (drive the real flow, not just tests) |
| Before any commit | `code-review`; add `security-review` when touching auth, RLS, storage, or pipeline boundaries |
| Choosing a library, model, or API | `research` (grounded in primary sources, output committed as Markdown) |
| Locking an architecture decision | `domain-modeling` (then record it in Obsidian Architecture §"Locked decisions") |
| A task that smells repeatable | `loopy` — check the Loop Library before inventing a workflow |

## Required reads before any code change
1. Obsidian PRD **§0** — `.../Citrus Care/Citrus Care PRD v1.md` — current focus, next steps, feature status. **Read first.**
2. Obsidian Architecture — only if touching auth, RLS, storage, or pipeline boundaries.
3. Obsidian Feature Spec — `Feature - AI Assess Pipeline.md` — only if touching assess/Gemini.

Do not create separate handoff/backlog/shipped docs — update PRD §0/§6/§9 instead.

If your change conflicts with Architecture or the PRD, stop and surface it before coding.

## Hard rules (do not break)

- **One AI model, one provider.** Gemini 2.5 Flash via `@google/genai`. Swap the constant at top of `gemini.ts` if needed; don't add Anthropic / OpenAI fallbacks.
- **All response parsing is Zod-validated.** Never trust raw model JSON.
- **RLS on every user-visible table** (`trees`, `assessments`, `rate_limits`, Storage `photos` bucket). No service-role key in user-facing routes.
- **photoPath ownership check before any Storage download.** `photoPath.startsWith(user.id + "/")`.
- **All error responses are generic strings.** Log details server-side via `console.error`, never leak to clients.
- **Rate limit /api/assess at 5/user/hour.** Constant `ASSESS_LIMIT_PER_HOUR`.
- **Build script must `unset NODE_ENV`** before `next build`. Don't remove it.
- **Trunk-based.** Commit directly to `main`. CI gates push.
- **No new files just because.** Edit existing files first. Files >250 lines → consider splitting.
- **No `tags:` field in any new Obsidian doc.** Frontmatter is `date / last_updated / purpose / parent / related / status / sources`.

## Session-end maintenance

Before logout, if you touched code or shipped a feature:

1. Update the Obsidian PRD §0 + §9 (status, commit SHA).
2. Add a row to the Obsidian Security Assessment Log if security-relevant.
3. If you locked a new architecture decision, add it to Obsidian Architecture §"Locked decisions" with the Decision/Why/Trade-off format.
4. If you learned something non-obvious, add a note under `Project RESOURCES/Citrus Care v1/What I learned/`.

## Triage when no specific task is given

If the user drops the PRD path with no instruction, ask which mode:
- **A** — New feature
- **B** — Fix a bug
- **C** — Continue from where I left off (read latest commits + open todos)
- **D** — Summarize current state
- **E** — Something else

Don't pick for the user.

## Environment

Required env vars (set in `.env.local` and Vercel — see `Project RESOURCES/Citrus Care v1/Citrus Care Secrets (DO NOT SHARE).md`):
- `GEMINI_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- Google OAuth configured in Supabase Dashboard + Google Cloud Console
