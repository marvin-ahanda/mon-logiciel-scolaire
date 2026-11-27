-- Campagnes fixées par les délégations (DDES : fiches des établissements ; DRES : synthèses départementales),
-- notification des établissements, priorité sur les campagnes nationales, accès exceptionnels accordés par la DRES.
-- Suite du scénario du pilotage institutionnel (mêmes comptes et délégations).
reset role;
select pg_temp.dep('Wouri') as wouri \gset
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "google"}}', false) \g /dev/null
-- un établissement du Wouri, rattaché et vérifié
select pg_temp.etre(:'E4') \g /dev/null
select public.etablissement_localisation(:'wouri') \g /dev/null
select pg_temp.etre(:'W1') \g /dev/null
select public.inst_verifier_rattachement(:'etab4', true) \g /dev/null

-- A. Saisie : messages clairs
select pg_temp.etre(:'D1N') \g /dev/null
do $$ begin perform public.inst_campagne_enregistrer('{"exercice": "2027/2028", "periode": "t1", "ouverture": "2027-10-01", "echeance": "2027-10-20"}');
  raise exception 'ÉCHEC : année mal écrite acceptée';
exception when sqlstate 'P0001' then if sqlerrm not like 'Année scolaire : écrivez%' then raise; end if; raise notice 'ok : campagne : année scolaire mal écrite expliquée'; end $$;
do $$ begin perform public.inst_campagne_enregistrer('{"exercice": "", "periode": "t1", "ouverture": "2027-10-01", "echeance": "2027-10-20"}');
  raise exception 'ÉCHEC : année vide acceptée';
exception when sqlstate 'P0001' then if sqlerrm not like 'Année scolaire%' then raise; end if; raise notice 'ok : campagne : année vide refusée avec un message clair'; end $$;
do $$ begin perform public.inst_campagne_enregistrer('{"exercice": "2027-2028", "periode": "t1", "ouverture": "", "echeance": "2027-10-20"}');
  raise exception 'ÉCHEC : date vide acceptée';
exception when sqlstate 'P0001' then if sqlerrm not like 'Indiquez la date d''ouverture%' then raise; end if; raise notice 'ok : campagne : date d''ouverture manquante expliquée'; end $$;
do $$ begin perform public.inst_campagne_enregistrer('{"exercice": "2027-2028", "periode": "t1", "ouverture": "2027-10-20", "echeance": "2027-10-01"}');
  raise exception 'ÉCHEC : échéance avant ouverture';
exception when sqlstate 'P0001' then if sqlerrm not like 'L''échéance doit%' then raise; end if; raise notice 'ok : campagne : échéance avant ouverture expliquée'; end $$;
-- collaborateur : pas de calendrier
select pg_temp.etre(:'C1') \g /dev/null
do $$ begin perform public.inst_campagne_enregistrer('{"exercice": "2027-2028", "periode": "t1", "ouverture": "2027-10-01", "echeance": "2027-10-20"}');
  raise exception 'ÉCHEC : collaborateur';
exception when insufficient_privilege then raise notice 'ok : campagne : seul le titulaire fixe le calendrier'; end $$;

-- B. Création par la DDES du Mfoundi : périmètre et notifications
select pg_temp.etre(:'D1N') \g /dev/null
select public.inst_campagne_enregistrer(json_build_object('exercice', '2027-2028', 'periode', 't1',
  'ouverture', public._aujourdhui() - 1, 'echeance', public._aujourdhui() + 14)::jsonb) as cm1 \gset
select set_config('app.cm1', :'cm1', false) \g /dev/null
select public.inst_campagnes_gerer() as g \gset
select pg_temp.verifier(:'g'::jsonb ->> 'niveau' = 'etablissement' and (:'g'::jsonb ->> 'peut_modifier')::boolean
  and exists (select 1 from jsonb_array_elements(:'g'::jsonb -> 'campagnes') x where x ->> 'id' = :'cm1' and (x ->> 'modifiable')::boolean and x ->> 'departement' = 'Mfoundi')
  and (:'g'::jsonb ->> 'destinataires')::int = 2,
  'DDES : campagne des établissements du Mfoundi créée par la délégation elle-même (2 établissements destinataires)');
reset role;
select pg_temp.verifier((select count(*) from public.inst_notifications where objet_id = :'cm1' and type = 'campagne' and etablissement_id in (:'etab1', :'etab2')) = 2
  and not exists (select 1 from public.inst_notifications where objet_id = :'cm1' and etablissement_id in (:'etab3', :'etab4'))
  and exists (select 1 from public.inst_journal where action = 'campagne créée' and objet_id = :'cm1'),
  'DDES : les établissements du département (et eux seuls) sont notifiés ; création journalisée');
set role authenticated;
-- notification lisible par l'administrateur de l'établissement seulement
select pg_temp.etre(:'E1') \g /dev/null
select pg_temp.verifier(exists (select 1 from jsonb_array_elements(public.inst_notifications_lire()) n where n ->> 'objet_id' = :'cm1' and n ->> 'titre' like 'Nouvelle campagne%')
  and public.inst_notifications_non_lues() >= 1,
  'établissement : l''administrateur reçoit la notification de la nouvelle campagne (compteur de non lues)');
reset role;
select id as prof_e1 from public.personnels where etablissement_id = :'etab1' and role = 'enseignant' limit 1 \gset
set role authenticated;
select pg_temp.etre(:'prof_e1') \g /dev/null
do $$ begin perform public.inst_notifications_lire(); raise exception 'ÉCHEC : un enseignant lit les notifications institutionnelles';
exception when insufficient_privilege or sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : notifications institutionnelles réservées aux administrateurs de l''établissement'; end $$;
select pg_temp.verifier(public.inst_notifications_non_lues() = 0, 'compteur de notifications : nul pour un non-administrateur');
-- l'établissement voit la campagne et prépare sa fiche ; un autre département ne la voit pas
select pg_temp.etre(:'E1') \g /dev/null
select pg_temp.verifier(exists (select 1 from jsonb_array_elements(public.inst_mes_fiches() -> 'campagnes') x where x ->> 'id' = :'cm1'),
  'établissement du Mfoundi : la campagne de sa délégation est proposée');
select public.inst_fiche_preparer(:'cm1') as fiche_cm1 \gset
select pg_temp.verifier(:'fiche_cm1' <> '', 'établissement du Mfoundi : fiche préparée sur la campagne départementale');
select pg_temp.etre(:'E4') \g /dev/null
select pg_temp.verifier(not exists (select 1 from jsonb_array_elements(public.inst_mes_fiches() -> 'campagnes') x where x ->> 'id' = :'cm1'),
  'établissement du Wouri : la campagne du Mfoundi ne lui est pas proposée');
do $$ begin perform public.inst_fiche_preparer(current_setting('app.cm1')::uuid); raise exception 'ÉCHEC : fiche hors périmètre';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : une campagne départementale ne s''applique pas aux autres départements'; end $$;
select pg_temp.etre(:'W1') \g /dev/null
select pg_temp.verifier(not exists (select 1 from jsonb_array_elements(public.inst_campagnes_lire('etablissement')) x where x ->> 'id' = :'cm1'),
  'DDES du Wouri : ne voit pas la campagne du Mfoundi');
do $$ begin perform public.inst_tableau_departement(current_setting('app.cm1')::uuid); raise exception 'ÉCHEC : tableau hors circonscription';
exception when insufficient_privilege then raise notice 'ok : tableau de bord refusé sur la campagne d''une autre délégation'; end $$;
do $$ begin perform public.inst_campagne_enregistrer(jsonb_build_object('id', current_setting('app.cm1'), 'ouverture', '2027-01-01', 'echeance', '2027-02-01'));
  raise exception 'ÉCHEC : modification par une autre délégation';
exception when insufficient_privilege then raise notice 'ok : une délégation ne modifie que ses propres campagnes'; end $$;

-- C. Modification par la DDES : nouvelle échéance annoncée ; doublon expliqué
select pg_temp.etre(:'D1N') \g /dev/null
select public.inst_campagne_enregistrer(json_build_object('id', :'cm1', 'ouverture', public._aujourdhui() - 1, 'echeance', public._aujourdhui() + 21)::jsonb) \g /dev/null
reset role;
select pg_temp.verifier((select echeance from public.inst_campagnes where id = :'cm1') = public._aujourdhui() + 21
  and (select count(*) from public.inst_notifications where objet_id = :'cm1' and titre like 'Calendrier modifié%') = 2,
  'DDES : échéance repoussée, établissements prévenus du nouveau calendrier');
set role authenticated;
select pg_temp.etre(:'D1N') \g /dev/null
do $$ begin perform public.inst_campagne_enregistrer(jsonb_build_object('exercice', '2027-2028', 'periode', 't1', 'ouverture', '2027-10-01', 'echeance', '2027-10-20'));
  raise exception 'ÉCHEC : doublon';
exception when sqlstate 'P0001' then if sqlerrm not like 'Une campagne existe déjà%' then raise; end if; raise notice 'ok : campagne en double expliquée'; end $$;
select public.inst_campagne_enregistrer(jsonb_build_object('niveau', 'departement', 'exercice', '2027-2028', 'periode', 't2', 'ouverture', '2027-10-01', 'echeance', '2027-10-20')) as cm2 \gset
reset role;
select pg_temp.verifier((select niveau from public.inst_campagnes where id = :'cm2') = 'etablissement',
  'une DDES ne fixe que les campagnes des fiches de ses établissements (le niveau demandé est ignoré)');
set role authenticated;

-- D. Priorité sur la campagne nationale ; campagne nationale déjà commencée = référence
select pg_temp.etre(:'P') \g /dev/null
select public.console_inst_campagne(json_build_object('niveau', 'etablissement', 'exercice', '2027-2028', 'periode', 't3',
  'ouverture', public._aujourdhui() - 1, 'echeance', public._aujourdhui() + 30)::jsonb) as cn3 \gset
select set_config('app.cn3', :'cn3', false) \g /dev/null
select pg_temp.etre(:'E1') \g /dev/null
select public.inst_fiche_preparer(:'cn3') \g /dev/null
select pg_temp.etre(:'D1N') \g /dev/null
do $$ begin perform public.inst_campagne_enregistrer('{"exercice": "2027-2028", "periode": "t3", "ouverture": "2027-10-01", "echeance": "2027-10-20"}');
  raise exception 'ÉCHEC : campagne nationale commencée remplacée';
exception when sqlstate 'P0001' then if sqlerrm not like 'Une campagne nationale est déjà en cours%' then raise; end if;
  raise notice 'ok : une campagne nationale déjà commencée dans le département reste la référence'; end $$;
select pg_temp.etre(:'W1') \g /dev/null
select public.inst_campagne_enregistrer(json_build_object('exercice', '2027-2028', 'periode', 't3',
  'ouverture', public._aujourdhui(), 'echeance', public._aujourdhui() + 10)::jsonb) as cw3 \gset
select pg_temp.verifier(exists (select 1 from jsonb_array_elements(public.inst_campagnes_lire('etablissement')) x where x ->> 'id' = :'cw3')
  and not exists (select 1 from jsonb_array_elements(public.inst_campagnes_lire('etablissement')) x where x ->> 'id' = :'cn3'),
  'DDES du Wouri : sa campagne remplace la campagne nationale de même période dans son département');
select pg_temp.etre(:'D1N') \g /dev/null
select pg_temp.verifier(exists (select 1 from jsonb_array_elements(public.inst_campagnes_lire('etablissement')) x where x ->> 'id' = :'cn3'),
  'DDES du Mfoundi : la campagne nationale s''applique toujours à son département');
-- changement de département : la fiche commencée suit la campagne du nouveau département à la publication
select pg_temp.etre(:'E2') \g /dev/null
select public.inst_fiche_preparer(:'cn3') as fiche_e2 \gset
select public.etablissement_localisation(:'wouri') \g /dev/null
select pg_temp.etre(:'W1') \g /dev/null
select public.inst_verifier_rattachement(:'etab2', true) \g /dev/null
select pg_temp.etre(:'E2') \g /dev/null
select public.inst_fiche_publier(:'fiche_e2', true) as pub_e2 \gset
reset role;
select pg_temp.verifier((select campagne_id from public.inst_fiches where id = :'fiche_e2') = :'cw3'
  and (select destinataire_id from public.inst_fiche_versions where fiche_id = :'fiche_e2') = :'del_wouri',
  'changement de département : la fiche est rattachée à la campagne du nouveau département et transmise à sa délégation');
set role authenticated;
select pg_temp.etre(:'W1') \g /dev/null
select pg_temp.verifier(exists (select 1 from jsonb_array_elements(public.inst_tableau_departement(:'cw3') -> 'etablissements') x
  where x ->> 'id' = :'etab2' and x ->> 'statut' <> 'non_publiee'), 'changement de département : la fiche apparaît dans le tableau de la nouvelle délégation');

-- E. DRES : campagne des synthèses départementales de sa région
select pg_temp.etre(:'R1') \g /dev/null
select public.inst_campagne_enregistrer(json_build_object('exercice', '2027-2028', 'periode', 't1',
  'ouverture', public._aujourdhui(), 'echeance', public._aujourdhui() + 30)::jsonb) as cr1 \gset
reset role;
select pg_temp.verifier((select niveau from public.inst_campagnes where id = :'cr1') = 'departement' and (select region_id from public.inst_campagnes where id = :'cr1') = pg_temp.reg('Centre')
  and exists (select 1 from public.inst_notifications where objet_id = :'cr1' and delegation_id = :'del_mfoundi' and type = 'campagne')
  and not exists (select 1 from public.inst_notifications where objet_id = :'cr1' and delegation_id = :'del_wouri'),
  'DRES : campagne des synthèses de sa région ; les DDES de la région sont prévenues, pas les autres');
set role authenticated;
select pg_temp.etre(:'D1N') \g /dev/null
select pg_temp.verifier(exists (select 1 from jsonb_array_elements(public.inst_syntheses()) x where x ->> 'id' = :'cr1'),
  'DDES du Mfoundi : la campagne régionale de synthèse lui est proposée');
select pg_temp.etre(:'W1') \g /dev/null
select pg_temp.verifier(not exists (select 1 from jsonb_array_elements(public.inst_syntheses()) x where x ->> 'id' = :'cr1'),
  'DDES du Wouri (autre région) : la campagne du Centre ne la concerne pas');

-- F. Accès exceptionnels gérés par la DRES
select pg_temp.etre(:'R1') \g /dev/null
do $$ begin perform public.inst_derogation_accorder(pg_temp.dep('Wouri'), null, 7, 'Enquête sur la région voisine'); raise exception 'ÉCHEC : hors région';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : accès exceptionnel limité à la région de la DRES'; end $$;
do $$ begin perform public.inst_derogation_accorder(pg_temp.dep('Mfoundi'), null, 120, 'Durée excessive demandée'); raise exception 'ÉCHEC : 120 jours';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : accès exceptionnel limité à 90 jours'; end $$;
select public.inst_derogation_accorder(:'mfoundi', null, 10, 'Contrôle de cohérence des fiches du trimestre') as der1 \gset
select set_config('app.der1', :'der1', false) \g /dev/null
do $$ begin perform public.inst_derogation_accorder(pg_temp.dep('Mfoundi'), null, 30, 'Renouvellement anticipé de l''accès'); raise exception 'ÉCHEC : accès en double';
exception when sqlstate 'P0001' then if sqlerrm not like 'Un accès exceptionnel est déjà actif%' then raise; end if; raise notice 'ok : pas de second accès actif sur le même périmètre'; end $$;
select pg_temp.verifier(exists (select 1 from jsonb_array_elements(public.inst_derogations() -> 'derogations') x where x ->> 'id' = :'der1' and (x ->> 'active')::boolean)
  and exists (select 1 from jsonb_array_elements(public.inst_fiches_derogation()) g where g ->> 'derogation' = :'der1'),
  'DRES : accès exceptionnel accordé par la délégation elle-même et utilisable aussitôt');
reset role;
select pg_temp.verifier(exists (select 1 from public.inst_notifications where objet_id = :'der1' and delegation_id = :'del_mfoundi' and type = 'derogation')
  and exists (select 1 from public.inst_journal where action = 'dérogation accordée' and details ->> 'derogation' = :'der1'),
  'DRES : la DDES concernée est prévenue et l''accès est journalisé');
set role authenticated;
select pg_temp.etre(:'D1N') \g /dev/null
do $$ begin perform public.inst_derogation_accorder(pg_temp.dep('Mfoundi'), null, 5, 'Une DDES qui s''accorde un accès'); raise exception 'ÉCHEC : DDES';
exception when insufficient_privilege then raise notice 'ok : seule une délégation régionale accorde un accès exceptionnel'; end $$;
do $$ begin perform public.inst_derogation_revoquer(current_setting('app.der1')::uuid); raise exception 'ÉCHEC : révocation par une autre délégation';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : une délégation ne révoque que ses propres accès'; end $$;
select pg_temp.etre(:'R1') \g /dev/null
select public.inst_derogation_revoquer(:'der1') \g /dev/null
select pg_temp.verifier(not exists (select 1 from jsonb_array_elements(public.inst_fiches_derogation()) g where g ->> 'derogation' = :'der1')
  and exists (select 1 from jsonb_array_elements(public.inst_derogations() -> 'derogations') x where x ->> 'id' = :'der1' and x ->> 'revoquee_le' is not null),
  'DRES : accès révoqué aussitôt, conservé dans l''historique');

-- G. Console : messages clairs aussi
select pg_temp.etre(:'P') \g /dev/null
do $$ begin perform public.console_inst_campagne('{"niveau": "etablissement", "exercice": "2027 - 2028", "periode": "t2", "ouverture": "2027-10-01", "echeance": "2027-10-20"}');
  raise exception 'ÉCHEC : console, année mal écrite';
exception when sqlstate 'P0001' then if sqlerrm not like 'Année scolaire : écrivez%' then raise; end if; raise notice 'ok : console : année scolaire mal écrite expliquée'; end $$;
select pg_temp.verifier(exists (select 1 from jsonb_array_elements(public.console_inst_parametres(null) -> 'campagnes') x where x ->> 'id' = :'cm1' and x ->> 'auteur' is not null),
  'console : les campagnes des délégations sont visibles, avec leur auteur');
reset role;
