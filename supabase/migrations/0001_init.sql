-- Citrus Care: initial schema
-- Run in Supabase SQL editor on a fresh project.

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Auto-create a profile row on signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- trees
-- ------------------------------------------------------------
create table if not exists public.trees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  cultivar text,
  location text,
  cover_assessment_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists trees_user_id_idx on public.trees(user_id);

alter table public.trees enable row level security;

create policy "trees_select_own" on public.trees
  for select using (auth.uid() = user_id);

create policy "trees_insert_own" on public.trees
  for insert with check (auth.uid() = user_id);

create policy "trees_update_own" on public.trees
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "trees_delete_own" on public.trees
  for delete using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- assessments
-- ------------------------------------------------------------
create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references public.trees(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  photo_path text not null,
  created_at timestamptz not null default now(),
  health_score int not null check (health_score between 0 and 100),
  symptoms jsonb not null default '[]'::jsonb,
  diagnosis jsonb not null default '{}'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  compared_to_assessment_id uuid references public.assessments(id) on delete set null,
  raw_output text
);

create index if not exists assessments_tree_id_idx on public.assessments(tree_id);
create index if not exists assessments_user_id_idx on public.assessments(user_id);
create index if not exists assessments_tree_created_idx
  on public.assessments(tree_id, created_at desc);

alter table public.assessments enable row level security;

create policy "assessments_select_own" on public.assessments
  for select using (auth.uid() = user_id);

create policy "assessments_insert_own" on public.assessments
  for insert with check (auth.uid() = user_id);

create policy "assessments_delete_own" on public.assessments
  for delete using (auth.uid() = user_id);

-- Now that assessments exists, add the FK from trees.cover_assessment_id.
alter table public.trees
  drop constraint if exists trees_cover_assessment_id_fkey;
alter table public.trees
  add constraint trees_cover_assessment_id_fkey
  foreign key (cover_assessment_id) references public.assessments(id) on delete set null;
