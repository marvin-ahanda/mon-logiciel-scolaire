-- PV et rapports (rubrique Notes) : un moteur unique pour quatre documents, générés à la demande par l'administration.
--   * PV de classe (notes brutes par matière, sans calcul obligatoire des moyennes) ;
--   * PV par cycle (performances, pourcentages, comparaisons) ;
--   * PV général de l'établissement (vision globale de la direction) ;
--   * PV de performances individuelles (un élève), publiable dans l'espace des parents.
-- Les calculs se font dans l'application à partir des données déjà protégées par la sécurité des lignes (notes, absences,
-- finances) ; la base tient le registre des documents (numéro unique, périmètre, commentaire), les réglages de
-- l'établissement, les commentaires des PV individuels et les copies figées publiées aux parents (un parent ne reçoit que
-- celle de son enfant).

-- ---------------------------------------------------------------------------------------------------------
-- Fonctionnalité réglable par établissement (comprise dans toutes les offres)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._fonctions_reglables() returns text[]
language sql immutable set search_path = '' as $$
  select array['notes', 'appel', 'bulletins', 'excel_base', 'plafonds',
               'discipline', 'finances', 'decisions', 'qr', 'excel', 'smarteval', 'edt', 'parents', 'statistiques', 'ia',
               'distinctions', 'cartes', 'parcours', 'pv']
$$;

create or replace function public.offre_requise(p_fonction text) returns text
language sql immutable set search_path = '' as $$
  select case p_fonction
    when 'notes'      then 'decouverte'
    when 'appel'      then 'decouverte'
    when 'bulletins'  then 'decouverte'
    when 'excel_base' then 'decouverte'
    when 'plafonds'   then 'pro'           -- effectifs illimités (élèves et personnel)
    when 'discipline' then 'essentiel'
    when 'finances'   then 'essentiel'
    when 'decisions'  then 'essentiel'
    when 'qr'         then 'essentiel'
    when 'excel'      then 'essentiel'
    when 'smarteval'  then 'pro'
    when 'edt'        then 'pro'
    when 'parents'    then 'pro'
    when 'statistiques' then 'pro'
    when 'ia'         then 'premium'
    when 'distinctions' then 'decouverte'  -- récompenses et distinctions : toutes les offres
    when 'cartes'     then 'decouverte'    -- cartes scolaires : toutes les offres
    when 'parcours'   then 'decouverte'    -- parcours, séries et orientation : toutes les offres
    when 'pv'         then 'decouverte'    -- PV et rapports : toutes les offres
    else 'premium' end
$$;

create or replace function public._pv_admin() returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin();
begin
  perform public._exiger_offre(v_etab, 'pv');
  return v_etab;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Réglages de l'établissement (seuils, signataires, options de confidentialité)
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.pv_reglages (
  etablissement_id uuid primary key default public.etab_courant() references public.etablissements (id) on delete cascade,
  seuil_reussite numeric(4, 2) not null default 10 check (seuil_reussite between 0 and 20),       -- note ou moyenne de réussite
  seuil_difficulte numeric(4, 2) not null default 8 check (seuil_difficulte between 0 and 20),    -- moyenne sous laquelle l'élève est en difficulté
  part_echecs smallint not null default 50 check (part_echecs between 1 and 100),                 -- PV sans moyennes : % de matières sous le seuil
  baisse_alerte numeric(4, 2) not null default 2 check (baisse_alerte between 0 and 20),          -- baisse (points) qui déclenche une alerte
  signataires jsonb not null default '[]'::jsonb,                                                -- intitulés des emplacements de signature
  afficher_cachet boolean not null default true,
  comparer_cycle boolean not null default false,                                                 -- PV individuels : moyenne du cycle affichée
  repartition_sexe boolean not null default true,                                                -- PV par cycle et général : filles / garçons
  maj timestamptz not null default now(),
  maj_par uuid references public.personnels (id) on delete set null,
  check (jsonb_typeof(signataires) = 'array' and jsonb_array_length(signataires) <= 6)
);

-- ---------------------------------------------------------------------------------------------------------
-- Registre des documents générés (numéro unique, périmètre, commentaire de la direction)
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.pv_documents (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  exercice_id uuid references public.exercices (id) on delete set null,
  type text not null check (type in ('classe', 'cycle', 'etablissement', 'individuel', 'publication')),
  numero integer not null,
  reference text not null,
  titre text not null check (char_length(btrim(titre)) between 1 and 200),
  perimetre jsonb not null default '{}'::jsonb check (jsonb_typeof(perimetre) = 'object'),
  format text not null default 'pdf' check (format in ('pdf', 'xlsx', 'csv', 'publication')),
  partiel boolean not null default false,
  avertissements jsonb not null default '[]'::jsonb check (jsonb_typeof(avertissements) = 'array'),
  commentaire text not null default '' check (char_length(commentaire) <= 8000),
  genere_le timestamptz not null default now(),
  genere_par uuid references public.personnels (id) on delete set null,
  genere_par_nom text not null default '',
  unique (etablissement_id, numero),
  unique (etablissement_id, reference)
);
create index if not exists pv_documents_etab on public.pv_documents (etablissement_id, genere_le desc);

-- ---------------------------------------------------------------------------------------------------------
-- PV individuels : commentaires (enseignant, direction, administration) et copies publiées aux parents
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.pv_commentaires (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  inscription_id uuid not null references public.inscriptions (id) on delete cascade,
  periode text not null check (periode ~ '^(s[1-6]|t[1-3]|a|p:[0-9a-f-]{36})$'),
  commentaire text not null check (char_length(btrim(commentaire)) between 1 and 2000),
  auteur_id uuid references public.personnels (id) on delete set null,
  auteur text not null default '',
  fonction text not null default '',
  maj timestamptz not null default now(),
  unique (inscription_id, periode, auteur_id)              -- un commentaire par auteur : personne n'écrase celui d'un autre
);
create index if not exists pv_commentaires_etab on public.pv_commentaires (etablissement_id, periode);

create table if not exists public.pv_publications (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  exercice_id uuid not null references public.exercices (id) on delete cascade,
  periode text not null check (periode ~ '^(s[1-6]|t[1-3]|a|p:[0-9a-f-]{36})$'),
  periode_libelle text not null check (char_length(btrim(periode_libelle)) between 1 and 60),
  portee text not null default '' check (char_length(portee) <= 200),          -- « 6e A », « Premier cycle », « Tout l'établissement »
  commun jsonb not null default '{}'::jsonb,                                   -- en-tête de l'établissement, logo réduit
  document_id uuid references public.pv_documents (id) on delete set null,
  publie_le timestamptz not null default now(),
  publie_par uuid references public.personnels (id) on delete set null
);
create index if not exists pv_publications_etab on public.pv_publications (etablissement_id, publie_le desc);

create table if not exists public.pv_individuels_publies (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.pv_publications (id) on delete cascade,
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  inscription_id uuid not null references public.inscriptions (id) on delete cascade,
  eleve_id uuid not null references public.eleves (id) on delete cascade,
  periode text not null,
  contenu jsonb not null check (jsonb_typeof(contenu) = 'object'),
  publie_le timestamptz not null default now(),
  unique (inscription_id, periode)
);
create index if not exists pv_individuels_eleve on public.pv_individuels_publies (eleve_id);
create index if not exists pv_individuels_publication on public.pv_individuels_publies (publication_id);

-- Sécurité des lignes : lecture selon le rôle ; toutes les écritures passent par les fonctions ci-dessous
alter table public.pv_reglages enable row level security;
alter table public.pv_documents enable row level security;
alter table public.pv_commentaires enable row level security;
alter table public.pv_publications enable row level security;
alter table public.pv_individuels_publies enable row level security;

create policy "lecture par le personnel" on public.pv_reglages for select to authenticated
  using (etablissement_id = (select public.etab_courant()));
create policy "administration" on public.pv_documents for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));
create policy "administration ou enseignant de la classe" on public.pv_commentaires for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and ((select public.est_admin()) or exists (
    select 1 from public.inscriptions i join public.attributions a on a.classe_id = i.classe_id and a.exercice_id = i.exercice_id
     where i.id = pv_commentaires.inscription_id and a.enseignant_id = (select auth.uid()))));
create policy "administration" on public.pv_publications for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));
create policy "administration" on public.pv_individuels_publies for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));

revoke all on public.pv_reglages, public.pv_documents, public.pv_commentaires, public.pv_publications, public.pv_individuels_publies
  from anon, authenticated;
grant select on public.pv_reglages, public.pv_documents, public.pv_commentaires, public.pv_individuels_publies to authenticated;
grant select (id, etablissement_id, exercice_id, periode, periode_libelle, portee, document_id, publie_le, publie_par)
  on public.pv_publications to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Fonctions
-- ---------------------------------------------------------------------------------------------------------

/** Réglages des PV (administration). p = { seuil_reussite, seuil_difficulte, part_echecs, baisse_alerte, signataires[],
 *  afficher_cachet, comparer_cycle, repartition_sexe } ; une valeur absente garde la valeur actuelle. */
create or replace function public.pv_enregistrer_reglages(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._pv_admin(); r public.pv_reglages; s jsonb := coalesce(p->'signataires', 'null'::jsonb);
begin
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'Réglages invalides.' using errcode = '22023'; end if;
  if s <> 'null'::jsonb and (jsonb_typeof(s) <> 'array' or jsonb_array_length(s) > 6
      or exists (select 1 from jsonb_array_elements(s) x where jsonb_typeof(x) <> 'string' or char_length(btrim(x #>> '{}')) not between 1 and 60)) then
    raise exception 'Signataires : 6 intitulés au plus, de 60 caractères au plus.' using errcode = '22023';
  end if;
  insert into public.pv_reglages (etablissement_id) values (v_etab) on conflict (etablissement_id) do nothing;
  update public.pv_reglages set
    seuil_reussite = coalesce((p->>'seuil_reussite')::numeric, seuil_reussite),
    seuil_difficulte = coalesce((p->>'seuil_difficulte')::numeric, seuil_difficulte),
    part_echecs = coalesce((p->>'part_echecs')::smallint, part_echecs),
    baisse_alerte = coalesce((p->>'baisse_alerte')::numeric, baisse_alerte),
    signataires = case when s = 'null'::jsonb then signataires else (select coalesce(jsonb_agg(to_jsonb(btrim(x #>> '{}'))), '[]'::jsonb) from jsonb_array_elements(s) x) end,
    afficher_cachet = coalesce((p->>'afficher_cachet')::boolean, afficher_cachet),
    comparer_cycle = coalesce((p->>'comparer_cycle')::boolean, comparer_cycle),
    repartition_sexe = coalesce((p->>'repartition_sexe')::boolean, repartition_sexe),
    maj = now(), maj_par = auth.uid()
   where etablissement_id = v_etab returning * into r;
  return to_jsonb(r);
exception when invalid_text_representation or numeric_value_out_of_range or check_violation then
  raise exception 'Réglages invalides : vérifiez les seuils (0 à 20) et le pourcentage (1 à 100).' using errcode = '22023';
end $$;

/** Inscrit un document au registre et lui attribue son numéro unique (PV-AAAA-000001). Administration.
 *  p = { type, titre, perimetre {}, format, partiel, avertissements [], commentaire } */
create or replace function public.pv_enregistrer(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._pv_admin(); v_ex uuid; v_num int; v_ref text; v_id uuid; v_nom text;
begin
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'Document invalide.' using errcode = '22023'; end if;
  if coalesce(p->>'type', '') not in ('classe', 'cycle', 'etablissement', 'individuel', 'publication') then raise exception 'Type de PV inconnu.' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p->>'titre', ''))) not between 1 and 200 then raise exception 'Titre du PV manquant ou trop long.' using errcode = '22023'; end if;
  if char_length(coalesce(p->>'commentaire', '')) > 8000 then raise exception 'Commentaire trop long (8 000 caractères au plus).' using errcode = '22023'; end if;
  if pg_column_size(coalesce(p->'perimetre', '{}'::jsonb)) > 20000 or pg_column_size(coalesce(p->'avertissements', '[]'::jsonb)) > 20000 then
    raise exception 'Périmètre du PV trop volumineux.' using errcode = '22023';
  end if;
  select id into v_ex from public.exercices where etablissement_id = v_etab and actif;
  select public._pv_nom_personnel(auth.uid()) into v_nom;
  perform pg_advisory_xact_lock(hashtext('pv_numero:' || v_etab::text));
  select coalesce(max(numero), 0) + 1 into v_num from public.pv_documents where etablissement_id = v_etab;
  v_ref := 'PV-' || to_char(now(), 'YYYY') || '-' || lpad(v_num::text, 6, '0');
  insert into public.pv_documents (etablissement_id, exercice_id, type, numero, reference, titre, perimetre, format, partiel, avertissements,
                                   commentaire, genere_par, genere_par_nom)
  values (v_etab, v_ex, p->>'type', v_num, v_ref, btrim(p->>'titre'),
          case when jsonb_typeof(p->'perimetre') = 'object' then p->'perimetre' else '{}'::jsonb end,
          coalesce(nullif(p->>'format', ''), 'pdf'), coalesce((p->>'partiel')::boolean, false),
          case when jsonb_typeof(p->'avertissements') = 'array' then p->'avertissements' else '[]'::jsonb end,
          coalesce(p->>'commentaire', ''), auth.uid(), coalesce(v_nom, ''))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'numero', v_num, 'reference', v_ref, 'genere_le', now());
exception when check_violation then raise exception 'Format de sortie inconnu.' using errcode = '22023';
end $$;

/** Commentaire de la direction sur un document du registre. */
create or replace function public.pv_commenter(p_id uuid, p_commentaire text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._pv_admin();
begin
  if char_length(coalesce(p_commentaire, '')) > 8000 then raise exception 'Commentaire trop long (8 000 caractères au plus).' using errcode = '22023'; end if;
  update public.pv_documents set commentaire = coalesce(p_commentaire, '') where id = p_id and etablissement_id = v_etab;
  if not found then raise exception 'PV introuvable.' using errcode = 'P0001'; end if;
end $$;

/** Commentaire (le sien) du PV individuel d'un élève pour une période : administration, ou enseignant d'une matière de sa
 *  classe. Chaque auteur a son propre commentaire ; un commentaire vide efface le sien. */
create or replace function public.pv_commenter_eleve(p_inscription uuid, p_periode text, p_commentaire text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); v_role text; v_ins record; v_nom text; v_fonction text; r public.pv_commentaires;
begin
  select role into v_role from public.personnels where id = auth.uid() and actif and etablissement_id = v_etab;
  if v_role is null then raise exception 'Action non autorisée pour votre rôle.' using errcode = '42501'; end if;
  perform public._exiger_offre(v_etab, 'pv');
  select i.id, i.classe_id, i.exercice_id into v_ins from public.inscriptions i where i.id = p_inscription and i.etablissement_id = v_etab;
  if v_ins.id is null then raise exception 'Élève introuvable.' using errcode = 'P0001'; end if;
  if v_role <> 'admin' and not exists (select 1 from public.attributions a where a.classe_id = v_ins.classe_id and a.exercice_id = v_ins.exercice_id
                                                                         and a.enseignant_id = auth.uid()) then
    raise exception 'Seuls l''administration et les enseignants de la classe commentent ce PV.' using errcode = '42501';
  end if;
  if coalesce(p_periode, '') !~ '^(s[1-6]|t[1-3]|a|p:[0-9a-f-]{36})$' then raise exception 'Période invalide.' using errcode = '22023'; end if;
  if char_length(coalesce(p_commentaire, '')) > 2000 then raise exception 'Commentaire trop long (2 000 caractères au plus).' using errcode = '22023'; end if;
  if btrim(coalesce(p_commentaire, '')) = '' then
    delete from public.pv_commentaires where inscription_id = p_inscription and periode = p_periode and auteur_id = auth.uid();
    return null;
  end if;
  select public._pv_nom_personnel(auth.uid()) into v_nom;
  v_fonction := case v_role when 'admin' then 'Administration' when 'enseignant' then 'Enseignant' else '' end;
  insert into public.pv_commentaires (etablissement_id, inscription_id, periode, commentaire, auteur_id, auteur, fonction)
  values (v_etab, p_inscription, p_periode, btrim(p_commentaire), auth.uid(), coalesce(v_nom, ''), v_fonction)
  on conflict (inscription_id, periode, auteur_id) do update set commentaire = excluded.commentaire,
    auteur = excluded.auteur, fonction = excluded.fonction, maj = now()
  returning * into r;
  return to_jsonb(r);
end $$;

/** Publication des PV individuels aux parents (copies figées). Administration.
 *  p = { periode, periode_libelle, portee, commun {}, document_id, pv: [{ inscription_id, contenu }] }
 *  Une nouvelle publication remplace, élève par élève, la précédente de la même période. */
create or replace function public.pv_publier(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._pv_admin(); v_ex uuid; v_pub uuid; n int := 0; x jsonb; v_ins record; v_doc uuid := nullif(p->>'document_id', '')::uuid;
begin
  select id into v_ex from public.exercices where etablissement_id = v_etab and actif;
  if v_ex is null then raise exception 'Aucun exercice actif.' using errcode = 'P0001'; end if;
  if coalesce(p->>'periode', '') !~ '^(s[1-6]|t[1-3]|a|p:[0-9a-f-]{36})$' then raise exception 'Période invalide.' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p->>'periode_libelle', ''))) not between 1 and 60 then raise exception 'Libellé de période manquant.' using errcode = '22023'; end if;
  if jsonb_typeof(p->'pv') <> 'array' or jsonb_array_length(p->'pv') = 0 then raise exception 'Aucun PV à publier.' using errcode = 'P0001'; end if;
  if pg_column_size(p) > 20000000 then raise exception 'Publication trop volumineuse : publiez par classe.' using errcode = '22023'; end if;
  if jsonb_array_length(p->'pv') > 5000 then raise exception 'Trop de PV dans une seule publication (5 000 au plus).' using errcode = '22023'; end if;
  if pg_column_size(coalesce(p->'commun', '{}'::jsonb)) > 400000 then raise exception 'En-tête de publication trop volumineux.' using errcode = '22023'; end if;
  if v_doc is not null and not exists (select 1 from public.pv_documents where id = v_doc and etablissement_id = v_etab) then v_doc := null; end if;
  insert into public.pv_publications (etablissement_id, exercice_id, periode, periode_libelle, portee, commun, document_id, publie_par)
  values (v_etab, v_ex, p->>'periode', btrim(p->>'periode_libelle'), left(coalesce(p->>'portee', ''), 200),
          case when jsonb_typeof(p->'commun') = 'object' then p->'commun' else '{}'::jsonb end, v_doc, auth.uid())
  returning id into v_pub;
  for x in select * from jsonb_array_elements(p->'pv') loop
    select i.id, i.eleve_id, el.matricule into v_ins from public.inscriptions i join public.eleves el on el.id = i.eleve_id
     where i.id = nullif(x->>'inscription_id', '')::uuid and i.etablissement_id = v_etab and i.exercice_id = v_ex;
    if v_ins.id is null then raise exception 'Élève introuvable dans l''année en cours.' using errcode = 'P0001'; end if;
    -- garde-fou : le PV publié doit être celui de cet élève (jamais la copie d'un autre enfant)
    if x->'contenu'->'eleve'->>'matricule' is distinct from v_ins.matricule then
      raise exception 'Le PV ne correspond pas à l''élève (matricule).' using errcode = '22023';
    end if;
    if jsonb_typeof(x->'contenu') <> 'object' or pg_column_size(x->'contenu') > 200000 then raise exception 'Contenu de PV invalide.' using errcode = '22023'; end if;
    insert into public.pv_individuels_publies (publication_id, etablissement_id, inscription_id, eleve_id, periode, contenu)
    values (v_pub, v_etab, v_ins.id, v_ins.eleve_id, p->>'periode', x->'contenu')
    on conflict (inscription_id, periode) do update set publication_id = excluded.publication_id, contenu = excluded.contenu, publie_le = now();
    n := n + 1;
  end loop;
  -- publications devenues vides (toutes remplacées) : retirées
  delete from public.pv_publications pp where pp.etablissement_id = v_etab and pp.id <> v_pub
     and not exists (select 1 from public.pv_individuels_publies x where x.publication_id = pp.id);
  return jsonb_build_object('publication_id', v_pub, 'publies', n);
end $$;

/** Retire la publication des PV individuels d'une période pour les élèves donnés (les parents ne les voient plus). */
create or replace function public.pv_retirer(p_periode text, p_inscriptions uuid[]) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._pv_admin(); n int;
begin
  delete from public.pv_individuels_publies where etablissement_id = v_etab and periode = p_periode and inscription_id = any (coalesce(p_inscriptions, '{}'));
  get diagnostics n = row_count;
  delete from public.pv_publications pp where pp.etablissement_id = v_etab
     and not exists (select 1 from public.pv_individuels_publies x where x.publication_id = pp.id);
  return n;
end $$;

/** PV individuels publiés de l'enfant (toutes années), pour l'espace parents : uniquement ceux de son enfant. */
create or replace function public.parent_pv(p_session text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s record;
begin
  select * into s from public._parent_session(p_session);
  begin perform public._exiger_offre(s.etab, 'pv');            -- fonctionnalité retirée à l'établissement : rien n'est montré
  exception when others then return '[]'::jsonb; end;
  return (select coalesce(jsonb_agg(jsonb_build_object('periode', x.periode, 'periode_libelle', pp.periode_libelle, 'annee', e.libelle,
      'publie_le', x.publie_le, 'commun', pp.commun, 'contenu', x.contenu) order by x.publie_le desc), '[]'::jsonb)
    from public.pv_individuels_publies x
    join public.pv_publications pp on pp.id = x.publication_id
    join public.exercices e on e.id = pp.exercice_id
   where x.eleve_id = s.eleve and x.etablissement_id = s.etab);
end $$;

-- Nom affiché d'un personnel (auteur des documents et commentaires)
create or replace function public._pv_nom_personnel(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select btrim(upper(p.nom) || ' ' || coalesce(p.prenom, '')) from public.personnels p where p.id = p_id
$$;

-- Droits d'exécution
revoke execute on function public._pv_admin(), public._pv_nom_personnel(uuid) from public, anon, authenticated;
revoke execute on function public.pv_enregistrer_reglages(jsonb), public.pv_enregistrer(jsonb), public.pv_commenter(uuid, text),
  public.pv_commenter_eleve(uuid, text, text), public.pv_publier(jsonb), public.pv_retirer(text, uuid[]) from public, anon;
grant execute on function public.pv_enregistrer_reglages(jsonb), public.pv_enregistrer(jsonb), public.pv_commenter(uuid, text),
  public.pv_commenter_eleve(uuid, text, text), public.pv_publier(jsonb), public.pv_retirer(text, uuid[]) to authenticated;
revoke execute on function public.parent_pv(text) from public;
grant execute on function public.parent_pv(text) to anon, authenticated;
