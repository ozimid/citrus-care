# CLAUDE.md — Citrus Care v1

## What this is
Photo-driven citrus tree care PWA. User snaps a leaf/tree photo, Gemini 2.5 Flash returns a structured diagnosis (health score, symptoms, causes, ranked actions); each tree has a timeline; re-assessment shows better/same/worse vs the prior.

## Tech Stack
- **Frontend:** Next.js 16 (App Router), React 19, Tailwind CSS 4, shadcn/ui (`@base-ui/react` primitives)
- **Backend:** Next.js Route Handlers + Server Actions
- **AI:** Google Gemini API (`@google/genai`, model `gemini-2.5-flash`, structured output via `responseSchema`)
- **Database:** Supabase (Postgres + Auth + Storage + RLS on every user-visible table)
- **CAPTCHA:** Cloudflare Turnstile on signup (via Supabase Auth `options.captchaToken`)
- **Testing:** Vitest (unit), Playwright (e2e)
- **CI:** GitHub Actions (typecheck + lint + vitest on push/PR)
- **Deploy:** Vercel (Hobby tier)

## Commands
```bash
npm run dev               # Next dev (port 3002)
npm run build             # Production build — note: build script does `unset NODE_ENV` before next build
npm run lint              # ESLint
npm test                  # Vitest (run mode)
npx playwright test       # E2e
npx tsc --noEmit          # Typecheck
```

## Path Aliases
- `@/*` → project root

## Key Files
- `app/_lib/gemini.ts` — Gemini vision call + citrus expert prompt + Zod + responseSchema
- `app/_lib/rate-limit.ts` — Postgres `rate_limits` table helper (`tryConsume`)
- `app/_lib/supabase/{client,server,middleware}.ts` — Supabase clients
- `app/api/assess/route.ts` — main AI endpoint (auth · ownership · rate limit · download · Gemini · parse · insert)
- `app/(auth)/{login,signup}/...` — auth pages + Turnstile widget
- `app/trees/...` — tree list / new / detail / assess / single-assessment pages
- `proxy.ts` — Next.js 16 proxy (was `middleware.ts`); session refresh + redirects
- `supabase/migrations/*.sql` — schema, RLS, photos bucket, rate_limits
- `tests/unit/*.test.ts` — schemas, prompts, image utils, health bands, assess route, rate limit
- `tests/e2e/*.spec.ts` — landing + protected redirect

## Required reads before any code change
1. Obsidian PRD — `~/Documents/Obsidian Vault/Alex/ARPA/6. FINANCIALS/2. FINANCIALS PROJECTS/3. IN PROGRESS WIP - 1/Citrus Care/Citrus Care PRD v1.md` — feature inventory + shipped status.
2. Obsidian Architecture — `~/Documents/Obsidian Vault/Alex/ARPA/6. FINANCIALS/2. FINANCIALS PROJECTS/3. IN PROGRESS WIP - 1/Citrus Care/Project RESOURCES/Citrus Care v1/Architecture.md` — locked decisions (D-01..D-07).
3. Obsidian Feature Spec — `Project RESOURCES/Citrus Care v1/Feature Specs/Feature - AI Assess Pipeline.md` — full pipeline contract.
4. Obsidian Security Log — `Project RESOURCES/Citrus Care v1/Security Assessment Log.md` — what's been audited and what hasn't.

If your change conflicts with anything in those docs, stop and surface it before coding.

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

1. Update the Obsidian PRD §9 Phased Roadmap (status, commit SHA).
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
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`

Turnstile **secret** key lives in Supabase Dashboard → Auth → Settings → Bot/Abuse Protection → Turnstile, **not** in the app env.
