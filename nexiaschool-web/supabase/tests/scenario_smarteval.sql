-- SmartEval : évaluations digitalisées, lien public, correction automatique, notifications, accès de l'IA
reset role;
update public.eleves set prenom = 'Grâce' where id = :'eleve_a';
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null

-- préalable : une IA connectée au compte
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select public.smarteval_contexte() as ctx \gset
select set_config('app.ctx', :'ctx', false) \g /dev/null
select pg_temp.verifier((current_setting('app.ctx')::jsonb ->> 'ia_connectee')::boolean = false
  and (current_setting('app.ctx')::jsonb #>> '{sequence,numero}') = '2'
  and (current_setting('app.ctx')::jsonb #>> '{matieres,0,libelle}') = 'Mathématiques',
  'contexte : séquence en cours (1re non verrouillée), matière confiée pré-remplie, IA pas encore connectée');
select set_config('app.math_a', :'math_a', false), set_config('app.classe_a', :'classe_a', false) \g /dev/null
select public.smarteval_enregistrer(jsonb_build_object('titre', 'Sans IA', 'competence', 'C', 'matiere_id', :'math_a',
    'classes', jsonb_build_array(:'classe_a'), 'questions', '[{"type":"courte","intitule":"Q"}]'::jsonb)) ->> 'id' as ev_sans_ia \gset
select pg_temp.verifier(:'ev_sans_ia' <> '', 'sans IA connectée, l''enseignant crée quand même une évaluation (SmartEval indépendant de l''IA)');
select public.smarteval_supprimer(:'ev_sans_ia'::uuid) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select pg_temp.verifier((public.smarteval_contexte() ->> 'libre')::boolean and jsonb_array_length(public.smarteval_contexte() -> 'matieres') >= 1,
  'administration : choix parmi toutes les classes et matières du programme');
select public.smarteval_enregistrer(jsonb_build_object('titre', 'Par la direction', 'competence', 'C', 'matiere_id', :'math_a',
    'classes', jsonb_build_array(:'classe_a'), 'questions', '[{"type":"courte","intitule":"Q"}]'::jsonb)) ->> 'id' as ev_dir \gset
select pg_temp.verifier(:'ev_dir' <> '', 'l''administration crée aussi une évaluation digitalisée, sur son espace');
select public.smarteval_supprimer(:'ev_dir'::uuid) \g /dev/null
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select public.definir_ia_personnelle(true) \g /dev/null
select public.creer_cle_api('Claude SmartEval', false, 30)->>'cle' as cle_se \gset
select pg_temp.verifier((public.smarteval_contexte() ->> 'ia_connectee')::boolean, 'IA connectée (clé API active)');

-- création : questions de tous les types, avec corrigé et notions
select public.smarteval_enregistrer(jsonb_build_object('titre', 'Fractions et proportionnalité', 'consignes', 'Répondez seul.',
  'competence', 'Résoudre des problèmes de proportionnalité', 'matiere_id', :'math_a', 'classes', jsonb_build_array(:'classe_a'),
  'questions', '[
    {"id":"q1","type":"choix","intitule":"1/2 + 1/4 = ?","options":["3/4","2/6","1/8"],"bonnes":[0],"points":2,"obligatoire":true,"notion":"Addition de fractions"},
    {"id":"q2","type":"cases","intitule":"Nombres pairs","options":["2","3","4","5"],"bonnes":[0,2],"points":2,"notion":"Parité"},
    {"id":"q3","type":"courte","intitule":"Capitale du Cameroun","acceptees":["Yaoundé","Yaounde"],"points":1,"notion":"Culture"},
    {"id":"q4","type":"paragraphe","intitule":"Expliquez la règle de trois","points":3,"notion":"Proportionnalité"},
    {"id":"q5","type":"echelle","intitule":"Difficulté ressentie","echelle":{"min":1,"max":5,"libelle_min":"Facile","libelle_max":"Difficile"}},
    {"id":"q6","type":"liste","intitule":"0,5 = ?","options":["1/2","1/5"],"bonnes":[0],"points":1,"notion":"Addition de fractions"}
  ]'::jsonb)) ->> 'id' as ev \gset
select set_config('app.ev', :'ev', false) \g /dev/null
select pg_temp.verifier(jsonb_array_length(public.smarteval_detail(:'ev'::uuid) -> 'questions') = 6 and (public.smarteval_detail(:'ev'::uuid) ->> 'statut') = 'brouillon',
  'évaluation enregistrée en brouillon avec 6 questions');
do $$ begin perform public.smarteval_enregistrer(jsonb_build_object('titre', 'X', 'competence', 'C', 'matiere_id', current_setting('app.math_a'),
    'classes', jsonb_build_array(current_setting('app.classe_a')), 'questions', '[{"type":"choix","intitule":"Q","options":[]}]'::jsonb));
  raise exception 'question à choix sans option acceptée';
exception when sqlstate 'P0001' then raise notice 'ok : une question à choix sans option est refusée'; end $$;

-- un autre membre du personnel ne voit pas cette évaluation
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
do $$ begin perform public.smarteval_detail(current_setting('app.ev')::uuid); raise exception 'évaluation visible par un autre';
exception when sqlstate 'P0001' then raise notice 'ok : seul l''auteur voit son évaluation'; end $$;
do $$ begin perform 1 from public.evaluations; raise exception 'table lisible directement';
exception when insufficient_privilege then raise notice 'ok : tables SmartEval non lisibles directement'; end $$;

-- lien : pas de réponse avant publication ; publication pour 2 jours
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select public.smarteval_publier(:'ev'::uuid, 2, 'jours', '{"nom":"Collège Saint-Joseph","logo":"data:image/png;base64,AAAA"}'::jsonb) ->> 'jeton' as jeton \gset
select set_config('app.jeton', :'jeton', false) \g /dev/null
select pg_temp.verifier((public.smarteval_detail(:'ev'::uuid) ->> 'ferme_le')::timestamptz - (public.smarteval_detail(:'ev'::uuid) ->> 'publiee_le')::timestamptz = interval '2 days' and length(:'jeton') >= 20,
  'lien généré, valable 2 jours');
do $$ begin perform public.smarteval_enregistrer(jsonb_build_object('id', current_setting('app.ev'), 'titre', 'X', 'competence', 'C',
    'matiere_id', current_setting('app.math_a'), 'classes', jsonb_build_array(current_setting('app.classe_a')), 'questions', '[{"type":"courte","intitule":"Q"}]'::jsonb));
  raise exception 'évaluation publiée modifiée';
exception when sqlstate 'P0001' then raise notice 'ok : une évaluation publiée ne peut plus être modifiée'; end $$;

-- côté élève (sans compte)
reset role; set role anon;
select set_config('request.jwt.claim.sub', '', false) \g /dev/null
select public.smarteval_formulaire(:'jeton') as f \gset
select set_config('app.f', :'f', false) \g /dev/null
select pg_temp.verifier((current_setting('app.f')::jsonb ->> 'statut') = 'ouverte' and (current_setting('app.f')::jsonb #>> '{entete,nom}') = 'Collège Saint-Joseph'
  and not (current_setting('app.f') like '%bonnes%') and not (current_setting('app.f') like '%acceptees%') and not (current_setting('app.f') like '%Yaound%'),
  'formulaire public : en-tête de l''école, questions, mais aucun corrigé');
select pg_temp.verifier(public.smarteval_formulaire('inconnuinconnuinconnu12') is null, 'lien inconnu : rien');
do $$ begin perform public.smarteval_soumettre(current_setting('app.jeton'), jsonb_build_object('nom', 'Abena', 'prenom', 'Grace',
    'classe_id', current_setting('app.classe_a'), 'reponses', '{"q2":[0]}'::jsonb));
  raise exception 'question obligatoire sans réponse acceptée';
exception when sqlstate 'P0001' then raise notice 'ok : une question obligatoire sans réponse est refusée'; end $$;
select public.smarteval_soumettre(:'jeton', jsonb_build_object('nom', 'abena', 'prenom', 'Grâce', 'classe_id', :'classe_a',
  'reponses', '{"q1":0,"q2":[2,0],"q3":"  yaounde ","q4":"On multiplie en croix.","q5":4,"q6":1}'::jsonb)) as s1 \gset
select set_config('app.s1', :'s1', false) \g /dev/null
select pg_temp.verifier((current_setting('app.s1')::jsonb ->> 'numero') = '1' and (current_setting('app.s1')::jsonb ->> 'recu') ~ '^[0-9A-F]{4}-0001$',
  'envoi accepté : accusé de réception n° 1');
do $$ begin perform public.smarteval_soumettre(current_setting('app.jeton'), jsonb_build_object('nom', 'ABENA', 'prenom', 'grace',
    'classe_id', current_setting('app.classe_a'), 'reponses', '{"q1":1}'::jsonb));
  raise exception 'deuxième envoi du même élève accepté';
exception when sqlstate 'P0001' then raise notice 'ok : un élève ne peut envoyer qu''une fois'; end $$;
select public.smarteval_soumettre(:'jeton', jsonb_build_object('nom', 'Inconnu', 'prenom', 'Paul', 'classe_id', :'classe_a',
  'reponses', '{"q1":2,"q2":[0,1,2],"q3":"Douala","q6":0}'::jsonb)) \g /dev/null

-- correction automatique (côté enseignant)
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select public.smarteval_detail(:'ev'::uuid) as d \gset
select set_config('app.d', :'d', false) \g /dev/null
select pg_temp.verifier((current_setting('app.d')::jsonb #>> '{soumissions,0,points}')::numeric = 5 and (current_setting('app.d')::jsonb #>> '{soumissions,0,total}')::numeric = 6
  and (current_setting('app.d')::jsonb #>> '{soumissions,0,note20}')::numeric = 16.67 and (current_setting('app.d')::jsonb #>> '{soumissions,0,a_corriger}')::int = 1
  and (current_setting('app.d')::jsonb #>> '{soumissions,0,matricule}') = 'M1',
  'correction : choix, cases (ordre indifférent), réponse courte souple ; paragraphe à apprécier ; élève reconnu (matricule)');
select pg_temp.verifier((current_setting('app.d')::jsonb #>> '{soumissions,1,note20}')::numeric = 3.33 and (current_setting('app.d')::jsonb #>> '{soumissions,1,matricule}') is null,
  'second élève : 1/6 soit 3,33/20, non reconnu dans la classe');

-- bulle de notification : propre à l'auteur, remise à zéro après consultation
select pg_temp.verifier((public.smarteval_notifications() ->> 'non_lues')::int = 2, 'bulle de l''enseignant : 2 soumissions');
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select pg_temp.verifier((public.smarteval_notifications() ->> 'non_lues')::int = 0, 'les autres membres du personnel ne reçoivent rien');
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select public.smarteval_marquer_vu() \g /dev/null
select pg_temp.verifier((public.smarteval_notifications() ->> 'non_lues')::int = 0, 'bulle remise à zéro une fois consultée');
select pg_temp.verifier((select count(*) from jsonb_array_elements(public.smarteval_journal()) j where j ->> 'evenement' = 'soumission') = 2
  and exists (select 1 from jsonb_array_elements(public.smarteval_journal()) j where j ->> 'evenement' = 'publication'),
  'journal : création, publication et soumissions');

-- l'IA connectée au compte lit les résultats (serveur MCP)
reset role; set role anon;
select pg_temp.verifier((public.api_smarteval_resultats(:'cle_se', 'fractions') #>> '{soumissions,0,reponses,q4}') = 'On multiplie en croix.'
  and jsonb_array_length(public.api_smarteval_liste(:'cle_se')) = 1, 'IA : liste et résultats détaillés des évaluations de l''enseignant');
select set_config('app.cle_se', :'cle_se', false) \g /dev/null
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.definir_ia_personnelle(true) \g /dev/null
select public.creer_cle_api('Admin SmartEval', false, 30)->>'cle' as cle_adm \gset
select set_config('app.cle_adm', :'cle_adm', false) \g /dev/null
reset role; set role anon;
do $$ begin perform public.api_smarteval_resultats(current_setting('app.cle_adm'), current_setting('app.ev')); raise exception 'IA d''un autre compte lit l''évaluation';
exception when sqlstate 'P0001' then raise notice 'ok : l''IA d''un autre compte ne lit pas cette évaluation'; end $$;

-- lien expiré : plus de réponse
reset role;
update public.evaluations set ferme_le = now() - interval '1 minute' where id = :'ev';
set role anon;
do $$ begin perform public.smarteval_soumettre(current_setting('app.jeton'), jsonb_build_object('nom', 'Tard', 'prenom', 'Ali',
    'classe_id', current_setting('app.classe_a'), 'reponses', '{"q1":0}'::jsonb));
  raise exception 'envoi après la fin accepté';
exception when sqlstate 'P0001' then raise notice 'ok : après la durée choisie, le lien n''accepte plus de réponse'; end $$;
select pg_temp.verifier((public.smarteval_formulaire(:'jeton') ->> 'statut') = 'close', 'formulaire affiché comme clos');
reset role;
