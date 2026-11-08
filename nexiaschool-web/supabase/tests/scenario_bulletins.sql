-- Bulletins : code anti-fraude (QR code) et vérification publique
reset role; set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.emettre_bulletins(jsonb_build_object('periode', 't1', 'periode_libelle', 'Trimestre 1', 'bulletins', jsonb_build_array(
  jsonb_build_object('inscription_id', :'ins_a', 'empreinte', repeat('a', 64), 'moyenne', 12.5, 'rang', 1, 'classes', 2, 'effectif', 2, 'appreciation', 'Assez bien'))))->>:'ins_a' as code1 \gset
select pg_temp.verifier(:'code1' ~ '^[A-HJ-NP-Z2-9]{12}$', 'un code de 12 caractères est attribué au bulletin');
select public.emettre_bulletins(jsonb_build_object('periode', 't1', 'periode_libelle', 'Trimestre 1', 'bulletins', jsonb_build_array(
  jsonb_build_object('inscription_id', :'ins_a', 'empreinte', repeat('a', 64), 'moyenne', 12.5))))->>:'ins_a' as code2 \gset
select pg_temp.verifier(:'code1' = :'code2', 'le même bulletin réaffiché garde le même code');
select public.emettre_bulletins(jsonb_build_object('periode', 't1', 'periode_libelle', 'Trimestre 1', 'bulletins', jsonb_build_array(
  jsonb_build_object('inscription_id', :'ins_a', 'empreinte', repeat('b', 64), 'moyenne', 13))))->>:'ins_a' as code3 \gset
select pg_temp.verifier(:'code3' <> :'code1', 'notes modifiées : nouveau code, l''ancien reste valable');
do $$ begin perform 1 from public.bulletins_emis; raise exception 'table lisible directement';
exception when insufficient_privilege then raise notice 'ok : la table des bulletins n''est pas lisible directement'; end $$;

-- un autre établissement ne peut pas émettre de bulletin pour cet élève
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
select set_config('app.ins_a', :'ins_a', false) \g /dev/null
do $$ declare r jsonb; begin
  r := public.emettre_bulletins(jsonb_build_object('periode', 't1', 'bulletins', jsonb_build_array(
         jsonb_build_object('inscription_id', current_setting('app.ins_a'), 'empreinte', repeat('c', 64)))));
  if r <> '{}'::jsonb then raise exception 'bulletin émis pour l''élève d''un autre établissement'; end if;
  raise notice 'ok : aucun bulletin émis pour l''élève d''un autre établissement';
exception when insufficient_privilege then raise notice 'ok : aucun bulletin émis pour l''élève d''un autre établissement (accès refusé)'; end $$;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
do $$ begin perform public.emettre_bulletins(jsonb_build_object('periode', 'x9', 'bulletins', '[]'::jsonb)); raise exception 'période invalide acceptée';
exception when sqlstate '22023' then raise notice 'ok : période invalide refusée'; end $$;

-- vérification publique (visiteur non connecté)
reset role; set role anon;
select set_config('request.jwt.claim.sub', '', false) \g /dev/null
select public.verifier_bulletin(lower(:'code1')) as v \gset
select set_config('app.v', :'v', false) \g /dev/null
select pg_temp.verifier((current_setting('app.v')::jsonb #>> '{etablissement,nom}') = 'Collège Saint-Joseph'
  and (current_setting('app.v')::jsonb #>> '{bulletin,moyenne}')::numeric = 12.5
  and (current_setting('app.v')::jsonb #>> '{bulletin,periode}') = 'Trimestre 1'
  and (current_setting('app.v')::jsonb #>> '{bulletin,classe}') = '6e A', 'le QR code mène à l''établissement émetteur et aux résultats enregistrés');
select pg_temp.verifier(public.verifier_bulletin('ZZZZZZZZZZZZ') is null, 'un code inventé est signalé comme inconnu');
do $$ begin perform public.emettre_bulletins('{}'::jsonb); raise exception 'émission par un visiteur';
exception when insufficient_privilege then raise notice 'ok : un visiteur ne peut pas émettre de bulletin'; end $$;
reset role;
