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
select public.api_importer(:'cle_w', '{"classes":[{"libelle":"Tle MCP","niveau":"Tle"}],"matieres":[{"code":"MCPX","libelle":"Matière MCP"}]}'::jsonb) \g /dev/null
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
reset role;
update public.etablissements set offre = 'decouverte', offre_expire_le = null where id = (select etablissement_id from public.personnels where id = :'admin_o');
