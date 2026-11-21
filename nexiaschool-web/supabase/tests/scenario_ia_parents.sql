-- Assistants IA des parents (MCP) : offre Premium, clé personnelle, données de l'enfant seulement, écritures après aperçu,
-- révocation, OAuth (code + PKCE, rafraîchissement), sessions éphémères nettoyées, journal, cloisonnement
reset role;
select etablissement_id as etab_p from public.personnels where id = :'admin_a' \gset
update public.etablissements set offre = 'premium', offre_expire_le = null where id = :'etab_p';
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select (public.nouveau_code_etablissement()->>'code') as code_ia \gset
reset role; set role anon;
select set_config('request.jwt.claim.sub', '', false) \g /dev/null
select (public.ouvrir_etablissement('Collège Saint-Joseph', :'code_ia')->>'jeton') as jeton_ia \gset
select (public.parent_connexion(:'jeton_ia', 'Grâce Abena', 'M1')->>'jeton') as sp_ia \gset

-- 1. Clé personnelle et données de l'enfant
select pg_temp.verifier((public.parent_ia_etat(:'sp_ia')->>'ouverte')::boolean, 'offre Premium : connexion IA ouverte aux parents');
select (public.parent_ia_creer_cle(:'sp_ia', 'Claude de la maman')->>'cle') as cle_p \gset
select pg_temp.verifier(:'cle_p' ~ '^nxa_[0-9a-f]{48}$' and jsonb_array_length(public.parent_ia_etat(:'sp_ia')->'acces') = 1, 'clé personnelle créée (affichée une fois), accès listé');
reset role;
select count(*) as sessions_avant from public.sessions_parents \gset
set role anon;
select public.api_parent(:'cle_p', 'contexte', '{}') as ctx \gset
select set_config('app.ctx', :'ctx', false) \g /dev/null
select pg_temp.verifier(current_setting('app.ctx')::jsonb->'eleve'->>'matricule' = 'M1' and current_setting('app.ctx')::jsonb->'etablissement'->>'nom' = 'Collège Saint-Joseph',
  'contexte : l''enfant du parent et les informations de l''école');
select public.api_parent(:'cle_p', 'finances', '{}') as fin_p \gset
select set_config('app.fin_p', :'fin_p', false) \g /dev/null
select pg_temp.verifier(jsonb_array_length(current_setting('app.fin_p')::jsonb->'echeances') = 5 and current_setting('app.fin_p')::jsonb ? 'prochaine_echeance',
  'finances : échéancier de l''enfant et prochaine échéance');
select public.api_parent(:'cle_p', 'courriers', '{}') as cr_p \gset
select set_config('app.cr_p', :'cr_p', false) \g /dev/null
reset role;
select pg_temp.verifier(jsonb_array_length(current_setting('app.cr_p')::jsonb->'courriers_de_l_ecole') > 0 and not exists (select 1 from jsonb_array_elements(current_setting('app.cr_p')::jsonb->'courriers_de_l_ecole') x
    join public.courriers_ecole c on c.id = (x->>'id')::uuid where c.eleve_id <> (select eleve_id from public.inscriptions where id = :'ins_a')),
  'courriers : uniquement ceux de l''enfant');
set role anon;
select pg_temp.verifier(public.api_parent(:'cle_p', 'emploi_du_temps', '{}') ? 'publie' and public.api_parent(:'cle_p', 'pv', '{}') is not null,
  'emploi du temps publié et PV de performances accessibles');
reset role;
select pg_temp.verifier((select count(*) from public.sessions_parents) = :'sessions_avant'::int, 'sessions parent éphémères supprimées après chaque appel');

-- 2. Écritures : aperçu d'abord, puis confirmation
select count(*) as courriers_avant from public.courriers \gset
set role anon;
-- même avec « confirmer », l'assistant ne fait que préparer un brouillon (une consigne cachée ne peut rien envoyer)
select (public.api_parent(:'cle_p', 'ecrire_ecole', '{"objet": "audience", "parent_nom": "Marie Abena", "parent_qualite": "mere",
  "message": "Je souhaite rencontrer le professeur principal.", "confirmer": true}')->>'brouillon') as brouillon \gset
reset role;
select pg_temp.verifier((select count(*) from public.courriers) = :'courriers_avant'::int, 'écrire à l''école : brouillon préparé, rien n''est envoyé par l''assistant');
set role anon;
select pg_temp.verifier(jsonb_array_length(public.parent_ia_etat(:'sp_ia')->'brouillons') = 1, 'le parent voit le brouillon dans son espace');
select public.parent_ia_brouillon(:'sp_ia', :'brouillon', true) \g /dev/null
reset role;
select pg_temp.verifier((select count(*) from public.courriers) = :'courriers_avant'::int + 1
  and (select statut from public.brouillons_ia_parents where id = :'brouillon') = 'envoye', 'courrier envoyé seulement après validation par le parent');
select set_config('app.brouillon', :'brouillon', false), set_config('app.sp_ia', :'sp_ia', false) \g /dev/null
set role anon;
do $$ begin perform public.parent_ia_brouillon(current_setting('app.sp_ia'), current_setting('app.brouillon')::uuid, true); raise exception 'double envoi';
exception when sqlstate 'P0001' then raise notice 'ok : un brouillon ne s''envoie qu''une fois'; end $$;
reset role;
select id as c_autre from public.courriers_ecole where eleve_id <> (select eleve_id from public.inscriptions where id = :'ins_a') and statut = 'envoye' limit 1 \gset
select set_config('app.c_autre', :'c_autre', false), set_config('app.cle_p', :'cle_p', false) \g /dev/null
set role anon;
select pg_temp.verifier(public.api_parent(:'cle_p', 'repondre_courrier', jsonb_build_object('courrier_id', :'c_autre', 'message', 'Intrusion'))->>'erreur' like 'Courrier introuvable%',
  'impossible de préparer une réponse au courrier d''un autre enfant');
reset role;
select pg_temp.verifier((select erreur from public.journal_api_parents order by id desc limit 1) like 'Courrier introuvable%', 'appel en erreur journalisé et compté');
set role anon;

-- 3. Accès refusés : clé inventée, offre insuffisante, clé révoquée
do $$ begin perform public.api_parent('nxa_' || repeat('0', 48), 'contexte', '{}'); raise exception 'clé inventée';
exception when sqlstate '28000' then raise notice 'ok : clé inventée refusée'; end $$;
reset role;
update public.etablissements set offre = 'decouverte' where id = :'etab_p';   -- Découverte : pas d'IA
set role anon;
do $$ begin perform public.api_parent(current_setting('app.cle_p'), 'contexte', '{}'); raise exception 'offre Découverte';
exception when sqlstate '28000' then raise notice 'ok : hors offre Premium, l''assistant IA du parent est refusé'; end $$;
select pg_temp.verifier(not (public.parent_ia_etat(:'sp_ia')->>'ouverte')::boolean, 'hors offre Premium : connexion IA fermée dans l''espace parents');
reset role;
update public.etablissements set offre = 'premium' where id = :'etab_p';
set role anon;
select public.parent_ia_revoquer(:'sp_ia', (public.parent_ia_etat(:'sp_ia')->'acces'->0->>'id')::uuid) \g /dev/null
do $$ begin perform public.api_parent(current_setting('app.cle_p'), 'contexte', '{}'); raise exception 'clé révoquée';
exception when sqlstate '28000' then raise notice 'ok : clé révoquée refusée'; end $$;

-- 4. OAuth (connecteur Claude.ai) : code + PKCE, jeton d'accès parent, rafraîchissement avec rotation
select (public.oauth_enregistrer_client('Claude', array['https://claude.ai/api/mcp/auth_callback'])->>'client_id') as client_p \gset
reset role;
select public._b64url_sha256('verificateur-parent-0123456789-abcdefghijklmnopqrstuvwxyz') as defi \gset
set role anon;
-- une application qui se fait appeler « Claude » mais renvoie vers un autre site est refusée pour un parent
select (public.oauth_enregistrer_client('Claude', array['https://piege.example/cb'])->>'client_id') as client_piege \gset
select set_config('app.client_piege', :'client_piege', false), set_config('app.defi', :'defi', false), set_config('app.sp_ia', :'sp_ia', false) \g /dev/null
do $$ begin perform public.oauth_autoriser_parent(current_setting('app.sp_ia'), current_setting('app.client_piege'), 'https://piege.example/cb', current_setting('app.defi'), 'S256');
  raise exception 'hôte piégé accepté';
exception when sqlstate 'P0001' then raise notice 'ok : adresse de retour d''une application non reconnue refusée pour un parent'; end $$;
select pg_temp.verifier(not (public.oauth_info_client_parent(:'client_piege', 'https://piege.example/cb')->>'reconnu')::boolean
  and (public.oauth_info_client_parent(:'client_p', 'https://claude.ai/api/mcp/auth_callback')->>'reconnu')::boolean, 'page d''autorisation : hôte de retour affiché et vérifié');
select (public.oauth_autoriser_parent(:'sp_ia', :'client_p', 'https://claude.ai/api/mcp/auth_callback', :'defi', 'S256')->>'code') as code_oauth \gset
select public.oauth_echanger_code(:'code_oauth', 'verificateur-parent-0123456789-abcdefghijklmnopqrstuvwxyz', :'client_p', 'https://claude.ai/api/mcp/auth_callback') as tok \gset
select set_config('app.tok', :'tok', false) \g /dev/null
select (current_setting('app.tok')::jsonb->>'access_token') as acces_oauth, (current_setting('app.tok')::jsonb->>'refresh_token') as rafr_oauth \gset
select pg_temp.verifier(:'acces_oauth' like 'nxa_%' and :'rafr_oauth' like 'nxq_%'
  and public.api_parent(:'acces_oauth', 'contexte', '{}')->'eleve'->>'matricule' = 'M1', 'OAuth parent : jeton d''accès limité à l''enfant');
select pg_temp.verifier(public.oauth_echanger_code(:'code_oauth', 'verificateur-parent-0123456789-abcdefghijklmnopqrstuvwxyz', :'client_p', 'https://claude.ai/api/mcp/auth_callback')->>'error' = 'invalid_grant',
  'code d''autorisation à usage unique');
select (public.oauth_rafraichir(:'rafr_oauth', :'client_p')->>'access_token') as acces_oauth2 \gset
select set_config('app.acces_oauth', :'acces_oauth', false) \g /dev/null
select pg_temp.verifier(public.api_parent(:'acces_oauth2', 'contexte', '{}')->'eleve'->>'matricule' = 'M1', 'rafraîchissement : nouveau jeton valide');
do $$ begin perform public.api_parent(current_setting('app.acces_oauth'), 'contexte', '{}'); raise exception 'ancien jeton';
exception when sqlstate '28000' then raise notice 'ok : l''ancien jeton est révoqué après rafraîchissement'; end $$;
-- réutilisation de l'ancien jeton de rafraîchissement (vol probable) : toute la lignée est révoquée
select pg_temp.verifier(public.oauth_rafraichir(:'rafr_oauth', :'client_p')->>'error' = 'invalid_grant', 'jeton de rafraîchissement à usage unique');
select set_config('app.acces_oauth2', :'acces_oauth2', false) \g /dev/null
do $$ begin perform public.api_parent(current_setting('app.acces_oauth2'), 'contexte', '{}'); raise exception 'lignée non révoquée';
exception when sqlstate '28000' then raise notice 'ok : réutilisation détectée, tous les jetons de l''application sont révoqués'; end $$;

-- 5. Journal, administration, cloisonnement
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.journal_api_parents) >= 8 and (select count(*) from public.acces_ia_parents) >= 2,
  'administration : appels des assistants des parents journalisés, accès visibles (sans secret)');
do $$ begin perform acces_hash from public.acces_ia_parents; raise exception 'secret lisible';
exception when insufficient_privilege then raise notice 'ok : les empreintes des clés ne sont pas lisibles'; end $$;
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.acces_ia_parents) = 0 and (select count(*) from public.journal_api_parents) = 0,
  'un autre établissement ne voit pas les accès IA des parents');
reset role;
