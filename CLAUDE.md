# CLAUDE.md — Citrus Care v1

## What this is
Photo-driven plant care, **fully on-device (D-17)**. User snaps a leaf / whole-plant / pruning-cut photo in the Android app; **Gemma 4 E2B, running on the phone**, returns a structured diagnosis (health score, subject, symptoms, causes, ranked actions); each plant has a timeline; re-assessment shows better/same/worse vs the prior (computed deterministically from the health scores). **Nothing leaves the phone** — no accounts, no server, no cloud AI. The web app is a static marketing landing that hands out the APK.

## Tech Stack
- **Product:** Expo/React Native Android app (`apps/mobile`) — THE product, fully local
- **Backend:** **none.** No server, no database, no auth, no secrets.
- **On-device AI:** `react-native-executorch` + Gemma 4 E2B multimodal (~1.3 GB, Apache-2.0). Diagnosis (image) + care profile (text-only) on one session (FIFO mutex). No cloud fallback.
- **Storage:** on-device only — AsyncStorage keyed stores (`plant-store` / `assessment-store` / watering log / photo index) + photo files under app documents.
- **Web:** Next.js 16 (App Router), React 19, Tailwind CSS 4 — static landing only
- **Testing:** Vitest (unit, pure modules), Playwright (e2e, landing only)
- **CI:** GitHub Actions (typecheck + lint + vitest on push/PR)
- **Deploy:** Fly.io deploys the static landing only

## Repo structure (monorepo — D-17)
- `apps/mobile/` — THE product: Expo/React Native app. **Not an npm workspace** — own `npm install` (React version isolation). Local data layer: pure stores + `*-io.ts` AsyncStorage wiring; `plants-io.ts` orchestrates reads/writes and feeds the *unchanged* list/detail mappers via `store-adapters.ts`.
- `apps/web/` — **fully static** marketing landing (+ `/privacy`, `/api/health`). No API routes, no rewrites.
- `packages/shared/` — types + Zod schemas (`@citrus/shared`), consumed by mobile + web tests
- `supabase/` — migrations kept as HISTORY only; the hosted project is dormant and unused. (**There is no live database.**)
- Root `Dockerfile` + `fly.toml` deploy `apps/web`
- **`apps/api/` is DELETED** (the whole backend is gone).

## Commands (repo root — web only; mobile has its own)
```bash
npm run dev               # web landing (3002)
npm run build             # web production build
npm run lint              # ESLint (web)
npm test                  # Vitest (web)
npm run e2e               # Playwright e2e (landing)
npm run typecheck         # tsc --noEmit (web)
# Mobile: cd apps/mobile && npm start | npx tsc --noEmit | npx vitest run | npx expo export --platform android
```

## Path Aliases
- `@/*` → `apps/web/` root (within the web app)
- `@citrus/shared` → `packages/shared/src`

## Key Files
- `apps/mobile/src/lib/assess.ts` — the assess flow: local save FIRST → run Gemma → persist locally. No cloud fallback; failures are terminal + retryable. 25s slow-hint / 120s interrupt ceiling.
- `apps/mobile/src/lib/spike-vlm.ts` — the on-device diagnosis prompt + tolerant JSON extractor + shared-schema parse.
- `apps/mobile/src/lib/care-profile-local.ts` + `care-profile-io.ts` — F20 care profile generated on-device (text-only Gemma), stored on the plant.
- `apps/mobile/src/lib/plant-store.ts` / `assessment-store.ts` (pure) + `plants-io.ts` — the local data layer; `store-adapters.ts` feeds the unchanged list/detail mappers (`plants.ts` / `plant-detail.ts`).
- `apps/mobile/src/lib/assessment-store.ts` `withComputedComparison` — the deterministic better/same/worse trend (replaces Gemini's `comparison`).
- `apps/mobile/src/lib/backup.ts` + `backup-io.ts` — manual JSON export/import (data-only; photos stay on the phone).
- `apps/mobile/src/components/LocalEngine{Provider,Session}.tsx` — the executorch session, FIFO mutex, interrupt.
- `apps/mobile/src/lib/photo-store.ts` + `photo-store-io.ts` — on-phone photo files + AsyncStorage index.
- `apps/web/app/_content/landing.ts` + `components/landing/LandingPage.tsx` + `app/privacy/page.tsx` — the static landing.
- `apps/mobile/src/lib/*.test.ts` — pure modules only (stores, adapters, assess, care-profile, backup, watering, timelines).
- `apps/web/tests/e2e/landing.spec.ts` — landing + privacy render; `/plants` 404s.

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
2. Obsidian Architecture §"Locked decisions" — **D-17 is current** (zero-backend, Gemma-only); only if touching the AI/data/engine boundaries.

Do not create separate handoff/backlog/shipped docs — update PRD §0/§6/§9 instead.

If your change conflicts with Architecture or the PRD, stop and surface it before coding.

## Hard rules (do not break) — D-17

- **One AI, and it runs on the phone.** Gemma 4 E2B via `react-native-executorch`. **No cloud AI** — do not add Gemini/OpenAI/Anthropic or any server model. (Supersedes the old "Gemini only" rule.)
- **No backend, no accounts, no secrets.** There is no server, no Supabase, no auth. Do not reintroduce a database, a login, or an API key. All data is on-device (AsyncStorage + app-documents files).
- **All model output is Zod-validated** with the shared schema, via the tolerant extractor (the local model has no `responseSchema`). Never trust raw JSON.
- **No cloud fallback.** An on-device failure (not-ready / OOM / unreadable / timeout) is a terminal, honest, retryable error — never a silent escalation. Keep the 25s slow-hint / 120s interrupt ceiling.
- **The single model session runs one request at a time** (FIFO mutex in `LocalEngineProvider`) — a diagnosis and a care-profile call must not overlap.
- **Nothing leaves the phone.** The only network calls are the model download and anonymous Open-Meteo weather. Do not add analytics, uploads, or telemetry.
- **User-facing errors are generic/honest strings.** Log details via `console.error`, never surface raw model/runtime text.
- **Backup is data-only.** Export/import carries plants/assessments/watering/photo-index; photo binaries stay on the phone. Import must never overwrite existing local data.
- **Trunk-based.** CI gates push. (Currently on branch `feat/on-device-router-and-weather-foundation`, PR #1.)
- **No new files just because.** Edit existing files first. Files >250 lines → consider splitting.
- **No `tags:` field in any new Obsidian doc.** Frontmatter is `date / last_updated / purpose / parent / related / status / sources`.
- **Pure/`-io` split for anything touching AsyncStorage or expo.** The pure `<name>.ts` (logic, tested with vitest) never imports react-native/expo; the thin `<name>-io.ts` holds all the wiring and is untested by policy (exercised via `expo export`). Reads degrade to empty/default; writes throw.
- **`supabase/migrations/*` are frozen history.** The DB is dormant — do not add migrations or write SQL. (The old "apply migrations to the live DB" rule is retired with the backend.)

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

**No secrets.** The product needs no API keys, no Supabase URL/anon key, no Google client IDs — all of that was deleted with the backend (D-17). The mobile app is self-contained; the web landing is static. The only runtime network dependencies are the Gemma model download (in-app, over Wi-Fi) and anonymous Open-Meteo weather lookups.
