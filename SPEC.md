# SPEC: Citrus Care PWA

## Objective

A photo-driven citrus tree care app. Users snap a leaf or tree photo, a vision-AI returns a structured diagnosis (symptoms, likely causes, prioritized actions), and every tree keeps a timeline of assessments. Re-assessing months later produces a comparison: better/worse vs last time, and what to do next.

**Target user:** anyone caring for citrus trees at home (lemon, orange, lime, etc.) who wants more than one-shot photo ID.

**Why this exists:** PictureThis wins one-shot diagnosis, Planta wins scheduling, but none combine per-tree timelines with AI progress comparison. This MVP fills that gap, citrus-tuned.

## Success criteria

- A signed-in user can add a citrus tree, capture a photo, and receive a structured assessment in <15s.
- The assessment surfaces health score (0-100), top symptoms, likely causes (with rationale), and 1-3 prioritized actions.
- A second assessment of the same tree shows an explicit comparison: "vs last assessment" delta and refined recommendations.
- All trees and assessments are private to the user (RLS enforced).
- Installable PWA on mobile Safari and Chrome.
- Lighthouse PWA score >= 90.
- All Vitest unit tests green; Playwright happy-path e2e green.

## Tech stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS 4 + shadcn/ui
- Supabase: Auth, Postgres (RLS), Storage bucket for photos
- Anthropic Claude vision (`claude-sonnet` family) via server API route
- Vitest (unit) + Playwright (e2e)
- Deploy: Vercel

## Commands

```
npm run dev       # Next dev (port 3002, since 3000/3001 are taken locally)
npm run build     # Production build
npm run lint      # ESLint
npm test          # Vitest
npx playwright test # E2e
```

## Project structure

```
app/
  _lib/
    claude.ts            # Vision call + citrus expert prompt
    supabase/
      server.ts          # Server (RSC + route handler) client
      client.ts          # Browser client
    types.ts             # Shared Assessment/Tree types
  api/
    assess/route.ts      # POST: photo + treeId -> assessment
  (auth)/
    login/page.tsx
    signup/page.tsx
  (protected)/
    trees/
      page.tsx           # List
      new/page.tsx       # Add tree
      [id]/
        page.tsx         # Tree detail + timeline
        assess/page.tsx  # Capture + run assessment
  layout.tsx
  page.tsx               # Landing
supabase/
  migrations/            # SQL migrations
components/
  ui/                    # shadcn primitives
  TreeCard.tsx
  AssessmentCard.tsx
  PhotoCapture.tsx
public/
  manifest.json
  sw.js                  # Service worker
tests/
  unit/                  # Vitest
  e2e/                   # Playwright
```

## Code style

- TypeScript strict mode.
- Functions <50 lines, files <200 lines (refactor at 200, hard cap 300).
- Named exports for components, default export only for Next.js pages/layouts.
- Server actions or route handlers for mutations — no direct DB calls in client components.
- All Supabase queries pass user-scoped client; never bypass RLS in server code.
- Path alias `@/*` -> project root.
- No `any`. Use Zod for input validation at API boundaries.

```ts
// Example component shape
export function TreeCard({ tree }: { tree: Tree }) {
  return <Link href={`/trees/${tree.id}`}>{tree.name}</Link>;
}
```

## Testing strategy

- **Unit (Vitest):** pure functions, Claude prompt builder, response parsers, Zod schemas.
- **E2e (Playwright):** happy paths — login, add tree, capture photo (mocked file), see assessment (mocked AI response).
- **AI mocked in tests:** never call the real Claude API in CI — inject a mock response via env flag or DI.
- Coverage target: 70% lines for `app/_lib/`.

## Boundaries

**Always:**
- Run `npm test && npm run build` before commits that touch logic.
- Validate API inputs with Zod.
- Enforce auth on every protected route + API call.
- Keep AI prompt content in one file (`app/_lib/claude.ts`) — single source of truth.

**Ask first:**
- Adding paid third-party deps.
- Schema changes after first deploy.
- Changing the AI model.
- Pricing/billing changes (deferred — not in MVP).

**Never:**
- Commit `.env*` or any secret.
- Call Anthropic from the browser.
- Bypass RLS with the service role key in user-facing code paths.
- Store photos outside Supabase Storage (no embedding base64 in DB).

## Out of scope (MVP)

- Stripe / paywall (auth ships, billing later).
- Push notifications / care reminders.
- Plants beyond citrus (schema supports expansion).
- Expert chat / social / sharing.

## Open questions

None at SPEC approval — deploy = Vercel, location = this repo.
