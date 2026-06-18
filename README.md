# Citrus Care PWA

Photo-driven citrus tree care. Snap a leaf, get a structured AI diagnosis, track each tree over time.

## Setup

1. **Install**
   ```bash
   npm install
   ```

2. **Supabase**
   - Create a free project at supabase.com
   - In SQL editor, run every file in `supabase/migrations/` in order
   - Create a public storage bucket named `photos`

3. **Environment** (`.env.local`)
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
   ANTHROPIC_API_KEY=sk-ant-...
   ```

4. **Run**
   ```bash
   npm run dev    # http://localhost:3002
   npm test       # Vitest
   npx playwright test
   ```

## Docs

- [SPEC.md](./SPEC.md) — what we are building and success criteria
- [tasks/plan.md](./tasks/plan.md) — implementation plan
- [tasks/todo.md](./tasks/todo.md) — task status

## Deploy

Vercel — connect repo, add the four env vars above, deploy.

## Known gotchas

- If `npm run build` fails with `Cannot read properties of null (reading 'useContext')` on `/_global-error`, your shell has `NODE_ENV=development` exported. The build script already unsets it; if you call `next build` directly, do `unset NODE_ENV` first. ([Next.js issue #87719](https://github.com/vercel/next.js/issues/87719))
