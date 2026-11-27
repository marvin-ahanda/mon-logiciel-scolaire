-- SmartEval : durée individuelle de composition, chronomètre contrôlé par le serveur (établissement et indépendant).
-- Le temps est simulé en déplaçant les dates des tentatives (le serveur seul calcule l'échéance).

-- A. Réglage par l'enseignant (établissement)
reset role; set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select public.smarteval_enregistrer(jsonb_build_object('titre', 'Composition chronométrée', 'consignes', 'Sans document.', 'competence', 'Fractions',
  'matiere_id', :'math_a', 'classes', jsonb_build_array(:'classe_a'),
  'questions', '[{"id":"q1","type":"choix","intitule":"1/2 + 1/4 = ?","options":["3/4","2/6"],"bonnes":[0],"points":2},
                 {"id":"q2","type":"courte","intitule":"Capitale","acceptees":["Yaoundé"],"points":1}]'::jsonb)) ->> 'id' as ch \gset
select set_config('app.ch', :'ch', false) \g /dev/null
do $$ begin perform public.smarteval_chrono_definir(current_setting('app.ch')::uuid, 30, true); raise exception 'ÉCHEC : 30 s acceptées';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : chrono : durée inférieure à 1 minute refusée'; end $$;
do $$ begin perform public.smarteval_chrono_definir(current_setting('app.ch')::uuid, 50000, true); raise exception 'ÉCHEC : 50000 s acceptées';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : chrono : durée supérieure à 12 heures refusée'; end $$;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
do $$ begin perform public.smarteval_chrono_definir(current_setting('app.ch')::uuid, 3600, true); raise exception 'ÉCHEC : autre utilisateur';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : chrono : seul l''auteur règle la durée'; end $$;
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select public.smarteval_chrono_definir(:'ch'::uuid, 2700, true) \g /dev/null
select pg_temp.verifier((public.smarteval_detail(:'ch'::uuid) ->> 'chrono_secondes')::int = 2700 and (public.smarteval_detail(:'ch'::uuid) ->> 'chrono_auto')::boolean,
  'chrono : 45 minutes enregistrées (en secondes), soumission automatique activée par défaut');
select public.smarteval_publier(:'ch'::uuid, 2, 'jours', '{}'::jsonb) ->> 'jeton' as jch \gset
select set_config('app.jch', :'jch', false) \g /dev/null
do $$ begin perform public.smarteval_chrono_definir(current_setting('app.ch')::uuid, 600, true); raise exception 'ÉCHEC : durée modifiée après publication';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : chrono : durée figée après publication'; end $$;

-- B. Élève : page de présentation, sans questions avant le démarrage
reset role; set role anon; select set_config('request.jwt.claim.sub', '', false) \g /dev/null
select public.smarteval_formulaire(:'jch') as fch \gset
select set_config('app.fch', :'fch', false) \g /dev/null
select pg_temp.verifier((current_setting('app.fch')::jsonb ->> 'chrono_secondes')::int = 2700 and (current_setting('app.fch')::jsonb ->> 'nb_questions')::int = 2
  and not (current_setting('app.fch')::jsonb ? 'questions') and not (current_setting('app.fch') like '%Capitale%'),
  'présentation : durée et nombre de questions affichés, questions cachées avant le démarrage');
do $$ begin perform 1 from public.smarteval_tentatives; raise exception 'ÉCHEC : tentatives lisibles';
exception when insufficient_privilege then raise notice 'ok : tentatives non lisibles directement'; end $$;
-- soumission directe sans tentative : impossible
do $$ begin perform public.smarteval_soumettre(current_setting('app.jch'), jsonb_build_object('nom', 'Direct', 'prenom', 'Paul', 'classe_id', current_setting('app.classe_a'),
    'reponses', '{"q1": 0}'::jsonb)); raise exception 'ÉCHEC : contournement du chronomètre';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : anti-contournement : pas de soumission sans tentative démarrée'; end $$;
do $$ begin perform public.smarteval_demarrer(current_setting('app.jch'), jsonb_build_object('nom', '', 'prenom', 'X', 'classe_id', current_setting('app.classe_a')));
  raise exception 'ÉCHEC : identité vide';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : démarrage : identification obligatoire avant le chronomètre'; end $$;

-- C. Démarrage : heure du serveur, échéance individuelle, jeton secret
select public.smarteval_demarrer(:'jch', jsonb_build_object('nom', 'Ateba', 'prenom', 'Luc', 'classe_id', :'classe_a')) as d1 \gset
select set_config('app.d1', :'d1', false) \g /dev/null
select :'d1'::jsonb ->> 'tentative' as t1, :'d1'::jsonb ->> 'code_reprise' as code1 \gset
select set_config('app.t1', :'t1', false) \g /dev/null
select pg_temp.verifier((:'d1'::jsonb ->> 'expire_le')::timestamptz - (:'d1'::jsonb ->> 'debut')::timestamptz = interval '45 minutes'
  and :'d1'::jsonb ->> 'statut' = 'en_cours' and jsonb_array_length(:'d1'::jsonb -> 'questions') = 2 and not (:'d1' like '%bonnes%')
  and length(:'t1') = 48 and length(:'code1') = 12 and :'d1'::jsonb ? 'maintenant',
  'démarrage : échéance = début + 45 min (heure du serveur), questions révélées sans corrigé, jeton et code de reprise remis');
reset role;
select pg_temp.verifier((select count(*) from public.smarteval_tentatives where evaluation_id = :'ch' and identite like 'ateba|luc|%') = 1
  and not exists (select 1 from public.smarteval_tentatives where jeton_hash = :'t1' or code_hash = :'code1'),
  'tentative : une seule ligne, jeton et code conservés uniquement sous forme d''empreinte');
set role anon;
do $$ declare h text; begin perform public.smarteval_demarrer(current_setting('app.jch'), jsonb_build_object('nom', 'ATEBA', 'prenom', 'luc', 'classe_id', current_setting('app.classe_a')));
  raise exception 'ÉCHEC : seconde tentative';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; get stacked diagnostics h = pg_exception_hint;
  if h <> 'smarteval:en_cours' then raise exception 'ÉCHEC : indice %', h; end if; raise notice 'ok : démarrage : pas de seconde tentative (même nom, casse différente)'; end $$;

-- D. Sauvegarde et reprise : l'actualisation ne remet jamais le temps à zéro
select (public.smarteval_sauver(:'jch', :'t1', '{"q1": 0}'::jsonb) ->> 'sauve_le') is not null as sauve \gset
select public.smarteval_reprendre(:'jch', :'t1') as r1 \gset
select pg_temp.verifier(:'r1'::jsonb ->> 'expire_le' = :'d1'::jsonb ->> 'expire_le' and (:'r1'::jsonb #>> '{reponses,q1}') = '0' and :'sauve'::boolean,
  'reprise : même échéance après actualisation, réponses sauvegardées sur le serveur restituées');
do $$ begin perform public.smarteval_sauver(current_setting('app.jch'), repeat('0', 48), '{}'::jsonb); raise exception 'ÉCHEC : jeton inventé';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : sauvegarde : jeton de tentative inconnu refusé'; end $$;
do $$ begin perform public.smarteval_sauver(current_setting('app.jch'), current_setting('app.t1'), '[1]'::jsonb); raise exception 'ÉCHEC : réponses non objet';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : sauvegarde : format des réponses validé'; end $$;
-- autre appareil : identité + code ; l'ancien jeton cesse de fonctionner
do $$ begin perform public.smarteval_reprendre(current_setting('app.jch'), null, jsonb_build_object('nom', 'Ateba', 'prenom', 'Luc', 'classe_id', current_setting('app.classe_a')), 'ZZZZZZZZZZZZ');
  raise exception 'ÉCHEC : mauvais code';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : reprise : code de reprise incorrect refusé'; end $$;
select public.smarteval_reprendre(:'jch', null, jsonb_build_object('nom', 'Ateba', 'prenom', 'Luc', 'classe_id', :'classe_a'), lower(:'code1')) as r2 \gset
select :'r2'::jsonb ->> 'tentative' as t1b \gset
select set_config('app.t1b', :'t1b', false) \g /dev/null
select pg_temp.verifier(:'t1b' <> :'t1' and :'r2'::jsonb ->> 'expire_le' = :'d1'::jsonb ->> 'expire_le', 'reprise sur un autre appareil : nouveau jeton, même échéance');
do $$ begin perform public.smarteval_sauver(current_setting('app.jch'), current_setting('app.t1'), '{}'::jsonb); raise exception 'ÉCHEC : ancien jeton';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : reprise : l''ancien appareil ne peut plus modifier la copie'; end $$;

-- E. Soumission anticipée, idempotente
select public.smarteval_soumettre(:'jch', jsonb_build_object('tentative', :'t1b', 'reponses', '{"q1": 0, "q2": "Yaoundé"}'::jsonb)) as s1 \gset
select public.smarteval_soumettre(:'jch', jsonb_build_object('tentative', :'t1b', 'reponses', '{"q1": 1}'::jsonb)) as s1bis \gset
select pg_temp.verifier(:'s1'::jsonb ->> 'statut' = 'soumise' and (:'s1'::jsonb ->> 'numero') is not null and :'s1'::jsonb ->> 'recu' = :'s1bis'::jsonb ->> 'recu'
  and :'s1bis'::jsonb ->> 'numero' = :'s1'::jsonb ->> 'numero', 'soumission anticipée : copie créée ; un second envoi renvoie le même reçu sans doublon');
do $$ begin perform public.smarteval_sauver(current_setting('app.jch'), current_setting('app.t1b'), '{"q1": 1}'::jsonb); raise exception 'ÉCHEC : modification après envoi';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : après soumission : réponses figées'; end $$;
do $$ begin perform public.smarteval_demarrer(current_setting('app.jch'), jsonb_build_object('nom', 'Ateba', 'prenom', 'Luc', 'classe_id', current_setting('app.classe_a')));
  raise exception 'ÉCHEC : nouvelle tentative après envoi';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : après soumission : aucune nouvelle tentative'; end $$;
reset role;
select pg_temp.verifier((select count(*) from public.soumissions where evaluation_id = :'ch') = 1
  and (select note20 from public.soumissions where evaluation_id = :'ch') = 20
  and (select reponses ->> 'q1' from public.soumissions where evaluation_id = :'ch') = '0',
  'soumission anticipée : correction existante appliquée (20/20), réponses de l''envoi retenues');

-- F. Expiration : verrouillage, soumission automatique des dernières réponses enregistrées
set role anon;
select public.smarteval_demarrer(:'jch', jsonb_build_object('nom', 'Bilong', 'prenom', 'Eva', 'classe_id', :'classe_a')) ->> 'tentative' as t2 \gset
select set_config('app.t2', :'t2', false) \g /dev/null
select public.smarteval_sauver(:'jch', :'t2', '{"q1": 0}'::jsonb) \g /dev/null
reset role;
update public.smarteval_tentatives set debut = now() - interval '46 minutes', expire_le = now() - interval '1 minute', sauve_le = now() - interval '2 minutes'
 where evaluation_id = :'ch' and identite like 'bilong|eva|%';
set role anon;
do $$ declare h text; begin perform public.smarteval_sauver(current_setting('app.jch'), current_setting('app.t2'), '{"q1": 1, "q2": "Yaoundé"}'::jsonb);
  raise exception 'ÉCHEC : sauvegarde après l''échéance';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; get stacked diagnostics h = pg_exception_hint;
  if h <> 'smarteval:expire' then raise exception 'ÉCHEC : indice %', h; end if; raise notice 'ok : expiration : aucune modification acceptée après l''échéance'; end $$;
select public.smarteval_soumettre(:'jch', jsonb_build_object('tentative', :'t2', 'reponses', '{"q1": 1, "q2": "Yaoundé"}'::jsonb)) as s2 \gset
reset role;
select pg_temp.verifier(:'s2'::jsonb ->> 'statut' = 'expiree' and (:'s2'::jsonb ->> 'expiree')::boolean
  and (select reponses ->> 'q1' from public.soumissions where evaluation_id = :'ch' and identite like 'bilong|eva|%') = '0'
  and (select reponses ->> 'q2' from public.soumissions where evaluation_id = :'ch' and identite like 'bilong|eva|%') is null
  and (select s.soumis_le = t.expire_le from public.soumissions s join public.smarteval_tentatives t on t.evaluation_id = s.evaluation_id and t.identite = s.identite
        where s.evaluation_id = :'ch' and s.identite like 'bilong|eva|%'),
  'expiration : copie soumise automatiquement avec les réponses enregistrées avant l''échéance ; heure officielle = échéance ; envoi tardif ignoré');
-- connexion perdue : la copie est clôturée par le travailleur planifié, une seule fois
set role anon;
select public.smarteval_demarrer(:'jch', jsonb_build_object('nom', 'Chia', 'prenom', 'Rose', 'classe_id', :'classe_a')) ->> 'tentative' as t3 \gset
select public.smarteval_sauver(:'jch', :'t3', '{"q2": "Yaounde"}'::jsonb) \g /dev/null
reset role;
update public.smarteval_tentatives set debut = now() - interval '50 minutes', expire_le = now() - interval '5 minutes' where evaluation_id = :'ch' and identite like 'chia|rose|%';
set role anon;
select public.smarteval_expirer() as n_exp \gset
select public.smarteval_expirer() as n_exp2 \gset
reset role;
select pg_temp.verifier(:'n_exp'::int >= 1 and :'n_exp2'::int = 0
  and (select statut from public.smarteval_tentatives where evaluation_id = :'ch' and identite like 'chia|rose|%') = 'expiree'
  and (select count(*) from public.soumissions where evaluation_id = :'ch' and identite like 'chia|rose|%') = 1,
  'connexion perdue à l''échéance : copie clôturée par le serveur, une seule fois (idempotent)');
set role anon;
select public.smarteval_reprendre(:'jch', :'t3') as r3 \gset
select pg_temp.verifier(:'r3'::jsonb ->> 'statut' = 'expiree' and (:'r3'::jsonb -> 'questions') = 'null'::jsonb and (:'r3'::jsonb -> 'reponses') = 'null'::jsonb,
  'retour de l''élève après l''échéance : temps écoulé, questions et réponses plus modifiables');

-- G. Échéance générale conservée : échéance individuelle = min(début + durée, fermeture)
reset role;
update public.evaluations set ferme_le = now() + interval '10 minutes' where id = :'ch';
set role anon;
select public.smarteval_demarrer(:'jch', jsonb_build_object('nom', 'Djou', 'prenom', 'Ali', 'classe_id', :'classe_a')) as d4 \gset
reset role;
select pg_temp.verifier((:'d4'::jsonb ->> 'expire_le')::timestamptz = (select ferme_le from public.evaluations where id = :'ch')
  and (:'d4'::jsonb ->> 'expire_le')::timestamptz < (:'d4'::jsonb ->> 'debut')::timestamptz + interval '45 minutes',
  'échéance générale : un élève qui commence tard s''arrête à la fermeture de l''évaluation');
update public.evaluations set ferme_le = now() - interval '1 second' where id = :'ch';
set role anon;
do $$ begin perform public.smarteval_demarrer(current_setting('app.jch'), jsonb_build_object('nom', 'Ekane', 'prenom', 'Rita', 'classe_id', current_setting('app.classe_a')));
  raise exception 'ÉCHEC : démarrage après la fermeture';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : aucun démarrage après la fermeture de l''évaluation'; end $$;

-- H. Suivi de l'enseignant
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select public.smarteval_tentatives(:'ch'::uuid) as suivi \gset
select pg_temp.verifier(jsonb_array_length(:'suivi'::jsonb) = 4
  and (select count(*) from jsonb_array_elements(:'suivi'::jsonb) x where x ->> 'statut' = 'soumise' and (x ->> 'temps_utilise')::int >= 0) = 1
  and (select count(*) from jsonb_array_elements(:'suivi'::jsonb) x where x ->> 'statut' = 'expiree' and (x ->> 'copie') is not null) = 3
  and (select (x ->> 'duree_secondes')::int from jsonb_array_elements(:'suivi'::jsonb) x limit 1) = 2700,
  'suivi : 4 tentatives (1 soumise, 3 temps écoulé, dont la dernière clôturée à la fermeture), durée et temps utilisé');
select (x ->> 'id') as tent_ateba from jsonb_array_elements(:'suivi'::jsonb) x where x ->> 'nom' = 'ATEBA' \gset
select set_config('app.tent_ateba', :'tent_ateba', false) \g /dev/null
do $$ begin perform public.smarteval_tentative_reinitialiser(current_setting('app.tent_ateba')::uuid); raise exception 'ÉCHEC : tentative avec copie réinitialisée';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : réinitialisation : impossible quand une copie existe'; end $$;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
do $$ begin perform public.smarteval_tentative_reinitialiser(current_setting('app.tent_ateba')::uuid); raise exception 'ÉCHEC : réinitialisation par un autre';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : réinitialisation : réservée à l''auteur'; end $$;
do $$ begin perform public.smarteval_tentatives(current_setting('app.ch')::uuid); raise exception 'ÉCHEC : suivi visible par un autre';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : suivi : réservé à l''auteur'; end $$;

-- I. SmartEval indépendant (Découverte : 2 soumissions) : soumission automatique désactivée, quota compté avec les compositions en cours
reset role;
insert into auth.users (id, email, email_confirmed_at) values ('e1e1e1e1-0000-4000-8000-000000000071', 'chrono.prof@gmail.com', now());
\set ens7 e1e1e1e1-0000-4000-8000-000000000071
set role authenticated;
select set_config('request.jwt.claim.sub', :'ens7', false) \g /dev/null
select public.enseignant_inscription('Kamga', 'Iris') \g /dev/null
select (public.se_enregistrer(jsonb_build_object('titre', 'Chrono indépendant', 'competence', 'C', 'classe', '5e', 'groupes', '["A"]'::jsonb,
  'questions', '[{"id":"q1","type":"courte","intitule":"Capitale","acceptees":["Yaoundé"],"points":1}]'::jsonb)) ->> 'id') as sec \gset
select public.smarteval_chrono_definir(:'sec'::uuid, 900, false) \g /dev/null
select pg_temp.verifier((public.se_detail(:'sec') ->> 'chrono_secondes')::int = 900 and not (public.se_detail(:'sec') ->> 'chrono_auto')::boolean,
  'indépendant : durée de 15 minutes, soumission automatique désactivée');
select public.se_publier(:'sec', 1, 'jours', '{}') ->> 'jeton' as jsec \gset
select set_config('app.jsec', :'jsec', false) \g /dev/null
reset role; set role anon; select set_config('request.jwt.claim.sub', '', false) \g /dev/null
select pg_temp.verifier((public.smarteval_formulaire(:'jsec') ->> 'chrono_secondes')::int = 900 and not (public.smarteval_formulaire(:'jsec') ? 'questions'),
  'indépendant : présentation sans questions avant le démarrage');
select public.smarteval_demarrer(:'jsec', jsonb_build_object('nom', 'Ngo', 'prenom', 'Anne', 'classe_id', '5e A')) ->> 'tentative' as ti1 \gset
select public.smarteval_demarrer(:'jsec', jsonb_build_object('nom', 'Owona', 'prenom', 'Marc', 'classe_id', '5e A')) ->> 'tentative' as ti2 \gset
do $$ declare h text; begin perform public.smarteval_demarrer(current_setting('app.jsec'), jsonb_build_object('nom', 'Tchana', 'prenom', 'Lea', 'classe_id', '5e A'));
  raise exception 'ÉCHEC : quota dépassé';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; get stacked diagnostics h = pg_exception_hint;
  if h <> 'smarteval:soumissions' then raise exception 'ÉCHEC : indice %', h; end if; raise notice 'ok : quota Découverte : les compositions en cours comptent, aucun crédit nouveau'; end $$;
select public.smarteval_soumettre(:'jsec', jsonb_build_object('tentative', :'ti1', 'reponses', '{"q1": "Yaoundé"}'::jsonb)) ->> 'statut' as st_i1 \gset
select public.smarteval_sauver(:'jsec', :'ti2', '{"q1": "Douala"}'::jsonb) \g /dev/null
reset role;
update public.smarteval_tentatives set debut = now() - interval '20 minutes', expire_le = now() - interval '1 minute' where identite like 'owona|marc|%';
set role anon;
select public.smarteval_soumettre(:'jsec', jsonb_build_object('tentative', :'ti2', 'reponses', '{"q1": "Yaoundé"}'::jsonb)) as si2 \gset
reset role;
select pg_temp.verifier(:'st_i1' = 'soumise' and :'si2'::jsonb ->> 'statut' = 'expiree' and not (:'si2'::jsonb ->> 'copie_creee')::boolean
  and (select count(*) from public.se_soumissions where evaluation_id = :'sec') = 1
  and (select note20 from public.se_soumissions where evaluation_id = :'sec') = 20,
  'indépendant : copie soumise corrigée ; sans soumission automatique, le temps écoulé ne crée pas de copie');
set role authenticated;
select set_config('request.jwt.claim.sub', :'ens7', false) \g /dev/null
select pg_temp.verifier(jsonb_array_length(public.smarteval_tentatives(:'sec'::uuid)) = 2, 'indépendant : suivi des tentatives par l''enseignant');
select (x ->> 'id') as tent_owona from jsonb_array_elements(public.smarteval_tentatives(:'sec'::uuid)) x where x ->> 'nom' = 'OWONA' \gset
select public.smarteval_tentative_reinitialiser(:'tent_owona'::uuid) \g /dev/null
reset role; set role anon;
select pg_temp.verifier(length(public.smarteval_demarrer(:'jsec', jsonb_build_object('nom', 'Owona', 'prenom', 'Marc', 'classe_id', '5e A')) ->> 'tentative') = 48,
  'réinitialisation par l''enseignant (tentative sans copie) : l''élève bloqué peut recommencer');
reset role; set role authenticated;

-- I bis. Matricule obligatoire : c'est lui qui identifie l'élève (un nom mal orthographié ne donne pas de seconde tentative)
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select public.smarteval_enregistrer(jsonb_build_object('titre', 'Chrono matricule', 'competence', 'C', 'matiere_id', :'math_a', 'classes', jsonb_build_array(:'classe_a'),
  'questions', '[{"id":"q1","type":"courte","intitule":"Q","acceptees":["a"],"points":1}]'::jsonb)) ->> 'id' as cm \gset
select public.smarteval_anonymiser(:'cm'::uuid, true) \g /dev/null
select public.smarteval_chrono_definir(:'cm'::uuid, 600, true) \g /dev/null
select public.smarteval_publier(:'cm'::uuid, 1, 'heures', '{}'::jsonb) ->> 'jeton' as jcm \gset
select set_config('app.jcm', :'jcm', false) \g /dev/null
reset role; set role anon;
select public.smarteval_demarrer(:'jcm', jsonb_build_object('nom', 'Dupont', 'prenom', 'Jean', 'classe_id', :'classe_a', 'matricule', 'm-001')) \g /dev/null
do $$ declare h text; begin perform public.smarteval_demarrer(current_setting('app.jcm'), jsonb_build_object('nom', 'Dupond', 'prenom', 'Jean',
    'classe_id', current_setting('app.classe_a'), 'matricule', 'M-001'));
  raise exception 'ÉCHEC : seconde tentative sous un autre nom';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; get stacked diagnostics h = pg_exception_hint;
  if h <> 'smarteval:en_cours' then raise exception 'ÉCHEC : indice %', h; end if;
  raise notice 'ok : matricule obligatoire : pas de seconde tentative en changeant l''orthographe du nom'; end $$;
reset role; set role authenticated;

-- J. Non-régression : une évaluation sans durée garde le fonctionnement direct
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select public.smarteval_enregistrer(jsonb_build_object('titre', 'Sans chrono', 'competence', 'C', 'matiere_id', :'math_a', 'classes', jsonb_build_array(:'classe_a'),
  'questions', '[{"id":"q1","type":"courte","intitule":"Q","acceptees":["a"],"points":1}]'::jsonb)) ->> 'id' as sc \gset
select public.smarteval_publier(:'sc'::uuid, 1, 'heures', '{}'::jsonb) ->> 'jeton' as jsc \gset
select set_config('app.jsc', :'jsc', false) \g /dev/null
reset role; set role anon;
select pg_temp.verifier(public.smarteval_formulaire(:'jsc') ? 'questions' and (public.smarteval_formulaire(:'jsc') ->> 'chrono_secondes') is null
  and (public.smarteval_soumettre(:'jsc', jsonb_build_object('nom', 'Libre', 'prenom', 'Jo', 'classe_id', :'classe_a', 'reponses', '{"q1": "a"}'::jsonb)) ->> 'numero') = '1',
  'non-régression : sans durée, questions visibles et soumission directe inchangées');
do $$ begin perform public.smarteval_demarrer(current_setting('app.jsc'), jsonb_build_object('nom', 'Libre', 'prenom', 'Max', 'classe_id', current_setting('app.classe_a')));
  raise exception 'ÉCHEC : démarrage d''une évaluation non chronométrée';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : non-régression : pas de tentative pour une évaluation sans durée'; end $$;
reset role;
