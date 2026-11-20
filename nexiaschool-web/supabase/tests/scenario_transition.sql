-- Transition d'année : critères étendus (matières, portée), préparation de l'année cible et duplication des structures,
-- décisions, simulation et anomalies, application (inscriptions), retour arrière protégé, clôture, annulation tracée
reset role; set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null

-- 1. Règles de promotion étendues : note minimale dans chaque matière, matières en échec, portée par niveau
select pg_temp.verifier(public.enregistrer_criteres_decision('a', jsonb_build_array(
  jsonb_build_object('decision', 'admis', 'moyenne_min', 10, 'matieres_echec_max', 2, 'portee', jsonb_build_object('niveaux', jsonb_build_array(:'n3', gen_random_uuid()))),
  jsonb_build_object('decision', 'admis', 'moyenne_min', 10, 'note_min_matieres', 6),
  jsonb_build_object('decision', 'redouble', 'moyenne_max', 10))) = 3, 'critères étendus enregistrés');
select pg_temp.verifier((select matieres_echec_max from public.criteres_decision where periode = 'a' and ordre = 1) = 2
  and (select jsonb_array_length(portee->'niveaux') from public.criteres_decision where periode = 'a' and ordre = 1) = 1
  and (select note_min_matieres from public.criteres_decision where periode = 'a' and ordre = 2) = 6,
  'portée limitée aux niveaux de l''établissement ; note minimale par matière conservée');

-- 2. Préparation : année cible créée sans être activée, structures dupliquées
do $$ begin perform public.transition_preparer(null, '2025-2026', '{}'::jsonb); raise exception 'année antérieure acceptée';
exception when sqlstate 'P0001' then raise notice 'ok : l''année cible doit suivre l''année de départ'; end $$;
do $$ begin perform public.transition_preparer(null, '2027-2029', '{}'::jsonb); raise exception 'format accepté';
exception when sqlstate 'P0001' then raise notice 'ok : année cible au format AAAA-AAAA+1'; end $$;
-- un enseignant désactivé ne bloque plus la préparation : sa matière est reprise sans enseignant et listée
reset role; update public.personnels set actif = false where id = :'prof_a'; set role authenticated;
select public.transition_preparer(null, '2027-2028', '{"programme": true, "bareme": true, "frais": true}'::jsonb) as prep \gset
select set_config('app.prep', :'prep', false) \g /dev/null
reset role; update public.personnels set actif = true where id = :'prof_a'; set role authenticated;
select pg_temp.verifier(jsonb_array_length(current_setting('app.prep')::jsonb -> 'sans_enseignant') > 0
  and (current_setting('app.prep')::jsonb -> 'sans_enseignant' -> 0 ->> 'matiere') is not null
  and (select count(*) from public.attributions where exercice_id = (current_setting('app.prep')::jsonb ->> 'cible_id')::uuid and enseignant_id is null)
      = jsonb_array_length(current_setting('app.prep')::jsonb -> 'sans_enseignant'),
  'enseignant désactivé : préparation acceptée, matières reprises sans enseignant et nommées');
reset role;
update public.attributions c set enseignant_id = a.enseignant_id from public.attributions a
 where c.exercice_id = (current_setting('app.prep')::jsonb ->> 'cible_id')::uuid and a.exercice_id = :'ex_a' and a.classe_id = c.classe_id and a.matiere_id = c.matiere_id;
set role authenticated;
select (:'prep'::jsonb ->> 'id') as tr \gset
select (:'prep'::jsonb ->> 'cible_id') as ex_c \gset
select pg_temp.verifier(not (select actif from public.exercices where id = :'ex_c') and (select actif from public.exercices where id = :'ex_a'),
  'année cible créée sans être activée ; l''année en cours reste active');
select pg_temp.verifier((select count(*) from public.attributions where exercice_id = :'ex_c') = (select count(*) from public.attributions where exercice_id = :'ex_a')
  and (select count(*) from public.sequences where exercice_id = :'ex_c') = 6, 'programme dupliqué (matières, coefficients, enseignants) ; 6 séquences créées');
select public.transition_preparer(null, '2027-2028', '{}'::jsonb) \g /dev/null
select pg_temp.verifier((select count(*) from public.attributions where exercice_id = :'ex_c') = (select count(*) from public.attributions where exercice_id = :'ex_a'),
  'nouvelle préparation : aucun doublon');
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select set_config('app.tr', :'tr', false) \g /dev/null
do $$ begin perform public.transition_simulation(current_setting('app.tr')::uuid); raise exception 'enseignant simule';
exception when insufficient_privilege then raise notice 'ok : transition réservée à l''administration'; end $$;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null

-- 3. Décisions incomplètes ou contradictoires : application refusée
select public.transition_enregistrer(:'tr', jsonb_build_array(
  jsonb_build_object('inscription_id', :'ins3', 'decision', 'change_cycle', 'niveau_destination_id', :'n2', 'serie_destination_id', :'sc', 'classe_destination_id', :'c2c', 'mention', 'Promu(e) en 2nde C'),
  jsonb_build_object('inscription_id', :'ins2', 'decision', 'redoublant', 'classe_destination_id', :'c3a', 'mention', 'Redoublant(e)'),
  jsonb_build_object('inscription_id', :'ins_a', 'decision', 'promu', 'mention', 'Promu(e)'))) \g /dev/null
select public.transition_simulation(:'tr') as sim \gset
select set_config('app.sim', :'sim', false) \g /dev/null
select pg_temp.verifier(exists (select 1 from jsonb_array_elements(current_setting('app.sim')::jsonb -> 'anomalies') a where a ->> 'type' = 'sans_destination')
  and exists (select 1 from jsonb_array_elements(current_setting('app.sim')::jsonb -> 'anomalies') a where a ->> 'type' = 'contradictoire')
  and ((current_setting('app.sim')::jsonb ->> 'inscrits')::int = (current_setting('app.sim')::jsonb ->> 'analyses')::int
       or exists (select 1 from jsonb_array_elements(current_setting('app.sim')::jsonb -> 'anomalies') a where a ->> 'type' = 'non_analyse')),
  'simulation : élève sans classe de destination, décision contradictoire, élèves non analysés signalés');
do $$ begin perform public.transition_appliquer(current_setting('app.tr')::uuid); raise exception 'appliquée malgré les anomalies';
exception when sqlstate 'P0001' then raise notice 'ok : application refusée tant qu''il reste des anomalies bloquantes'; end $$;
select pg_temp.verifier((select count(*) from public.inscriptions where exercice_id = :'ex_c') = 0, 'rien n''a été inscrit');

-- 4. Corrections : toutes les décisions, cohérentes
select public.transition_enregistrer(:'tr', (select jsonb_agg(jsonb_build_object('inscription_id', i.id, 'decision',
    case i.id when :'ins3' then 'change_cycle' when :'ins2' then 'redoublant' when :'ins_a' then 'redoublant' else 'sortant' end,
    'classe_destination_id', case i.id when :'ins3' then :'c2c' when :'ins2' then :'c2c' when :'ins_a' then i.classe_id::text end,
    'niveau_destination_id', case i.id when :'ins3' then :'n2' end, 'serie_destination_id', case i.id when :'ins3' then :'sc' end,
    'mention', case i.id when :'ins3' then 'Promu(e) en 2nde C' when :'ins2' then 'Redoublant(e)' when :'ins_a' then 'Redoublant(e)' else 'Sortant(e)' end, 'source', 'manuel'))
  from public.inscriptions i where i.exercice_id = :'ex_a')) \g /dev/null
select public.transition_simulation(:'tr') as sim2 \gset
select set_config('app.sim2', :'sim2', false) \g /dev/null
select pg_temp.verifier((current_setting('app.sim2')::jsonb ->> 'bloquantes')::int = 0 and (current_setting('app.sim2')::jsonb ->> 'redoublants')::int = 2
  and (current_setting('app.sim2')::jsonb ->> 'promus')::int = 1 and (current_setting('app.sim2')::jsonb ->> 'a_inscrire')::int = 3,
  'simulation corrigée : 1 promu, 2 redoublants, 3 à inscrire, aucune anomalie bloquante');
-- une décision « en attente du conseil » bloque l'application ; une réinscription en attente est seulement signalée
select public.transition_enregistrer(:'tr', jsonb_build_array(jsonb_build_object('inscription_id', :'ins_a', 'decision', 'attente_conseil'))) \g /dev/null
select public.transition_simulation(:'tr') as sim3 \gset
select set_config('app.sim3', :'sim3', false) \g /dev/null
select public.transition_enregistrer(:'tr', jsonb_build_array(jsonb_build_object('inscription_id', :'ins_a', 'decision', 'attente_reinscription'))) \g /dev/null
select public.transition_simulation(:'tr') as sim4 \gset
select set_config('app.sim4', :'sim4', false) \g /dev/null
select pg_temp.verifier((current_setting('app.sim3')::jsonb ->> 'bloquantes')::int = 1
  and exists (select 1 from jsonb_array_elements(current_setting('app.sim3')::jsonb -> 'anomalies') a where a ->> 'type' = 'attente' and (a ->> 'bloquante')::boolean)
  and (current_setting('app.sim4')::jsonb ->> 'bloquantes')::int = 0 and (current_setting('app.sim4')::jsonb ->> 'avertissements')::int >= 1,
  'décision du conseil en attente : bloquante ; réinscription en attente : avertissement');
select public.transition_enregistrer(:'tr', jsonb_build_array(jsonb_build_object('inscription_id', :'ins_a', 'decision', 'redoublant',
  'classe_destination_id', (select classe_id from public.inscriptions where id = :'ins_a'), 'mention', 'Redoublant(e)', 'source', 'manuel'))) \g /dev/null
select pg_temp.verifier((select mention from public.decisions_passage where inscription_id = :'ins2') = 'Redoublant(e)',
  'décision de passage (mention du bulletin) mise à jour');

-- 5. Application
select pg_temp.verifier((public.transition_appliquer(:'tr') ->> 'inscriptions')::int = 3, 'application : 3 inscriptions créées dans 2027-2028');
select pg_temp.verifier((select classe_id from public.inscriptions where exercice_id = :'ex_c' and eleve_id = (select eleve_id from public.inscriptions where id = :'ins3')) = :'c2c'::uuid
  and (select redoublant from public.inscriptions where exercice_id = :'ex_c' and eleve_id = (select eleve_id from public.inscriptions where id = :'ins2'))
  and not (select nouveau from public.inscriptions where exercice_id = :'ex_c' and eleve_id = (select eleve_id from public.inscriptions where id = :'ins3')),
  'élèves inscrits dans leur classe de destination ; redoublants marqués ; anciens élèves');
do $$ begin perform public.transition_enregistrer(current_setting('app.tr')::uuid, '[]'::jsonb); raise exception 'modification après application';
exception when sqlstate 'P0001' then raise notice 'ok : décisions figées après application'; end $$;

-- 6. Retour arrière : refusé si des données existent dans la nouvelle année, possible sinon
reset role;
insert into public.absences (etablissement_id, inscription_id, sequence_id, date, heures_non_justifiees)
select i.etablissement_id, i.id, (select id from public.sequences where exercice_id = :'ex_c' and numero = 1), current_date, 2
  from public.inscriptions i where i.exercice_id = :'ex_c' limit 1;
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
do $$ begin perform public.transition_annuler(current_setting('app.tr')::uuid, 'Erreur de classe'); raise exception 'annulée malgré des données';
exception when sqlstate 'P0001' then raise notice 'ok : retour arrière refusé quand des données existent dans la nouvelle année'; end $$;
reset role; delete from public.absences where inscription_id in (select id from public.inscriptions where exercice_id = :'ex_c'); set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.transition_annuler(:'tr', 'Conseil de classe à refaire') as nb_annul \gset
select pg_temp.verifier(:'nb_annul'::int = 3
  and (select count(*) from public.inscriptions where exercice_id = :'ex_c') = 0
  and (select statut from public.transitions where id = :'tr') = 'preparation', 'retour arrière : inscriptions supprimées, transition de nouveau modifiable');

-- 7. Clôture, activation, annulation tracée
select public.transition_appliquer(:'tr') \g /dev/null
select public.transition_cloturer(:'tr', true) \g /dev/null
select pg_temp.verifier((select actif from public.exercices where id = :'ex_c') and not (select actif from public.exercices where id = :'ex_a'),
  'clôture : l''année 2027-2028 devient l''année active');
do $$ begin perform public.transition_annuler(current_setting('app.tr')::uuid, 'Après clôture'); raise exception 'retour arrière après clôture';
exception when sqlstate 'P0001' then raise notice 'ok : aucun retour arrière après clôture'; end $$;
do $$ begin perform public.transition_rouvrir(current_setting('app.tr')::uuid, 'Erreur de saisie majeure constatée', 'oui'); raise exception 'confirmation ignorée';
exception when sqlstate 'P0001' then raise notice 'ok : annulation de la clôture refusée sans confirmation écrite'; end $$;
select public.transition_rouvrir(:'tr', 'Erreur de saisie majeure constatée par la direction', 'ANNULER LA CLÔTURE') \g /dev/null
select pg_temp.verifier((select statut from public.transitions where id = :'tr') = 'appliquee'
  and (select count(*) from public.transitions_journal where transition_id = :'tr' and action in ('preparation', 'decisions_enregistrees', 'application', 'retour_arriere', 'cloture', 'annulation_cloture')) >= 7
  and exists (select 1 from public.transitions_journal where transition_id = :'tr' and action = 'annulation_cloture' and motif like 'Erreur de saisie%'),
  'annulation de la clôture tracée (motif, confirmation) ; journal complet');
-- l'année en cours redevient active pour la suite des tests
reset role; update public.exercices set actif = true where id = :'ex_a'; set role authenticated;

-- 8. Cloisonnement
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.transitions) = 0 and (select count(*) from public.transition_lignes) = 0, 'transitions invisibles pour un autre établissement');
do $$ begin perform public.transition_simulation(current_setting('app.tr')::uuid); raise exception 'autre établissement';
exception when sqlstate 'P0001' or insufficient_privilege then raise notice 'ok : un autre établissement ne peut pas agir sur la transition'; end $$;
reset role;
