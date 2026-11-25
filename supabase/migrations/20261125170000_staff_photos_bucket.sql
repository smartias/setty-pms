-- Staff photos for the PMS Staff directory.
--
-- A staff record (pms_meta.data.staff[]) carries only `photoPath`; the picture
-- is a 256px square JPEG, cropped and shrunk in the browser before upload, kept
-- in this bucket as <staffId>/<timestamp>.jpg. SettyPMS.html shows it wherever
-- a person appears (StaffAvatar) and falls back to initials without one.
--
-- The bucket is PUBLIC for reading: anyone who has a photo's address can open
-- it without signing in, which is what lets a plain <img> tag show it. The
-- address holds two random-looking parts and is not listed anywhere public,
-- but treat the photos as no more private than a headshot on the company site.
--
-- Writing is limited to the people who can already edit the staff directory:
-- the same projects.edit capability that guards pms_meta. The 1 MB cap and the
-- type list are enforced by Storage itself, whatever the page sends.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-photos', 'staff-photos', true, 1048576, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Storage needs SELECT on a row to delete or replace it. Signed-in users only;
-- the public address above does not go through this policy.
drop policy if exists "staff_photos select" on storage.objects;
create policy "staff_photos select" on storage.objects
  for select to authenticated
  using (bucket_id = 'staff-photos');

drop policy if exists "staff_photos insert" on storage.objects;
create policy "staff_photos insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'staff-photos' and public.pms_has_cap('projects.edit', null));

drop policy if exists "staff_photos update" on storage.objects;
create policy "staff_photos update" on storage.objects
  for update to authenticated
  using (bucket_id = 'staff-photos' and public.pms_has_cap('projects.edit', null))
  with check (bucket_id = 'staff-photos' and public.pms_has_cap('projects.edit', null));

drop policy if exists "staff_photos delete" on storage.objects;
create policy "staff_photos delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'staff-photos' and public.pms_has_cap('projects.edit', null));
