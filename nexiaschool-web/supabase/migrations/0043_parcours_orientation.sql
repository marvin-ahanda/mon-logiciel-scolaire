-- Parcours scolaires, séries et orientation (général, technique, anglophone) : rien n'est figé, chaque établissement
-- crée ses cycles, niveaux, filières, séries et options, puis ses règles de passage entre niveaux.
--
-- Architecture (chaque notion est séparée) :
--   exercices (année scolaire) · cycles · niveaux (rattachés à un cycle et à un sous-système) · classes (déjà
--   existantes, rattachées à un niveau, une filière, une série, une section) · sections (déjà existantes : langue
--   ou sous-système d'enseignement) · filières · séries (rattachées à une filière) · options · matières (déjà
--   existantes) · règles de passage (niveau/série d'origine → niveau/série de destination, conditions, classes de
--   destination possibles, libellé de mention) · orientations (choix de série, demandes des parents, changements de
--   série, historique) · décisions de passage (décision pédagogique, destination, mention officielle du bulletin).

-- ---------------------------------------------------------------------------------------------------------
-- Fonctionnalité réglable par établissement (comprise dans toutes les offres)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._fonctions_reglables() returns text[]
language sql immutable set search_path = '' as $$
  select array['notes', 'appel', 'bulletins', 'excel_base', 'plafonds',
               'discipline', 'finances', 'decisions', 'qr', 'excel', 'smarteval', 'edt', 'parents', 'statistiques', 'ia',
               'distinctions', 'cartes', 'parcours']
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
    else 'premium' end
$$;

/** Administration de l'établissement, fonctionnalité « parcours » ouverte. */
create or replace function public._parcours_admin() returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin();
begin
  perform public._exiger_offre(v_etab, 'parcours');
  return v_etab;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Référentiel de l'établissement (lecture : tout le personnel ; écriture : administration)
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.cycles (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  libelle text not null check (char_length(btrim(libelle)) between 1 and 60),
  ordre smallint not null default 0,
  unique (etablissement_id, libelle),
  unique (id, etablissement_id)
);

create table if not exists public.niveaux (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  libelle text not null check (char_length(btrim(libelle)) between 1 and 40),
  cycle_id uuid,
  sous_systeme text not null default 'general' check (sous_systeme in ('general', 'technique', 'anglophone', 'bilingue', 'autre')),
  ordre smallint not null default 0,
  fin_de_cycle boolean not null default false,          -- dernière classe d'un cycle (examen, fin de scolarité)
  unique (etablissement_id, libelle),
  unique (id, etablissement_id),
  foreign key (cycle_id, etablissement_id) references public.cycles (id, etablissement_id) on delete set null (cycle_id)
);

create table if not exists public.filieres (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  libelle text not null check (char_length(btrim(libelle)) between 1 and 80),
  sous_systeme text not null default 'general' check (sous_systeme in ('general', 'technique', 'anglophone', 'bilingue', 'autre')),
  unique (etablissement_id, libelle),
  unique (id, etablissement_id)
);

create table if not exists public.series (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  filiere_id uuid,
  code text not null check (char_length(btrim(code)) between 1 and 20),       -- forme courte, ex. « A4 esp », « C », « D », « Science »
  libelle text not null check (char_length(btrim(libelle)) between 1 and 80),  -- ex. « A4 espagnol »
  description text not null default '' check (char_length(description) <= 300),
  unique (etablissement_id, code),
  unique (id, etablissement_id),
  foreign key (filiere_id, etablissement_id) references public.filieres (id, etablissement_id) on delete set null (filiere_id)
);

create table if not exists public.options_scolaires (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  libelle text not null check (char_length(btrim(libelle)) between 1 and 60),   -- ex. « Espagnol », « Allemand », « Informatique »
  unique (etablissement_id, libelle),
  unique (id, etablissement_id)
);

-- Les classes sont rattachées à un niveau, une filière et une série (facultatif)
alter table public.classes add column if not exists niveau_id uuid;
alter table public.classes add column if not exists filiere_id uuid;
alter table public.classes add column if not exists serie_id uuid;
do $$ begin
  alter table public.classes add constraint classes_niveau_fkey foreign key (niveau_id, etablissement_id)
    references public.niveaux (id, etablissement_id) on delete set null (niveau_id);
  alter table public.classes add constraint classes_filiere_fkey foreign key (filiere_id, etablissement_id)
    references public.filieres (id, etablissement_id) on delete set null (filiere_id);
  alter table public.classes add constraint classes_serie_fkey foreign key (serie_id, etablissement_id)
    references public.series (id, etablissement_id) on delete set null (serie_id);
exception when duplicate_object then null; end $$;

-- Le libellé « niveau » des classes (utilisé partout ailleurs) suit le niveau rattaché
create or replace function public._classe_niveau_libelle() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.niveau_id is not null then select libelle into new.niveau from public.niveaux where id = new.niveau_id; end if;
  return new;
end $$;
drop trigger if exists classe_niveau_libelle on public.classes;
create trigger classe_niveau_libelle before insert or update of niveau_id on public.classes for each row execute function public._classe_niveau_libelle();

create or replace function public._niveau_renomme() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.libelle is distinct from old.libelle then update public.classes set niveau = new.libelle where niveau_id = new.id; end if;
  return new;
end $$;
drop trigger if exists niveau_renomme on public.niveaux;
create trigger niveau_renomme after update of libelle on public.niveaux for each row execute function public._niveau_renomme();

-- Règles de passage : d'un niveau (et d'une série) vers un niveau (et une série) de destination
create table if not exists public.regles_passage (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  niveau_origine_id uuid not null,
  serie_origine_id uuid,                                -- vide : toutes les séries du niveau
  niveau_destination_id uuid not null,
  serie_destination_id uuid,
  filiere_destination_id uuid,
  type text not null default 'promotion' check (type in ('promotion', 'changement_cycle', 'orientation', 'passerelle')),
  conditions jsonb not null default '{}'::jsonb check (jsonb_typeof(conditions) = 'object'),  -- moyenne_min, matieres [{code, min}], decision
  classes_destination uuid[] not null default '{}',     -- vide : toutes les classes du niveau (et de la série) de destination
  sur_demande boolean not null default false,           -- seulement pour les élèves dont l'orientation vers cette série est acceptée
  mention text not null default '' check (char_length(mention) <= 120),   -- modèle, ex. « Promu(e) en {destination} »
  ordre smallint not null default 0,
  active boolean not null default true,
  unique (id, etablissement_id),
  foreign key (niveau_origine_id, etablissement_id) references public.niveaux (id, etablissement_id) on delete cascade,
  foreign key (niveau_destination_id, etablissement_id) references public.niveaux (id, etablissement_id) on delete cascade,
  foreign key (serie_origine_id, etablissement_id) references public.series (id, etablissement_id) on delete cascade,
  foreign key (serie_destination_id, etablissement_id) references public.series (id, etablissement_id) on delete cascade,
  foreign key (filiere_destination_id, etablissement_id) references public.filieres (id, etablissement_id) on delete set null (filiere_destination_id)
);

-- Libellés des mentions propres à l'établissement (par type de décision)
create table if not exists public.parcours_config (
  etablissement_id uuid primary key default public.etab_courant() references public.etablissements (id) on delete cascade,
  mentions jsonb not null default '{}'::jsonb check (jsonb_typeof(mentions) = 'object' and pg_column_size(mentions) < 6000)
);

do $$
declare t text;
begin
  foreach t in array array['cycles', 'niveaux', 'filieres', 'series', 'options_scolaires', 'regles_passage', 'parcours_config'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists "lecture" on public.%I', t);
    execute format('create policy "lecture" on public.%I for select to authenticated using (etablissement_id = (select public.etab_courant()))', t);
    execute format('drop policy if exists "administration" on public.%I', t);
    execute format('create policy "administration" on public.%I for all to authenticated using (etablissement_id = (select public.etab_courant()) and (select public.est_admin())) with check (etablissement_id = (select public.etab_courant()) and (select public.est_admin()))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Orientations : choix de série (administration), demandes (parents), changements de série ; historique complet
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.orientations (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null,
  eleve_id uuid not null,
  inscription_id uuid not null,                         -- année d'origine
  exercice_id uuid not null,
  type text not null check (type in ('choix_serie', 'demande_orientation', 'changement_serie')),
  origine text not null check (origine in ('parent', 'administration')),
  niveau_id uuid, filiere_id uuid, serie_id uuid, classe_id uuid,   -- destination souhaitée ou décidée
  options uuid[] not null default '{}',
  motif text not null default '' check (char_length(motif) <= 1000),
  parent_nom text not null default '' check (char_length(parent_nom) <= 120),
  statut text not null default 'en_attente' check (statut in ('en_attente', 'acceptee', 'refusee', 'annulee', 'remplacee')),
  reponse text not null default '' check (char_length(reponse) <= 1000),
  cree_par uuid, cree_le timestamptz not null default now(),
  decide_par uuid, decide_le timestamptz,
  applique_le timestamptz,                              -- changement de série appliqué (élève déplacé de classe)
  foreign key (inscription_id, etablissement_id) references public.inscriptions (id, etablissement_id) on delete cascade,
  foreign key (eleve_id, etablissement_id) references public.eleves (id, etablissement_id) on delete cascade
);
create index if not exists orientations_etab on public.orientations (etablissement_id, statut);
create index if not exists orientations_inscription on public.orientations (inscription_id);
alter table public.orientations enable row level security;
revoke all on public.orientations from anon, authenticated;
grant select on public.orientations to authenticated;
create policy "administration" on public.orientations for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));

-- ---------------------------------------------------------------------------------------------------------
-- Décisions de passage et mention officielle du bulletin annuel
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.decisions_passage (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null,
  exercice_id uuid not null,
  inscription_id uuid not null unique,
  eleve_id uuid not null,
  decision text not null check (decision in ('promu', 'redoublant', 'admis_sous_condition', 'oriente', 'transfere', 'change_cycle', 'change_serie',
    'attente_conseil', 'sortant', 'abandon', 'exclu', 'attente_reinscription', 'diplome')),
  niveau_destination_id uuid, serie_destination_id uuid, filiere_destination_id uuid, classe_destination_id uuid,
  regle_id uuid,
  mention text not null default '' check (char_length(mention) <= 150),
  mention_forcee boolean not null default false,        -- mention saisie à la main (sinon générée)
  source text not null default 'calcul' check (source in ('calcul', 'manuel')),
  statut text not null default 'provisoire' check (statut in ('provisoire', 'validee')),
  motif text not null default '' check (char_length(motif) <= 300),
  maj timestamptz not null default now(),
  maj_par uuid,
  foreign key (inscription_id, etablissement_id) references public.inscriptions (id, etablissement_id) on delete cascade,
  foreign key (exercice_id, etablissement_id) references public.exercices (id, etablissement_id) on delete cascade
);
create index if not exists decisions_passage_etab on public.decisions_passage (etablissement_id, exercice_id);
alter table public.decisions_passage enable row level security;
revoke all on public.decisions_passage from anon, authenticated;
grant select on public.decisions_passage to authenticated;
create policy "lecture du personnel" on public.decisions_passage for select to authenticated
  using (etablissement_id = (select public.etab_courant()));

create table if not exists public.parcours_journal (
  id bigint generated always as identity primary key,
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  action text not null,
  eleve_id uuid,
  details jsonb not null default '{}'::jsonb,
  par uuid,
  le timestamptz not null default now()
);
create index if not exists parcours_journal_etab on public.parcours_journal (etablissement_id, le desc);
alter table public.parcours_journal enable row level security;
revoke all on public.parcours_journal from anon, authenticated;
grant select on public.parcours_journal to authenticated;
create policy "administration" on public.parcours_journal for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));

create or replace function public._parcours_journaliser(p_etab uuid, p_action text, p_eleve uuid, p_details jsonb)
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.parcours_journal (etablissement_id, action, eleve_id, details, par) values (p_etab, p_action, p_eleve, coalesce(p_details, '{}'::jsonb), auth.uid())
$$;

-- Vérifie qu'une référence (niveau, série, filière, classe) appartient bien à l'établissement
create or replace function public._parcours_ref(p_table text, p_id uuid, p_etab uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare ok boolean;
begin
  if p_id is null then return null; end if;
  execute format('select exists (select 1 from public.%I where id = $1 and etablissement_id = $2)', p_table) into ok using p_id, p_etab;
  if not ok then raise exception 'Référence inconnue (%).', p_table using errcode = 'P0001'; end if;
  return p_id;
end $$;

/**
 * Enregistre un choix de série ou une décision d'orientation par l'administration (statut « acceptée » d'emblée).
 * p = { inscription_id, type, niveau_id, filiere_id, serie_id, classe_id, options, motif }
 */
create or replace function public.orientation_enregistrer(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._parcours_admin(); i record; v_id uuid; v_type text := coalesce(p->>'type', 'choix_serie');
begin
  select ins.id, ins.eleve_id, ins.exercice_id into i from public.inscriptions ins
   where ins.id = nullif(p->>'inscription_id', '')::uuid and ins.etablissement_id = v_etab;
  if i.id is null then raise exception 'Élève introuvable.' using errcode = 'P0001'; end if;
  if v_type not in ('choix_serie', 'demande_orientation', 'changement_serie') then raise exception 'Type inconnu.' using errcode = 'P0001'; end if;
  update public.orientations set statut = 'remplacee' where inscription_id = i.id and statut = 'acceptee'
     and (type = 'changement_serie') = (v_type = 'changement_serie');      -- choix et demandes d'orientation : une seule destination retenue
  insert into public.orientations (etablissement_id, eleve_id, inscription_id, exercice_id, type, origine, niveau_id, filiere_id, serie_id, classe_id, options,
                                   motif, statut, cree_par, decide_par, decide_le)
  values (v_etab, i.eleve_id, i.id, i.exercice_id, v_type, 'administration',
          public._parcours_ref('niveaux', nullif(p->>'niveau_id', '')::uuid, v_etab), public._parcours_ref('filieres', nullif(p->>'filiere_id', '')::uuid, v_etab),
          public._parcours_ref('series', nullif(p->>'serie_id', '')::uuid, v_etab), public._parcours_ref('classes', nullif(p->>'classe_id', '')::uuid, v_etab),
          coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p->'options', '[]'::jsonb)) x), '{}'),
          left(coalesce(p->>'motif', ''), 1000), 'acceptee', auth.uid(), auth.uid(), now())
  returning id into v_id;
  perform public._parcours_journaliser(v_etab, 'orientation_' || v_type, i.eleve_id, jsonb_build_object('id', v_id, 'serie', p->>'serie_id', 'classe', p->>'classe_id'));
  return jsonb_build_object('id', v_id);
end $$;

/** Accepte ou refuse une demande (réponse visible des parents). */
create or replace function public.orientation_decider(p_id uuid, p_accepter boolean, p_reponse text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._parcours_admin(); o public.orientations;
begin
  select * into o from public.orientations where id = p_id and etablissement_id = v_etab for update;
  if o.id is null then raise exception 'Demande introuvable.' using errcode = 'P0001'; end if;
  if o.statut <> 'en_attente' then raise exception 'Cette demande a déjà été traitée.' using errcode = 'P0001'; end if;
  if not p_accepter and char_length(btrim(coalesce(p_reponse, ''))) < 3 then raise exception 'Expliquez le refus aux parents.' using errcode = 'P0001'; end if;
  if p_accepter then
    update public.orientations set statut = 'remplacee' where inscription_id = o.inscription_id and statut = 'acceptee' and id <> o.id
       and (type = 'changement_serie') = (o.type = 'changement_serie');
  end if;
  update public.orientations set statut = case when p_accepter then 'acceptee' else 'refusee' end, reponse = left(btrim(coalesce(p_reponse, '')), 1000),
         decide_par = auth.uid(), decide_le = now() where id = o.id;
  perform public._parcours_journaliser(v_etab, case when p_accepter then 'demande_acceptee' else 'demande_refusee' end, o.eleve_id, jsonb_build_object('id', o.id));
end $$;

/** Changement de série en cours d'année : déplace l'élève dans la classe acceptée (les notes déjà saisies restent attachées à l'ancienne classe). */
create or replace function public.orientation_appliquer(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._parcours_admin(); o public.orientations; ancienne uuid;
begin
  select * into o from public.orientations where id = p_id and etablissement_id = v_etab for update;
  if o.id is null or o.type <> 'changement_serie' or o.statut <> 'acceptee' then raise exception 'Seul un changement de série accepté peut être appliqué.' using errcode = 'P0001'; end if;
  if o.applique_le is not null then raise exception 'Ce changement a déjà été appliqué.' using errcode = 'P0001'; end if;
  if o.classe_id is null then raise exception 'Indiquez la classe de destination.' using errcode = 'P0001'; end if;
  select classe_id into ancienne from public.inscriptions where id = o.inscription_id;
  update public.inscriptions set classe_id = o.classe_id where id = o.inscription_id and etablissement_id = v_etab;
  update public.orientations set applique_le = now() where id = o.id;
  perform public._parcours_journaliser(v_etab, 'changement_serie_applique', o.eleve_id, jsonb_build_object('id', o.id, 'de', ancienne, 'vers', o.classe_id));
end $$;

/**
 * Enregistre les décisions de passage (une ligne par élève, exercice actif) ; p_valider : statut « validée ».
 * p_decisions = [{ inscription_id, decision, niveau_destination_id, serie_destination_id, filiere_destination_id, classe_destination_id,
 *                  regle_id, mention, mention_forcee, source, motif }]
 */
create or replace function public.decisions_passage_enregistrer(p_decisions jsonb, p_valider boolean default false) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._parcours_admin(); ex uuid; x jsonb; i record; n int := 0;
begin
  select id into ex from public.exercices where etablissement_id = v_etab and actif;
  if ex is null then raise exception 'Activez d''abord un exercice.' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_decisions, '[]'::jsonb)) <> 'array' then raise exception 'Liste invalide.' using errcode = 'P0001'; end if;
  for x in select * from jsonb_array_elements(p_decisions) loop
    select ins.id, ins.eleve_id into i from public.inscriptions ins
     where ins.id = nullif(x->>'inscription_id', '')::uuid and ins.etablissement_id = v_etab and ins.exercice_id = ex;
    continue when i.id is null;
    insert into public.decisions_passage (etablissement_id, exercice_id, inscription_id, eleve_id, decision, niveau_destination_id, serie_destination_id,
      filiere_destination_id, classe_destination_id, regle_id, mention, mention_forcee, source, statut, motif, maj, maj_par)
    values (v_etab, ex, i.id, i.eleve_id, x->>'decision',
      public._parcours_ref('niveaux', nullif(x->>'niveau_destination_id', '')::uuid, v_etab), public._parcours_ref('series', nullif(x->>'serie_destination_id', '')::uuid, v_etab),
      public._parcours_ref('filieres', nullif(x->>'filiere_destination_id', '')::uuid, v_etab), public._parcours_ref('classes', nullif(x->>'classe_destination_id', '')::uuid, v_etab),
      public._parcours_ref('regles_passage', nullif(x->>'regle_id', '')::uuid, v_etab),
      left(coalesce(x->>'mention', ''), 150), coalesce((x->>'mention_forcee')::boolean, false), coalesce(x->>'source', 'calcul'),
      case when coalesce(p_valider, false) then 'validee' else 'provisoire' end, left(coalesce(x->>'motif', ''), 300), now(), auth.uid())
    on conflict (inscription_id) do update set decision = excluded.decision, niveau_destination_id = excluded.niveau_destination_id,
      serie_destination_id = excluded.serie_destination_id, filiere_destination_id = excluded.filiere_destination_id,
      classe_destination_id = excluded.classe_destination_id, regle_id = excluded.regle_id, mention = excluded.mention, mention_forcee = excluded.mention_forcee,
      source = excluded.source, statut = excluded.statut, motif = excluded.motif, maj = now(), maj_par = auth.uid();
    n := n + 1;
  end loop;
  perform public._parcours_journaliser(v_etab, case when coalesce(p_valider, false) then 'decisions_validees' else 'decisions_enregistrees' end, null, jsonb_build_object('nombre', n));
  return n;
exception when check_violation then raise exception 'Décision inconnue.' using errcode = 'P0001';
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Espace parents : série actuelle, destinations possibles, demandes et réponses
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.parent_orientation(p_session text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s record; c public.classes;
begin
  select * into s from public._parent_session(p_session);
  select * into c from public.classes where id = s.classe;
  return jsonb_build_object(
    'classe', c.libelle, 'niveau', (select libelle from public.niveaux where id = c.niveau_id),
    'serie', (select jsonb_build_object('code', code, 'libelle', libelle) from public.series where id = c.serie_id),
    'destinations', (select coalesce(jsonb_agg(distinct jsonb_build_object('serie_id', r.serie_destination_id, 'niveau_id', r.niveau_destination_id,
        'libelle', trim(n.libelle || ' ' || coalesce(se.code, '')), 'serie', se.libelle, 'filiere', f.libelle)), '[]'::jsonb)
       from public.regles_passage r join public.niveaux n on n.id = r.niveau_destination_id
       left join public.series se on se.id = r.serie_destination_id left join public.filieres f on f.id = coalesce(r.filiere_destination_id, se.filiere_id)
      where r.etablissement_id = s.etab and r.active and r.niveau_origine_id = c.niveau_id
        and (r.serie_origine_id is null or r.serie_origine_id = c.serie_id)),
    'demandes', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'type', o.type, 'origine', o.origine, 'statut', o.statut, 'motif', o.motif,
        'reponse', o.reponse, 'cree_le', o.cree_le, 'decide_le', o.decide_le,
        'serie', (select libelle from public.series where id = o.serie_id), 'niveau', (select libelle from public.niveaux where id = o.niveau_id),
        'filiere', (select libelle from public.filieres where id = o.filiere_id)) order by o.cree_le desc), '[]'::jsonb)
       from public.orientations o where o.eleve_id = s.eleve and o.etablissement_id = s.etab and o.statut <> 'annulee'));
end $$;

/** p = { serie_id, niveau_id, filiere_id, motif, parent_nom, type ('demande_orientation' | 'changement_serie') } */
create or replace function public.parent_demander_orientation(p_session text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s record; v_id uuid; v_type text := coalesce(p->>'type', 'demande_orientation');
begin
  select * into s from public._parent_session(p_session);
  if v_type not in ('demande_orientation', 'changement_serie') then raise exception 'Type de demande inconnu.' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p->>'motif', ''))) < 10 then raise exception 'Expliquez votre demande en quelques mots (10 caractères au moins).' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p->>'parent_nom', ''))) < 2 then raise exception 'Indiquez votre nom.' using errcode = 'P0001'; end if;
  if nullif(p->>'serie_id', '') is null and nullif(p->>'filiere_id', '') is null and nullif(p->>'niveau_id', '') is null then
    raise exception 'Choisissez la série ou la filière souhaitée.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.orientations where inscription_id = s.inscription and statut = 'en_attente' and origine = 'parent') then
    raise exception 'Une demande est déjà en cours d''examen : attendez la réponse de l''établissement.' using errcode = 'P0001'; end if;
  insert into public.orientations (etablissement_id, eleve_id, inscription_id, exercice_id, type, origine, niveau_id, filiere_id, serie_id, motif, parent_nom)
  values (s.etab, s.eleve, s.inscription, s.exercice, v_type, 'parent',
          public._parcours_ref('niveaux', nullif(p->>'niveau_id', '')::uuid, s.etab), public._parcours_ref('filieres', nullif(p->>'filiere_id', '')::uuid, s.etab),
          public._parcours_ref('series', nullif(p->>'serie_id', '')::uuid, s.etab), btrim(left(p->>'motif', 1000)), btrim(left(p->>'parent_nom', 120)))
  returning id into v_id;
  insert into public.parcours_journal (etablissement_id, action, eleve_id, details) values (s.etab, 'demande_parent', s.eleve, jsonb_build_object('id', v_id));
  return jsonb_build_object('id', v_id);
end $$;

/** Bulle de l'administration : demandes d'orientation en attente. */
create or replace function public.orientations_en_attente() returns int
language sql stable security definer set search_path = '' as $$
  select case when public.est_admin() then (select count(*)::int from public.orientations where etablissement_id = public.etab_courant() and statut = 'en_attente') else 0 end
$$;

revoke execute on function public._parcours_admin(), public._parcours_journaliser(uuid, text, uuid, jsonb), public._parcours_ref(text, uuid, uuid),
  public._classe_niveau_libelle(), public._niveau_renomme() from public, anon, authenticated;
revoke execute on function public.orientation_enregistrer(jsonb), public.orientation_decider(uuid, boolean, text), public.orientation_appliquer(uuid),
  public.decisions_passage_enregistrer(jsonb, boolean), public.orientations_en_attente() from public, anon;
grant execute on function public.orientation_enregistrer(jsonb), public.orientation_decider(uuid, boolean, text), public.orientation_appliquer(uuid),
  public.decisions_passage_enregistrer(jsonb, boolean), public.orientations_en_attente() to authenticated;
grant execute on function public.parent_orientation(text), public.parent_demander_orientation(text, jsonb) to anon, authenticated;
