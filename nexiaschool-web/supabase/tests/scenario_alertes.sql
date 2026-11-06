-- Alertes de discipline : seuils fixés par le surveillant, alertes pour l'administration et les surveillants
reset role; set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'surv_a', false) \g /dev/null
select id as seq2 from public.sequences where exercice_id = :'ex_a' and numero = 2 \gset
select coalesce(sum(heures_non_justifiees), 0)::int as nj0 from public.absences where inscription_id = :'ins_a' \gset
select count(*)::int as av0 from public.incidents x join public.infractions f on f.id = x.infraction_id where x.inscription_id = :'ins_a' and f.sanction_id = :'sanc_a' \gset
select set_config('app.sanc', :'sanc_a', false) \g /dev/null

select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
do $$ begin perform public.discipline_enregistrer_seuils(5, '[]'); raise exception 'seuils fixés par un enseignant';
exception when insufficient_privilege then raise notice 'ok : un enseignant ne fixe pas les seuils'; end $$;
select pg_temp.verifier(json_array_length(public.discipline_alertes()->'eleves') = 0, 'un enseignant ne reçoit pas les alertes de discipline');

select set_config('request.jwt.claim.sub', :'surv_a', false) \g /dev/null
select pg_temp.verifier(not (public.discipline_alertes()->>'configure')::boolean, 'sans seuil : aucune alerte');
select public.discipline_enregistrer_seuils(:nj0 + 5, json_build_array(json_build_object('sanction_id', :'sanc_a', 'seuil', :av0 + 2))::jsonb) \g /dev/null
select pg_temp.verifier((select heures_non_justifiees from public.seuils_discipline) = :nj0 + 5 and (select seuil from public.seuils_sanctions) = :av0 + 2,
  'le surveillant général fixe les seuils (heures non justifiées, avertissements)');
select pg_temp.verifier(json_array_length(public.discipline_alertes()->'eleves') = 0, 'sous les seuils : pas d''alerte');

insert into public.absences (inscription_id, sequence_id, date, heures_non_justifiees) values (:'ins_a', :'seq2', '2026-11-02', 3);
select pg_temp.verifier(json_array_length(public.discipline_alertes()->'eleves') = 0, 'cumul encore sous le seuil');
insert into public.absences (inscription_id, sequence_id, date, heures_non_justifiees, heures_justifiees) values (:'ins_a', :'seq2', '2026-11-03', 2, 4);
create or replace function pg_temp.eleve() returns json language sql as $$ select public.discipline_alertes()->'eleves'->0 $$;
select pg_temp.verifier(pg_temp.eleve()->>'inscription_id' = :'ins_a' and (pg_temp.eleve()->>'heures_nj')::int = :nj0 + 5
  and (pg_temp.eleve()->'motifs'->0->>'motif') = 'heures' and (pg_temp.eleve()->>'nouvelle')::boolean
  and (public.discipline_alertes()->>'non_lues')::int = 1, 'seuil d''heures atteint : alerte automatique, nouvelle');

insert into public.incidents (inscription_id, sequence_id, date, infraction_id) values (:'ins_a', :'seq2', '2026-11-04', :'inf_a'), (:'ins_a', :'seq2', '2026-11-05', :'inf_a');
select pg_temp.verifier(json_array_length(pg_temp.eleve()->'motifs') = 2 and pg_temp.eleve()->'motifs'->1->>'motif' = current_setting('app.sanc')
  and (pg_temp.eleve()->'motifs'->1->>'valeur')::int = :av0 + 2 and (public.discipline_alertes()->>'non_lues')::int = 1,
  'seuil d''avertissements atteint : deuxième motif, toujours un seul élève en alerte');

select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select pg_temp.verifier((public.discipline_alertes()->>'non_lues')::int = 1, 'l''administration reçoit la même alerte');

select set_config('request.jwt.claim.sub', :'surv_a', false) \g /dev/null
select public.discipline_marquer_alertes_lues() \g /dev/null
select pg_temp.verifier((public.discipline_alertes()->>'non_lues')::int = 0 and json_array_length(public.discipline_alertes()->'eleves') = 1
  and not (pg_temp.eleve()->>'nouvelle')::boolean, 'ouverte par le surveillant : lue pour lui, l''élève reste dans la liste');
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select pg_temp.verifier((public.discipline_alertes()->>'non_lues')::int = 1, 'toujours nouvelle pour l''administrateur (lecture propre à chacun)');

select set_config('request.jwt.claim.sub', :'surv_a', false) \g /dev/null
insert into public.incidents (inscription_id, sequence_id, date, infraction_id) values (:'ins_a', :'seq2', '2026-11-06', :'inf_a');
select pg_temp.verifier((public.discipline_alertes()->>'non_lues')::int = 0, 'un avertissement de plus, même seuil : pas de nouvelle alerte');
select public.discipline_enregistrer_seuils(null, json_build_array(json_build_object('sanction_id', :'sanc_a', 'seuil', :av0 + 3))::jsonb) \g /dev/null
select pg_temp.verifier((public.discipline_alertes()->>'non_lues')::int = 1 and json_array_length(pg_temp.eleve()->'motifs') = 1,
  'nouveau seuil atteint : nouvelle alerte ; seuil d''heures désactivé');
do $$ begin perform public.discipline_enregistrer_seuils(0, '[]'); raise exception 'seuil nul accepté';
exception when sqlstate 'P0001' then raise notice 'ok : seuil d''heures invalide refusé'; end $$;

select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
select pg_temp.verifier(json_array_length(public.discipline_alertes()->'eleves') = 0 and (select count(*) from public.seuils_sanctions) = 0,
  'un autre établissement ne voit ni les seuils ni les alertes');
reset role;
