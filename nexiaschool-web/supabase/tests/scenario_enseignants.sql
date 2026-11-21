-- SmartEval indépendant : comptes enseignants (tout fournisseur d'e-mail), Découverte (1 évaluation, 2 soumissions),
-- abonnement (crédits), packs, renouvellement, groupe de département (matière imposée, membres par code), lien public,
-- anonymisation, connexion IA personnelle (MCP), isolation des données.
reset role;
insert into auth.users (id, email, email_confirmed_at) values
  ('e1e1e1e1-0000-4000-8000-000000000001', 'awa.prof@gmail.com', now()),
  ('e1e1e1e1-0000-4000-8000-000000000002', 'jean.prof@yahoo.fr', now()),
  ('e1e1e1e1-0000-4000-8000-000000000003', 'marie.prof@outlook.com', now()),
  ('e1e1e1e1-0000-4000-8000-000000000004', 'paul.mbarga@lycee-bilingue.cm', now()),
  ('e1e1e1e1-0000-4000-8000-000000000005', 'non.confirme@hotmail.com', null),
  ('e1e1e1e1-0000-4000-8000-000000000006', 'a.w.a.prof+second@gmail.com', now());
\set ens1 e1e1e1e1-0000-4000-8000-000000000001
\set ens2 e1e1e1e1-0000-4000-8000-000000000002
\set ens3 e1e1e1e1-0000-4000-8000-000000000003
\set ens4 e1e1e1e1-0000-4000-8000-000000000004
\set ens5 e1e1e1e1-0000-4000-8000-000000000005
\set ens6 e1e1e1e1-0000-4000-8000-000000000006
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null

-- A. Inscription : Gmail, Yahoo, Outlook, adresse professionnelle ; vérification de l'adresse ; aucun établissement
select set_config('request.jwt.claim.sub', :'ens1', false) \g /dev/null
select pg_temp.verifier(public.enseignant_inscription('Ndiaye', 'Awa') -> 'offre' ->> 'offre' = 'decouverte', 'inscription : adresse Gmail, offre Découverte');
select set_config('request.jwt.claim.sub', :'ens2', false) \g /dev/null
select public.enseignant_inscription('Ekwalla', 'Jean') \g /dev/null
select set_config('request.jwt.claim.sub', :'ens3', false) \g /dev/null
select public.enseignant_inscription('Fouda', 'Marie') \g /dev/null
select set_config('request.jwt.claim.sub', :'ens4', false) \g /dev/null
select public.enseignant_inscription('Mbarga', 'Paul') \g /dev/null
reset role;
select pg_temp.verifier((select count(*) from public.comptes_enseignants where id in (:'ens1', :'ens2', :'ens3', :'ens4')) = 4
  and not exists (select 1 from public.personnels where id in (:'ens1', :'ens2', :'ens3', :'ens4'))
  and (select count(*) from public.etablissements) = (select count(*) from public.etablissements),
  'inscription : Gmail, Yahoo, Outlook et adresse professionnelle acceptées, sans établissement ni fiche de personnel');
set role authenticated;
select set_config('request.jwt.claim.sub', :'ens5', false) \g /dev/null
do $$ begin perform public.enseignant_inscription('Non', 'Confirmé'); raise exception 'ÉCHEC : adresse non vérifiée';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : inscription : adresse non vérifiée refusée'; end $$;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
do $$ begin perform public.enseignant_inscription('Admin', 'Établissement'); raise exception 'ÉCHEC : compte d''établissement';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : inscription : un compte d''établissement n''est pas converti'; end $$;
-- même adresse (variante Gmail) : compte possible, mais plus d'offre gratuite
select set_config('request.jwt.claim.sub', :'ens6', false) \g /dev/null
select (public.enseignant_inscription('Ndiaye', 'Awa') ->> 'offre_gratuite_refusee') as refus6 \gset
select pg_temp.verifier(:'refus6'::boolean and public.enseignant_contexte() -> 'offre' ->> 'offre' = 'aucune', 'essai gratuit : la même adresse Gmail (points, +étiquette) n''a pas de seconde Découverte');
-- un indépendant n'accède à rien d'un établissement
select set_config('request.jwt.claim.sub', :'ens1', false) \g /dev/null
select pg_temp.verifier(public.etab_courant() is null and (select count(*) from public.eleves) = 0 and (select count(*) from public.inscriptions) = 0
  and (select count(*) from public.paiements_abonnement) = 0, 'isolation : un enseignant indépendant ne voit aucune donnée d''établissement');
do $$ begin perform 1 from public.evaluations; raise exception 'ÉCHEC : évaluations d''établissement lisibles';
exception when insufficient_privilege then raise notice 'ok : isolation : évaluations des établissements inaccessibles'; end $$;
do $$ begin perform public.smarteval_liste(); perform public.etat_abonnement(); raise exception 'ÉCHEC : espace établissement';
exception when insufficient_privilege then raise notice 'ok : isolation : espace d''établissement refusé à un indépendant'; end $$;

-- D. Évaluation sans classe ni liste d'élèves : classe en texte libre
select (public.se_enregistrer(jsonb_build_object('titre', 'Fractions', 'competence', 'Additionner des fractions', 'matiere', 'Mathématiques',
  'classe', '6e', 'groupes', '["A", "B"]'::jsonb,
  'questions', '[{"id":"q1","type":"choix","intitule":"1/2 + 1/4 = ?","options":["3/4","2/6"],"bonnes":[0],"points":2,"obligatoire":true,"notion":"Fractions"},
                 {"id":"q2","type":"paragraphe","intitule":"Expliquez","points":2}]'::jsonb)) ->> 'id') as se1 \gset
select set_config('app.se1', :'se1', false) \g /dev/null
select pg_temp.verifier(public.se_detail(:'se1') ->> 'statut' = 'brouillon' and public.se_detail(:'se1') ->> 'classe' = '6e'
  and jsonb_array_length(public.se_detail(:'se1') -> 'classes') = 2 and (public.enseignant_contexte() -> 'offre' ->> 'credits_utilises')::int = 0,
  'SmartEval : brouillon « 6e » (groupes A et B) créé sans classe ni liste d''élèves, aucun crédit consommé');
select (public.se_enregistrer(jsonb_build_object('titre', 'Bac blanc', 'competence', 'Rédiger', 'classe', 'Terminale D',
  'questions', '[{"id":"q1","type":"courte","intitule":"Capitale","acceptees":["Yaoundé"],"points":1}]'::jsonb)) ->> 'id') as se_brouillon \gset
select pg_temp.verifier(public.se_detail(:'se_brouillon') ->> 'classe' = 'Terminale D', 'SmartEval : classe « Terminale D » saisie librement');
select set_config('app.se_brouillon', :'se_brouillon', false) \g /dev/null

-- B. Offre Découverte : une publication, deux soumissions
select public.se_publier(:'se1', 2, 'jours', '{}') ->> 'jeton' as jeton1 \gset
select set_config('app.jeton1', :'jeton1', false) \g /dev/null
select pg_temp.verifier((public.enseignant_contexte() -> 'offre' ->> 'credits_restants')::int = 0, 'Découverte : la publication consomme l''unique crédit');
do $$ begin perform public.se_publier(current_setting('app.se1')::uuid, 3, 'jours', '{}');
exception when others then raise exception 'ÉCHEC : changer la durée ne doit rien coûter : %', sqlerrm; end $$;
select pg_temp.verifier((public.enseignant_contexte() -> 'offre' ->> 'credits_utilises')::int = 1, 'Découverte : changer la durée ne consomme pas de crédit');
do $$ begin perform public.se_publier(current_setting('app.se_brouillon')::uuid, 2, 'jours', '{}');
  raise exception 'ÉCHEC : deuxième publication en Découverte';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' or sqlerrm not like '%offre Découverte%' then raise; end if;
  raise notice 'ok : Découverte : deuxième évaluation publiée refusée — %', sqlerrm; end $$;
set role anon;
select pg_temp.verifier(public.smarteval_formulaire(:'jeton1') ->> 'titre' = 'Fractions' and not (public.smarteval_formulaire(:'jeton1') -> 'questions' -> 0 ? 'bonnes'),
  'lien public : formulaire de l''évaluation indépendante, sans corrigé');
select public.smarteval_soumettre(:'jeton1', jsonb_build_object('nom', 'Abena', 'prenom', 'Grace', 'classe_id', '6e A', 'reponses', '{"q1": 0, "q2": "Car…"}'::jsonb)) \g /dev/null
do $$ begin perform public.smarteval_soumettre(current_setting('app.jeton1'), jsonb_build_object('nom', 'ABENA', 'prenom', 'grâce', 'classe_id', '6e A', 'reponses', '{"q1": 0}'::jsonb));
  raise exception 'ÉCHEC : doublon';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : soumissions : doublon refusé'; end $$;
do $$ begin perform public.smarteval_soumettre(current_setting('app.jeton1'), jsonb_build_object('nom', 'Bello', 'prenom', 'Ali', 'classe_id', '6e C', 'reponses', '{"q1": 0}'::jsonb));
  raise exception 'ÉCHEC : classe inconnue';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : soumissions : classe hors évaluation refusée'; end $$;
select public.smarteval_soumettre(:'jeton1', jsonb_build_object('nom', 'Bello', 'prenom', 'Ali', 'classe_id', '6e B', 'reponses', '{"q1": 1}'::jsonb)) \g /dev/null
do $$ begin perform public.smarteval_soumettre(current_setting('app.jeton1'), jsonb_build_object('nom', 'Chia', 'prenom', 'Rose', 'classe_id', '6e A', 'reponses', '{"q1": 0}'::jsonb));
  raise exception 'ÉCHEC : troisième soumission en Découverte';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' or sqlerrm not like '%offre Découverte%' then raise; end if;
  raise notice 'ok : Découverte : troisième élève refusé — %', sqlerrm; end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'ens1', false) \g /dev/null
select pg_temp.verifier(jsonb_array_length(public.se_detail(:'se1') -> 'soumissions') = 2 and (public.se_detail(:'se1') ->> 'soumissions_max')::int = 2
  and (public.se_detail(:'se1') -> 'soumissions' -> 0 ->> 'note20')::numeric = 20,
  'Découverte : deux soumissions reçues et corrigées dans l''espace de l''enseignant');
do $$ begin perform public.se_enregistrer(jsonb_build_object('id', current_setting('app.se1'), 'titre', 'X', 'competence', 'C', 'classe', '6e', 'questions', '[]'::jsonb));
  raise exception 'ÉCHEC : modification après réponses';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : SmartEval : plus de modification après les premières réponses'; end $$;
-- suppression : aucun crédit rendu ; contournement par l'API ou une nouvelle évaluation impossible
select public.se_supprimer(:'se1') \g /dev/null
select pg_temp.verifier((public.enseignant_contexte() -> 'offre' ->> 'credits_restants')::int = 0,
  'Découverte : supprimer l''évaluation ne rend pas le crédit');
select (public.se_enregistrer(jsonb_build_object('titre', 'Nouvelle', 'competence', 'C', 'classe', '5e',
  'questions', '[{"id":"q1","type":"courte","intitule":"Q"}]'::jsonb)) ->> 'id') as se_nouv \gset
select set_config('app.se_nouv', :'se_nouv', false) \g /dev/null
do $$ begin perform public.se_publier(current_setting('app.se_nouv')::uuid, 2, 'jours', '{}'); raise exception 'ÉCHEC : contournement';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : Découverte : nouvelle évaluation après suppression refusée'; end $$;
do $$ begin insert into public.se_evaluations (compte_id, titre, competence, classe, questions, jeton, publiee_le, ferme_le)
  values (auth.uid(), 'Pirate', 'C', '6e', '[]', 'abcdefghijklmnopqrstuvwx', now(), now() + interval '1 day'); raise exception 'ÉCHEC : écriture directe';
exception when insufficient_privilege then raise notice 'ok : Découverte : écriture directe en base refusée (seules les fonctions publient)'; end $$;
do $$ begin update public.se_consommations set offre = 'enseignant'; raise exception 'ÉCHEC : crédits modifiés';
exception when insufficient_privilege then raise notice 'ok : crédits : aucune modification directe possible'; end $$;

-- C. Offre payante : 10 crédits après paiement vérifié
select (public.paiement_preparer_produit('{"produit": "se_abonnement", "montant": 1}') ->> 'id') as pai_se \gset
select pg_temp.verifier((select montant from public.paiements_abonnement where id = :'pai_se') = 5000
  and public.enseignant_contexte() -> 'offre' ->> 'offre' = 'decouverte', 'abonnement : 5 000 FCFA calculés en base, rien n''est activé avant paiement');
do $$ begin perform public.paiement_preparer_produit('{"produit": "se_credits"}'); raise exception 'ÉCHEC : pack sans abonnement';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : packs : réservés aux abonnés'; end $$;
reset role;
select public._paiement_valider(:'pai_se', 'tx-se', 5000) \g /dev/null
select pg_temp.verifier((public._paiement_valider(:'pai_se', 'tx-se', 5000) ->> 'deja')::boolean
  and (select count(*) from public.se_periodes where compte_id = :'ens1') = 1, 'abonnement : notification répétée sans double activation');
set role authenticated;
select set_config('request.jwt.claim.sub', :'ens1', false) \g /dev/null
select pg_temp.verifier(public.enseignant_contexte() -> 'offre' ->> 'offre' = 'enseignant'
  and (public.enseignant_contexte() -> 'offre' ->> 'credits_total')::int = 10 and (public.enseignant_contexte() -> 'offre' ->> 'credits_restants')::int = 10
  and (public.enseignant_contexte() -> 'offre' ->> 'fin')::timestamptz between now() + interval '12 months' - interval '1 minute' and now() + interval '12 months',
  'abonnement : 10 crédits pour 12 mois à compter du paiement');
select public.se_publier(:'se_nouv', 2, 'jours', '{}') \g /dev/null
select public.se_publier(:'se_nouv', 5, 'jours', '{}') \g /dev/null
select pg_temp.verifier((public.enseignant_contexte() -> 'offre' ->> 'credits_utilises')::int = 1, 'abonnement : republier (durée) ne consomme pas de nouveau crédit');
select (public.se_dupliquer(:'se_nouv') ->> 'id') as se_copie \gset
select pg_temp.verifier((public.enseignant_contexte() -> 'offre' ->> 'credits_utilises')::int = 1, 'abonnement : un brouillon dupliqué ne consomme rien');
select public.se_publier(:'se_copie', 2, 'jours', '{}') \g /dev/null
select pg_temp.verifier((public.enseignant_contexte() -> 'offre' ->> 'credits_utilises')::int = 2, 'abonnement : publier la copie consomme un nouveau crédit');
-- huit autres publications, puis la onzième est refusée
select public.se_publier((public.se_enregistrer(jsonb_build_object('titre', 'E' || g, 'competence', 'C', 'classe', '4e',
  'questions', '[{"id":"q1","type":"courte","intitule":"Q"}]'::jsonb)) ->> 'id')::uuid, 1, 'jours', '{}') from generate_series(1, 8) g \g /dev/null
select pg_temp.verifier((public.enseignant_contexte() -> 'offre' ->> 'credits_restants')::int = 0, 'abonnement : 10 évaluations publiées');
select (public.se_enregistrer(jsonb_build_object('titre', 'Onzième', 'competence', 'C', 'classe', '3e',
  'questions', '[{"id":"q1","type":"courte","intitule":"Q"}]'::jsonb)) ->> 'id') as se_11 \gset
select set_config('app.se_11', :'se_11', false) \g /dev/null
do $$ begin perform public.se_publier(current_setting('app.se_11')::uuid, 1, 'jours', '{}'); raise exception 'ÉCHEC : onzième publication';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' or sqlerrm not like '%crédits%' then raise; end if; raise notice 'ok : abonnement : onzième publication refusée — %', sqlerrm; end $$;
-- pack de 5 crédits : ajouté seulement après paiement vérifié
select (public.paiement_preparer_produit('{"produit": "se_credits"}') ->> 'id') as pai_pack \gset
select pg_temp.verifier((select montant = 2000 and quantite = 5 from public.paiements_abonnement where id = :'pai_pack')
  and (public.enseignant_contexte() -> 'offre' ->> 'credits_restants')::int = 0, 'packs : 5 crédits pour 2 000 FCFA, rien avant paiement');
reset role;
select public._paiement_echec(:'pai_pack', 'annule') \g /dev/null
set role authenticated;
select set_config('request.jwt.claim.sub', :'ens1', false) \g /dev/null
select pg_temp.verifier((public.enseignant_contexte() -> 'offre' ->> 'credits_restants')::int = 0, 'packs : paiement annulé, aucun crédit');
select (public.paiement_preparer_produit('{"produit": "se_credits"}') ->> 'id') as pai_pack2 \gset
reset role;
select public._paiement_valider(:'pai_pack2', 'tx-pack', 2000) \g /dev/null
set role authenticated;
select set_config('request.jwt.claim.sub', :'ens1', false) \g /dev/null
select public.se_publier(:'se_11', 1, 'jours', '{}') \g /dev/null
select pg_temp.verifier((public.enseignant_contexte() -> 'offre' ->> 'credits_total')::int = 15 and (public.enseignant_contexte() -> 'offre' ->> 'credits_restants')::int = 4,
  'packs : crédits ajoutés après paiement vérifié (15 au total), onzième évaluation publiée');
-- soumissions : limite payante (150)
select pg_temp.verifier((public.se_detail(:'se_11') ->> 'soumissions_max')::int = 150, 'abonnement : jusqu''à 150 soumissions par évaluation');
-- renouvellement : impossible longtemps avant l'échéance ; nouvelle période = crédits remis à 10 (non reportés)
do $$ begin perform public.paiement_preparer_produit('{"produit": "se_abonnement"}'); raise exception 'ÉCHEC : renouvellement prématuré';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : renouvellement : possible seulement à l''approche de l''échéance'; end $$;
reset role;
update public.se_periodes set fin = now() + interval '5 days' where compte_id = :'ens1';
set role authenticated;
select set_config('request.jwt.claim.sub', :'ens1', false) \g /dev/null
select (public.paiement_preparer_produit('{"produit": "se_abonnement"}') ->> 'id') as pai_ren \gset
reset role;
select public._paiement_valider(:'pai_ren', 'tx-ren', 5000) \g /dev/null
update public.se_periodes set debut = debut - interval '6 days', fin = fin - interval '6 days' where compte_id = :'ens1';
set role authenticated;
select set_config('request.jwt.claim.sub', :'ens1', false) \g /dev/null
select pg_temp.verifier((public.enseignant_contexte() -> 'offre' ->> 'credits_total')::int = 10 and (public.enseignant_contexte() -> 'offre' ->> 'credits_restants')::int = 10,
  'renouvellement : nouvelle période, 10 crédits (les crédits non utilisés ne sont pas reportés)');

-- E. Anonymisation et connexion IA personnelle (MCP)
set role anon;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'ens1', false) \g /dev/null
select public.se_anonymiser(:'se_11', true) \g /dev/null
select public.se_detail(:'se_11') ->> 'jeton' as jeton11 \gset
set role anon;
select set_config('app.jeton11', :'jeton11', false) \g /dev/null
do $$ begin perform public.smarteval_soumettre(current_setting('app.jeton11'), jsonb_build_object('nom', 'Ewane', 'prenom', 'Luc', 'classe_id', '3e', 'reponses', '{}'::jsonb));
  raise exception 'ÉCHEC : matricule absent';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : anonymisation : le matricule est demandé à l''élève'; end $$;
select public.smarteval_soumettre(:'jeton11', jsonb_build_object('nom', 'Ewane', 'prenom', 'Luc', 'classe_id', '3e', 'matricule', 'mat-007', 'reponses', '{}'::jsonb)) \g /dev/null
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'ens1', false) \g /dev/null
select public.enseignant_ia_creer_cle('Claude') ->> 'cle' as cle_e \gset
select set_config('app.cle_e', :'cle_e', false) \g /dev/null
set role anon;
select pg_temp.verifier(jsonb_array_length(public.api_enseignant(:'cle_e', 'smarteval_lister', '{}')) = 12, 'MCP : l''assistant liste les évaluations de l''enseignant (sans établissement)');
select pg_temp.verifier((select bool_and(s ->> 'nom' = 'MAT-007' and s ->> 'prenom' = '')
    from jsonb_array_elements(public.api_enseignant(:'cle_e', 'smarteval_resultats', jsonb_build_object('evaluation', :'se_11')) -> 'soumissions') s)
  and (public.api_enseignant(:'cle_e', 'smarteval_resultats', jsonb_build_object('evaluation', :'se_11')) ->> 'anonymisee')::boolean,
  'anonymisation : l''IA ne voit l''élève que par son matricule');
select pg_temp.verifier(not (public.api_enseignant(:'cle_e', 'smarteval_resultats', jsonb_build_object('evaluation', :'se_11')) ? 'jeton'),
  'MCP : ni lien ni en-tête transmis à l''IA');
reset role;
-- isolation : l'enseignant 2 ne voit ni ne lit les évaluations de l'enseignant 1 (ni par l'application ni par l'IA)
set role authenticated;
select set_config('request.jwt.claim.sub', :'ens2', false) \g /dev/null
select pg_temp.verifier(jsonb_array_length(public.se_liste()) = 0, 'isolation : la liste d''un autre enseignant est vide');
select set_config('app.se_11', :'se_11', false) \g /dev/null
do $$ begin perform public.se_detail(current_setting('app.se_11')::uuid); raise exception 'ÉCHEC : détail d''un autre enseignant';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : isolation : évaluation d''un autre enseignant introuvable'; end $$;
do $$ begin perform public.se_supprimer(current_setting('app.se_11')::uuid); raise exception 'ÉCHEC : suppression d''un autre enseignant';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : isolation : suppression refusée'; end $$;
do $$ begin perform 1 from public.se_soumissions; raise exception 'ÉCHEC : soumissions lisibles';
exception when insufficient_privilege then raise notice 'ok : isolation : aucune lecture directe des soumissions'; end $$;
select public.enseignant_ia_creer_cle('Grok') ->> 'cle' as cle_e2 \gset
set role anon;
select pg_temp.verifier(public.api_enseignant(:'cle_e2', 'smarteval_resultats', jsonb_build_object('evaluation', :'se_11')) ? 'erreur',
  'isolation : l''IA d''un autre enseignant n''obtient pas ces résultats');
do $$ begin perform public.api_enseignant('nxe_' || repeat('0', 48), 'smarteval_lister', '{}'); raise exception 'ÉCHEC : clé inventée';
exception when sqlstate '28000' then raise notice 'ok : MCP : clé inventée refusée'; end $$;
reset role;
-- révocation
set role authenticated;
select set_config('request.jwt.claim.sub', :'ens1', false) \g /dev/null
select public.enseignant_ia_revoquer((public.enseignant_ia() -> 'acces' -> 0 ->> 'id')::uuid) \g /dev/null
set role anon;
do $$ begin perform public.api_enseignant(current_setting('app.cle_e'), 'smarteval_lister', '{}'); raise exception 'ÉCHEC : clé révoquée';
exception when sqlstate '28000' then raise notice 'ok : MCP : clé révoquée refusée'; end $$;
reset role;
select pg_temp.verifier((select count(*) from public.acces_ia_enseignants where acces_hash like 'nxe_%') = 0
  and not exists (select 1 from public.journal_api_enseignants where outil like 'nxe_%'), 'secrets : seules les empreintes des clés sont conservées');

-- OAuth personnel (connecteur) : code, échange, rafraîchissement, réutilisation détectée
reset role;
insert into public.oauth_clients (id, nom, redirect_uris) values ('client-enseignant', 'Claude', array['https://claude.ai/api/mcp/auth_callback']) on conflict do nothing;
select public._b64url_sha256('verificateur-de-test-assez-long-pour-pkce-0123456789') as defi_e \gset
set role authenticated;
select set_config('request.jwt.claim.sub', :'ens3', false) \g /dev/null
select public.oauth_autoriser_enseignant('client-enseignant', 'https://claude.ai/api/mcp/auth_callback', :'defi_e', 'S256') ->> 'code' as code_e \gset
set role anon;
select public.oauth_echanger_code(:'code_e', 'verificateur-de-test-assez-long-pour-pkce-0123456789', 'client-enseignant', 'https://claude.ai/api/mcp/auth_callback') as jet_e \gset
select pg_temp.verifier((:'jet_e'::json ->> 'access_token') like 'nxe_%' and (:'jet_e'::json ->> 'refresh_token') like 'nxf_%'
  and jsonb_typeof(public.api_enseignant(:'jet_e'::json ->> 'access_token', 'smarteval_lister', '{}')) = 'array', 'OAuth : jetons personnels émis, outils utilisables');
select public.oauth_rafraichir(:'jet_e'::json ->> 'refresh_token', 'client-enseignant') as jet_e2 \gset
select pg_temp.verifier((public.oauth_rafraichir(:'jet_e'::json ->> 'refresh_token', 'client-enseignant') ->> 'error') = 'invalid_grant',
  'OAuth : ancien jeton de rafraîchissement refusé');
select pg_temp.verifier((public.oauth_rafraichir(:'jet_e2'::json ->> 'refresh_token', 'client-enseignant') ->> 'error') = 'invalid_grant',
  'OAuth : réutilisation détectée, toute la lignée est révoquée');
reset role;

-- Groupe de département : 15 000 FCFA/an, matière imposée, code de groupe, membres créés par l'administrateur
set role authenticated;
select set_config('request.jwt.claim.sub', :'ens4', false) \g /dev/null
do $$ begin perform public.paiement_preparer_produit('{"produit": "se_groupe"}'); raise exception 'ÉCHEC : groupe sans matière';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : groupe : la matière du département est demandée'; end $$;
select (public.paiement_preparer_produit('{"produit": "se_groupe", "matiere": "Physique-Chimie", "nom": "Département PC"}') ->> 'id') as pai_g \gset
select pg_temp.verifier((select montant from public.paiements_abonnement where id = :'pai_g') = 15000, 'groupe : 15 000 FCFA par an');
reset role;
select public._paiement_valider(:'pai_g', 'tx-g', 15000) \g /dev/null
set role authenticated;
select set_config('request.jwt.claim.sub', :'ens4', false) \g /dev/null
select pg_temp.verifier(public.enseignant_contexte() -> 'groupe' ->> 'matiere' = 'Physique-Chimie' and public.enseignant_contexte() -> 'offre' ->> 'offre' = 'groupe'
  and public.enseignant_contexte() -> 'compte' ->> 'role_groupe' = 'admin', 'groupe : actif après paiement, l''acheteur administre le groupe');
select public.groupe_generer_code() ->> 'code' as code_g \gset
select public.groupe_creer_membre('Tchoua', 'Line') as membre \gset
select (:'membre'::jsonb ->> 'id') as membre_id, (:'membre'::jsonb ->> 'code') as membre_code \gset
set role anon;
select pg_temp.verifier((public.groupe_ouvrir(:'code_g') -> 'membres' -> 0 ->> 'nom') like 'TCHOUA%' and public.groupe_ouvrir('ABCDEF-faux1234') ? 'erreur',
  'groupe : le code du groupe ouvre la liste des membres ; un faux code est refusé');
select pg_temp.verifier(public.groupe_connexion(:'code_g', :'membre_id', 'mauvais') ? 'erreur' and (public.groupe_connexion(:'code_g', :'membre_id', :'membre_code') ->> 'email') like 'g-%@groupe.nexiaschool.invalid',
  'groupe : le membre se connecte avec le code du groupe et son code personnel');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'membre_id', false) \g /dev/null
do $$ begin perform public.se_enregistrer(jsonb_build_object('titre', 'Triche', 'competence', 'C', 'matiere', 'Histoire', 'classe', '2nde',
  'questions', '[{"id":"q1","type":"courte","intitule":"Q"}]'::jsonb)); raise exception 'ÉCHEC : autre matière';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' or sqlerrm not like '%Physique-Chimie%' then raise; end if;
  raise notice 'ok : groupe : évaluation d''une autre matière refusée — %', sqlerrm; end $$;
select (public.se_enregistrer(jsonb_build_object('titre', 'Électricité', 'competence', 'Loi d''Ohm', 'classe', '2nde C',
  'questions', '[{"id":"q1","type":"courte","intitule":"U = ?","acceptees":["RI"],"points":1}]'::jsonb)) ->> 'id') as se_g \gset
select public.se_publier(:'se_g', 2, 'jours', '{}') \g /dev/null
select pg_temp.verifier(public.se_detail(:'se_g') ->> 'matiere' = 'Physique-Chimie' and (public.enseignant_contexte() -> 'offre' ->> 'credits_restants')::int = 9,
  'groupe : matière imposée, crédits propres à chaque membre (10 par an)');
do $$ begin perform public.paiement_preparer_produit('{"produit": "se_abonnement"}'); raise exception 'ÉCHEC : membre qui paie';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : groupe : un membre est couvert par le groupe'; end $$;
do $$ begin perform public.groupe_creer_membre('Intrus', 'X'); raise exception 'ÉCHEC : membre qui crée des comptes';
exception when insufficient_privilege then raise notice 'ok : groupe : seul l''administrateur crée les comptes'; end $$;
reset role;

-- Enveloppe de crédits commune au groupe : remplacer des membres ne crée pas de crédits.
-- 2 membres max → 20 crédits pour tout le groupe ; 16 déjà utilisés (membres remplacés) → il n'en reste que 4, même à l'administrateur
update public.groupes_enseignants set membres_max = 2 where admin_id = :'ens4';
insert into public.se_consommations (compte_id, periode_id, offre)
select :'membre_id', p.id, 'groupe' from public.se_periodes p join public.groupes_enseignants g on g.id = p.groupe_id and g.admin_id = :'ens4', generate_series(1, 15);
set role authenticated;
select set_config('request.jwt.claim.sub', :'ens4', false) \g /dev/null
select pg_temp.verifier((public.enseignant_contexte() -> 'offre' ->> 'credits_restants')::int = 4,
  'groupe : enveloppe commune (remplacer des membres ne crée pas de nouveaux crédits)');
reset role;
delete from public.se_consommations where compte_id = :'membre_id' and evaluation_id is null;
update public.groupes_enseignants set membres_max = 20 where admin_id = :'ens4';

-- Paiement devenu incompatible entre la préparation et le paiement : signalé à traiter, jamais activé en silence
insert into public.paiements_abonnement (compte_id, offre, periode, montant, demande_par, produit, quantite, details)
values (:'ens4', 'smarteval', 'annuel', 5000, :'ens4', 'se_abonnement', 10, '{"libelle": "test"}') returning id as pai_incoherent \gset
select (public._paiement_valider(:'pai_incoherent', 'tx-inc', 5000) ->> 'a_traiter') as a_traiter_inc \gset
select pg_temp.verifier(:'a_traiter_inc'::boolean
  and not exists (select 1 from public.se_periodes where compte_id = :'ens4')
  and exists (select 1 from public.abonnements_historique where paiement_id = :'pai_incoherent' and details ? 'a_traiter'),
  'paiement : abonnement individuel payé par un administrateur de groupe signalé à traiter');

-- Code du groupe : blocage après 5 échecs aussi à la connexion ; même réponse pour un code faux et pour un membre inconnu
set role anon;
select pg_temp.verifier(public.groupe_connexion(split_part(:'code_g', '-', 1) || '-ZZZZZZZZ', :'membre_id', 'x') ->> 'erreur'
  = public.groupe_connexion(:'code_g', gen_random_uuid(), 'x') ->> 'erreur', 'groupe : réponse identique (code faux ou membre inconnu)');
select public.groupe_connexion(split_part(:'code_g', '-', 1) || '-ZZZZZZZZ', :'membre_id', 'x') from generate_series(1, 4) \g /dev/null
select pg_temp.verifier(public.groupe_connexion(:'code_g', :'membre_id', :'membre_code') ->> 'erreur' like 'Trop d''essais%',
  'groupe : connexion bloquée 15 minutes après 5 essais erronés, même avec le bon code');
reset role;
update public.groupes_enseignants set echecs = 0, bloque_jusqu_a = null where admin_id = :'ens4';

-- Membre désactivé : plus aucun accès à ses évaluations ni aux copies
set role authenticated;
select set_config('request.jwt.claim.sub', :'ens4', false) \g /dev/null
select public.groupe_activer_membre(:'membre_id', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'membre_id', false) \g /dev/null
select pg_temp.verifier(public.se_liste() = '[]'::jsonb, 'groupe : un membre désactivé ne voit plus ses évaluations');
select set_config('nexia.test_se_g', :'se_g', false) \g /dev/null
do $$ begin perform public.se_detail(current_setting('nexia.test_se_g')::uuid); raise exception 'ÉCHEC : membre désactivé qui lit les copies';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : groupe : un membre désactivé ne lit plus les copies'; end $$;
reset role;

-- Établissements : anonymisation de l'IA aussi pour leurs évaluations
select pg_temp.verifier(public._smarteval_anonymes('[{"numero": 3, "nom": "ABENA", "prenom": "Grace", "matricule": null}, {"numero": 4, "nom": "X", "prenom": "Y", "matricule": "M1"}]')
  = '[{"numero": 3, "nom": "Élève n° 3", "prenom": "", "matricule": null}, {"numero": 4, "nom": "M1", "prenom": "", "matricule": "M1"}]'::jsonb,
  'anonymisation : matricule, ou numéro de copie à défaut');

-- Offre gratuite SmartEval : 30 jours (établissements : 120 jours)
reset role;
select pg_temp.verifier((public.offres_publiques() #>> '{smarteval,decouverte,duree_jours}')::int = 30
  and (public.offres_publiques() #>> '{etablissement,decouverte,duree_jours}')::int = 120, 'SmartEval : offre gratuite de 30 jours');
