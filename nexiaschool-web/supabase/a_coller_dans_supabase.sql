-- NexIASchool : à coller dans Supabase → SQL Editor → New query, puis « Run ».
-- (Les migrations 0001 et 0002 sont déjà appliquées.)
begin;

-- ===== migrations/0003_fonctions.sql =====
-- Fonctions sécurisées (SECURITY DEFINER) : inscription, entrée dans l'établissement, connexion du personnel,
-- gestion du personnel et des codes. Les codes ne sont jamais stockés en clair (bcrypt via pgcrypto).

-- Utilitaires internes -------------------------------------------------------------------------------------
create or replace function public._normaliser(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(lower(translate(coalesce(p, ''),
    'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÝýÿŒœÆæ',
    'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOOooooooUUUUuuuuYyyOoAa')), '[^a-z0-9]', '', 'g')
$$;

-- Code aléatoire : lettres minuscules sans i, l, o (confondues avec 1 et 0) et chiffres, au moins un de chaque
create or replace function public._generer_code(p_longueur int) returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz0123456789';
  octets bytea; code text;
begin
  loop
    octets := extensions.gen_random_bytes(p_longueur);
    code := '';
    for k in 0 .. p_longueur - 1 loop
      code := code || substr(alphabet, (get_byte(octets, k) % 33) + 1, 1);
    end loop;
    exit when code ~ '[a-z]' and code ~ '[0-9]';
  end loop;
  return code;
end $$;

create or replace function public._hacher(p text) returns text
language sql volatile set search_path = '' as $$ select extensions.crypt(p, extensions.gen_salt('bf', 8)) $$;

create or replace function public._verifier(p text, p_hash text) returns boolean
language sql stable set search_path = '' as $$
  select p_hash is not null and extensions.crypt(coalesce(p, ''), p_hash) = p_hash
$$;

-- Adresse IP du visiteur (en-têtes transmis par Supabase) pour limiter les essais
create or replace function public._ip() returns text
language sql stable set search_path = '' as $$
  select left(coalesce(
    nullif(current_setting('request.headers', true)::json ->> 'cf-connecting-ip', ''),
    nullif(split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1), ''),
    'inconnue'), 100)
$$;

-- Limiteur : renvoie le nombre de minutes de blocage restantes (0 = essai autorisé)
create or replace function public._minutes_de_blocage(p_cle text) returns int
language sql stable set search_path = '' as $$
  select coalesce((select ceil(extract(epoch from (t.bloque_jusqu_a - now())) / 60)::int
                     from public.tentatives t where t.cle = p_cle and t.bloque_jusqu_a > now()), 0)
$$;

create or replace function public._echec(p_cle text, p_max int, p_minutes int) returns void
language plpgsql volatile set search_path = '' as $$
begin
  insert into public.tentatives as t (cle, echecs) values (p_cle, 1)
  on conflict (cle) do update set echecs = t.echecs + 1, maj = now();
  update public.tentatives set echecs = 0, bloque_jusqu_a = now() + make_interval(mins => p_minutes)
   where cle = p_cle and echecs >= p_max;
end $$;

create or replace function public._reussite(p_cle text) returns void
language sql volatile set search_path = '' as $$ delete from public.tentatives where cle = p_cle $$;

-- Compte d'authentification Supabase associé à un membre du personnel (adresse technique, jamais utilisée pour écrire)
create or replace function public._creer_compte_auth(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare email text := 'p-' || p_id::text || '@personnel.nexiaschool.invalid';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', email,
          public._hacher(encode(extensions.gen_random_bytes(32), 'hex')), now(),
          '{"provider": "email", "providers": ["email"]}', '{}', now(), now(), '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (p_id::text, p_id, jsonb_build_object('sub', p_id::text, 'email', email, 'email_verified', true),
          'email', now(), now());
end $$;

create or replace function public._libelle(p_nom text, p_prenom text) returns text
language sql immutable set search_path = '' as $$ select btrim(upper(btrim(p_nom)) || ' ' || btrim(coalesce(p_prenom, ''))) $$;

-- ---------------------------------------------------------------------------------------------------------
-- 1. Création d'un établissement par une personne connectée avec Google : elle en devient l'administrateur
--    fondateur (connexion par Google, sans code personnel). Renvoie le code de l'établissement (affiché une fois).
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.creer_etablissement_google(p_nom text, p_ville text, p_adresse text, p_telephone text,
                                                             p_devise text, p_nom_chef text, p_admin_nom text, p_admin_prenom text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid; code_etab text := public._generer_code(8);
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
  insert into public.etablissements (nom, nom_normalise, ville, adresse, telephone, devise, nom_chef, code_hash)
  values (btrim(p_nom), public._normaliser(p_nom), left(btrim(coalesce(p_ville, '')), 100), left(btrim(coalesce(p_adresse, '')), 200),
          left(btrim(coalesce(p_telephone, '')), 50), left(btrim(coalesce(p_devise, '')), 200), left(btrim(coalesce(p_nom_chef, '')), 150),
          public._hacher(code_etab))
  returning id into v_etab;
  insert into public.personnels (id, etablissement_id, nom, prenom, role, compte_google, code_hash)
  values (auth.uid(), v_etab, upper(left(btrim(p_admin_nom), 150)), left(btrim(coalesce(p_admin_prenom, '')), 150), 'admin', true,
          public._hacher(encode(extensions.gen_random_bytes(16), 'hex')));
  return json_build_object('etablissement', btrim(p_nom), 'code_etablissement', code_etab);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 2. Entrée dans l'espace de l'établissement : nom + code -> jeton appareil (30 jours)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.ouvrir_etablissement(p_nom text, p_code text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare
  cle text := 'etablissement:' || public._ip();
  e record; jeton text; attente int := public._minutes_de_blocage(cle);
begin
  if attente > 0 then
    raise exception 'Trop d''essais erronés depuis cet appareil. Réessayez dans % min.', attente using errcode = 'P0001';
  end if;
  select id, nom, code_hash into e from public.etablissements where nom_normalise = public._normaliser(p_nom);
  -- même temps de réponse que le nom existe ou non (un hachage est calculé dans les deux cas)
  if not public._verifier(lower(btrim(coalesce(p_code, ''))), coalesce(e.code_hash, public._hacher('leurre'))) or e.id is null then
    perform public._echec(cle, 10, 15);
    return json_build_object('erreur', 'Nom ou code de l''établissement incorrect.');
  end if;
  perform public._reussite(cle);
  delete from public.jetons_appareil where expire_le < now();
  jeton := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.jetons_appareil (jeton_hash, etablissement_id, expire_le)
  values (encode(extensions.digest(jeton, 'sha256'), 'hex'), e.id, now() + interval '30 days');
  return json_build_object('etablissement', e.nom, 'jeton', jeton);
end $$;

create or replace function public._etab_du_jeton(p_jeton text) returns uuid
language sql stable security definer set search_path = '' as $$
  select etablissement_id from public.jetons_appareil
   where jeton_hash = encode(extensions.digest(coalesce(p_jeton, ''), 'sha256'), 'hex') and expire_le > now()
$$;

-- Liste du personnel actif de l'établissement (noms seulement), triée de A à Z
create or replace function public.personnels_etablissement(p_jeton text)
returns json language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public._etab_du_jeton(p_jeton);
begin
  if v_etab is null then return json_build_object('erreur', 'jeton'); end if;
  return json_build_object(
    'etablissement', (select nom from public.etablissements where id = v_etab),
    'personnels', coalesce((select json_agg(json_build_object('id', p.id, 'nom', public._libelle(p.nom, p.prenom))
                                            order by public._normaliser(p.nom), public._normaliser(p.prenom), p.id)
                              from public.personnels p where p.etablissement_id = v_etab and p.actif and not p.compte_google), '[]'::json));
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Connexion d'un membre du personnel : jeton + nom choisi + code personnel
--    En cas de succès, un mot de passe de session aléatoire (usage unique) est remis pour Supabase Auth :
--    le code personnel ne peut donc jamais être essayé directement contre l'API d'authentification.
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.connexion_personnel(p_jeton text, p_personnel uuid, p_code text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare
  v_etab uuid := public._etab_du_jeton(p_jeton);
  p record; secret text; attente int;
begin
  if v_etab is null then return json_build_object('erreur', 'jeton'); end if;
  select * into p from public.personnels where id = p_personnel and etablissement_id = v_etab and actif and not compte_google for update;
  if p.id is null then return json_build_object('erreur', 'Choisissez votre nom dans la liste.'); end if;
  if p.bloque_jusqu_a > now() then
    attente := ceil(extract(epoch from (p.bloque_jusqu_a - now())) / 60);
    return json_build_object('erreur', format('Trop de codes erronés : accès bloqué pendant encore %s min. '
                                              'L''administration peut vous remettre un nouveau code.', attente));
  end if;
  if not public._verifier(lower(btrim(coalesce(p_code, ''))), p.code_hash) then
    if p.echecs + 1 >= 5 then
      update public.personnels set echecs = 0, bloque_jusqu_a = now() + interval '15 minutes' where id = p.id;
      return json_build_object('erreur', 'Code incorrect. Après 5 essais erronés, l''accès est bloqué pendant 15 min.');
    end if;
    update public.personnels set echecs = echecs + 1 where id = p.id;
    return json_build_object('erreur', format('Code incorrect. Encore %s essai(s) avant blocage temporaire.', 4 - p.echecs));
  end if;
  secret := encode(extensions.gen_random_bytes(24), 'hex');
  update auth.users set encrypted_password = public._hacher(secret), updated_at = now() where id = p.id;
  update public.personnels set echecs = 0, bloque_jusqu_a = null, derniere_connexion = now() where id = p.id;
  return json_build_object('email', 'p-' || p.id::text || '@personnel.nexiaschool.invalid', 'secret', secret);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 4. Gestion du personnel et des codes (administration de l'établissement)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._exiger_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.est_admin() then raise exception 'Réservé à l''administration de l''établissement.' using errcode = '42501'; end if;
  return public.etab_courant();
end $$;

create or replace function public.creer_personnel(p_nom text, p_prenom text, p_role text, p_matricule text, p_telephone text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin(); v_id uuid := gen_random_uuid(); code text := public._generer_code(6);
begin
  if p_role not in ('admin', 'enseignant', 'surveillant') then raise exception 'Rôle inconnu.' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p_nom, ''))) < 1 then raise exception 'Le nom est obligatoire.' using errcode = 'P0001'; end if;
  if (select count(*) from public.personnels where etablissement_id = v_etab) >= 300 then
    raise exception 'Nombre maximal de comptes atteint (300).' using errcode = 'P0001';
  end if;
  perform public._creer_compte_auth(v_id);
  insert into public.personnels (id, etablissement_id, nom, prenom, role, matricule, telephone, code_hash)
  values (v_id, v_etab, upper(btrim(p_nom)), btrim(coalesce(p_prenom, '')), p_role, btrim(coalesce(p_matricule, '')),
          btrim(coalesce(p_telephone, '')), public._hacher(code));
  return json_build_object('id', v_id, 'nom', public._libelle(p_nom, p_prenom), 'code', code);
end $$;

create or replace function public.modifier_personnel(p_id uuid, p_nom text, p_prenom text, p_role text, p_actif boolean,
                                                     p_matricule text, p_telephone text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin();
begin
  if p_role not in ('admin', 'enseignant', 'surveillant') then raise exception 'Rôle inconnu.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.personnels where id = p_id and etablissement_id = v_etab) then
    raise exception 'Membre du personnel introuvable.' using errcode = 'P0001';
  end if;
  if p_id = auth.uid() and (p_role <> 'admin' or not p_actif) then
    raise exception 'Vous ne pouvez pas retirer vos propres droits d''administration.' using errcode = 'P0001';
  end if;
  update public.personnels set nom = upper(btrim(p_nom)), prenom = btrim(coalesce(p_prenom, '')), role = p_role, actif = p_actif,
         matricule = btrim(coalesce(p_matricule, '')), telephone = btrim(coalesce(p_telephone, ''))
   where id = p_id;
  if not exists (select 1 from public.personnels where etablissement_id = v_etab and actif and role = 'admin') then
    raise exception 'Il doit rester au moins un compte d''administration actif.' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.nouveau_code_personnel(p_id uuid)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin(); code text := public._generer_code(6);
begin
  update public.personnels set code_hash = public._hacher(code), code_genere_le = now(), echecs = 0, bloque_jusqu_a = null
   where id = p_id and etablissement_id = v_etab and actif and not compte_google;
  if not found then raise exception 'Membre du personnel introuvable, désactivé ou connecté par Google.' using errcode = 'P0001'; end if;
  return json_build_object('code', code);
end $$;

create or replace function public.nouveau_code_etablissement()
returns json language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin(); code text := public._generer_code(8);
begin
  update public.etablissements set code_hash = public._hacher(code), code_genere_le = now() where id = v_etab;
  delete from public.jetons_appareil where etablissement_id = v_etab;     -- tous les appareils doivent ressaisir le code
  return json_build_object('code', code);
end $$;

-- Maintien en activité du projet (plan Free : pause après 7 jours sans requête)
create or replace function public.ping() returns text language sql stable set search_path = '' as $$ select 'ok' $$;

-- Droits d'exécution ---------------------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.ouvrir_etablissement(text, text), public.personnels_etablissement(text),
  public.connexion_personnel(text, uuid, text), public.ping() to anon, authenticated;
grant execute on function public.creer_etablissement_google(text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.etab_courant(), public.est_admin(), public.peut_noter(uuid),
  public.creer_personnel(text, text, text, text, text), public.modifier_personnel(uuid, text, text, text, boolean, text, text),
  public.nouveau_code_personnel(uuid), public.nouveau_code_etablissement() to authenticated;

-- ===== migrations/0004_stockage.sql =====
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

-- ===== migrations/0005_discipline.sql =====
-- Discipline : sanctions, infractions, barème de la note de discipline, absences, retards, incidents.
-- Saisie par l'administration ou le surveillant général ; lecture par tout le personnel (note de conduite des bulletins).

create or replace function public.peut_discipline() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.personnels p where p.id = auth.uid() and p.actif and p.role in ('admin', 'surveillant'))
$$;

create table public.sanctions (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  libelle text not null check (char_length(btrim(libelle)) between 1 and 150),
  points_perdus numeric(4, 2) not null default 0 check (points_perdus between 0 and 20),
  unique (etablissement_id, libelle),
  unique (id, etablissement_id)
);

create table public.infractions (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant(),
  libelle text not null check (char_length(btrim(libelle)) between 1 and 200),
  sanction_id uuid not null,
  unique (etablissement_id, libelle),
  unique (id, etablissement_id),
  foreign key (sanction_id, etablissement_id) references public.sanctions (id, etablissement_id) on delete restrict
);

-- Barème : note = note_max − (retards × points_par_retard + heures NJ × points_par_heure + points des sanctions), minimum 0
create table public.parametres_discipline (
  exercice_id uuid primary key,
  etablissement_id uuid not null default public.etab_courant(),
  note_max numeric(4, 2) not null default 20 check (note_max between 1 and 20),
  points_par_retard numeric(4, 2) not null default 0.25 check (points_par_retard between 0 and 20),
  points_par_heure numeric(4, 2) not null default 0.25 check (points_par_heure between 0 and 20),
  foreign key (exercice_id, etablissement_id) references public.exercices (id, etablissement_id) on delete cascade
);

create table public.absences (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant(),
  inscription_id uuid not null,
  sequence_id uuid not null,
  date date not null,
  heures_non_justifiees smallint not null default 0 check (heures_non_justifiees between 0 and 24),
  heures_justifiees smallint not null default 0 check (heures_justifiees between 0 and 24),
  motif text not null default '' check (char_length(motif) <= 200),
  saisi_par uuid default auth.uid(),
  maj timestamptz not null default now(),
  unique (inscription_id, date),
  foreign key (inscription_id, etablissement_id) references public.inscriptions (id, etablissement_id) on delete cascade,
  foreign key (sequence_id, etablissement_id) references public.sequences (id, etablissement_id) on delete restrict
);
create index on public.absences (sequence_id);

create table public.retards (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant(),
  inscription_id uuid not null,
  sequence_id uuid not null,
  date date not null,
  saisi_par uuid default auth.uid(),
  unique (inscription_id, date),
  foreign key (inscription_id, etablissement_id) references public.inscriptions (id, etablissement_id) on delete cascade,
  foreign key (sequence_id, etablissement_id) references public.sequences (id, etablissement_id) on delete restrict
);
create index on public.retards (sequence_id);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant(),
  inscription_id uuid not null,
  sequence_id uuid not null,
  date date not null,
  infraction_id uuid not null,
  observation text not null default '' check (char_length(observation) <= 300),
  saisi_par uuid default auth.uid(),
  foreign key (inscription_id, etablissement_id) references public.inscriptions (id, etablissement_id) on delete cascade,
  foreign key (sequence_id, etablissement_id) references public.sequences (id, etablissement_id) on delete restrict,
  foreign key (infraction_id, etablissement_id) references public.infractions (id, etablissement_id) on delete restrict
);
create index on public.incidents (sequence_id);

-- Un barème par exercice, créé avec l'exercice
create or replace function public.creer_parametres_discipline() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.parametres_discipline (exercice_id, etablissement_id) values (new.id, new.etablissement_id);
  return new;
end $$;
create trigger exercice_parametres_discipline after insert on public.exercices
  for each row execute function public.creer_parametres_discipline();

-- Élève et séquence du même exercice ; séquence verrouillée = plus de saisie
create or replace function public.verifier_evenement_discipline() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s record; ex uuid;
begin
  select exercice_id, verrouillee into s from public.sequences where id = case when tg_op = 'DELETE' then old.sequence_id else new.sequence_id end;
  if s.verrouillee then raise exception 'Opération refusée : la séquence est verrouillée.' using errcode = 'P0001'; end if;
  if tg_op = 'DELETE' then return old; end if;
  select exercice_id into ex from public.inscriptions where id = new.inscription_id;
  if ex is distinct from s.exercice_id then
    raise exception 'L''élève et la séquence doivent appartenir au même exercice.' using errcode = 'P0001';
  end if;
  new.saisi_par := auth.uid();
  return new;
end $$;
create trigger absence_coherente before insert or update or delete on public.absences for each row execute function public.verifier_evenement_discipline();
create trigger retard_coherent before insert or update or delete on public.retards for each row execute function public.verifier_evenement_discipline();
create trigger incident_coherent before insert or update or delete on public.incidents for each row execute function public.verifier_evenement_discipline();

-- RLS
alter table public.sanctions enable row level security;
alter table public.infractions enable row level security;
alter table public.parametres_discipline enable row level security;
alter table public.absences enable row level security;
alter table public.retards enable row level security;
alter table public.incidents enable row level security;

do $$
declare t text; ecrire text;
begin
  foreach t in array array['sanctions', 'infractions', 'parametres_discipline', 'absences', 'retards', 'incidents'] loop
    ecrire := case when t in ('sanctions', 'infractions', 'parametres_discipline') then '(select public.est_admin())'
                   else '(select public.peut_discipline())' end;
    execute format('create policy "lecture" on public.%I for select to authenticated
                      using (etablissement_id = (select public.etab_courant()))', t);
    execute format('create policy "ajout" on public.%I for insert to authenticated
                      with check (etablissement_id = (select public.etab_courant()) and %s)', t, ecrire);
    execute format('create policy "modification" on public.%I for update to authenticated
                      using (etablissement_id = (select public.etab_courant()) and %s)
                      with check (etablissement_id = (select public.etab_courant()))', t, ecrire);
    execute format('create policy "suppression" on public.%I for delete to authenticated
                      using (etablissement_id = (select public.etab_courant()) and %s)', t, ecrire);
  end loop;
end $$;

revoke all on public.sanctions, public.infractions, public.parametres_discipline, public.absences, public.retards, public.incidents
  from anon, authenticated;
grant select, insert, update, delete on public.sanctions, public.infractions, public.parametres_discipline, public.absences,
  public.retards, public.incidents to authenticated;
revoke execute on function public.peut_discipline(), public.creer_parametres_discipline(), public.verifier_evenement_discipline()
  from public, anon, authenticated;
grant execute on function public.peut_discipline() to authenticated;

-- ===== migrations/0006_import.sql =====
-- Import Excel des élèves en une seule transaction (tout ou rien), réservé à l'administration.
-- p_lignes : [{ matricule, nom, prenom, sexe, date_naissance, lieu_naissance, telephone_parent, classe_id }]
-- Création ou mise à jour selon le matricule ; inscription (ou changement de classe) dans l'exercice actif.
create or replace function public.importer_eleves(p_lignes jsonb)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare
  v_etab uuid := public._exiger_admin();
  v_ex uuid := (select id from public.exercices where etablissement_id = v_etab and actif);
  l jsonb; v_eleve uuid; v_classe uuid; crees int := 0; modifies int := 0; existant boolean;
begin
  if jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) > 3000 then
    raise exception 'Import limité à 3000 lignes.' using errcode = 'P0001';
  end if;
  for l in select * from jsonb_array_elements(p_lignes) loop
    existant := exists (select 1 from public.eleves where etablissement_id = v_etab and matricule = btrim(l ->> 'matricule'));
    insert into public.eleves (etablissement_id, matricule, nom, prenom, sexe, date_naissance, lieu_naissance, telephone_parent)
    values (v_etab, btrim(l ->> 'matricule'), upper(btrim(l ->> 'nom')), btrim(coalesce(l ->> 'prenom', '')), l ->> 'sexe',
            nullif(l ->> 'date_naissance', '')::date, btrim(coalesce(l ->> 'lieu_naissance', '')), btrim(coalesce(l ->> 'telephone_parent', '')))
    on conflict (etablissement_id, matricule) do update set nom = excluded.nom, prenom = excluded.prenom, sexe = excluded.sexe,
      date_naissance = coalesce(excluded.date_naissance, public.eleves.date_naissance),
      lieu_naissance = case when excluded.lieu_naissance <> '' then excluded.lieu_naissance else public.eleves.lieu_naissance end,
      telephone_parent = case when excluded.telephone_parent <> '' then excluded.telephone_parent else public.eleves.telephone_parent end
    returning id into v_eleve;
    if existant then modifies := modifies + 1; else crees := crees + 1; end if;
    v_classe := nullif(l ->> 'classe_id', '')::uuid;
    if v_classe is not null then
      if v_ex is null then raise exception 'Aucun exercice actif : impossible d''inscrire les élèves dans une classe.' using errcode = 'P0001'; end if;
      insert into public.inscriptions (etablissement_id, exercice_id, classe_id, eleve_id)
      values (v_etab, v_ex, v_classe, v_eleve)          -- clé composite : la classe doit appartenir à l'établissement
      on conflict (exercice_id, eleve_id) do update set classe_id = excluded.classe_id;
    end if;
  end loop;
  return json_build_object('crees', crees, 'modifies', modifies);
end $$;

revoke execute on function public.importer_eleves(jsonb) from public, anon, authenticated;
grant execute on function public.importer_eleves(jsonb) to authenticated;

commit;
