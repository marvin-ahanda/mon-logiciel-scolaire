-- Pilotage institutionnel : remontée, centralisation et consolidation des fiches de synthèse statistiques
--   établissement → délégation départementale → délégation régionale (enseignements secondaires).
-- Principes :
--  * référentiel territorial unique (régions, départements) administré par le propriétaire de la plateforme, historisé ;
--    les données pré-remplies sont marquées « à vérifier » tant qu'elles n'ont pas été validées ;
--  * une seule délégation par circonscription (contrainte d'unicité sur l'identifiant du département ou de la région),
--    un seul titulaire actif ; le changement de titulaire garde l'entité, ses documents et son historique ;
--  * comptes de délégués gratuits, ouverts seulement après validation par le propriétaire (e-mail vérifié, justificatif) ;
--  * toute autorisation est vérifiée ici, à partir de l'établissement propriétaire et de la circonscription ;
--  * aucune donnée statistique n'est inventée : valeurs saisies ou calculées, données manquantes signalées ;
--  * NexIA School n'est pas présentée comme un service officiel du MINESEC.

-- ---------------------------------------------------------------------------------------------------------
-- 1. Journal d'audit (ajout seul : aucune modification ni suppression, même par les fonctions)
-- ---------------------------------------------------------------------------------------------------------
create table public.inst_journal (
  id bigint generated always as identity primary key,
  le timestamptz not null default now(),
  auteur uuid,
  action text not null,
  objet text not null,
  objet_id uuid,
  resultat text not null default 'ok',
  details jsonb not null default '{}'
);
create index on public.inst_journal (objet, objet_id);
create index on public.inst_journal (le desc);
alter table public.inst_journal enable row level security;
revoke all on public.inst_journal from anon, authenticated;

create or replace function public._inst_journal_immuable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Le journal institutionnel ne peut être ni modifié ni supprimé.' using errcode = '42501';
end $$;
create trigger inst_journal_immuable before update or delete on public.inst_journal for each row execute function public._inst_journal_immuable();

create or replace function public._inst_journaliser(p_action text, p_objet text, p_objet_id uuid, p_details jsonb default '{}', p_resultat text default 'ok') returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.inst_journal (auteur, action, objet, objet_id, resultat, details) values (auth.uid(), p_action, p_objet, p_objet_id, coalesce(p_resultat, 'ok'), coalesce(p_details, '{}'))
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 2. Référentiel territorial
-- ---------------------------------------------------------------------------------------------------------
create table public.inst_regions (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (char_length(btrim(nom)) between 2 and 80),
  nom_norm text not null unique,
  code text unique check (code is null or char_length(code) between 1 and 20),
  actif boolean not null default true,
  verifie boolean not null default false,                 -- rattachements validés par le propriétaire de la plateforme
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create table public.inst_departements (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references public.inst_regions (id),
  nom text not null check (char_length(btrim(nom)) between 2 and 80),
  nom_norm text not null,
  code text unique check (code is null or char_length(code) between 1 and 20),
  actif boolean not null default true,
  verifie boolean not null default false,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  unique (region_id, nom_norm)
);
create index on public.inst_departements (region_id);
create table public.inst_referentiel_historique (
  id bigint generated always as identity primary key,
  objet text not null check (objet in ('region', 'departement')),
  objet_id uuid not null,
  action text not null,
  avant jsonb,
  apres jsonb,
  auteur uuid default auth.uid(),
  le timestamptz not null default now()
);
alter table public.inst_regions enable row level security;
alter table public.inst_departements enable row level security;
alter table public.inst_referentiel_historique enable row level security;
revoke all on public.inst_regions, public.inst_departements, public.inst_referentiel_historique from anon, authenticated;
grant select on public.inst_regions, public.inst_departements to anon, authenticated;
create policy "lecture publique des circonscriptions actives" on public.inst_regions for select to anon, authenticated using (actif);
create policy "lecture publique des circonscriptions actives" on public.inst_departements for select to anon, authenticated using (actif);

-- Pré-remplissage : 10 régions et 58 départements du Cameroun (découpage administratif), À VÉRIFIER par le propriétaire de la
-- plateforme avant toute utilisation institutionnelle (verifie = false). Modifiable sans développeur (console).
do $$
declare r record; v_region uuid; d text;
begin
  for r in select * from (values
    ('Adamaoua', array['Djérem', 'Faro-et-Déo', 'Mayo-Banyo', 'Mbéré', 'Vina']),
    ('Centre', array['Haute-Sanaga', 'Lekié', 'Mbam-et-Inoubou', 'Mbam-et-Kim', 'Méfou-et-Afamba', 'Méfou-et-Akono', 'Mfoundi', 'Nyong-et-Kéllé', 'Nyong-et-Mfoumou', 'Nyong-et-So''o']),
    ('Est', array['Boumba-et-Ngoko', 'Haut-Nyong', 'Kadey', 'Lom-et-Djérem']),
    ('Extrême-Nord', array['Diamaré', 'Logone-et-Chari', 'Mayo-Danay', 'Mayo-Kani', 'Mayo-Sava', 'Mayo-Tsanaga']),
    ('Littoral', array['Moungo', 'Nkam', 'Sanaga-Maritime', 'Wouri']),
    ('Nord', array['Bénoué', 'Faro', 'Mayo-Louti', 'Mayo-Rey']),
    ('Nord-Ouest', array['Boyo', 'Bui', 'Donga-Mantung', 'Menchum', 'Mezam', 'Momo', 'Ngo-Ketunjia']),
    ('Ouest', array['Bamboutos', 'Haut-Nkam', 'Hauts-Plateaux', 'Koung-Khi', 'Menoua', 'Mifi', 'Ndé', 'Noun']),
    ('Sud', array['Dja-et-Lobo', 'Mvila', 'Océan', 'Vallée-du-Ntem']),
    ('Sud-Ouest', array['Fako', 'Koupé-Manengouba', 'Lebialem', 'Manyu', 'Meme', 'Ndian'])) as t(nom, deps)
  loop
    insert into public.inst_regions (nom, nom_norm) values (r.nom, public._normaliser(r.nom))
    on conflict (nom_norm) do nothing;
    select id into v_region from public.inst_regions where nom_norm = public._normaliser(r.nom);
    foreach d in array r.deps loop
      insert into public.inst_departements (region_id, nom, nom_norm) values (v_region, d, public._normaliser(d)) on conflict do nothing;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Délégations (une seule par circonscription), membres (un seul titulaire actif), demandes de compte
-- ---------------------------------------------------------------------------------------------------------
create table public.inst_delegations (
  id uuid primary key default gen_random_uuid(),
  niveau text not null check (niveau in ('departement', 'region')),
  region_id uuid not null references public.inst_regions (id),
  departement_id uuid references public.inst_departements (id),
  nom text not null check (char_length(btrim(nom)) between 5 and 200),
  actif boolean not null default true,
  collaborateurs_autorises boolean not null default false,
  ia_categories text[] not null default array['statuts', 'indicateurs']::text[],   -- catégories de données lisibles par l'IA (MCP)
  cree_le timestamptz not null default now(),
  check ((niveau = 'departement') = (departement_id is not null)),
  check (ia_categories <@ array['statuts', 'indicateurs', 'detail_lignes', 'noms_enseignants', 'courriers']::text[])
);
create unique index inst_delegation_unique_departement on public.inst_delegations (departement_id) where niveau = 'departement';
create unique index inst_delegation_unique_region on public.inst_delegations (region_id) where niveau = 'region';

create table public.inst_membres (
  id uuid primary key default gen_random_uuid(),
  delegation_id uuid not null references public.inst_delegations (id),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('titulaire', 'collaborateur')),
  permissions text[] not null default '{}' check (permissions <@ array['examen', 'courriers', 'synthese']::text[]),
  nom text not null default '',
  prenom text not null default '',
  fonction text not null default '',
  email text not null default '',
  actif boolean not null default true,
  debut timestamptz not null default now(),
  revoque_le timestamptz,
  motif_revocation text,
  demande_id uuid
);
create unique index inst_un_titulaire_actif on public.inst_membres (delegation_id) where role = 'titulaire' and actif;
create unique index inst_une_delegation_par_compte on public.inst_membres (user_id) where actif;

create table public.inst_demandes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  niveau text not null check (niveau in ('departement', 'region')),
  region_id uuid not null references public.inst_regions (id),
  departement_id uuid references public.inst_departements (id),
  nom text not null default '' check (char_length(nom) <= 100),
  prenom text not null default '' check (char_length(prenom) <= 100),
  email text not null default '',
  telephone text not null default '' check (char_length(telephone) <= 40),
  fonction text not null default '' check (char_length(fonction) <= 150),
  justificatif text check (char_length(justificatif) <= 300),
  statut text not null default 'brouillon' check (statut in ('brouillon', 'soumise', 'en_verification', 'approuvee', 'rejetee', 'suspendue')),
  motif_decision text not null default '' check (char_length(motif_decision) <= 500),
  decide_par uuid,
  decide_le timestamptz,
  soumise_le timestamptz,
  cree_le timestamptz not null default now(),
  check ((niveau = 'departement') = (departement_id is not null))
);
create unique index inst_une_demande_ouverte on public.inst_demandes (user_id) where statut in ('brouillon', 'soumise', 'en_verification');
alter table public.inst_delegations enable row level security;
alter table public.inst_membres enable row level security;
alter table public.inst_demandes enable row level security;
revoke all on public.inst_delegations, public.inst_membres, public.inst_demandes from anon, authenticated;

/** Membre actif de la délégation de la personne connectée (null sinon). */
create or replace function public._inst_moi() returns public.inst_membres
language sql stable security definer set search_path = '' as $$
  select m.* from public.inst_membres m join public.inst_delegations d on d.id = m.delegation_id
   where m.user_id = auth.uid() and m.actif and d.actif limit 1
$$;
/** Exige un membre actif ; permission facultative (le titulaire les a toutes). Renvoie le membre. */
create or replace function public._inst_exiger(p_permission text default null) returns public.inst_membres
language plpgsql stable security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_moi();
begin
  if m.id is null then raise exception 'Réservé aux délégations validées.' using errcode = '42501'; end if;
  if p_permission is not null and m.role <> 'titulaire' and not (p_permission = any (m.permissions)) then
    raise exception 'Action non autorisée pour votre profil de collaborateur.' using errcode = '42501';
  end if;
  return m;
end $$;

create or replace function public.inst_nom_delegation(p_niveau text, p_nom text) returns text
language sql immutable set search_path = '' as $$
  select case when p_niveau = 'region' then 'Délégation régionale des enseignements secondaires — ' || p_nom
              else 'Délégation départementale des enseignements secondaires — ' || p_nom end
$$;

-- --- Demande de compte (délégué) ---
create or replace function public.inst_demande_enregistrer(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u record; v_niveau text := p ->> 'niveau'; v_region uuid := nullif(p ->> 'region_id', '')::uuid; v_dep uuid := nullif(p ->> 'departement_id', '')::uuid;
        d public.inst_demandes; v_just text := nullif(btrim(coalesce(p ->> 'justificatif', '')), '');
begin
  select id, email, email_confirmed_at into u from auth.users where id = auth.uid();
  if u.id is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  if coalesce(u.email, '') = '' or u.email like '%.invalid' then raise exception 'Une adresse e-mail réelle est nécessaire.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.personnels where id = u.id) or exists (select 1 from public.comptes_enseignants where id = u.id) then
    raise exception 'Ce compte est déjà utilisé par un établissement ou un enseignant : utilisez une autre adresse e-mail pour la délégation.' using errcode = 'P0001';
  end if;
  if (public._inst_moi()).id is not null then raise exception 'Votre compte est déjà rattaché à une délégation.' using errcode = 'P0001'; end if;
  if v_niveau not in ('departement', 'region') then raise exception 'Choisissez le type de délégation.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.inst_regions where id = v_region and actif) then raise exception 'Région inconnue.' using errcode = 'P0001'; end if;
  if v_niveau = 'departement' and not exists (select 1 from public.inst_departements where id = v_dep and region_id = v_region and actif) then
    raise exception 'Choisissez un département de la région sélectionnée.' using errcode = 'P0001';
  end if;
  if v_niveau = 'region' then v_dep := null; end if;
  if v_just is not null and v_just not like 'demandes/' || u.id::text || '/%' then raise exception 'Justificatif invalide.' using errcode = 'P0001'; end if;
  select * into d from public.inst_demandes where user_id = u.id and statut in ('brouillon', 'soumise', 'en_verification') for update;
  if d.id is not null and d.statut <> 'brouillon' then raise exception 'Votre demande est en cours d''examen : elle ne peut plus être modifiée.' using errcode = 'P0001'; end if;
  if d.id is null then
    insert into public.inst_demandes (user_id, niveau, region_id, departement_id, nom, prenom, email, telephone, fonction, justificatif)
    values (u.id, v_niveau, v_region, v_dep, upper(left(btrim(coalesce(p ->> 'nom', '')), 100)), left(btrim(coalesce(p ->> 'prenom', '')), 100), lower(u.email),
            left(btrim(coalesce(p ->> 'telephone', '')), 40), left(btrim(coalesce(p ->> 'fonction', '')), 150), v_just)
    returning * into d;
  else
    update public.inst_demandes set niveau = v_niveau, region_id = v_region, departement_id = v_dep, nom = upper(left(btrim(coalesce(p ->> 'nom', '')), 100)),
           prenom = left(btrim(coalesce(p ->> 'prenom', '')), 100), telephone = left(btrim(coalesce(p ->> 'telephone', '')), 40),
           fonction = left(btrim(coalesce(p ->> 'fonction', '')), 150), justificatif = coalesce(v_just, justificatif)
     where id = d.id returning * into d;
  end if;
  return public.inst_ma_demande();
end $$;

/** Délégation active (avec titulaire) existant déjà pour la circonscription demandée. */
create or replace function public._inst_circonscription_prise(p_niveau text, p_region uuid, p_dep uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.inst_delegations dl join public.inst_membres m on m.delegation_id = dl.id and m.role = 'titulaire' and m.actif
                  where dl.niveau = p_niveau and ((p_niveau = 'region' and dl.region_id = p_region) or (p_niveau = 'departement' and dl.departement_id = p_dep)))
$$;

create or replace function public.inst_demande_soumettre() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u record; d public.inst_demandes;
begin
  select id, email_confirmed_at into u from auth.users where id = auth.uid();
  if u.id is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  if u.email_confirmed_at is null then raise exception 'Confirmez d''abord votre adresse e-mail (lien reçu par e-mail).' using errcode = 'P0001'; end if;
  select * into d from public.inst_demandes where user_id = u.id and statut = 'brouillon' for update;
  if d.id is null then raise exception 'Aucune demande en brouillon.' using errcode = 'P0001'; end if;
  if char_length(d.nom) < 2 or char_length(d.telephone) < 6 or (d.niveau = 'departement' and char_length(d.fonction) < 3) then
    raise exception 'Complétez votre nom, votre téléphone professionnel et votre fonction.' using errcode = 'P0001';
  end if;
  if d.justificatif is null then raise exception 'Joignez un justificatif de désignation (acte, note de service ou document équivalent).' using errcode = 'P0001'; end if;
  if public._inst_circonscription_prise(d.niveau, d.region_id, d.departement_id) then
    raise exception 'Une délégation est déjà enregistrée pour cette circonscription administrative. Si vous êtes le nouveau responsable de cette délégation, veuillez contacter l''administrateur de NexIA School pour procéder à la mise à jour de la désignation.'
      using errcode = 'P0001';
  end if;
  update public.inst_demandes set statut = 'soumise', soumise_le = now() where id = d.id;
  perform public._inst_journaliser('demande soumise', 'inst_demande', d.id, jsonb_build_object('niveau', d.niveau));
  return public.inst_ma_demande();
end $$;

create or replace function public.inst_ma_demande() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('id', d.id, 'niveau', d.niveau, 'region_id', d.region_id, 'departement_id', d.departement_id,
           'region', r.nom, 'departement', dp.nom, 'nom', d.nom, 'prenom', d.prenom, 'email', d.email, 'telephone', d.telephone, 'fonction', d.fonction,
           'justificatif', d.justificatif is not null, 'statut', d.statut, 'motif_decision', d.motif_decision, 'soumise_le', d.soumise_le, 'decide_le', d.decide_le)
      from public.inst_demandes d join public.inst_regions r on r.id = d.region_id left join public.inst_departements dp on dp.id = d.departement_id
     where d.user_id = auth.uid() order by d.cree_le desc limit 1), 'null'::jsonb)
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 4. Rattachement administratif des établissements
-- ---------------------------------------------------------------------------------------------------------
alter table public.etablissements add column if not exists departement_id uuid references public.inst_departements (id);
alter table public.etablissements add column if not exists rattachement_statut text not null default 'absent'
  check (rattachement_statut in ('absent', 'declare', 'verifie'));
alter table public.etablissements add column if not exists rattachement_verifie_par uuid;
alter table public.etablissements add column if not exists rattachement_verifie_le timestamptz;
create index if not exists etablissements_departement on public.etablissements (departement_id);

/** L'administration de l'établissement déclare (ou change) son département : rattachement à vérifier. */
create or replace function public.etablissement_localisation(p_departement uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin(); e public.etablissements;
begin
  if not exists (select 1 from public.inst_departements where id = p_departement and actif) then raise exception 'Département inconnu.' using errcode = 'P0001'; end if;
  select * into e from public.etablissements where id = v_etab for update;
  if e.departement_id is distinct from p_departement then
    update public.etablissements set departement_id = p_departement, rattachement_statut = 'declare', rattachement_verifie_par = null, rattachement_verifie_le = null
     where id = v_etab;
    perform public._inst_journaliser('rattachement déclaré', 'etablissement', v_etab, jsonb_build_object('avant', e.departement_id, 'apres', p_departement));
  end if;
  return public.etablissement_localisation_lire();
end $$;

create or replace function public.etablissement_localisation_lire() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('departement_id', e.departement_id, 'departement', d.nom, 'region_id', d.region_id, 'region', r.nom,
           'statut', e.rattachement_statut, 'verifie_le', e.rattachement_verifie_le,
           'delegation', (select jsonb_build_object('id', dl.id, 'nom', dl.nom, 'active', exists (select 1 from public.inst_membres m where m.delegation_id = dl.id and m.role = 'titulaire' and m.actif))
                            from public.inst_delegations dl where dl.niveau = 'departement' and dl.departement_id = e.departement_id and dl.actif))
    from public.etablissements e left join public.inst_departements d on d.id = e.departement_id left join public.inst_regions r on r.id = d.region_id
   where e.id = public.etab_courant()
$$;

/** Vérification du rattachement : délégation départementale concernée (titulaire ou permission examen) ou propriétaire. */
create or replace function public.inst_verifier_rattachement(p_etablissement uuid, p_confirmer boolean, p_motif text default '') returns void
language plpgsql volatile security definer set search_path = '' as $$
declare e public.etablissements; m public.inst_membres; dl public.inst_delegations;
begin
  select * into e from public.etablissements where id = p_etablissement for update;
  if e.id is null or e.departement_id is null then raise exception 'Établissement introuvable ou sans département déclaré.' using errcode = 'P0001'; end if;
  if not public.est_proprietaire() then
    m := public._inst_exiger('examen');
    select * into dl from public.inst_delegations where id = m.delegation_id;
    if dl.niveau <> 'departement' or dl.departement_id <> e.departement_id then
      raise exception 'Cet établissement ne relève pas de votre département.' using errcode = '42501';
    end if;
  end if;
  if p_confirmer then
    update public.etablissements set rattachement_statut = 'verifie', rattachement_verifie_par = auth.uid(), rattachement_verifie_le = now() where id = e.id;
  else
    if char_length(btrim(coalesce(p_motif, ''))) < 3 then raise exception 'Indiquez le motif du refus de rattachement.' using errcode = 'P0001'; end if;
    update public.etablissements set rattachement_statut = 'absent', departement_id = null, rattachement_verifie_par = null, rattachement_verifie_le = null where id = e.id;
  end if;
  perform public._inst_journaliser(case when p_confirmer then 'rattachement vérifié' else 'rattachement refusé' end, 'etablissement', e.id,
                                   jsonb_build_object('departement', e.departement_id, 'motif', nullif(btrim(coalesce(p_motif, '')), '')));
end $$;

/** Délégation départementale destinataire d'un établissement (rattachement vérifié, délégation active avec titulaire). */
create or replace function public._inst_delegation_etablissement(p_etab uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select dl.id from public.etablissements e join public.inst_delegations dl on dl.niveau = 'departement' and dl.departement_id = e.departement_id and dl.actif
   where e.id = p_etab and e.rattachement_statut = 'verifie'
     and exists (select 1 from public.inst_membres m where m.delegation_id = dl.id and m.role = 'titulaire' and m.actif)
$$;

/** Délégation régionale destinataire d'une délégation départementale. */
create or replace function public._inst_delegation_regionale(p_delegation uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.id from public.inst_delegations d join public.inst_departements dp on dp.id = d.departement_id
    join public.inst_delegations r on r.niveau = 'region' and r.region_id = dp.region_id and r.actif
   where d.id = p_delegation and d.niveau = 'departement'
     and exists (select 1 from public.inst_membres m where m.delegation_id = r.id and m.role = 'titulaire' and m.actif)
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 5. Console du propriétaire : référentiel, demandes, délégations, titulaires
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.console_inst_referentiel() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exiger_proprietaire();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'nom', r.nom, 'code', r.code, 'actif', r.actif, 'verifie', r.verifie,
            'delegation', (select jsonb_build_object('id', d.id, 'nom', d.nom, 'actif', d.actif) from public.inst_delegations d where d.niveau = 'region' and d.region_id = r.id),
            'departements', (select coalesce(jsonb_agg(jsonb_build_object('id', dp.id, 'nom', dp.nom, 'code', dp.code, 'actif', dp.actif, 'verifie', dp.verifie,
                               'etablissements', (select count(*) from public.etablissements e where e.departement_id = dp.id),
                               'delegation', (select jsonb_build_object('id', d.id, 'nom', d.nom, 'actif', d.actif) from public.inst_delegations d where d.niveau = 'departement' and d.departement_id = dp.id))
                               order by dp.nom), '[]'::jsonb) from public.inst_departements dp where dp.region_id = r.id)) order by r.nom), '[]'::jsonb)
    from public.inst_regions r);
end $$;

/** Créer ou modifier une région ou un département (historisé). p : { objet, id?, nom, code?, region_id?, actif?, verifie? } */
create or replace function public.console_inst_circonscription(p jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_objet text := p ->> 'objet'; avant jsonb; v_nom text := btrim(coalesce(p ->> 'nom', ''));
begin
  perform public._exiger_proprietaire();
  if char_length(v_nom) < 2 then raise exception 'Nom obligatoire.' using errcode = 'P0001'; end if;
  if v_objet = 'region' then
    if v_id is null then
      insert into public.inst_regions (nom, nom_norm, code, verifie) values (v_nom, public._normaliser(v_nom), nullif(btrim(coalesce(p ->> 'code', '')), ''), coalesce((p ->> 'verifie')::boolean, false))
      returning id into v_id;
    else
      select to_jsonb(r) into avant from public.inst_regions r where id = v_id;
      update public.inst_regions set nom = v_nom, nom_norm = public._normaliser(v_nom), code = nullif(btrim(coalesce(p ->> 'code', '')), ''),
             actif = coalesce((p ->> 'actif')::boolean, actif), verifie = coalesce((p ->> 'verifie')::boolean, verifie), maj_le = now() where id = v_id;
    end if;
    insert into public.inst_referentiel_historique (objet, objet_id, action, avant, apres)
    select 'region', v_id, case when avant is null then 'création' else 'modification' end, avant, to_jsonb(r) from public.inst_regions r where id = v_id;
  elsif v_objet = 'departement' then
    if not exists (select 1 from public.inst_regions where id = (p ->> 'region_id')::uuid) then raise exception 'Région inconnue.' using errcode = 'P0001'; end if;
    if v_id is null then
      insert into public.inst_departements (region_id, nom, nom_norm, code, verifie) values ((p ->> 'region_id')::uuid, v_nom, public._normaliser(v_nom),
             nullif(btrim(coalesce(p ->> 'code', '')), ''), coalesce((p ->> 'verifie')::boolean, false)) returning id into v_id;
    else
      select to_jsonb(d) into avant from public.inst_departements d where id = v_id;
      if (avant ->> 'region_id')::uuid <> (p ->> 'region_id')::uuid and exists (select 1 from public.inst_delegations where departement_id = v_id) then
        raise exception 'Ce département a une délégation : son changement de région doit être traité par une procédure dédiée.' using errcode = 'P0001';
      end if;
      update public.inst_departements set region_id = (p ->> 'region_id')::uuid, nom = v_nom, nom_norm = public._normaliser(v_nom),
             code = nullif(btrim(coalesce(p ->> 'code', '')), ''), actif = coalesce((p ->> 'actif')::boolean, actif),
             verifie = coalesce((p ->> 'verifie')::boolean, verifie), maj_le = now() where id = v_id;
    end if;
    insert into public.inst_referentiel_historique (objet, objet_id, action, avant, apres)
    select 'departement', v_id, case when avant is null then 'création' else 'modification' end, avant, to_jsonb(d) from public.inst_departements d where id = v_id;
  else
    raise exception 'Objet inconnu.' using errcode = 'P0001';
  end if;
  perform public._inst_journaliser('référentiel', v_objet, v_id, jsonb_build_object('nom', v_nom));
  return v_id;
end $$;

create or replace function public.console_inst_demandes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exiger_proprietaire();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'niveau', d.niveau, 'region', r.nom, 'departement', dp.nom, 'nom', d.nom, 'prenom', d.prenom,
            'email', d.email, 'email_verifie', u.email_confirmed_at is not null, 'telephone', d.telephone, 'fonction', d.fonction, 'justificatif', d.justificatif,
            'statut', d.statut, 'motif_decision', d.motif_decision, 'soumise_le', d.soumise_le, 'decide_le', d.decide_le, 'cree_le', d.cree_le,
            'circonscription_prise', public._inst_circonscription_prise(d.niveau, d.region_id, d.departement_id),
            'delegation_id', (select dl.id from public.inst_delegations dl where dl.niveau = d.niveau
                                and ((d.niveau = 'region' and dl.region_id = d.region_id) or (d.niveau = 'departement' and dl.departement_id = d.departement_id)))) order by d.statut <> 'soumise', d.cree_le desc), '[]'::jsonb)
    from public.inst_demandes d join public.inst_regions r on r.id = d.region_id left join public.inst_departements dp on dp.id = d.departement_id
    left join auth.users u on u.id = d.user_id
   where d.statut <> 'brouillon' or (d.justificatif is not null and public._inst_circonscription_prise(d.niveau, d.region_id, d.departement_id)));
end $$;

/** Délégation de la circonscription (créée une seule fois ; l'unicité est garantie par les index). */
create or replace function public._inst_delegation_de(p_niveau text, p_region uuid, p_dep uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_nom text;
begin
  select id into v_id from public.inst_delegations
   where niveau = p_niveau and ((p_niveau = 'region' and region_id = p_region) or (p_niveau = 'departement' and departement_id = p_dep));
  if v_id is not null then return v_id; end if;
  select case when p_niveau = 'region' then (select nom from public.inst_regions where id = p_region) else (select nom from public.inst_departements where id = p_dep) end into v_nom;
  insert into public.inst_delegations (niveau, region_id, departement_id, nom) values (p_niveau, p_region, p_dep, public.inst_nom_delegation(p_niveau, v_nom))
  returning id into v_id;
  perform public._inst_journaliser('création de délégation', 'inst_delegation', v_id, jsonb_build_object('niveau', p_niveau, 'nom', v_nom));
  return v_id;
end $$;

/** Décision sur une demande : en_verification, approuvee, rejetee, suspendue (motif obligatoire pour rejet et suspension). */
create or replace function public.console_inst_decider(p_demande uuid, p_decision text, p_motif text default '') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare d public.inst_demandes; v_del uuid; u record;
begin
  perform public._exiger_proprietaire();
  select * into d from public.inst_demandes where id = p_demande for update;
  if d.id is null or (d.statut = 'brouillon' and p_decision <> 'rejetee') then raise exception 'Demande introuvable ou non soumise.' using errcode = 'P0001'; end if;
  if p_decision not in ('en_verification', 'approuvee', 'rejetee', 'suspendue') then raise exception 'Décision inconnue.' using errcode = 'P0001'; end if;
  if d.statut = 'approuvee' and p_decision <> 'suspendue' then
    raise exception 'Une demande approuvée ne peut qu''être suspendue (ce qui retire l''accès).' using errcode = 'P0001';
  end if;
  if d.statut in ('rejetee', 'suspendue') then raise exception 'Cette demande est déjà close.' using errcode = 'P0001'; end if;
  if p_decision in ('rejetee', 'suspendue') and char_length(btrim(coalesce(p_motif, ''))) < 3 then raise exception 'Le motif est obligatoire.' using errcode = 'P0001'; end if;
  if p_decision = 'approuvee' then
    if d.statut not in ('soumise', 'en_verification') then raise exception 'Seule une demande soumise ou en vérification peut être approuvée.' using errcode = 'P0001'; end if;
    select email_confirmed_at into u from auth.users where id = d.user_id;
    if u.email_confirmed_at is null then raise exception 'L''adresse e-mail du demandeur n''est pas vérifiée.' using errcode = 'P0001'; end if;
    if public._inst_circonscription_prise(d.niveau, d.region_id, d.departement_id) then
      raise exception 'Cette circonscription a déjà un titulaire actif : utilisez le changement de titulaire.' using errcode = 'P0001';
    end if;
    v_del := public._inst_delegation_de(d.niveau, d.region_id, d.departement_id);
    insert into public.inst_membres (delegation_id, user_id, role, nom, prenom, fonction, email, demande_id)
    values (v_del, d.user_id, 'titulaire', d.nom, d.prenom, d.fonction, d.email, d.id);
  elsif p_decision = 'suspendue' then
    update public.inst_membres set actif = false, revoque_le = now(), motif_revocation = left(btrim(p_motif), 300) where demande_id = d.id and actif;
  end if;
  update public.inst_demandes set statut = p_decision, motif_decision = left(btrim(coalesce(p_motif, '')), 500), decide_par = auth.uid(), decide_le = now() where id = d.id;
  perform public._inst_journaliser('décision sur demande', 'inst_demande', d.id, jsonb_build_object('decision', p_decision, 'motif', nullif(btrim(coalesce(p_motif, '')), ''), 'delegation', v_del));
  perform public._journal_plateforme('délégation : ' || p_decision, d.email, jsonb_build_object('demande', d.id));
  return jsonb_build_object('statut', p_decision, 'delegation_id', v_del);
end $$;

/** Changement de titulaire : l'entité est conservée ; l'ancien titulaire est révoqué ; le nouveau vient d'une demande soumise. */
create or replace function public.console_inst_changer_titulaire(p_delegation uuid, p_demande uuid, p_motif text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare dl public.inst_delegations; d public.inst_demandes; anc public.inst_membres;
begin
  perform public._exiger_proprietaire();
  if char_length(btrim(coalesce(p_motif, ''))) < 3 then raise exception 'Le motif du changement est obligatoire.' using errcode = 'P0001'; end if;
  select * into dl from public.inst_delegations where id = p_delegation for update;
  select * into d from public.inst_demandes where id = p_demande for update;
  if dl.id is null or d.id is null then raise exception 'Délégation ou demande introuvable.' using errcode = 'P0001'; end if;
  if d.statut not in ('brouillon', 'soumise', 'en_verification') or d.justificatif is null then
    raise exception 'La demande du nouveau titulaire doit être complète (justificatif joint) et non traitée.' using errcode = 'P0001';
  end if;
  if d.niveau <> dl.niveau or (dl.niveau = 'region' and d.region_id <> dl.region_id) or (dl.niveau = 'departement' and d.departement_id <> dl.departement_id) then
    raise exception 'La demande ne concerne pas cette circonscription.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users where id = d.user_id and email_confirmed_at is not null) then raise exception 'Adresse e-mail du nouveau titulaire non vérifiée.' using errcode = 'P0001'; end if;
  select * into anc from public.inst_membres where delegation_id = dl.id and role = 'titulaire' and actif for update;
  update public.inst_membres set actif = false, revoque_le = now(), motif_revocation = left(btrim(p_motif), 300) where id = anc.id;
  update public.inst_acces_ia set revoque_le = now() where membre_id = anc.id and revoque_le is null;
  insert into public.inst_membres (delegation_id, user_id, role, nom, prenom, fonction, email, demande_id)
  values (dl.id, d.user_id, 'titulaire', d.nom, d.prenom, d.fonction, d.email, d.id);
  update public.inst_demandes set statut = 'approuvee', motif_decision = 'Changement de titulaire : ' || left(btrim(p_motif), 450), decide_par = auth.uid(), decide_le = now() where id = d.id;
  perform public._inst_journaliser('changement de titulaire', 'inst_delegation', dl.id, jsonb_build_object('ancien', anc.user_id, 'nouveau', d.user_id, 'motif', left(btrim(p_motif), 300)));
end $$;

create or replace function public.console_inst_delegation(p_delegation uuid, p jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_cat text[];
begin
  perform public._exiger_proprietaire();
  if p ? 'ia_categories' then
    select coalesce(array_agg(x), '{}') into v_cat from jsonb_array_elements_text(p -> 'ia_categories') x;
  end if;
  update public.inst_delegations set actif = coalesce((p ->> 'actif')::boolean, actif),
         collaborateurs_autorises = coalesce((p ->> 'collaborateurs_autorises')::boolean, collaborateurs_autorises),
         ia_categories = coalesce(v_cat, ia_categories), nom = coalesce(nullif(btrim(p ->> 'nom'), ''), nom)
   where id = p_delegation;
  if not found then raise exception 'Délégation introuvable.' using errcode = 'P0001'; end if;
  if (p ->> 'collaborateurs_autorises')::boolean is false then
    update public.inst_membres set actif = false, revoque_le = now(), motif_revocation = 'Collaborateurs désactivés' where delegation_id = p_delegation and role = 'collaborateur' and actif;
  end if;
  perform public._inst_journaliser('paramètres de délégation', 'inst_delegation', p_delegation, p);
end $$;

create or replace function public.console_inst_delegations() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exiger_proprietaire();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'niveau', d.niveau, 'nom', d.nom, 'actif', d.actif, 'collaborateurs_autorises', d.collaborateurs_autorises,
            'ia_categories', d.ia_categories,
            'membres', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role, 'nom', m.nom, 'prenom', m.prenom, 'email', m.email, 'actif', m.actif,
                         'debut', m.debut, 'revoque_le', m.revoque_le, 'motif_revocation', m.motif_revocation) order by m.actif desc, m.debut desc), '[]'::jsonb)
                        from public.inst_membres m where m.delegation_id = d.id)) order by d.niveau desc, d.nom), '[]'::jsonb)
    from public.inst_delegations d);
end $$;

/** Établissements dont le rattachement est à vérifier (propriétaire). */
create or replace function public.console_inst_rattachements() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exiger_proprietaire();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'nom', e.nom, 'ville', e.ville, 'departement', d.nom, 'region', r.nom, 'statut', e.rattachement_statut)
            order by e.rattachement_statut, e.nom), '[]'::jsonb)
    from public.etablissements e left join public.inst_departements d on d.id = e.departement_id left join public.inst_regions r on r.id = d.region_id
   where e.rattachement_statut <> 'verifie');
end $$;

-- --- Collaborateurs (si autorisés par le propriétaire) : un compte existant (e-mail vérifié), rattaché à la délégation ---
create or replace function public.inst_collaborateur_ajouter(p_email text, p_permissions text[]) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger(); dl public.inst_delegations; u record;
begin
  if m.role <> 'titulaire' then raise exception 'Seul le titulaire gère les collaborateurs.' using errcode = '42501'; end if;
  select * into dl from public.inst_delegations where id = m.delegation_id;
  if not dl.collaborateurs_autorises then raise exception 'Les collaborateurs ne sont pas activés pour cette délégation (administrateur de NexIA School).' using errcode = 'P0001'; end if;
  if not (coalesce(p_permissions, '{}') <@ array['examen', 'courriers', 'synthese']::text[]) then raise exception 'Permission inconnue.' using errcode = 'P0001'; end if;
  select id, email, email_confirmed_at into u from auth.users where lower(email) = lower(btrim(coalesce(p_email, '')));
  if u.id is null or u.email_confirmed_at is null then raise exception 'Aucun compte vérifié avec cette adresse : la personne doit d''abord créer son compte et confirmer son e-mail.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.personnels where id = u.id) or exists (select 1 from public.comptes_enseignants where id = u.id)
     or exists (select 1 from public.inst_membres where user_id = u.id and actif) then
    raise exception 'Ce compte est déjà utilisé ailleurs.' using errcode = 'P0001';
  end if;
  insert into public.inst_membres (delegation_id, user_id, role, permissions, email) values (dl.id, u.id, 'collaborateur', coalesce(p_permissions, '{}'), lower(u.email));
  perform public._inst_journaliser('ajout de collaborateur', 'inst_delegation', dl.id, jsonb_build_object('email', lower(u.email), 'permissions', p_permissions));
end $$;

create or replace function public.inst_collaborateur_retirer(p_membre uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger();
begin
  if m.role <> 'titulaire' then raise exception 'Seul le titulaire gère les collaborateurs.' using errcode = '42501'; end if;
  update public.inst_membres set actif = false, revoque_le = now(), motif_revocation = 'Retiré par le titulaire'
   where id = p_membre and delegation_id = m.delegation_id and role = 'collaborateur' and actif;
  if not found then raise exception 'Collaborateur introuvable.' using errcode = 'P0001'; end if;
  perform public._inst_journaliser('retrait de collaborateur', 'inst_delegation', m.delegation_id, jsonb_build_object('membre', p_membre));
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 6. Notifications internes (dans l'application ; aucun e-mail n'est envoyé par ce module)
-- ---------------------------------------------------------------------------------------------------------
create table public.inst_notifications (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid references public.etablissements (id) on delete cascade,
  delegation_id uuid references public.inst_delegations (id),
  type text not null,
  titre text not null check (char_length(titre) <= 200),
  corps text not null default '' check (char_length(corps) <= 1000),
  lien text not null default '' check (char_length(lien) <= 200),
  objet_id uuid,
  cle text unique,                                        -- idempotence des alertes automatiques
  lu_le timestamptz,
  cree_le timestamptz not null default now(),
  check ((etablissement_id is null) <> (delegation_id is null))
);
create index on public.inst_notifications (etablissement_id, cree_le desc);
create index on public.inst_notifications (delegation_id, cree_le desc);
alter table public.inst_notifications enable row level security;
revoke all on public.inst_notifications from anon, authenticated;

create or replace function public._inst_notifier(p_etab uuid, p_delegation uuid, p_type text, p_titre text, p_corps text default '', p_lien text default '', p_objet uuid default null, p_cle text default null) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.inst_notifications (etablissement_id, delegation_id, type, titre, corps, lien, objet_id, cle)
  values (p_etab, p_delegation, p_type, left(p_titre, 200), left(coalesce(p_corps, ''), 1000), left(coalesce(p_lien, ''), 200), p_objet, p_cle)
  on conflict (cle) do nothing
$$;

create or replace function public.inst_notifications_lire() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_moi(); v_etab uuid;
begin
  if m.id is null then v_etab := public._exiger_admin(); end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'type', n.type, 'titre', n.titre, 'corps', n.corps, 'lien', n.lien, 'objet_id', n.objet_id,
            'lu', n.lu_le is not null, 'cree_le', n.cree_le) order by n.cree_le desc), '[]'::jsonb)
    from (select * from public.inst_notifications
           where (m.id is not null and delegation_id = m.delegation_id) or (m.id is null and etablissement_id = v_etab)
           order by cree_le desc limit 200) n);
end $$;

create or replace function public.inst_notification_lue(p_id uuid default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_moi(); v_etab uuid;
begin
  if m.id is null then v_etab := public._exiger_admin(); end if;
  update public.inst_notifications set lu_le = now()
   where lu_le is null and (p_id is null or id = p_id)
     and ((m.id is not null and delegation_id = m.delegation_id) or (m.id is null and etablissement_id = v_etab));
end $$;

-- Déclaration d'un rattachement : la délégation départementale concernée est prévenue (redéfinition).
create or replace function public.etablissement_localisation(p_departement uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin(); e public.etablissements; v_del uuid;
begin
  if not exists (select 1 from public.inst_departements where id = p_departement and actif) then raise exception 'Département inconnu.' using errcode = 'P0001'; end if;
  select * into e from public.etablissements where id = v_etab for update;
  if e.departement_id is distinct from p_departement then
    update public.etablissements set departement_id = p_departement, rattachement_statut = 'declare', rattachement_verifie_par = null, rattachement_verifie_le = null
     where id = v_etab;
    perform public._inst_journaliser('rattachement déclaré', 'etablissement', v_etab, jsonb_build_object('avant', e.departement_id, 'apres', p_departement));
    select id into v_del from public.inst_delegations where niveau = 'departement' and departement_id = p_departement and actif;
    if v_del is not null then
      perform public._inst_notifier(null, v_del, 'rattachement', 'Rattachement à vérifier : ' || e.nom,
        'Cet établissement déclare relever de votre département. Vérifiez ce rattachement.', '/institution/etablissements', v_etab);
    end if;
  end if;
  return public.etablissement_localisation_lire();
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 7. Paramètres des formules (centralisés, à valider) et campagnes (calendrier configuré, aucune date dans le code)
-- ---------------------------------------------------------------------------------------------------------
create table public.inst_parametres (
  id smallint primary key default 1 check (id = 1),
  inclure_digitalise boolean not null default true,       -- leçons digitalisées comptées dans la couverture (À VALIDER)
  formules_validees boolean not null default false,       -- tant que false, les documents portent la mention « formules à valider »
  note text not null default '' check (char_length(note) <= 2000),
  alertes_le date,                                        -- dernier passage des alertes quotidiennes (une fois par jour)
  maj_par uuid,
  maj_le timestamptz not null default now()
);
insert into public.inst_parametres (id) values (1);
alter table public.inst_parametres enable row level security;
revoke all on public.inst_parametres from anon, authenticated;

create table public.inst_campagnes (
  id uuid primary key default gen_random_uuid(),
  niveau text not null check (niveau in ('etablissement', 'departement', 'region')),
  exercice_libelle text not null check (exercice_libelle ~ '^[0-9]{4}-[0-9]{4}$'),
  periode text not null check (periode in ('t1', 't2', 't3', 'annuel')),
  ouverture date not null,
  echeance date not null,
  prolongation date,
  ouvert boolean not null default true,
  alertes_jours smallint[] not null default array[7, 3, 1, 0, -1]::smallint[],
  cree_le timestamptz not null default now(),
  unique (niveau, exercice_libelle, periode),
  check (echeance >= ouverture),
  check (prolongation is null or prolongation >= echeance)
);
alter table public.inst_campagnes enable row level security;
revoke all on public.inst_campagnes from anon, authenticated;

create or replace function public._inst_echeance(c public.inst_campagnes) returns date
language sql immutable set search_path = '' as $$ select coalesce(c.prolongation, c.echeance) $$;

create or replace function public._inst_campagne_json(c public.inst_campagnes) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'niveau', c.niveau, 'exercice', c.exercice_libelle, 'periode', c.periode, 'ouverture', c.ouverture,
           'echeance', c.echeance, 'prolongation', c.prolongation, 'echeance_effective', public._inst_echeance(c), 'ouvert', c.ouvert,
           'alertes_jours', c.alertes_jours,
           'etat', case when not c.ouvert then 'fermee' when public._aujourdhui() < c.ouverture then 'a_venir'
                        when public._aujourdhui() > public._inst_echeance(c) then 'echue' else 'ouverte' end)
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 8. Fiches de synthèse statistiques, versions immuables, historique des statuts, commentaires
-- ---------------------------------------------------------------------------------------------------------
create table public.inst_appreciations (
  code text primary key check (code ~ '^[a-z_]{2,30}$'),
  libelle text not null check (char_length(libelle) <= 80),
  actif boolean not null default true,
  ordre smallint not null default 0
);
insert into public.inst_appreciations (code, libelle, ordre) values
  ('satisfaisant', 'Satisfaisant', 1), ('a_ameliorer', 'À améliorer', 2), ('preoccupant', 'Préoccupant', 3);
alter table public.inst_appreciations enable row level security;
revoke all on public.inst_appreciations from anon, authenticated;

create table public.inst_fiches (
  id uuid primary key default gen_random_uuid(),
  niveau text not null check (niveau in ('etablissement', 'departement', 'region')),
  campagne_id uuid not null references public.inst_campagnes (id),
  etablissement_id uuid references public.etablissements (id) on delete cascade,
  delegation_id uuid references public.inst_delegations (id),
  departement_id uuid references public.inst_departements (id),
  region_id uuid references public.inst_regions (id),
  exercice_libelle text not null,
  periode text not null,
  statut text not null default 'brouillon' check (statut in ('brouillon', 'prete', 'publiee', 'en_examen', 'correction_demandee', 'corrigee', 'republiee', 'examinee', 'archivee')),
  brouillon jsonb not null default '{}',
  version_courante integer not null default 0,
  appreciation text references public.inst_appreciations (code),
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  maj_par uuid,
  check ((niveau = 'etablissement') = (etablissement_id is not null)),
  check ((niveau = 'etablissement') = (delegation_id is null))
);
create unique index inst_fiche_unique_etab on public.inst_fiches (etablissement_id, campagne_id) where niveau = 'etablissement';
create unique index inst_fiche_unique_delegation on public.inst_fiches (delegation_id, campagne_id) where niveau <> 'etablissement';

create table public.inst_fiche_versions (
  id uuid primary key default gen_random_uuid(),
  fiche_id uuid not null references public.inst_fiches (id) on delete cascade,
  version integer not null,
  donnees jsonb not null,
  indicateurs jsonb not null,
  anomalies jsonb not null default '[]',
  destinataire_id uuid references public.inst_delegations (id),
  departement_id uuid,
  region_id uuid,
  en_retard boolean not null default false,
  publie_par uuid not null,
  publie_le timestamptz not null default now(),
  unique (fiche_id, version)
);
create index on public.inst_fiche_versions (destinataire_id);
create table public.inst_fiche_statuts (
  id bigint generated always as identity primary key,
  fiche_id uuid not null references public.inst_fiches (id) on delete cascade,
  de text,
  a text not null,
  par uuid,
  le timestamptz not null default now(),
  motif text not null default ''
);
create index on public.inst_fiche_statuts (fiche_id, le);
create table public.inst_commentaires (
  id uuid primary key default gen_random_uuid(),
  fiche_id uuid not null references public.inst_fiches (id) on delete cascade,
  version integer not null,
  delegation_id uuid references public.inst_delegations (id),
  etablissement_id uuid,
  auteur uuid not null,
  auteur_nom text not null default '',
  type text not null check (type in ('commentaire', 'correction', 'reponse')),
  texte text not null check (char_length(btrim(texte)) between 1 and 3000),
  elements text[] not null default '{}',
  le timestamptz not null default now()
);
create index on public.inst_commentaires (fiche_id, le);
alter table public.inst_fiches enable row level security;
alter table public.inst_fiche_versions enable row level security;
alter table public.inst_fiche_statuts enable row level security;
alter table public.inst_commentaires enable row level security;
revoke all on public.inst_fiches, public.inst_fiche_versions, public.inst_fiche_statuts, public.inst_commentaires from anon, authenticated;

create or replace function public._inst_versions_immuables() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.inst_fiches where id = old.fiche_id) then return old; end if;  -- suppression en cascade d'un établissement
  raise exception 'Une version publiée ne peut pas être modifiée : publiez une nouvelle version.' using errcode = '42501';
end $$;
create trigger inst_versions_immuables before update or delete on public.inst_fiche_versions for each row execute function public._inst_versions_immuables();
create or replace function public._inst_commentaires_immuables() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.inst_fiches where id = old.fiche_id) then return old; end if;
  raise exception 'Un commentaire horodaté ne peut être ni modifié ni supprimé.' using errcode = '42501';
end $$;
create trigger inst_commentaires_immuables before update or delete on public.inst_commentaires for each row execute function public._inst_commentaires_immuables();

create or replace function public._inst_statut(p_fiche uuid, p_statut text, p_motif text default '') returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_de text;
begin
  select statut into v_de from public.inst_fiches where id = p_fiche;
  if v_de is distinct from p_statut then
    update public.inst_fiches set statut = p_statut, maj_le = now(), maj_par = auth.uid() where id = p_fiche;
    insert into public.inst_fiche_statuts (fiche_id, de, a, par, motif) values (p_fiche, v_de, p_statut, auth.uid(), left(coalesce(p_motif, ''), 1000));
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 9. Calculs : source unique des indicateurs (aperçu, publication, consolidation, PDF, IA)
--    Taux = somme des numérateurs / somme des dénominateurs (jamais une moyenne de pourcentages).
--    Valeur absente = « manquante » (jamais zéro) ; « na » = non applicable (exclu, non signalé).
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._inst_val(v jsonb) returns numeric
language sql immutable set search_path = '' as $$ select case when jsonb_typeof(v) = 'number' then v::text::numeric end $$;

create or replace function public._inst_taux(n numeric, d numeric) returns numeric
language sql immutable set search_path = '' as $$ select case when d > 0 then round(n / d * 100, 2) end $$;

create or replace function public._inst_indicateurs(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_dig boolean := coalesce((select inclure_digitalise from public.inst_parametres where id = 1), true);
        v_ind jsonb; v_disc jsonb; v_anom jsonb; v_ass jsonb := '{}'; v_anom_ass jsonb := '[]'; k text; dues numeric; v_abs numeric; v_nb integer;
begin
  with calc as (
    select l.o idx, coalesce(nullif(btrim(l.e ->> 'discipline'), ''), '(sans discipline)') disc, d.code,
           public._inst_val(l.e -> d.kn1) n1, case when d.kn2 is null then 0 else public._inst_val(l.e -> d.kn2) end n2, public._inst_val(l.e -> d.kd) den,
           coalesce((l.e ->> d.kn1) = 'na' or (l.e ->> d.kd) = 'na' or (d.kn2 is not null and (l.e ->> d.kn2) = 'na'), false) na
      from jsonb_array_elements(case when jsonb_typeof(p -> 'lignes') = 'array' then p -> 'lignes' else '[]'::jsonb end) with ordinality l(e, o)
     cross join (values ('couverture_theorie', 'faites_t', case when v_dig then 'digit_t' end, 'prevues_t'),
                        ('couverture_pratique', 'faites_p', case when v_dig then 'digit_p' end, 'prevues_p'),
                        ('heures_theorie', 'heures_faites_t', null, 'heures_dues_t'),
                        ('heures_pratique', 'heures_faites_p', null, 'heures_dues_p')) d(code, kn1, kn2, kd)),
  c2 as (select calc.*, not na and (n1 is null or n2 is null or den is null) nul from calc)
  select (select count(distinct idx) from c2),
         (select jsonb_object_agg(code, jsonb_build_object('num', n, 'den', dd, 'taux', public._inst_taux(n, dd), 'lignes', nb, 'manquantes', manq))
            from (select code, sum(n1 + n2) filter (where not na and not nul) n, sum(den) filter (where not na and not nul) dd,
                         count(*) filter (where not na and not nul) nb, count(*) filter (where nul) manq from c2 group by code) s),
         (select jsonb_object_agg(disc, x) from (select disc, jsonb_object_agg(code, jsonb_build_object('num', n, 'den', dd)) x
            from (select disc, code, sum(n1 + n2) n, sum(den) dd from c2 where not na and not nul group by disc, code) s group by disc) t),
         (select coalesce(jsonb_agg(a order by (a ->> 'ligne')::int nulls last), '[]'::jsonb) from (
            select jsonb_build_object('niveau', 'bloquant', 'code', 'negatif', 'ligne', idx, 'indicateur', code, 'message', 'Valeur négative (ligne ' || idx || ')') a
              from c2 where least(n1, n2, den) < 0
            union all
            select jsonb_build_object('niveau', 'alerte', 'code', 'depasse_100', 'ligne', idx, 'indicateur', code, 'message', 'Réalisé supérieur au prévu, taux au-delà de 100 % (ligne ' || idx || ')')
              from c2 where not na and not nul and den > 0 and n1 + n2 > den and least(n1, n2, den) >= 0
            union all
            select jsonb_build_object('niveau', 'alerte', 'code', 'denominateur_nul', 'ligne', idx, 'indicateur', code, 'message', 'Réalisé sans prévu : taux impossible à calculer (ligne ' || idx || ')')
              from c2 where not na and not nul and den = 0 and n1 + n2 > 0
            union all
            select jsonb_build_object('niveau', 'info', 'code', 'manquant', 'indicateur', code, 'message', count(*) || ' ligne(s) incomplète(s) exclue(s) du calcul : ' || code)
              from c2 where nul group by code) z)
    into v_nb, v_ind, v_disc, v_anom;

  foreach k in array array['enseignants', 'eleves'] loop
    dues := public._inst_val(p -> 'assiduite' -> k -> 'heures_dues');
    v_abs := public._inst_val(p -> 'assiduite' -> k -> 'heures_absence');
    if dues is not null and v_abs is not null and dues >= 0 and v_abs >= 0 and v_abs <= dues then
      v_ass := v_ass || jsonb_build_object('assiduite_' || k, jsonb_build_object('num', dues - v_abs, 'den', dues, 'taux', public._inst_taux(dues - v_abs, dues), 'lignes', 1, 'manquantes', 0));
    else
      v_ass := v_ass || jsonb_build_object('assiduite_' || k, jsonb_build_object('num', null, 'den', null, 'taux', null, 'lignes', 0, 'manquantes', 1));
      if dues < 0 or v_abs < 0 then
        v_anom_ass := v_anom_ass || jsonb_build_object('niveau', 'bloquant', 'code', 'negatif', 'indicateur', 'assiduite_' || k, 'message', 'Assiduité (' || k || ') : valeur négative');
      elsif v_abs > dues then
        v_anom_ass := v_anom_ass || jsonb_build_object('niveau', 'bloquant', 'code', 'incoherent', 'indicateur', 'assiduite_' || k, 'message', 'Assiduité (' || k || ') : absences supérieures aux heures dues');
      else
        v_anom_ass := v_anom_ass || jsonb_build_object('niveau', 'info', 'code', 'manquant', 'indicateur', 'assiduite_' || k, 'message', 'Assiduité (' || k || ') : données manquantes');
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'indicateurs', coalesce(v_ind, '{}'::jsonb) || v_ass,
    'par_discipline', coalesce(v_disc, '{}'::jsonb),
    'synthese', jsonb_build_object('eleves', public._inst_val(p -> 'synthese' -> 'eleves'), 'enseignants', public._inst_val(p -> 'synthese' -> 'enseignants'),
                                   'classes', public._inst_val(p -> 'synthese' -> 'classes'), 'disciplines', public._inst_val(p -> 'synthese' -> 'disciplines')),
    'lignes', v_nb,
    'observations', char_length(btrim(coalesce(p ->> 'observations', ''))) > 0,
    'periodes_manquantes', coalesce(p -> 'periodes_manquantes', '[]'::jsonb),
    'inclure_digitalise', v_dig,
    'formules_validees', coalesce((select formules_validees from public.inst_parametres where id = 1), false),
    'anomalies', coalesce(v_anom, '[]'::jsonb) || v_anom_ass);
end $$;

/** Aperçu des calculs en direct (aucune écriture). */
create or replace function public.inst_apercu(p_donnees jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if (public._inst_moi()).id is null then perform public._exiger_admin(); end if;
  return public._inst_indicateurs(public._inst_nettoyer(p_donnees));
end $$;

/** Consolidation pondérée d'un ensemble de versions publiées. */
create or replace function public._inst_consolider(p_versions uuid[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'nb_fiches', (select count(*) from public.inst_fiche_versions where id = any (p_versions)),
    'nb_observations', (select count(*) from public.inst_fiche_versions where id = any (p_versions)
                         and (indicateurs ->> 'observations' = 'true' or coalesce((indicateurs ->> 'nb_observations')::int, 0) > 0)),
    'indicateurs', coalesce((select jsonb_object_agg(code, jsonb_build_object('num', n, 'den', d, 'taux', public._inst_taux(n, d), 'fiches', f, 'fiches_sans_donnee', sans))
        from (select k.key code, sum((k.value ->> 'num')::numeric) filter (where (k.value ->> 'den')::numeric > 0) n,
                     sum((k.value ->> 'den')::numeric) filter (where (k.value ->> 'den')::numeric > 0) d,
                     count(*) filter (where (k.value ->> 'den')::numeric > 0) f,
                     count(*) filter (where coalesce((k.value ->> 'den')::numeric, 0) <= 0) sans
                from public.inst_fiche_versions v, jsonb_each(v.indicateurs -> 'indicateurs') k where v.id = any (p_versions) group by k.key) s), '{}'::jsonb),
    'par_discipline', coalesce((select jsonb_object_agg(disc, x) from (
        select disc, jsonb_object_agg(code, jsonb_build_object('num', n, 'den', d, 'taux', public._inst_taux(n, d))) x
          from (select dd.key disc, c.key code, sum((c.value ->> 'num')::numeric) n, sum((c.value ->> 'den')::numeric) d
                  from public.inst_fiche_versions v, jsonb_each(v.indicateurs -> 'par_discipline') dd, jsonb_each(dd.value) c
                 where v.id = any (p_versions) group by dd.key, c.key) s group by disc) t), '{}'::jsonb),
    'synthese', (select jsonb_object_agg(k, jsonb_build_object('total', t, 'fiches', f)) from (
        -- valeur d'une fiche (nombre) ou total déjà consolidé d'une synthèse départementale ({ total, fiches })
        select s.key k, sum(case when jsonb_typeof(s.value) = 'number' then s.value::text::numeric
                                 when jsonb_typeof(s.value) = 'object' then (s.value ->> 'total')::numeric end) t,
               sum(case when jsonb_typeof(s.value) = 'number' then 1
                        when jsonb_typeof(s.value) = 'object' and s.value ->> 'total' is not null then coalesce((s.value ->> 'fiches')::int, 0) else 0 end) f
          from public.inst_fiche_versions v, jsonb_each(v.indicateurs -> 'synthese') s where v.id = any (p_versions)
         group by s.key) z))
$$;

-- --- Nettoyage d'un brouillon (structure, types, longueurs) ---
create or replace function public._inst_nettoyer(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v_lignes jsonb := '[]'; e jsonb; k text; o jsonb; n integer := 0; v_s jsonb := '{}'; v_a jsonb := '{}'; x text;
        champs text[] := array['prevues_t', 'prevues_p', 'faites_t', 'faites_p', 'digit_t', 'digit_p', 'heures_dues_t', 'heures_dues_p', 'heures_faites_t', 'heures_faites_p'];
begin
  p := coalesce(p, '{}');
  if jsonb_typeof(p -> 'lignes') = 'array' then
    for e in select value from jsonb_array_elements(p -> 'lignes') loop
      n := n + 1;
      if n > 1500 then raise exception 'Trop de lignes (1 500 au maximum).' using errcode = 'P0001'; end if;
      o := jsonb_build_object('classe', left(coalesce(e ->> 'classe', ''), 60), 'discipline', left(coalesce(e ->> 'discipline', ''), 100),
                              'enseignant', left(coalesce(e ->> 'enseignant', ''), 150),
                              'source', case when e ->> 'source' = 'auto' then 'auto' else 'manuel' end);
      foreach k in array champs loop
        o := o || jsonb_build_object(k, case when jsonb_typeof(e -> k) = 'number' then e -> k when e ->> k = 'na' then to_jsonb('na'::text) else 'null'::jsonb end);
      end loop;
      v_lignes := v_lignes || o;
    end loop;
  end if;
  foreach x in array array['eleves', 'enseignants', 'classes', 'disciplines'] loop
    v_s := v_s || jsonb_build_object(x, case when jsonb_typeof(p -> 'synthese' -> x) = 'number' then p -> 'synthese' -> x else 'null'::jsonb end);
  end loop;
  foreach x in array array['enseignants', 'eleves'] loop
    v_a := v_a || jsonb_build_object(x, jsonb_build_object(
      'heures_dues', case when jsonb_typeof(p -> 'assiduite' -> x -> 'heures_dues') = 'number' then p -> 'assiduite' -> x -> 'heures_dues' else 'null'::jsonb end,
      'heures_absence', case when jsonb_typeof(p -> 'assiduite' -> x -> 'heures_absence') = 'number' then p -> 'assiduite' -> x -> 'heures_absence' else 'null'::jsonb end));
  end loop;
  return jsonb_build_object('lignes', v_lignes, 'synthese', v_s, 'assiduite', v_a,
    'sources', case when jsonb_typeof(p -> 'sources') = 'object' then p -> 'sources' else '{}'::jsonb end,
    'responsable', left(coalesce(p ->> 'responsable', ''), 150),
    'observations', left(coalesce(p ->> 'observations', ''), 4000),
    'difficultes', left(coalesce(p ->> 'difficultes', ''), 4000),
    'recommandations', left(coalesce(p ->> 'recommandations', ''), 4000),
    'periodes_manquantes', case when jsonb_typeof(p -> 'periodes_manquantes') = 'array' then p -> 'periodes_manquantes' else '[]'::jsonb end);
end $$;

-- --- Pré-remplissage à partir des données existantes de l'établissement (aucune valeur de leçon ou d'heure inventée) ---
create or replace function public._inst_preremplir(p_etab uuid, p_exercice text, p_periode text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_ex uuid; v_lignes jsonb; v_s jsonb; v_abs numeric; v_manq jsonb := '[]'; v_vers uuid[]; t text;
        champs text[] := array['prevues_t', 'prevues_p', 'faites_t', 'faites_p', 'digit_t', 'digit_p', 'heures_dues_t', 'heures_dues_p', 'heures_faites_t', 'heures_faites_p'];
begin
  select id into v_ex from public.exercices where etablissement_id = p_etab and libelle = p_exercice;
  select coalesce(jsonb_agg(jsonb_build_object('classe', c.libelle, 'discipline', m.libelle,
           'enseignant', coalesce(btrim(pe.nom || ' ' || pe.prenom), ''), 'source', 'auto') order by c.ordre, c.libelle, m.libelle), '[]'::jsonb)
    into v_lignes
    from public.attributions a join public.classes c on c.id = a.classe_id join public.matieres m on m.id = a.matiere_id
    left join public.personnels pe on pe.id = a.enseignant_id
   where a.exercice_id = v_ex and a.etablissement_id = p_etab;

  if p_periode = 'annuel' then
    -- valeurs cumulées des trimestres publiés (dernière version) ; les trimestres absents sont signalés
    select array_agg(v.id) into v_vers
      from public.inst_fiches f join lateral (select id from public.inst_fiche_versions where fiche_id = f.id order by version desc limit 1) v on true
     where f.niveau = 'etablissement' and f.etablissement_id = p_etab and f.exercice_libelle = p_exercice and f.periode in ('t1', 't2', 't3');
    foreach t in array array['t1', 't2', 't3'] loop
      if not exists (select 1 from public.inst_fiches f where f.niveau = 'etablissement' and f.etablissement_id = p_etab and f.exercice_libelle = p_exercice
                        and f.periode = t and f.version_courante > 0) then v_manq := v_manq || to_jsonb(t); end if;
    end loop;
    select coalesce(jsonb_agg(l.e || coalesce((
             select jsonb_object_agg(k, to_jsonb(s)) from (
               select k, sum(public._inst_val(x -> k)) s from public.inst_fiche_versions v, jsonb_array_elements(v.donnees -> 'lignes') x, unnest(champs) k
                where v.id = any (coalesce(v_vers, '{}')) and x ->> 'classe' = l.e ->> 'classe' and x ->> 'discipline' = l.e ->> 'discipline'
                group by k having count(public._inst_val(x -> k)) > 0) z), '{}'::jsonb) order by l.o), '[]'::jsonb)
      into v_lignes from jsonb_array_elements(v_lignes) with ordinality l(e, o);
  end if;

  v_s := jsonb_build_object(
    'eleves', (select count(*) from public.inscriptions where exercice_id = v_ex and etablissement_id = p_etab),
    'enseignants', (select count(distinct enseignant_id) from public.attributions where exercice_id = v_ex and etablissement_id = p_etab and enseignant_id is not null),
    'classes', (select count(distinct classe_id) from public.inscriptions where exercice_id = v_ex and etablissement_id = p_etab),
    'disciplines', (select count(distinct matiere_id) from public.attributions where exercice_id = v_ex and etablissement_id = p_etab));
  if v_ex is null then v_s := '{"eleves": null, "enseignants": null, "classes": null, "disciplines": null}'; end if;
  select sum(ab.heures_justifiees + ab.heures_non_justifiees) into v_abs
    from public.absences ab join public.sequences sq on sq.id = ab.sequence_id
   where sq.exercice_id = v_ex and ab.etablissement_id = p_etab
     and (p_periode = 'annuel' or sq.trimestre = substr(p_periode, 2, 1)::smallint);
  return public._inst_nettoyer(jsonb_build_object(
    'lignes', v_lignes, 'synthese', v_s,
    'assiduite', jsonb_build_object('eleves', jsonb_build_object('heures_dues', null, 'heures_absence', v_abs), 'enseignants', '{}'::jsonb),
    'sources', jsonb_build_object('eleves', case when v_ex is null then 'manquante' else 'auto' end, 'enseignants', case when v_ex is null then 'manquante' else 'auto' end,
                                  'classes', case when v_ex is null then 'manquante' else 'auto' end, 'disciplines', case when v_ex is null then 'manquante' else 'auto' end,
                                  'absences_eleves', case when v_abs is null then 'manquante' else 'auto' end),
    'responsable', (select nom_chef from public.etablissements where id = p_etab),
    'periodes_manquantes', case when p_periode = 'annuel' then v_manq else '[]'::jsonb end));
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 10. Espace établissement : mes fiches, brouillon, publication
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._inst_fiche_json(f public.inst_fiches, p_avec_brouillon boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', f.id, 'niveau', f.niveau, 'campagne', (select public._inst_campagne_json(c) from public.inst_campagnes c where c.id = f.campagne_id),
           'exercice', f.exercice_libelle, 'periode', f.periode, 'statut', f.statut, 'version', f.version_courante, 'appreciation', f.appreciation,
           'maj_le', f.maj_le,
           'etablissement', (select jsonb_build_object('id', e.id, 'nom', e.nom, 'ville', e.ville) from public.etablissements e where e.id = f.etablissement_id),
           'delegation', (select jsonb_build_object('id', d.id, 'nom', d.nom) from public.inst_delegations d where d.id = f.delegation_id),
           'region', (select nom from public.inst_regions where id = f.region_id), 'departement', (select nom from public.inst_departements where id = f.departement_id),
           'brouillon', case when p_avec_brouillon then f.brouillon end,
           'versions', (select coalesce(jsonb_agg(jsonb_build_object('version', v.version, 'publie_le', v.publie_le, 'en_retard', v.en_retard,
                          'destinataire', (select nom from public.inst_delegations where id = v.destinataire_id)) order by v.version), '[]'::jsonb)
                          from public.inst_fiche_versions v where v.fiche_id = f.id),
           'historique', (select coalesce(jsonb_agg(jsonb_build_object('de', s.de, 'a', s.a, 'le', s.le, 'motif', s.motif) order by s.le), '[]'::jsonb)
                            from public.inst_fiche_statuts s where s.fiche_id = f.id),
           'commentaires', (select coalesce(jsonb_agg(jsonb_build_object('type', c.type, 'texte', c.texte, 'elements', c.elements, 'auteur', c.auteur_nom,
                              'version', c.version, 'le', c.le) order by c.le), '[]'::jsonb) from public.inst_commentaires c where c.fiche_id = f.id))
$$;

create or replace function public.inst_mes_fiches() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin();
begin
  return jsonb_build_object(
    'localisation', public.etablissement_localisation_lire(),
    'campagnes', (select coalesce(jsonb_agg(public._inst_campagne_json(c) || jsonb_build_object(
                     'fiche', (select jsonb_build_object('id', f.id, 'statut', f.statut, 'version', f.version_courante, 'maj_le', f.maj_le)
                                 from public.inst_fiches f where f.niveau = 'etablissement' and f.etablissement_id = v_etab and f.campagne_id = c.id))
                     order by c.exercice_libelle desc, c.periode desc), '[]'::jsonb)
                    from public.inst_campagnes c where c.niveau = 'etablissement' and (c.ouvert or exists (
                      select 1 from public.inst_fiches f where f.etablissement_id = v_etab and f.campagne_id = c.id))));
end $$;

create or replace function public.inst_fiche_preparer(p_campagne uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin(); c public.inst_campagnes; v_id uuid; e public.etablissements;
begin
  select * into c from public.inst_campagnes where id = p_campagne and niveau = 'etablissement';
  if c.id is null or not c.ouvert then raise exception 'Campagne fermée ou introuvable.' using errcode = 'P0001'; end if;
  if public._aujourdhui() < c.ouverture then raise exception 'La campagne n''est pas encore ouverte.' using errcode = 'P0001'; end if;
  select id into v_id from public.inst_fiches where niveau = 'etablissement' and etablissement_id = v_etab and campagne_id = c.id;
  if v_id is not null then return v_id; end if;
  select * into e from public.etablissements where id = v_etab;
  insert into public.inst_fiches (niveau, campagne_id, etablissement_id, departement_id, region_id, exercice_libelle, periode, brouillon, maj_par)
  values ('etablissement', c.id, v_etab, e.departement_id, (select region_id from public.inst_departements where id = e.departement_id),
          c.exercice_libelle, c.periode, public._inst_preremplir(v_etab, c.exercice_libelle, c.periode), auth.uid())
  on conflict (etablissement_id, campagne_id) where niveau = 'etablissement' do nothing
  returning id into v_id;
  if v_id is null then   -- double envoi simultané : la fiche existe déjà
    return (select id from public.inst_fiches where niveau = 'etablissement' and etablissement_id = v_etab and campagne_id = c.id);
  end if;
  insert into public.inst_fiche_statuts (fiche_id, de, a, par, motif) values (v_id, null, 'brouillon', auth.uid(), 'Création (pré-remplissage)');
  return v_id;
end $$;

/** Accès à une fiche : 'proprietaire', 'destinataire' (délégation à qui une version a été transmise), 'derogation' ou exception. */
create or replace function public._inst_acces_fiche(p_fiche uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare f public.inst_fiches; m public.inst_membres := public._inst_moi();
begin
  select * into f from public.inst_fiches where id = p_fiche;
  if f.id is null then raise exception 'Fiche introuvable.' using errcode = 'P0001'; end if;
  if m.id is null then
    if f.niveau = 'etablissement' and public.est_admin() and f.etablissement_id = public.etab_courant() then return 'proprietaire'; end if;
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if f.niveau <> 'etablissement' and f.delegation_id = m.delegation_id then return 'proprietaire'; end if;
  if exists (select 1 from public.inst_fiche_versions v where v.fiche_id = f.id and v.destinataire_id = m.delegation_id) then return 'destinataire'; end if;
  if f.niveau = 'etablissement' and exists (select 1 from public.inst_derogations g where g.delegation_id = m.delegation_id and g.revoquee_le is null
       and now() between g.debut and g.fin and (g.etablissement_id = f.etablissement_id or (g.etablissement_id is null and g.departement_id = f.departement_id))) then
    return 'derogation';
  end if;
  raise exception 'Cette fiche ne relève pas de votre circonscription.' using errcode = '42501';
end $$;

/** Une délégation destinataire ne voit que les versions qui lui ont été transmises et les commentaires de ces versions
    (cas d'un établissement qui a changé de département). */
create or replace function public._inst_filtrer_destinataire(j jsonb, p_fiche uuid, p_acces text, p_delegation uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p_acces <> 'destinataire' then j else j
    || jsonb_build_object('versions', (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(j -> 'versions') x
                                         where (x ->> 'version')::int in (select version from public.inst_fiche_versions where fiche_id = p_fiche and destinataire_id = p_delegation)),
                          'commentaires', (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(j -> 'commentaires') x
                                         where (x ->> 'version')::int in (select version from public.inst_fiche_versions where fiche_id = p_fiche and destinataire_id = p_delegation))) end
$$;

create or replace function public.inst_fiche_lire(p_fiche uuid, p_version integer default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_acces text := public._inst_acces_fiche(p_fiche); f public.inst_fiches; v public.inst_fiche_versions; m public.inst_membres := public._inst_moi();
begin
  select * into f from public.inst_fiches where id = p_fiche;
  select * into v from public.inst_fiche_versions where fiche_id = f.id and (p_version is null or version = p_version)
     and (v_acces <> 'destinataire' or destinataire_id = m.delegation_id) order by version desc limit 1;
  if v_acces <> 'proprietaire' then
    if v.id is null then raise exception 'Aucune version transmise.' using errcode = 'P0001'; end if;
    perform public._inst_journaliser(case when v_acces = 'derogation' then 'consultation par dérogation' else 'consultation' end, 'inst_fiche', f.id,
                                     jsonb_build_object('version', v.version));
    if v_acces = 'destinataire' and f.statut in ('publiee', 'republiee') and (m.role = 'titulaire' or 'examen' = any (m.permissions)) then
      perform public._inst_statut(f.id, 'en_examen', 'Ouverture par la délégation');
      select * into f from public.inst_fiches where id = p_fiche;
    end if;
  end if;
  return public._inst_filtrer_destinataire(public._inst_fiche_json(f, v_acces = 'proprietaire'), f.id, v_acces, m.delegation_id) || jsonb_build_object('acces', v_acces,
    'publiee', case when v.id is not null then jsonb_build_object('version', v.version, 'donnees', v.donnees, 'indicateurs', v.indicateurs,
                 'anomalies', v.anomalies, 'publie_le', v.publie_le, 'en_retard', v.en_retard,
                 'publie_par', coalesce((select nullif(btrim(nom || ' ' || prenom), '') from public.personnels where id = v.publie_par), (select btrim(prenom || ' ' || nom) from public.inst_membres where user_id = v.publie_par order by debut desc limit 1), '')) end,
    'indicateurs_brouillon', case when v_acces = 'proprietaire' and f.niveau = 'etablissement' then public._inst_indicateurs(f.brouillon) end);
end $$;

create or replace function public.inst_fiche_enregistrer(p_fiche uuid, p_donnees jsonb, p_prete boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare f public.inst_fiches; m public.inst_membres;
begin
  if public._inst_acces_fiche(p_fiche) <> 'proprietaire' then raise exception 'Seul l''auteur de la fiche peut la modifier.' using errcode = '42501'; end if;
  select * into f from public.inst_fiches where id = p_fiche for update;
  if f.niveau <> 'etablissement' then m := public._inst_exiger('synthese'); end if;
  if f.statut not in ('brouillon', 'prete', 'correction_demandee', 'corrigee') then
    raise exception 'La fiche publiée n''est modifiable qu''après une demande de correction.' using errcode = 'P0001';
  end if;
  update public.inst_fiches set brouillon = public._inst_nettoyer(p_donnees), maj_le = now(), maj_par = auth.uid() where id = f.id;
  if f.statut = 'correction_demandee' then perform public._inst_statut(f.id, 'corrigee', 'Correction en cours');
  elsif f.statut in ('brouillon', 'prete') then perform public._inst_statut(f.id, case when p_prete then 'prete' else 'brouillon' end);
  end if;
  return jsonb_build_object('statut', (select statut from public.inst_fiches where id = f.id), 'maj_le', now(),
                            'indicateurs', case when f.niveau = 'etablissement' then public._inst_indicateurs(public._inst_nettoyer(p_donnees)) end);
end $$;

/** Publication (établissement → délégation départementale ; départementale → régionale ; régionale : archivage). */
create or replace function public.inst_fiche_publier(p_fiche uuid, p_confirmer boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare f public.inst_fiches; c public.inst_campagnes; e public.etablissements; v_dest uuid; v_ind jsonb; v_anom jsonb; v_n integer; v_retard boolean;
        m public.inst_membres; dl public.inst_delegations; v_etab_c public.inst_campagnes; v_vers uuid[]; v_attendus integer; v_id uuid;
begin
  if public._inst_acces_fiche(p_fiche) <> 'proprietaire' then raise exception 'Seul l''auteur de la fiche peut la publier.' using errcode = '42501'; end if;
  select * into f from public.inst_fiches where id = p_fiche for update;
  if f.statut not in ('brouillon', 'prete', 'correction_demandee', 'corrigee') then raise exception 'Cette version est déjà publiée.' using errcode = 'P0001'; end if;
  select * into c from public.inst_campagnes where id = f.campagne_id;
  if not c.ouvert then raise exception 'La campagne est fermée : la publication n''est plus possible.' using errcode = 'P0001'; end if;
  v_retard := public._aujourdhui() > public._inst_echeance(c);

  if f.niveau = 'etablissement' then
    select * into e from public.etablissements where id = f.etablissement_id;
    if e.departement_id is null or e.rattachement_statut <> 'verifie' then
      raise exception 'Le rattachement administratif de votre établissement (région, département) doit être renseigné et vérifié avant toute publication.' using errcode = 'P0001';
    end if;
    v_dest := public._inst_delegation_etablissement(e.id);
    if v_dest is null then
      raise exception 'Aucune délégation départementale active n''est encore enregistrée pour votre département : la fiche ne peut pas être transmise. Elle reste enregistrée.' using errcode = 'P0001';
    end if;
    v_ind := public._inst_indicateurs(f.brouillon);
    update public.inst_fiches set departement_id = e.departement_id, region_id = (select region_id from public.inst_departements where id = e.departement_id) where id = f.id;
  else
    m := public._inst_exiger('synthese');
    select * into dl from public.inst_delegations where id = f.delegation_id;
    -- consolidation figée au moment de la publication
    if f.niveau = 'departement' then
      select * into v_etab_c from public.inst_campagnes where niveau = 'etablissement' and exercice_libelle = f.exercice_libelle and periode = f.periode;
      select array_agg(v.id) into v_vers from public.inst_fiches fe
        join lateral (select id from public.inst_fiche_versions where fiche_id = fe.id and destinataire_id = dl.id order by version desc limit 1) v on true
       where fe.niveau = 'etablissement' and fe.campagne_id = v_etab_c.id;
      select count(*) into v_attendus from public.etablissements where departement_id = dl.departement_id and rattachement_statut = 'verifie';
      v_dest := public._inst_delegation_regionale(dl.id);
      if v_dest is null then raise exception 'Aucune délégation régionale active n''est enregistrée pour votre région : la synthèse ne peut pas être transmise.' using errcode = 'P0001'; end if;
    else
      select * into v_etab_c from public.inst_campagnes where niveau = 'departement' and exercice_libelle = f.exercice_libelle and periode = f.periode;
      select array_agg(v.id) into v_vers from public.inst_fiches fe
        join lateral (select id from public.inst_fiche_versions where fiche_id = fe.id and destinataire_id = dl.id order by version desc limit 1) v on true
       where fe.niveau = 'departement' and fe.campagne_id = v_etab_c.id;
      select count(*) into v_attendus from public.inst_departements where region_id = dl.region_id and actif;
    end if;
    v_ind := public._inst_consolider(coalesce(v_vers, '{}')) || jsonb_build_object('attendus', v_attendus,
               'observations', char_length(btrim(coalesce(f.brouillon ->> 'observations', ''))) > 0, 'anomalies', '[]'::jsonb);
    if coalesce((v_ind ->> 'nb_fiches')::int, 0) < v_attendus then
      v_ind := jsonb_set(v_ind, '{anomalies}', jsonb_build_array(jsonb_build_object('niveau', 'alerte', 'code', 'incomplet',
                 'message', (v_attendus - coalesce((v_ind ->> 'nb_fiches')::int, 0)) || ' document(s) attendu(s) non reçu(s) : la consolidation est partielle.')));
    end if;
  end if;

  v_anom := coalesce(v_ind -> 'anomalies', '[]');
  if exists (select 1 from jsonb_array_elements(v_anom) a where a ->> 'niveau' = 'bloquant') then
    raise exception 'Publication impossible : corrigez d''abord les anomalies bloquantes (valeurs négatives ou incohérentes).' using errcode = 'P0001';
  end if;
  if not p_confirmer and exists (select 1 from jsonb_array_elements(v_anom) a where a ->> 'niveau' = 'alerte') then
    raise exception 'Des anomalies sont signalées : vérifiez-les puis confirmez la publication.' using errcode = 'P0001', hint = 'confirmation';
  end if;

  v_n := f.version_courante + 1;
  insert into public.inst_fiche_versions (fiche_id, version, donnees, indicateurs, anomalies, destinataire_id, departement_id, region_id, en_retard, publie_par)
  values (f.id, v_n, f.brouillon, v_ind, v_anom, v_dest, (select departement_id from public.inst_fiches where id = f.id), (select region_id from public.inst_fiches where id = f.id),
          v_retard, auth.uid())
  returning id into v_id;
  update public.inst_fiches set version_courante = v_n where id = f.id;
  perform public._inst_statut(f.id, case when v_n = 1 then 'publiee' else 'republiee' end, case when v_retard then 'Publication après l''échéance' else '' end);
  if v_dest is not null then
    perform public._inst_notifier(null, v_dest, 'publication',
      case when f.niveau = 'etablissement' then 'Fiche reçue : ' || e.nom else 'Synthèse reçue : ' || dl.nom end
        || ' (' || upper(f.periode) || ' ' || f.exercice_libelle || ', version ' || v_n || ')',
      case when v_retard then 'Transmise après l''échéance.' else '' end, '/institution/fiches/' || f.id, f.id);
  end if;
  perform public._inst_journaliser('publication', 'inst_fiche', f.id, jsonb_build_object('version', v_n, 'destinataire', v_dest, 'en_retard', v_retard, 'niveau', f.niveau));
  return jsonb_build_object('version', v_n, 'en_retard', v_retard, 'destinataire', (select nom from public.inst_delegations where id = v_dest));
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 11. Examen par la délégation destinataire
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._inst_fiche_recue(p_fiche uuid, p_permission text) returns public.inst_fiches
language plpgsql volatile security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger(p_permission); f public.inst_fiches;
begin
  select * into f from public.inst_fiches where id = p_fiche for update;
  if f.id is null or not exists (select 1 from public.inst_fiche_versions v where v.fiche_id = f.id and v.version = f.version_courante and v.destinataire_id = m.delegation_id) then
    raise exception 'Cette fiche ne vous a pas été transmise.' using errcode = '42501';
  end if;
  return f;
end $$;

create or replace function public._inst_nom_membre() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(btrim(m.prenom || ' ' || m.nom), ''), m.email) || coalesce(' — ' || nullif(m.fonction, ''), '') from public.inst_membres m
   where m.user_id = auth.uid() and m.actif limit 1
$$;

create or replace function public.inst_fiche_commenter(p_fiche uuid, p_texte text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare f public.inst_fiches; m public.inst_membres := public._inst_moi(); v_acces text := public._inst_acces_fiche(p_fiche);
begin
  select * into f from public.inst_fiches where id = p_fiche;
  if v_acces = 'destinataire' then
    f := public._inst_fiche_recue(p_fiche, 'examen');
    insert into public.inst_commentaires (fiche_id, version, delegation_id, auteur, auteur_nom, type, texte)
    values (f.id, f.version_courante, m.delegation_id, auth.uid(), coalesce(public._inst_nom_membre(), ''), 'commentaire', btrim(p_texte));
    perform public._inst_notifier(f.etablissement_id, case when f.niveau <> 'etablissement' then f.delegation_id end, 'commentaire', 'Nouveau commentaire sur votre fiche ' || upper(f.periode) || ' ' || f.exercice_libelle,
      left(btrim(p_texte), 300), case when f.niveau = 'etablissement' then '/fiches-statistiques/' else '/institution/synthese/' end || f.id, f.id);
  elsif v_acces = 'proprietaire' and f.version_courante > 0 then
    if f.niveau <> 'etablissement' then perform public._inst_exiger('synthese'); end if;
    insert into public.inst_commentaires (fiche_id, version, delegation_id, etablissement_id, auteur, auteur_nom, type, texte)
    values (f.id, f.version_courante, case when f.niveau <> 'etablissement' then f.delegation_id end, f.etablissement_id, auth.uid(),
            coalesce(public._inst_nom_membre(), (select btrim(nom || ' ' || prenom) from public.personnels where id = auth.uid()), ''), 'reponse', btrim(p_texte));
    if (select destinataire_id from public.inst_fiche_versions where fiche_id = f.id and version = f.version_courante) is not null then
      perform public._inst_notifier(null, (select destinataire_id from public.inst_fiche_versions where fiche_id = f.id and version = f.version_courante), 'commentaire',
        'Réponse sur une fiche', left(btrim(p_texte), 300), '/institution/fiches/' || f.id, f.id);
    end if;
  else
    raise exception 'Action non autorisée.' using errcode = '42501';
  end if;
  perform public._inst_journaliser('commentaire', 'inst_fiche', f.id, '{}');
end $$;

create or replace function public.inst_fiche_demander_correction(p_fiche uuid, p_texte text, p_elements text[] default '{}') returns void
language plpgsql volatile security definer set search_path = '' as $$
declare f public.inst_fiches := public._inst_fiche_recue(p_fiche, 'examen'); m public.inst_membres := public._inst_moi();
begin
  if char_length(btrim(coalesce(p_texte, ''))) < 5 then raise exception 'Précisez la correction demandée.' using errcode = 'P0001'; end if;
  if f.statut not in ('publiee', 'republiee', 'en_examen', 'examinee') then raise exception 'Une correction est déjà demandée.' using errcode = 'P0001'; end if;
  insert into public.inst_commentaires (fiche_id, version, delegation_id, auteur, auteur_nom, type, texte, elements)
  values (f.id, f.version_courante, m.delegation_id, auth.uid(), coalesce(public._inst_nom_membre(), ''), 'correction', btrim(p_texte), coalesce(p_elements, '{}'));
  perform public._inst_statut(f.id, 'correction_demandee', left(btrim(p_texte), 500));
  perform public._inst_notifier(f.etablissement_id, case when f.niveau <> 'etablissement' then f.delegation_id end, 'correction',
    'Correction demandée : fiche ' || upper(f.periode) || ' ' || f.exercice_libelle, left(btrim(p_texte), 300),
    case when f.niveau = 'etablissement' then '/fiches-statistiques/' else '/institution/synthese/' end || f.id, f.id);
  perform public._inst_journaliser('demande de correction', 'inst_fiche', f.id, jsonb_build_object('version', f.version_courante, 'elements', p_elements));
end $$;

create or replace function public.inst_fiche_examinee(p_fiche uuid, p_appreciation text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare f public.inst_fiches := public._inst_fiche_recue(p_fiche, 'examen');
begin
  if f.statut not in ('publiee', 'republiee', 'en_examen') then raise exception 'Cette fiche ne peut pas être marquée examinée dans son état actuel.' using errcode = 'P0001'; end if;
  if p_appreciation is not null and not exists (select 1 from public.inst_appreciations where code = p_appreciation and actif) then raise exception 'Appréciation inconnue.' using errcode = 'P0001'; end if;
  update public.inst_fiches set appreciation = p_appreciation where id = f.id;
  perform public._inst_statut(f.id, 'examinee', coalesce('Appréciation : ' || (select libelle from public.inst_appreciations where code = p_appreciation), ''));
  perform public._inst_notifier(f.etablissement_id, case when f.niveau <> 'etablissement' then f.delegation_id end, 'examen',
    'Fiche reçue et examinée : ' || upper(f.periode) || ' ' || f.exercice_libelle, '', case when f.niveau = 'etablissement' then '/fiches-statistiques/' else '/institution/synthese/' end || f.id, f.id);
  perform public._inst_journaliser('fiche examinée', 'inst_fiche', f.id, jsonb_build_object('appreciation', p_appreciation));
end $$;

create or replace function public.inst_appreciations_lire() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'libelle', libelle) order by ordre), '[]'::jsonb) from public.inst_appreciations where actif and auth.uid() is not null
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 12. Tableaux de bord et consolidation (délégations)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.inst_mon_espace() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when m.id is null then jsonb_build_object('membre', null, 'demande', public.inst_ma_demande())
    else jsonb_build_object(
      'membre', jsonb_build_object('id', m.id, 'role', m.role, 'permissions', case when m.role = 'titulaire' then array['examen', 'courriers', 'synthese'] else m.permissions end,
                                   'nom', m.nom, 'prenom', m.prenom, 'fonction', m.fonction, 'email', m.email),
      'delegation', jsonb_build_object('id', d.id, 'niveau', d.niveau, 'nom', d.nom, 'region', r.nom, 'region_id', r.id, 'departement', dp.nom, 'departement_id', dp.id,
                                       'collaborateurs_autorises', d.collaborateurs_autorises, 'ia_categories', d.ia_categories),
      'collaborateurs', case when m.role = 'titulaire' then (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'email', c.email, 'permissions', c.permissions, 'debut', c.debut)), '[]'::jsonb)
                          from public.inst_membres c where c.delegation_id = d.id and c.role = 'collaborateur' and c.actif) end,
      'non_lues', (select count(*) from public.inst_notifications n where n.delegation_id = d.id and n.lu_le is null)) end
    from (select 1) x left join public.inst_membres m on m.id = (public._inst_moi()).id
    left join public.inst_delegations d on d.id = m.delegation_id left join public.inst_regions r on r.id = d.region_id
    left join public.inst_departements dp on dp.id = d.departement_id
$$;

create or replace function public.inst_campagnes_lire(p_niveau text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(public._inst_campagne_json(c) order by c.exercice_libelle desc, c.periode desc), '[]'::jsonb)
    from public.inst_campagnes c where c.niveau = p_niveau and auth.uid() is not null
$$;

/** Tableau de bord départemental (campagne des établissements). */
create or replace function public.inst_tableau_departement(p_campagne uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger(); dl public.inst_delegations; c public.inst_campagnes; v_lignes jsonb; v_ech date;
begin
  select * into dl from public.inst_delegations where id = m.delegation_id;
  if dl.niveau <> 'departement' then raise exception 'Réservé aux délégations départementales.' using errcode = '42501'; end if;
  select * into c from public.inst_campagnes where id = p_campagne and niveau = 'etablissement';
  v_ech := public._inst_echeance(c);
  select coalesce(jsonb_agg(x order by x ->> 'nom'), '[]'::jsonb) into v_lignes from (
    select jsonb_build_object('id', e.id, 'nom', e.nom, 'ville', e.ville, 'code', upper(left(replace(e.id::text, '-', ''), 8)),
             'rattachement', e.rattachement_statut,
             'fiche_id', f.id, 'statut', case when v.version is null then 'non_publiee' else f.statut end,
             'version', v.version, 'premiere_publication', (select min(publie_le) from public.inst_fiche_versions where fiche_id = f.id and destinataire_id = dl.id),
             'derniere_publication', v.publie_le, 'en_retard', coalesce(v.en_retard, c.id is not null and public._aujourdhui() > v_ech),
             'jours_retard', case when v.version is null and public._aujourdhui() > v_ech then public._aujourdhui() - v_ech end,
             'derniere_action', (select s.le from public.inst_fiche_statuts s where s.fiche_id = f.id and v.version is not null order by s.le desc limit 1),
             'consultee', exists (select 1 from public.inst_journal j where j.objet = 'inst_fiche' and j.objet_id = f.id and j.action = 'consultation'),
             'appreciation', f.appreciation) x
      from public.etablissements e
      left join public.inst_fiches f on f.niveau = 'etablissement' and f.etablissement_id = e.id and f.campagne_id = c.id
      left join lateral (select version, publie_le, en_retard from public.inst_fiche_versions where fiche_id = f.id and destinataire_id = dl.id order by version desc limit 1) v on true
     where e.departement_id = dl.departement_id and e.rattachement_statut in ('declare', 'verifie')) z;
  return jsonb_build_object('campagne', case when c.id is not null then public._inst_campagne_json(c) end,
    'etablissements', v_lignes,
    'compteurs', jsonb_build_object(
       'etablissements', jsonb_array_length(v_lignes),
       'attendues', (select count(*) from jsonb_array_elements(v_lignes) x where x ->> 'rattachement' = 'verifie'),
       'a_verifier', (select count(*) from jsonb_array_elements(v_lignes) x where x ->> 'rattachement' = 'declare'),
       'publiees', (select count(*) from jsonb_array_elements(v_lignes) x where x ->> 'statut' <> 'non_publiee'),
       'non_publiees', (select count(*) from jsonb_array_elements(v_lignes) x where x ->> 'statut' = 'non_publiee' and x ->> 'rattachement' = 'verifie'),
       'en_retard', (select count(*) from jsonb_array_elements(v_lignes) x where x ->> 'statut' = 'non_publiee' and x ->> 'rattachement' = 'verifie' and (x ->> 'en_retard')::boolean),
       'publiees_en_retard', (select count(*) from jsonb_array_elements(v_lignes) x where x ->> 'statut' <> 'non_publiee' and (x ->> 'en_retard')::boolean),
       'correction', (select count(*) from jsonb_array_elements(v_lignes) x where x ->> 'statut' in ('correction_demandee', 'corrigee')),
       'examinees', (select count(*) from jsonb_array_elements(v_lignes) x where x ->> 'statut' = 'examinee')));
end $$;

/** Consolidation (départementale : fiches des établissements ; régionale : synthèses départementales). Les manquants ne comptent jamais pour zéro. */
create or replace function public.inst_consolidation(p_campagne uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger(); dl public.inst_delegations; c public.inst_campagnes; v_vers uuid[]; v_att integer; v_corr integer;
begin
  select * into dl from public.inst_delegations where id = m.delegation_id;
  select * into c from public.inst_campagnes where id = p_campagne;
  if c.id is null or (dl.niveau = 'departement' and c.niveau <> 'etablissement') or (dl.niveau = 'region' and c.niveau <> 'departement') then
    raise exception 'Campagne incompatible avec votre niveau.' using errcode = 'P0001';
  end if;
  select array_agg(v.id), count(*) filter (where f.statut in ('correction_demandee', 'corrigee')) into v_vers, v_corr
    from public.inst_fiches f
    join lateral (select id from public.inst_fiche_versions where fiche_id = f.id and destinataire_id = dl.id order by version desc limit 1) v on true
   where f.campagne_id = c.id;
  if dl.niveau = 'departement' then
    select count(*) into v_att from public.etablissements where departement_id = dl.departement_id and rattachement_statut = 'verifie';
  else
    select count(*) into v_att from public.inst_departements where region_id = dl.region_id and actif;
  end if;
  return public._inst_consolider(coalesce(v_vers, '{}')) || jsonb_build_object(
    'campagne', public._inst_campagne_json(c), 'attendus', v_att, 'recus', coalesce(array_length(v_vers, 1), 0),
    'manquants', greatest(v_att - coalesce(array_length(v_vers, 1), 0), 0), 'en_correction', coalesce(v_corr, 0),
    'perimetre', dl.nom,
    'detail', (select coalesce(jsonb_agg(jsonb_build_object('fiche_id', f.id, 'nom', coalesce(e.nom, d2.nom), 'statut', f.statut, 'version', v.version,
                 'nb_fiches', v.indicateurs -> 'nb_fiches', 'indicateurs', v.indicateurs -> 'indicateurs') order by coalesce(e.nom, d2.nom)), '[]'::jsonb)
                 from public.inst_fiches f join public.inst_fiche_versions v on v.id = any (coalesce(v_vers, '{}')) and v.fiche_id = f.id
                 left join public.etablissements e on e.id = f.etablissement_id left join public.inst_delegations d2 on d2.id = f.delegation_id));
end $$;

/** Tableau de bord régional : délégations départementales de la région et leurs synthèses. */
create or replace function public.inst_tableau_region(p_campagne uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger(); dl public.inst_delegations; c public.inst_campagnes; v_l jsonb; v_ech date;
begin
  select * into dl from public.inst_delegations where id = m.delegation_id;
  if dl.niveau <> 'region' then raise exception 'Réservé aux délégations régionales.' using errcode = '42501'; end if;
  select * into c from public.inst_campagnes where id = p_campagne and niveau = 'departement';
  v_ech := public._inst_echeance(c);
  select coalesce(jsonb_agg(x order by x ->> 'departement'), '[]'::jsonb) into v_l from (
    select jsonb_build_object('departement', dp.nom, 'departement_id', dp.id, 'delegation', d.nom, 'delegation_id', d.id,
             'active', d.id is not null and d.actif and exists (select 1 from public.inst_membres mm where mm.delegation_id = d.id and mm.role = 'titulaire' and mm.actif),
             'etablissements', (select count(*) from public.etablissements e where e.departement_id = dp.id and e.rattachement_statut = 'verifie'),
             'fiche_id', f.id, 'statut', case when v.version is null then 'non_publiee' else f.statut end, 'version', v.version, 'publie_le', v.publie_le,
             'en_retard', coalesce(v.en_retard, c.id is not null and public._aujourdhui() > v_ech), 'nb_fiches', v.nb) x
      from public.inst_departements dp
      left join public.inst_delegations d on d.niveau = 'departement' and d.departement_id = dp.id
      left join public.inst_fiches f on f.niveau = 'departement' and f.delegation_id = d.id and f.campagne_id = c.id
      left join lateral (select version, publie_le, en_retard, indicateurs -> 'nb_fiches' nb from public.inst_fiche_versions where fiche_id = f.id and destinataire_id = dl.id order by version desc limit 1) v on true
     where dp.region_id = dl.region_id and dp.actif) z;
  return jsonb_build_object('campagne', case when c.id is not null then public._inst_campagne_json(c) end, 'departements', v_l,
    'compteurs', jsonb_build_object('departements', jsonb_array_length(v_l),
       'delegations_actives', (select count(*) from jsonb_array_elements(v_l) x where (x ->> 'active')::boolean),
       'recues', (select count(*) from jsonb_array_elements(v_l) x where x ->> 'statut' <> 'non_publiee'),
       'en_retard', (select count(*) from jsonb_array_elements(v_l) x where x ->> 'statut' = 'non_publiee' and (x ->> 'en_retard')::boolean),
       'correction', (select count(*) from jsonb_array_elements(v_l) x where x ->> 'statut' in ('correction_demandee', 'corrigee')),
       'examinees', (select count(*) from jsonb_array_elements(v_l) x where x ->> 'statut' = 'examinee')));
end $$;

/** Synthèse de la délégation (départementale ou régionale) pour une campagne de son niveau. */
create or replace function public.inst_synthese_preparer(p_campagne uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger('synthese'); dl public.inst_delegations; c public.inst_campagnes; v_id uuid;
begin
  select * into dl from public.inst_delegations where id = m.delegation_id;
  select * into c from public.inst_campagnes where id = p_campagne and niveau = dl.niveau;
  if c.id is null or not c.ouvert then raise exception 'Campagne fermée ou introuvable.' using errcode = 'P0001'; end if;
  select id into v_id from public.inst_fiches where delegation_id = dl.id and campagne_id = c.id;
  if v_id is not null then return v_id; end if;
  insert into public.inst_fiches (niveau, campagne_id, delegation_id, departement_id, region_id, exercice_libelle, periode, brouillon, maj_par)
  values (dl.niveau, c.id, dl.id, dl.departement_id, dl.region_id, c.exercice_libelle, c.periode,
          jsonb_build_object('responsable', btrim(m.prenom || ' ' || m.nom), 'observations', '', 'difficultes', '', 'recommandations', ''), auth.uid())
  on conflict (delegation_id, campagne_id) where niveau <> 'etablissement' do nothing
  returning id into v_id;
  if v_id is null then return (select id from public.inst_fiches where delegation_id = dl.id and campagne_id = c.id); end if;
  insert into public.inst_fiche_statuts (fiche_id, de, a, par, motif) values (v_id, null, 'brouillon', auth.uid(), 'Création');
  return v_id;
end $$;

create or replace function public.inst_syntheses() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger(); dl public.inst_delegations;
begin
  select * into dl from public.inst_delegations where id = m.delegation_id;
  return (select coalesce(jsonb_agg(public._inst_campagne_json(c) || jsonb_build_object('fiche', (select jsonb_build_object('id', f.id, 'statut', f.statut, 'version', f.version_courante)
             from public.inst_fiches f where f.delegation_id = dl.id and f.campagne_id = c.id)) order by c.exercice_libelle desc, c.periode desc), '[]'::jsonb)
    from public.inst_campagnes c where c.niveau = dl.niveau);
end $$;

/** Relance des établissements (ou délégations) n'ayant pas publié : notification interne, journalisée. */
create or replace function public.inst_relancer(p_campagne uuid, p_cibles uuid[], p_message text default '') returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger('examen'); dl public.inst_delegations; c public.inst_campagnes; v_n integer := 0; x uuid;
begin
  select * into dl from public.inst_delegations where id = m.delegation_id;
  select * into c from public.inst_campagnes where id = p_campagne;
  if c.id is null then raise exception 'Campagne introuvable.' using errcode = 'P0001'; end if;
  if coalesce(cardinality(p_cibles), 0) > 500 then raise exception 'Cinq cents destinataires au plus par relance.' using errcode = 'P0001'; end if;
  foreach x in array coalesce(p_cibles, '{}') loop
    if dl.niveau = 'departement' and c.niveau = 'etablissement'
       and exists (select 1 from public.etablissements e where e.id = x and e.departement_id = dl.departement_id and e.rattachement_statut = 'verifie') then
      perform public._inst_notifier(x, null, 'relance', 'Relance : fiche statistique ' || upper(c.periode) || ' ' || c.exercice_libelle,
        coalesce(nullif(btrim(p_message), ''), 'Votre délégation départementale attend la publication de votre fiche (échéance : ' || to_char(public._inst_echeance(c), 'DD/MM/YYYY') || ').'),
        '/fiches-statistiques', c.id);
      v_n := v_n + 1;
    elsif dl.niveau = 'region' and c.niveau = 'departement'
       and exists (select 1 from public.inst_delegations d join public.inst_departements dp on dp.id = d.departement_id where d.id = x and dp.region_id = dl.region_id) then
      perform public._inst_notifier(null, x, 'relance', 'Relance : synthèse départementale ' || upper(c.periode) || ' ' || c.exercice_libelle,
        coalesce(nullif(btrim(p_message), ''), 'Votre délégation régionale attend la publication de votre synthèse.'), '/institution/synthese', c.id);
      v_n := v_n + 1;
    else
      raise exception 'Une cible ne relève pas de votre circonscription.' using errcode = '42501';
    end if;
  end loop;
  perform public._inst_journaliser('relance', 'inst_campagne', c.id, jsonb_build_object('cibles', coalesce(array_length(p_cibles, 1), 0)));
  return v_n;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 13. Dérogations : accès exceptionnel d'une délégation régionale aux fiches brutes (explicite, limité, journalisé)
-- ---------------------------------------------------------------------------------------------------------
create table public.inst_derogations (
  id uuid primary key default gen_random_uuid(),
  delegation_id uuid not null references public.inst_delegations (id),
  etablissement_id uuid references public.etablissements (id) on delete cascade,
  departement_id uuid references public.inst_departements (id),
  motif text not null check (char_length(btrim(motif)) between 5 and 500),
  debut timestamptz not null default now(),
  fin timestamptz not null,
  accorde_par uuid not null,
  revoquee_le timestamptz,
  cree_le timestamptz not null default now(),
  check ((etablissement_id is not null) or (departement_id is not null)),
  check (fin > debut and fin <= debut + interval '90 days')
);
alter table public.inst_derogations enable row level security;
revoke all on public.inst_derogations from anon, authenticated;

create or replace function public.console_inst_derogation(p_delegation uuid, p_departement uuid, p_etablissement uuid, p_jours integer, p_motif text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare dl public.inst_delegations; v_dep uuid := p_departement; v_id uuid;
begin
  perform public._exiger_proprietaire();
  select * into dl from public.inst_delegations where id = p_delegation;
  if dl.niveau is distinct from 'region' then raise exception 'Une dérogation ne concerne qu''une délégation régionale.' using errcode = 'P0001'; end if;
  if p_etablissement is not null then select departement_id into v_dep from public.etablissements where id = p_etablissement; end if;
  if not exists (select 1 from public.inst_departements where id = v_dep and region_id = dl.region_id) then
    raise exception 'Le périmètre demandé n''appartient pas à la région de cette délégation.' using errcode = 'P0001';
  end if;
  if coalesce(p_jours, 0) not between 1 and 90 then raise exception 'Durée : 1 à 90 jours.' using errcode = 'P0001'; end if;
  insert into public.inst_derogations (delegation_id, etablissement_id, departement_id, motif, fin, accorde_par)
  values (dl.id, p_etablissement, case when p_etablissement is null then v_dep end, btrim(p_motif), now() + make_interval(days => p_jours), auth.uid())
  returning id into v_id;
  perform public._inst_notifier(null, dl.id, 'derogation', 'Accès exceptionnel accordé (' || p_jours || ' jours)', btrim(p_motif), '/institution/fiches-brutes', v_id);
  perform public._inst_journaliser('dérogation accordée', 'inst_delegation', dl.id, jsonb_build_object('derogation', v_id, 'etablissement', p_etablissement, 'departement', v_dep, 'jours', p_jours));
  return v_id;
end $$;

create or replace function public.console_inst_derogation_revoquer(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public._exiger_proprietaire();
  update public.inst_derogations set revoquee_le = now() where id = p_id and revoquee_le is null;
  if not found then raise exception 'Dérogation introuvable ou déjà révoquée.' using errcode = 'P0001'; end if;
  perform public._inst_journaliser('dérogation révoquée', 'inst_derogation', p_id, '{}');
end $$;

/** Fiches brutes accessibles par dérogation (délégation régionale). */
create or replace function public.inst_fiches_derogation() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('derogation', g.id, 'fin', g.fin, 'motif', g.motif,
            'fiches', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'etablissement', e.nom, 'periode', f.periode, 'exercice', f.exercice_libelle, 'statut', f.statut, 'version', f.version_courante)), '[]'::jsonb)
                         from public.inst_fiches f join public.etablissements e on e.id = f.etablissement_id
                        where f.niveau = 'etablissement' and f.version_courante > 0
                          and (f.etablissement_id = g.etablissement_id or (g.etablissement_id is null and f.departement_id = g.departement_id))))), '[]'::jsonb)
    from public.inst_derogations g where g.delegation_id = m.delegation_id and g.revoquee_le is null and now() between g.debut and g.fin);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 14. Courriers institutionnels (délégation départementale → établissements ; régionale → départementales)
-- ---------------------------------------------------------------------------------------------------------
create table public.inst_courrier_types (
  code text primary key check (code ~ '^[a-z_]{2,30}$'),
  libelle text not null check (char_length(libelle) <= 80),
  actif boolean not null default true,
  ordre smallint not null default 0
);
insert into public.inst_courrier_types (code, libelle, ordre) values
  ('rappel', 'Rappel', 1), ('correction', 'Demande de correction', 2), ('information', 'Demande d''informations', 3), ('convocation', 'Convocation', 4),
  ('note', 'Note administrative', 5), ('rapport', 'Demande de rapport', 6), ('libre', 'Courrier libre', 7);

create table public.inst_courriers (
  id uuid primary key default gen_random_uuid(),
  delegation_id uuid not null references public.inst_delegations (id),
  reference text,
  type text not null references public.inst_courrier_types (code),
  objet text not null check (char_length(btrim(objet)) between 3 and 200),
  corps text not null check (char_length(corps) <= 10000),
  date_limite date,
  pieces text[] not null default '{}' check (cardinality(pieces) <= 5),
  auteur uuid not null,
  auteur_nom text not null default '',
  fonction text not null default '',
  statut text not null default 'brouillon' check (statut in ('brouillon', 'envoye', 'archive')),
  envoye_le timestamptz,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  unique (delegation_id, reference)
);
create table public.inst_courrier_destinataires (
  id uuid primary key default gen_random_uuid(),
  courrier_id uuid not null references public.inst_courriers (id),
  etablissement_id uuid references public.etablissements (id) on delete cascade,
  delegation_id uuid references public.inst_delegations (id),
  statut text not null default 'distribue' check (statut in ('distribue', 'lu', 'repondu', 'archive')),
  lu_le timestamptz,
  lu_par uuid,
  check ((etablissement_id is null) <> (delegation_id is null)),
  unique (courrier_id, etablissement_id),
  unique (courrier_id, delegation_id)
);
create table public.inst_courrier_reponses (
  id uuid primary key default gen_random_uuid(),
  destinataire_id uuid not null references public.inst_courrier_destinataires (id) on delete cascade,
  auteur uuid not null,
  auteur_nom text not null default '',
  texte text not null check (char_length(btrim(texte)) between 1 and 10000),
  pieces text[] not null default '{}' check (cardinality(pieces) <= 5),
  le timestamptz not null default now()
);
alter table public.inst_courrier_types enable row level security;
alter table public.inst_courriers enable row level security;
alter table public.inst_courrier_destinataires enable row level security;
alter table public.inst_courrier_reponses enable row level security;
revoke all on public.inst_courrier_types, public.inst_courriers, public.inst_courrier_destinataires, public.inst_courrier_reponses from anon, authenticated;

-- Aucune modification silencieuse après envoi : seul le passage à « archivé » reste possible.
create or replace function public._inst_courrier_immuable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.statut <> 'brouillon' then raise exception 'Un courrier envoyé ne peut pas être supprimé.' using errcode = '42501'; end if;
    return old;
  end if;
  if old.statut <> 'brouillon' and (new.objet, new.corps, new.type, new.pieces, new.date_limite, new.reference, new.delegation_id, new.envoye_le)
       is distinct from (old.objet, old.corps, old.type, old.pieces, old.date_limite, old.reference, old.delegation_id, old.envoye_le) then
    raise exception 'Un courrier envoyé ne peut plus être modifié.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger inst_courrier_immuable before update or delete on public.inst_courriers for each row execute function public._inst_courrier_immuable();
create or replace function public._inst_reponse_immuable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.inst_courrier_destinataires where id = old.destinataire_id) then return old; end if;
  raise exception 'Une réponse envoyée ne peut être ni modifiée ni supprimée.' using errcode = '42501';
end $$;
create trigger inst_reponse_immuable before update or delete on public.inst_courrier_reponses for each row execute function public._inst_reponse_immuable();

create or replace function public._inst_pieces_valides(p_pieces text[], p_prefixe text) returns text[]
language plpgsql immutable set search_path = '' as $$
declare x text;
begin
  foreach x in array coalesce(p_pieces, '{}') loop
    if x not like p_prefixe || '%' or x like '%..%' or char_length(x) > 300 then raise exception 'Pièce jointe invalide.' using errcode = 'P0001'; end if;
  end loop;
  return coalesce(p_pieces, '{}');
end $$;

create or replace function public.inst_courrier_enregistrer(p jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger('courriers'); v_id uuid := nullif(p ->> 'id', '')::uuid; v_pieces text[];
begin
  if not exists (select 1 from public.inst_courrier_types where code = p ->> 'type' and actif) then raise exception 'Type de courrier inconnu.' using errcode = 'P0001'; end if;
  select coalesce(array_agg(x), '{}') into v_pieces from jsonb_array_elements_text(coalesce(p -> 'pieces', '[]')) x;
  v_pieces := public._inst_pieces_valides(v_pieces, 'courriers/' || m.delegation_id::text || '/');
  if v_id is null then
    insert into public.inst_courriers (delegation_id, type, objet, corps, date_limite, pieces, auteur, auteur_nom, fonction)
    values (m.delegation_id, p ->> 'type', btrim(coalesce(p ->> 'objet', '')), coalesce(p ->> 'corps', ''), nullif(p ->> 'date_limite', '')::date, v_pieces,
            auth.uid(), coalesce(nullif(btrim(m.prenom || ' ' || m.nom), ''), m.email), m.fonction)
    returning id into v_id;
  else
    update public.inst_courriers set type = p ->> 'type', objet = btrim(coalesce(p ->> 'objet', '')), corps = coalesce(p ->> 'corps', ''),
           date_limite = nullif(p ->> 'date_limite', '')::date, pieces = v_pieces, maj_le = now()
     where id = v_id and delegation_id = m.delegation_id and statut = 'brouillon';
    if not found then raise exception 'Brouillon introuvable.' using errcode = 'P0001'; end if;
  end if;
  return v_id;
end $$;

/** Envoi : destinataires vérifiés dans la circonscription ; p_tous = tous les établissements (ou délégations) du périmètre. */
create or replace function public.inst_courrier_envoyer(p_courrier uuid, p_destinataires uuid[], p_tous boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger('courriers'); dl public.inst_delegations; c public.inst_courriers; v_cibles uuid[]; x uuid; v_ref text; v_n integer;
begin
  select * into dl from public.inst_delegations where id = m.delegation_id for update;
  select * into c from public.inst_courriers where id = p_courrier and delegation_id = dl.id for update;
  if c.id is null or c.statut <> 'brouillon' then raise exception 'Brouillon introuvable ou déjà envoyé.' using errcode = 'P0001'; end if;
  if dl.niveau = 'departement' then
    select coalesce(array_agg(id), '{}') into v_cibles from public.etablissements
     where departement_id = dl.departement_id and rattachement_statut = 'verifie' and (p_tous or id = any (coalesce(p_destinataires, '{}')));
  else
    select coalesce(array_agg(d.id), '{}') into v_cibles from public.inst_delegations d join public.inst_departements dp on dp.id = d.departement_id
     where d.niveau = 'departement' and d.actif and dp.region_id = dl.region_id and (p_tous or d.id = any (coalesce(p_destinataires, '{}')));
  end if;
  if not p_tous and cardinality(v_cibles) <> cardinality(array(select distinct unnest(coalesce(p_destinataires, '{}')))) then
    raise exception 'Un destinataire ne relève pas de votre circonscription.' using errcode = '42501';
  end if;
  if cardinality(v_cibles) = 0 then raise exception 'Aucun destinataire.' using errcode = 'P0001'; end if;
  select count(*) + 1 into v_n from public.inst_courriers where delegation_id = dl.id and reference is not null and extract(year from envoye_le) = extract(year from now());
  v_ref := case when dl.niveau = 'departement' then 'DDES' else 'DRES' end || '/' || to_char(now(), 'YYYY') || '/' || lpad(v_n::text, 4, '0');
  update public.inst_courriers set statut = 'envoye', envoye_le = now(), reference = v_ref, maj_le = now() where id = c.id;
  foreach x in array v_cibles loop
    if dl.niveau = 'departement' then
      insert into public.inst_courrier_destinataires (courrier_id, etablissement_id) values (c.id, x);
      perform public._inst_notifier(x, null, 'courrier', 'Courrier reçu : ' || c.objet, dl.nom || ' — réf. ' || v_ref, '/courriers-institutionnels', c.id);
    else
      insert into public.inst_courrier_destinataires (courrier_id, delegation_id) values (c.id, x);
      perform public._inst_notifier(null, x, 'courrier', 'Courrier reçu : ' || c.objet, dl.nom || ' — réf. ' || v_ref, '/institution/courriers', c.id);
    end if;
  end loop;
  perform public._inst_journaliser('courrier envoyé', 'inst_courrier', c.id, jsonb_build_object('reference', v_ref, 'destinataires', cardinality(v_cibles)));
  return jsonb_build_object('reference', v_ref, 'destinataires', cardinality(v_cibles));
end $$;

create or replace function public._inst_courrier_json(c public.inst_courriers) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'reference', c.reference, 'type', c.type, 'type_libelle', (select libelle from public.inst_courrier_types where code = c.type),
           'objet', c.objet, 'corps', c.corps, 'date_limite', c.date_limite, 'pieces', c.pieces, 'auteur', c.auteur_nom, 'fonction', c.fonction,
           'statut', c.statut, 'envoye_le', c.envoye_le, 'cree_le', c.cree_le,
           'expediteur', (select jsonb_build_object('nom', d.nom, 'niveau', d.niveau, 'region', r.nom, 'departement', dp.nom)
                            from public.inst_delegations d join public.inst_regions r on r.id = d.region_id left join public.inst_departements dp on dp.id = d.departement_id where d.id = c.delegation_id))
$$;

/** Courriers envoyés par ma délégation, avec suivi des destinataires et réponses. */
create or replace function public.inst_courriers_envoyes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger();
begin
  return (select coalesce(jsonb_agg(public._inst_courrier_json(c) || jsonb_build_object(
            'destinataires', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'nom', coalesce(e.nom, dd.nom), 'statut', d.statut, 'lu_le', d.lu_le,
                                'reponses', (select coalesce(jsonb_agg(jsonb_build_object('auteur', r.auteur_nom, 'texte', r.texte, 'pieces', r.pieces, 'le', r.le) order by r.le), '[]'::jsonb)
                                               from public.inst_courrier_reponses r where r.destinataire_id = d.id)) order by coalesce(e.nom, dd.nom)), '[]'::jsonb)
                                from public.inst_courrier_destinataires d left join public.etablissements e on e.id = d.etablissement_id
                                left join public.inst_delegations dd on dd.id = d.delegation_id where d.courrier_id = c.id)) order by c.cree_le desc), '[]'::jsonb)
    from public.inst_courriers c where c.delegation_id = m.delegation_id);
end $$;

/** Courriers reçus (établissement ou délégation départementale). */
create or replace function public.inst_courriers_recus() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_moi(); v_etab uuid;
begin
  if m.id is null then v_etab := public._exiger_admin(); end if;
  return (select coalesce(jsonb_agg(public._inst_courrier_json(c) || jsonb_build_object('destinataire_id', d.id, 'statut_reception', d.statut, 'lu_le', d.lu_le,
            'reponses', (select coalesce(jsonb_agg(jsonb_build_object('auteur', r.auteur_nom, 'texte', r.texte, 'pieces', r.pieces, 'le', r.le) order by r.le), '[]'::jsonb)
                           from public.inst_courrier_reponses r where r.destinataire_id = d.id)) order by c.envoye_le desc), '[]'::jsonb)
    from public.inst_courrier_destinataires d join public.inst_courriers c on c.id = d.courrier_id
   where (m.id is not null and d.delegation_id = m.delegation_id) or (m.id is null and d.etablissement_id = v_etab));
end $$;

create or replace function public._inst_mon_destinataire(p_destinataire uuid) returns public.inst_courrier_destinataires
language plpgsql stable security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_moi(); d public.inst_courrier_destinataires;
begin
  select * into d from public.inst_courrier_destinataires where id = p_destinataire;
  if d.id is null or not ((m.id is not null and d.delegation_id = m.delegation_id)
                          or (m.id is null and d.etablissement_id is not null and public.est_admin() and d.etablissement_id = public.etab_courant())) then
    raise exception 'Courrier introuvable.' using errcode = '42501';
  end if;
  return d;
end $$;

create or replace function public.inst_courrier_lu(p_destinataire uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare d public.inst_courrier_destinataires := public._inst_mon_destinataire(p_destinataire);
begin
  if d.lu_le is null then
    update public.inst_courrier_destinataires set lu_le = now(), lu_par = auth.uid(), statut = case when statut = 'distribue' then 'lu' else statut end where id = d.id;
    perform public._inst_journaliser('courrier lu', 'inst_courrier', d.courrier_id, jsonb_build_object('destinataire', d.id));
  end if;
end $$;

create or replace function public.inst_courrier_repondre(p_destinataire uuid, p_texte text, p_pieces text[] default '{}') returns void
language plpgsql volatile security definer set search_path = '' as $$
declare d public.inst_courrier_destinataires := public._inst_mon_destinataire(p_destinataire); m public.inst_membres := public._inst_moi(); c public.inst_courriers; v_nom text;
begin
  if m.id is not null and m.role <> 'titulaire' and not ('courriers' = any (m.permissions)) then raise exception 'Action non autorisée pour votre profil.' using errcode = '42501'; end if;
  perform public._inst_pieces_valides(p_pieces, 'reponses/' || coalesce(d.etablissement_id, d.delegation_id)::text || '/');
  select * into c from public.inst_courriers where id = d.courrier_id;
  v_nom := coalesce(public._inst_nom_membre(), (select btrim(nom || ' ' || prenom) from public.personnels where id = auth.uid()) || ' — ' || (select nom from public.etablissements where id = d.etablissement_id), '');
  insert into public.inst_courrier_reponses (destinataire_id, auteur, auteur_nom, texte, pieces) values (d.id, auth.uid(), v_nom, btrim(p_texte), coalesce(p_pieces, '{}'));
  update public.inst_courrier_destinataires set statut = 'repondu', lu_le = coalesce(lu_le, now()) where id = d.id;
  perform public._inst_notifier(null, c.delegation_id, 'reponse', 'Réponse reçue : ' || c.objet, left(v_nom, 200) || ' — réf. ' || c.reference, '/institution/courriers', c.id);
  perform public._inst_journaliser('réponse à un courrier', 'inst_courrier', c.id, jsonb_build_object('destinataire', d.id));
end $$;

create or replace function public.inst_courrier_archiver(p_courrier uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_moi(); v_etab uuid;
begin
  if m.id is not null then
    if m.role <> 'titulaire' and not ('courriers' = any (m.permissions)) then raise exception 'Action non autorisée pour votre profil.' using errcode = '42501'; end if;
    update public.inst_courriers set statut = 'archive', maj_le = now() where id = p_courrier and delegation_id = m.delegation_id and statut = 'envoye';
    if found then return; end if;
    update public.inst_courrier_destinataires set statut = 'archive' where courrier_id = p_courrier and delegation_id = m.delegation_id;
  else
    v_etab := public._exiger_admin();
    update public.inst_courrier_destinataires set statut = 'archive' where courrier_id = p_courrier and etablissement_id = v_etab;
  end if;
  if not found then raise exception 'Courrier introuvable.' using errcode = 'P0001'; end if;
end $$;

create or replace function public.inst_courrier_types_lire() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'libelle', libelle) order by ordre), '[]'::jsonb) from public.inst_courrier_types where actif and auth.uid() is not null
$$;

/** Destinataires possibles (périmètre vérifié) pour la rédaction d'un courrier ou une relance. */
create or replace function public.inst_perimetre() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger(); dl public.inst_delegations;
begin
  select * into dl from public.inst_delegations where id = m.delegation_id;
  if dl.niveau = 'departement' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'nom', e.nom, 'ville', e.ville, 'rattachement', e.rattachement_statut) order by e.nom), '[]'::jsonb)
              from public.etablissements e where e.departement_id = dl.departement_id and e.rattachement_statut in ('declare', 'verifie'));
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'nom', d.nom, 'departement', dp.nom, 'actif', d.actif) order by dp.nom), '[]'::jsonb)
            from public.inst_delegations d join public.inst_departements dp on dp.id = d.departement_id where d.niveau = 'departement' and dp.region_id = dl.region_id);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 15. Stockage privé « institution » : demandes/<compte>/…, courriers/<délégation>/…, reponses/<établissement|délégation>/…
-- ---------------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('institution', 'institution', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

create or replace function public._inst_piece_deposable(p_nom text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare d text[] := string_to_array(p_nom, '/'); m public.inst_membres := public._inst_moi();
begin
  if cardinality(d) <> 3 or p_nom like '%..%' then return false; end if;
  if d[1] = 'demandes' then return d[2] = auth.uid()::text; end if;
  if d[1] = 'courriers' then return m.id is not null and d[2] = m.delegation_id::text and (m.role = 'titulaire' or 'courriers' = any (m.permissions)); end if;
  if d[1] = 'reponses' then
    return (m.id is not null and d[2] = m.delegation_id::text) or (m.id is null and public.est_admin() and d[2] = public.etab_courant()::text);
  end if;
  return false;
end $$;

create or replace function public._inst_piece_lisible(p_nom text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare d text[] := string_to_array(p_nom, '/'); m public.inst_membres := public._inst_moi(); v_etab uuid := case when public.est_admin() then public.etab_courant() end;
begin
  if public._inst_piece_deposable(p_nom) then return true; end if;
  if d[1] = 'demandes' then return public.est_proprietaire(); end if;
  if d[1] = 'courriers' then
    return exists (select 1 from public.inst_courriers c join public.inst_courrier_destinataires x on x.courrier_id = c.id
                    where p_nom = any (c.pieces) and c.statut <> 'brouillon'
                      and ((m.id is not null and x.delegation_id = m.delegation_id) or (m.id is null and x.etablissement_id = v_etab)));
  end if;
  if d[1] = 'reponses' then
    return m.id is not null and exists (select 1 from public.inst_courrier_reponses r join public.inst_courrier_destinataires x on x.id = r.destinataire_id
                    join public.inst_courriers c on c.id = x.courrier_id where p_nom = any (r.pieces) and c.delegation_id = m.delegation_id);
  end if;
  return false;
end $$;

create policy "institution : dépôt" on storage.objects for insert to authenticated
  with check (bucket_id = 'institution' and (select public._inst_piece_deposable(name)));
create policy "institution : lecture" on storage.objects for select to authenticated
  using (bucket_id = 'institution' and (select public._inst_piece_lisible(name)));

-- ---------------------------------------------------------------------------------------------------------
-- 16. Console : campagnes, formules, appréciations, journal, dérogations
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.console_inst_campagne(p jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_al smallint[];
begin
  perform public._exiger_proprietaire();
  select coalesce(array_agg(x::smallint order by x::smallint desc), array[7, 3, 1, 0, -1]::smallint[]) into v_al
    from jsonb_array_elements_text(coalesce(p -> 'alertes_jours', '[7, 3, 1, 0, -1]')) x where x ~ '^-?[0-9]{1,3}$';
  if v_id is null then
    insert into public.inst_campagnes (niveau, exercice_libelle, periode, ouverture, echeance, prolongation, ouvert, alertes_jours)
    values (p ->> 'niveau', p ->> 'exercice', p ->> 'periode', (p ->> 'ouverture')::date, (p ->> 'echeance')::date, nullif(p ->> 'prolongation', '')::date,
            coalesce((p ->> 'ouvert')::boolean, true), v_al) returning id into v_id;
  else
    update public.inst_campagnes set ouverture = (p ->> 'ouverture')::date, echeance = (p ->> 'echeance')::date, prolongation = nullif(p ->> 'prolongation', '')::date,
           ouvert = coalesce((p ->> 'ouvert')::boolean, ouvert), alertes_jours = v_al where id = v_id;
    if not found then raise exception 'Campagne introuvable.' using errcode = 'P0001'; end if;
  end if;
  perform public._inst_journaliser('campagne', 'inst_campagne', v_id, p);
  return v_id;
end $$;

create or replace function public.console_inst_parametres(p jsonb default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public._exiger_proprietaire();
  if p is not null then
    update public.inst_parametres set inclure_digitalise = coalesce((p ->> 'inclure_digitalise')::boolean, inclure_digitalise),
           formules_validees = coalesce((p ->> 'formules_validees')::boolean, formules_validees), note = coalesce(p ->> 'note', note),
           maj_par = auth.uid(), maj_le = now() where id = 1;
    perform public._inst_journaliser('paramètres des formules', 'inst_parametres', null, p);
  end if;
  return jsonb_build_object('parametres', (select to_jsonb(x) - 'id' from public.inst_parametres x where id = 1),
    'campagnes', (select coalesce(jsonb_agg(public._inst_campagne_json(c) order by c.exercice_libelle desc, c.niveau, c.periode), '[]'::jsonb) from public.inst_campagnes c),
    'derogations', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'delegation', d.nom, 'etablissement', e.nom, 'departement', dp.nom, 'motif', g.motif,
                      'debut', g.debut, 'fin', g.fin, 'revoquee_le', g.revoquee_le) order by g.cree_le desc), '[]'::jsonb)
                     from public.inst_derogations g join public.inst_delegations d on d.id = g.delegation_id left join public.etablissements e on e.id = g.etablissement_id
                     left join public.inst_departements dp on dp.id = g.departement_id));
end $$;

create or replace function public.console_inst_journal(p_limite integer default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exiger_proprietaire();
  return (select coalesce(jsonb_agg(jsonb_build_object('le', j.le, 'auteur', coalesce(u.email, ''), 'action', j.action, 'objet', j.objet, 'objet_id', j.objet_id,
            'resultat', j.resultat, 'details', j.details) order by j.le desc), '[]'::jsonb)
    from (select * from public.inst_journal order by le desc limit least(greatest(coalesce(p_limite, 200), 1), 1000)) j left join auth.users u on u.id = j.auteur);
end $$;

/** Journal de ma délégation (traçabilité visible par le titulaire). */
create or replace function public.inst_journal_delegation() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger();
begin
  if m.role <> 'titulaire' then raise exception 'Réservé au titulaire.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('le', j.le, 'action', j.action, 'objet', j.objet, 'resultat', j.resultat) order by j.le desc), '[]'::jsonb)
    from (select * from public.inst_journal j where j.auteur in (select user_id from public.inst_membres where delegation_id = m.delegation_id)
            order by le desc limit 300) j);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 17. IA & API des délégations (MCP) : lecture seule, périmètre strict, catégories de données configurables
-- ---------------------------------------------------------------------------------------------------------
create table public.inst_acces_ia (
  id uuid primary key default gen_random_uuid(),
  membre_id uuid not null references public.inst_membres (id) on delete cascade,
  delegation_id uuid not null references public.inst_delegations (id),
  libelle text not null default '' check (char_length(libelle) <= 80),
  acces_hash text not null unique,
  apercu text not null,
  cree_le timestamptz not null default now(),
  expire_le timestamptz not null default now() + interval '365 days',
  revoque_le timestamptz,
  dernier_usage timestamptz
);
alter table public.inst_acces_ia enable row level security;
revoke all on public.inst_acces_ia from anon, authenticated;

create or replace function public.inst_ia_creer_cle(p_libelle text default '') returns text
language plpgsql volatile security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger(); v_cle text;
begin
  if (select count(*) from public.inst_acces_ia where membre_id = m.id and revoque_le is null and expire_le > now()) >= 5 then
    raise exception 'Cinq clés actives au maximum : révoquez-en une.' using errcode = 'P0001';
  end if;
  v_cle := 'nxd_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.inst_acces_ia (membre_id, delegation_id, libelle, acces_hash, apercu)
  values (m.id, m.delegation_id, left(btrim(coalesce(p_libelle, '')), 80), encode(extensions.digest(v_cle, 'sha256'), 'hex'), left(v_cle, 8) || '…' || right(v_cle, 4));
  perform public._inst_journaliser('clé IA créée', 'inst_delegation', m.delegation_id, '{}');
  return v_cle;
end $$;

create or replace function public.inst_ia_cles() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger();
begin
  return jsonb_build_object('categories', (select ia_categories from public.inst_delegations where id = m.delegation_id),
    'cles', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'libelle', a.libelle, 'apercu', a.apercu, 'cree_le', a.cree_le, 'expire_le', a.expire_le,
                'revoque_le', a.revoque_le, 'dernier_usage', a.dernier_usage) order by a.cree_le desc), '[]'::jsonb) from public.inst_acces_ia a where a.membre_id = m.id),
    'appels', (select coalesce(jsonb_agg(jsonb_build_object('le', j.le, 'outil', j.details ->> 'outil', 'resultat', j.resultat) order by j.le desc), '[]'::jsonb)
                 from (select * from public.inst_journal where objet = 'mcp' and objet_id = m.delegation_id order by le desc limit 50) j));
end $$;

create or replace function public.inst_ia_revoquer(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger();
begin
  update public.inst_acces_ia set revoque_le = now() where id = p_id and membre_id = m.id and revoque_le is null;
  if not found then raise exception 'Clé introuvable.' using errcode = 'P0001'; end if;
  perform public._inst_journaliser('clé IA révoquée', 'inst_delegation', m.delegation_id, '{}');
end $$;

/** Point d'entrée unique de l'API des délégations (appelé par la fonction mcp avec la clé nxd_). Lecture seule. */
create or replace function public.api_institution(p_cle text, p_outil text, p_args jsonb default '{}') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare a public.inst_acces_ia; m public.inst_membres; dl public.inst_delegations; c public.inst_campagnes; v_res jsonb; v_cat text[];
        v_campagnes jsonb; v_niveau_fiches text;
begin
  if p_cle is null or p_cle !~ '^nxd_[0-9a-f]{48}$' then raise exception 'Clé invalide.' using errcode = '42501'; end if;
  select * into a from public.inst_acces_ia where acces_hash = encode(extensions.digest(p_cle, 'sha256'), 'hex');
  if a.id is null or a.revoque_le is not null or a.expire_le < now() then raise exception 'Clé invalide, expirée ou révoquée.' using errcode = '42501'; end if;
  select * into m from public.inst_membres where id = a.membre_id;
  select * into dl from public.inst_delegations where id = a.delegation_id;
  if not m.actif or not dl.actif or m.delegation_id <> dl.id then raise exception 'Compte de délégation inactif.' using errcode = '42501'; end if;
  if (select count(*) from public.inst_journal where objet = 'mcp' and objet_id = dl.id and le > now() - interval '1 hour') >= 300 then
    raise exception 'Trop de requêtes : réessayez dans une heure.' using errcode = 'P0001';
  end if;
  v_cat := dl.ia_categories;
  update public.inst_acces_ia set dernier_usage = now() where id = a.id;
  v_niveau_fiches := case when dl.niveau = 'departement' then 'etablissement' else 'departement' end;
  if nullif(p_args ->> 'campagne_id', '') is not null then
    select * into c from public.inst_campagnes where id = (p_args ->> 'campagne_id')::uuid and niveau = v_niveau_fiches;
  elsif nullif(p_args ->> 'periode', '') is not null then
    select * into c from public.inst_campagnes where niveau = v_niveau_fiches and periode = p_args ->> 'periode'
       and (nullif(p_args ->> 'annee_scolaire', '') is null or exercice_libelle = p_args ->> 'annee_scolaire') order by exercice_libelle desc limit 1;
  else
    select * into c from public.inst_campagnes where niveau = v_niveau_fiches and ouverture <= public._aujourdhui() order by ouverture desc limit 1;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'annee_scolaire', x.exercice_libelle, 'periode', x.periode, 'echeance', public._inst_echeance(x))
           order by x.exercice_libelle desc, x.periode desc), '[]'::jsonb) into v_campagnes from public.inst_campagnes x where x.niveau = v_niveau_fiches;

  if p_outil = 'contexte' then
    v_res := jsonb_build_object('delegation', dl.nom, 'niveau', dl.niveau, 'categories_autorisees', v_cat, 'campagnes', v_campagnes,
      'avertissement', 'Données transmises dans NexIA School ; NexIA School n''est pas un service officiel du MINESEC. Lecture seule.');
  elsif c.id is null then
    raise exception 'Aucune campagne correspondante.' using errcode = 'P0001';
  elsif p_outil = 'tableau_de_bord' then
    if not ('statuts' = any (v_cat)) then raise exception 'Catégorie « statuts » non autorisée pour cette délégation.' using errcode = '42501'; end if;
    perform set_config('request.jwt.claim.sub', m.user_id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', m.user_id::text, 'role', 'authenticated')::text, true);
    v_res := case when dl.niveau = 'departement' then public.inst_tableau_departement(c.id) else public.inst_tableau_region(c.id) end;
    v_res := v_res - 'etablissements' - 'departements' || jsonb_build_object('liste',
      (select coalesce(jsonb_agg(jsonb_build_object('nom', coalesce(x ->> 'nom', x ->> 'departement'), 'statut', x ->> 'statut', 'en_retard', x -> 'en_retard',
         'publie_le', coalesce(x -> 'derniere_publication', x -> 'publie_le'))), '[]'::jsonb)
         from jsonb_array_elements(coalesce(v_res -> 'etablissements', v_res -> 'departements')) x));
  elsif p_outil = 'consolidation' then
    if not ('indicateurs' = any (v_cat)) then raise exception 'Catégorie « indicateurs » non autorisée pour cette délégation.' using errcode = '42501'; end if;
    perform set_config('request.jwt.claim.sub', m.user_id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', m.user_id::text, 'role', 'authenticated')::text, true);
    v_res := public.inst_consolidation(c.id);
    if not ('detail_lignes' = any (v_cat)) then v_res := v_res - 'detail' - 'par_discipline'; else
      v_res := jsonb_set(v_res, '{detail}', (select coalesce(jsonb_agg(x - 'fiche_id'), '[]'::jsonb) from jsonb_array_elements(v_res -> 'detail') x));
    end if;
  elsif p_outil = 'detail_fiche' then
    if not ('detail_lignes' = any (v_cat)) then raise exception 'Catégorie « détail des lignes » non autorisée pour cette délégation.' using errcode = '42501'; end if;
    select jsonb_build_object('etablissement', coalesce(e.nom, d2.nom), 'version', v.version, 'publie_le', v.publie_le,
             'indicateurs', case when 'indicateurs' = any (v_cat) then v.indicateurs end,
             'lignes', case when 'noms_enseignants' = any (v_cat) then v.donnees -> 'lignes'
                            else (select coalesce(jsonb_agg(l - 'enseignant'), '[]'::jsonb) from jsonb_array_elements(v.donnees -> 'lignes') l) end)
      into v_res
      from public.inst_fiches f join lateral (select * from public.inst_fiche_versions where fiche_id = f.id and destinataire_id = dl.id order by version desc limit 1) v on true
      left join public.etablissements e on e.id = f.etablissement_id left join public.inst_delegations d2 on d2.id = f.delegation_id
     where f.campagne_id = c.id and (coalesce(e.nom, d2.nom) ilike '%' || coalesce(p_args ->> 'nom', '') || '%') limit 1;
    if v_res is null then raise exception 'Aucune fiche reçue correspondant à ce nom.' using errcode = 'P0001'; end if;
  elsif p_outil = 'courriers' then
    if not ('courriers' = any (v_cat)) then raise exception 'Catégorie « courriers » non autorisée pour cette délégation.' using errcode = '42501'; end if;
    v_res := jsonb_build_object('courriers', (select coalesce(jsonb_agg(jsonb_build_object('reference', k.reference, 'objet', k.objet, 'type', k.type, 'envoye_le', k.envoye_le,
               'date_limite', k.date_limite, 'destinataires', (select count(*) from public.inst_courrier_destinataires where courrier_id = k.id),
               'lus', (select count(*) from public.inst_courrier_destinataires where courrier_id = k.id and lu_le is not null),
               'reponses', (select count(*) from public.inst_courrier_destinataires where courrier_id = k.id and statut = 'repondu')) order by k.envoye_le desc), '[]'::jsonb)
             from (select * from public.inst_courriers where delegation_id = dl.id and statut <> 'brouillon' order by envoye_le desc limit 50) k));
  else
    raise exception 'Outil inconnu.' using errcode = 'P0001';
  end if;
  insert into public.inst_journal (auteur, action, objet, objet_id, details) values (m.user_id, 'appel MCP', 'mcp', dl.id, jsonb_build_object('outil', p_outil, 'campagne', c.id));
  return jsonb_build_object('perimetre', dl.nom, 'periode', case when c.id is not null then upper(c.periode) || ' ' || c.exercice_libelle end,
    'campagne_id', c.id, 'nb_fiches_utilisees', coalesce(v_res -> 'nb_fiches', v_res -> 'compteurs' -> 'publiees', v_res -> 'compteurs' -> 'recues'),
    'lecture_seule', true, 'donnees', v_res);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 18. Alertes quotidiennes (appelées par le travailleur de maintenance ; idempotentes grâce à la clé unique)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.inst_alertes_quotidiennes() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare c public.inst_campagnes; v_j integer; v_avant bigint; v_titre text; r record;
begin
  -- appelable avec la clé publique par le travailleur : un seul passage par jour, les appels suivants ne font rien
  update public.inst_parametres set alertes_le = public._aujourdhui() where id = 1 and alertes_le is distinct from public._aujourdhui();
  if not found then return 0; end if;
  select count(*) into v_avant from public.inst_notifications;
  for c in select * from public.inst_campagnes where ouvert and niveau in ('etablissement', 'departement') loop
    v_j := public._inst_echeance(c) - public._aujourdhui();
    if public._aujourdhui() = c.ouverture then v_titre := 'Ouverture de la campagne';
    elsif v_j = any (c.alertes_jours) then
      v_titre := case when v_j > 1 then 'Échéance dans ' || v_j || ' jours' when v_j = 1 then 'Échéance demain' when v_j = 0 then 'Échéance aujourd''hui'
                      else 'Échéance dépassée' end;
    else continue;
    end if;
    if public._aujourdhui() < c.ouverture then continue; end if;
    if c.niveau = 'etablissement' then
      for r in select e.id from public.etablissements e
                where e.rattachement_statut = 'verifie' and public._inst_delegation_etablissement(e.id) is not null
                  and not exists (select 1 from public.inst_fiches f where f.etablissement_id = e.id and f.campagne_id = c.id and f.version_courante > 0) loop
        perform public._inst_notifier(r.id, null, 'alerte', v_titre || ' : fiche statistique ' || upper(c.periode) || ' ' || c.exercice_libelle,
          'Échéance : ' || to_char(public._inst_echeance(c), 'DD/MM/YYYY'), '/fiches-statistiques', c.id, 'alerte:' || c.id || ':' || r.id || ':' || public._aujourdhui());
      end loop;
      if v_j = -1 then
        for r in select d.id, count(e.id) n from public.inst_delegations d join public.etablissements e on e.departement_id = d.departement_id and e.rattachement_statut = 'verifie'
                  where d.niveau = 'departement' and d.actif
                    and not exists (select 1 from public.inst_fiches f where f.etablissement_id = e.id and f.campagne_id = c.id and f.version_courante > 0)
                  group by d.id loop
          perform public._inst_notifier(null, r.id, 'retard', r.n || ' établissement(s) en retard : ' || upper(c.periode) || ' ' || c.exercice_libelle, '',
            '/institution/retards', c.id, 'retard:' || c.id || ':' || r.id);
        end loop;
      end if;
    else
      for r in select d.id from public.inst_delegations d where d.niveau = 'departement' and d.actif
                  and exists (select 1 from public.inst_membres mm where mm.delegation_id = d.id and mm.role = 'titulaire' and mm.actif)
                  and not exists (select 1 from public.inst_fiches f where f.delegation_id = d.id and f.campagne_id = c.id and f.version_courante > 0) loop
        perform public._inst_notifier(null, r.id, 'alerte', v_titre || ' : synthèse départementale ' || upper(c.periode) || ' ' || c.exercice_libelle,
          'Échéance : ' || to_char(public._inst_echeance(c), 'DD/MM/YYYY'), '/institution/synthese', c.id, 'alerte:' || c.id || ':' || r.id || ':' || public._aujourdhui());
      end loop;
    end if;
  end loop;
  return (select count(*) from public.inst_notifications) - v_avant;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 19. Droits d'exécution : rien pour le public ; fonctions internes (préfixe _) jamais exposées
-- ---------------------------------------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'inst\_%' or p.proname like '\_inst\_%' or p.proname like 'console\_inst\_%'
                  or p.proname like 'etablissement\_localisation%' or p.proname = 'api_institution') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname not like '\_%' then execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
grant execute on function public.api_institution(text, text, jsonb) to anon;
grant execute on function public.inst_alertes_quotidiennes() to anon;
grant execute on function public._inst_piece_deposable(text) to authenticated;
grant execute on function public._inst_piece_lisible(text) to authenticated;
