-- Corrections issues de la recette du 20/11/2026 (transition d'année).
--  * Préparer la transition ne bloque plus quand une matière était confiée à un membre du personnel désactivé : la matière est
--    reprise SANS enseignant, et la liste des matières à réattribuer (classe, matière, ancien enseignant) est renvoyée.
--  * Simulation cohérente : une décision « en attente du conseil » bloque l'application ; une réinscription en attente est signalée
--    (l'élève ne sera pas inscrit) ; une classe sans niveau est signalée (les contrôles de cohérence ne peuvent pas s'y appliquer).

create or replace function public.transition_preparer(p_source uuid, p_cible text, p_options jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin(); src public.exercices; cib public.exercices; tr public.transitions; o jsonb := coalesce(p_options, '{}'::jsonb);
        n_prog int := 0; n_ech int := 0; v_sans jsonb := '[]'::jsonb;
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
    -- matières confiées à un membre du personnel désactivé : reprises sans enseignant (à réattribuer), listées pour l'administration
    select coalesce(jsonb_agg(jsonb_build_object('classe', c.libelle, 'matiere', m.libelle, 'ancien_enseignant', public._libelle(p.nom, p.prenom))
                              order by c.libelle, m.libelle), '[]'::jsonb) into v_sans
      from public.attributions a join public.personnels p on p.id = a.enseignant_id
      join public.classes c on c.id = a.classe_id join public.matieres m on m.id = a.matiere_id
     where a.exercice_id = src.id and not p.actif
       and not exists (select 1 from public.attributions x where x.exercice_id = cib.id and x.classe_id = a.classe_id and x.matiere_id = a.matiere_id);
    insert into public.attributions (etablissement_id, exercice_id, classe_id, matiere_id, enseignant_id, coefficient, groupe)
    select v_etab, cib.id, a.classe_id, a.matiere_id,
           case when exists (select 1 from public.personnels p where p.id = a.enseignant_id and p.actif) then a.enseignant_id end,
           a.coefficient, a.groupe from public.attributions a
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
    'programme', n_prog, 'echeances', n_ech, 'sans_enseignant', jsonb_array_length(v_sans)));
  return jsonb_build_object('id', tr.id, 'source', src.libelle, 'cible', cib.libelle, 'cible_id', cib.id, 'programme', n_prog, 'echeances', n_ech,
    'sans_enseignant', v_sans);
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
    union all select 'attente', true, eleve, classe, 'Décision du conseil de classe en attente : choisissez la décision définitive' from l
     where decision = 'attente_conseil'
    union all select 'attente', false, eleve, classe, 'Réinscription en attente : l''élève ne sera pas inscrit(e) dans la nouvelle année' from l
     where decision = 'attente_reinscription'
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
    union all select 'incomplet', false, eleve, classe, 'Classe d''origine sans niveau rattaché : la cohérence promotion / redoublement ne peut pas être vérifiée' from l where niveau_origine is null
    union all select 'incomplet', false, eleve, classe, 'Classe de destination sans niveau rattaché : la cohérence promotion / redoublement ne peut pas être vérifiée' from l
     where classe_destination_id is not null and niveau_classe_dest is null
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
    'classes_sans_niveau', (select count(*) from public.classes c where c.etablissement_id = tr.etablissement_id and c.niveau_id is null
                              and exists (select 1 from public.inscriptions i where i.classe_id = c.id and i.exercice_id = tr.exercice_source_id)),
    'anomalies', (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'bloquante', bloquante, 'eleve', eleve, 'classe', classe, 'probleme', probleme)
                    order by bloquante desc, type, classe, eleve), '[]'::jsonb) from anomalies),
    'bloquantes', (select count(*) from anomalies where bloquante),
    'avertissements', (select count(*) from anomalies where not bloquante)) into r;
  return r;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Registre des PV : annulation tracée d'un document (test, erreur). Le document reste au registre (son numéro n'est jamais
-- réutilisé), barré, avec la date, l'auteur et le motif de l'annulation ; il est masqué par défaut.
-- ---------------------------------------------------------------------------------------------------------
alter table public.pv_documents add column if not exists annule_le timestamptz;
alter table public.pv_documents add column if not exists annule_motif text not null default '' check (char_length(annule_motif) <= 300);
alter table public.pv_documents add column if not exists annule_par uuid references public.personnels (id) on delete set null;

create or replace function public.pv_annuler(p_id uuid, p_motif text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._pv_admin();
begin
  if char_length(btrim(coalesce(p_motif, ''))) < 3 then raise exception 'Indiquez le motif de l''annulation.' using errcode = 'P0001'; end if;
  update public.pv_documents set annule_le = now(), annule_motif = left(btrim(p_motif), 300), annule_par = auth.uid()
   where id = p_id and etablissement_id = v_etab and annule_le is null;
  if not found then raise exception 'PV introuvable ou déjà annulé.' using errcode = 'P0001'; end if;
end $$;
revoke execute on function public.pv_annuler(uuid, text) from public, anon;
grant execute on function public.pv_annuler(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------------------------------------
-- Automatisations : seuil d'heures d'absence non justifiées (« les élèves qui ont plus de 10 h ») repris dans la règle et le rapport
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.automatisation_enregistrer(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); v_role text := public._mon_role(); v_id uuid; f jsonb; v_par jsonb := '{}'::jsonb; r public.automatisations;
begin
  if v_role is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  perform public._exiger_offre(v_etab, 'ia');
  if not public._auto_action_permise(p->>'action', v_role) then
    raise exception 'Cette action n''est pas permise pour votre rôle.' using errcode = '42501';
  end if;
  f := public._auto_frequence(coalesce(p->'frequence', '{}'::jsonb));
  if coalesce(p->>'destinataire', 'moi') not in ('moi', 'direction') then raise exception 'Destinataire : vous-même ou la direction.' using errcode = '22023'; end if;
  if p->>'action' = 'rappel' then
    if char_length(btrim(coalesce(p->'parametres'->>'texte', ''))) not between 2 and 300 then raise exception 'Texte du rappel : 2 à 300 caractères.' using errcode = '22023'; end if;
    v_par := jsonb_build_object('texte', btrim(p->'parametres'->>'texte'));
    p := p || '{"destinataire": "moi"}'::jsonb;                    -- un rappel personnel reste personnel
  else
    if coalesce(p->'parametres'->>'periode', 'jour') not in ('jour', 'semaine', 'mois') then raise exception 'Période : jour, semaine ou mois.' using errcode = '22023'; end if;
    v_par := jsonb_build_object('periode', coalesce(p->'parametres'->>'periode', 'jour'));
    -- rapport des absences : seuil facultatif d'heures non justifiées (1 à 500)
    if p->>'action' = 'rapport_absences' and nullif(p->'parametres'->>'seuil_heures', '') is not null then
      if (p->'parametres'->>'seuil_heures') !~ '^[0-9]{1,3}$' or (p->'parametres'->>'seuil_heures')::int not between 1 and 500 then
        raise exception 'Seuil d''heures : nombre entier de 1 à 500.' using errcode = '22023'; end if;
      v_par := v_par || jsonb_build_object('seuil_heures', (p->'parametres'->>'seuil_heures')::int);
    end if;
  end if;
  v_id := nullif(p->>'id', '')::uuid;
  if v_id is null then
    if (select count(*) from public.automatisations where personnel_id = auth.uid()) >= 20 then
      raise exception 'Vingt automatisations au plus par personne.' using errcode = 'P0001';
    end if;
    insert into public.automatisations (etablissement_id, personnel_id, libelle, texte_source, action, parametres, frequence, destinataire, active, prochaine_execution)
    values (v_etab, auth.uid(), left(btrim(coalesce(p->>'libelle', '')), 120), left(coalesce(p->>'texte_source', ''), 1000), p->>'action', v_par, f,
            coalesce(p->>'destinataire', 'moi'), coalesce((p->>'active')::boolean, true), public._auto_prochaine(f, now()))
    returning * into r;
  else
    update public.automatisations set libelle = left(btrim(coalesce(p->>'libelle', '')), 120), texte_source = left(coalesce(p->>'texte_source', texte_source), 1000),
      action = p->>'action', parametres = v_par, frequence = f, destinataire = coalesce(p->>'destinataire', 'moi'),
      active = coalesce((p->>'active')::boolean, active), prochaine_execution = public._auto_prochaine(f, now()), derniere_erreur = '', maj = now()
     where id = v_id and personnel_id = auth.uid() returning * into r;
    if r.id is null then raise exception 'Automatisation introuvable.' using errcode = 'P0001'; end if;
  end if;
  return to_jsonb(r);
exception when invalid_text_representation then raise exception 'Automatisation introuvable.' using errcode = 'P0001';
end $$;

create or replace function public._auto_contenu(a public.automatisations, p_role text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare jour date := public._aujourdhui(); fin date; debut date; ex uuid; r jsonb;
        v_seuil int := case when coalesce(a.parametres->>'seuil_heures', '') ~ '^[0-9]{1,3}$' then (a.parametres->>'seuil_heures')::int end;
begin
  -- avant midi, la période se termine la veille (un rapport du matin porte sur la journée écoulée) ; à partir de midi, aujourd'hui inclus
  fin := case when extract(hour from now() at time zone 'Africa/Douala') < 12 then jour - 1 else jour end;
  debut := case coalesce(a.parametres->>'periode', 'jour') when 'semaine' then fin - 6 when 'mois' then fin - 29 else fin end;
  select id into ex from public.exercices where etablissement_id = a.etablissement_id and actif;
  if a.action = 'rappel' then
    return jsonb_build_object('texte', coalesce(a.parametres->>'texte', ''));
  elsif a.action = 'rapport_absences' then
    with abs as (select ab.*, i.classe_id, i.eleve_id from public.absences ab join public.inscriptions i on i.id = ab.inscription_id
                  where ab.etablissement_id = a.etablissement_id and ab.date between debut and fin
                    and i.classe_id in (select classe_id from public._auto_classes(a.etablissement_id, a.personnel_id, p_role))),
         ret as (select rt.*, i.classe_id, i.eleve_id from public.retards rt join public.inscriptions i on i.id = rt.inscription_id
                  where rt.etablissement_id = a.etablissement_id and rt.date between debut and fin
                    and i.classe_id in (select classe_id from public._auto_classes(a.etablissement_id, a.personnel_id, p_role)))
    select jsonb_build_object('du', debut, 'au', fin, 'seuil_heures', v_seuil,
      'heures_non_justifiees', coalesce((select sum(heures_non_justifiees) from abs), 0), 'heures_justifiees', coalesce((select sum(heures_justifiees) from abs), 0),
      'eleves_absents', (select count(distinct eleve_id) from abs), 'retards', (select count(*) from ret),
      'par_classe', (select coalesce(jsonb_agg(jsonb_build_object('classe', c.libelle, 'heures_nj', x.nj, 'heures_j', x.j, 'eleves', x.n) order by c.ordre, c.libelle), '[]'::jsonb)
                       from (select classe_id, sum(heures_non_justifiees) nj, sum(heures_justifiees) j, count(distinct eleve_id) n from abs group by classe_id) x
                       join public.classes c on c.id = x.classe_id),
      'eleves', (select coalesce(jsonb_agg(jsonb_build_object('eleve', public._libelle(e.nom, e.prenom), 'classe', c.libelle, 'heures_nj', x.nj, 'heures_j', x.j) order by x.nj desc, e.nom), '[]'::jsonb)
                   from (select eleve_id, classe_id, sum(heures_non_justifiees) nj, sum(heures_justifiees) j from abs group by eleve_id, classe_id
                         having v_seuil is null or sum(heures_non_justifiees) >= v_seuil            -- seuil demandé (« plus de 10 h »)
                         order by 3 desc limit case when v_seuil is null then 30 else 300 end) x
                   join public.eleves e on e.id = x.eleve_id join public.classes c on c.id = x.classe_id))
    into r;
  elsif a.action = 'rapport_saisie' then
    if not exists (select 1 from public.sequences s where s.exercice_id = ex and not s.verrouillee) then
      return jsonb_build_object('sequence', null, 'lignes', '[]'::jsonb, 'total_manquantes', 0);   -- aucune séquence ouverte : rien à saisir
    end if;
    with seq as (select s.id, s.numero from public.sequences s where s.exercice_id = ex and not s.verrouillee order by s.numero limit 1),
         att as (select at.id, at.classe_id, m.libelle matiere, public._libelle(p.nom, p.prenom) enseignant
                   from public.attributions at join public.matieres m on m.id = at.matiere_id left join public.personnels p on p.id = at.enseignant_id
                  where at.exercice_id = ex and (p_role <> 'enseignant' or at.enseignant_id = a.personnel_id)),
         manq as (select att.*, (select count(*) from public.inscriptions i where i.classe_id = att.classe_id and i.exercice_id = ex)
                          - (select count(*) from public.notes n where n.attribution_id = att.id and n.sequence_id = (select id from seq)) manquantes
                    from att)
    select jsonb_build_object('sequence', (select numero from seq),
      'lignes', (select coalesce(jsonb_agg(jsonb_build_object('classe', c.libelle, 'matiere', m.matiere, 'enseignant', m.enseignant, 'notes_manquantes', m.manquantes)
                   order by m.manquantes desc, c.libelle), '[]'::jsonb) from manq m join public.classes c on c.id = m.classe_id where m.manquantes > 0),
      'total_manquantes', coalesce((select sum(manquantes) from manq where manquantes > 0), 0))
    into r;
  elsif a.action = 'rapport_discipline' then
    select jsonb_build_object('du', debut, 'au', fin,
      'incidents', (select coalesce(jsonb_agg(jsonb_build_object('date', d.date, 'eleve', public._libelle(e.nom, e.prenom), 'classe', c.libelle, 'infraction', f.libelle,
                       'observation', d.observation) order by d.date desc), '[]'::jsonb)
                      from public.incidents d join public.inscriptions i on i.id = d.inscription_id join public.eleves e on e.id = i.eleve_id
                      join public.classes c on c.id = i.classe_id join public.infractions f on f.id = d.infraction_id
                     where d.etablissement_id = a.etablissement_id and d.date between debut and fin))
    into r;
  elsif a.action = 'rapport_paiements' then
    select jsonb_build_object('du', debut, 'au', fin, 'nombre', count(*), 'total', coalesce(sum(p.montant), 0), 'devise', 'FCFA',
      'par_mode', (select coalesce(jsonb_object_agg(z.mode, z.s), '{}'::jsonb) from (select mode, sum(montant) s from public.paiements
                     where etablissement_id = a.etablissement_id and date_paiement between debut and fin group by mode) z))
      into r from public.paiements p where p.etablissement_id = a.etablissement_id and p.date_paiement between debut and fin;
  elsif a.action = 'rapport_impayes' then
    with t as (select s.inscription_id, sum(s.reste) filter (where s.date_limite < jour) echu from public._tranches_situation(a.etablissement_id, jour) s
                 where public._relance_exclusion(s.inscription_id, jour) is null group by s.inscription_id)   -- bourses, exonérations, accords, moratoires exclus
    select jsonb_build_object('au', jour, 'devise', 'FCFA', 'eleves_non_en_regle', count(*) filter (where echu > 0), 'montant_en_retard', coalesce(sum(echu), 0),
      'eleves', (select coalesce(jsonb_agg(jsonb_build_object('eleve', public._libelle(e.nom, e.prenom), 'classe', c.libelle, 'en_retard', z.echu) order by z.echu desc), '[]'::jsonb)
                   from (select * from t where echu > 0 order by echu desc limit 40) z join public.inscriptions i on i.id = z.inscription_id
                   join public.eleves e on e.id = i.eleve_id join public.classes c on c.id = i.classe_id))
      into r from t;
  end if;
  return r;
end $$;
