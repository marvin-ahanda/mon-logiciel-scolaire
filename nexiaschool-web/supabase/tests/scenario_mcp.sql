-- MCP : l'IA applique un document (import) via une clé API, avec les droits de son propriétaire
reset role;
update public.etablissements set offre = 'premium' where id = (select etablissement_id from public.personnels where id = :'admin_o');
delete from public.fonctions_etablissement where etablissement_id = (select etablissement_id from public.personnels where id = :'admin_o') and fonction = 'ia';
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "google"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_o', false) \g /dev/null
select public.definir_ia_personnelle(true) \g /dev/null
select (public.creer_cle_api('IA écriture', true, 0))->>'cle' as cle_w \gset
select (public.creer_cle_api('IA lecture', false, 0))->>'cle' as cle_r \gset
reset role;
set role anon;
select public.api_importer(:'cle_w', '{"annee":"2026-2027","classes":[{"libelle":"Tle MCP","niveau":"Tle"}],"matieres":[{"code":"MCPX","libelle":"Matière MCP"}],"eleves":[{"matricule":"MCP001","nom":"ESSOMBA","prenom":"Luc","sexe":"M","classe":"Tle MCP"}]}'::jsonb) \g /dev/null
-- écritures supplémentaires de l'IA (clé écriture)
select public.api_enregistrer_paiement(:'cle_w', 'Tle MCP', 'MCP001', 5000, 'mobile_money', null, 'REF-IA', 'Paiement par l''IA') \g /dev/null
select (public.api_creer_personnel(:'cle_w', 'NDJEMA', 'Paul', 'enseignant', 'P-IA-1', '', ''))->>'code' as code_perso \gset
select public.api_discipline_seuils(:'cle_w', 12, '[]'::jsonb) \g /dev/null
select public.api_criteres_decision(:'cle_w', 't1', '[]'::jsonb) \g /dev/null
reset role;
select pg_temp.verifier(exists(select 1 from public.paiements p join public.inscriptions i on i.id = p.inscription_id join public.eleves e on e.id = i.eleve_id
  where e.matricule = 'MCP001' and p.montant = 5000 and p.mode = 'mobile_money'), 'MCP : l''IA enregistre un paiement d''élève (reçu attribué)');
select pg_temp.verifier(length(:'code_perso') >= 6, 'MCP : l''IA crée un membre du personnel et reçoit son code d''accès');
select pg_temp.verifier(exists(select 1 from public.personnels where etablissement_id = (select etablissement_id from public.personnels where id = :'admin_o') and nom = 'NDJEMA'),
  'MCP : le membre du personnel est bien créé');
select pg_temp.verifier((select count(*) from public.journal_api where etablissement_id = (select etablissement_id from public.personnels where id = :'admin_o')
  and outil in ('enregistrer_paiement', 'creer_personnel', 'discipline_seuils', 'criteres_decision')) = 4, 'MCP : les écritures de l''IA sont toutes journalisées');
reset role;
select pg_temp.verifier(exists(select 1 from public.classes where etablissement_id = (select etablissement_id from public.personnels where id = :'admin_o') and libelle = 'Tle MCP'),
  'MCP : l''IA crée une classe par import (clé écriture)');
select pg_temp.verifier(exists(select 1 from public.journal_api where outil = 'importer' and etablissement_id = (select etablissement_id from public.personnels where id = :'admin_o')),
  'MCP : l''import de l''IA est journalisé');
select set_config('nexia.cle_r', :'cle_r', false) \g /dev/null
set role anon;
do $$ begin perform public.api_importer(current_setting('nexia.cle_r'), '{}'::jsonb); raise exception 'ÉCHEC : clé en lecture seule acceptée en écriture';
exception when sqlstate '42501' then raise notice 'ok : MCP : clé en lecture seule refusée pour l''import'; end $$;
do $$ begin perform public.api_importer('nxs_cle_inexistante', '{}'::jsonb); raise exception 'ÉCHEC : clé invalide acceptée';
exception when sqlstate '28000' then raise notice 'ok : MCP : clé invalide refusée'; end $$;
-- Imports lourds : délai propre généreux (jamais interrompu, même via MCP en rôle anon)
reset role;
select pg_temp.verifier((select 'statement_timeout=120s' = any(proconfig) from pg_proc where proname = 'importer_ecole'),
  'imports : importer_ecole a son propre délai de 120 s');
select pg_temp.verifier((select 'statement_timeout=120s' = any(proconfig) from pg_proc where proname = 'api_importer'),
  'imports : api_importer (MCP) a son propre délai de 120 s');
reset role;
update public.etablissements set offre = 'decouverte', offre_expire_le = null where id = (select etablissement_id from public.personnels where id = :'admin_o');
