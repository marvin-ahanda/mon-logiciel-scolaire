-- Saisie des notes : tout membre actif du personnel à qui une matière est confiée, quelle que soit sa fonction
reset role; set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select id as seq4 from public.sequences where exercice_id = :'ex_a' and numero = 4 \gset
insert into public.matieres (code, libelle) values ('HG', 'Histoire-géographie'), ('EPS', 'Éducation physique');
select id as hg from public.matieres where code = 'HG' \gset
select id as eps from public.matieres where code = 'EPS' \gset

-- sans aucun paramètre, une matière se confie à un surveillant ou à un comptable
insert into public.attributions (exercice_id, classe_id, matiere_id, enseignant_id, coefficient) values (:'ex_a', :'classe_a', :'hg', :'surv_a', 2) returning id as attr_hg \gset
insert into public.attributions (exercice_id, classe_id, matiere_id, enseignant_id, coefficient) values (:'ex_a', :'classe_a', :'eps', :'cpt', 1) returning id as attr_eps \gset
select set_config('app.attr_eps', :'attr_eps', false) \g /dev/null
select pg_temp.verifier(true, 'matières confiées au surveillant (HG) et au comptable (EPS) sans paramètre particulier');

-- un compte désactivé ne peut pas recevoir de matière
select (public.creer_personnel('Ancien', 'Paul', 'enseignant', 'X9', '', 'Professeur de dessin')->>'id') as ancien \gset
select pg_temp.verifier((select poste from public.personnels where id = :'ancien') = 'Professeur de dessin', 'le poste / la spécialité du personnel est enregistré');
select public.modifier_personnel(:'ancien', 'Ancien', 'Paul', 'enseignant', false, 'X9', '') \g /dev/null
select pg_temp.verifier((select poste from public.personnels where id = :'ancien') = 'Professeur de dessin', 'modifier un membre sans poste conserve son poste');
select set_config('app.ancien', :'ancien', false) \g /dev/null
do $$ begin update public.attributions set enseignant_id = current_setting('app.ancien')::uuid where id = current_setting('app.attr_eps')::uuid;
  raise exception 'matière confiée à un compte désactivé';
exception when sqlstate 'P0001' then raise notice 'ok : aucune matière confiée à un compte désactivé'; end $$;

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

-- import des notes seules : chacun pour ses matières, l'administration pour toutes
select matricule as mat_a from public.eleves e join public.inscriptions i on i.eleve_id = e.id where i.id = :'ins_a' \gset
select set_config('app.mat_a', :'mat_a', false) \g /dev/null
select (public.importer_notes(jsonb_build_object('notes', jsonb_build_array(jsonb_build_array(:'mat_a', 'eps', 4, 17.5))))->'notes'->>'modifies')::int as m1 \gset
select pg_temp.verifier(:m1 = 1 and (select valeur from public.notes where attribution_id = :'attr_eps') = 17.5, 'import de notes : le comptable met à jour les notes de sa matière');
do $$ begin perform public.importer_notes(jsonb_build_object('notes', jsonb_build_array(jsonb_build_array(current_setting('app.mat_a'), 'HG', 4, 3))));
  raise exception 'import dans la matière d''un autre';
exception when sqlstate 'P0001' then raise notice 'ok : import refusé pour une matière qui ne lui est pas confiée'; end $$;
select pg_temp.verifier((select valeur from public.notes where attribution_id = :'attr_hg') = 14, 'import refusé : aucune note modifiée');
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select (public.importer_notes(jsonb_build_object('notes', jsonb_build_array(jsonb_build_array(:'mat_a', 'HG', 4, 15), jsonb_build_array(:'mat_a', 'EPS', 4, 17.5))))->'notes') as r_adm \gset
select set_config('app.r_adm', :'r_adm', false) \g /dev/null
select pg_temp.verifier((current_setting('app.r_adm')::json->>'modifies')::int = 1 and (current_setting('app.r_adm')::json->>'crees')::int = 0,
  'import de notes par l''administration : toutes les matières, seule la note changée est réécrite');

-- un compte désactivé ne saisit plus
select public.modifier_personnel(:'cpt', 'Comptable', '', 'comptable', false, '', '') \g /dev/null
select set_config('request.jwt.claim.sub', :'cpt', false) \g /dev/null
do $$ begin update public.notes set valeur = 5 where attribution_id = current_setting('app.attr_eps')::uuid;
  if found then raise exception 'saisie possible avec un compte désactivé'; end if;
  raise notice 'ok : compte désactivé : plus aucune saisie';
end $$;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select pg_temp.verifier((select valeur from public.notes where attribution_id = :'attr_eps') = 17.5, 'la note reste intacte');
select public.modifier_personnel(:'cpt', 'Comptable', '', 'comptable', true, '', '') \g /dev/null
reset role;
