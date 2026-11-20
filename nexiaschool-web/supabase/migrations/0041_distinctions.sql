-- Récompenses et distinctions (tableaux d'honneur, félicitations, encouragements, prix, majors, meilleure progression…).
--  * L'administration configure librement ses types de distinctions (rien n'est figé dans le code) : période, élèves
--    concernés (classes, niveaux, cycles, sections), critères (moyenne, matières, groupes, assiduité, discipline,
--    paiement, progression), mode de sélection, modèle de certificat personnalisable, visibilité.
--  * Les moyennes sont calculées dans l'application (comme pour les bulletins) ; la base reçoit la présélection, puis
--    l'administration valide, retire ou ajoute un élève (motif obligatoire). Chaque attribution validée reçoit un code
--    unique (QR code vérifiable sur nexiaschool.com/distinction/<code>).
--  * Une distinction validée ou publiée est figée : la modifier impose de la rouvrir avec un motif ; tout est journalisé.
--    Un lauréat retiré après validation voit son code révoqué (la vérification l'indique).
--  * Périodes personnalisées (semestres, etc.) : regroupements de séquences choisis par l'établissement.

-- ---------------------------------------------------------------------------------------------------------
-- Fonctionnalité réglable par établissement (comprise dans toutes les offres)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._fonctions_reglables() returns text[]
language sql immutable set search_path = '' as $$
  select array['notes', 'appel', 'bulletins', 'excel_base', 'plafonds',
               'discipline', 'finances', 'decisions', 'qr', 'excel', 'smarteval', 'edt', 'parents', 'statistiques', 'ia',
               'distinctions']
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
    else 'premium' end
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Périodes personnalisées : regroupements de séquences (ex. « Semestre 1 » = séquences 1, 2, 3)
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.periodes_personnalisees (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  libelle text not null check (char_length(btrim(libelle)) between 1 and 60),
  sequences smallint[] not null check (cardinality(sequences) between 1 and 6 and sequences <@ array[1, 2, 3, 4, 5, 6]::smallint[]),
  ordre smallint not null default 0,
  unique (etablissement_id, libelle)
);
alter table public.periodes_personnalisees enable row level security;
create policy "lecture de son établissement" on public.periodes_personnalisees for select to authenticated
  using (etablissement_id = (select public.etab_courant()));

create or replace function public.periode_perso_enregistrer(p_id uuid, p_libelle text, p_sequences smallint[]) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin(); v_id uuid; seqs smallint[];
begin
  select coalesce(array_agg(distinct x order by x), '{}') into seqs from unnest(p_sequences) x where x between 1 and 6;
  if cardinality(seqs) = 0 then raise exception 'Choisissez au moins une séquence.' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p_libelle, ''))) = 0 then raise exception 'Donnez un nom à la période.' using errcode = 'P0001'; end if;
  if p_id is null then
    insert into public.periodes_personnalisees (etablissement_id, libelle, sequences, ordre)
      values (v_etab, btrim(p_libelle), seqs, coalesce((select max(ordre) + 1 from public.periodes_personnalisees where etablissement_id = v_etab), 0))
      returning id into v_id;
  else
    update public.periodes_personnalisees set libelle = btrim(p_libelle), sequences = seqs
     where id = p_id and etablissement_id = v_etab returning id into v_id;
    if v_id is null then raise exception 'Période introuvable.' using errcode = 'P0001'; end if;
  end if;
  return jsonb_build_object('id', v_id);
exception when unique_violation then raise exception 'Une période porte déjà ce nom.' using errcode = 'P0001';
end $$;

create or replace function public.periode_perso_supprimer(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin();
begin
  if exists (select 1 from public.distinctions_sessions where etablissement_id = v_etab and periode = 'p:' || p_id::text) then
    raise exception 'Cette période a déjà servi à attribuer des distinctions : elle ne peut pas être supprimée.' using errcode = 'P0001';
  end if;
  delete from public.periodes_personnalisees where id = p_id and etablissement_id = v_etab;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Types de distinctions configurés par l'établissement
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.distinctions (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  nom text not null check (char_length(btrim(nom)) between 2 and 80),
  categorie text not null default 'specifique' check (categorie in ('tableau_honneur', 'felicitations', 'encouragements', 'mention_tb',
    'mention_b', 'prix_excellence', 'major_classe', 'major_etablissement', 'meilleure_progression', 'specifique')),
  periodicite text not null default 'trimestre' check (periodicite in ('sequence', 'trimestre', 'perso', 'annee')),
  cible jsonb not null default '{}'::jsonb check (jsonb_typeof(cible) = 'object'),             -- { classes, niveaux, cycles, sections }
  criteres jsonb not null default '{}'::jsonb check (jsonb_typeof(criteres) = 'object'),
  selection jsonb not null default '{"mode": "seuils"}'::jsonb check (jsonb_typeof(selection) = 'object'),
  modele text not null default 'classique' check (modele in ('classique', 'moderne', 'prestige', 'epure')),
  personnalisation jsonb not null default '{}'::jsonb check (jsonb_typeof(personnalisation) = 'object' and pg_column_size(personnalisation) < 8000),
  visible_parents boolean not null default true,      -- publiée dans l'espace parents
  imprimable boolean not null default true,           -- certificats imprimables
  active boolean not null default true,               -- false : distinction masquée (plus proposée, historique conservé)
  ordre smallint not null default 0,
  cree_le timestamptz not null default now(),
  maj timestamptz not null default now(),
  maj_par uuid,
  unique (etablissement_id, nom),
  unique (id, etablissement_id)
);
alter table public.distinctions enable row level security;
create policy "lecture de son établissement" on public.distinctions for select to authenticated
  using (etablissement_id = (select public.etab_courant()));

-- Une attribution : un type de distinction, pour un exercice et une période
create table if not exists public.distinctions_sessions (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  distinction_id uuid not null,
  exercice_id uuid not null,
  periode text not null check (periode ~ '^(s[1-6]|t[1-3]|a|p:[0-9a-f-]{36})$'),
  periode_libelle text not null check (char_length(periode_libelle) between 1 and 60),
  statut text not null default 'brouillon' check (statut in ('brouillon', 'validee', 'publiee')),
  configuration jsonb not null default '{}'::jsonb,   -- copie de la configuration utilisée (nom, critères, sélection, modèle…)
  cree_par uuid, cree_le timestamptz not null default now(),
  valide_par uuid, valide_le timestamptz,
  publie_par uuid, publie_le timestamptz,
  reouvertures smallint not null default 0,
  logo text check (logo is null or (logo ~ '^data:image/(png|jpeg|webp);base64,' and char_length(logo) < 1000000)),  -- pour les certificats de l'espace parents
  unique (distinction_id, exercice_id, periode),
  unique (id, etablissement_id),
  foreign key (distinction_id, etablissement_id) references public.distinctions (id, etablissement_id) on delete cascade,
  foreign key (exercice_id, etablissement_id) references public.exercices (id, etablissement_id) on delete cascade
);
create index if not exists distinctions_sessions_etab on public.distinctions_sessions (etablissement_id);
alter table public.distinctions_sessions enable row level security;
create policy "administration" on public.distinctions_sessions for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));

-- Les lauréats (présélectionnés automatiquement ou ajoutés à la main)
create table if not exists public.distinctions_attribuees (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null,
  session_id uuid not null,
  inscription_id uuid not null,
  eleve_id uuid not null,
  eleve text not null,
  matricule text not null default '',
  classe_id uuid,
  classe text not null default '',
  origine text not null default 'auto' check (origine in ('auto', 'manuel')),
  retenu boolean not null default true,
  motif text not null default '' check (char_length(motif) <= 300),
  valeurs jsonb not null default '{}'::jsonb,         -- moyenne, rang, progression… au moment de la présélection
  code text unique check (code ~ '^[A-HJ-NP-Z2-9]{12}$'),
  emis_le timestamptz,
  revoque_le timestamptz,
  unique (session_id, inscription_id),
  foreign key (session_id, etablissement_id) references public.distinctions_sessions (id, etablissement_id) on delete cascade,
  foreign key (inscription_id, etablissement_id) references public.inscriptions (id, etablissement_id) on delete cascade,
  foreign key (eleve_id, etablissement_id) references public.eleves (id, etablissement_id) on delete cascade
);
create index if not exists distinctions_attribuees_eleve on public.distinctions_attribuees (eleve_id);
create index if not exists distinctions_attribuees_inscription on public.distinctions_attribuees (inscription_id);
alter table public.distinctions_attribuees enable row level security;
create policy "administration" on public.distinctions_attribuees for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));

-- Journal : création, présélection, retrait, ajout, validation, publication, réouverture, suppression
create table if not exists public.distinctions_journal (
  id bigint generated always as identity primary key,
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  session_id uuid,
  attribution_id uuid,
  action text not null,
  motif text not null default '',
  details jsonb not null default '{}'::jsonb,
  par uuid,
  le timestamptz not null default now()
);
create index if not exists distinctions_journal_session on public.distinctions_journal (session_id);
alter table public.distinctions_journal enable row level security;
create policy "administration" on public.distinctions_journal for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));

create or replace function public._distinctions_journaliser(p_etab uuid, p_session uuid, p_attribution uuid, p_action text, p_motif text, p_details jsonb)
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.distinctions_journal (etablissement_id, session_id, attribution_id, action, motif, details, par)
  values (p_etab, p_session, p_attribution, p_action, coalesce(p_motif, ''), coalesce(p_details, '{}'::jsonb), auth.uid())
$$;

/** Contrôles communs : administration de l'établissement, fonctionnalité ouverte. Renvoie l'établissement. */
create or replace function public._distinctions_admin() returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin();
begin
  perform public._exiger_offre(v_etab, 'distinctions');
  return v_etab;
end $$;

-- Couleur au format #RRGGBB (ou absente)
create or replace function public._couleur_valide(v jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select v is null or jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^#[0-9a-fA-F]{6}$')
$$;

/**
 * Crée ou modifie un type de distinction. p = { id?, nom, categorie, periodicite, cible, criteres, selection, modele,
 * personnalisation, visible_parents, imprimable, active }. Renvoie l'identifiant.
 */
create or replace function public.distinction_enregistrer(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._distinctions_admin(); v_id uuid := nullif(p->>'id', '')::uuid; c jsonb := coalesce(p->'criteres', '{}'::jsonb);
        s jsonb := coalesce(p->'selection', '{"mode":"seuils"}'::jsonb); perso jsonb := coalesce(p->'personnalisation', '{}'::jsonb);
        k text;
begin
  if char_length(btrim(coalesce(p->>'nom', ''))) < 2 then raise exception 'Donnez un nom à la distinction.' using errcode = 'P0001'; end if;
  -- bornes des critères numériques (sur 20 ou nombres positifs)
  foreach k in array array['moyenne_min', 'moyenne_max', 'note_min_toutes', 'discipline_min'] loop
    if c ? k and jsonb_typeof(c->k) <> 'null' and ((c->>k)::numeric < 0 or (c->>k)::numeric > 20) then
      raise exception 'Critère « % » : valeur entre 0 et 20 attendue.', k using errcode = 'P0001'; end if;
  end loop;
  foreach k in array array['nj_max', 'retards_max', 'progression_min'] loop
    if c ? k and jsonb_typeof(c->k) <> 'null' and abs((c->>k)::numeric) > 2000 then
      raise exception 'Critère « % » : valeur hors limites.', k using errcode = 'P0001'; end if;
  end loop;
  if c ? 'moyenne_min' and c ? 'moyenne_max' and jsonb_typeof(c->'moyenne_min') <> 'null' and jsonb_typeof(c->'moyenne_max') <> 'null'
     and (c->>'moyenne_min')::numeric >= (c->>'moyenne_max')::numeric then
    raise exception 'La moyenne minimale doit être inférieure à la moyenne maximale.' using errcode = 'P0001'; end if;
  if coalesce(c->>'paiement', 'indifferent') not in ('indifferent', 'en_regle', 'solde') then
    raise exception 'Condition de paiement inconnue.' using errcode = 'P0001'; end if;
  if coalesce(s->>'mode', 'seuils') not in ('seuils', 'meilleurs')
     or coalesce(s->>'portee', 'classe') not in ('classe', 'niveau', 'cycle', 'etablissement')
     or coalesce(s->>'par', 'moyenne') not in ('moyenne', 'progression')
     or coalesce((s->>'nombre')::int, 1) not between 1 and 100 then
    raise exception 'Mode de sélection invalide.' using errcode = 'P0001'; end if;
  if not (public._couleur_valide(perso->'couleur') and public._couleur_valide(perso->'couleur2')) then
    raise exception 'Couleur invalide (format #RRGGBB attendu).' using errcode = 'P0001'; end if;
  if v_id is null then
    insert into public.distinctions (etablissement_id, nom, categorie, periodicite, cible, criteres, selection, modele, personnalisation,
                                     visible_parents, imprimable, active, ordre, maj_par)
    values (v_etab, btrim(p->>'nom'), coalesce(p->>'categorie', 'specifique'), coalesce(p->>'periodicite', 'trimestre'),
            coalesce(p->'cible', '{}'::jsonb), c, s, coalesce(p->>'modele', 'classique'), perso,
            coalesce((p->>'visible_parents')::boolean, true), coalesce((p->>'imprimable')::boolean, true), coalesce((p->>'active')::boolean, true),
            coalesce((select max(ordre) + 1 from public.distinctions where etablissement_id = v_etab), 0), auth.uid())
    returning id into v_id;
    perform public._distinctions_journaliser(v_etab, null, null, 'type_cree', '', jsonb_build_object('distinction', v_id, 'nom', btrim(p->>'nom')));
  else
    update public.distinctions set nom = btrim(p->>'nom'), categorie = coalesce(p->>'categorie', categorie), periodicite = coalesce(p->>'periodicite', periodicite),
           cible = coalesce(p->'cible', cible), criteres = c, selection = s, modele = coalesce(p->>'modele', modele), personnalisation = perso,
           visible_parents = coalesce((p->>'visible_parents')::boolean, visible_parents), imprimable = coalesce((p->>'imprimable')::boolean, imprimable),
           active = coalesce((p->>'active')::boolean, active), maj = now(), maj_par = auth.uid()
     where id = v_id and etablissement_id = v_etab;
    if not found then raise exception 'Distinction introuvable.' using errcode = 'P0001'; end if;
    perform public._distinctions_journaliser(v_etab, null, null, 'type_modifie', '', jsonb_build_object('distinction', v_id, 'nom', btrim(p->>'nom')));
  end if;
  return jsonb_build_object('id', v_id);
exception
  when unique_violation then raise exception 'Une distinction porte déjà ce nom.' using errcode = 'P0001';
  when check_violation then raise exception 'Valeur refusée : vérifiez la catégorie, la période et le modèle.' using errcode = 'P0001';
  when invalid_text_representation then raise exception 'Valeur numérique invalide dans les critères.' using errcode = 'P0001';
end $$;

/** Supprime un type de distinction jamais attribué ; s'il a déjà été validé, il faut le masquer (l'historique est conservé). */
create or replace function public.distinction_supprimer(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._distinctions_admin();
begin
  if exists (select 1 from public.distinctions_sessions where distinction_id = p_id and valide_le is not null) then
    raise exception 'Cette distinction a déjà été attribuée : masquez-la plutôt que de la supprimer (l''historique des élèves est conservé).' using errcode = 'P0001';
  end if;
  delete from public.distinctions where id = p_id and etablissement_id = v_etab;
  if found then perform public._distinctions_journaliser(v_etab, null, null, 'type_supprime', '', jsonb_build_object('distinction', p_id)); end if;
end $$;

/** Crée les distinctions usuelles (si l'établissement n'en a aucune) ; l'administration les adapte ensuite. */
create or replace function public.distinctions_initialiser() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._distinctions_admin(); n int;
begin
  if exists (select 1 from public.distinctions where etablissement_id = v_etab) then return 0; end if;
  insert into public.distinctions (etablissement_id, nom, categorie, periodicite, criteres, selection, modele, ordre, maj_par)
  select v_etab, x.nom, x.categorie, x.periodicite, x.criteres::jsonb, x.selection::jsonb, x.modele, x.ordre, auth.uid() from (values
    ('Tableau d''honneur', 'tableau_honneur', 'trimestre', '{"moyenne_min": 12, "discipline_min": 12, "sans_sanction": true}', '{"mode":"seuils"}', 'classique', 0),
    ('Encouragements', 'encouragements', 'trimestre', '{"moyenne_min": 12, "moyenne_max": 14, "discipline_min": 12}', '{"mode":"seuils"}', 'epure', 1),
    ('Félicitations', 'felicitations', 'trimestre', '{"moyenne_min": 14, "discipline_min": 14, "sans_sanction": true}', '{"mode":"seuils"}', 'moderne', 2),
    ('Mention Très bien', 'mention_tb', 'annee', '{"moyenne_min": 16}', '{"mode":"seuils"}', 'prestige', 3),
    ('Mention Bien', 'mention_b', 'annee', '{"moyenne_min": 14, "moyenne_max": 16}', '{"mode":"seuils"}', 'classique', 4),
    ('Prix d''excellence', 'prix_excellence', 'annee', '{"moyenne_min": 15, "note_min_toutes": 10, "sans_sanction": true}', '{"mode":"seuils"}', 'prestige', 5),
    ('Meilleur élève de la classe', 'major_classe', 'trimestre', '{"moyenne_min": 10}', '{"mode":"meilleurs","portee":"classe","nombre":1,"par":"moyenne"}', 'moderne', 6),
    ('Meilleur élève de l''établissement', 'major_etablissement', 'annee', '{"moyenne_min": 10}', '{"mode":"meilleurs","portee":"etablissement","nombre":1,"par":"moyenne"}', 'prestige', 7),
    ('Meilleure progression', 'meilleure_progression', 'trimestre', '{"progression_min": 1}', '{"mode":"meilleurs","portee":"classe","nombre":1,"par":"progression"}', 'epure', 8)
  ) as x(nom, categorie, periodicite, criteres, selection, modele, ordre);
  get diagnostics n = row_count;
  perform public._distinctions_journaliser(v_etab, null, null, 'types_initialises', '', jsonb_build_object('nombre', n));
  return n;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Attribution : présélection, décisions manuelles, validation, publication, réouverture
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._distinctions_session_brouillon(p_session uuid, p_etab uuid) returns public.distinctions_sessions
language plpgsql volatile security definer set search_path = '' as $$
declare s public.distinctions_sessions;
begin
  select * into s from public.distinctions_sessions where id = p_session and etablissement_id = p_etab for update;
  if s.id is null then raise exception 'Attribution introuvable.' using errcode = 'P0001'; end if;
  if s.statut <> 'brouillon' then
    raise exception 'Cette distinction est déjà validée : rouvrez-la (avec un motif) pour la modifier.' using errcode = 'P0001';
  end if;
  return s;
end $$;

/**
 * Enregistre (ou recalcule) la présélection d'une distinction pour la période, dans l'exercice actif.
 * p_candidats = [{ inscription_id, valeurs: { moyenne, rang, progression, … } }]
 * Les lauréats proposés automatiquement sont remplacés ; les ajouts manuels et les retraits motivés sont conservés.
 */
create or replace function public.distinctions_preselection(p_distinction uuid, p_periode text, p_libelle text, p_candidats jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._distinctions_admin(); ex uuid; d public.distinctions; s public.distinctions_sessions; n int;
begin
  select * into d from public.distinctions where id = p_distinction and etablissement_id = v_etab;
  if d.id is null then raise exception 'Distinction introuvable.' using errcode = 'P0001'; end if;
  if not d.active then raise exception 'Cette distinction est masquée : réactivez-la d''abord.' using errcode = 'P0001'; end if;
  select id into ex from public.exercices where etablissement_id = v_etab and actif;
  if ex is null then raise exception 'Activez d''abord un exercice.' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_candidats, '[]'::jsonb)) <> 'array' then raise exception 'Liste de candidats invalide.' using errcode = 'P0001'; end if;
  if p_periode !~ '^(s[1-6]|t[1-3]|a|p:[0-9a-f-]{36})$' then raise exception 'Période invalide.' using errcode = 'P0001'; end if;
  if p_periode like 'p:%' and not exists (select 1 from public.periodes_personnalisees where etablissement_id = v_etab and id::text = substr(p_periode, 3)) then
    raise exception 'Période personnalisée introuvable.' using errcode = 'P0001'; end if;

  select * into s from public.distinctions_sessions where distinction_id = d.id and exercice_id = ex and periode = p_periode for update;
  if s.id is null then
    insert into public.distinctions_sessions (etablissement_id, distinction_id, exercice_id, periode, periode_libelle, configuration, cree_par)
    values (v_etab, d.id, ex, p_periode, left(coalesce(nullif(btrim(p_libelle), ''), p_periode), 60), to_jsonb(d) - 'etablissement_id', auth.uid())
    returning * into s;
  elsif s.statut <> 'brouillon' then
    raise exception 'Cette distinction est déjà validée : rouvrez-la (avec un motif) pour la recalculer.' using errcode = 'P0001';
  else
    update public.distinctions_sessions set configuration = to_jsonb(d) - 'etablissement_id', periode_libelle = left(coalesce(nullif(btrim(p_libelle), ''), periode_libelle), 60)
     where id = s.id;
  end if;

  -- candidats valables : inscriptions de l'exercice actif, dans l'établissement
  drop table if exists pg_temp._cand;
  create temp table _cand on commit drop as
    select i.id inscription_id, i.eleve_id, i.classe_id, c.libelle classe, el.matricule,
           btrim(el.nom || ' ' || el.prenom) eleve, coalesce(x->'valeurs', '{}'::jsonb) valeurs
      from jsonb_array_elements(coalesce(p_candidats, '[]'::jsonb)) x
      join public.inscriptions i on i.id = nullif(x->>'inscription_id', '')::uuid and i.etablissement_id = v_etab and i.exercice_id = ex
      join public.eleves el on el.id = i.eleve_id join public.classes c on c.id = i.classe_id;
  delete from public.distinctions_attribuees a where a.session_id = s.id and a.origine = 'auto'
     and not exists (select 1 from _cand c where c.inscription_id = a.inscription_id);
  insert into public.distinctions_attribuees (etablissement_id, session_id, inscription_id, eleve_id, eleve, matricule, classe_id, classe, origine, valeurs)
  select v_etab, s.id, c.inscription_id, c.eleve_id, c.eleve, c.matricule, c.classe_id, c.classe, 'auto', c.valeurs from _cand c
  on conflict (session_id, inscription_id) do update set valeurs = excluded.valeurs, eleve = excluded.eleve, classe = excluded.classe, classe_id = excluded.classe_id;
  select count(*) into n from _cand;
  perform public._distinctions_journaliser(v_etab, s.id, null, 'preselection', '', jsonb_build_object('candidats', n, 'periode', p_periode));
  return jsonb_build_object('session_id', s.id, 'candidats', n);
end $$;

/** Retenir ou retirer un élève de la présélection (motif obligatoire pour un retrait). */
create or replace function public.distinctions_decider(p_attribution uuid, p_retenu boolean, p_motif text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._distinctions_admin(); a public.distinctions_attribuees;
begin
  select * into a from public.distinctions_attribuees where id = p_attribution and etablissement_id = v_etab;
  if a.id is null then raise exception 'Élève introuvable dans cette distinction.' using errcode = 'P0001'; end if;
  perform public._distinctions_session_brouillon(a.session_id, v_etab);
  if not p_retenu and char_length(btrim(coalesce(p_motif, ''))) < 3 then
    raise exception 'Indiquez le motif du retrait.' using errcode = 'P0001'; end if;
  update public.distinctions_attribuees set retenu = p_retenu, motif = left(btrim(coalesce(p_motif, '')), 300) where id = a.id;
  perform public._distinctions_journaliser(v_etab, a.session_id, a.id, case when p_retenu then 'retenu' else 'retire' end, btrim(coalesce(p_motif, '')),
                                           jsonb_build_object('eleve', a.eleve, 'classe', a.classe));
end $$;

/** Ajouter manuellement un élève (motif obligatoire), par exemple une dérogation décidée par la direction. */
create or replace function public.distinctions_ajouter(p_session uuid, p_inscription uuid, p_motif text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._distinctions_admin(); s public.distinctions_sessions; v_id uuid; i record;
begin
  s := public._distinctions_session_brouillon(p_session, v_etab);
  if char_length(btrim(coalesce(p_motif, ''))) < 3 then raise exception 'Indiquez le motif de l''ajout.' using errcode = 'P0001'; end if;
  select ins.id, ins.eleve_id, ins.classe_id, c.libelle classe, el.matricule, btrim(el.nom || ' ' || el.prenom) eleve into i
    from public.inscriptions ins join public.eleves el on el.id = ins.eleve_id join public.classes c on c.id = ins.classe_id
   where ins.id = p_inscription and ins.etablissement_id = v_etab and ins.exercice_id = s.exercice_id;
  if i.id is null then raise exception 'Élève introuvable pour cet exercice.' using errcode = 'P0001'; end if;
  insert into public.distinctions_attribuees (etablissement_id, session_id, inscription_id, eleve_id, eleve, matricule, classe_id, classe, origine, retenu, motif)
  values (v_etab, s.id, i.id, i.eleve_id, i.eleve, i.matricule, i.classe_id, i.classe, 'manuel', true, left(btrim(p_motif), 300))
  on conflict (session_id, inscription_id) do update set retenu = true, motif = excluded.motif
  returning id into v_id;
  perform public._distinctions_journaliser(v_etab, s.id, v_id, 'ajoute', btrim(p_motif), jsonb_build_object('eleve', i.eleve, 'classe', i.classe));
  return jsonb_build_object('id', v_id);
end $$;

/** Valide la liste : chaque lauréat retenu reçoit son code de vérification ; un lauréat retiré après une validation précédente est révoqué. */
create or replace function public.distinctions_valider(p_session uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._distinctions_admin(); s public.distinctions_sessions; a record; n int := 0; r int := 0; essais int;
begin
  s := public._distinctions_session_brouillon(p_session, v_etab);
  for a in select id from public.distinctions_attribuees where session_id = s.id and retenu and code is null loop
    essais := 0;
    loop
      begin
        update public.distinctions_attribuees set code = public._code_bulletin(), emis_le = now(), revoque_le = null where id = a.id;
        exit;
      exception when unique_violation then
        essais := essais + 1; if essais > 5 then raise; end if;
      end;
    end loop;
    n := n + 1;
  end loop;
  update public.distinctions_attribuees set revoque_le = null where session_id = s.id and retenu and revoque_le is not null;
  update public.distinctions_attribuees set revoque_le = now() where session_id = s.id and not retenu and code is not null and revoque_le is null;
  get diagnostics r = row_count;
  update public.distinctions_sessions set statut = 'validee', valide_par = auth.uid(), valide_le = now() where id = s.id;
  perform public._distinctions_journaliser(v_etab, s.id, null, 'validation', '', jsonb_build_object(
    'laureats', (select count(*) from public.distinctions_attribuees where session_id = s.id and retenu), 'nouveaux_codes', n, 'revoques', r));
  return jsonb_build_object('laureats', (select count(*) from public.distinctions_attribuees where session_id = s.id and retenu), 'revoques', r);
end $$;

/** Publie (espace parents) ou dépublie une distinction validée ; p_logo : logo de l'établissement (image en ligne) pour les certificats des parents. */
create or replace function public.distinctions_publier(p_session uuid, p_publier boolean, p_logo text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._distinctions_admin(); s public.distinctions_sessions;
begin
  select * into s from public.distinctions_sessions where id = p_session and etablissement_id = v_etab for update;
  if s.id is null then raise exception 'Attribution introuvable.' using errcode = 'P0001'; end if;
  if s.statut = 'brouillon' then raise exception 'Validez d''abord la liste des lauréats.' using errcode = 'P0001'; end if;
  update public.distinctions_sessions set statut = case when p_publier then 'publiee' else 'validee' end,
         publie_par = case when p_publier then auth.uid() else publie_par end, publie_le = case when p_publier then now() else publie_le end,
         logo = case when p_publier and p_logo ~ '^data:image/(png|jpeg|webp);base64,' and char_length(p_logo) < 1000000 then p_logo else logo end
   where id = s.id;
  perform public._distinctions_journaliser(v_etab, s.id, null, case when p_publier then 'publication' else 'depublication' end, '', '{}'::jsonb);
end $$;

/** Rouvre une distinction validée ou publiée pour la modifier : motif obligatoire, retirée de l'espace parents, journalisée. */
create or replace function public.distinctions_rouvrir(p_session uuid, p_motif text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._distinctions_admin(); s public.distinctions_sessions;
begin
  select * into s from public.distinctions_sessions where id = p_session and etablissement_id = v_etab for update;
  if s.id is null then raise exception 'Attribution introuvable.' using errcode = 'P0001'; end if;
  if s.statut = 'brouillon' then return; end if;
  if char_length(btrim(coalesce(p_motif, ''))) < 5 then raise exception 'Indiquez le motif de la modification.' using errcode = 'P0001'; end if;
  update public.distinctions_sessions set statut = 'brouillon', reouvertures = reouvertures + 1 where id = s.id;
  perform public._distinctions_journaliser(v_etab, s.id, null, 'reouverture', btrim(p_motif), jsonb_build_object('statut_precedent', s.statut));
end $$;

/** Supprime une attribution jamais validée (brouillon abandonné). */
create or replace function public.distinctions_supprimer_session(p_session uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._distinctions_admin(); s public.distinctions_sessions;
begin
  s := public._distinctions_session_brouillon(p_session, v_etab);
  if s.valide_le is not null then
    raise exception 'Cette distinction a déjà été validée : elle ne peut plus être supprimée (rouvrez-la et retirez les élèves avec un motif).' using errcode = 'P0001';
  end if;
  delete from public.distinctions_sessions where id = s.id;
  perform public._distinctions_journaliser(v_etab, null, null, 'brouillon_supprime', '', jsonb_build_object('session', s.id, 'periode', s.periode));
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Vérification publique (QR code) et espace parents
-- ---------------------------------------------------------------------------------------------------------
/** Page publique ouverte par le QR code : établissement, élève, distinction, statut (valide ou révoquée). Aucun motif ni donnée interne. */
create or replace function public.verifier_distinction(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'etablissement', jsonb_build_object('nom', e.nom, 'ville', e.ville, 'adresse', e.adresse, 'telephone', e.telephone, 'devise', e.devise,
                                        'site_web', e.site_web, 'nom_chef', e.nom_chef, 'actif', e.suspendu_le is null),
    'distinction', jsonb_build_object('nom', coalesce(s.configuration->>'nom', d.nom), 'categorie', d.categorie, 'periode', s.periode_libelle,
                                      'annee', x.libelle, 'eleve', a.eleve, 'matricule', a.matricule, 'classe', a.classe,
                                      'moyenne', a.valeurs->'moyenne', 'emis_le', a.emis_le,
                                      'statut', case when a.revoque_le is not null then 'revoquee' else 'valide' end, 'revoque_le', a.revoque_le))
    from public.distinctions_attribuees a
    join public.distinctions_sessions s on s.id = a.session_id
    join public.distinctions d on d.id = s.distinction_id
    join public.exercices x on x.id = s.exercice_id
    join public.etablissements e on e.id = a.etablissement_id
   where a.code = upper(btrim(coalesce(p_code, ''))) and a.emis_le is not null
$$;

/** Distinctions publiées de l'enfant (toutes années), pour l'espace parents. */
create or replace function public.parent_distinctions(p_session text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s record;
begin
  select * into s from public._parent_session(p_session);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'nom', coalesce(ss.configuration->>'nom', d.nom), 'categorie', d.categorie, 'periode', ss.periode_libelle, 'annee', x.libelle,
      'classe', a.classe, 'valeurs', a.valeurs, 'code', a.code, 'emis_le', a.emis_le, 'imprimable', d.imprimable,
      'modele', d.modele, 'personnalisation', d.personnalisation, 'logo', ss.logo, 'matricule', a.matricule, 'eleve', a.eleve)
      order by a.emis_le desc), '[]'::jsonb)
    from public.distinctions_attribuees a
    join public.distinctions_sessions ss on ss.id = a.session_id and ss.statut = 'publiee'
    join public.distinctions d on d.id = ss.distinction_id and d.visible_parents and d.active
    join public.exercices x on x.id = ss.exercice_id
   where a.eleve_id = s.eleve and a.etablissement_id = s.etab and a.retenu and a.revoque_le is null and a.code is not null);
end $$;

-- Droits d'exécution
revoke execute on function public._distinctions_journaliser(uuid, uuid, uuid, text, text, jsonb), public._distinctions_admin(),
  public._distinctions_session_brouillon(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.periode_perso_enregistrer(uuid, text, smallint[]), public.periode_perso_supprimer(uuid),
  public.distinction_enregistrer(jsonb), public.distinction_supprimer(uuid), public.distinctions_initialiser(),
  public.distinctions_preselection(uuid, text, text, jsonb), public.distinctions_decider(uuid, boolean, text), public.distinctions_ajouter(uuid, uuid, text),
  public.distinctions_valider(uuid), public.distinctions_publier(uuid, boolean, text), public.distinctions_rouvrir(uuid, text),
  public.distinctions_supprimer_session(uuid) from public, anon;
grant execute on function public.periode_perso_enregistrer(uuid, text, smallint[]), public.periode_perso_supprimer(uuid),
  public.distinction_enregistrer(jsonb), public.distinction_supprimer(uuid), public.distinctions_initialiser(),
  public.distinctions_preselection(uuid, text, text, jsonb), public.distinctions_decider(uuid, boolean, text), public.distinctions_ajouter(uuid, uuid, text),
  public.distinctions_valider(uuid), public.distinctions_publier(uuid, boolean, text), public.distinctions_rouvrir(uuid, text),
  public.distinctions_supprimer_session(uuid) to authenticated;
grant execute on function public.verifier_distinction(text), public.parent_distinctions(text) to anon, authenticated;

-- Tables : lecture selon les règles ci-dessus, écritures uniquement par les fonctions
revoke all on public.periodes_personnalisees, public.distinctions, public.distinctions_sessions, public.distinctions_attribuees,
  public.distinctions_journal from anon, authenticated;
grant select on public.periodes_personnalisees, public.distinctions, public.distinctions_sessions, public.distinctions_attribuees,
  public.distinctions_journal to authenticated;
