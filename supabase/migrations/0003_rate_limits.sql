-- Citrus Care: per-user rate limit buckets + atomic consume RPC.
-- Run after 0002_storage_photos.sql.
--
-- One row per (user_id, key, window_start). consume_rate_limit() atomically
-- increments the bucket for the current window and returns count + remaining.

create table if not exists public.rate_limits (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  key          text        not null,
  window_start timestamptz not null,
  count        int         not null default 0,
  primary key (user_id, key, window_start)
);

alter table public.rate_limits enable row level security;

drop policy if exists "rl_select_own" on public.rate_limits;
create policy "rl_select_own" on public.rate_limits
  for select using (auth.uid() = user_id);

-- Writes happen through the SECURITY DEFINER RPC below, not directly.

create index if not exists rate_limits_window_idx
  on public.rate_limits (user_id, key, window_start desc);

create or replace function public.consume_rate_limit(
  _key         text,
  _limit       int,
  _window_sec  int
)
returns table (count int, allowed boolean, retry_after_sec int)
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid           uuid;
  _window_start  timestamptz;
  _window_end    timestamptz;
  _new_count     int;
begin
  _uid := auth.uid();
  if _uid is null then
    raise exception 'not authenticated';
  end if;

  _window_start := to_timestamp(
    (floor(extract(epoch from now()) / _window_sec) * _window_sec)::bigint
  );
  _window_end := _window_start + (_window_sec || ' seconds')::interval;

  insert into public.rate_limits (user_id, key, window_start, count)
  values (_uid, _key, _window_start, 1)
  on conflict (user_id, key, window_start)
    do update set count = public.rate_limits.count + 1
  returning public.rate_limits.count into _new_count;

  count := _new_count;
  allowed := _new_count <= _limit;
  retry_after_sec := case
    when allowed then 0
    else greatest(1, ceil(extract(epoch from _window_end - now()))::int)
  end;
  return next;
end;
$$;

revoke all on function public.consume_rate_limit(text, int, int) from public;
grant execute on function public.consume_rate_limit(text, int, int) to authenticated;
