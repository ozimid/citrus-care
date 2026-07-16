-- F22 (D-15 Stage 2 provenance): which engine produced each assessment.
--
-- The engine badge used to be ephemeral — it rendered on a fresh diagnosis and
-- was lost forever, so a reopened timeline row could not answer "which model
-- produced this?", and there was no way to measure how often the on-device
-- model actually handles a photo versus escalating. This column IS that
-- dataset (Profile shows the last-20 split), and the troubleshooting answer.
--
-- Shape (see assessmentEngineSchema in packages/shared):
--   'on-device'             the phone's Gemma 4 E2B session produced it
--   'gemini'                Gemini produced it; the local engine was never tried
--   'gemini:<reason>'       Gemini produced it AFTER a local attempt was dropped
--                           — local_timeout | local_invalid | local_error
--
-- Nullable on purpose: every row written before F22 stays null and renders as
-- unknown (never counted as Gemini — guessing would poison the go/no-go ratio).
-- Metadata only: nothing branches on this column, which is why /assess can
-- accept it from the phone (the phone is the only thing that knows a local
-- attempt happened) without trusting it for anything else.
alter table public.assessments add column if not exists engine text;

comment on column public.assessments.engine is
  'F22/D-15 provenance: on-device | gemini | gemini:<local_timeout|local_invalid|local_error>. Null = pre-F22 row (unknown). Metadata only — never authorize on this.';

-- RLS unchanged: the existing assessments_{select,insert}_own policies (0001)
-- already scope this column to its owner. engine is a column on an
-- already-guarded table, written through the user's RLS-scoped client on both
-- paths (the phone's direct insert for on-device rows, /assess for Gemini).
