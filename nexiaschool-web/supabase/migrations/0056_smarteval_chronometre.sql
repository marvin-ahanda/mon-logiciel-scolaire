-- SmartEval : durée individuelle de composition (chronomètre contrôlé par le serveur).
--  * L'enseignant fixe une durée (en secondes) avant publication ; sans durée, SmartEval fonctionne exactement comme avant.
--  * L'échéance générale existante (ferme_le) est conservée : échéance individuelle = min(début + durée, ferme_le).
--  * Chaque élève a une tentative unique (évaluation + identité) ; elle est démarrée par le serveur, qui seul fait foi pour l'heure.
--  * Le navigateur reçoit un jeton secret de tentative (et un code de reprise court) : sans eux, aucune sauvegarde ni soumission.
--  * Réponses sauvegardées sur le serveur pendant la composition ; après l'échéance, plus aucune modification n'est acceptée :
--    la copie est soumise avec les dernières réponses enregistrées avant l'échéance (soumission automatique, réglable).
--  * Quotas inchangés : une composition en cours compte comme une réponse dans la limite de l'offre.

-- ---------------------------------------------------------------------------------------------------------
-- 1. Réglage de l'enseignant
-- ---------------------------------------------------------------------------------------------------------
alter table public.evaluations add column if not exists chrono_secondes integer check (chrono_secondes between 60 and 43200);
alter table public.evaluations add column if not exists chrono_auto boolean not null default true;
alter table public.se_evaluations add column if not exists chrono_secondes integer check (chrono_secondes between 60 and 43200);
alter table public.se_evaluations add column if not exists chrono_auto boolean not null default true;

-- ---------------------------------------------------------------------------------------------------------
-- 2. Tentatives individuelles (pas de ligne = « non commencée »)
-- ---------------------------------------------------------------------------------------------------------
create table public.smarteval_tentatives (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid references public.evaluations (id) on delete cascade,
  se_evaluation_id uuid references public.se_evaluations (id) on delete cascade,
  identite text not null,
  nom text not null,
  prenom text not null,
  classe_id text not null,
  classe text not null,
  matricule text not null default '',
  jeton_hash text not null unique,
  code_hash text not null,
  debut timestamptz not null default now(),
  duree_secondes integer not null check (duree_secondes > 0),
  expire_le timestamptz not null,
  reponses jsonb not null default '{}'::jsonb,
  sauve_le timestamptz,
  soumis_le timestamptz,
  numero integer,                                           -- numéro de la copie créée (soumissions / se_soumissions)
  statut text not null default 'en_cours' check (statut in ('en_cours', 'soumise', 'expiree')),
  check ((evaluation_id is null) <> (se_evaluation_id is null)),
  check (expire_le > debut)
);
create unique index smarteval_tentative_unique_etab on public.smarteval_tentatives (evaluation_id, identite) where evaluation_id is not null;
create unique index smarteval_tentative_unique_se on public.smarteval_tentatives (se_evaluation_id, identite) where se_evaluation_id is not null;
create index smarteval_tentatives_en_cours on public.smarteval_tentatives (expire_le) where statut = 'en_cours';
alter table public.smarteval_tentatives enable row level security;
revoke all on public.smarteval_tentatives from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Lecture : durée exposée à l'enseignant et au formulaire public ; questions cachées avant le démarrage
-- ---------------------------------------------------------------------------------------------------------
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
    'demande_matricule', e.anonyme_ia, 'chrono_secondes', e.chrono_secondes, 'chrono_auto', e.chrono_auto)
    || case when p_corriges then jsonb_build_object('anonyme_ia', e.anonyme_ia) else '{}'::jsonb end
  from public.matieres m, public.sequences s, public.exercices x
  where m.id = e.matiere_id and s.id = e.sequence_id and x.id = e.exercice_id
$$;

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
    'statut', public._se_statut(e), 'cree_le', e.cree_le, 'offre_publication', e.offre_publication,
    'chrono_secondes', e.chrono_secondes, 'chrono_auto', e.chrono_auto)
$$;

/** Formulaire public d'une évaluation chronométrée : présentation seulement (questions et documents révélés au démarrage). */
create or replace function public._smarteval_cacher_si_chrono(j jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when (j ->> 'chrono_secondes') is null then j
              else j - 'questions' - 'supports' || jsonb_build_object('nb_questions', jsonb_array_length(coalesce(j -> 'questions', '[]'::jsonb)),
                                                                      'supports_nombre', jsonb_array_length(coalesce(j -> 'supports', '[]'::jsonb))) end
$$;

create or replace function public._se_formulaire(p_jeton text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.se_evaluations;
begin
  select x.* into e from public.se_evaluations x join public.comptes_enseignants c on c.id = x.compte_id where x.jeton = btrim(p_jeton) and c.actif;
  if e.id is null then return null; end if;
  return public._smarteval_cacher_si_chrono(public._se_json(e, false) - 'cree_le' - 'duree_valeur' - 'duree_unite' - 'archivee' - 'offre_publication' - 'anonyme_ia' - 'id');
end $$;
revoke execute on function public._se_formulaire(text) from public, anon, authenticated;

create or replace function public.smarteval_formulaire(p_jeton text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.evaluations;
begin
  if coalesce(p_jeton, '') !~ '^[A-Za-z0-9_-]{20,40}$' then return null; end if;
  e := public._smarteval_par_jeton(p_jeton);
  if e.id is null then return public._se_formulaire(p_jeton); end if;
  return public._smarteval_cacher_si_chrono(public._smarteval_json(e, false) - 'auteur' - 'cree_le' - 'duree_valeur' - 'duree_unite');
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 4. Réglage de la durée par l'enseignant (évaluation non publiée seulement)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.smarteval_chrono_definir(p_id uuid, p_secondes integer, p_auto boolean default true) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab boolean := exists (select 1 from public.evaluations where id = p_id); e public.evaluations; s public.se_evaluations;
begin
  if p_secondes is not null and (p_secondes < 60 or p_secondes > 43200) then
    raise exception 'Durée de composition invalide : entre 1 minute et 12 heures.' using errcode = 'P0001';
  end if;
  if v_etab then
    e := public._smarteval_mienne(p_id);
    if e.jeton is not null then raise exception 'Évaluation déjà publiée : elle ne peut plus être modifiée.' using errcode = 'P0001'; end if;
    update public.evaluations set chrono_secondes = p_secondes, chrono_auto = coalesce(p_auto, true), modifie_le = now() where id = e.id;
  else
    s := public._se_mienne(p_id);
    if s.jeton is not null then raise exception 'Évaluation déjà publiée : elle ne peut plus être modifiée.' using errcode = 'P0001'; end if;
    update public.se_evaluations set chrono_secondes = p_secondes, chrono_auto = coalesce(p_auto, true), modifie_le = now() where id = s.id;
  end if;
  return jsonb_build_object('chrono_secondes', p_secondes, 'chrono_auto', coalesce(p_auto, true));
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 5. Évaluation publique visée par un jeton (établissement ou indépendante), verrouillée pour sérialiser les démarrages
-- ---------------------------------------------------------------------------------------------------------
create type public.smarteval_cible as (
  etab_id uuid, se_id uuid, titre text, questions jsonb, publiee_le timestamptz, ferme_le timestamptz,
  chrono_secondes integer, chrono_auto boolean, anonyme_ia boolean, demande_matricule boolean, classes jsonb
);

create or replace function public._smarteval_cible(p_jeton text, p_verrou boolean) returns public.smarteval_cible
language plpgsql volatile security definer set search_path = '' as $$
declare e public.evaluations; s public.se_evaluations; r public.smarteval_cible;
begin
  if coalesce(p_jeton, '') !~ '^[A-Za-z0-9_-]{20,40}$' then raise exception 'Lien invalide.' using errcode = 'P0001'; end if;
  if p_verrou then select * into e from public.evaluations where id = (public._smarteval_par_jeton(p_jeton)).id for update;
  else e := public._smarteval_par_jeton(p_jeton); end if;
  if e.id is not null then
    r := (e.id, null, e.titre, e.questions, e.publiee_le, e.ferme_le, e.chrono_secondes, e.chrono_auto, e.anonyme_ia, e.anonyme_ia,
          (select coalesce(jsonb_agg(jsonb_build_object('id', c.id::text, 'libelle', c.libelle)), '[]'::jsonb) from public.classes c where c.id = any (e.classes)));
    return r;
  end if;
  if p_verrou then select x.* into s from public.se_evaluations x where x.jeton = btrim(p_jeton) for update;
  else select x.* into s from public.se_evaluations x where x.jeton = btrim(p_jeton); end if;
  if s.id is null or not exists (select 1 from public.comptes_enseignants c where c.id = s.compte_id and c.actif) then
    raise exception 'Lien invalide : cette évaluation n''existe pas.' using errcode = 'P0001';
  end if;
  r := (null, s.id, s.titre, s.questions, s.publiee_le, s.ferme_le, s.chrono_secondes, s.chrono_auto, s.anonyme_ia, s.demande_matricule or s.anonyme_ia,
        public._se_classes(s));
  return r;
end $$;

/** Identité de l'élève (mêmes règles que la soumission existante) : { identite, nom, prenom, classe_id, classe, matricule }. */
create or replace function public._smarteval_identite(c public.smarteval_cible, p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_nom text := left(btrim(coalesce(p ->> 'nom', '')), 100); v_prenom text := left(btrim(coalesce(p ->> 'prenom', '')), 100);
        v_classe text := left(btrim(coalesce(p ->> 'classe_id', '')), 90); v_mat text := upper(left(btrim(coalesce(p ->> 'matricule', '')), 40)); v_lib text;
        v_cl text;
begin
  if v_nom = '' or v_prenom = '' then raise exception 'Indiquez votre nom et votre prénom.' using errcode = 'P0001'; end if;
  select x ->> 'libelle' into v_lib from jsonb_array_elements(c.classes) x where x ->> 'id' = v_classe;
  if v_lib is null then raise exception 'Choisissez votre classe.' using errcode = 'P0001'; end if;
  if c.demande_matricule and v_mat = '' then raise exception 'Indiquez votre matricule.' using errcode = 'P0001'; end if;
  v_cl := case when c.etab_id is not null then v_classe else public._normaliser(v_classe) end;
  -- matricule obligatoire : c'est lui qui identifie l'élève (un nom mal orthographié ne donne pas une seconde tentative)
  return jsonb_build_object('identite', case when c.demande_matricule then 'matricule|' || public._normaliser(v_mat) || '|' || v_cl
                                             else public._normaliser(v_nom) || '|' || public._normaliser(v_prenom) || '|' || v_cl end,
                            'nom', upper(v_nom), 'prenom', v_prenom, 'classe_id', v_classe, 'classe', v_lib, 'matricule', v_mat);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 6. Clôture d'une tentative : création de la copie (correction existante), une seule fois.
--    Ordre de verrouillage unique dans tout le module : l'évaluation, puis la tentative (aucun interblocage).
-- ---------------------------------------------------------------------------------------------------------
/** L'échéance générale prime toujours : si l'enseignant clôture plus tôt, les compositions en cours s'arrêtent à la clôture. */
create or replace function public._smarteval_borner(t public.smarteval_tentatives, p_ferme timestamptz) returns public.smarteval_tentatives
language plpgsql volatile security definer set search_path = '' as $$
begin
  if t.statut = 'en_cours' and p_ferme is not null and p_ferme < t.expire_le then
    update public.smarteval_tentatives set expire_le = greatest(p_ferme, debut + interval '1 millisecond') where id = t.id returning * into t;
  end if;
  return t;
end $$;

/**
 * p_statut « soumise » (envoi de l'élève, avec ses dernières réponses) ou « expiree » (temps écoulé).
 * Le serveur décide : un envoi arrivé après l'échéance est traité comme une expiration, et ses réponses sont ignorées.
 */
create or replace function public._smarteval_finaliser(p_tentative uuid, p_statut text, p_reponses jsonb default null) returns public.smarteval_tentatives
language plpgsql volatile security definer set search_path = '' as $$
declare t public.smarteval_tentatives; e public.evaluations; s public.se_evaluations; r jsonb; v_num int; v_ins uuid; x int; v_fin timestamptz; v_auto boolean;
        v_expire boolean;
begin
  select * into t from public.smarteval_tentatives where id = p_tentative;
  if t.id is null then return t; end if;
  if t.evaluation_id is not null then
    select * into e from public.evaluations where id = t.evaluation_id for update;
    v_auto := e.chrono_auto;
  else
    select * into s from public.se_evaluations where id = t.se_evaluation_id for update;
    v_auto := s.chrono_auto;
  end if;
  select * into t from public.smarteval_tentatives where id = p_tentative for update;
  if t.statut <> 'en_cours' then return t; end if;                               -- idempotence : déjà soumise ou expirée
  t := public._smarteval_borner(t, coalesce(e.ferme_le, s.ferme_le));            -- évaluation clôturée plus tôt par l'enseignant
  v_expire := now() > t.expire_le;
  if p_statut = 'expiree' and not v_expire then return t; end if;               -- pas encore l'échéance : rien à faire
  if v_expire then p_statut := 'expiree'; end if;
  if p_statut = 'soumise' and jsonb_typeof(p_reponses) = 'object' and pg_column_size(p_reponses) <= 1000000 then
    update public.smarteval_tentatives set reponses = p_reponses, sauve_le = now() where id = t.id returning * into t;   -- reçues avant l'échéance
  end if;
  v_fin := case when p_statut = 'expiree' then t.expire_le else now() end;     -- heure officielle de fin
  if p_statut = 'expiree' and not v_auto then                                     -- soumission automatique désactivée : pas de copie
    update public.smarteval_tentatives set statut = 'expiree', soumis_le = null where id = t.id returning * into t;
    return t;
  end if;
  if t.evaluation_id is not null then
    if exists (select 1 from public.soumissions where evaluation_id = e.id and identite = t.identite) then
      update public.smarteval_tentatives set statut = p_statut, soumis_le = v_fin where id = t.id returning * into t; return t;
    end if;
    r := public._smarteval_corriger(e.questions, t.reponses);
    select min(i.id::text)::uuid, count(*) into v_ins, x from public.inscriptions i join public.eleves el on el.id = i.eleve_id
     where i.classe_id = t.classe_id::uuid and i.exercice_id = e.exercice_id
       and (public._normaliser(el.nom || el.prenom) = public._normaliser(t.nom || t.prenom)
         or public._normaliser(el.nom || el.prenom) = public._normaliser(t.prenom || t.nom));
    if x <> 1 then v_ins := null; end if;
    if v_ins is null and t.matricule <> '' then
      select min(i.id::text)::uuid, count(*) into v_ins, x from public.inscriptions i join public.eleves el on el.id = i.eleve_id
       where i.classe_id = t.classe_id::uuid and i.exercice_id = e.exercice_id and upper(btrim(el.matricule)) = t.matricule;
      if x <> 1 then v_ins := null; end if;
    end if;
    select coalesce(max(numero), 0) + 1 into v_num from public.soumissions where evaluation_id = e.id;
    insert into public.soumissions (evaluation_id, etablissement_id, numero, nom, prenom, classe_id, classe, inscription_id, identite,
                                    reponses, details, points, total, note20, a_corriger, matricule_saisi, soumis_le)
    values (e.id, e.etablissement_id, v_num, t.nom, t.prenom, t.classe_id::uuid, t.classe, v_ins, t.identite, r -> 'reponses', r -> 'details',
            (r ->> 'points')::numeric, (r ->> 'total')::numeric, (r ->> 'note20')::numeric, (r ->> 'a_corriger')::int, nullif(t.matricule, ''), v_fin);
  else
    if exists (select 1 from public.se_soumissions where evaluation_id = s.id and identite = t.identite) then
      update public.smarteval_tentatives set statut = p_statut, soumis_le = v_fin where id = t.id returning * into t; return t;
    end if;
    r := public._smarteval_corriger(s.questions, t.reponses);
    select coalesce(max(numero), 0) + 1 into v_num from public.se_soumissions where evaluation_id = s.id;
    insert into public.se_soumissions (evaluation_id, numero, nom, prenom, matricule, classe, identite, reponses, details, points, total, note20, a_corriger, soumis_le)
    values (s.id, v_num, t.nom, t.prenom, t.matricule, t.classe_id, t.identite, r -> 'reponses', r -> 'details', (r ->> 'points')::numeric,
            (r ->> 'total')::numeric, (r ->> 'note20')::numeric, (r ->> 'a_corriger')::int, v_fin);
  end if;
  update public.smarteval_tentatives set statut = p_statut, soumis_le = v_fin, numero = v_num where id = t.id returning * into t;
  return t;
end $$;

/** Tentatives dont l'échéance est passée : clôturées (consultation du suivi, travailleur planifié). */
create or replace function public._smarteval_expirer(p_etab uuid, p_se uuid, p_limite integer default 100) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; n int := 0;
begin
  for v_id in select t.id from public.smarteval_tentatives t
                 left join public.evaluations e on e.id = t.evaluation_id left join public.se_evaluations s on s.id = t.se_evaluation_id
               where t.statut = 'en_cours' and least(t.expire_le, coalesce(e.ferme_le, s.ferme_le)) < now()
                 and (p_etab is null or t.evaluation_id = p_etab) and (p_se is null or t.se_evaluation_id = p_se)
               order by t.expire_le limit least(greatest(p_limite, 1), 5000) loop
    perform public._smarteval_finaliser(v_id, 'expiree'); n := n + 1;
  end loop;
  return n;
end $$;

-- appel public (travailleur planifié) : lot borné, pour ne pas garder longtemps de verrous
create or replace function public.smarteval_expirer() returns integer
language sql volatile security definer set search_path = '' as $$ select public._smarteval_expirer(null, null, 100) $$;

-- ---------------------------------------------------------------------------------------------------------
-- 7. Élève : démarrer, reprendre, sauvegarder, soumettre
-- ---------------------------------------------------------------------------------------------------------
/** Échéance effective d'une tentative (la clôture anticipée de l'évaluation prime). */
create or replace function public._smarteval_echeance(t public.smarteval_tentatives, c public.smarteval_cible) returns timestamptz
language sql immutable set search_path = '' as $$ select least(t.expire_le, c.ferme_le) $$;

create or replace function public._smarteval_tentative_etat(t public.smarteval_tentatives, c public.smarteval_cible) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'statut', t.statut, 'debut', t.debut, 'expire_le', public._smarteval_echeance(t, c), 'maintenant', now(), 'duree_secondes', t.duree_secondes,
    'reponses', case when t.statut = 'en_cours' then t.reponses end, 'sauve_le', t.sauve_le, 'soumis_le', t.soumis_le,
    'identite', jsonb_build_object('nom', t.nom, 'prenom', t.prenom, 'classe', t.classe, 'matricule', t.matricule),
    'questions', case when t.statut = 'en_cours' then
                   (select coalesce(jsonb_agg(q - 'bonnes' - 'acceptees' order by o), '[]'::jsonb) from jsonb_array_elements(c.questions) with ordinality x(q, o)) end,
    'supports', case when t.statut = 'en_cours' and c.etab_id is not null then (select supports from public.evaluations where id = c.etab_id) end,
    'recu', case when t.numero is not null then upper(substr(md5(coalesce(c.etab_id, c.se_id)::text || t.numero), 1, 4)) || '-' || lpad(t.numero::text, 4, '0') end,
    'copie_creee', t.numero is not null)
$$;

create or replace function public.smarteval_demarrer(p_jeton text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c public.smarteval_cible := public._smarteval_cible(p_jeton, true); i jsonb; t public.smarteval_tentatives; v_jeton text; v_code text;
        v_n int; v_max int; o jsonb; cmp public.comptes_enseignants;
begin
  if c.chrono_secondes is null then raise exception 'Cette évaluation n''est pas chronométrée.' using errcode = 'P0001'; end if;
  if c.publiee_le is null or now() < c.publiee_le then raise exception 'Cette évaluation n''est pas encore ouverte.' using errcode = 'P0001'; end if;
  if now() >= c.ferme_le then raise exception 'Cette évaluation est close : les réponses ne sont plus acceptées.' using errcode = 'P0001'; end if;
  i := public._smarteval_identite(c, p);
  if (c.etab_id is not null and exists (select 1 from public.soumissions where evaluation_id = c.etab_id and identite = i ->> 'identite'))
     or (c.se_id is not null and exists (select 1 from public.se_soumissions where evaluation_id = c.se_id and identite = i ->> 'identite')) then
    raise exception 'Vous avez déjà envoyé votre formulaire pour cette évaluation.' using errcode = 'P0001';
  end if;
  select * into t from public.smarteval_tentatives
   where identite = i ->> 'identite' and (evaluation_id = c.etab_id or se_evaluation_id = c.se_id) for update;
  if t.id is not null then
    if t.statut = 'en_cours' and now() <= public._smarteval_echeance(t, c) then
      raise exception 'Une composition est déjà en cours à ce nom. Reprenez-la sur l''appareil où elle a commencé, ou avec votre code de reprise.'
        using errcode = 'P0001', hint = 'smarteval:en_cours';
    end if;
    raise exception 'Votre composition est terminée : elle ne peut pas être recommencée.' using errcode = 'P0001';
  end if;
  -- quotas existants : une composition en cours compte comme une réponse
  if c.etab_id is not null then
    select (select count(*) from public.soumissions where evaluation_id = c.etab_id)
         + (select count(*) from public.smarteval_tentatives where evaluation_id = c.etab_id and statut = 'en_cours') into v_n;
    if v_n >= 3000 then raise exception 'Nombre maximal de réponses atteint pour cette évaluation.' using errcode = 'P0001'; end if;
  else
    select x.* into cmp from public.comptes_enseignants x join public.se_evaluations s on s.compte_id = x.id where s.id = c.se_id;
    o := public._se_offre(cmp); v_max := (o ->> 'soumissions_max')::int;
    select (select count(*) from public.se_soumissions where evaluation_id = c.se_id)
         + (select count(*) from public.smarteval_tentatives where se_evaluation_id = c.se_id and statut = 'en_cours') into v_n;
    if v_n >= v_max then
      if o ->> 'offre' in ('decouverte', 'aucune') and v_max < (public._config()).se_soumissions_max then
        raise exception 'Cette évaluation a atteint le nombre maximal de réponses de l''offre Découverte. Prévenez votre enseignant : il peut passer à SmartEval Enseignant pour permettre à davantage d''élèves de composer.'
          using errcode = 'P0001', hint = 'smarteval:soumissions';
      end if;
      raise exception 'Nombre maximal de réponses atteint pour cette évaluation.' using errcode = 'P0001', hint = 'smarteval:soumissions';
    end if;
  end if;
  v_jeton := encode(extensions.gen_random_bytes(24), 'hex');
  v_code := upper(encode(extensions.gen_random_bytes(6), 'hex'));                -- 12 caractères (48 bits)
  insert into public.smarteval_tentatives (evaluation_id, se_evaluation_id, identite, nom, prenom, classe_id, classe, matricule, jeton_hash, code_hash,
                                           debut, duree_secondes, expire_le)
  values (c.etab_id, c.se_id, i ->> 'identite', i ->> 'nom', i ->> 'prenom', i ->> 'classe_id', i ->> 'classe', i ->> 'matricule',
          encode(extensions.digest(v_jeton, 'sha256'), 'hex'), encode(extensions.digest(v_code, 'sha256'), 'hex'),
          now(), c.chrono_secondes, least(now() + make_interval(secs => c.chrono_secondes), c.ferme_le))
  returning * into t;
  return public._smarteval_tentative_etat(t, c) || jsonb_build_object('tentative', v_jeton, 'code_reprise', v_code);
end $$;

/** Tentative désignée par son jeton secret (navigateur de l'élève). Lecture sans verrou : les écritures suivent l'ordre évaluation puis tentative. */
create or replace function public._smarteval_par_tentative(c public.smarteval_cible, p_tentative text) returns public.smarteval_tentatives
language plpgsql stable security definer set search_path = '' as $$
declare t public.smarteval_tentatives;
begin
  if coalesce(p_tentative, '') !~ '^[0-9a-f]{48}$' then raise exception 'Composition introuvable sur cet appareil.' using errcode = 'P0001', hint = 'smarteval:tentative'; end if;
  select * into t from public.smarteval_tentatives
   where jeton_hash = encode(extensions.digest(p_tentative, 'sha256'), 'hex') and (evaluation_id = c.etab_id or se_evaluation_id = c.se_id);
  if t.id is null then raise exception 'Composition introuvable sur cet appareil.' using errcode = 'P0001', hint = 'smarteval:tentative'; end if;
  return t;
end $$;

/** Reprise : par le jeton gardé sur l'appareil, ou sur un autre appareil avec l'identité et le code de reprise (nouveau jeton). */
create or replace function public.smarteval_reprendre(p_jeton text, p_tentative text default null, p_identite jsonb default null, p_code text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c public.smarteval_cible := public._smarteval_cible(p_jeton, false); t public.smarteval_tentatives; i jsonb; v_jeton text;
begin
  if p_tentative is not null then
    t := public._smarteval_par_tentative(c, p_tentative);
  else
    i := public._smarteval_identite(c, coalesce(p_identite, '{}'::jsonb));
    select * into t from public.smarteval_tentatives
     where identite = i ->> 'identite' and (evaluation_id = c.etab_id or se_evaluation_id = c.se_id)
       and code_hash = encode(extensions.digest(upper(btrim(coalesce(p_code, ''))), 'sha256'), 'hex');
    if t.id is null then raise exception 'Code de reprise incorrect pour cet élève.' using errcode = 'P0001'; end if;
  end if;
  if t.statut = 'en_cours' and now() > public._smarteval_echeance(t, c) then
    t := public._smarteval_finaliser(t.id, 'expiree');                            -- temps écoulé pendant l'absence de l'élève
  elsif t.statut = 'en_cours' and p_tentative is null then                        -- nouvel appareil : l'ancien jeton cesse de fonctionner
    v_jeton := encode(extensions.gen_random_bytes(24), 'hex');
    update public.smarteval_tentatives set jeton_hash = encode(extensions.digest(v_jeton, 'sha256'), 'hex')
     where id = t.id and statut = 'en_cours' returning * into t;
    if not found then raise exception 'Votre composition est terminée : elle ne peut pas être recommencée.' using errcode = 'P0001'; end if;
  end if;
  return public._smarteval_tentative_etat(t, c) || case when v_jeton is not null then jsonb_build_object('tentative', v_jeton) else '{}'::jsonb end;
end $$;

/** Sauvegarde des réponses en cours : refusée après l'échéance (seules comptent les réponses enregistrées avant). */
create or replace function public.smarteval_sauver(p_jeton text, p_tentative text, p_reponses jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c public.smarteval_cible := public._smarteval_cible(p_jeton, false); t public.smarteval_tentatives := public._smarteval_par_tentative(c, p_tentative);
begin
  if t.statut <> 'en_cours' then raise exception 'Votre composition est terminée : les réponses ne peuvent plus être modifiées.' using errcode = 'P0001', hint = 'smarteval:termine'; end if;
  if p_reponses is null or jsonb_typeof(p_reponses) <> 'object' or pg_column_size(p_reponses) > 1000000 then
    raise exception 'Réponses invalides.' using errcode = 'P0001';
  end if;
  -- écriture atomique : acceptée seulement si la tentative est encore en cours et avant l'échéance (contrôle refait au moment d'écrire)
  update public.smarteval_tentatives set reponses = p_reponses, sauve_le = now()
   where id = t.id and statut = 'en_cours' and now() <= least(expire_le, c.ferme_le) returning * into t;
  if not found then
    raise exception 'Le temps de composition est écoulé : vos réponses enregistrées avant la fin ont été prises en compte.' using errcode = 'P0001', hint = 'smarteval:expire';
  end if;
  return jsonb_build_object('sauve_le', t.sauve_le, 'maintenant', now(), 'expire_le', public._smarteval_echeance(t, c));
end $$;

/** Soumission d'une composition chronométrée (anticipée ou à l'échéance). Idempotente ; le serveur juge l'heure. */
create or replace function public._smarteval_soumettre_chrono(p_jeton text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c public.smarteval_cible := public._smarteval_cible(p_jeton, false); t public.smarteval_tentatives;
begin
  t := public._smarteval_par_tentative(c, p ->> 'tentative');
  if t.statut = 'en_cours' then t := public._smarteval_finaliser(t.id, 'soumise', p -> 'reponses'); end if;
  return public._smarteval_tentative_etat(t, c) || jsonb_build_object('numero', t.numero, 'nom', t.nom, 'prenom', t.prenom, 'classe', t.classe,
    'evaluation', c.titre, 'expiree', t.statut = 'expiree');
end $$;

/** Enseignant : réinitialise une tentative sans copie (élève bloqué, appareil et code perdus). L'élève peut recommencer avec une durée complète. */
create or replace function public.smarteval_tentative_reinitialiser(p_tentative uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare t public.smarteval_tentatives;
begin
  select * into t from public.smarteval_tentatives where id = p_tentative;
  if t.id is null then raise exception 'Tentative introuvable.' using errcode = 'P0001'; end if;
  if t.evaluation_id is not null then perform 1 from public.evaluations where id = (public._smarteval_mienne(t.evaluation_id)).id for update;
  else perform 1 from public.se_evaluations where id = (public._se_mienne(t.se_evaluation_id)).id for update; end if;
  select * into t from public.smarteval_tentatives where id = p_tentative for update;
  if t.numero is not null then raise exception 'Une copie est déjà enregistrée : cette composition ne peut pas être réinitialisée.' using errcode = 'P0001'; end if;
  delete from public.smarteval_tentatives where id = t.id;
end $$;

-- Lien public : la soumission d'une évaluation chronométrée passe obligatoirement par sa tentative (aucun contournement par l'API).
create or replace function public.smarteval_soumettre(p_jeton text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  e public.evaluations; r jsonb; v_nom text := left(btrim(coalesce(p ->> 'nom', '')), 100); v_prenom text := left(btrim(coalesce(p ->> 'prenom', '')), 100);
  v_classe uuid; v_classe_lib text; v_ident text; v_num int; v_ins uuid; v_n int; x int; so record;
  v_mat text := upper(left(btrim(coalesce(p ->> 'matricule', '')), 40));
begin
  if coalesce(p_jeton, '') !~ '^[A-Za-z0-9_-]{20,40}$' then raise exception 'Lien invalide.' using errcode = 'P0001'; end if;
  if p is null or jsonb_typeof(p) <> 'object' or pg_column_size(p) > 1000000 then raise exception 'Formulaire invalide.' using errcode = 'P0001'; end if;
  if (public._smarteval_cible(p_jeton, false)).chrono_secondes is not null then
    return public._smarteval_soumettre_chrono(p_jeton, p);
  end if;
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
  select min(i.id::text)::uuid, count(*) into v_ins, x from public.inscriptions i join public.eleves el on el.id = i.eleve_id
   where i.classe_id = v_classe and i.exercice_id = e.exercice_id
     and (public._normaliser(el.nom || el.prenom) = public._normaliser(v_nom || v_prenom)
       or public._normaliser(el.nom || el.prenom) = public._normaliser(v_prenom || v_nom));
  if x <> 1 then v_ins := null; end if;
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

-- ---------------------------------------------------------------------------------------------------------
-- 8. Enseignant : suivi des tentatives (les compositions dont le temps est écoulé sont clôturées d'abord)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.smarteval_tentatives(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab boolean := exists (select 1 from public.evaluations where id = p_id); e public.evaluations; s public.se_evaluations;
begin
  if v_etab then e := public._smarteval_mienne(p_id); perform public._smarteval_expirer(e.id, null, 5000);
  else s := public._se_mienne(p_id); perform public._smarteval_expirer(null, s.id, 5000); end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nom', t.nom, 'prenom', t.prenom, 'classe', t.classe, 'matricule', t.matricule,
            'debut', t.debut, 'duree_secondes', t.duree_secondes, 'expire_le', t.expire_le, 'soumis_le', t.soumis_le, 'statut', t.statut,
            'copie', t.numero, 'temps_utilise', case when t.soumis_le is not null then extract(epoch from t.soumis_le - t.debut)::int end,
            'sauve_le', t.sauve_le) order by t.debut), '[]'::jsonb)
    from public.smarteval_tentatives t where (v_etab and t.evaluation_id = p_id) or (not v_etab and t.se_evaluation_id = p_id));
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 9. Droits
-- ---------------------------------------------------------------------------------------------------------
revoke all on function public._smarteval_cacher_si_chrono(jsonb) from public, anon, authenticated;
revoke all on function public._smarteval_cible(text, boolean) from public, anon, authenticated;
revoke all on function public._smarteval_identite(public.smarteval_cible, jsonb) from public, anon, authenticated;
revoke all on function public._smarteval_borner(public.smarteval_tentatives, timestamptz) from public, anon, authenticated;
revoke all on function public._smarteval_finaliser(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public._smarteval_echeance(public.smarteval_tentatives, public.smarteval_cible) from public, anon, authenticated;
revoke all on function public._smarteval_expirer(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public._smarteval_tentative_etat(public.smarteval_tentatives, public.smarteval_cible) from public, anon, authenticated;
revoke all on function public._smarteval_par_tentative(public.smarteval_cible, text) from public, anon, authenticated;
revoke all on function public._smarteval_soumettre_chrono(text, jsonb) from public, anon, authenticated;
revoke all on function public.smarteval_chrono_definir(uuid, integer, boolean) from public, anon;
grant execute on function public.smarteval_chrono_definir(uuid, integer, boolean) to authenticated;
revoke all on function public.smarteval_tentatives(uuid) from public, anon;
grant execute on function public.smarteval_tentatives(uuid) to authenticated;
revoke all on function public.smarteval_tentative_reinitialiser(uuid) from public, anon;
grant execute on function public.smarteval_tentative_reinitialiser(uuid) to authenticated;
grant execute on function public.smarteval_demarrer(text, jsonb) to anon, authenticated;
grant execute on function public.smarteval_reprendre(text, text, jsonb, text) to anon, authenticated;
grant execute on function public.smarteval_sauver(text, text, jsonb) to anon, authenticated;
grant execute on function public.smarteval_expirer() to anon, authenticated;
