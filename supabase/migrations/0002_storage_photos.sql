-- Citrus Care: photos storage bucket + per-user RLS.
-- Run after 0001_init.sql.

insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

-- Per-user folder convention: object name starts with "<user_id>/...".
drop policy if exists "photos_read_own" on storage.objects;
create policy "photos_read_own" on storage.objects
  for select using (
    bucket_id = 'photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "photos_insert_own" on storage.objects;
create policy "photos_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "photos_delete_own" on storage.objects;
create policy "photos_delete_own" on storage.objects
  for delete using (
    bucket_id = 'photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
