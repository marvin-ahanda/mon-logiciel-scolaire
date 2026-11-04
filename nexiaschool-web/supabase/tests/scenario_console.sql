
-- Console du propriétaire de la plateforme : accès réservé, suspension, suppression, journal
reset role;
select id as etab_b from public.etablissements where nom = 'Lycée de Bonabéri' \gset
select id as etab_a from public.etablissements where nom = 'Collège Saint-Joseph' \gset
select set_config('app.etab_a', :'etab_a', false), set_config('app.etab_b', :'etab_b', false),
       set_config('app.admin_a', :'admin_a', false), set_config('app.admin_b', :'admin_b', false) \g /dev/null
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
do $$ begin perform public.console_resume(); raise exception 'console ouverte à un non-propriétaire';
exception when insufficient_privilege then raise notice 'ok : console refusée à un administrateur d''établissement'; end $$;
select pg_temp.verifier(not public.est_proprietaire() and not (public.mon_compte()->>'proprietaire')::boolean, 'un fondateur n''est pas propriétaire de la plateforme');
reset role;
insert into public.plateforme_admins (user_id) values (:'admin_a');
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select pg_temp.verifier((public.console_resume()->>'etablissements')::int = 2, 'vue d''ensemble : 2 établissements');
select pg_temp.verifier(json_array_length(public.console_etablissements()) = 2
  and (select bool_or((x->>'contient_proprietaire')::boolean) from json_array_elements(public.console_etablissements()) x), 'liste des établissements (le sien signalé)');
select pg_temp.verifier(json_array_length(public.console_etablissement(:'etab_b')->'personnels') >= 2, 'fiche d''un autre établissement : personnel visible');
select pg_temp.verifier(json_array_length(public.console_utilisateurs()) >= 4, 'liste de tous les utilisateurs');
select pg_temp.verifier((public.mon_compte()->>'proprietaire')::boolean, 'le propriétaire est reconnu');
do $$ begin perform public.console_suspendre(current_setting('app.etab_a')::uuid, 'essai'); raise exception 'propre établissement suspendu';
exception when sqlstate 'P0001' then raise notice 'ok : le propriétaire ne peut pas suspendre son propre établissement'; end $$;
select public.console_suspendre(:'etab_b', 'Impayé') \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
select pg_temp.verifier(public.etab_courant() is null and (select count(*) from public.classes) = 0 and not public.est_admin(), 'suspension : plus aucun accès aux données');
select pg_temp.verifier((public.mon_compte()->>'suspendu')::boolean and public.mon_compte()->>'motif' = 'Impayé', 'suspension : motif communiqué à l''établissement');
reset role; set role anon;
select pg_temp.verifier(public.ouvrir_etablissement('Lycée de Bonabéri', :'code_b')->>'erreur' like '%suspendu%', 'suspension : entrée dans l''espace refusée');
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.console_reactiver(:'etab_b') \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
select pg_temp.verifier(public.etab_courant() = :'etab_b'::uuid, 'réactivation : accès rétabli');
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
do $$ begin perform public.console_supprimer_utilisateur(current_setting('app.admin_a')::uuid); raise exception 'propriétaire supprimé';
exception when sqlstate 'P0001' then raise notice 'ok : le compte propriétaire ne peut pas être supprimé'; end $$;
select public.console_supprimer_utilisateur(:'code_user_b') \g /dev/null
reset role;
select pg_temp.verifier(not exists (select 1 from auth.users where id = :'code_user_b'), 'utilisateur supprimé (compte de connexion compris)');
set role authenticated;
do $$ begin perform public.console_supprimer_utilisateur(current_setting('app.admin_b')::uuid); raise exception 'dernier administrateur supprimé';
exception when sqlstate 'P0001' then raise notice 'ok : le dernier administrateur d''un établissement est protégé'; end $$;
do $$ begin perform public.console_supprimer_etablissement(current_setting('app.etab_b')::uuid, 'autre nom'); raise exception 'suppression sans confirmation';
exception when sqlstate 'P0001' then raise notice 'ok : suppression refusée sans le nom exact'; end $$;
select pg_temp.verifier(not public.console_fichiers_purgeables(:'etab_b'), 'fichiers non purgeables tant que l''établissement existe');
select public.console_supprimer_etablissement(:'etab_b', 'lycee de bonaberi') \g /dev/null
reset role;
select pg_temp.verifier(not exists (select 1 from public.etablissements where id = :'etab_b') and not exists (select 1 from auth.users where id = :'admin_b')
  and not exists (select 1 from public.eleves where etablissement_id = :'etab_b'), 'établissement supprimé avec son personnel et ses élèves');
select pg_temp.verifier(exists (select 1 from public.etablissements where id = :'etab_a'), 'les autres établissements sont intacts');
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select pg_temp.verifier(public.console_fichiers_purgeables(:'etab_b'), 'fichiers de l''établissement supprimé purgeables par le propriétaire');
select pg_temp.verifier(json_array_length(public.console_journal(50)) >= 4, 'journal : suspension, réactivation et suppressions enregistrées');
reset role;
