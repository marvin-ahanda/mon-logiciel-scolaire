-- Décisions de fin de période : critères fixés par l'administration seule
reset role; set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select set_config('app.sanc_a', :'sanc_a', false) \g /dev/null
select pg_temp.verifier(public.enregistrer_criteres_decision('a', jsonb_build_array(
  jsonb_build_object('decision', 'admis', 'moyenne_min', 10, 'heures_nj_max', 30),
  jsonb_build_object('decision', 'rattrapage', 'moyenne_min', 8, 'moyenne_max', 10),
  jsonb_build_object('decision', 'redouble', 'moyenne_max', 8),
  jsonb_build_object('decision', 'exclu', 'sanction_id', :'sanc_a', 'sanctions_min', 3, 'libelle', 'Exclu(e) pour indiscipline'))) = 4,
  'administration : critères de fin d''année enregistrés (admission, rattrapage, redoublement, exclusion)');
select pg_temp.verifier(public.enregistrer_criteres_decision('t1', '[{"decision":"redouble","moyenne_max":"8"}, {"decision":"exclu","heures_nj_min":40}]'::jsonb) = 2,
  'administration : critères propres au trimestre 1');
select public.enregistrer_criteres_decision('a', '[{"decision":"admis","moyenne_min":"9,5"},{"decision":"redouble","moyenne_max":9.5}]'::jsonb) \g /dev/null
select pg_temp.verifier((select count(*) from public.criteres_decision where periode = 'a') = 2
  and (select moyenne_min from public.criteres_decision where periode = 'a' and decision = 'admis') = 9.5,
  'un nouvel enregistrement remplace les critères de la période (« 9,5 » accepté)');
do $$ begin perform public.enregistrer_criteres_decision('t2', '[{"decision":"rattrapage","moyenne_min":8}]'::jsonb); raise exception 'rattrapage accepté au trimestre';
exception when sqlstate 'P0001' then raise notice 'ok : le rattrapage ne se décide qu''en fin d''année'; end $$;
do $$ begin perform public.enregistrer_criteres_decision('a', '[{"decision":"admis","moyenne_min":12,"moyenne_max":10}]'::jsonb); raise exception 'bornes incohérentes acceptées';
exception when sqlstate 'P0001' then raise notice 'ok : bornes incohérentes refusées'; end $$;
do $$ begin perform public.enregistrer_criteres_decision('a', '[{"decision":"exclu","sanctions_min":2}]'::jsonb); raise exception 'nombre de sanctions sans sanction accepté';
exception when sqlstate 'P0001' then raise notice 'ok : nombre de sanctions sans sanction refusé'; end $$;
select pg_temp.verifier((select count(*) from public.criteres_decision where periode = 'a') = 2, 'un enregistrement refusé ne modifie rien');
-- le personnel lit les critères (bulletins) mais ne peut pas les modifier
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.criteres_decision) = 4, 'le personnel lit les critères pour les bulletins');
do $$ begin perform public.enregistrer_criteres_decision('a', '[]'::jsonb); raise exception 'enseignant modifie les critères';
exception when insufficient_privilege or sqlstate 'P0001' then raise notice 'ok : seule l''administration fixe les critères'; end $$;
do $$ begin insert into public.criteres_decision (periode, decision) values ('a', 'admis'); raise exception 'écriture directe';
exception when insufficient_privilege then raise notice 'ok : aucune écriture directe dans la table des critères'; end $$;
-- un autre établissement ne voit pas ces critères
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.criteres_decision) = 0, 'critères invisibles pour un autre établissement');
reset role;
