-- Réglage fonctionnalité par fonctionnalité par le propriétaire : activation temporaire, désactivation, échéance, notifications
reset role;
select set_config('app.etab_o', :'etab_o', false) \g /dev/null
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
-- l'école des offres revient en Découverte
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.console_definir_offre(:'etab_o', 'decouverte', 'mensuel', null) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_o', false) \g /dev/null
select pg_temp.verifier(not public.offre_inclut('smarteval') and not public.offre_inclut('finances') and public.offre_inclut('notes'),
  'fonctions : Découverte sans SmartEval ni finances, avec la saisie des notes');
do $$ begin perform public.console_definir_fonctions(public.etab_courant(), '[{"fonction":"smarteval","etat":"active"}]'); raise exception 'ÉCHEC : réglage par l''établissement';
exception when insufficient_privilege then raise notice 'ok : fonctions : réglage réservé au propriétaire de la plateforme'; end $$;

-- le propriétaire offre SmartEval pour 7 jours et les finances sans échéance
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select (public.console_definir_fonctions(:'etab_o', jsonb_build_array(
  jsonb_build_object('fonction', 'smarteval', 'etat', 'active', 'fin', now() + interval '7 days'),
  jsonb_build_object('fonction', 'finances', 'etat', 'active', 'fin', null))) ->> 'notifies')::int as notifies \gset
select pg_temp.verifier(:notifies = 2, 'fonctions : deux fonctionnalités offertes, annoncées dans une seule notification');
select pg_temp.verifier((select f ->> 'effective' from jsonb_array_elements(public.console_fonctions(:'etab_o')) f where f ->> 'fonction' = 'smarteval') = 'true'
  and (select f ->> 'par_offre' from jsonb_array_elements(public.console_fonctions(:'etab_o')) f where f ->> 'fonction' = 'smarteval') = 'false',
  'fonctions : console — SmartEval actif par dérogation, hors offre');
do $$ begin perform public.console_definir_fonctions(current_setting('app.etab_o')::uuid, '[{"fonction":"edt","etat":"active","fin":"2020-01-01T00:00:00Z"}]'); raise exception 'ÉCHEC : échéance passée acceptée';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : fonctions : une échéance passée est refusée'; end $$;
do $$ begin perform public.console_definir_fonctions(current_setting('app.etab_o')::uuid, '[{"fonction":"inconnue","etat":"active"}]'); raise exception 'ÉCHEC : fonction inconnue acceptée';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : fonctions : fonctionnalité inconnue refusée'; end $$;

-- côté établissement : droits ouverts, offre inchangée, notification pour l'administration seulement
select set_config('request.jwt.claim.sub', :'admin_o', false) \g /dev/null
select pg_temp.verifier(public.offre_inclut('smarteval') and public.offre_inclut('finances') and not public.offre_inclut('edt'),
  'fonctions : SmartEval et finances ouverts, le reste de l''offre inchangé');
select pg_temp.verifier((select offre from public.etablissements where id = public.etab_courant()) = 'decouverte',
  'fonctions : l''offre souscrite reste Découverte');
select pg_temp.verifier((public.mes_fonctions() ->> 'smarteval')::boolean and jsonb_array_length(public.mes_fonctions() -> '__offertes') = 2,
  'fonctions : l''application lit les droits effectifs et les fonctionnalités offertes');
select pg_temp.verifier(jsonb_array_length(public.notifications_offre_non_lues()) = 1
  and jsonb_array_length(public.notifications_offre_non_lues() -> 0 -> 'fonctions') = 2, 'fonctions : l''administrateur reçoit la notification');
select public.notifications_offre_non_lues() -> 0 ->> 'id' as notif \gset
reset role;
select id as prof_o from public.personnels where etablissement_id = :'etab_o' and role = 'enseignant' limit 1 \gset
set role authenticated;
select set_config('request.jwt.claim.sub', :'prof_o', false) \g /dev/null
select pg_temp.verifier(jsonb_array_length(public.notifications_offre_non_lues()) = 0 and public.offre_inclut('smarteval'),
  'fonctions : un enseignant profite de SmartEval sans recevoir la notification');
select set_config('request.jwt.claim.sub', :'admin_o', false) \g /dev/null
select public.notification_offre_lue(:'notif') \g /dev/null
select pg_temp.verifier(jsonb_array_length(public.notifications_offre_non_lues()) = 0, 'fonctions : notification marquée comme lue');

-- désactivation d'une fonction de base : immédiate, sans notification
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select (public.console_definir_fonctions(:'etab_o', '[{"fonction":"notes","etat":"desactive"}]') ->> 'notifies')::int as notifies \gset
select pg_temp.verifier(:notifies = 0, 'fonctions : désactivation sans notification');
select set_config('request.jwt.claim.sub', :'admin_o', false) \g /dev/null
select pg_temp.verifier(not public.offre_inclut('notes') and jsonb_array_length(public.notifications_offre_non_lues()) = 0,
  'fonctions : saisie des notes désactivée aussitôt, aucune notification');
reset role;
do $$ begin perform public._exiger_offre(current_setting('app.etab_o')::uuid, 'notes'); raise exception 'ÉCHEC : notes encore permises';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' or sqlerrm not like '%momentanément désactivée%' then raise; end if; raise notice 'ok : fonctions : écriture refusée — %', sqlerrm; end $$;

-- plafond levé par dérogation (51 élèves en Découverte)
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_o', false) \g /dev/null
do $$ begin insert into public.eleves (matricule, nom, prenom, sexe) values ('O52', 'Élève', 'N52', 'M'); raise exception 'ÉCHEC : plafond ignoré';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : fonctions : plafond de Découverte appliqué'; end $$;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.console_definir_fonctions(:'etab_o', jsonb_build_array(jsonb_build_object('fonction', 'plafonds', 'etat', 'active', 'fin', now() + interval '30 days'))) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_o', false) \g /dev/null
insert into public.eleves (matricule, nom, prenom, sexe) values ('O52', 'Élève', 'N52', 'M');
select pg_temp.verifier((select count(*) from public.eleves) = 52, 'fonctions : effectifs illimités pendant la période offerte');

-- échéance : retour aux droits de l'offre, sans toucher à l'offre
reset role;
update public.fonctions_etablissement set fin = now() - interval '1 second' where etablissement_id = :'etab_o' and fonction = 'smarteval';
set role authenticated;
select pg_temp.verifier(not public.offre_inclut('smarteval') and public.offre_inclut('finances')
  and (select offre from public.etablissements where id = public.etab_courant()) = 'decouverte', 'fonctions : à l''échéance, SmartEval s''arrête ; l''offre ne change pas');
-- retour à l'offre pour la saisie des notes
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.console_definir_fonctions(:'etab_o', '[{"fonction":"notes","etat":"offre"}]') \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_o', false) \g /dev/null
select pg_temp.verifier(public.offre_inclut('notes'), 'fonctions : « selon l''offre » rétablit la saisie des notes');

-- même une offre supérieure peut perdre une fonction (sans notification)
select set_config('request.jwt.claim.sub', :'admin_o', false) \g /dev/null
select pg_temp.verifier(jsonb_array_length(public.notifications_offre_non_lues()) = 1, 'fonctions : l''activation des effectifs illimités a aussi été annoncée');
select public.notification_offre_lue((n ->> 'id')::uuid) from jsonb_array_elements(public.notifications_offre_non_lues()) n \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.console_definir_offre(:'etab_o', 'premium', 'annuel', now() + interval '1 year') \g /dev/null
select (public.console_definir_fonctions(:'etab_o', '[{"fonction":"ia","etat":"desactive"}]') ->> 'notifies')::int as notifies \gset
select set_config('request.jwt.claim.sub', :'admin_o', false) \g /dev/null
select pg_temp.verifier(:notifies = 0 and not public.offre_inclut('ia') and public.offre_inclut('edt') and jsonb_array_length(public.notifications_offre_non_lues()) = 0,
  'fonctions : Premium privé de l''IA, sans notification, le reste intact');
reset role;
select pg_temp.verifier(not public._ia_active(:'admin_o'), 'fonctions : clés API et connexion MCP coupées avec la fonction IA');
