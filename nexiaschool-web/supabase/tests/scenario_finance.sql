
-- Finances : rôle comptable, frais et délais, situation des élèves, paiements, alertes de retard
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select (public.creer_personnel('Essomba', 'Claire', 'comptable', '', '')->>'id') as cpt \gset
select set_config('app.cpt', :'cpt', false), set_config('app.ins_a', :'ins_a', false) \g /dev/null
insert into public.sections (libelle, ordre) values ('Francophone', 1) returning id as sec \gset
update public.classes set section_id = :'sec', cycle = 1 where id = :'classe_a';
select pg_temp.verifier((select section_id from public.classes where id = :'classe_a') = :'sec'::uuid, 'section et cycle attribués à une classe par l''administration');

select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
do $$ begin perform public.finance_eleves(null); raise exception 'finances ouvertes à un enseignant';
exception when insufficient_privilege then raise notice 'ok : finances refusées à un enseignant'; end $$;
select pg_temp.verifier((select count(*) from public.paiements) = 0 and not public.peut_finance(), 'un enseignant ne voit aucun paiement');

select set_config('request.jwt.claim.sub', :'cpt', false) \g /dev/null
select pg_temp.verifier(public.peut_finance() and not (public.finance_eleves(null)->>'configure')::boolean, 'comptable : finances accessibles, frais à configurer');
do $$ begin insert into public.sections (libelle) values ('Pirate'); raise exception 'section créée par le comptable';
exception when insufficient_privilege then raise notice 'ok : seules l''administration crée les sections'; end $$;
do $$ begin perform public.finance_enregistrer_frais(205000, 200000, json_build_array(
    json_build_object('montant', 20000, 'date_limite', current_date - 40), json_build_object('montant', 100000, 'date_limite', current_date - 10),
    json_build_object('montant', 60000, 'date_limite', current_date + 20), json_build_object('montant', 40000, 'date_limite', current_date + 60),
    json_build_object('montant', 20000, 'date_limite', current_date + 90))::jsonb); raise exception 'tranches supérieures à la pension acceptées';
exception when sqlstate 'P0001' then raise notice 'ok : tranches supérieures à la pension refusées'; end $$;
do $$ begin perform public.finance_enregistrer_frais(205000, 200000, json_build_array(
    json_build_object('montant', 20000, 'date_limite', current_date - 10), json_build_object('montant', 60000, 'date_limite', current_date - 40),
    json_build_object('montant', 60000, 'date_limite', current_date + 20), json_build_object('montant', 40000, 'date_limite', current_date + 60),
    json_build_object('montant', 20000, 'date_limite', current_date + 90))::jsonb); raise exception 'délais dans le désordre acceptés';
exception when sqlstate 'P0001' then raise notice 'ok : délais dans le désordre refusés'; end $$;
select public.finance_enregistrer_frais(205000, 200000, json_build_array(
    json_build_object('montant', 20000, 'date_limite', current_date - 40), json_build_object('montant', 60000, 'date_limite', current_date - 10),
    json_build_object('montant', 60000, 'date_limite', current_date + 20), json_build_object('montant', 40000, 'date_limite', current_date + 60),
    json_build_object('montant', 20000, 'date_limite', current_date + 90))::jsonb) \g /dev/null
create or replace function pg_temp.situation() returns json language sql as $$
  select e from json_array_elements(public.finance_eleves(null)->'eleves') e where e->>'inscription_id' = current_setting('app.ins_a') $$;
select pg_temp.verifier((pg_temp.situation()->>'total_du')::int = 205000 and (pg_temp.situation()->'lignes'->0->>'montant')::int = 25000,
  'nouvel élève : pension 205 000, l''écart de 5 000 porté sur l''inscription (25 000)');
select pg_temp.verifier((pg_temp.situation()->>'retard')::int = 85000 and pg_temp.situation()->>'statut' = 'en_retard'
  and pg_temp.situation()->>'tranches_en_retard' = 'Inscription, Tranche 1' and (pg_temp.situation()->>'jours_retard')::int = 40,
  'sans paiement : 85 000 en retard (inscription et tranche 1), 40 jours');
select pg_temp.verifier((public.finance_alertes()->>'non_lues')::int = 2 and (public.finance_alertes()->>'insolvables')::int >= 1, 'deux alertes non lues (inscription, tranche 1)');
insert into public.paiements (inscription_id, montant, date_paiement, mode) values (:'ins_a', 50000, current_date - 5, 'especes') returning numero as recu1 \gset
select pg_temp.verifier(:'recu1'::int = 1, 'reçu numéroté automatiquement (n° 1)');
select pg_temp.verifier((pg_temp.situation()->>'retard')::int = 35000 and (pg_temp.situation()->'lignes'->0->>'paye')::int = 25000
  and (pg_temp.situation()->'lignes'->1->>'paye')::int = 25000, 'avance de 50 000 : inscription soldée, tranche 1 partielle, 35 000 en retard');
insert into public.paiements (inscription_id, montant, mode, reference) values (:'ins_a', 35000, 'mobile_money', 'MM-123') returning numero as recu2 \gset
select pg_temp.verifier((pg_temp.situation()->>'en_regle')::boolean and pg_temp.situation()->>'statut' = 'a_jour'
  and (pg_temp.situation()->'prochaine'->>'reste')::int = 60000 and (pg_temp.situation()->>'reste')::int = 120000,
  'en règle après 85 000 : reste 120 000, prochaine échéance tranche 2 (60 000)');
do $$ begin insert into public.paiements (inscription_id, montant, date_paiement) values (current_setting('app.ins_a')::uuid, 1000, current_date + 3); raise exception 'paiement futur';
exception when sqlstate 'P0001' then raise notice 'ok : paiement daté dans le futur refusé'; end $$;
select public.finance_marquer_alertes_lues() \g /dev/null
select pg_temp.verifier((public.finance_alertes()->>'non_lues')::int = 0, 'alertes marquées comme lues');
reset role;
update public.inscriptions set nouveau = false where id = :'ins_a';
set role authenticated;
select pg_temp.verifier((pg_temp.situation()->>'total_du')::int = 200000 and (pg_temp.situation()->'lignes'->0->>'montant')::int = 20000, 'ancien élève : pension 200 000, inscription 20 000');

-- annulation : le caissier annule ses propres encaissements récents ; pas ceux de l'administration
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
insert into public.paiements (inscription_id, montant) values (:'ins_a', 1000) returning id as pay_admin \gset
select set_config('request.jwt.claim.sub', :'cpt', false) \g /dev/null
delete from public.paiements where id = :'pay_admin';
select pg_temp.verifier((select count(*) from public.paiements where id = :'pay_admin') = 1, 'le caissier ne peut pas annuler l''encaissement d''un autre');
insert into public.paiements (inscription_id, montant) values (:'ins_a', 500) returning id as pay_cpt \gset
delete from public.paiements where id = :'pay_cpt';
select pg_temp.verifier((select count(*) from public.paiements where id = :'pay_cpt') = 0, 'le caissier annule son propre encaissement récent');
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
delete from public.paiements where id = :'pay_admin';
select pg_temp.verifier((select count(*) from public.paiements where id = :'pay_admin') = 0, 'l''administration annule un encaissement');
insert into public.eleves (matricule, nom, sexe) values ('FIN1', 'NANA', 'F') returning id as el_fin \gset
insert into public.inscriptions (exercice_id, classe_id, eleve_id) values (:'ex_a', :'classe_a', :'el_fin') returning id as ins_fin \gset
insert into public.paiements (inscription_id, montant) values (:'ins_fin', 10000) \g /dev/null
select set_config('app.ins_fin', :'ins_fin', false) \g /dev/null
do $$ begin delete from public.inscriptions where id = current_setting('app.ins_fin')::uuid; raise exception 'inscription payée effacée';
exception when foreign_key_violation then raise notice 'ok : une inscription qui porte des paiements ne peut pas être effacée'; end $$;
reset role;
