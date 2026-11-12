-- Emploi du temps : salles de l'établissement, brouillon du parcours de génération, versions enregistrées.
--  * salles : liste réutilisable (nom, type : laboratoire, informatique, atelier…), lisible par le personnel, gérée par l'administration ;
--  * edt_brouillons : configuration en cours de saisie (une par établissement et par année scolaire), retrouvée d'un appareil à l'autre ;
--  * emplois_du_temps : versions conservées (provisoire, officielle, archivée), liées à l'année scolaire et à la période ;
--    une seule version officielle par année et par période ; publication (consultation par tout le personnel) réservée à l'administration.
-- Le serveur ne fait pas confiance au navigateur : toute version est revérifiée ici (contraintes obligatoires) avant d'être enregistrée.

-- --- Salles ----------------------------------------------------------------------------------------------------
create table if not exists public.salles (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  nom text not null check (char_length(btrim(nom)) between 1 and 60),
  type text not null default '' check (char_length(type) <= 60),
  capacite smallint check (capacite between 1 and 1000),
  cree_le timestamptz not null default now(),
  unique (etablissement_id, nom),
  unique (id, etablissement_id)
);
alter table public.salles enable row level security;
drop policy if exists "lecture" on public.salles;
drop policy if exists "ajout par l'administration" on public.salles;
drop policy if exists "modification par l'administration" on public.salles;
drop policy if exists "suppression par l'administration" on public.salles;
create policy "lecture" on public.salles for select to authenticated using (etablissement_id = (select public.etab_courant()));
create policy "ajout par l'administration" on public.salles for insert to authenticated
  with check (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));
create policy "modification par l'administration" on public.salles for update to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin())) with check (etablissement_id = (select public.etab_courant()));
create policy "suppression par l'administration" on public.salles for delete to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));
revoke all on public.salles from anon, authenticated;
grant select, insert, update, delete on public.salles to authenticated;

-- --- Brouillon et versions -----------------------------------------------------------------------------------------
create table if not exists public.edt_brouillons (
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  exercice_id uuid not null,
  donnees jsonb not null,
  etape smallint not null default 1 check (etape between 1 and 7),
  maj timestamptz not null default now(),
  maj_par uuid,
  primary key (etablissement_id, exercice_id),
  foreign key (exercice_id, etablissement_id) references public.exercices (id, etablissement_id) on delete cascade
);
create table if not exists public.emplois_du_temps (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  exercice_id uuid not null,
  periode text not null check (periode in ('annee', 't1', 't2', 't3')),
  numero integer not null check (numero >= 1),
  nom text not null check (char_length(btrim(nom)) between 1 and 100),
  statut text not null default 'provisoire' check (statut in ('provisoire', 'officiel', 'archive')),
  publie boolean not null default false,
  config jsonb not null,
  grille jsonb not null,
  bilan jsonb not null default '{}'::jsonb,
  cree_par uuid,
  cree_le timestamptz not null default now(),
  officialise_le timestamptz,
  officialise_par uuid,
  publie_le timestamptz,
  unique (etablissement_id, exercice_id, periode, numero),
  check (not publie or statut = 'officiel'),
  foreign key (exercice_id, etablissement_id) references public.exercices (id, etablissement_id) on delete cascade
);
create unique index if not exists emploi_officiel_unique on public.emplois_du_temps (etablissement_id, exercice_id, periode) where statut = 'officiel';
create index if not exists emplois_du_temps_etab on public.emplois_du_temps (etablissement_id, exercice_id);
alter table public.edt_brouillons enable row level security;
alter table public.emplois_du_temps enable row level security;
revoke all on public.edt_brouillons, public.emplois_du_temps from anon, authenticated;   -- accès par les fonctions ci-dessous uniquement

-- --- Contrôles -----------------------------------------------------------------------------------------------------
-- « 07:30 » -> 450 ; erreur si le format est invalide
create or replace function public._edt_min(p text) returns int
language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Emploi du temps refusé : heure invalide.' using errcode = 'P0001'; end if;
  return split_part(p, ':', 1)::int * 60 + split_part(p, ':', 2)::int;
end $$;

-- Liste d'entiers d'un tableau JSON (jours) ; erreur si une valeur n'est pas un jour de 1 à 7
create or replace function public._edt_jours(p jsonb) returns int[]
language plpgsql immutable set search_path = '' as $$
declare v int[];
begin
  if p is null or p = 'null'::jsonb then return '{}'; end if;
  if jsonb_typeof(p) <> 'array' or exists (select 1 from jsonb_array_elements(p) x where jsonb_typeof(x) <> 'number' or x::text !~ '^[1-7]$') then
    raise exception 'Emploi du temps refusé : jour invalide.' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct x::text::int), '{}') into v from jsonb_array_elements(p) x;
  return v;
end $$;

-- Entier facultatif d'un réglage (null si vide)
create or replace function public._edt_int(p jsonb, mini int, maxi int) returns int
language plpgsql immutable set search_path = '' as $$
declare s text := btrim(coalesce(p #>> '{}', ''));
begin
  if s = '' then return null; end if;
  if s !~ '^\d{1,4}$' or s::int < mini or s::int > maxi then raise exception 'Emploi du temps refusé : réglage numérique invalide.' using errcode = 'P0001'; end if;
  return s::int;
end $$;

/**
 * Vérifie une configuration et sa grille ; lève une exception à la première contrainte obligatoire violée.
 * Mêmes règles que le moteur (src/lib/edt/moteur.js, verifierGrille).
 */
create or replace function public._edt_valider(p_etab uuid, p_c jsonb, p_g jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_jours int[]; v_per jsonb := p_c #> '{horaires,periodes}'; v_np int; v_strict boolean;
  gen_ens jsonb := p_c #> '{generales,enseignant}'; gen_cls jsonb := p_c #> '{generales,classe}';
  v_x jsonb; v_i int; v_prec int := -1;
begin
  if jsonb_typeof(p_c) <> 'object' or jsonb_typeof(p_g) <> 'array' then raise exception 'Emploi du temps refusé : données illisibles.' using errcode = 'P0001'; end if;
  if pg_column_size(p_c) > 3000000 or jsonb_array_length(p_g) > 20000 then raise exception 'Emploi du temps refusé : données trop volumineuses.' using errcode = 'P0001'; end if;
  -- horaires
  v_jours := public._edt_jours(p_c #> '{horaires,jours}');
  if cardinality(v_jours) = 0 then raise exception 'Emploi du temps refusé : aucun jour de fonctionnement.' using errcode = 'P0001'; end if;
  if jsonb_typeof(v_per) <> 'array' or jsonb_array_length(v_per) not between 1 and 16 then raise exception 'Emploi du temps refusé : périodes de cours invalides.' using errcode = 'P0001'; end if;
  v_np := jsonb_array_length(v_per);
  for v_i in 0 .. v_np - 1 loop
    if public._edt_min(v_per -> v_i ->> 'debut') >= public._edt_min(v_per -> v_i ->> 'fin') or public._edt_min(v_per -> v_i ->> 'debut') < v_prec then
      raise exception 'Emploi du temps refusé : périodes de cours invalides.' using errcode = 'P0001';
    end if;
    v_prec := public._edt_min(v_per -> v_i ->> 'fin');
  end loop;
  if jsonb_typeof(coalesce(p_c #> '{horaires,pauses}', '[]')) <> 'array' or jsonb_array_length(coalesce(p_c #> '{horaires,pauses}', '[]')) > 30 then
    raise exception 'Emploi du temps refusé : pauses invalides.' using errcode = 'P0001';
  end if;
  for v_x in select * from jsonb_array_elements(coalesce(p_c #> '{horaires,pauses}', '[]')) loop
    if coalesce(v_x ->> 'type', '') not in ('pause', 'midi', 'interruption') or public._edt_min(v_x ->> 'debut') >= public._edt_min(v_x ->> 'fin') then
      raise exception 'Emploi du temps refusé : pauses invalides.' using errcode = 'P0001';
    end if;
    perform public._edt_jours(v_x -> 'jours');
  end loop;
  -- salles, enseignants, affectations : appartiennent à l'établissement
  if exists (select 1 from jsonb_array_elements(coalesce(p_c -> 'salles', '[]')) sl
              where not exists (select 1 from public.salles r where r.id::text = sl ->> 'id' and r.etablissement_id = p_etab)) then
    raise exception 'Emploi du temps refusé : salle inconnue.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p_c -> 'enseignants', '[]')) > 1000 or jsonb_array_length(coalesce(p_c -> 'affectations', '[]')) > 3000 then
    raise exception 'Emploi du temps refusé : données trop volumineuses.' using errcode = 'P0001';
  end if;
  if (select count(*) <> count(distinct e ->> 'cle') or bool_or(coalesce(e ->> 'cle', '') = '') from jsonb_array_elements(coalesce(p_c -> 'enseignants', '[]')) e) then
    raise exception 'Emploi du temps refusé : enseignants invalides.' using errcode = 'P0001';
  end if;
  for v_x in select * from jsonb_array_elements(coalesce(p_c -> 'enseignants', '[]')) loop
    perform public._edt_jours(v_x -> 'jours'); perform public._edt_jours(v_x -> 'jours_preferes');
    perform public._edt_int(v_x -> 'max_jour', 1, 16); perform public._edt_int(v_x -> 'max_consecutives', 1, 16); perform public._edt_int(v_x -> 'max_semaine', 1, 80);
    if nullif(v_x ->> 'personnel_id', '') is not null and not exists (select 1 from public.personnels pe where pe.id::text = v_x ->> 'personnel_id' and pe.etablissement_id = p_etab) then
      raise exception 'Emploi du temps refusé : enseignant d''un autre établissement.' using errcode = 'P0001';
    end if;
    if jsonb_typeof(coalesce(v_x -> 'creneaux', '[]')) <> 'array' then raise exception 'Emploi du temps refusé : enseignants invalides.' using errcode = 'P0001'; end if;
    perform public._edt_min(y ->> 'debut') + public._edt_min(y ->> 'fin') from jsonb_array_elements(coalesce(v_x -> 'creneaux', '[]')) y;
  end loop;
  if (select count(*) <> count(distinct a ->> 'id') from jsonb_array_elements(coalesce(p_c -> 'affectations', '[]')) a) then
    raise exception 'Emploi du temps refusé : affectations invalides.' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_c -> 'affectations', '[]')) a
              where coalesce(a ->> 'volume', '') !~ '^\d{1,2}$' or (a ->> 'volume')::int not between 1 and 40
                 or not exists (select 1 from public.classes k where k.id::text = a ->> 'classe_id' and k.etablissement_id = p_etab)
                 or not exists (select 1 from jsonb_array_elements(p_c -> 'enseignants') e where e ->> 'cle' = a ->> 'enseignant')
                 or char_length(btrim(coalesce(a ->> 'discipline', ''))) not between 1 and 100
                 or (nullif(a ->> 'matiere_id', '') is not null and not exists (select 1 from public.matieres m where m.id::text = a ->> 'matiere_id' and m.etablissement_id = p_etab))) then
    raise exception 'Emploi du temps refusé : affectations invalides.' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_each(coalesce(p_c -> 'classes', '{}')) k
              where not exists (select 1 from public.classes z where z.id::text = k.key and z.etablissement_id = p_etab)) then
    raise exception 'Emploi du temps refusé : classe d''un autre établissement.' using errcode = 'P0001';
  end if;
  perform public._edt_int(gen_ens -> 'max_jour', 1, 16), public._edt_int(gen_ens -> 'max_consecutives', 1, 16), public._edt_int(gen_cls -> 'max_jour', 1, 16),
          public._edt_int(gen_cls -> 'max_consecutives', 1, 16);
  v_strict := coalesce(gen_ens ->> 'disponibilites', 'strictes') <> 'preferences';

  -- grille : lignes lues une fois
  create temp table if not exists _edt_g (c text, j int, p int, a text, s text, ens text, disc text, salle_type text) on commit drop;
  truncate pg_temp._edt_g;
  begin
    insert into pg_temp._edt_g (c, j, p, a, s)
    select r.c, r.j, r.p, nullif(r.a, ''), nullif(r.s, '') from jsonb_to_recordset(p_g) as r(c text, j int, p int, a text, s text);
  exception when others then raise exception 'Emploi du temps refusé : grille illisible.' using errcode = 'P0001';
  end;
  update pg_temp._edt_g t set ens = af ->> 'enseignant', disc = af ->> 'discipline',
         salle_type = nullif(p_c #>> array['classes', af ->> 'classe_id', 'salles', af ->> 'discipline'], '')
    from jsonb_array_elements(p_c -> 'affectations') af where af ->> 'id' = t.a;

  if exists (select 1 from pg_temp._edt_g where c is null or j is null or p is null or not (j = any (v_jours)) or p not between 0 and v_np - 1) then
    raise exception 'Emploi du temps refusé : cours placé hors des jours ou des périodes de cours.' using errcode = 'P0001';
  end if;
  -- créneau fermé par une pause ou une interruption de ce jour
  if exists (select 1 from pg_temp._edt_g t, jsonb_array_elements(coalesce(p_c #> '{horaires,pauses}', '[]')) x
              where (jsonb_array_length(coalesce(x -> 'jours', '[]')) = 0 or (x -> 'jours') @> to_jsonb(t.j))
                and public._edt_min(v_per -> t.p ->> 'debut') < public._edt_min(x ->> 'fin') and public._edt_min(v_per -> t.p ->> 'fin') > public._edt_min(x ->> 'debut')) then
    raise exception 'Emploi du temps refusé : cours placé pendant une pause ou une interruption.' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_temp._edt_g t where coalesce(p_c #> array['classes', t.c, 'interdits'], '[]') @> to_jsonb(t.j || '-' || t.p)) then
    raise exception 'Emploi du temps refusé : cours placé sur un créneau interdit à la classe.' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_temp._edt_g group by c, j, p having count(*) > 1) then
    raise exception 'Emploi du temps refusé : deux cours en même temps dans une classe.' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_temp._edt_g t where t.a is not null and (t.ens is null
              or not exists (select 1 from jsonb_array_elements(p_c -> 'affectations') af where af ->> 'id' = t.a and af ->> 'classe_id' = t.c))) then
    raise exception 'Emploi du temps refusé : cours sans affectation dans sa classe.' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_temp._edt_g where ens is not null group by ens, j, p having count(*) > 1) then
    raise exception 'Emploi du temps refusé : un enseignant a deux cours en même temps.' using errcode = 'P0001';
  end if;
  -- disponibilités strictes des enseignants
  if v_strict and exists (
      select 1 from pg_temp._edt_g t join lateral (select e from jsonb_array_elements(p_c -> 'enseignants') e where e ->> 'cle' = t.ens) z on true
       where (jsonb_array_length(coalesce(z.e -> 'jours', '[]')) > 0 and not (z.e -> 'jours') @> to_jsonb(t.j))
          or (jsonb_array_length(coalesce(z.e -> 'creneaux', '[]')) > 0 and not exists (
                select 1 from jsonb_array_elements(z.e -> 'creneaux') y
                 where public._edt_min(y ->> 'debut') <= public._edt_min(v_per -> t.p ->> 'debut') and public._edt_min(y ->> 'fin') >= public._edt_min(v_per -> t.p ->> 'fin')))) then
    raise exception 'Emploi du temps refusé : cours placé hors des disponibilités d''un enseignant.' using errcode = 'P0001';
  end if;
  -- volumes horaires exacts
  if exists (select 1 from jsonb_array_elements(p_c -> 'affectations') af
              where (select count(*) from pg_temp._edt_g t where t.a = af ->> 'id') <> (af ->> 'volume')::int) then
    raise exception 'Emploi du temps refusé : volume horaire non respecté.' using errcode = 'P0001';
  end if;
  -- permanences : nombre exact, jours et plage autorisés
  if exists (select 1 from (select distinct t.c from pg_temp._edt_g t
                             union select k.key from jsonb_each(coalesce(p_c -> 'classes', '{}')) k
                              where coalesce(public._edt_int(k.value #> '{permanences,heures}', 0, 40), 0) > 0) z
              where (select count(*) from pg_temp._edt_g t where t.c = z.c and t.a is null)
                    <> coalesce(public._edt_int(p_c #> array['classes', z.c, 'permanences', 'heures'], 0, 40), 0)) then
    raise exception 'Emploi du temps refusé : nombre d''heures de permanence non respecté.' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_temp._edt_g t, lateral (select p_c #> array['classes', t.c, 'permanences'] pm) z
              where t.a is null and z.pm is not null
                and ((jsonb_array_length(coalesce(z.pm -> 'jours', '[]')) > 0 and not (z.pm -> 'jours') @> to_jsonb(t.j))
                  or (coalesce(z.pm ->> 'debut', '') <> '' and public._edt_min(v_per -> t.p ->> 'debut') < public._edt_min(z.pm ->> 'debut'))
                  or (coalesce(z.pm ->> 'fin', '') <> '' and public._edt_min(v_per -> t.p ->> 'fin') > public._edt_min(z.pm ->> 'fin')))) then
    raise exception 'Emploi du temps refusé : permanence placée hors de sa plage autorisée.' using errcode = 'P0001';
  end if;
  -- salles : de l'établissement, du type exigé, jamais deux cours à la fois
  if exists (select 1 from pg_temp._edt_g t where t.s is not null and not exists (select 1 from public.salles r where r.id::text = t.s and r.etablissement_id = p_etab))
     or exists (select 1 from pg_temp._edt_g t where t.salle_type is not null and not exists (select 1 from public.salles r where r.id::text = t.s and r.etablissement_id = p_etab and r.type = t.salle_type)) then
    raise exception 'Emploi du temps refusé : salle spécialisée manquante ou inadaptée.' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_temp._edt_g where s is not null group by s, j, p having count(*) > 1) then
    raise exception 'Emploi du temps refusé : une salle est occupée par deux cours en même temps.' using errcode = 'P0001';
  end if;
  -- maximums d'heures par jour
  if exists (select 1 from pg_temp._edt_g t where t.a is not null group by t.c, t.j
              having count(*) > coalesce(public._edt_int(p_c #> array['classes', t.c, 'max_jour'], 1, 16), public._edt_int(gen_cls -> 'max_jour', 1, 16), 99)) then
    raise exception 'Emploi du temps refusé : trop d''heures de cours dans la journée pour une classe.' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_temp._edt_g t join lateral (select e from jsonb_array_elements(p_c -> 'enseignants') e where e ->> 'cle' = t.ens) z on true
              group by t.ens, t.j, z.e having count(*) > coalesce(public._edt_int(z.e -> 'max_jour', 1, 16), public._edt_int(gen_ens -> 'max_jour', 1, 16), 99)) then
    raise exception 'Emploi du temps refusé : trop d''heures dans la journée pour un enseignant.' using errcode = 'P0001';
  end if;
  -- heures consécutives : deux périodes s'enchaînent si aucune pause de midi ni interruption ne les sépare ce jour-là
  create temp table if not exists _edt_seg (j int, p int, seg int) on commit drop;
  truncate pg_temp._edt_seg;
  insert into pg_temp._edt_seg
  select j, p, (select count(*) from generate_series(0, p - 1) q
                 where exists (select 1 from jsonb_array_elements(coalesce(p_c #> '{horaires,pauses}', '[]')) x
                                where x ->> 'type' in ('midi', 'interruption')
                                  and (jsonb_array_length(coalesce(x -> 'jours', '[]')) = 0 or (x -> 'jours') @> to_jsonb(j))
                                  and public._edt_min(x ->> 'debut') >= public._edt_min(v_per -> q ->> 'fin')
                                  and public._edt_min(x ->> 'fin') <= public._edt_min(v_per -> (q + 1) ->> 'debut')))
    from unnest(v_jours) j, generate_series(0, v_np - 1) p;
  if exists (
      select 1 from (select t.ens, t.j, s.seg, t.p - row_number() over (partition by t.ens, t.j, s.seg order by t.p) grp
                       from pg_temp._edt_g t join pg_temp._edt_seg s on s.j = t.j and s.p = t.p where t.ens is not null) r
        join lateral (select e from jsonb_array_elements(p_c -> 'enseignants') e where e ->> 'cle' = r.ens) z on true
       group by r.ens, r.j, r.seg, r.grp, z.e
      having count(*) > coalesce(public._edt_int(z.e -> 'max_consecutives', 1, 16), public._edt_int(gen_ens -> 'max_consecutives', 1, 16), 99)) then
    raise exception 'Emploi du temps refusé : trop d''heures consécutives pour un enseignant.' using errcode = 'P0001';
  end if;
  if exists (
      select 1 from (select t.c, t.j, t.disc, s.seg, t.p - row_number() over (partition by t.c, t.j, t.disc, s.seg order by t.p) grp
                       from pg_temp._edt_g t join pg_temp._edt_seg s on s.j = t.j and s.p = t.p where t.a is not null) r
       group by r.c, r.j, r.disc, r.seg, r.grp
      having count(*) > coalesce(public._edt_int(p_c #> array['classes', r.c, 'max_consecutives'], 1, 16), public._edt_int(gen_cls -> 'max_consecutives', 1, 16), 99)) then
    raise exception 'Emploi du temps refusé : trop d''heures consécutives d''une même matière dans une classe.' using errcode = 'P0001';
  end if;
end $$;

-- --- Fonctions de l'administration ------------------------------------------------------------------------------------
create or replace function public._edt_exercice(p_etab uuid, p_exercice uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.exercices where id = p_exercice and etablissement_id = p_etab) then
    raise exception 'Année scolaire introuvable.' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.edt_brouillon_lire(p_exercice uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin();
begin
  return (select jsonb_build_object('donnees', b.donnees, 'etape', b.etape, 'maj', b.maj,
                 'maj_par', (select btrim(p.nom || ' ' || p.prenom) from public.personnels p where p.id = b.maj_par))
            from public.edt_brouillons b where b.etablissement_id = v_etab and b.exercice_id = p_exercice);
end $$;

create or replace function public.edt_brouillon_enregistrer(p_exercice uuid, p_donnees jsonb, p_etape int) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin(); v_maj timestamptz := now();
begin
  perform public._edt_exercice(v_etab, p_exercice);
  if jsonb_typeof(p_donnees) <> 'object' or pg_column_size(p_donnees) > 3000000 then
    raise exception 'Brouillon trop volumineux ou illisible.' using errcode = 'P0001';
  end if;
  insert into public.edt_brouillons (etablissement_id, exercice_id, donnees, etape, maj, maj_par)
  values (v_etab, p_exercice, p_donnees, least(greatest(coalesce(p_etape, 1), 1), 7), v_maj, auth.uid())
  on conflict (etablissement_id, exercice_id) do update set donnees = excluded.donnees, etape = excluded.etape, maj = excluded.maj, maj_par = excluded.maj_par;
  return jsonb_build_object('maj', v_maj);
end $$;

create or replace function public.edt_brouillon_supprimer(p_exercice uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin();
begin
  delete from public.edt_brouillons where etablissement_id = v_etab and exercice_id = p_exercice;
end $$;

/**
 * Enregistre une nouvelle version (provisoire) après vérification complète.
 * p = { exercice_id, periode: annee|t1|t2|t3, nom, config, grille, bilan }
 */
create or replace function public.edt_enregistrer(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin(); v_ex uuid; v_per text := coalesce(p ->> 'periode', 'annee'); v_num int; v_id uuid;
begin
  begin v_ex := (p ->> 'exercice_id')::uuid; exception when others then raise exception 'Année scolaire introuvable.' using errcode = 'P0001'; end;
  perform public._edt_exercice(v_etab, v_ex);
  if v_per not in ('annee', 't1', 't2', 't3') then raise exception 'Période inconnue.' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p ->> 'nom', ''))) not between 1 and 100 then raise exception 'Donnez un nom à cette version (100 caractères au plus).' using errcode = 'P0001'; end if;
  if (select count(*) from public.emplois_du_temps where etablissement_id = v_etab) >= 200 then
    raise exception 'Deux cents versions au plus : supprimez d''anciennes versions provisoires ou archivées.' using errcode = 'P0001';
  end if;
  perform public._edt_valider(v_etab, p -> 'config', p -> 'grille');
  perform pg_advisory_xact_lock(hashtext('edt' || v_etab::text));
  select coalesce(max(numero), 0) + 1 into v_num from public.emplois_du_temps where etablissement_id = v_etab and exercice_id = v_ex and periode = v_per;
  insert into public.emplois_du_temps (etablissement_id, exercice_id, periode, numero, nom, config, grille, bilan, cree_par)
  values (v_etab, v_ex, v_per, v_num, btrim(p ->> 'nom'), p -> 'config', p -> 'grille',
          case when jsonb_typeof(p -> 'bilan') = 'object' and pg_column_size(p -> 'bilan') < 200000 then p -> 'bilan' else '{}'::jsonb end, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'numero', v_num);
end $$;

-- Liste des versions (sans la grille) : toutes pour l'administration, les versions publiées pour le reste du personnel
create or replace function public.edt_versions(p_exercice uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'periode', e.periode, 'numero', e.numero, 'nom', e.nom, 'statut', e.statut, 'publie', e.publie,
           'bilan', e.bilan, 'cree_le', e.cree_le, 'officialise_le', e.officialise_le, 'publie_le', e.publie_le,
           'auteur', (select btrim(p.nom || ' ' || p.prenom) from public.personnels p where p.id = e.cree_par))
           order by e.periode, e.numero desc), '[]'::jsonb)
    from public.emplois_du_temps e
   where e.etablissement_id = public.etab_courant() and e.exercice_id = p_exercice and (public.est_admin() or e.publie)
$$;

create or replace function public.edt_lire(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.emplois_du_temps;
begin
  select * into e from public.emplois_du_temps where id = p_id and etablissement_id = public.etab_courant() and (public.est_admin() or publie);
  if e.id is null then raise exception 'Emploi du temps introuvable.' using errcode = 'P0001'; end if;
  return jsonb_build_object('id', e.id, 'exercice_id', e.exercice_id, 'exercice', (select libelle from public.exercices where id = e.exercice_id),
    'periode', e.periode, 'numero', e.numero, 'nom', e.nom, 'statut', e.statut, 'publie', e.publie,
    'config', e.config, 'grille', e.grille, 'bilan', e.bilan, 'cree_le', e.cree_le, 'officialise_le', e.officialise_le, 'publie_le', e.publie_le);
end $$;

create or replace function public._edt_version(p_id uuid) returns public.emplois_du_temps
language plpgsql stable security definer set search_path = '' as $$
declare e public.emplois_du_temps; v_etab uuid := public._exiger_admin();
begin
  select * into e from public.emplois_du_temps where id = p_id and etablissement_id = v_etab;
  if e.id is null then raise exception 'Emploi du temps introuvable.' using errcode = 'P0001'; end if;
  return e;
end $$;

-- Rend une version officielle : l'officielle précédente de la même année et de la même période est archivée (et retirée)
create or replace function public.edt_officialiser(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare e public.emplois_du_temps := public._edt_version(p_id);
begin
  update public.emplois_du_temps set statut = 'archive', publie = false
   where etablissement_id = e.etablissement_id and exercice_id = e.exercice_id and periode = e.periode and statut = 'officiel' and id <> e.id;
  update public.emplois_du_temps set statut = 'officiel', officialise_le = now(), officialise_par = auth.uid() where id = e.id;
end $$;

-- Publication (consultation par tout le personnel) : seulement une version officielle
create or replace function public.edt_publier(p_id uuid, p_publie boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare e public.emplois_du_temps := public._edt_version(p_id);
begin
  if p_publie and e.statut <> 'officiel' then raise exception 'Seule la version officielle peut être publiée.' using errcode = 'P0001'; end if;
  update public.emplois_du_temps set publie = coalesce(p_publie, false), publie_le = case when p_publie then now() end where id = e.id;
end $$;

create or replace function public.edt_renommer(p_id uuid, p_nom text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare e public.emplois_du_temps := public._edt_version(p_id);
begin
  if char_length(btrim(coalesce(p_nom, ''))) not between 1 and 100 then raise exception 'Donnez un nom à cette version (100 caractères au plus).' using errcode = 'P0001'; end if;
  update public.emplois_du_temps set nom = btrim(p_nom) where id = e.id;
end $$;

-- Suppression d'une version provisoire ou archivée (la version officielle se remplace, elle ne se supprime pas)
create or replace function public.edt_supprimer(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare e public.emplois_du_temps := public._edt_version(p_id);
begin
  if e.statut = 'officiel' then raise exception 'La version officielle ne peut pas être supprimée : rendez d''abord une autre version officielle.' using errcode = 'P0001'; end if;
  delete from public.emplois_du_temps where id = e.id;
end $$;

revoke execute on function public._edt_min(text), public._edt_jours(jsonb), public._edt_int(jsonb, int, int), public._edt_valider(uuid, jsonb, jsonb),
  public._edt_exercice(uuid, uuid), public._edt_version(uuid),
  public.edt_brouillon_lire(uuid), public.edt_brouillon_enregistrer(uuid, jsonb, int), public.edt_brouillon_supprimer(uuid), public.edt_enregistrer(jsonb),
  public.edt_versions(uuid), public.edt_lire(uuid), public.edt_officialiser(uuid), public.edt_publier(uuid, boolean), public.edt_renommer(uuid, text),
  public.edt_supprimer(uuid) from public, anon, authenticated;
grant execute on function public.edt_brouillon_lire(uuid), public.edt_brouillon_enregistrer(uuid, jsonb, int), public.edt_brouillon_supprimer(uuid),
  public.edt_enregistrer(jsonb), public.edt_versions(uuid), public.edt_lire(uuid), public.edt_officialiser(uuid), public.edt_publier(uuid, boolean),
  public.edt_renommer(uuid, text), public.edt_supprimer(uuid) to authenticated;
