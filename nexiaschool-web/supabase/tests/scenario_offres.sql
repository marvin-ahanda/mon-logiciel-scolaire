-- Offres d'abonnement : fonctions avancées réservées, plafonds, échéance, attribution par le propriétaire de la plateforme
reset role;
-- les établissements des scénarios précédents sont en Premium ; un nouvel établissement démarre en Découverte
alter table public.etablissements alter column offre set default 'decouverte';
insert into auth.users (id, email) values ('28282828-2828-4828-8828-282828282828', 'fondateur.offres@gmail.com');
\set admin_o 28282828-2828-4828-8828-282828282828
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "google"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_o', false) \g /dev/null
select public.creer_etablissement_google('École des offres', 'Bertoua', '', '', '', '', 'Biya', 'Anne') \g /dev/null
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
select public.etab_courant() as etab_o \gset
select pg_temp.verifier((select offre from public.etablissements where id = public.etab_courant()) = 'decouverte',
  'offres : un nouvel établissement démarre avec l''offre Découverte');
select pg_temp.verifier(not public.offre_inclut('finances') and not public.offre_inclut('smarteval') and not public.offre_inclut('ia'),
  'offres : Découverte sans finances, SmartEval ni IA');
select pg_temp.verifier(public.offre_requise('edt') = 'pro' and public.offre_requise('ia') = 'premium' and public.offre_requise('qr') = 'essentiel',
  'offres : offre minimale de chaque fonction');

do $$ begin perform public.discipline_enregistrer_seuils(10, '[]'); raise exception 'ÉCHEC : seuils en Découverte';
exception when sqlstate 'P0001' then
  if sqlerrm like 'ÉCHEC%' or sqlerrm not like 'Pour bénéficier de cette fonctionnalité, veuillez passer à une offre supérieure%' then raise; end if;
  raise notice 'ok : offres : discipline avancée refusée en Découverte — %', sqlerrm; end $$;
do $$ begin perform public.definir_ia_personnelle(true); raise exception 'ÉCHEC : IA en Découverte';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : offres : IA et API refusées hors Premium'; end $$;
do $$ begin update public.etablissements set offre = 'premium' where id = public.etab_courant(); raise exception 'ÉCHEC : offre changée par l''établissement';
exception when insufficient_privilege then raise notice 'ok : offres : l''établissement ne change pas lui-même son offre'; end $$;
do $$ begin perform public.console_definir_offre(public.etab_courant(), 'premium', 'annuel', null); raise exception 'ÉCHEC : offre attribuée par l''établissement';
exception when insufficient_privilege then raise notice 'ok : offres : attribution réservée au propriétaire de la plateforme'; end $$;

-- plafond de 50 élèves
insert into public.eleves (matricule, nom, prenom, sexe) select 'O' || g, 'Élève', 'N' || g, 'M' from generate_series(1, 50) g;
select pg_temp.verifier((select count(*) from public.eleves) = 50, 'offres : 50 élèves en Découverte');
do $$ begin insert into public.eleves (matricule, nom, prenom, sexe) values ('O51', 'Élève', 'N51', 'F'); raise exception 'ÉCHEC : 51e élève';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : offres : 51e élève refusé — %', sqlerrm; end $$;
-- plafond de 10 comptes du personnel
select public.creer_personnel('Agent', 'N' || g, 'enseignant', '', '') from generate_series(1, 9) g \g /dev/null
select pg_temp.verifier((select count(*) from public.personnels) = 10, 'offres : 10 comptes du personnel en Découverte');
do $$ begin perform public.creer_personnel('Agent', 'N10', 'enseignant', '', ''); raise exception 'ÉCHEC : 11e compte';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : offres : 11e compte du personnel refusé'; end $$;
-- l'appel du jour reste disponible (absences)
select pg_temp.verifier(public.offre_inclut('discipline') = false, 'offres : appel du jour sans offre payante, discipline avancée réservée');

-- le propriétaire de la plateforme attribue l'offre Essentiel (payée à l'année)
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select pg_temp.verifier(public.est_proprietaire(), 'offres : propriétaire de la plateforme connecté');
select public.console_definir_offre(:'etab_o', 'essentiel', 'annuel', now() + interval '1 year') \g /dev/null
select pg_temp.verifier(exists (select 1 from json_array_elements(public.console_offres()) o where o->>'offre' = 'essentiel' and o->>'periodicite' = 'annuel'
  and o->>'effective' = 'essentiel'), 'offres : console — offre Essentiel annuelle attribuée');
select set_config('request.jwt.claim.sub', :'admin_o', false) \g /dev/null
select public.discipline_enregistrer_seuils(10, '[]') \g /dev/null
select pg_temp.verifier(public.offre_inclut('finances') and public.offre_inclut('qr') and not public.offre_inclut('smarteval'),
  'offres : Essentiel ouvre discipline, finances et QR, pas SmartEval');
insert into public.eleves (matricule, nom, prenom, sexe) values ('O51', 'Élève', 'N51', 'F');
select public.creer_personnel('Agent', 'N10', 'enseignant', '', '') \g /dev/null
select pg_temp.verifier((select count(*) from public.eleves) = 51 and (select count(*) from public.personnels) = 11,
  'offres : Essentiel lève les plafonds de Découverte');

-- offre échue : retour aux droits de Découverte, données conservées
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.console_definir_offre(:'etab_o', 'pro', 'mensuel', now() - interval '1 day') \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_o', false) \g /dev/null
select pg_temp.verifier(not public.offre_inclut('discipline') and (select count(*) from public.seuils_discipline) = 1,
  'offres : offre échue → droits de Découverte, données conservées');
do $$ begin perform public.discipline_enregistrer_seuils(12, '[]'); raise exception 'ÉCHEC : modification après échéance';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : offres : plus de modification après l''échéance'; end $$;

-- Premium : IA et API
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.console_definir_offre(:'etab_o', 'premium', 'mensuel', now() + interval '1 month') \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_o', false) \g /dev/null
select pg_temp.verifier(public.definir_ia_personnelle(true) and public.offre_inclut('ia') and public.offre_inclut('edt'),
  'offres : Premium ouvre l''IA, l''API et l''emploi du temps');
reset role;
