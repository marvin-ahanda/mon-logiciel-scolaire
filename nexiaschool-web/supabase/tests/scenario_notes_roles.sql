-- Paramètre : surveillants et comptables autorisés à saisir des notes (matières confiées)
reset role; set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select id as seq4 from public.sequences where exercice_id = :'ex_a' and numero = 4 \gset
insert into public.matieres (code, libelle) values ('HG', 'Histoire-géographie'), ('EPS', 'Éducation physique');
select id as hg from public.matieres where code = 'HG' \gset
select id as eps from public.matieres where code = 'EPS' \gset
do $$ begin insert into public.attributions (exercice_id, classe_id, matiere_id, enseignant_id, coefficient)
  select x.exercice_id, x.classe_id, m.id, current_setting('app.surv')::uuid, 2 from public.attributions x, public.matieres m
   where x.id = current_setting('app.attr')::uuid and m.code = 'HG';
  raise exception 'matière confiée au surveillant sans autorisation';
exception when sqlstate 'P0001' then raise notice 'ok : par défaut, aucune matière ne peut être confiée au surveillant'; end $$;

update public.etablissements set notes_surveillants = true, notes_comptables = true;
select pg_temp.verifier((select notes_surveillants and notes_comptables from public.etablissements), 'l''administration autorise les surveillants et les comptables');
insert into public.attributions (exercice_id, classe_id, matiere_id, enseignant_id, coefficient) values (:'ex_a', :'classe_a', :'hg', :'surv_a', 2) returning id as attr_hg \gset
insert into public.attributions (exercice_id, classe_id, matiere_id, enseignant_id, coefficient) values (:'ex_a', :'classe_a', :'eps', :'cpt', 1) returning id as attr_eps \gset
select set_config('app.attr_eps', :'attr_eps', false) \g /dev/null
select pg_temp.verifier(true, 'matières confiées au surveillant (HG) et au comptable (EPS)');

select set_config('request.jwt.claim.sub', :'surv_a', false) \g /dev/null
insert into public.notes (inscription_id, attribution_id, sequence_id, valeur) values (:'ins_a', :'attr_hg', :'seq4', 14);
select pg_temp.verifier((select valeur from public.notes where attribution_id = :'attr_hg') = 14, 'le surveillant saisit les notes de sa matière');
select set_config('app.seq4', :'seq4', false) \g /dev/null
do $$ begin insert into public.notes (inscription_id, attribution_id, sequence_id, valeur)
  values (current_setting('app.ins_a')::uuid, current_setting('app.attr')::uuid, current_setting('app.seq4')::uuid, 9);
  raise exception 'note saisie dans la matière d''un autre';
exception when insufficient_privilege then raise notice 'ok : pas de saisie dans une matière qui ne lui est pas confiée'; end $$;
select set_config('request.jwt.claim.sub', :'cpt', false) \g /dev/null
insert into public.notes (inscription_id, attribution_id, sequence_id, valeur) values (:'ins_a', :'attr_eps', :'seq4', 16);
select pg_temp.verifier((select valeur from public.notes where attribution_id = :'attr_eps') = 16, 'le comptable / caissier saisit les notes de sa matière');

select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
update public.etablissements set notes_comptables = false;
select set_config('request.jwt.claim.sub', :'cpt', false) \g /dev/null
do $$ begin update public.notes set valeur = 5 where attribution_id = current_setting('app.attr_eps')::uuid;
  if found then raise exception 'saisie possible après retrait de l''autorisation'; end if;
  raise notice 'ok : autorisation retirée : le comptable ne modifie plus les notes';
end $$;
select pg_temp.verifier((select valeur from public.notes where attribution_id = :'attr_eps') = 16, 'la note du comptable reste intacte');

select set_config('request.jwt.claim.sub', :'admin_c', false) \g /dev/null
select pg_temp.verifier(not (select notes_surveillants from public.etablissements), 'le paramètre est propre à chaque établissement');
reset role;
