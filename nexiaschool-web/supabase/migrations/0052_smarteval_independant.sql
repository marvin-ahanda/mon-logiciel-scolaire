-- SmartEval indépendant : un produit vendu directement aux enseignants, sans établissement.
--  * Compte enseignant indépendant (adresse e-mail vérifiée, tout fournisseur) : aucune création d'établissement, de classe ni de
--    liste d'élèves. Les données lui appartiennent (tables se_*), strictement séparées des établissements.
--  * Offres : Découverte (1 évaluation publiée et 2 soumissions, une seule fois par adresse e-mail), Enseignant (crédits
--    d'évaluations publiées sur 12 mois, packs de crédits), Groupe de département (une matière, des membres créés par
--    l'administrateur du groupe, connexion par code ; toute évaluation d'une autre matière est refusée).
--  * Un crédit = une évaluation publiée (brouillon gratuit, modification gratuite, suppression sans restitution,
--    duplication = nouvelle évaluation). Contrôles côté serveur, verrouillés (pas de dépassement par requêtes simultanées).
--  * Lien public unique (/e/<jeton>) pour les évaluations des établissements et des indépendants ; correction commune.
--  * Anonymisation : l'IA connectée (MCP) ne voit les élèves que par leur matricule.
--  * Connexion IA personnelle (clé « nxe_ » ou OAuth) limitée aux évaluations de l'enseignant ; NexIA n'appelle aucun
--    fournisseur d'IA : les jetons consommés le sont sur le compte de l'enseignant chez son fournisseur.

-- ---------------------------------------------------------------------------------------------------------
-- 1. Comptes et groupes
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.groupes_enseignants (
  id uuid primary key default gen_random_uuid(),
  nom text not null default '' check (char_length(nom) <= 120),
  matiere text not null check (char_length(btrim(matiere)) between 2 and 80),
  matiere_norm text not null,
  admin_id uuid not null,
  membres_max integer not null check (membres_max between 2 and 500),
  code_prefixe text unique check (code_prefixe ~ '^[A-Z0-9]{6}$'),
  code_hash text,
  echecs integer not null default 0,
  bloque_jusqu_a timestamptz,
  cree_le timestamptz not null default now()
);

create table if not exists public.comptes_enseignants (
  id uuid primary key references auth.users (id) on delete cascade,
  type text not null check (type in ('email', 'groupe')),
  nom text not null default '' check (char_length(nom) <= 100),
  prenom text not null default '' check (char_length(prenom) <= 100),
  email text not null default '',
  groupe_id uuid references public.groupes_enseignants (id) on delete set null,
  role_groupe text check (role_groupe in ('admin', 'membre')),
  code_hash text,                                       -- membres créés par l'administrateur du groupe (connexion par code)
  echecs integer not null default 0,
  bloque_jusqu_a timestamptz,
  decouverte_fin timestamptz,                           -- null : pas d'offre gratuite (adresse déjà utilisée, ou membre de groupe)
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  derniere_connexion timestamptz,
  check ((groupe_id is null) = (role_groupe is null) or type = 'email')
);
create index if not exists comptes_enseignants_groupe on public.comptes_enseignants (groupe_id);
alter table public.groupes_enseignants add constraint groupes_enseignants_admin foreign key (admin_id) references public.comptes_enseignants (id) on delete cascade;

-- Périodes payées (12 mois) : compte individuel ou groupe ; crédits = évaluations publiables pendant la période
create table if not exists public.se_periodes (
  id uuid primary key default gen_random_uuid(),
  compte_id uuid references public.comptes_enseignants (id) on delete cascade,
  groupe_id uuid references public.groupes_enseignants (id) on delete cascade,
  debut timestamptz not null,
  fin timestamptz not null check (fin > debut),
  credits_inclus integer not null check (credits_inclus >= 0),          -- par membre pour un groupe
  credits_supplementaires integer not null default 0 check (credits_supplementaires >= 0),
  paiement_id uuid,
  cree_le timestamptz not null default now(),
  check (num_nonnulls(compte_id, groupe_id) = 1)
);
create index if not exists se_periodes_compte on public.se_periodes (compte_id, debut desc);
create index if not exists se_periodes_groupe on public.se_periodes (groupe_id, debut desc);

create table if not exists public.se_evaluations (
  id uuid primary key default gen_random_uuid(),
  compte_id uuid not null references public.comptes_enseignants (id) on delete cascade,
  groupe_id uuid references public.groupes_enseignants (id) on delete set null,
  titre text not null check (char_length(btrim(titre)) between 1 and 150),
  consignes text not null default '' check (char_length(consignes) <= 3000),
  competence text not null check (char_length(btrim(competence)) between 1 and 600),
  matiere text not null default '' check (char_length(matiere) <= 80),
  classe text not null check (char_length(btrim(classe)) between 1 and 60),          -- saisie libre : « 6e », « Terminale D »…
  groupes text[] not null default '{}' check (cardinality(groupes) <= 20),          -- facultatif : A, B…
  questions jsonb not null check (jsonb_typeof(questions) = 'array'),
  entete jsonb not null default '{}'::jsonb check (pg_column_size(entete) <= 250000),
  anonyme_ia boolean not null default false,
  demande_matricule boolean not null default false,
  duree_valeur smallint check (duree_valeur between 1 and 1000),
  duree_unite text check (duree_unite in ('heures', 'jours', 'semaines')),
  jeton text unique check (jeton ~ '^[A-Za-z0-9_-]{20,40}$'),
  publiee_le timestamptz,
  ferme_le timestamptz,
  offre_publication text check (offre_publication in ('decouverte', 'enseignant', 'groupe')),
  archivee boolean not null default false,
  source_id uuid,                                           -- évaluation dupliquée
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);
create index if not exists se_evaluations_compte on public.se_evaluations (compte_id, cree_le desc);

create table if not exists public.se_soumissions (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.se_evaluations (id) on delete cascade,
  numero integer not null,
  nom text not null check (char_length(btrim(nom)) between 1 and 100),
  prenom text not null check (char_length(btrim(prenom)) between 1 and 100),
  matricule text not null default '' check (char_length(matricule) <= 40),
  classe text not null,
  identite text not null,
  reponses jsonb not null,
  details jsonb not null,
  points numeric(8, 2),
  total numeric(8, 2),
  note20 numeric(5, 2),
  a_corriger smallint not null default 0,
  soumis_le timestamptz not null default now(),
  unique (evaluation_id, numero),
  unique (evaluation_id, identite)
);

-- Consommation des crédits : une ligne par évaluation publiée. Conservée si l'évaluation est supprimée (aucune restitution).
create table if not exists public.se_consommations (
  id bigint generated always as identity primary key,
  compte_id uuid not null references public.comptes_enseignants (id) on delete cascade,
  evaluation_id uuid references public.se_evaluations (id) on delete set null,
  periode_id uuid references public.se_periodes (id) on delete set null,
  offre text not null check (offre in ('decouverte', 'enseignant', 'groupe')),
  le timestamptz not null default now()
);
create index if not exists se_consommations_compte on public.se_consommations (compte_id, periode_id);

create table if not exists public.se_vues (compte_id uuid primary key references public.comptes_enseignants (id) on delete cascade, vu_jusqua timestamptz not null default now());

-- Accès IA personnels (clé « nxe_… » ou OAuth) et journal des appels
create table if not exists public.acces_ia_enseignants (
  id uuid primary key default gen_random_uuid(),
  compte_id uuid not null references public.comptes_enseignants (id) on delete cascade,
  type text not null check (type in ('cle', 'oauth')),
  libelle text not null default '' check (char_length(libelle) <= 60),
  client_id text references public.oauth_clients (id) on delete cascade,
  acces_hash text not null unique,
  acces_expire_le timestamptz not null,
  rafraichissement_hash text unique,
  rafraichissement_expire_le timestamptz,
  cree_le timestamptz not null default now(),
  derniere_utilisation timestamptz,
  revoque_le timestamptz
);
create index if not exists acces_ia_enseignants_compte on public.acces_ia_enseignants (compte_id);
create table if not exists public.journal_api_enseignants (
  id bigint generated always as identity primary key,
  compte_id uuid not null references public.comptes_enseignants (id) on delete cascade,
  acces_id uuid references public.acces_ia_enseignants (id) on delete cascade,
  outil text not null,
  erreur text not null default '',
  le timestamptz not null default now()
);
create index if not exists journal_api_enseignants_acces on public.journal_api_enseignants (acces_id, le desc);
create table if not exists public.oauth_codes_enseignants (
  code_hash text primary key,
  client_id text not null references public.oauth_clients (id) on delete cascade,
  compte_id uuid not null references public.comptes_enseignants (id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  expire_le timestamptz not null
);

do $$
declare t text;
begin
  foreach t in array array['groupes_enseignants', 'comptes_enseignants', 'se_periodes', 'se_evaluations', 'se_soumissions', 'se_consommations', 'se_vues',
                           'acces_ia_enseignants', 'journal_api_enseignants', 'oauth_codes_enseignants'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;
-- lecture directe minimale (le reste passe par les fonctions, qui contrôlent le propriétaire)
grant select (id, type, nom, prenom, email, groupe_id, role_groupe, decouverte_fin, actif, cree_le) on public.comptes_enseignants to authenticated;
create policy "son compte" on public.comptes_enseignants for select to authenticated using (id = (select auth.uid()));

-- Anonymisation : aussi pour les évaluations des établissements
alter table public.evaluations add column if not exists anonyme_ia boolean not null default false;
-- matricule saisi par l'élève dans le formulaire (sert à le reconnaître et, si l'anonymisation est activée, à le désigner auprès de l'IA)
alter table public.soumissions add column if not exists matricule_saisi text;

-- ---------------------------------------------------------------------------------------------------------
-- 2. Outils : compte connecté, offre en vigueur, crédits
-- ---------------------------------------------------------------------------------------------------------
/** Compte enseignant indépendant de la personne connectée (verrouillé si demandé). */
create or replace function public._se_moi(p_verrou boolean default false) returns public.comptes_enseignants
language plpgsql volatile security definer set search_path = '' as $$
declare c public.comptes_enseignants;
begin
  if p_verrou then select * into c from public.comptes_enseignants where id = auth.uid() and actif for update;
  else select * into c from public.comptes_enseignants where id = auth.uid() and actif; end if;
  if c.id is null then raise exception 'Réservé aux comptes enseignants SmartEval.' using errcode = '42501'; end if;
  return c;
end $$;
revoke execute on function public._se_moi(boolean) from public, anon, authenticated;

/** Période payée en cours (individuelle, ou celle du groupe du compte). */
create or replace function public._se_periode(c public.comptes_enseignants) returns public.se_periodes
language sql stable security definer set search_path = '' as $$
  select p.* from public.se_periodes p
   where ((c.groupe_id is not null and p.groupe_id = c.groupe_id) or (c.groupe_id is null and p.compte_id = c.id))
     and p.debut <= now() and now() < p.fin
   order by p.debut desc limit 1
$$;
revoke execute on function public._se_periode(public.comptes_enseignants) from public, anon, authenticated;

/** Offre en vigueur et crédits : { offre, periode_id, fin, credits_total, credits_utilises, credits_restants, soumissions_max }. */
create or replace function public._se_offre(c public.comptes_enseignants) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare cfg public.config_commerciale := public._config(); p public.se_periodes; v_util int; v_total int; v_reste int;
begin
  p := public._se_periode(c);
  if p.id is not null then
    select count(*) into v_util from public.se_consommations where compte_id = c.id and periode_id = p.id;
    v_total := p.credits_inclus + case when p.compte_id is not null then p.credits_supplementaires else 0 end;
    v_reste := greatest(v_total - v_util, 0);
    if p.groupe_id is not null then
      -- groupe : enveloppe commune (membres max × crédits par membre) pour la période ; remplacer des membres ne crée pas de crédits
      v_reste := least(v_reste, greatest(p.credits_inclus * (select membres_max from public.groupes_enseignants where id = p.groupe_id)
                                         - (select count(*) from public.se_consommations s where s.periode_id = p.id), 0));
    end if;
    return jsonb_build_object('offre', case when p.groupe_id is not null then 'groupe' else 'enseignant' end, 'periode_id', p.id,
      'debut', p.debut, 'fin', p.fin, 'credits_total', v_total, 'credits_utilises', v_util, 'credits_restants', v_reste,
      'soumissions_max', cfg.se_soumissions_max);
  end if;
  if c.groupe_id is null and c.decouverte_fin is not null and c.decouverte_fin > now() then
    select count(*) into v_util from public.se_consommations where compte_id = c.id and offre = 'decouverte';
    return jsonb_build_object('offre', 'decouverte', 'periode_id', null, 'debut', null, 'fin', c.decouverte_fin,
      'credits_total', cfg.se_decouverte_evaluations, 'credits_utilises', v_util, 'credits_restants', greatest(cfg.se_decouverte_evaluations - v_util, 0),
      'soumissions_max', cfg.se_decouverte_soumissions);
  end if;
  -- aucune offre en cours : consultation seulement (découverte terminée, abonnement ou groupe échu)
  return jsonb_build_object('offre', 'aucune', 'periode_id', null, 'fin', null, 'credits_total', 0, 'credits_utilises', 0, 'credits_restants', 0,
    'soumissions_max', case when exists (select 1 from public.se_consommations where compte_id = c.id and offre <> 'decouverte')
                            then cfg.se_soumissions_max else cfg.se_decouverte_soumissions end);
end $$;
revoke execute on function public._se_offre(public.comptes_enseignants) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Inscription et espace de l'enseignant
-- ---------------------------------------------------------------------------------------------------------
/** Création du compte SmartEval de l'utilisateur connecté (adresse e-mail vérifiée, n'importe quel fournisseur). */
create or replace function public.enseignant_inscription(p_nom text, p_prenom text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u record; v_gratuit boolean; cfg public.config_commerciale := public._config();
begin
  select id, email, email_confirmed_at into u from auth.users where id = auth.uid();
  if u.id is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  if coalesce(u.email, '') = '' or u.email like '%.invalid' then raise exception 'Une adresse e-mail réelle est nécessaire.' using errcode = 'P0001'; end if;
  if u.email_confirmed_at is null then raise exception 'Confirmez d''abord votre adresse e-mail (lien reçu par e-mail).' using errcode = 'P0001'; end if;
  if exists (select 1 from public.personnels where id = u.id) then
    raise exception 'Ce compte est celui d''un établissement : créez votre espace SmartEval avec une autre adresse e-mail.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.comptes_enseignants where id = u.id) then return public.enseignant_contexte(); end if;
  if char_length(btrim(coalesce(p_nom, ''))) < 1 then raise exception 'Indiquez votre nom.' using errcode = 'P0001'; end if;
  v_gratuit := public._essai_gratuit(u.email, 'smarteval', cfg.se_decouverte_duree_jours);
  insert into public.comptes_enseignants (id, type, nom, prenom, email, decouverte_fin)
  values (u.id, 'email', upper(left(btrim(p_nom), 100)), left(btrim(coalesce(p_prenom, '')), 100), lower(u.email),
          case when v_gratuit then now() + make_interval(days => cfg.se_decouverte_duree_jours) end);
  return public.enseignant_contexte() || jsonb_build_object('offre_gratuite_refusee', not v_gratuit);
end $$;

/** Tableau de bord : compte, offre, crédits, statistiques, connexion IA, groupe. */
create or replace function public.enseignant_contexte() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.comptes_enseignants; g public.groupes_enseignants; o jsonb;
begin
  select * into c from public.comptes_enseignants where id = auth.uid() and actif;
  if c.id is null then return jsonb_build_object('compte', null); end if;
  o := public._se_offre(c);
  if c.groupe_id is not null then select * into g from public.groupes_enseignants where id = c.groupe_id; end if;
  return jsonb_build_object(
    'compte', jsonb_build_object('id', c.id, 'type', c.type, 'nom', c.nom, 'prenom', c.prenom, 'email', c.email, 'cree_le', c.cree_le,
                                 'decouverte_fin', c.decouverte_fin, 'role_groupe', c.role_groupe),
    'offre', o,
    'groupe', case when g.id is not null then jsonb_build_object('id', g.id, 'nom', g.nom, 'matiere', g.matiere, 'membres_max', g.membres_max,
                'code_defini', g.code_prefixe is not null,
                'membres', (select count(*) from public.comptes_enseignants m where m.groupe_id = g.id and m.actif),
                'periode', (select jsonb_build_object('debut', p.debut, 'fin', p.fin) from public.se_periodes p where p.groupe_id = g.id order by p.debut desc limit 1)) end,
    'stats', jsonb_build_object(
      'creees', (select count(*) from public.se_evaluations where compte_id = c.id),
      'publiees', (select count(*) from public.se_evaluations where compte_id = c.id and jeton is not null),
      'soumissions', (select count(*) from public.se_soumissions s join public.se_evaluations e on e.id = s.evaluation_id where e.compte_id = c.id)),
    'ia', jsonb_build_object('acces_actifs', (select count(*) from public.acces_ia_enseignants a where a.compte_id = c.id and a.revoque_le is null
                                and ((a.type = 'cle' and a.acces_expire_le > now()) or (a.type = 'oauth' and a.rafraichissement_expire_le > now()))),
                             'derniere_utilisation', (select max(derniere_utilisation) from public.acces_ia_enseignants where compte_id = c.id)),
    'tarifs', public.offres_publiques(),
    'paiements', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'produit', p.produit, 'libelle', p.details ->> 'libelle', 'montant', p.montant,
        'statut', p.statut, 'cree_le', p.cree_le, 'paye_le', p.paye_le, 'fin', p.fin, 'numero_recu', p.numero_recu) order by p.cree_le desc)
      from (select * from public.paiements_abonnement where compte_id = c.id order by cree_le desc limit 30) p), '[]'::jsonb));
end $$;

create or replace function public.enseignant_modifier_profil(p_nom text, p_prenom text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare c public.comptes_enseignants := public._se_moi();
begin
  if char_length(btrim(coalesce(p_nom, ''))) < 1 then raise exception 'Indiquez votre nom.' using errcode = 'P0001'; end if;
  update public.comptes_enseignants set nom = upper(left(btrim(p_nom), 100)), prenom = left(btrim(coalesce(p_prenom, '')), 100) where id = c.id;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 4. Groupes de département : code du groupe, membres créés par l'administrateur, connexion par code
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._se_admin_groupe() returns public.comptes_enseignants
language plpgsql volatile security definer set search_path = '' as $$
declare c public.comptes_enseignants := public._se_moi();
begin
  if c.groupe_id is null or c.role_groupe <> 'admin' then raise exception 'Réservé à l''administrateur du groupe.' using errcode = '42501'; end if;
  return c;
end $$;
revoke execute on function public._se_admin_groupe() from public, anon, authenticated;

/** (Ré)génère le code du groupe, à partager aux collègues : « PREFIX-secret ». Seul le préfixe est conservé en clair. */
create or replace function public.groupe_generer_code() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c public.comptes_enseignants := public._se_admin_groupe(); v_pre text; v_sec text := public._generer_code(8);
begin
  loop
    v_pre := upper(substr(translate(encode(extensions.gen_random_bytes(8), 'base64'), '+/=0O1lI', ''), 1, 6));
    exit when char_length(v_pre) = 6 and v_pre ~ '^[A-Z0-9]{6}$' and not exists (select 1 from public.groupes_enseignants where code_prefixe = v_pre);
  end loop;
  update public.groupes_enseignants set code_prefixe = v_pre, code_hash = public._hacher(v_sec), echecs = 0, bloque_jusqu_a = null where id = c.groupe_id;
  return jsonb_build_object('code', v_pre || '-' || v_sec);
end $$;

/** Crée le compte d'un collègue du département ; renvoie son code personnel (affiché une seule fois). */
create or replace function public.groupe_creer_membre(p_nom text, p_prenom text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c public.comptes_enseignants := public._se_admin_groupe(); g public.groupes_enseignants; v_id uuid := gen_random_uuid(); v_code text := public._generer_code(6);
        v_email text;
begin
  select * into g from public.groupes_enseignants where id = c.groupe_id for update;
  if char_length(btrim(coalesce(p_nom, ''))) < 1 then raise exception 'Indiquez le nom du collègue.' using errcode = 'P0001'; end if;
  if (select count(*) from public.comptes_enseignants where groupe_id = g.id and actif) >= g.membres_max then
    raise exception 'Le groupe compte déjà % membres (maximum de l''abonnement).', g.membres_max using errcode = 'P0001';
  end if;
  v_email := 'g-' || v_id::text || '@groupe.nexiaschool.invalid';
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email, public._hacher(encode(extensions.gen_random_bytes(32), 'hex')),
          now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now(), '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (v_id::text, v_id, jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), 'email', now(), now());
  insert into public.comptes_enseignants (id, type, nom, prenom, groupe_id, role_groupe, code_hash)
  values (v_id, 'groupe', upper(left(btrim(p_nom), 100)), left(btrim(coalesce(p_prenom, '')), 100), g.id, 'membre', public._hacher(v_code));
  return jsonb_build_object('id', v_id, 'nom', public._libelle(p_nom, p_prenom), 'code', v_code);
end $$;

create or replace function public.groupe_nouveau_code_membre(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c public.comptes_enseignants := public._se_admin_groupe(); v_code text := public._generer_code(6);
begin
  update public.comptes_enseignants set code_hash = public._hacher(v_code), echecs = 0, bloque_jusqu_a = null
   where id = p_id and groupe_id = c.groupe_id and role_groupe = 'membre';
  if not found then raise exception 'Membre introuvable.' using errcode = 'P0001'; end if;
  return jsonb_build_object('code', v_code);
end $$;

create or replace function public.groupe_activer_membre(p_id uuid, p_actif boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare c public.comptes_enseignants := public._se_admin_groupe(); g public.groupes_enseignants;
begin
  select * into g from public.groupes_enseignants where id = c.groupe_id for update;
  if p_actif and (select count(*) from public.comptes_enseignants where groupe_id = g.id and actif) >= g.membres_max then
    raise exception 'Le groupe compte déjà % membres (maximum de l''abonnement).', g.membres_max using errcode = 'P0001';
  end if;
  update public.comptes_enseignants set actif = coalesce(p_actif, false) where id = p_id and groupe_id = c.groupe_id and role_groupe = 'membre';
  if not found then raise exception 'Membre introuvable.' using errcode = 'P0001'; end if;
end $$;

create or replace function public.groupe_membres() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.comptes_enseignants; g uuid;
begin
  select * into c from public.comptes_enseignants where id = auth.uid() and actif;
  if c.groupe_id is null or c.role_groupe <> 'admin' then raise exception 'Réservé à l''administrateur du groupe.' using errcode = '42501'; end if;
  g := c.groupe_id;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'nom', m.nom, 'prenom', m.prenom, 'role', m.role_groupe, 'actif', m.actif,
      'derniere_connexion', m.derniere_connexion,
      'publiees', (select count(*) from public.se_consommations s where s.compte_id = m.id and s.periode_id = (public._se_periode(c)).id))
      order by m.role_groupe, m.nom), '[]'::jsonb) from public.comptes_enseignants m where m.groupe_id = g);
end $$;

/** Code du groupe → liste des membres (noms seulement), pour choisir son nom à la connexion. Blocage après 5 essais erronés. */
create or replace function public.groupe_ouvrir(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v text := upper(btrim(coalesce(p_code, ''))); g public.groupes_enseignants;
begin
  if v !~ '^[A-Z0-9]{6}-[A-Z0-9]{4,12}$' then return jsonb_build_object('erreur', 'Code de groupe invalide.'); end if;
  select * into g from public.groupes_enseignants where code_prefixe = split_part(v, '-', 1) for update;
  if g.id is null then return jsonb_build_object('erreur', 'Code de groupe invalide.'); end if;
  if g.bloque_jusqu_a > now() then return jsonb_build_object('erreur', 'Trop d''essais erronés : réessayez dans 15 minutes.'); end if;
  if not public._verifier(lower(split_part(v, '-', 2)), g.code_hash) then
    update public.groupes_enseignants set echecs = case when echecs + 1 >= 5 then 0 else echecs + 1 end,
           bloque_jusqu_a = case when echecs + 1 >= 5 then now() + interval '15 minutes' else bloque_jusqu_a end where id = g.id;
    return jsonb_build_object('erreur', 'Code de groupe invalide.');
  end if;
  update public.groupes_enseignants set echecs = 0 where id = g.id;
  return jsonb_build_object('groupe', g.nom, 'matiere', g.matiere,
    'membres', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'nom', btrim(m.nom || ' ' || m.prenom)) order by m.nom), '[]'::jsonb)
                  from public.comptes_enseignants m where m.groupe_id = g.id and m.actif and m.role_groupe = 'membre'));
end $$;

/** Connexion d'un membre : code du groupe + son nom + son code personnel → identifiants de session (mot de passe à usage unique). */
create or replace function public.groupe_connexion(p_code_groupe text, p_membre uuid, p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v text := upper(btrim(coalesce(p_code_groupe, ''))); g public.groupes_enseignants; m public.comptes_enseignants; v_secret text;
begin
  -- même protection que groupe_ouvrir : blocage 15 minutes après 5 échecs ; même réponse pour un code faux ou un membre inconnu
  if v !~ '^[A-Z0-9]{6}-[A-Z0-9]{4,12}$' then return jsonb_build_object('erreur', 'Code de groupe ou nom invalide.'); end if;
  select * into g from public.groupes_enseignants where code_prefixe = split_part(v, '-', 1) for update;
  if g.id is null then return jsonb_build_object('erreur', 'Code de groupe ou nom invalide.'); end if;
  if g.bloque_jusqu_a > now() then return jsonb_build_object('erreur', 'Trop d''essais erronés : réessayez dans 15 minutes.'); end if;
  select * into m from public.comptes_enseignants where id = p_membre and groupe_id = g.id and actif and role_groupe = 'membre' for update;
  if m.id is null or not public._verifier(lower(split_part(v, '-', 2)), g.code_hash) then
    update public.groupes_enseignants set echecs = case when echecs + 1 >= 5 then 0 else echecs + 1 end,
           bloque_jusqu_a = case when echecs + 1 >= 5 then now() + interval '15 minutes' else bloque_jusqu_a end where id = g.id;
    return jsonb_build_object('erreur', 'Code de groupe ou nom invalide.');
  end if;
  if m.bloque_jusqu_a > now() then return jsonb_build_object('erreur', 'Trop de codes erronés : accès bloqué 15 minutes. L''administrateur du groupe peut vous donner un nouveau code.'); end if;
  if not public._verifier(lower(btrim(coalesce(p_code, ''))), m.code_hash) then
    update public.comptes_enseignants set echecs = case when echecs + 1 >= 5 then 0 else echecs + 1 end,
           bloque_jusqu_a = case when echecs + 1 >= 5 then now() + interval '15 minutes' else bloque_jusqu_a end where id = m.id;
    return jsonb_build_object('erreur', 'Code personnel incorrect.');
  end if;
  v_secret := encode(extensions.gen_random_bytes(24), 'hex');
  update auth.users set encrypted_password = public._hacher(v_secret), updated_at = now() where id = m.id;
  update public.comptes_enseignants set echecs = 0, bloque_jusqu_a = null, derniere_connexion = now() where id = m.id;
  return jsonb_build_object('email', 'g-' || m.id::text || '@groupe.nexiaschool.invalid', 'secret', v_secret);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 5. Correction commune (établissements et indépendants)
-- ---------------------------------------------------------------------------------------------------------
/** Contrôle et correction d'un formulaire : { reponses, details, points, total, note20, a_corriger }. */
create or replace function public._smarteval_corriger(p_questions jsonb, p_reponses jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare q jsonb; v jsonb; rep jsonb := '{}'::jsonb; det jsonb := '[]'::jsonb;
        nb int; ok boolean; corrigible boolean; pts numeric; tot numeric := 0; obt numeric := 0; acorr int := 0; vide boolean;
begin
  for q in select * from jsonb_array_elements(p_questions) loop
    v := p_reponses -> (q ->> 'id');
    nb := jsonb_array_length(q -> 'options');
    if v is null or jsonb_typeof(v) = 'null' then v := null;
    elsif q ->> 'type' in ('courte', 'paragraphe') then
      v := case when jsonb_typeof(v) in ('string', 'number') and btrim(v #>> '{}') <> ''
                then to_jsonb(left(btrim(v #>> '{}'), case when q ->> 'type' = 'courte' then 1000 else 20000 end)) end;
    elsif q ->> 'type' in ('choix', 'liste') then
      v := case when jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric) and (v #>> '{}')::numeric between 0 and nb - 1 then v end;
    elsif q ->> 'type' = 'cases' then
      if jsonb_typeof(v) <> 'array' then v := null;
      else
        select coalesce(jsonb_agg(distinct (z #>> '{}')::int order by (z #>> '{}')::int), '[]'::jsonb) into v
          from jsonb_array_elements(v) z where jsonb_typeof(z) = 'number' and (z #>> '{}')::numeric = trunc((z #>> '{}')::numeric) and (z #>> '{}')::numeric between 0 and nb - 1;
        if jsonb_array_length(v) = 0 then v := null; end if;
      end if;
    elsif q ->> 'type' = 'echelle' then
      v := case when jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric)
                 and (v #>> '{}')::numeric between (q #>> '{echelle,min}')::numeric and (q #>> '{echelle,max}')::numeric then v end;
    end if;
    vide := v is null;
    if vide and coalesce((q ->> 'obligatoire')::boolean, false) then
      raise exception 'La question « % » est obligatoire.', left(q ->> 'intitule', 80) using errcode = 'P0001';
    end if;
    if not vide then rep := rep || jsonb_build_object(q ->> 'id', v); end if;
    pts := coalesce((q ->> 'points')::numeric, 0);
    corrigible := pts > 0 and ((q ->> 'type' in ('choix', 'liste', 'cases') and jsonb_array_length(q -> 'bonnes') > 0)
                               or (q ->> 'type' = 'courte' and jsonb_array_length(q -> 'acceptees') > 0));
    ok := null;
    if corrigible then
      tot := tot + pts;
      if vide then ok := false;
      elsif q ->> 'type' in ('choix', 'liste') then ok := (q -> 'bonnes') @> jsonb_build_array((v #>> '{}')::int);
      elsif q ->> 'type' = 'cases' then ok := (q -> 'bonnes') @> v and v @> (q -> 'bonnes');
      else ok := exists (select 1 from jsonb_array_elements_text(q -> 'acceptees') a where public._smarteval_norm(a) = public._smarteval_norm(v #>> '{}'));
      end if;
      if ok then obt := obt + pts; end if;
    elsif q ->> 'type' in ('paragraphe', 'courte') and pts > 0 and not vide then
      acorr := acorr + 1;
    end if;
    det := det || jsonb_build_object('id', q ->> 'id', 'correct', ok, 'obtenu', case when corrigible then case when ok then pts else 0 end end,
                                     'max', case when corrigible then pts end, 'a_corriger', not corrigible and q ->> 'type' in ('paragraphe', 'courte') and pts > 0 and not vide);
  end loop;
  return jsonb_build_object('reponses', rep, 'details', det, 'points', case when tot > 0 then obt end, 'total', case when tot > 0 then tot end,
                            'note20', case when tot > 0 then round(obt / tot * 20, 2) end, 'a_corriger', acorr);
end $$;
revoke execute on function public._smarteval_corriger(jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 6. SmartEval indépendant : évaluations, publication (crédits), soumissions
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._se_statut(e public.se_evaluations) returns text
language sql stable set search_path = '' as $$
  select case when e.jeton is null then 'brouillon' when now() < e.publiee_le then 'programmee' when now() <= e.ferme_le then 'ouverte' else 'close' end
$$;

create or replace function public._se_classes(e public.se_evaluations) returns jsonb
language sql immutable set search_path = '' as $$
  select case when cardinality(e.groupes) = 0 then jsonb_build_array(jsonb_build_object('id', e.classe, 'libelle', e.classe))
              else (select jsonb_agg(jsonb_build_object('id', e.classe || ' ' || g, 'libelle', e.classe || ' ' || g) order by o)
                      from unnest(e.groupes) with ordinality t(g, o)) end
$$;

/** Évaluation (avec ou sans corrigés). */
create or replace function public._se_json(e public.se_evaluations, p_corriges boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', e.id, 'titre', e.titre, 'consignes', e.consignes, 'competence', e.competence, 'matiere', e.matiere, 'classe', e.classe,
    'groupes', to_jsonb(e.groupes), 'classes', public._se_classes(e), 'independant', true,
    'questions', case when p_corriges then e.questions
                      else (select coalesce(jsonb_agg(q - 'bonnes' - 'acceptees' order by o), '[]'::jsonb) from jsonb_array_elements(e.questions) with ordinality t(q, o)) end,
    'entete', e.entete, 'anonyme_ia', e.anonyme_ia, 'demande_matricule', e.demande_matricule or e.anonyme_ia,
    'duree_valeur', e.duree_valeur, 'duree_unite', e.duree_unite,
    'jeton', case when p_corriges then e.jeton end, 'publiee_le', e.publiee_le, 'ferme_le', e.ferme_le, 'archivee', e.archivee,
    'statut', public._se_statut(e), 'cree_le', e.cree_le, 'offre_publication', e.offre_publication)
$$;

create or replace function public._se_mienne(p_id uuid) returns public.se_evaluations
language plpgsql stable security definer set search_path = '' as $$
declare e public.se_evaluations;
begin
  -- compte actif exigé : un membre de groupe désactivé n'accède plus à ses évaluations (ni aux copies des élèves)
  select x.* into e from public.se_evaluations x join public.comptes_enseignants c on c.id = x.compte_id and c.actif
   where x.id = p_id and x.compte_id = auth.uid();
  if e.id is null then raise exception 'Évaluation introuvable.' using errcode = 'P0001'; end if;
  return e;
end $$;

revoke execute on function public._se_statut(public.se_evaluations), public._se_classes(public.se_evaluations), public._se_json(public.se_evaluations, boolean),
  public._se_mienne(uuid) from public, anon, authenticated;

/** Matière imposée pour un membre de groupe ; refus de toute autre matière (anti-fraude). */
create or replace function public._se_matiere(c public.comptes_enseignants, p_matiere text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare g public.groupes_enseignants;
begin
  if c.groupe_id is null then return left(btrim(coalesce(p_matiere, '')), 80); end if;
  select * into g from public.groupes_enseignants where id = c.groupe_id;
  if btrim(coalesce(p_matiere, '')) <> '' and public._normaliser(p_matiere) <> g.matiere_norm then
    raise exception 'Votre abonnement de groupe couvre uniquement la matière « % » : une évaluation d''une autre matière est refusée.', g.matiere using errcode = 'P0001';
  end if;
  return g.matiere;
end $$;
revoke execute on function public._se_matiere(public.comptes_enseignants, text) from public, anon, authenticated;

/**
 * Enregistre un brouillon (création ou modification). Une évaluation publiée reste modifiable tant qu'aucun élève n'a répondu
 * (sans nouveau crédit). p = { id?, titre, consignes, competence, matiere, classe, groupes: [..], questions, anonyme_ia, demande_matricule }
 */
create or replace function public.se_enregistrer(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c public.comptes_enseignants := public._se_moi(); v_id uuid := nullif(p ->> 'id', '')::uuid; e public.se_evaluations; v_q jsonb;
        v_mat text; v_groupes text[];
begin
  if btrim(coalesce(p ->> 'titre', '')) = '' then raise exception 'Donnez un titre à l''évaluation.' using errcode = 'P0001'; end if;
  if btrim(coalesce(p ->> 'competence', '')) = '' then raise exception 'Indiquez la compétence visée.' using errcode = 'P0001'; end if;
  if btrim(coalesce(p ->> 'classe', '')) = '' then raise exception 'Indiquez la classe ou le niveau (ex. 6e, Terminale D).' using errcode = 'P0001'; end if;
  v_mat := public._se_matiere(c, p ->> 'matiere');
  select coalesce(array_agg(distinct left(btrim(g), 20)) filter (where btrim(g) <> ''), '{}') into v_groupes
    from jsonb_array_elements_text(case when jsonb_typeof(p -> 'groupes') = 'array' then p -> 'groupes' else '[]'::jsonb end) g;
  v_q := public._smarteval_questions(p -> 'questions');
  if v_id is null then
    if (select count(*) from public.se_evaluations where compte_id = c.id) >= 2000 then
      raise exception 'Nombre maximal d''évaluations atteint : archivez ou supprimez d''anciennes évaluations.' using errcode = 'P0001';
    end if;
    insert into public.se_evaluations (compte_id, groupe_id, titre, consignes, competence, matiere, classe, groupes, questions, anonyme_ia, demande_matricule)
    values (c.id, c.groupe_id, left(btrim(p ->> 'titre'), 150), left(coalesce(p ->> 'consignes', ''), 3000), left(btrim(p ->> 'competence'), 600), v_mat,
            left(btrim(p ->> 'classe'), 60), v_groupes, v_q, coalesce((p ->> 'anonyme_ia')::boolean, false), coalesce((p ->> 'demande_matricule')::boolean, false))
    returning id into v_id;
  else
    select * into e from public.se_evaluations where id = v_id and compte_id = c.id for update;
    if e.id is null then raise exception 'Évaluation introuvable.' using errcode = 'P0001'; end if;
    if exists (select 1 from public.se_soumissions where evaluation_id = e.id) then
      raise exception 'Des élèves ont déjà répondu : l''évaluation ne peut plus être modifiée (dupliquez-la pour en créer une variante).' using errcode = 'P0001';
    end if;
    update public.se_evaluations set titre = left(btrim(p ->> 'titre'), 150), consignes = left(coalesce(p ->> 'consignes', ''), 3000),
           competence = left(btrim(p ->> 'competence'), 600), matiere = v_mat, classe = left(btrim(p ->> 'classe'), 60), groupes = v_groupes, questions = v_q,
           anonyme_ia = coalesce((p ->> 'anonyme_ia')::boolean, anonyme_ia), demande_matricule = coalesce((p ->> 'demande_matricule')::boolean, demande_matricule),
           modifie_le = now()
     where id = v_id;
  end if;
  return jsonb_build_object('id', v_id);
exception when invalid_text_representation then raise exception 'Évaluation introuvable.' using errcode = 'P0001';
end $$;

/**
 * Publie (première fois : consomme un crédit) ou change la durée d'ouverture (sans crédit). Verrou sur le compte : deux
 * publications simultanées ne consomment pas le même dernier crédit.
 */
create or replace function public.se_publier(p_id uuid, p_valeur int, p_unite text, p_entete jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c public.comptes_enseignants := public._se_moi(true); e public.se_evaluations; o jsonb; v_jeton text; v_debut timestamptz;
begin
  -- groupe : verrou sur le groupe, l'enveloppe de crédits est commune à tous ses membres
  if c.groupe_id is not null then perform 1 from public.groupes_enseignants where id = c.groupe_id for update; end if;
  select * into e from public.se_evaluations where id = p_id and compte_id = c.id for update;
  if e.id is null then raise exception 'Évaluation introuvable.' using errcode = 'P0001'; end if;
  if p_unite not in ('heures', 'jours', 'semaines') or p_valeur is null or p_valeur < 1
     or (p_unite = 'heures' and p_valeur > 720) or (p_unite = 'jours' and p_valeur > 60) or (p_unite = 'semaines' and p_valeur > 8) then
    raise exception 'Durée invalide : 1 à 720 heures, 1 à 60 jours ou 1 à 8 semaines.' using errcode = 'P0001';
  end if;
  if p_entete is not null and pg_column_size(p_entete) > 250000 then raise exception 'En-tête trop volumineux.' using errcode = 'P0001'; end if;
  if e.jeton is null then
    o := public._se_offre(c);
    if o ->> 'offre' = 'aucune' then
      raise exception 'Aucune offre en cours : souscrivez à SmartEval Enseignant pour publier de nouvelles évaluations.' using errcode = 'P0001', hint = 'smarteval:abonnement';
    end if;
    if (o ->> 'credits_restants')::int <= 0 then
      if o ->> 'offre' = 'decouverte' then
        raise exception 'Votre offre Découverte permet de publier % évaluation(s). Passez à SmartEval Enseignant pour en publier davantage.',
          o ->> 'credits_total' using errcode = 'P0001', hint = 'smarteval:abonnement';
      end if;
      raise exception 'Vous avez utilisé tous vos crédits (% évaluations publiées). Achetez un pack de crédits ou renouvelez votre abonnement.',
        o ->> 'credits_total' using errcode = 'P0001', hint = 'smarteval:credits';
    end if;
    insert into public.se_consommations (compte_id, evaluation_id, periode_id, offre)
    values (c.id, e.id, nullif(o ->> 'periode_id', '')::uuid, o ->> 'offre');
  end if;
  v_jeton := coalesce(e.jeton, translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_'));
  v_debut := coalesce(e.publiee_le, now());
  update public.se_evaluations set jeton = v_jeton, publiee_le = v_debut,
         ferme_le = v_debut + case p_unite when 'heures' then make_interval(hours => p_valeur) when 'jours' then make_interval(days => p_valeur)
                                            else make_interval(days => 7 * p_valeur) end,
         duree_valeur = p_valeur, duree_unite = p_unite, offre_publication = coalesce(e.offre_publication, o ->> 'offre'),
         entete = case when e.jeton is null then coalesce(p_entete, '{}'::jsonb) else e.entete end, modifie_le = now()
   where id = p_id returning * into e;
  return jsonb_build_object('jeton', e.jeton, 'publiee_le', e.publiee_le, 'ferme_le', e.ferme_le);
end $$;

create or replace function public.se_clore(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare e public.se_evaluations := public._se_mienne(p_id);
begin
  perform public._se_moi();
  if e.jeton is null then raise exception 'Évaluation non publiée.' using errcode = 'P0001'; end if;
  update public.se_evaluations set ferme_le = least(ferme_le, now()), modifie_le = now() where id = p_id;
end $$;

/** Suppression : le crédit consommé n'est jamais restitué (la consommation reste enregistrée). */
create or replace function public.se_supprimer(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare e public.se_evaluations := public._se_mienne(p_id);
begin
  perform public._se_moi();
  delete from public.se_evaluations where id = e.id;
end $$;

create or replace function public.se_archiver(p_id uuid, p_archivee boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare e public.se_evaluations := public._se_mienne(p_id);
begin
  perform public._se_moi();
  update public.se_evaluations set archivee = coalesce(p_archivee, true), modifie_le = now() where id = e.id;
end $$;

/** Duplication : nouveau brouillon (il consommera un crédit à sa publication). */
create or replace function public.se_dupliquer(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c public.comptes_enseignants := public._se_moi(); e public.se_evaluations := public._se_mienne(p_id); v_id uuid;
begin
  insert into public.se_evaluations (compte_id, groupe_id, titre, consignes, competence, matiere, classe, groupes, questions, anonyme_ia, demande_matricule, source_id)
  values (c.id, c.groupe_id, left('Copie de ' || e.titre, 150), e.consignes, e.competence, public._se_matiere(c, e.matiere), e.classe, e.groupes, e.questions,
          e.anonyme_ia, e.demande_matricule, e.id)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.se_anonymiser(p_id uuid, p_actif boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare e public.se_evaluations := public._se_mienne(p_id);
begin
  perform public._se_moi();
  update public.se_evaluations set anonyme_ia = coalesce(p_actif, false), demande_matricule = demande_matricule or coalesce(p_actif, false), modifie_le = now()
   where id = e.id;
end $$;

create or replace function public.se_liste() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'titre', e.titre, 'matiere', e.matiere, 'classe', e.classe, 'groupes', to_jsonb(e.groupes), 'competence', e.competence,
      'questions', jsonb_array_length(e.questions), 'statut', public._se_statut(e), 'jeton', e.jeton, 'archivee', e.archivee, 'anonyme_ia', e.anonyme_ia,
      'publiee_le', e.publiee_le, 'ferme_le', e.ferme_le, 'cree_le', e.cree_le,
      'soumissions', (select count(*) from public.se_soumissions s where s.evaluation_id = e.id),
      'nouvelles', (select count(*) from public.se_soumissions s where s.evaluation_id = e.id
                      and s.soumis_le > coalesce((select vu_jusqua from public.se_vues where compte_id = auth.uid()), '-infinity')),
      'moyenne', (select round(avg(s.note20), 2) from public.se_soumissions s where s.evaluation_id = e.id))
    order by e.cree_le desc), '[]'::jsonb)
  from public.se_evaluations e where e.compte_id = auth.uid()
   and exists (select 1 from public.comptes_enseignants c where c.id = auth.uid() and c.actif)
$$;

/** Évaluation complète et ses soumissions (réservé au propriétaire). */
create or replace function public.se_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.se_evaluations := public._se_mienne(p_id); c public.comptes_enseignants; o jsonb;
begin
  select * into c from public.comptes_enseignants where id = auth.uid();
  o := public._se_offre(c);
  return public._se_json(e, true) || jsonb_build_object(
    'soumissions_max', (o ->> 'soumissions_max')::int,
    'soumissions', coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'numero', s.numero, 'nom', s.nom, 'prenom', s.prenom, 'classe', s.classe, 'matricule', nullif(s.matricule, ''),
      'reponses', s.reponses, 'details', s.details, 'points', s.points, 'total', s.total, 'note20', s.note20, 'a_corriger', s.a_corriger,
      'soumis_le', s.soumis_le) order by s.numero) from public.se_soumissions s where s.evaluation_id = e.id), '[]'::jsonb));
end $$;

create or replace function public.se_marquer_vu() returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.se_vues (compte_id, vu_jusqua) select c.id, now() from public.comptes_enseignants c where c.id = auth.uid() and c.actif
  on conflict (compte_id) do update set vu_jusqua = excluded.vu_jusqua
$$;

/** Formulaire public d'une évaluation indépendante. */
create or replace function public._se_formulaire(p_jeton text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.se_evaluations;
begin
  select x.* into e from public.se_evaluations x join public.comptes_enseignants c on c.id = x.compte_id where x.jeton = btrim(p_jeton) and c.actif;
  if e.id is null then return null; end if;
  return public._se_json(e, false) - 'cree_le' - 'duree_valeur' - 'duree_unite' - 'archivee' - 'offre_publication' - 'anonyme_ia' - 'id';
end $$;
revoke execute on function public._se_formulaire(text) from public, anon, authenticated;

/** Soumission d'un élève à une évaluation indépendante (limite de l'offre contrôlée ici, verrou sur l'évaluation). */
create or replace function public._se_soumettre(p_jeton text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare e public.se_evaluations; c public.comptes_enseignants; o jsonb; r jsonb; v_n int; v_num int; v_ident text; so record;
        v_nom text := left(btrim(coalesce(p ->> 'nom', '')), 100); v_prenom text := left(btrim(coalesce(p ->> 'prenom', '')), 100);
        v_classe text := left(btrim(coalesce(p ->> 'classe_id', '')), 90); v_mat text := left(btrim(coalesce(p ->> 'matricule', '')), 40);
begin
  select * into e from public.se_evaluations where jeton = btrim(p_jeton) for update;
  if e.id is null then return null; end if;
  select * into c from public.comptes_enseignants where id = e.compte_id and actif;
  if c.id is null then raise exception 'Lien invalide : cette évaluation n''existe pas.' using errcode = 'P0001'; end if;
  if now() < e.publiee_le or now() > e.ferme_le then raise exception 'Cette évaluation est close : les réponses ne sont plus acceptées.' using errcode = 'P0001'; end if;
  if v_nom = '' or v_prenom = '' then raise exception 'Indiquez votre nom et votre prénom.' using errcode = 'P0001'; end if;
  if not exists (select 1 from jsonb_array_elements(public._se_classes(e)) x where x ->> 'id' = v_classe) then
    raise exception 'Choisissez votre classe.' using errcode = 'P0001';
  end if;
  if (e.demande_matricule or e.anonyme_ia) and v_mat = '' then raise exception 'Indiquez votre matricule.' using errcode = 'P0001'; end if;
  v_ident := public._normaliser(v_nom) || '|' || public._normaliser(v_prenom) || '|' || public._normaliser(v_classe);
  if exists (select 1 from public.se_soumissions where evaluation_id = e.id and identite = v_ident) then
    raise exception 'Vous avez déjà envoyé votre formulaire pour cette évaluation.' using errcode = 'P0001';
  end if;
  o := public._se_offre(c);
  select count(*) into v_n from public.se_soumissions where evaluation_id = e.id;
  if v_n >= (o ->> 'soumissions_max')::int then
    if o ->> 'offre' in ('decouverte', 'aucune') and (o ->> 'soumissions_max')::int < (public._config()).se_soumissions_max then
      raise exception 'Cette évaluation a atteint le nombre maximal de réponses de l''offre Découverte. Prévenez votre enseignant : il peut passer à SmartEval Enseignant pour permettre à davantage d''élèves de composer.'
        using errcode = 'P0001', hint = 'smarteval:soumissions';
    end if;
    raise exception 'Nombre maximal de réponses atteint pour cette évaluation.' using errcode = 'P0001', hint = 'smarteval:soumissions';
  end if;
  r := public._smarteval_corriger(e.questions, coalesce(p -> 'reponses', '{}'::jsonb));
  select coalesce(max(numero), 0) + 1 into v_num from public.se_soumissions where evaluation_id = e.id;
  insert into public.se_soumissions (evaluation_id, numero, nom, prenom, matricule, classe, identite, reponses, details, points, total, note20, a_corriger)
  values (e.id, v_num, upper(v_nom), v_prenom, upper(v_mat), v_classe, v_ident, r -> 'reponses', r -> 'details', (r ->> 'points')::numeric,
          (r ->> 'total')::numeric, (r ->> 'note20')::numeric, (r ->> 'a_corriger')::int)
  returning numero, soumis_le, nom, prenom, classe into so;
  return jsonb_build_object('numero', so.numero, 'recu', upper(substr(md5(e.id::text || so.numero), 1, 4)) || '-' || lpad(so.numero::text, 4, '0'),
                            'soumis_le', so.soumis_le, 'nom', so.nom, 'prenom', so.prenom, 'classe', so.classe, 'evaluation', e.titre);
end $$;
revoke execute on function public._se_soumettre(text, jsonb) from public, anon, authenticated;

-- Lien public commun : évaluation d'établissement, sinon évaluation indépendante
create or replace function public.smarteval_formulaire(p_jeton text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.evaluations;
begin
  if coalesce(p_jeton, '') !~ '^[A-Za-z0-9_-]{20,40}$' then return null; end if;
  e := public._smarteval_par_jeton(p_jeton);
  if e.id is null then return public._se_formulaire(p_jeton); end if;
  return public._smarteval_json(e, false) - 'auteur' - 'cree_le' - 'duree_valeur' - 'duree_unite';
end $$;

/** Envoi d'un formulaire par un élève (établissement ou indépendant). Même correction ; même contrôle des doublons. */
create or replace function public.smarteval_soumettre(p_jeton text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  e public.evaluations; r jsonb; v_nom text := left(btrim(coalesce(p ->> 'nom', '')), 100); v_prenom text := left(btrim(coalesce(p ->> 'prenom', '')), 100);
  v_classe uuid; v_classe_lib text; v_ident text; v_num int; v_ins uuid; v_n int; x int; so record;
  v_mat text := upper(left(btrim(coalesce(p ->> 'matricule', '')), 40));
begin
  if coalesce(p_jeton, '') !~ '^[A-Za-z0-9_-]{20,40}$' then raise exception 'Lien invalide.' using errcode = 'P0001'; end if;
  if p is null or jsonb_typeof(p) <> 'object' or pg_column_size(p) > 1000000 then raise exception 'Formulaire invalide.' using errcode = 'P0001'; end if;
  select * into e from public.evaluations where id = (public._smarteval_par_jeton(p_jeton)).id for update;
  if e.id is null then
    r := public._se_soumettre(p_jeton, p);
    if r is null then raise exception 'Lien invalide : cette évaluation n''existe pas.' using errcode = 'P0001'; end if;
    return r;
  end if;
  if now() < e.publiee_le or now() > e.ferme_le then
    raise exception 'Cette évaluation est close : les réponses ne sont plus acceptées.' using errcode = 'P0001';
  end if;
  if v_nom = '' or v_prenom = '' then raise exception 'Indiquez votre nom et votre prénom.' using errcode = 'P0001'; end if;
  begin v_classe := (p ->> 'classe_id')::uuid; exception when others then v_classe := null; end;
  if v_classe is null or not v_classe = any (e.classes) then raise exception 'Choisissez votre classe.' using errcode = 'P0001'; end if;
  if e.anonyme_ia and v_mat = '' then raise exception 'Indiquez votre matricule.' using errcode = 'P0001'; end if;
  select libelle into v_classe_lib from public.classes where id = v_classe;
  v_ident := public._normaliser(v_nom) || '|' || public._normaliser(v_prenom) || '|' || v_classe;
  if exists (select 1 from public.soumissions where evaluation_id = e.id and identite = v_ident) then
    raise exception 'Vous avez déjà envoyé votre formulaire pour cette évaluation.' using errcode = 'P0001';
  end if;
  select count(*) into v_n from public.soumissions where evaluation_id = e.id;
  if v_n >= 3000 then raise exception 'Nombre maximal de réponses atteint pour cette évaluation.' using errcode = 'P0001'; end if;
  r := public._smarteval_corriger(e.questions, coalesce(p -> 'reponses', '{}'::jsonb));
  -- élève reconnu dans la classe (nom et prénom, dans un sens ou dans l'autre) : sert à l'analyse et à l'anonymisation (matricule)
  select min(i.id::text)::uuid, count(*) into v_ins, x from public.inscriptions i join public.eleves el on el.id = i.eleve_id
   where i.classe_id = v_classe and i.exercice_id = e.exercice_id
     and (public._normaliser(el.nom || el.prenom) = public._normaliser(v_nom || v_prenom)
       or public._normaliser(el.nom || el.prenom) = public._normaliser(v_prenom || v_nom));
  if x <> 1 then v_ins := null; end if;
  -- nom non reconnu : le matricule saisi, s'il correspond à un élève de la classe, permet de le retrouver
  if v_ins is null and v_mat <> '' then
    select min(i.id::text)::uuid, count(*) into v_ins, x from public.inscriptions i join public.eleves el on el.id = i.eleve_id
     where i.classe_id = v_classe and i.exercice_id = e.exercice_id and upper(btrim(el.matricule)) = v_mat;
    if x <> 1 then v_ins := null; end if;
  end if;
  select coalesce(max(numero), 0) + 1 into v_num from public.soumissions where evaluation_id = e.id;
  insert into public.soumissions (evaluation_id, etablissement_id, numero, nom, prenom, classe_id, classe, inscription_id, identite,
                                  reponses, details, points, total, note20, a_corriger, matricule_saisi)
  values (e.id, e.etablissement_id, v_num, upper(v_nom), v_prenom, v_classe, v_classe_lib, v_ins, v_ident, r -> 'reponses', r -> 'details',
          (r ->> 'points')::numeric, (r ->> 'total')::numeric, (r ->> 'note20')::numeric, (r ->> 'a_corriger')::int, nullif(v_mat, ''))
  returning numero, soumis_le, nom, prenom, classe into so;
  return jsonb_build_object('numero', so.numero, 'recu', upper(substr(md5(e.id::text || so.numero), 1, 4)) || '-' || lpad(so.numero::text, 4, '0'),
                            'soumis_le', so.soumis_le, 'nom', so.nom, 'prenom', so.prenom, 'classe', so.classe, 'evaluation', e.titre);
end $$;
alter function public.smarteval_soumettre(text, jsonb) set plan_cache_mode = force_custom_plan;

-- Anonymisation des évaluations d'établissement (auteur)
create or replace function public.smarteval_anonymiser(p_id uuid, p_actif boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare e public.evaluations := public._smarteval_mienne(p_id);
begin
  update public.evaluations set anonyme_ia = coalesce(p_actif, false), modifie_le = now() where id = e.id;
end $$;

/** Copies anonymisées : l'élève n'est désigné que par son matricule (ou son numéro de copie s'il n'en a pas). */
create or replace function public._smarteval_anonymes(p_soumissions jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(s || jsonb_build_object('nom', coalesce(nullif(s ->> 'matricule', ''), 'Élève n° ' || (s ->> 'numero')), 'prenom', '')
                            order by (s ->> 'numero')::int), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_soumissions, '[]'::jsonb)) s
$$;

-- MCP (établissements) : résultats anonymisés si l'enseignant l'a demandé
create or replace function public.api_smarteval_resultats(p_cle text, p_evaluation text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c record; v_id uuid; n int; r jsonb;
begin
  select * into c from public._api_contexte(p_cle, false);
  begin v_id := btrim(p_evaluation)::uuid; exception when others then v_id := null; end;
  if v_id is null then
    select count(*), min(id::text)::uuid into n, v_id from public.evaluations
     where auteur_id = c.personnel and etablissement_id = c.etab
       and public._normaliser(titre) like '%' || public._normaliser(coalesce(p_evaluation, '')) || '%';
    if n = 0 then raise exception 'Aucune de vos évaluations SmartEval ne correspond à « % ». Utilisez smarteval_lister.', p_evaluation using errcode = 'P0001'; end if;
    if n > 1 then raise exception 'Plusieurs évaluations correspondent à « % » : précisez le titre ou utilisez l''identifiant (smarteval_lister).', p_evaluation using errcode = 'P0001'; end if;
  end if;
  r := public.smarteval_detail(v_id);
  -- anonymisation seulement si l'enseignant l'a activée : matricule de la fiche, sinon celui saisi par l'élève, sinon n° de copie
  if (select anonyme_ia from public.evaluations where id = v_id) then
    r := r || jsonb_build_object('anonymisee', true, 'soumissions', public._smarteval_anonymes((
      select coalesce(jsonb_agg(s || jsonb_build_object('matricule', coalesce(nullif(s ->> 'matricule', ''),
               (select so.matricule_saisi from public.soumissions so where so.evaluation_id = v_id and so.numero = (s ->> 'numero')::int)))
             order by (s ->> 'numero')::int), '[]'::jsonb)
        from jsonb_array_elements(r -> 'soumissions') s)));
  end if;
  perform public._api_journal(c.etab, c.personnel, c.source, 'smarteval_resultats',
    jsonb_build_object('evaluation', r ->> 'titre', 'soumissions', jsonb_array_length(r -> 'soumissions')));
  return r - 'entete' - 'jeton';
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 7. Paiements des enseignants : abonnement, crédits, groupe (activation après paiement vérifié uniquement)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._paiement_preparer_enseignant(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare cfg public.config_commerciale := public._config(); c public.comptes_enseignants := public._se_moi(); o jsonb; per public.se_periodes;
        v_produit text := p ->> 'produit'; v_montant int; v_qte int; v_libelle text; v_details jsonb := '{}'::jsonb; v_id uuid; v_mat text;
begin
  if c.type <> 'email' then raise exception 'Les membres d''un groupe sont couverts par l''abonnement du groupe.' using errcode = 'P0001'; end if;
  perform public._paiement_limite(null, c.id);
  o := public._se_offre(c);
  if v_produit = 'se_abonnement' then
    if c.groupe_id is not null then raise exception 'Vous administrez un groupe : renouvelez l''abonnement du groupe.' using errcode = 'P0001'; end if;
    per := public._se_periode(c);
    if per.id is not null and per.fin - make_interval(days => cfg.se_renouvellement_jours) > now() then
      raise exception 'Votre abonnement est en cours jusqu''au % : le renouvellement sera possible % jours avant l''échéance.',
        to_char(per.fin at time zone 'Africa/Douala', 'DD/MM/YYYY'), cfg.se_renouvellement_jours using errcode = 'P0001';
    end if;
    if exists (select 1 from public.se_periodes x where x.compte_id = c.id and x.debut > now()) then
      raise exception 'Un renouvellement est déjà payé et commencera à l''échéance actuelle.' using errcode = 'P0001';
    end if;
    v_montant := cfg.se_prix_annuel; v_qte := cfg.se_credits_inclus;
    v_libelle := format('SmartEval Enseignant — %s évaluations — 12 mois', cfg.se_credits_inclus);
  elsif v_produit = 'se_credits' then
    if not cfg.se_pack_actif then raise exception 'Les packs de crédits ne sont pas proposés actuellement.' using errcode = 'P0001'; end if;
    if o ->> 'offre' <> 'enseignant' then raise exception 'Les packs de crédits complètent un abonnement SmartEval Enseignant en cours.' using errcode = 'P0001'; end if;
    v_montant := cfg.se_pack_prix; v_qte := cfg.se_pack_credits;
    v_details := jsonb_build_object('periode_id', o ->> 'periode_id');
    v_libelle := format('SmartEval — pack de %s évaluations supplémentaires', cfg.se_pack_credits);
  elsif v_produit = 'se_groupe' then
    if not cfg.groupe_actif then raise exception 'L''abonnement de groupe n''est pas proposé actuellement.' using errcode = 'P0001'; end if;
    if c.groupe_id is not null and c.role_groupe <> 'admin' then raise exception 'Vous êtes membre d''un groupe.' using errcode = 'P0001'; end if;
    if c.groupe_id is not null then
      -- renouvellement du groupe existant (matière inchangée)
      select x.* into per from public.se_periodes x where x.groupe_id = c.groupe_id order by x.debut desc limit 1;
      if per.id is not null and per.fin - make_interval(days => cfg.se_renouvellement_jours) > now() then
        raise exception 'L''abonnement du groupe est en cours jusqu''au % : le renouvellement sera possible % jours avant l''échéance.',
          to_char(per.fin at time zone 'Africa/Douala', 'DD/MM/YYYY'), cfg.se_renouvellement_jours using errcode = 'P0001';
      end if;
      select matiere into v_mat from public.groupes_enseignants where id = c.groupe_id;
      v_details := jsonb_build_object('groupe_id', c.groupe_id);
    else
      v_mat := btrim(coalesce(p ->> 'matiere', ''));
      if char_length(v_mat) not between 2 and 80 then raise exception 'Indiquez la matière ou la discipline du département.' using errcode = 'P0001'; end if;
      if (o ->> 'offre') = 'enseignant' then
        raise exception 'Votre abonnement individuel est en cours : le groupe pourra être créé à son échéance, ou avec une autre adresse.' using errcode = 'P0001';
      end if;
      v_details := jsonb_build_object('matiere', v_mat, 'nom', left(btrim(coalesce(p ->> 'nom', '')), 120));
    end if;
    v_montant := cfg.groupe_prix_annuel; v_qte := cfg.groupe_membres_max;
    v_libelle := format('SmartEval Groupe — %s — jusqu''à %s enseignants — 12 mois', v_mat, cfg.groupe_membres_max);
  else
    raise exception 'Produit inconnu.' using errcode = 'P0001';
  end if;
  insert into public.paiements_abonnement (compte_id, offre, periode, montant, demande_par, produit, quantite, details)
  values (c.id, case v_produit when 'se_credits' then 'credits' when 'se_groupe' then 'groupe' else 'smarteval' end,
          case when v_produit = 'se_credits' then 'aucune' else 'annuel' end, v_montant, c.id, v_produit, v_qte, v_details || jsonb_build_object('libelle', v_libelle))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'montant', v_montant, 'devise', 'XAF', 'produit', v_produit, 'libelle', v_libelle,
                            'client', btrim(c.nom || ' ' || c.prenom), 'email', c.email);
end $$;
revoke execute on function public._paiement_preparer_enseignant(jsonb) from public, anon, authenticated;

create or replace function public._activer_enseignant(p public.paiements_abonnement) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare cfg public.config_commerciale := public._config(); c public.comptes_enseignants; per public.se_periodes; g public.groupes_enseignants;
        v_debut timestamptz; v_fin timestamptz; v_gid uuid;
begin
  select * into c from public.comptes_enseignants where id = p.compte_id for update;
  -- état revérifié sous verrou (il a pu changer entre la préparation et le paiement) : un achat devenu sans effet
  -- n'est pas activé en silence, il est signalé à traiter (remboursement ou report) dans l'historique
  if (p.produit = 'se_abonnement' and c.groupe_id is not null)
     or (p.produit = 'se_groupe' and c.groupe_id is not null and c.role_groupe <> 'admin')
     or (p.produit = 'se_groupe' and c.groupe_id is not null and nullif(p.details ->> 'groupe_id', '') is null) then
    insert into public.abonnements_historique (compte_id, type, montant, paiement_id, details)
    values (c.id, case p.produit when 'se_groupe' then 'groupe' else 'souscription' end, p.montant, p.id,
            jsonb_build_object('a_traiter', 'achat incompatible avec l''état du compte à l''activation', 'produit', p.produit));
    return jsonb_build_object('debut', now(), 'fin', now(), 'a_traiter', true);
  end if;
  if p.produit = 'se_groupe' and c.groupe_id is null and exists (select 1 from public.se_periodes x where x.compte_id = c.id and x.fin > now()) then
    -- le groupe est créé (achat le plus large) ; la période individuelle restante est signalée pour remboursement ou report
    insert into public.abonnements_historique (compte_id, type, montant, paiement_id, details)
    values (c.id, 'groupe', 0, p.id, jsonb_build_object('a_traiter', 'période individuelle encore en cours à la création du groupe'));
  end if;
  if p.produit = 'se_abonnement' then
    select x.* into per from public.se_periodes x where x.compte_id = c.id order by x.fin desc limit 1;
    v_debut := case when per.id is not null and per.fin > now() then per.fin else now() end;     -- renouvellement anticipé : aucun jour perdu
    v_fin := v_debut + make_interval(months => cfg.se_duree_mois);
    insert into public.se_periodes (compte_id, debut, fin, credits_inclus, paiement_id) values (c.id, v_debut, v_fin, p.quantite, p.id);
    insert into public.abonnements_historique (compte_id, type, montant, paiement_id, debut, fin, details)
    values (c.id, case when per.id is not null then 'renouvellement' else 'souscription' end, p.montant, p.id, v_debut, v_fin, jsonb_build_object('credits', p.quantite));
    return jsonb_build_object('debut', v_debut, 'fin', v_fin);
  elsif p.produit = 'se_credits' then
    select x.* into per from public.se_periodes x where x.id = nullif(p.details ->> 'periode_id', '')::uuid and x.compte_id = c.id for update;
    if per.id is null or per.fin <= now() then per := public._se_periode(c); end if;
    if per.id is null then
      insert into public.abonnements_historique (compte_id, type, montant, paiement_id, details)
      values (c.id, 'credits', p.montant, p.id, jsonb_build_object('a_traiter', 'aucune période en cours à l''activation', 'credits', p.quantite));
      return jsonb_build_object('debut', now(), 'fin', now(), 'a_traiter', true);
    end if;
    update public.se_periodes set credits_supplementaires = credits_supplementaires + p.quantite where id = per.id;
    insert into public.abonnements_historique (compte_id, type, montant, paiement_id, debut, fin, details)
    values (c.id, 'credits', p.montant, p.id, per.debut, per.fin, jsonb_build_object('credits', p.quantite));
    return jsonb_build_object('debut', per.debut, 'fin', per.fin);
  end if;
  -- groupe : création (matière figée) ou renouvellement
  v_gid := coalesce(nullif(p.details ->> 'groupe_id', '')::uuid, c.groupe_id);
  if v_gid is null then
    insert into public.groupes_enseignants (nom, matiere, matiere_norm, admin_id, membres_max)
    values (left(coalesce(p.details ->> 'nom', ''), 120), left(btrim(p.details ->> 'matiere'), 80), public._normaliser(p.details ->> 'matiere'), c.id, p.quantite)
    returning id into v_gid;
    update public.comptes_enseignants set groupe_id = v_gid, role_groupe = 'admin' where id = c.id;
  end if;
  select x.* into per from public.se_periodes x where x.groupe_id = v_gid order by x.fin desc limit 1;
  v_debut := case when per.id is not null and per.fin > now() then per.fin else now() end;
  v_fin := v_debut + make_interval(months => cfg.se_duree_mois);
  insert into public.se_periodes (groupe_id, debut, fin, credits_inclus, paiement_id) values (v_gid, v_debut, v_fin, cfg.groupe_credits_membre, p.id);
  insert into public.abonnements_historique (compte_id, type, montant, paiement_id, debut, fin, details)
  values (c.id, 'groupe', p.montant, p.id, v_debut, v_fin, jsonb_build_object('groupe_id', v_gid, 'matiere', (select matiere from public.groupes_enseignants where id = v_gid)));
  return jsonb_build_object('debut', v_debut, 'fin', v_fin, 'groupe_id', v_gid);
end $$;
revoke execute on function public._activer_enseignant(public.paiements_abonnement) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 8. Connexion IA personnelle (MCP) : clés « nxe_ » et OAuth, limitées aux évaluations de l'enseignant
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.enseignant_ia() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.comptes_enseignants;
begin
  select * into c from public.comptes_enseignants where id = auth.uid() and actif;
  if c.id is null then raise exception 'Réservé aux comptes enseignants SmartEval.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'acces', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'type', a.type, 'libelle', coalesce(nullif(a.libelle, ''), o.nom, ''),
                'cree_le', a.cree_le, 'expire_le', case when a.type = 'cle' then a.acces_expire_le else a.rafraichissement_expire_le end,
                'derniere_utilisation', a.derniere_utilisation) order by a.cree_le desc), '[]'::jsonb)
              from public.acces_ia_enseignants a left join public.oauth_clients o on o.id = a.client_id
             where a.compte_id = c.id and a.revoque_le is null
               and ((a.type = 'cle' and a.acces_expire_le > now()) or (a.type = 'oauth' and a.rafraichissement_expire_le > now()))),
    'journal', (select coalesce(jsonb_agg(jsonb_build_object('outil', j.outil, 'erreur', j.erreur, 'le', j.le) order by j.le desc), '[]'::jsonb)
                  from (select * from public.journal_api_enseignants where compte_id = c.id order by le desc limit 50) j));
end $$;

create or replace function public.enseignant_ia_creer_cle(p_libelle text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c public.comptes_enseignants := public._se_moi(); v_cle text := 'nxe_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  if (select count(*) from public.acces_ia_enseignants where compte_id = c.id and revoque_le is null
        and ((type = 'cle' and acces_expire_le > now()) or (type = 'oauth' and rafraichissement_expire_le > now()))) >= 5 then
    raise exception 'Cinq accès au plus : révoquez-en un avant d''en créer un autre.' using errcode = 'P0001';
  end if;
  insert into public.acces_ia_enseignants (compte_id, type, libelle, acces_hash, acces_expire_le)
  values (c.id, 'cle', left(btrim(coalesce(p_libelle, '')), 60), encode(extensions.digest(v_cle, 'sha256'), 'hex'), now() + interval '365 days');
  return jsonb_build_object('cle', v_cle, 'expire_le', now() + interval '365 days');
end $$;

create or replace function public.enseignant_ia_revoquer(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare c public.comptes_enseignants := public._se_moi();
begin
  update public.acces_ia_enseignants set revoque_le = now() where id = p_id and compte_id = c.id and revoque_le is null;
  if not found then raise exception 'Accès introuvable ou déjà révoqué.' using errcode = 'P0001'; end if;
end $$;

/** Accès IA d'un enseignant : clé ou jeton OAuth valide, compte actif ; 300 appels par heure ; journal. */
create or replace function public._api_enseignant(p_cle text, p_outil text) returns public.acces_ia_enseignants
language plpgsql volatile security definer set search_path = '' as $$
declare a public.acces_ia_enseignants; n int;
begin
  if coalesce(p_cle, '') !~ '^nxe_[0-9a-f]{48}$' then raise exception 'Clé d''accès invalide.' using errcode = '28000'; end if;
  select * into a from public.acces_ia_enseignants where acces_hash = encode(extensions.digest(p_cle, 'sha256'), 'hex');
  if a.id is null or a.revoque_le is not null or a.acces_expire_le < now() then
    raise exception 'Accès révoqué ou expiré : reconnectez votre assistant depuis votre espace SmartEval (IA & API).' using errcode = '28000';
  end if;
  if not exists (select 1 from public.comptes_enseignants where id = a.compte_id and actif) then raise exception 'Compte désactivé.' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtext('ia_enseignant:' || a.id::text));
  select count(*) into n from public.journal_api_enseignants where acces_id = a.id and le > now() - interval '1 hour';
  if n >= 300 then raise exception 'Limite atteinte : 300 appels par heure. Réessayez plus tard.' using errcode = 'P0001'; end if;
  insert into public.journal_api_enseignants (compte_id, acces_id, outil) values (a.compte_id, a.id, left(coalesce(p_outil, ''), 40));
  update public.acces_ia_enseignants set derniere_utilisation = now()
   where id = a.id and (derniere_utilisation is null or derniere_utilisation < now() - interval '1 minute');
  return a;
end $$;
revoke execute on function public._api_enseignant(text, text) from public, anon, authenticated;

/** Outils MCP de l'enseignant indépendant : contexte, smarteval_lister, smarteval_resultats (lecture seule, ses évaluations). */
create or replace function public.api_enseignant(p_cle text, p_outil text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare a public.acces_ia_enseignants; r jsonb; v_id uuid; n int; arg jsonb := coalesce(p_args, '{}'::jsonb); v_q text;
begin
  a := public._api_enseignant(p_cle, p_outil);
  perform set_config('request.jwt.claim.sub', a.compte_id::text, true);     -- les fonctions ci-dessous ne voient que ses données
  begin
    case p_outil
      when 'contexte' then
        r := public.enseignant_contexte() - 'paiements' - 'tarifs';
      when 'smarteval_lister' then
        r := public.se_liste();
      when 'smarteval_resultats' then
        v_q := btrim(coalesce(arg ->> 'evaluation', ''));
        begin v_id := v_q::uuid; exception when others then v_id := null; end;
        if v_id is null then
          select count(*), min(id::text)::uuid into n, v_id from public.se_evaluations
           where compte_id = a.compte_id and public._normaliser(titre) like '%' || public._normaliser(v_q) || '%';
          if n = 0 then raise exception 'Aucune de vos évaluations ne correspond à « % ». Utilisez smarteval_lister.', v_q using errcode = 'P0001'; end if;
          if n > 1 then raise exception 'Plusieurs évaluations correspondent à « % » : précisez le titre ou utilisez l''identifiant.', v_q using errcode = 'P0001'; end if;
        end if;
        r := public.se_detail(v_id);
        if (r ->> 'anonyme_ia')::boolean then
          r := r || jsonb_build_object('soumissions', public._smarteval_anonymes(r -> 'soumissions'), 'anonymisee', true);
        end if;
        r := r - 'entete' - 'jeton';
      else raise exception 'Outil inconnu : %', p_outil using errcode = 'P0001';
    end case;
    return r;
  exception when others then
    update public.journal_api_enseignants set erreur = left(sqlerrm, 200) where id = (select max(id) from public.journal_api_enseignants where acces_id = a.id);
    return jsonb_build_object('erreur', case when sqlstate in ('P0001', '22023', '28000') then sqlerrm else 'Erreur lors de l''exécution de l''outil.' end);
  end;
end $$;

/** OAuth : accord donné par l'enseignant connecté à son espace SmartEval (code 5 minutes, usage unique, PKCE S256). */
create or replace function public.oauth_autoriser_enseignant(p_client_id text, p_redirect_uri text, p_code_challenge text, p_methode text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare c public.comptes_enseignants := public._se_moi(); v_code text;
begin
  if not exists (select 1 from public.oauth_clients where id = p_client_id and p_redirect_uri = any (redirect_uris)) then
    raise exception 'Application inconnue ou adresse de retour non enregistrée.' using errcode = 'P0001';
  end if;
  if coalesce(p_methode, '') <> 'S256' or coalesce(p_code_challenge, '') !~ '^[A-Za-z0-9_-]{43,128}$' then
    raise exception 'PKCE (S256) obligatoire.' using errcode = 'P0001';
  end if;
  v_code := encode(extensions.gen_random_bytes(32), 'hex');
  delete from public.oauth_codes_enseignants where expire_le < now();
  insert into public.oauth_codes_enseignants (code_hash, client_id, compte_id, redirect_uri, code_challenge, expire_le)
  values (encode(extensions.digest(v_code, 'sha256'), 'hex'), p_client_id, c.id, p_redirect_uri, p_code_challenge, now() + interval '5 minutes');
  return json_build_object('code', v_code);
end $$;

create or replace function public._oauth_emettre_enseignant(p_compte uuid, p_client text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare acces text := 'nxe_' || encode(extensions.gen_random_bytes(24), 'hex'); rafr text := 'nxf_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  insert into public.acces_ia_enseignants (compte_id, type, client_id, acces_hash, acces_expire_le, rafraichissement_hash, rafraichissement_expire_le)
  values (p_compte, 'oauth', p_client, encode(extensions.digest(acces, 'sha256'), 'hex'), now() + interval '1 hour',
          encode(extensions.digest(rafr, 'sha256'), 'hex'), now() + interval '30 days');
  return json_build_object('access_token', acces, 'token_type', 'Bearer', 'expires_in', 3600, 'refresh_token', rafr, 'scope', 'smarteval');
end $$;
revoke execute on function public._oauth_emettre_enseignant(uuid, text) from public, anon, authenticated;

-- Échange du code : personnel (0008), parent (0048) ou enseignant indépendant
create or replace function public.oauth_echanger_code(p_code text, p_verifier text, p_client_id text, p_redirect_uri text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare k record; kp record; ke record; h text := encode(extensions.digest(coalesce(p_code, ''), 'sha256'), 'hex');
begin
  delete from public.oauth_codes where code_hash = h returning * into k;
  if k.code_hash is not null then
    if k.expire_le < now() or k.client_id <> p_client_id or k.redirect_uri <> p_redirect_uri
       or public._b64url_sha256(coalesce(p_verifier, '')) <> k.code_challenge then
      return json_build_object('error', 'invalid_grant', 'error_description', 'Code invalide, expiré ou déjà utilisé.');
    end if;
    return public._oauth_emettre(k.etablissement_id, k.personnel_id, k.client_id, k.ecriture);
  end if;
  delete from public.oauth_codes_parents where code_hash = h returning * into kp;
  if kp.code_hash is not null then
    if kp.expire_le < now() or kp.client_id <> p_client_id or kp.redirect_uri <> p_redirect_uri
       or public._b64url_sha256(coalesce(p_verifier, '')) <> kp.code_challenge then
      return json_build_object('error', 'invalid_grant', 'error_description', 'Code invalide, expiré ou déjà utilisé.');
    end if;
    return public._oauth_emettre_parent(kp.etablissement_id, kp.eleve_id, kp.client_id);
  end if;
  delete from public.oauth_codes_enseignants where code_hash = h returning * into ke;
  if ke.code_hash is null or ke.expire_le < now() or ke.client_id <> p_client_id or ke.redirect_uri <> p_redirect_uri
     or public._b64url_sha256(coalesce(p_verifier, '')) <> ke.code_challenge then
    return json_build_object('error', 'invalid_grant', 'error_description', 'Code invalide, expiré ou déjà utilisé.');
  end if;
  return public._oauth_emettre_enseignant(ke.compte_id, ke.client_id);
end $$;

-- Rafraîchissement : personnel, parent (« nxq_ ») ou enseignant (« nxf_ ») ; un jeton déjà utilisé révoque toute la lignée
create or replace function public.oauth_rafraichir(p_refresh text, p_client_id text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare j record; a public.acces_ia_parents; ancien public.acces_ia_parents; ae public.acces_ia_enseignants; ancienne public.acces_ia_enseignants;
        h text := encode(extensions.digest(coalesce(p_refresh, ''), 'sha256'), 'hex');
begin
  if p_refresh like 'nxf_%' then
    update public.acces_ia_enseignants set revoque_le = now()
     where rafraichissement_hash = h and client_id = p_client_id and revoque_le is null and rafraichissement_expire_le > now()
    returning * into ae;
    if ae.id is null then
      select * into ancienne from public.acces_ia_enseignants where rafraichissement_hash = h and client_id = p_client_id;
      if ancienne.id is not null then
        update public.acces_ia_enseignants set revoque_le = now() where compte_id = ancienne.compte_id and client_id = ancienne.client_id and revoque_le is null;
      end if;
      return json_build_object('error', 'invalid_grant', 'error_description', 'Jeton de rafraîchissement invalide ou révoqué.');
    end if;
    if not exists (select 1 from public.comptes_enseignants where id = ae.compte_id and actif) then
      return json_build_object('error', 'invalid_grant', 'error_description', 'Jeton de rafraîchissement invalide ou révoqué.');
    end if;
    return public._oauth_emettre_enseignant(ae.compte_id, ae.client_id);
  end if;
  if p_refresh like 'nxq_%' then
    update public.acces_ia_parents set revoque_le = now()
     where rafraichissement_hash = h and client_id = p_client_id and revoque_le is null and rafraichissement_expire_le > now()
    returning * into a;
    if a.id is null then
      select * into ancien from public.acces_ia_parents where rafraichissement_hash = h and client_id = p_client_id;
      if ancien.id is not null then
        update public.acces_ia_parents set revoque_le = now() where eleve_id = ancien.eleve_id and client_id = ancien.client_id and revoque_le is null;
      end if;
      return json_build_object('error', 'invalid_grant', 'error_description', 'Jeton de rafraîchissement invalide ou révoqué.');
    end if;
    if not public._ia_parents_ouverte(a.etablissement_id) then
      return json_build_object('error', 'invalid_grant', 'error_description', 'Jeton de rafraîchissement invalide ou révoqué.');
    end if;
    return public._oauth_emettre_parent(a.etablissement_id, a.eleve_id, a.client_id);
  end if;
  update public.jetons_oauth set revoque_le = now()
   where rafraichissement_hash = h and client_id = p_client_id and revoque_le is null and rafraichissement_expire_le > now()
  returning * into j;
  if j.id is null or not public._ia_active(j.personnel_id) then
    return json_build_object('error', 'invalid_grant', 'error_description', 'Jeton de rafraîchissement invalide ou révoqué.');
  end if;
  return public._oauth_emettre(j.etablissement_id, j.personnel_id, j.client_id, j.ecriture);
end $$;

-- Compte connecté : indique aussi un compte enseignant indépendant
create or replace function public.mon_compte() returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'proprietaire', public.est_proprietaire(),
    'suspendu', e.suspendu_le is not null,
    'motif', coalesce(e.motif_suspension, ''),
    'etablissement', e.nom,
    'enseignant', exists (select 1 from public.comptes_enseignants c where c.id = auth.uid() and c.actif))
  from (select 1) x
  left join public.personnels p on p.id = auth.uid()
  left join public.etablissements e on e.id = p.etablissement_id
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 9. Droits d'exécution
-- ---------------------------------------------------------------------------------------------------------
revoke execute on function public.enseignant_inscription(text, text), public.enseignant_contexte(), public.enseignant_modifier_profil(text, text),
  public.groupe_generer_code(), public.groupe_creer_membre(text, text), public.groupe_nouveau_code_membre(uuid), public.groupe_activer_membre(uuid, boolean),
  public.groupe_membres(), public.se_enregistrer(jsonb), public.se_publier(uuid, int, text, jsonb), public.se_clore(uuid), public.se_supprimer(uuid),
  public.se_archiver(uuid, boolean), public.se_dupliquer(uuid), public.se_anonymiser(uuid, boolean), public.se_liste(), public.se_detail(uuid),
  public.se_marquer_vu(), public.smarteval_anonymiser(uuid, boolean), public.enseignant_ia(), public.enseignant_ia_creer_cle(text),
  public.enseignant_ia_revoquer(uuid), public.oauth_autoriser_enseignant(text, text, text, text) from public, anon;
grant execute on function public.enseignant_inscription(text, text), public.enseignant_contexte(), public.enseignant_modifier_profil(text, text),
  public.groupe_generer_code(), public.groupe_creer_membre(text, text), public.groupe_nouveau_code_membre(uuid), public.groupe_activer_membre(uuid, boolean),
  public.groupe_membres(), public.se_enregistrer(jsonb), public.se_publier(uuid, int, text, jsonb), public.se_clore(uuid), public.se_supprimer(uuid),
  public.se_archiver(uuid, boolean), public.se_dupliquer(uuid), public.se_anonymiser(uuid, boolean), public.se_liste(), public.se_detail(uuid),
  public.se_marquer_vu(), public.smarteval_anonymiser(uuid, boolean), public.enseignant_ia(), public.enseignant_ia_creer_cle(text),
  public.enseignant_ia_revoquer(uuid), public.oauth_autoriser_enseignant(text, text, text, text) to authenticated;
revoke execute on function public.groupe_ouvrir(text), public.groupe_connexion(text, uuid, text), public.api_enseignant(text, text, jsonb) from public;
grant execute on function public.groupe_ouvrir(text), public.groupe_connexion(text, uuid, text), public.api_enseignant(text, text, jsonb) to anon, authenticated;
revoke execute on function public._smarteval_anonymes(jsonb) from public, anon, authenticated;

/** Évaluation d'établissement : l'auteur voit aussi l'option d'anonymisation (jamais exposée aux élèves). */
create or replace function public._smarteval_json(e public.evaluations, p_corriges boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', e.id, 'titre', e.titre, 'consignes', e.consignes, 'competence', e.competence,
    'matiere_id', e.matiere_id, 'matiere', m.libelle, 'sequence_id', e.sequence_id, 'sequence', s.numero, 'trimestre', s.trimestre,
    'annee', x.libelle, 'classes', (select jsonb_agg(jsonb_build_object('id', c.id, 'libelle', c.libelle) order by c.ordre, c.libelle)
                                       from public.classes c where c.id = any (e.classes)),
    'questions', case when p_corriges then e.questions
                      else (select coalesce(jsonb_agg(q - 'bonnes' - 'acceptees' order by o), '[]'::jsonb) from jsonb_array_elements(e.questions) with ordinality t(q, o)) end,
    'supports', e.supports,
    'entete', e.entete, 'duree_valeur', e.duree_valeur, 'duree_unite', e.duree_unite,
    'jeton', case when p_corriges then e.jeton end, 'publiee_le', e.publiee_le, 'ferme_le', e.ferme_le,
    'statut', public._smarteval_statut(e), 'cree_le', e.cree_le,
    'auteur', (select btrim(p.nom || ' ' || p.prenom) from public.personnels p where p.id = e.auteur_id),
    'demande_matricule', e.anonyme_ia)
    || case when p_corriges then jsonb_build_object('anonyme_ia', e.anonyme_ia) else '{}'::jsonb end
  from public.matieres m, public.sequences s, public.exercices x
  where m.id = e.matiere_id and s.id = e.sequence_id and x.id = e.exercice_id
$$;
