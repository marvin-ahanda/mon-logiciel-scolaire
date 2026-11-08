-- SmartEval : évaluations digitalisées (formulaires en ligne façon Google Forms), corrigées automatiquement,
-- analysées ensuite par l'IA connectée au compte de l'enseignant (serveur MCP).
--  * tout membre actif du personnel peut créer une évaluation pour une matière qui lui est confiée, sur la séquence en cours ;
--  * préalable : une IA connectée à son compte (clé API active ou application autorisée par OAuth) ;
--  * le lien public (jeton aléatoire) n'accepte les réponses que pendant la durée choisie par l'enseignant ;
--  * chaque envoi d'élève est corrigé en base (les corrigés ne quittent jamais le serveur vers les élèves) ;
--  * seul l'auteur voit ses évaluations, les soumissions et la bulle de notification (lecture propre à chaque compte).
-- Aucun accès direct aux tables : tout passe par les fonctions ci-dessous.

create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  auteur_id uuid not null,
  exercice_id uuid not null references public.exercices (id) on delete cascade,
  sequence_id uuid not null references public.sequences (id) on delete cascade,
  matiere_id uuid not null references public.matieres (id) on delete cascade,
  classes uuid[] not null check (cardinality(classes) between 1 and 30),
  titre text not null check (char_length(btrim(titre)) between 1 and 150),
  consignes text not null default '' check (char_length(consignes) <= 3000),
  competence text not null check (char_length(btrim(competence)) between 1 and 600),
  questions jsonb not null check (jsonb_typeof(questions) = 'array'),
  entete jsonb not null default '{}'::jsonb check (pg_column_size(entete) <= 250000),
  duree_valeur smallint check (duree_valeur between 1 and 1000),
  duree_unite text check (duree_unite in ('heures', 'jours', 'semaines')),
  jeton text unique check (jeton ~ '^[A-Za-z0-9_-]{20,40}$'),
  publiee_le timestamptz,
  ferme_le timestamptz,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  foreign key (auteur_id, etablissement_id) references public.personnels (id, etablissement_id) on delete cascade
);
create index if not exists evaluations_auteur on public.evaluations (auteur_id, cree_le desc);

create table if not exists public.soumissions (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.evaluations (id) on delete cascade,
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  numero integer not null,
  nom text not null check (char_length(btrim(nom)) between 1 and 100),
  prenom text not null check (char_length(btrim(prenom)) between 1 and 100),
  classe_id uuid not null,
  classe text not null,
  inscription_id uuid references public.inscriptions (id) on delete set null,
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
create index if not exists soumissions_evaluation on public.soumissions (evaluation_id, soumis_le desc);

-- Dernière consultation des soumissions par chaque compte (bulle de notification)
create table if not exists public.smarteval_vues (
  personnel_id uuid primary key references public.personnels (id) on delete cascade,
  vu_jusqua timestamptz not null default now()
);

alter table public.evaluations enable row level security;
alter table public.soumissions enable row level security;
alter table public.smarteval_vues enable row level security;
revoke all on public.evaluations, public.soumissions, public.smarteval_vues from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Outils internes
-- ---------------------------------------------------------------------------------------------------------
-- Comparaison souple des réponses courtes : casse, accents, espaces, virgule décimale
create or replace function public._smarteval_norm(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(regexp_replace(btrim(lower(translate(coalesce(p, ''),
    'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÝýÿŒœÆæ’',
    'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOOooooooUUUUuuuuYyyOoAa'''))), '\s+', ' ', 'g'), '(\d),(\d)', '\1.\2', 'g')
$$;

-- IA connectée au compte : accès API activé pour l'établissement et clé active ou application autorisée
create or replace function public._smarteval_ia(p_personnel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select e.api_active and e.suspendu_le is null from public.personnels p join public.etablissements e on e.id = p.etablissement_id
                    where p.id = p_personnel and p.actif), false)
     and (exists (select 1 from public.cles_api where personnel_id = p_personnel and revoquee_le is null and (expire_le is null or expire_le > now()))
       or exists (select 1 from public.jetons_oauth where personnel_id = p_personnel and revoque_le is null and rafraichissement_expire_le > now()))
$$;

-- Séquence en cours : la première séquence non verrouillée de l'exercice actif (les autres sont verrouillées par l'administration)
create or replace function public._smarteval_sequence(p_etab uuid) returns table (id uuid, numero smallint, exercice_id uuid)
language sql stable security definer set search_path = '' as $$
  select s.id, s.numero, s.exercice_id from public.sequences s join public.exercices x on x.id = s.exercice_id
   where x.etablissement_id = p_etab and x.actif and not s.verrouillee order by s.numero limit 1
$$;

-- Questions : nettoyage et contrôle (types, options, corrigé, barème)
create or replace function public._smarteval_questions(p jsonb) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  q jsonb; r jsonb := '[]'::jsonb; n int := 0; ids text[] := '{}'; v_id text; v_type text; v_int text;
  opts jsonb; o jsonb; bonnes jsonb; b jsonb; acc jsonb; a jsonb; nb int; v_min int; v_max int; pts numeric;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) = 0 then
    raise exception 'Ajoutez au moins une question.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p) > 100 then raise exception '100 questions au plus.' using errcode = 'P0001'; end if;
  for q in select * from jsonb_array_elements(p) loop
    n := n + 1;
    if jsonb_typeof(q) <> 'object' then raise exception 'Question % invalide.', n using errcode = 'P0001'; end if;
    v_id := coalesce(nullif(q ->> 'id', ''), 'q' || n);
    if v_id !~ '^[A-Za-z0-9_-]{1,24}$' or v_id = any (ids) then v_id := 'q' || n || '_' || substr(md5(random()::text), 1, 4); end if;
    ids := ids || v_id;
    v_type := coalesce(q ->> 'type', 'courte');
    if v_type not in ('courte', 'paragraphe', 'choix', 'cases', 'liste', 'echelle') then
      raise exception 'Question % : type « % » inconnu.', n, v_type using errcode = 'P0001';
    end if;
    v_int := btrim(coalesce(q ->> 'intitule', ''));
    if v_int = '' then raise exception 'Question % : écrivez l''intitulé de la question.', n using errcode = 'P0001'; end if;
    if char_length(v_int) > 1000 then raise exception 'Question % : intitulé trop long (1 000 caractères au plus).', n using errcode = 'P0001'; end if;
    pts := case when jsonb_typeof(q -> 'points') = 'number' then least(greatest((q ->> 'points')::numeric, 0), 100) else 0 end;
    opts := '[]'::jsonb; bonnes := '[]'::jsonb; acc := '[]'::jsonb;
    if v_type in ('choix', 'cases', 'liste') then
      for o in select * from jsonb_array_elements(coalesce(q -> 'options', '[]'::jsonb)) loop
        if jsonb_typeof(o) = 'string' and btrim(o #>> '{}') <> '' then opts := opts || to_jsonb(left(btrim(o #>> '{}'), 300)); end if;
      end loop;
      nb := jsonb_array_length(opts);
      if nb = 0 then raise exception 'Question % : ajoutez au moins une option de réponse.', n using errcode = 'P0001'; end if;
      if nb > 30 then raise exception 'Question % : 30 options au plus.', n using errcode = 'P0001'; end if;
      for b in select * from jsonb_array_elements(coalesce(q -> 'bonnes', '[]'::jsonb)) loop
        if jsonb_typeof(b) = 'number' and (b #>> '{}')::numeric between 0 and nb - 1 and not bonnes @> jsonb_build_array((b #>> '{}')::int) then
          bonnes := bonnes || jsonb_build_array((b #>> '{}')::int);
        end if;
      end loop;
      if v_type in ('choix', 'liste') and jsonb_array_length(bonnes) > 1 then bonnes := jsonb_build_array(bonnes -> 0); end if;
    elsif v_type = 'courte' then
      for a in select * from jsonb_array_elements(coalesce(q -> 'acceptees', '[]'::jsonb)) loop
        if jsonb_typeof(a) = 'string' and btrim(a #>> '{}') <> '' and jsonb_array_length(acc) < 20 then acc := acc || to_jsonb(left(btrim(a #>> '{}'), 200)); end if;
      end loop;
    end if;
    v_min := case when (q #>> '{echelle,min}') = '0' then 0 else 1 end;
    v_max := case when jsonb_typeof(q #> '{echelle,max}') = 'number' then least(greatest((q #>> '{echelle,max}')::numeric, 2), 10)::int else 5 end;
    r := r || jsonb_build_object(
      'id', v_id, 'type', v_type, 'intitule', v_int,
      'aide', left(btrim(coalesce(q ->> 'aide', '')), 500),
      'obligatoire', coalesce(q -> 'obligatoire' = 'true'::jsonb, false),
      'points', pts,
      'notion', left(btrim(coalesce(q ->> 'notion', '')), 120),
      'options', opts, 'bonnes', bonnes, 'acceptees', acc,
      'echelle', case when v_type = 'echelle' then jsonb_build_object('min', v_min, 'max', v_max,
        'libelle_min', left(btrim(coalesce(q #>> '{echelle,libelle_min}', '')), 60), 'libelle_max', left(btrim(coalesce(q #>> '{echelle,libelle_max}', '')), 60)) end);
  end loop;
  return r;
end $$;

-- Statut d'une évaluation
create or replace function public._smarteval_statut(e public.evaluations) returns text
language sql stable set search_path = '' as $$
  select case when e.jeton is null then 'brouillon' when now() < e.publiee_le then 'programmee'
              when now() <= e.ferme_le then 'ouverte' else 'close' end
$$;

create or replace function public._smarteval_matieres(p_personnel uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('matiere_id', m.id, 'code', m.code, 'libelle', m.libelle,
           'classes', (select jsonb_agg(jsonb_build_object('id', c.id, 'libelle', c.libelle) order by c.ordre, c.libelle)
                         from public.attributions a2 join public.classes c on c.id = a2.classe_id
                        where a2.matiere_id = m.id and a2.enseignant_id = p_personnel and a2.exercice_id = x.id))
         order by m.libelle), '[]'::jsonb)
    from public.matieres m
    join public.personnels p on p.id = p_personnel and p.etablissement_id = m.etablissement_id
    join public.exercices x on x.etablissement_id = m.etablissement_id and x.actif
   where exists (select 1 from public.attributions a where a.matiere_id = m.id and a.enseignant_id = p_personnel and a.exercice_id = x.id)
$$;

-- Évaluation complète (avec corrigés) : réservée à l'auteur
create or replace function public._smarteval_json(e public.evaluations, p_corriges boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', e.id, 'titre', e.titre, 'consignes', e.consignes, 'competence', e.competence,
    'matiere_id', e.matiere_id, 'matiere', m.libelle, 'sequence_id', e.sequence_id, 'sequence', s.numero, 'trimestre', s.trimestre,
    'annee', x.libelle, 'classes', (select jsonb_agg(jsonb_build_object('id', c.id, 'libelle', c.libelle) order by c.ordre, c.libelle)
                                       from public.classes c where c.id = any (e.classes)),
    'questions', case when p_corriges then e.questions
                      else (select coalesce(jsonb_agg(q - 'bonnes' - 'acceptees' order by o), '[]'::jsonb) from jsonb_array_elements(e.questions) with ordinality t(q, o)) end,
    'entete', e.entete, 'duree_valeur', e.duree_valeur, 'duree_unite', e.duree_unite,
    'jeton', case when p_corriges then e.jeton end, 'publiee_le', e.publiee_le, 'ferme_le', e.ferme_le,
    'statut', public._smarteval_statut(e), 'cree_le', e.cree_le,
    'auteur', (select btrim(p.nom || ' ' || p.prenom) from public.personnels p where p.id = e.auteur_id))
  from public.matieres m, public.sequences s, public.exercices x
  where m.id = e.matiere_id and s.id = e.sequence_id and x.id = e.exercice_id
$$;

create or replace function public._smarteval_mienne(p_id uuid) returns public.evaluations
language plpgsql stable security definer set search_path = '' as $$
declare e public.evaluations;
begin
  select * into e from public.evaluations where id = p_id and auteur_id = auth.uid() and etablissement_id = public.etab_courant();
  if e.id is null then raise exception 'Évaluation introuvable.' using errcode = 'P0001'; end if;
  return e;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Espace de l'enseignant
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.smarteval_contexte() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); s record;
begin
  if v_etab is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  select * into s from public._smarteval_sequence(v_etab);
  return jsonb_build_object(
    'ia_connectee', public._smarteval_ia(auth.uid()),
    'api_active', (select api_active from public.etablissements where id = v_etab),
    'sequence', case when s.id is not null then jsonb_build_object('id', s.id, 'numero', s.numero) end,
    'matieres', public._smarteval_matieres(auth.uid()));
end $$;

/**
 * Enregistre (crée ou modifie) une évaluation non publiée.
 * p = { id?, titre, consignes, competence, matiere_id, classes: [uuid], questions: [...] }
 */
create or replace function public.smarteval_enregistrer(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_etab uuid := public.etab_courant(); v_id uuid := nullif(p ->> 'id', '')::uuid; e public.evaluations; s record;
  v_classes uuid[]; v_mat uuid := nullif(p ->> 'matiere_id', '')::uuid; v_q jsonb;
begin
  if v_etab is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  if not public._smarteval_ia(auth.uid()) then
    raise exception 'Préalable : connectez une IA (Claude, Grok…) à votre compte dans la rubrique « IA et API ».' using errcode = 'P0001';
  end if;
  select * into s from public._smarteval_sequence(v_etab);
  if s.id is null then raise exception 'Aucune séquence en cours : toutes les séquences sont verrouillées.' using errcode = 'P0001'; end if;
  if btrim(coalesce(p ->> 'titre', '')) = '' then raise exception 'Donnez un titre à l''évaluation.' using errcode = 'P0001'; end if;
  if btrim(coalesce(p ->> 'competence', '')) = '' then raise exception 'Indiquez la compétence visée.' using errcode = 'P0001'; end if;
  if v_mat is null or not exists (select 1 from public.attributions where matiere_id = v_mat and enseignant_id = auth.uid() and exercice_id = s.exercice_id) then
    raise exception 'Choisissez une matière qui vous est confiée cette année.' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct a.classe_id), '{}') into v_classes from public.attributions a
   where a.matiere_id = v_mat and a.enseignant_id = auth.uid() and a.exercice_id = s.exercice_id
     and a.classe_id::text in (select jsonb_array_elements_text(coalesce(p -> 'classes', '[]'::jsonb)));
  if cardinality(v_classes) = 0 then raise exception 'Choisissez au moins une classe.' using errcode = 'P0001'; end if;
  v_q := public._smarteval_questions(p -> 'questions');
  if v_id is null then
    insert into public.evaluations (etablissement_id, auteur_id, exercice_id, sequence_id, matiere_id, classes, titre, consignes, competence, questions)
    values (v_etab, auth.uid(), s.exercice_id, s.id, v_mat, v_classes, left(btrim(p ->> 'titre'), 150), left(coalesce(p ->> 'consignes', ''), 3000),
            left(btrim(p ->> 'competence'), 600), v_q)
    returning id into v_id;
  else
    e := public._smarteval_mienne(v_id);
    if e.jeton is not null then raise exception 'Évaluation déjà publiée : elle ne peut plus être modifiée.' using errcode = 'P0001'; end if;
    update public.evaluations set sequence_id = s.id, exercice_id = s.exercice_id, matiere_id = v_mat, classes = v_classes,
           titre = left(btrim(p ->> 'titre'), 150), consignes = left(coalesce(p ->> 'consignes', ''), 3000),
           competence = left(btrim(p ->> 'competence'), 600), questions = v_q, modifie_le = now()
     where id = v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

/**
 * Génère le lien de l'évaluation (ou change sa durée) : les réponses sont acceptées pendant la durée choisie.
 * p_entete : en-tête de l'établissement figé au moment de la publication (nom, devise, coordonnées, logo réduit).
 */
create or replace function public.smarteval_publier(p_id uuid, p_valeur int, p_unite text, p_entete jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare e public.evaluations; v_jeton text; v_debut timestamptz;
begin
  e := public._smarteval_mienne(p_id);
  if not public._smarteval_ia(auth.uid()) then
    raise exception 'Préalable : connectez une IA (Claude, Grok…) à votre compte dans la rubrique « IA et API ».' using errcode = 'P0001';
  end if;
  if p_unite not in ('heures', 'jours', 'semaines') or p_valeur is null or p_valeur < 1
     or (p_unite = 'heures' and p_valeur > 720) or (p_unite = 'jours' and p_valeur > 60) or (p_unite = 'semaines' and p_valeur > 8) then
    raise exception 'Durée invalide : 1 à 720 heures, 1 à 60 jours ou 1 à 8 semaines.' using errcode = 'P0001';
  end if;
  if p_entete is not null and pg_column_size(p_entete) > 250000 then raise exception 'En-tête trop volumineux (logo).' using errcode = 'P0001'; end if;
  v_jeton := coalesce(e.jeton, translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_'));
  v_debut := coalesce(e.publiee_le, now());
  update public.evaluations set jeton = v_jeton, publiee_le = v_debut,
         ferme_le = v_debut + case p_unite when 'heures' then make_interval(hours => p_valeur) when 'jours' then make_interval(days => p_valeur)
                                            else make_interval(days => 7 * p_valeur) end,
         duree_valeur = p_valeur, duree_unite = p_unite,
         entete = case when e.jeton is null then coalesce(p_entete, '{}'::jsonb) else e.entete end, modifie_le = now()
   where id = p_id returning * into e;
  return jsonb_build_object('jeton', e.jeton, 'publiee_le', e.publiee_le, 'ferme_le', e.ferme_le);
end $$;

create or replace function public.smarteval_clore(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare e public.evaluations;
begin
  e := public._smarteval_mienne(p_id);
  if e.jeton is null then raise exception 'Évaluation non publiée.' using errcode = 'P0001'; end if;
  update public.evaluations set ferme_le = least(ferme_le, now()), modifie_le = now() where id = p_id;
end $$;

create or replace function public.smarteval_supprimer(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare e public.evaluations;
begin
  e := public._smarteval_mienne(p_id);
  delete from public.evaluations where id = e.id;
end $$;

create or replace function public.smarteval_liste() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'titre', e.titre, 'matiere', m.libelle, 'sequence', s.numero, 'competence', e.competence,
      'classes', (select jsonb_agg(c.libelle order by c.ordre, c.libelle) from public.classes c where c.id = any (e.classes)),
      'questions', jsonb_array_length(e.questions), 'statut', public._smarteval_statut(e), 'jeton', e.jeton,
      'publiee_le', e.publiee_le, 'ferme_le', e.ferme_le, 'cree_le', e.cree_le,
      'soumissions', (select count(*) from public.soumissions so where so.evaluation_id = e.id),
      'nouvelles', (select count(*) from public.soumissions so where so.evaluation_id = e.id
                      and so.soumis_le > coalesce((select vu_jusqua from public.smarteval_vues where personnel_id = auth.uid()), '-infinity')),
      'moyenne', (select round(avg(so.note20), 2) from public.soumissions so where so.evaluation_id = e.id))
    order by e.cree_le desc), '[]'::jsonb)
  from public.evaluations e join public.matieres m on m.id = e.matiere_id join public.sequences s on s.id = e.sequence_id
  where e.auteur_id = auth.uid() and e.etablissement_id = public.etab_courant()
$$;

-- Évaluation (avec corrigés) et toutes ses soumissions : réservé à l'auteur
create or replace function public.smarteval_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.evaluations;
begin
  e := public._smarteval_mienne(p_id);
  return public._smarteval_json(e, true) || jsonb_build_object('soumissions', coalesce((select jsonb_agg(jsonb_build_object(
      'id', so.id, 'numero', so.numero, 'nom', so.nom, 'prenom', so.prenom, 'classe', so.classe, 'classe_id', so.classe_id,
      'matricule', el.matricule, 'reponses', so.reponses, 'details', so.details, 'points', so.points, 'total', so.total,
      'note20', so.note20, 'a_corriger', so.a_corriger, 'soumis_le', so.soumis_le) order by so.numero)
    from public.soumissions so left join public.inscriptions i on i.id = so.inscription_id left join public.eleves el on el.id = i.eleve_id
   where so.evaluation_id = e.id), '[]'::jsonb));
end $$;

-- Journal : créations, publications et soumissions de toutes mes évaluations
create or replace function public.smarteval_journal() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(j order by (j ->> 'le')::timestamptz desc), '[]'::jsonb) from (
    select jsonb_build_object('le', so.soumis_le, 'evenement', 'soumission', 'evaluation_id', e.id, 'evaluation', e.titre,
             'numero', so.numero, 'eleve', btrim(so.nom || ' ' || so.prenom), 'classe', so.classe, 'note20', so.note20,
             'nouvelle', so.soumis_le > coalesce((select vu_jusqua from public.smarteval_vues where personnel_id = auth.uid()), '-infinity')) j
      from public.soumissions so join public.evaluations e on e.id = so.evaluation_id
     where e.auteur_id = auth.uid() and e.etablissement_id = public.etab_courant()
    union all
    select jsonb_build_object('le', e.cree_le, 'evenement', 'creation', 'evaluation_id', e.id, 'evaluation', e.titre)
      from public.evaluations e where e.auteur_id = auth.uid() and e.etablissement_id = public.etab_courant()
    union all
    select jsonb_build_object('le', e.publiee_le, 'evenement', 'publication', 'evaluation_id', e.id, 'evaluation', e.titre, 'ferme_le', e.ferme_le)
      from public.evaluations e where e.auteur_id = auth.uid() and e.etablissement_id = public.etab_courant() and e.publiee_le is not null) x
$$;

-- Bulle : nombre de soumissions arrivées depuis la dernière consultation (propre au compte connecté)
create or replace function public.smarteval_notifications() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('non_lues', count(*), 'evaluations', coalesce(jsonb_agg(distinct so.evaluation_id), '[]'::jsonb))
    from public.soumissions so join public.evaluations e on e.id = so.evaluation_id
   where e.auteur_id = auth.uid() and e.etablissement_id = public.etab_courant()
     and so.soumis_le > coalesce((select vu_jusqua from public.smarteval_vues where personnel_id = auth.uid()), '-infinity')
$$;

create or replace function public.smarteval_marquer_vu() returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.smarteval_vues (personnel_id, vu_jusqua) select auth.uid(), now() where public.etab_courant() is not null
  on conflict (personnel_id) do update set vu_jusqua = excluded.vu_jusqua
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Côté élève (lien public, sans compte)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._smarteval_par_jeton(p_jeton text) returns public.evaluations
language sql stable security definer set search_path = '' as $$
  select e.* from public.evaluations e join public.etablissements t on t.id = e.etablissement_id
   where e.jeton = btrim(coalesce(p_jeton, '')) and t.suspendu_le is null
$$;

create or replace function public.smarteval_formulaire(p_jeton text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.evaluations;
begin
  if coalesce(p_jeton, '') !~ '^[A-Za-z0-9_-]{20,40}$' then return null; end if;
  e := public._smarteval_par_jeton(p_jeton);
  if e.id is null then return null; end if;
  return public._smarteval_json(e, false) - 'auteur' - 'cree_le' - 'duree_valeur' - 'duree_unite';
end $$;

/**
 * Envoi d'un formulaire par un élève. p = { nom, prenom, classe_id, reponses: { <id question>: valeur } }
 * Valeurs : texte (courte, paragraphe), numéro d'option (choix, liste), liste de numéros (cases), nombre (échelle).
 * Correction automatique : choix, liste et cases (toutes les bonnes options, aucune autre), réponse courte si des réponses
 * acceptées sont indiquées. Paragraphes et réponses sans corrigé : « à apprécier » (par l'enseignant ou l'IA).
 */
create or replace function public.smarteval_soumettre(p_jeton text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  e public.evaluations; q jsonb; v jsonb; rep jsonb := '{}'::jsonb; det jsonb := '[]'::jsonb;
  v_nom text := left(btrim(coalesce(p ->> 'nom', '')), 100); v_prenom text := left(btrim(coalesce(p ->> 'prenom', '')), 100);
  v_classe uuid; v_classe_lib text; v_ident text; v_num int; v_ins uuid; v_n int;
  nb int; ok boolean; corrigible boolean; pts numeric; tot numeric := 0; obt numeric := 0; acorr int := 0; vide boolean; x int; so record;
begin
  if coalesce(p_jeton, '') !~ '^[A-Za-z0-9_-]{20,40}$' then raise exception 'Lien invalide.' using errcode = 'P0001'; end if;
  if p is null or jsonb_typeof(p) <> 'object' or pg_column_size(p) > 300000 then raise exception 'Formulaire invalide.' using errcode = 'P0001'; end if;
  select * into e from public.evaluations where id = (public._smarteval_par_jeton(p_jeton)).id for update;
  if e.id is null then raise exception 'Lien invalide : cette évaluation n''existe pas.' using errcode = 'P0001'; end if;
  if now() < e.publiee_le or now() > e.ferme_le then
    raise exception 'Cette évaluation est close : les réponses ne sont plus acceptées.' using errcode = 'P0001';
  end if;
  if v_nom = '' or v_prenom = '' then raise exception 'Indiquez votre nom et votre prénom.' using errcode = 'P0001'; end if;
  begin v_classe := (p ->> 'classe_id')::uuid; exception when others then v_classe := null; end;
  if v_classe is null or not v_classe = any (e.classes) then raise exception 'Choisissez votre classe.' using errcode = 'P0001'; end if;
  select libelle into v_classe_lib from public.classes where id = v_classe;
  v_ident := public._normaliser(v_nom) || '|' || public._normaliser(v_prenom) || '|' || v_classe;
  if exists (select 1 from public.soumissions where evaluation_id = e.id and identite = v_ident) then
    raise exception 'Vous avez déjà envoyé votre formulaire pour cette évaluation.' using errcode = 'P0001';
  end if;
  select count(*) into v_n from public.soumissions where evaluation_id = e.id;
  if v_n >= 3000 then raise exception 'Nombre maximal de réponses atteint pour cette évaluation.' using errcode = 'P0001'; end if;

  for q in select * from jsonb_array_elements(e.questions) loop
    v := (p -> 'reponses') -> (q ->> 'id');
    nb := jsonb_array_length(q -> 'options');
    -- contrôle et mise en forme de la réponse
    if v is null or jsonb_typeof(v) = 'null' then v := null;
    elsif q ->> 'type' in ('courte', 'paragraphe') then
      v := case when jsonb_typeof(v) in ('string', 'number') and btrim(v #>> '{}') <> ''
                then to_jsonb(left(btrim(v #>> '{}'), case when q ->> 'type' = 'courte' then 500 else 5000 end)) end;
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
    -- correction
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

  -- élève reconnu dans la classe (nom et prénom, dans un sens ou dans l'autre) : sert à l'analyse
  select min(i.id::text)::uuid, count(*) into v_ins, x from public.inscriptions i join public.eleves el on el.id = i.eleve_id
   where i.classe_id = v_classe and i.exercice_id = e.exercice_id
     and (public._normaliser(el.nom || el.prenom) = public._normaliser(v_nom || v_prenom)
       or public._normaliser(el.nom || el.prenom) = public._normaliser(v_prenom || v_nom));
  if x <> 1 then v_ins := null; end if;

  select coalesce(max(numero), 0) + 1 into v_num from public.soumissions where evaluation_id = e.id;
  insert into public.soumissions (evaluation_id, etablissement_id, numero, nom, prenom, classe_id, classe, inscription_id, identite,
                                  reponses, details, points, total, note20, a_corriger)
  values (e.id, e.etablissement_id, v_num, upper(v_nom), v_prenom, v_classe, v_classe_lib, v_ins, v_ident, rep, det,
          case when tot > 0 then obt end, case when tot > 0 then tot end, case when tot > 0 then round(obt / tot * 20, 2) end, acorr)
  returning numero, soumis_le, nom, prenom, classe into so;
  return jsonb_build_object('numero', so.numero, 'recu', upper(substr(md5(e.id::text || so.numero), 1, 4)) || '-' || lpad(so.numero::text, 4, '0'),
                            'soumis_le', so.soumis_le, 'nom', so.nom, 'prenom', so.prenom, 'classe', so.classe, 'evaluation', e.titre);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Serveur MCP : l'IA connectée au compte de l'enseignant lit ses évaluations et les soumissions
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.api_smarteval_liste(p_cle text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c record; r jsonb;
begin
  select * into c from public._api_contexte(p_cle, false);
  r := public.smarteval_liste();
  perform public._api_journal(c.etab, c.personnel, c.source, 'smarteval_lister', jsonb_build_object('evaluations', jsonb_array_length(r)));
  return r;
end $$;

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
  perform public._api_journal(c.etab, c.personnel, c.source, 'smarteval_resultats',
    jsonb_build_object('evaluation', r ->> 'titre', 'soumissions', jsonb_array_length(r -> 'soumissions')));
  return r - 'entete' - 'jeton';
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------------------------------------
revoke execute on function public._smarteval_norm(text), public._smarteval_ia(uuid), public._smarteval_sequence(uuid), public._smarteval_questions(jsonb),
  public._smarteval_statut(public.evaluations), public._smarteval_matieres(uuid), public._smarteval_json(public.evaluations, boolean),
  public._smarteval_mienne(uuid), public._smarteval_par_jeton(text),
  public.smarteval_contexte(), public.smarteval_enregistrer(jsonb), public.smarteval_publier(uuid, int, text, jsonb), public.smarteval_clore(uuid),
  public.smarteval_supprimer(uuid), public.smarteval_liste(), public.smarteval_detail(uuid), public.smarteval_journal(),
  public.smarteval_notifications(), public.smarteval_marquer_vu(), public.smarteval_formulaire(text), public.smarteval_soumettre(text, jsonb),
  public.api_smarteval_liste(text), public.api_smarteval_resultats(text, text) from public, anon, authenticated;
grant execute on function public.smarteval_contexte(), public.smarteval_enregistrer(jsonb), public.smarteval_publier(uuid, int, text, jsonb),
  public.smarteval_clore(uuid), public.smarteval_supprimer(uuid), public.smarteval_liste(), public.smarteval_detail(uuid), public.smarteval_journal(),
  public.smarteval_notifications(), public.smarteval_marquer_vu() to authenticated;
grant execute on function public.smarteval_formulaire(text), public.smarteval_soumettre(text, jsonb) to anon, authenticated;
grant execute on function public.api_smarteval_liste(text), public.api_smarteval_resultats(text, text) to anon, authenticated;
alter function public.smarteval_soumettre(text, jsonb) set plan_cache_mode = force_custom_plan;
