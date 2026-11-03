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
-- 1. Inscription d'un nouvel établissement (visiteur anonyme)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.inscrire_etablissement(p_nom text, p_ville text, p_admin_nom text, p_admin_prenom text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare
  cle text := 'inscription:' || public._ip();
  v_etab uuid; v_admin uuid := gen_random_uuid();
  code_etab text := public._generer_code(8); code_admin text := public._generer_code(6);
begin
  if public._minutes_de_blocage(cle) > 0 then
    raise exception 'Trop d''inscriptions depuis cet appareil. Réessayez plus tard.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.etablissements where cree_le > now() - interval '1 day') >= 100 then
    raise exception 'Limite quotidienne d''inscriptions atteinte. Réessayez demain.' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_nom, ''))) < 3 or char_length(btrim(coalesce(p_admin_nom, ''))) < 1 then
    raise exception 'Indiquez le nom complet de l''établissement et le nom de l''administrateur.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.etablissements where nom_normalise = public._normaliser(p_nom)) then
    raise exception 'Un établissement porte déjà ce nom (accents et majuscules ignorés).' using errcode = 'P0001';
  end if;
  perform public._echec(cle, 3, 24 * 60);         -- au plus 3 établissements par appareil et par jour
  insert into public.etablissements (nom, nom_normalise, ville, code_hash)
  values (btrim(p_nom), public._normaliser(p_nom), btrim(coalesce(p_ville, '')), public._hacher(code_etab))
  returning id into v_etab;
  perform public._creer_compte_auth(v_admin);
  insert into public.personnels (id, etablissement_id, nom, prenom, role, code_hash)
  values (v_admin, v_etab, upper(btrim(p_admin_nom)), btrim(coalesce(p_admin_prenom, '')), 'admin', public._hacher(code_admin));
  return json_build_object('etablissement', btrim(p_nom), 'code_etablissement', code_etab,
                           'administrateur', public._libelle(p_admin_nom, p_admin_prenom), 'code_personnel', code_admin);
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
                              from public.personnels p where p.etablissement_id = v_etab and p.actif), '[]'::json));
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
  select * into p from public.personnels where id = p_personnel and etablissement_id = v_etab and actif for update;
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
  if p_role not in ('admin', 'enseignant') then raise exception 'Rôle inconnu.' using errcode = 'P0001'; end if;
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
  if p_role not in ('admin', 'enseignant') then raise exception 'Rôle inconnu.' using errcode = 'P0001'; end if;
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
   where id = p_id and etablissement_id = v_etab and actif;
  if not found then raise exception 'Membre du personnel introuvable ou désactivé.' using errcode = 'P0001'; end if;
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
grant execute on function public.inscrire_etablissement(text, text, text, text), public.ouvrir_etablissement(text, text),
  public.personnels_etablissement(text), public.connexion_personnel(text, uuid, text), public.ping() to anon, authenticated;
grant execute on function public.etab_courant(), public.est_admin(), public.peut_noter(uuid),
  public.creer_personnel(text, text, text, text, text), public.modifier_personnel(uuid, text, text, text, boolean, text, text),
  public.nouveau_code_personnel(uuid), public.nouveau_code_etablissement() to authenticated;
