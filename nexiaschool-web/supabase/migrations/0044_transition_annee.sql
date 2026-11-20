-- Transition d'année scolaire (passage de classe) : jamais de modification sans validation humaine.
--   1. Préparer : année cible (créée sans être activée) et duplication des structures choisies
--      (programme : matières, coefficients et enseignants par classe ; barème de discipline ; frais et échéancier).
--      Cycles, niveaux, classes, sections, filières, séries et options ne dépendent pas de l'année : ils sont conservés.
--   2. Analyser : une décision provisoire par élève (décisions de passage validées, sinon proposition calculée).
--   3. Réviser : l'administration corrige ; chaque ligne est enregistrée avec son origine et son motif.
--   4. Simuler : effectifs par décision, élèves sans classe de destination, informations incomplètes, décisions
--      contradictoires, élèves déjà inscrits ailleurs, élèves non analysés.
--   5. Appliquer : inscriptions créées dans l'année cible (redoublants marqués) ; retour arrière possible tant que
--      la transition n'est pas clôturée (et qu'aucune donnée n'a été saisie dans la nouvelle année).
--   6. Clôturer : transition figée (année cible activée si demandé). Après clôture, seule une annulation tracée,
--      motivée et confirmée permet de la rouvrir.
-- Les règles de promotion s'appuient sur les critères de fin d'année existants, étendus ici : note minimale dans
-- chaque matière, nombre maximal de matières en échec, et critères propres à un cycle, un niveau ou une section.

-- ---------------------------------------------------------------------------------------------------------
-- Critères de décision : nouvelles conditions et portée
-- ---------------------------------------------------------------------------------------------------------
alter table public.criteres_decision add column if not exists note_min_matieres numeric(4, 2) check (note_min_matieres between 0 and 20);
alter table public.criteres_decision add column if not exists matieres_echec_max smallint check (matieres_echec_max between 0 and 30);
alter table public.criteres_decision add column if not exists portee jsonb not null default '{}'::jsonb check (jsonb_typeof(portee) = 'object');

/**
 * Remplace les critères d'une période (administration uniquement).
 * p_criteres : [{ decision, libelle?, moyenne_min?, moyenne_max?, discipline_min?, discipline_max?, heures_nj_min?, heures_nj_max?,
 *                 retards_min?, sanction_id?, sanctions_min?, note_min_matieres?, matieres_echec_max?, portee?: { cycles, niveaux, sections } }]
 */
create or replace function public.enregistrer_criteres_decision(p_periode text, p_criteres jsonb) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_etab uuid := public._exiger_admin(); c jsonb; n int := 0; v_portee jsonb;
  noms text[] := array['moyenne_min', 'moyenne_max', 'discipline_min', 'discipline_max', 'heures_nj_min', 'heures_nj_max', 'retards_min', 'sanctions_min',
                       'note_min_matieres', 'matieres_echec_max'];
  k text;
begin
  if p_periode is null or p_periode not in ('t1', 't2', 't3', 'a') then raise exception 'Période invalide.' using errcode = '22023'; end if;
  if p_criteres is null or jsonb_typeof(p_criteres) <> 'array' or jsonb_array_length(p_criteres) > 40 then
    raise exception 'Liste de critères invalide (40 au plus).' using errcode = '22023';
  end if;
  delete from public.criteres_decision where etablissement_id = v_etab and periode = p_periode;
  for c in select * from jsonb_array_elements(p_criteres) loop
    n := n + 1;
    if coalesce(c ->> 'decision', '') not in ('admis', 'rattrapage', 'redouble', 'exclu') then
      raise exception 'Critère % : décision inconnue.', n using errcode = 'P0001';
    end if;
    if c ->> 'decision' = 'rattrapage' and p_periode <> 'a' then
      raise exception 'Le rattrapage ne se décide qu''en fin d''année.' using errcode = 'P0001';
    end if;
    foreach k in array noms loop perform public._num_critere(c, k, n); end loop;
    if (public._num_critere(c, 'moyenne_min', n)) >= (public._num_critere(c, 'moyenne_max', n)) then
      raise exception 'Critère % : la moyenne minimale doit être inférieure à la moyenne maximale.', n using errcode = 'P0001';
    end if;
    if (public._num_critere(c, 'discipline_min', n)) >= (public._num_critere(c, 'discipline_max', n)) then
      raise exception 'Critère % : la note de discipline minimale doit être inférieure à la maximale.', n using errcode = 'P0001';
    end if;
    if (public._num_critere(c, 'heures_nj_min', n)) >= (public._num_critere(c, 'heures_nj_max', n)) then
      raise exception 'Critère % : le nombre d''heures minimal doit être inférieur au maximal.', n using errcode = 'P0001';
    end if;
    if (nullif(c ->> 'sanction_id', '') is null) <> (nullif(c ->> 'sanctions_min', '') is null) then
      raise exception 'Critère % : choisissez la sanction et le nombre de fois.', n using errcode = 'P0001';
    end if;
    if public._num_critere(c, 'note_min_matieres', n) > 20 then raise exception 'Critère % : note sur 20 attendue.', n using errcode = 'P0001'; end if;
    v_portee := coalesce(c -> 'portee', '{}'::jsonb);
    if jsonb_typeof(v_portee) <> 'object' then raise exception 'Critère % : portée invalide.', n using errcode = 'P0001'; end if;
    v_portee := jsonb_strip_nulls(jsonb_build_object(
      'cycles', (select jsonb_agg(x) from jsonb_array_elements_text(coalesce(v_portee -> 'cycles', '[]')) x where exists (select 1 from public.cycles where id::text = x and etablissement_id = v_etab)),
      'niveaux', (select jsonb_agg(x) from jsonb_array_elements_text(coalesce(v_portee -> 'niveaux', '[]')) x where exists (select 1 from public.niveaux where id::text = x and etablissement_id = v_etab)),
      'sections', (select jsonb_agg(x) from jsonb_array_elements_text(coalesce(v_portee -> 'sections', '[]')) x where exists (select 1 from public.sections where id::text = x and etablissement_id = v_etab))));
    insert into public.criteres_decision (etablissement_id, periode, decision, ordre, libelle, moyenne_min, moyenne_max, discipline_min, discipline_max,
                                          heures_nj_min, heures_nj_max, retards_min, sanction_id, sanctions_min, note_min_matieres, matieres_echec_max, portee, maj_par)
    values (v_etab, p_periode, c ->> 'decision', n, left(btrim(coalesce(c ->> 'libelle', '')), 80),
            public._num_critere(c, 'moyenne_min', n), public._num_critere(c, 'moyenne_max', n),
            public._num_critere(c, 'discipline_min', n), public._num_critere(c, 'discipline_max', n),
            public._num_critere(c, 'heures_nj_min', n)::smallint, public._num_critere(c, 'heures_nj_max', n)::smallint,
            public._num_critere(c, 'retards_min', n)::smallint, nullif(c ->> 'sanction_id', '')::uuid,
            public._num_critere(c, 'sanctions_min', n)::smallint, public._num_critere(c, 'note_min_matieres', n),
            public._num_critere(c, 'matieres_echec_max', n)::smallint, v_portee, auth.uid());
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Transitions
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.transitions (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  exercice_source_id uuid not null,
  exercice_cible_id uuid not null,
  statut text not null default 'preparation' check (statut in ('preparation', 'appliquee', 'cloturee')),
  options jsonb not null default '{}'::jsonb,
  cree_par uuid, cree_le timestamptz not null default now(),
  applique_par uuid, applique_le timestamptz,
  cloture_par uuid, cloture_le timestamptz,
  unique (exercice_source_id),
  unique (id, etablissement_id),
  check (exercice_source_id <> exercice_cible_id),
  foreign key (exercice_source_id, etablissement_id) references public.exercices (id, etablissement_id) on delete cascade,
  foreign key (exercice_cible_id, etablissement_id) references public.exercices (id, etablissement_id) on delete cascade
);

create table if not exists public.transition_lignes (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null,
  transition_id uuid not null,
  inscription_id uuid not null,
  eleve_id uuid not null,
  classe_origine_id uuid,
  decision text not null check (decision in ('promu', 'redoublant', 'admis_sous_condition', 'oriente', 'transfere', 'change_cycle', 'change_serie',
    'attente_conseil', 'sortant', 'abandon', 'exclu', 'attente_reinscription', 'diplome')),
  niveau_destination_id uuid, serie_destination_id uuid, classe_destination_id uuid,
  mention text not null default '' check (char_length(mention) <= 150),
  source text not null default 'calcul' check (source in ('passage_valide', 'calcul', 'manuel')),
  motif text not null default '' check (char_length(motif) <= 300),
  inscription_creee_id uuid,                       -- inscription créée dans l'année cible lors de l'application
  maj timestamptz not null default now(), maj_par uuid,
  unique (transition_id, inscription_id),
  foreign key (transition_id, etablissement_id) references public.transitions (id, etablissement_id) on delete cascade,
  foreign key (inscription_id, etablissement_id) references public.inscriptions (id, etablissement_id) on delete cascade
);
create index if not exists transition_lignes_eleve on public.transition_lignes (eleve_id);

create table if not exists public.transitions_journal (
  id bigint generated always as identity primary key,
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  transition_id uuid,
  action text not null,
  motif text not null default '',
  details jsonb not null default '{}'::jsonb,
  par uuid,
  le timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['transitions', 'transition_lignes', 'transitions_journal'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy "administration" on public.%I for select to authenticated using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()))', t);
  end loop;
end $$;

create or replace function public._transition_journaliser(p_etab uuid, p_transition uuid, p_action text, p_motif text, p_details jsonb)
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.transitions_journal (etablissement_id, transition_id, action, motif, details, par)
  values (p_etab, p_transition, p_action, coalesce(p_motif, ''), coalesce(p_details, '{}'::jsonb), auth.uid())
$$;

create or replace function public._transition(p_id uuid, p_statut text) returns public.transitions
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin(); tr public.transitions;
begin
  perform public._exiger_offre(v_etab, 'parcours');
  select * into tr from public.transitions where id = p_id and etablissement_id = v_etab for update;
  if tr.id is null then raise exception 'Transition introuvable.' using errcode = 'P0001'; end if;
  if p_statut is not null and tr.statut <> p_statut then
    raise exception '%', case p_statut
      when 'preparation' then 'La transition a déjà été appliquée : annulez-la d''abord pour la modifier.'
      when 'appliquee' then case when tr.statut = 'cloturee' then 'La transition est clôturée.' else 'Appliquez d''abord la transition.' end
      else 'Action impossible dans l''état actuel de la transition.' end using errcode = 'P0001';
  end if;
  return tr;
end $$;

-- Décisions qui donnent lieu à une inscription dans l'année cible
create or replace function public._decision_inscrit(p_decision text) returns boolean
language sql immutable set search_path = '' as $$
  select p_decision in ('promu', 'redoublant', 'admis_sous_condition', 'oriente', 'transfere', 'change_cycle', 'change_serie')
$$;

/**
 * Prépare la transition depuis une année (par défaut l'année active) vers l'année cible (créée sans être activée si besoin).
 * p_options = { programme: true, bareme: true, frais: true } : structures dupliquées (sans écraser l'existant).
 */
create or replace function public.transition_preparer(p_source uuid, p_cible text, p_options jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin(); src public.exercices; cib public.exercices; tr public.transitions; o jsonb := coalesce(p_options, '{}'::jsonb);
        n_prog int := 0; n_ech int := 0;
begin
  perform public._exiger_offre(v_etab, 'parcours');
  select * into src from public.exercices where etablissement_id = v_etab and (id = p_source or (p_source is null and actif));
  if src.id is null then raise exception 'Année de départ introuvable.' using errcode = 'P0001'; end if;
  if coalesce(p_cible, '') !~ '^[0-9]{4}-[0-9]{4}$' or split_part(p_cible, '-', 2)::int <> split_part(p_cible, '-', 1)::int + 1 then
    raise exception 'Année cible invalide (format : 2027-2028).' using errcode = 'P0001'; end if;
  if split_part(p_cible, '-', 1)::int <= split_part(src.libelle, '-', 1)::int then
    raise exception 'L''année cible doit suivre l''année de départ (%).', src.libelle using errcode = 'P0001'; end if;
  select * into tr from public.transitions where exercice_source_id = src.id;
  if tr.id is not null and tr.statut <> 'preparation' then
    raise exception 'La transition depuis % a déjà été appliquée.', src.libelle using errcode = 'P0001'; end if;
  select * into cib from public.exercices where etablissement_id = v_etab and libelle = p_cible;
  if cib.id is null then
    insert into public.exercices (etablissement_id, libelle, actif) values (v_etab, p_cible, false) returning * into cib;
  end if;
  if coalesce((o ->> 'programme')::boolean, true) then
    insert into public.attributions (etablissement_id, exercice_id, classe_id, matiere_id, enseignant_id, coefficient, groupe)
    select v_etab, cib.id, a.classe_id, a.matiere_id, a.enseignant_id, a.coefficient, a.groupe from public.attributions a
     where a.exercice_id = src.id on conflict (exercice_id, classe_id, matiere_id) do nothing;
    get diagnostics n_prog = row_count;
  end if;
  if coalesce((o ->> 'bareme')::boolean, true) then
    update public.parametres_discipline c set note_max = s.note_max, points_par_retard = s.points_par_retard, points_par_heure = s.points_par_heure
      from public.parametres_discipline s where s.exercice_id = src.id and c.exercice_id = cib.id;
  end if;
  if coalesce((o ->> 'frais')::boolean, true) then
    insert into public.frais_scolarite (exercice_id, etablissement_id, pension_nouveaux, pension_anciens)
    select cib.id, v_etab, f.pension_nouveaux, f.pension_anciens from public.frais_scolarite f where f.exercice_id = src.id
    on conflict do nothing;
    if not exists (select 1 from public.echeances where exercice_id = cib.id) then
      insert into public.echeances (etablissement_id, exercice_id, rang, libelle, montant, date_limite)
      select v_etab, cib.id, e.rang, e.libelle, e.montant, (e.date_limite + interval '1 year')::date from public.echeances e where e.exercice_id = src.id;
      get diagnostics n_ech = row_count;
    end if;
  end if;
  insert into public.transitions (etablissement_id, exercice_source_id, exercice_cible_id, options, cree_par)
  values (v_etab, src.id, cib.id, o, auth.uid())
  on conflict (exercice_source_id) do update set exercice_cible_id = excluded.exercice_cible_id, options = excluded.options
  returning * into tr;
  perform public._transition_journaliser(v_etab, tr.id, 'preparation', '', jsonb_build_object('source', src.libelle, 'cible', cib.libelle,
    'programme', n_prog, 'echeances', n_ech));
  return jsonb_build_object('id', tr.id, 'source', src.libelle, 'cible', cib.libelle, 'cible_id', cib.id, 'programme', n_prog, 'echeances', n_ech);
end $$;

/**
 * Enregistre (ou corrige) les décisions de la transition. p_lignes = [{ inscription_id, decision, niveau_destination_id,
 * serie_destination_id, classe_destination_id, mention, source, motif }]. Les décisions de passage (mention du bulletin)
 * sont mises à jour en conséquence.
 */
create or replace function public.transition_enregistrer(p_transition uuid, p_lignes jsonb) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare tr public.transitions := public._transition(p_transition, 'preparation'); x jsonb; i record; n int := 0; v_classe uuid;
begin
  if jsonb_typeof(coalesce(p_lignes, '[]'::jsonb)) <> 'array' then raise exception 'Liste invalide.' using errcode = 'P0001'; end if;
  for x in select * from jsonb_array_elements(p_lignes) loop
    select ins.id, ins.eleve_id, ins.classe_id into i from public.inscriptions ins
     where ins.id = nullif(x ->> 'inscription_id', '')::uuid and ins.etablissement_id = tr.etablissement_id and ins.exercice_id = tr.exercice_source_id;
    continue when i.id is null;
    v_classe := public._parcours_ref('classes', nullif(x ->> 'classe_destination_id', '')::uuid, tr.etablissement_id);
    insert into public.transition_lignes (etablissement_id, transition_id, inscription_id, eleve_id, classe_origine_id, decision, niveau_destination_id,
      serie_destination_id, classe_destination_id, mention, source, motif, maj_par)
    values (tr.etablissement_id, tr.id, i.id, i.eleve_id, i.classe_id, x ->> 'decision',
      public._parcours_ref('niveaux', nullif(x ->> 'niveau_destination_id', '')::uuid, tr.etablissement_id),
      public._parcours_ref('series', nullif(x ->> 'serie_destination_id', '')::uuid, tr.etablissement_id), v_classe,
      left(coalesce(x ->> 'mention', ''), 150), coalesce(nullif(x ->> 'source', ''), 'calcul'), left(coalesce(x ->> 'motif', ''), 300), auth.uid())
    on conflict (transition_id, inscription_id) do update set decision = excluded.decision, niveau_destination_id = excluded.niveau_destination_id,
      serie_destination_id = excluded.serie_destination_id, classe_destination_id = excluded.classe_destination_id, mention = excluded.mention,
      source = excluded.source, motif = excluded.motif, maj = now(), maj_par = auth.uid();
    insert into public.decisions_passage (etablissement_id, exercice_id, inscription_id, eleve_id, decision, niveau_destination_id, serie_destination_id,
      classe_destination_id, mention, mention_forcee, source, statut, motif, maj_par)
    select tr.etablissement_id, tr.exercice_source_id, l.inscription_id, l.eleve_id, l.decision, l.niveau_destination_id, l.serie_destination_id,
      l.classe_destination_id, l.mention, false, case when l.source = 'manuel' then 'manuel' else 'calcul' end, 'validee', l.motif, auth.uid()
      from public.transition_lignes l where l.transition_id = tr.id and l.inscription_id = i.id
    on conflict (inscription_id) do update set decision = excluded.decision, niveau_destination_id = excluded.niveau_destination_id,
      serie_destination_id = excluded.serie_destination_id, classe_destination_id = excluded.classe_destination_id,
      mention = case when public.decisions_passage.mention_forcee and public.decisions_passage.decision = excluded.decision then public.decisions_passage.mention else excluded.mention end,
      statut = 'validee', maj = now(), maj_par = auth.uid();
    n := n + 1;
  end loop;
  perform public._transition_journaliser(tr.etablissement_id, tr.id, 'decisions_enregistrees', '', jsonb_build_object('nombre', n));
  return n;
exception when check_violation then raise exception 'Décision inconnue.' using errcode = 'P0001';
end $$;

/** Simulation : effectifs par décision et anomalies (bloquantes ou à vérifier). */
create or replace function public.transition_simulation(p_transition uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare tr public.transitions := public._transition(p_transition, null); r jsonb;
begin
  with l as (
    select tl.*, btrim(e.nom || ' ' || e.prenom) eleve, e.matricule, e.date_naissance, co.libelle classe, co.niveau_id niveau_origine,
           cd.libelle classe_dest, cd.niveau_id niveau_classe_dest, cd.serie_id serie_classe_dest,
           (select ci.classe_id from public.inscriptions ci where ci.eleve_id = tl.eleve_id and ci.exercice_id = tr.exercice_cible_id
             and ci.id is distinct from tl.inscription_creee_id) deja_classe
      from public.transition_lignes tl join public.eleves e on e.id = tl.eleve_id
      left join public.classes co on co.id = tl.classe_origine_id left join public.classes cd on cd.id = tl.classe_destination_id
     where tl.transition_id = tr.id),
  anomalies as (
    select 'sans_destination' type, true bloquante, eleve, classe, 'Classe de destination à choisir' probleme from l
     where public._decision_inscrit(decision) and classe_destination_id is null
    union all select 'contradictoire', true, eleve, classe, 'Redoublant(e) mais classe de destination d''un autre niveau' from l
     where decision = 'redoublant' and niveau_classe_dest is not null and niveau_origine is not null and niveau_classe_dest <> niveau_origine
    union all select 'contradictoire', true, eleve, classe, 'Promu(e) mais classe de destination du même niveau' from l
     where decision in ('promu', 'change_cycle') and niveau_classe_dest is not null and niveau_origine is not null and niveau_classe_dest = niveau_origine
    union all select 'contradictoire', true, eleve, classe, 'Classe de destination hors du niveau choisi' from l
     where niveau_destination_id is not null and niveau_classe_dest is not null and niveau_classe_dest <> niveau_destination_id
    union all select 'contradictoire', true, eleve, classe, 'Classe de destination hors de la série choisie' from l
     where serie_destination_id is not null and classe_destination_id is not null and serie_classe_dest is distinct from serie_destination_id
    union all select 'contradictoire', true, eleve, classe, 'Classe de destination indiquée pour un élève qui quitte l''établissement' from l
     where decision in ('sortant', 'abandon', 'exclu', 'diplome') and classe_destination_id is not null
    union all select 'deja_inscrit', true, eleve, classe, 'Déjà inscrit(e) dans l''année cible dans une autre classe' from l
     where deja_classe is not null and deja_classe is distinct from classe_destination_id
    union all select 'incomplet', false, eleve, classe, 'Date de naissance manquante' from l where date_naissance is null
    union all select 'incomplet', false, eleve, classe, 'Classe d''origine sans niveau rattaché' from l where niveau_origine is null
    union all select 'non_analyse', true, btrim(e.nom || ' ' || e.prenom), c.libelle, 'Aucune décision enregistrée'
      from public.inscriptions i join public.eleves e on e.id = i.eleve_id join public.classes c on c.id = i.classe_id
     where i.exercice_id = tr.exercice_source_id and not exists (select 1 from public.transition_lignes x where x.transition_id = tr.id and x.inscription_id = i.id))
  select jsonb_build_object(
    'statut', tr.statut,
    'source', (select libelle from public.exercices where id = tr.exercice_source_id),
    'cible', (select libelle from public.exercices where id = tr.exercice_cible_id),
    'cible_active', (select actif from public.exercices where id = tr.exercice_cible_id),
    'inscrits', (select count(*) from public.inscriptions where exercice_id = tr.exercice_source_id),
    'analyses', (select count(*) from l),
    'par_decision', (select coalesce(jsonb_object_agg(decision, n), '{}'::jsonb) from (select decision, count(*) n from l group by decision) z),
    'promus', (select count(*) from l where decision in ('promu', 'admis_sous_condition', 'oriente', 'change_cycle', 'change_serie')),
    'redoublants', (select count(*) from l where decision = 'redoublant'),
    'transferts', (select count(*) from l where decision = 'transfere'),
    'sortants', (select count(*) from l where decision in ('sortant', 'abandon', 'exclu', 'diplome')),
    'manuels', (select count(*) from l where decision in ('attente_conseil', 'attente_reinscription')),
    'a_inscrire', (select count(*) from l where public._decision_inscrit(decision)),
    'inscrits_crees', (select count(*) from l where inscription_creee_id is not null),
    'anomalies', (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'bloquante', bloquante, 'eleve', eleve, 'classe', classe, 'probleme', probleme)
                    order by bloquante desc, type, classe, eleve), '[]'::jsonb) from anomalies),
    'bloquantes', (select count(*) from anomalies where bloquante)) into r;
  return r;
end $$;

/** Applique la transition : inscriptions dans l'année cible pour les élèves qui poursuivent. Refusé s'il reste une anomalie bloquante. */
create or replace function public.transition_appliquer(p_transition uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare tr public.transitions := public._transition(p_transition, 'preparation'); sim jsonb; l record; v_id uuid; n int := 0;
begin
  sim := public.transition_simulation(tr.id);
  if (sim ->> 'bloquantes')::int > 0 then
    raise exception 'Transition non appliquée : % anomalie(s) bloquante(s) à corriger (voir la simulation).', sim ->> 'bloquantes' using errcode = 'P0001';
  end if;
  for l in select * from public.transition_lignes where transition_id = tr.id and public._decision_inscrit(decision) loop
    select id into v_id from public.inscriptions where eleve_id = l.eleve_id and exercice_id = tr.exercice_cible_id;
    if v_id is null then
      insert into public.inscriptions (etablissement_id, exercice_id, classe_id, eleve_id, redoublant, nouveau)
      values (tr.etablissement_id, tr.exercice_cible_id, l.classe_destination_id, l.eleve_id, l.decision = 'redoublant', false) returning id into v_id;
      update public.transition_lignes set inscription_creee_id = v_id where id = l.id;
      n := n + 1;
    end if;
  end loop;
  update public.transitions set statut = 'appliquee', applique_par = auth.uid(), applique_le = now() where id = tr.id;
  perform public._transition_journaliser(tr.etablissement_id, tr.id, 'application', '', jsonb_build_object('inscriptions', n,
    'promus', sim -> 'promus', 'redoublants', sim -> 'redoublants', 'sortants', sim -> 'sortants', 'manuels', sim -> 'manuels'));
  return jsonb_build_object('inscriptions', n);
end $$;

/** Retour arrière avant clôture : supprime les inscriptions créées (refusé si des données ont déjà été saisies pour elles). */
create or replace function public.transition_annuler(p_transition uuid, p_motif text) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare tr public.transitions := public._transition(p_transition, 'appliquee'); ids uuid[]; n_dep int; n int;
begin
  if char_length(btrim(coalesce(p_motif, ''))) < 5 then raise exception 'Indiquez le motif du retour arrière.' using errcode = 'P0001'; end if;
  select coalesce(array_agg(inscription_creee_id), '{}') into ids from public.transition_lignes where transition_id = tr.id and inscription_creee_id is not null;
  select count(distinct x) into n_dep from (
    select inscription_id x from public.notes where inscription_id = any (ids) union all select inscription_id from public.absences where inscription_id = any (ids)
    union all select inscription_id from public.retards where inscription_id = any (ids) union all select inscription_id from public.incidents where inscription_id = any (ids)
    union all select inscription_id from public.paiements where inscription_id = any (ids) union all select inscription_id from public.cartes_scolaires where inscription_id = any (ids)) z;
  if n_dep > 0 then
    raise exception 'Retour arrière impossible : des données (notes, absences, paiements, cartes…) ont déjà été saisies pour % élève(s) dans la nouvelle année.', n_dep using errcode = 'P0001';
  end if;
  update public.transition_lignes set inscription_creee_id = null where transition_id = tr.id;
  delete from public.inscriptions where id = any (ids);
  get diagnostics n = row_count;
  update public.transitions set statut = 'preparation', applique_par = null, applique_le = null where id = tr.id;
  perform public._transition_journaliser(tr.etablissement_id, tr.id, 'retour_arriere', btrim(p_motif), jsonb_build_object('inscriptions_supprimees', n));
  return n;
end $$;

/** Clôture définitive (et activation de l'année cible si demandé). */
create or replace function public.transition_cloturer(p_transition uuid, p_activer boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare tr public.transitions := public._transition(p_transition, 'appliquee');
begin
  update public.transitions set statut = 'cloturee', cloture_par = auth.uid(), cloture_le = now() where id = tr.id;
  if coalesce(p_activer, false) then update public.exercices set actif = true where id = tr.exercice_cible_id; end if;
  perform public._transition_journaliser(tr.etablissement_id, tr.id, 'cloture', '', jsonb_build_object('annee_activee', coalesce(p_activer, false)));
end $$;

/** Annulation tracée d'une clôture : motif détaillé et confirmation écrite exigés. */
create or replace function public.transition_rouvrir(p_transition uuid, p_motif text, p_confirmation text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare tr public.transitions := public._transition(p_transition, 'cloturee');
begin
  if char_length(btrim(coalesce(p_motif, ''))) < 10 then raise exception 'Expliquez précisément la raison de l''annulation (10 caractères au moins).' using errcode = 'P0001'; end if;
  if upper(btrim(coalesce(p_confirmation, ''))) not in ('ANNULER LA CLÔTURE', 'ANNULER LA CLOTURE', 'CANCEL THE CLOSURE') then
    raise exception 'Confirmation incorrecte : saisissez « ANNULER LA CLÔTURE ».' using errcode = 'P0001'; end if;
  update public.transitions set statut = 'appliquee', cloture_par = null, cloture_le = null where id = tr.id;
  perform public._transition_journaliser(tr.etablissement_id, tr.id, 'annulation_cloture', btrim(p_motif), '{}'::jsonb);
end $$;

revoke execute on function public._transition_journaliser(uuid, uuid, text, text, jsonb), public._transition(uuid, text) from public, anon, authenticated;
revoke execute on function public.transition_preparer(uuid, text, jsonb), public.transition_enregistrer(uuid, jsonb), public.transition_simulation(uuid),
  public.transition_appliquer(uuid), public.transition_annuler(uuid, text), public.transition_cloturer(uuid, boolean), public.transition_rouvrir(uuid, text, text) from public, anon;
grant execute on function public.transition_preparer(uuid, text, jsonb), public.transition_enregistrer(uuid, jsonb), public.transition_simulation(uuid),
  public.transition_appliquer(uuid), public.transition_annuler(uuid, text), public.transition_cloturer(uuid, boolean), public.transition_rouvrir(uuid, text, text) to authenticated;
