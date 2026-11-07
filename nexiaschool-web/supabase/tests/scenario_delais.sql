-- Délai de saisie des notes par séquence et alerte des enseignants en retard
reset role; set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select id as seq3 from public.sequences where exercice_id = :'ex_a' and numero = 3 \gset
select pg_temp.verifier(json_array_length(public.notes_retards()->'sequences') = 0, 'sans délai : aucune alerte de saisie');

select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
update public.sequences set date_limite_notes = (now() at time zone 'Africa/Douala')::date - 1 where id = :'seq3';
select pg_temp.verifier((select date_limite_notes from public.sequences where id = :'seq3') is null, 'un enseignant ne fixe pas le délai');

select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
update public.sequences set date_limite_notes = (now() at time zone 'Africa/Douala')::date + 3 where id = :'seq3';
select pg_temp.verifier(json_array_length(public.notes_retards()->'sequences') = 0, 'délai pas encore atteint : pas d''alerte');
update public.sequences set date_limite_notes = (now() at time zone 'Africa/Douala')::date - 2 where id = :'seq3';
create or replace function pg_temp.seq() returns json language sql as $$ select public.notes_retards()->'sequences'->0 $$;
select pg_temp.verifier((pg_temp.seq()->>'numero')::int = 3 and (pg_temp.seq()->>'jours_retard')::int = 2
  and pg_temp.seq()->'enseignants'->0->>'enseignant_id' = :'prof_a'
  and pg_temp.seq()->'enseignants'->0->'classes'->0->>'classe' = '6e A' and pg_temp.seq()->'enseignants'->0->'classes'->0->>'code' = 'MATH'
  and (public.notes_retards()->>'non_lues')::int = 1,
  'délai dépassé : l''enseignant en retard est signalé avec sa classe et sa matière (alerte non lue)');

select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select pg_temp.verifier(json_array_length(public.notes_retards()->'sequences') = 0, 'les enseignants ne reçoivent pas cette alerte');
do $$ begin perform public.notes_marquer_alertes_lues(); raise exception 'marquage par un enseignant';
exception when insufficient_privilege then raise notice 'ok : marquage réservé à l''administration'; end $$;

select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.notes_marquer_alertes_lues() \g /dev/null
select pg_temp.verifier((public.notes_retards()->>'non_lues')::int = 0 and json_array_length(public.notes_retards()->'sequences') = 1,
  'alerte ouverte : lue pour cet administrateur, la liste reste consultable');
select set_config('request.jwt.claim.sub', :'code_user_a', false) \g /dev/null
select pg_temp.verifier((public.notes_retards()->>'non_lues')::int = 1, 'toujours nouvelle pour l''autre administrateur');

select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
update public.sequences set date_limite_notes = (now() at time zone 'Africa/Douala')::date - 1 where id = :'seq3';
select pg_temp.verifier((public.notes_retards()->>'non_lues')::int = 1, 'nouveau délai dépassé : nouvelle alerte');

-- L'enseignant saisit toutes les notes de sa classe : il n'est plus en retard
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
insert into public.notes (inscription_id, attribution_id, sequence_id, valeur)
  select i.id, :'attr_a', :'seq3', 11 from public.inscriptions i where i.classe_id = :'classe_a' and i.exercice_id = :'ex_a'
  on conflict (inscription_id, attribution_id, sequence_id) do nothing;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select pg_temp.verifier(not exists (select 1 from json_array_elements(public.notes_retards()->'sequences') s, json_array_elements(s->'enseignants') e
                                     where e->>'enseignant_id' = :'prof_a'), 'notes complètes : l''enseignant n''est plus en retard');

select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
select pg_temp.verifier(json_array_length(public.notes_retards()->'sequences') = 0, 'un autre établissement ne voit pas ces retards');
reset role;
