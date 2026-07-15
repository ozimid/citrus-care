-- D-16 simplification pivot: photos live only on the phone. The escalation
-- request carries the JPEG directly to Gemini and nothing is written to any
-- storage bucket, so new assessment rows persist with photo_path null.
-- Old rows keep their bucket paths (unread, retained per the never-delete rule).
alter table public.assessments alter column photo_path drop not null;
