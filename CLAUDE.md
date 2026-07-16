# CLAUDE.md — Citrus Care v1

## What this is
Photo-driven plant care, native-app-first (D-16). User snaps a leaf/tree photo in the Android app, Gemini 2.5 Flash returns a structured diagnosis (health score, symptoms, causes, ranked actions); each plant has a timeline; re-assessment shows better/same/worse vs the prior. **Photos live only on the phone** — a photo travels the network exactly once, inside the `/assess` request body, and is never stored server-side. The web app is a static marketing landing.

## Tech Stack
- **Product:** Expo/React Native Android app (`apps/mobile`)
- **Backend:** standalone Hono service (`apps/api`) for the AI pipeline (`/assess`)
- **Web:** Next.js 16 (App Router), React 19, Tailwind CSS 4 — static landing only
- **AI:** Google Gemini API (`@google/genai`, model `gemini-2.5-flash`, structured output via `responseSchema`)
- **Database:** Supabase (Postgres + Auth + RLS on every user-visible table; no Storage use since D-16)
- **Auth:** Google sign-in via Supabase (native Google SDK in the mobile app)
- **Testing:** Vitest (unit), Playwright (e2e, landing only)
- **CI:** GitHub Actions (typecheck + lint + vitest on push/PR)
- **Deploy:** Fly.io (`fly.toml` in repo root)

## Repo structure (monorepo — strict separation, decision D-12)
- `apps/mobile/` — THE product: Expo/React Native app (D-11). **Not an npm workspace** — own `npm install` inside the folder (React version isolation). Local-first photo store: `src/lib/photo-store.ts` (pure, tested) + `photo-store-io.ts` (expo-file-system/AsyncStorage wiring)
- `apps/api/` — standalone Hono backend service (D-13): AI pipeline (`/assess`, Bearer or cookie auth). Dev port 3003
- `apps/web/` — static marketing landing; keeps the `/api/assess` rewrite to apps/api (the phone reaches the API through port 3002 in dev) and `/api/health`
- `packages/shared/` — types + Zod schemas (`@citrus/shared`), consumed by mobile + web tests
- `supabase/` — database: migrations, RLS (0005 made `assessments.photo_path` nullable — new rows write null)
- Root `Dockerfile` + `fly.toml` deploy `apps/web`

## Commands (run from repo root — proxies to apps/web)
```bash
npm run dev               # web (3002) + api (3003) via concurrently
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
- `apps/api/src/gemini.ts` — Gemini vision call + expert prompt (Zod schema in `packages/shared`)
- `apps/api/src/rate-limit.ts` — Postgres `rate_limits` table helper (`tryConsume`)
- `apps/api/src/routes/assess.ts` — main AI endpoint. Body `{plantId, imageBase64, mime: "image/jpeg", isCutCare?}`; order: parse (incl. 3MB decoded-size cap) · auth · rate limit · plant RLS lookup · Gemini · Zod · insert (photo_path null) · cover update
- `apps/api/src/auth.ts` — Bearer-or-cookie auth → RLS-scoped Supabase client
- `apps/mobile/src/lib/assess.ts` — mobile assess flow: local save FIRST, then direct-image escalation, then photo-index link (engine seam for D-15)
- `apps/mobile/src/lib/photo-store.ts` + `photo-store-io.ts` — on-phone photo files (`photos/{plantId}/…`) + AsyncStorage index (assessmentId → localUri)
- `apps/web/app/page.tsx` + `components/landing/` — the landing (all that's left of the web surface)
- `supabase/migrations/*.sql` — schema, RLS, rate_limits, photo_path nullable (0005)
- `apps/api/tests/*.test.ts` — assess contract (size cap, generic errors), prompts, rate limit
- `apps/mobile/src/lib/*.test.ts` — photo store/index, assess flow, timelines, mutations
- `apps/web/tests/e2e/landing.spec.ts` — landing renders; `/plants` 404s

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

Two rules from the Vibe Coding template that apply to ALL builds, including subagent-delegated ones:
- **Test-first, even in subagents.** Delegated implementation prompts must require a failing test before the implementation (red → green), not tests written alongside.
- **E2e runs are demo evidence.** Playwright records video on every run (`video: "on"`); recordings land in `apps/web/test-results/` (gitignored) — reference them when demoing a feature.

## Required reads before any code change
1. Obsidian PRD **§0** — `.../Citrus Care/Citrus Care PRD v1.md` — current focus, next steps, feature status. **Read first.**
2. Obsidian Architecture — only if touching auth, RLS, storage, or pipeline boundaries.
3. Obsidian Feature Spec — `Feature - AI Assess Pipeline.md` — only if touching assess/Gemini.

Do not create separate handoff/backlog/shipped docs — update PRD §0/§6/§9 instead.

If your change conflicts with Architecture or the PRD, stop and surface it before coding.

## Hard rules (do not break)

- **One AI model, one provider.** Gemini 2.5 Flash via `@google/genai`. Swap the constant at top of `gemini.ts` if needed; don't add Anthropic / OpenAI fallbacks.
- **All response parsing is Zod-validated.** Never trust raw model JSON.
- **RLS on every user-visible table** (`plants`, `assessments`, `rate_limits`). No service-role key in user-facing routes.
- **Photos never reach a server-side store (D-16).** `/assess` takes the image in the request body (3MB decoded cap, jpeg only) and inserts `photo_path: null`; the phone's photo-store is the only copy.
- **All error responses are generic strings.** Log details server-side via `console.error`, never leak to clients.
- **Rate limit /api/assess at 5/user/hour.** Constant `ASSESS_LIMIT_PER_HOUR`.
- **Build script must `unset NODE_ENV`** before `next build`. Don't remove it.
- **Trunk-based.** Commit directly to `main`. CI gates push.
- **No new files just because.** Edit existing files first. Files >250 lines → consider splitting.
- **No `tags:` field in any new Obsidian doc.** Frontmatter is `date / last_updated / purpose / parent / related / status / sources`.
- **A new migration is not "done" until it is applied to the live DB.** There is no CLI/link here — the user runs the SQL by hand in the Supabase dashboard. Shipping a `select` that names a new column before that lands makes PostgREST reject the WHOLE query (error `42703`), which looks exactly like "all my data is gone". Whenever a commit adds `supabase/migrations/*`, hand the user the SQL in the same breath.

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

Required env vars (set in `apps/web/.env.local`, read by apps/api in dev — see `Project RESOURCES/Citrus Care v1/Citrus Care Secrets (DO NOT SHARE).md`):
- `GEMINI_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Google sign-in configured in Supabase Dashboard + Google Cloud Console (native SDK client for the app)
