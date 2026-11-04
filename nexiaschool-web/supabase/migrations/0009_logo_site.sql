-- Identité de l'établissement : site web et logo (bulletins, barre de l'application).
-- Le logo est rangé dans le compartiment privé « logos » : <etablissement_id>/logo-<horodatage>.(png|jpg|webp),
-- lisible par le personnel de l'établissement, modifiable par l'administration.

alter table public.etablissements add column if not exists site_web text not null default ''
  check (char_length(site_web) <= 200 and (site_web = '' or site_web ~* '^https?://[a-z0-9-]+(\.[a-z0-9-]+)+(:[0-9]+)?(/[^\s]*)?$'));
alter table public.etablissements add column if not exists logo text
  check (logo is null or logo ~ ('^' || id::text || '/logo-[0-9]+\.(png|jpg|webp)$'));
grant select (site_web, logo) on public.etablissements to authenticated;
grant update (site_web, logo) on public.etablissements to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', false, 524288, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 524288, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

create policy "logos : lecture par le personnel de l'établissement" on storage.objects for select to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = (select public.etab_courant())::text);
create policy "logos : ajout par l'administration" on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = (select public.etab_courant())::text and (select public.est_admin()));
create policy "logos : remplacement par l'administration" on storage.objects for update to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = (select public.etab_courant())::text and (select public.est_admin()))
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = (select public.etab_courant())::text);
create policy "logos : suppression par l'administration" on storage.objects for delete to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = (select public.etab_courant())::text and (select public.est_admin()));

-- « www.ecole.cm » -> « https://www.ecole.cm » ; vide -> vide ; adresse invalide -> erreur lisible
create or replace function public._normaliser_site(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare s text := btrim(coalesce(p, ''));
begin
  if s = '' then return ''; end if;
  if s !~* '^https?://' then s := 'https://' || s; end if;
  s := regexp_replace(s, '/+$', '');
  if char_length(s) > 200 or s !~* '^https?://[a-z0-9-]+(\.[a-z0-9-]+)+(:[0-9]+)?(/[^\s]*)?$' then
    raise exception 'Adresse du site web invalide : « % » (exemple : www.monecole.cm).', p using errcode = 'P0001';
  end if;
  return lower(substring(s from '^https?://[^/]+')) || substring(s from '^https?://[^/]+(.*)$');
end $$;

-- Création de l'espace : ajoute le site web et renvoie l'identifiant (pour l'envoi du logo juste après)
drop function if exists public.creer_etablissement_google(text, text, text, text, text, text, text, text);
create or replace function public.creer_etablissement_google(p_nom text, p_ville text, p_adresse text, p_telephone text,
                                                             p_devise text, p_nom_chef text, p_admin_nom text, p_admin_prenom text,
                                                             p_site_web text default '')
returns json language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid; code_etab text := public._generer_code(8); v_site text := public._normaliser_site(p_site_web);
begin
  if auth.uid() is null or coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') <> 'google' then
    raise exception 'Connectez-vous d''abord avec votre compte Google.' using errcode = '42501';
  end if;
  if exists (select 1 from public.personnels where id = auth.uid()) then
    raise exception 'Ce compte Google gère déjà un établissement.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.etablissements where cree_le > now() - interval '1 day') >= 100 then
    raise exception 'Limite quotidienne de créations atteinte. Réessayez demain.' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_nom, ''))) < 3 or char_length(btrim(coalesce(p_admin_nom, ''))) < 1 then
    raise exception 'Indiquez le nom complet de l''établissement et votre nom.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.etablissements where nom_normalise = public._normaliser(p_nom)) then
    raise exception 'Un établissement porte déjà ce nom (accents et majuscules ignorés).' using errcode = 'P0001';
  end if;
  insert into public.etablissements (nom, nom_normalise, ville, adresse, telephone, devise, nom_chef, site_web, code_hash)
  values (btrim(p_nom), public._normaliser(p_nom), left(btrim(coalesce(p_ville, '')), 100), left(btrim(coalesce(p_adresse, '')), 200),
          left(btrim(coalesce(p_telephone, '')), 50), left(btrim(coalesce(p_devise, '')), 200), left(btrim(coalesce(p_nom_chef, '')), 150),
          v_site, public._hacher(code_etab))
  returning id into v_etab;
  insert into public.personnels (id, etablissement_id, nom, prenom, role, compte_google, code_hash)
  values (auth.uid(), v_etab, upper(left(btrim(p_admin_nom), 150)), left(btrim(coalesce(p_admin_prenom, '')), 150), 'admin', true,
          public._hacher(encode(extensions.gen_random_bytes(16), 'hex')));
  return json_build_object('id', v_etab, 'etablissement', btrim(p_nom), 'code_etablissement', code_etab);
end $$;
revoke execute on function public.creer_etablissement_google(text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.creer_etablissement_google(text, text, text, text, text, text, text, text, text) to authenticated;
revoke execute on function public._normaliser_site(text) from public, anon;
grant execute on function public._normaliser_site(text) to authenticated;

-- Le site web saisi dans les paramètres est normalisé de la même façon
create or replace function public.normaliser_site_etablissement() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.site_web := public._normaliser_site(new.site_web);
  return new;
end $$;
create trigger site_web_normalise before insert or update of site_web on public.etablissements
  for each row execute function public.normaliser_site_etablissement();

-- Une matière ne peut être confiée qu'à un enseignant (ou à l'administration) actif de l'établissement
create or replace function public.verifier_enseignant_attribution() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.enseignant_id is not null and not exists (
       select 1 from public.personnels p where p.id = new.enseignant_id and p.etablissement_id = new.etablissement_id
          and p.actif and p.role in ('enseignant', 'admin')) then
    raise exception 'Une matière ne peut être confiée qu''à un enseignant ou à l''administration (pas au surveillant général).' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger attribution_enseignant_valide before insert or update of enseignant_id on public.attributions
  for each row execute function public.verifier_enseignant_attribution();
