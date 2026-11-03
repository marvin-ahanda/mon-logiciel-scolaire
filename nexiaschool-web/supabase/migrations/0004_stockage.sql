-- Photos des élèves : compartiment privé (plan Free : 1 Go au total ; photos réduites à 400 px côté navigateur,
-- 300 Ko au plus). Chemin : <etablissement_id>/<eleve_id>.jpg ; accès limité à son établissement.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 307200, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 307200, allowed_mime_types = array['image/jpeg'];

create policy "photos : lecture par le personnel de l'établissement" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select public.etab_courant())::text);
create policy "photos : ajout par l'administration" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select public.etab_courant())::text
              and (select public.est_admin()));
create policy "photos : remplacement par l'administration" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select public.etab_courant())::text and (select public.est_admin()))
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select public.etab_courant())::text);
create policy "photos : suppression par l'administration" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select public.etab_courant())::text and (select public.est_admin()));
