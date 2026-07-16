-- F20 (weather-aware watering): per-plant care baseline.
--
-- Gemini generates this ONCE per plant, at creation (POST /care-profile), and
-- it is reused forever after; the weather adjustment and the next-water date
-- are deterministic math on the phone (apps/mobile/src/lib/watering.ts). Shape
-- is careProfileSchema in packages/shared (jsonb here, Zod-validated at every
-- boundary — on write server-side and on read on the phone).
--
-- Null until a profile has been generated: watering guidance is simply
-- unavailable for that plant, never a hard error.
alter table public.plants add column if not exists care_profile jsonb;

comment on column public.plants.care_profile is
  'F20 care baseline generated once by Gemini at plant creation; shape = careProfileSchema (@citrus/shared). Null = not generated yet.';

-- RLS unchanged: the existing plants_{select,insert,update,delete}_own policies
-- (0001, carried through the 0004 rename) already scope this column to its
-- owner. No new policy needed — care_profile is a column on an already-guarded
-- table, and /care-profile writes it through the user's RLS-scoped client.
