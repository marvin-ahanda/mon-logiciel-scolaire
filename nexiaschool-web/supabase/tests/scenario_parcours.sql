-- Parcours, séries et orientation : référentiel propre à l'établissement, règles de passage, choix et demandes
-- d'orientation (parents), changement de série, décisions de passage et mentions, droits et cloisonnement
reset role; set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null

-- 1. Référentiel : cycles, niveaux, filières, séries, options
insert into public.cycles (libelle, ordre) values ('Premier cycle', 1) returning id as cy1 \gset
insert into public.cycles (libelle, ordre) values ('Second cycle', 2) returning id as cy2 \gset
insert into public.niveaux (libelle, cycle_id, ordre, fin_de_cycle) values ('3e', :'cy1', 4, true) returning id as n3 \gset
insert into public.niveaux (libelle, cycle_id, ordre) values ('2nde', :'cy2', 5) returning id as n2 \gset
insert into public.niveaux (libelle, cycle_id, ordre) values ('1re', :'cy2', 6) returning id as n1 \gset
insert into public.filieres (libelle) values ('Enseignement général') returning id as fg \gset
insert into public.series (filiere_id, code, libelle) values (:'fg', 'A4 esp', 'A4 espagnol') returning id as sa4 \gset
insert into public.series (filiere_id, code, libelle) values (:'fg', 'C', 'Série C') returning id as sc \gset
insert into public.series (filiere_id, code, libelle) values (:'fg', 'D', 'Série D') returning id as sd \gset
insert into public.options_scolaires (libelle) values ('Espagnol') \g /dev/null
insert into public.classes (libelle, niveau_id) values ('3e A', :'n3') returning id as c3a \gset
insert into public.classes (libelle, niveau_id, serie_id) values ('2nde C', :'n2', :'sc') returning id as c2c \gset
insert into public.classes (libelle, niveau_id, serie_id) values ('2nde A4', :'n2', :'sa4') returning id as c2a \gset
select pg_temp.verifier((select niveau from public.classes where id = :'c3a') = '3e', 'classe rattachée à un niveau : libellé du niveau repris');
update public.niveaux set libelle = 'Troisième' where id = :'n3';
select pg_temp.verifier((select niveau from public.classes where id = :'c3a') = 'Troisième', 'niveau renommé : classes mises à jour');
update public.niveaux set libelle = '3e' where id = :'n3';
do $$ begin insert into public.series (code, libelle) values ('C', 'Doublon'); raise exception 'code en double';
exception when unique_violation then raise notice 'ok : code de série unique dans l''établissement'; end $$;

-- 2. Règles de passage : 3e → 2nde C (sur demande, moyenne ≥ 12 en maths), 3e → 2nde A4 esp
insert into public.regles_passage (niveau_origine_id, niveau_destination_id, serie_destination_id, type, conditions, sur_demande, classes_destination, mention)
values (:'n3', :'n2', :'sc', 'changement_cycle', '{"moyenne_min": 10, "matieres": [{"code": "MATH", "min": 12}]}', true, array[:'c2c'::uuid], ''),
       (:'n3', :'n2', :'sa4', 'changement_cycle', '{"moyenne_min": 10}', false, '{}', 'Promu(e) en {destination}');
select pg_temp.verifier((select count(*) from public.regles_passage) = 2, 'règles de passage enregistrées (conditions, classes de destination, mention)');

-- 3. Le personnel lit le référentiel mais ne le modifie pas
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.series) = 3, 'enseignant : lit les séries');
do $$ begin insert into public.series (code, libelle) values ('X', 'X'); raise exception 'enseignant crée une série';
exception when insufficient_privilege then raise notice 'ok : seule l''administration modifie le référentiel'; end $$;
select pg_temp.verifier((select count(*) from public.orientations) = 0, 'enseignant : orientations invisibles');

-- 4. Choix de série par l'administration, demande d'un parent, réponse
reset role;
insert into public.inscriptions (etablissement_id, exercice_id, classe_id, eleve_id)
  select etablissement_id, :'ex_a', :'c3a', id from public.eleves where matricule = 'M2' and etablissement_id = (select etablissement_id from public.personnels where id = :'admin_a')
  on conflict (exercice_id, eleve_id) do update set classe_id = excluded.classe_id returning id as ins3 \gset
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.orientation_enregistrer(jsonb_build_object('inscription_id', :'ins3', 'type', 'choix_serie', 'niveau_id', :'n2', 'serie_id', :'sc')) \g /dev/null
select public.orientation_enregistrer(jsonb_build_object('inscription_id', :'ins3', 'type', 'choix_serie', 'niveau_id', :'n2', 'serie_id', :'sa4')) \g /dev/null
select pg_temp.verifier((select count(*) from public.orientations where inscription_id = :'ins3' and statut = 'acceptee') = 1
  and (select count(*) from public.orientations where inscription_id = :'ins3' and statut = 'remplacee') = 1, 'nouveau choix de série : l''ancien est remplacé, l''historique conservé');
do $$ begin perform public.orientation_enregistrer(jsonb_build_object('inscription_id', current_setting('app.ins_a', true), 'serie_id', gen_random_uuid())); raise exception 'série inconnue';
exception when sqlstate 'P0001' then raise notice 'ok : série d''un autre établissement refusée'; end $$;
-- parent de l'élève M2 (BELLA) : connexion, destinations possibles, demande
select (public.nouveau_code_etablissement()->>'code') as code_o \gset
select nom || ' ' || prenom as nom_m2 from public.eleves where matricule = 'M2' and etablissement_id = (select etablissement_id from public.personnels where id = :'admin_a') \gset
reset role; set role anon;
select set_config('request.jwt.claim.sub', '', false) \g /dev/null
select (public.ouvrir_etablissement('Collège Saint-Joseph', :'code_o')->>'jeton') as jeton_o \gset
select (public.parent_connexion(:'jeton_o', :'nom_m2', 'M2')->>'jeton') as sp_o \gset
select public.parent_orientation(:'sp_o') as po \gset
select set_config('app.po', :'po', false) \g /dev/null
select pg_temp.verifier((current_setting('app.po')::jsonb->>'niveau') = '3e' and jsonb_array_length(current_setting('app.po')::jsonb->'destinations') = 2,
  'parent : niveau actuel et 2 destinations possibles (2nde C, 2nde A4 esp)');
select set_config('app.sp_o', :'sp_o', false) \g /dev/null
do $$ begin perform public.parent_demander_orientation(current_setting('app.sp_o'), '{"parent_nom":"Bella Paul","motif":"court"}'::jsonb); raise exception 'demande incomplète';
exception when sqlstate 'P0001' then raise notice 'ok : demande incomplète refusée'; end $$;
select public.parent_demander_orientation(:'sp_o', jsonb_build_object('parent_nom', 'Bella Paul', 'serie_id', :'sc', 'niveau_id', :'n2',
  'motif', 'Notre fille souhaite suivre la série scientifique C.')) ->> 'id' as dem \gset
do $$ begin perform public.parent_demander_orientation(current_setting('app.sp_o'), jsonb_build_object('parent_nom', 'Bella Paul', 'niveau_id', gen_random_uuid(), 'motif', 'Deuxième demande en attente')); raise exception 'deux demandes';
exception when sqlstate 'P0001' then raise notice 'ok : une seule demande en attente à la fois'; end $$;
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select pg_temp.verifier(public.orientations_en_attente() = 1, 'administration : 1 demande d''orientation en attente (bulle)');
select set_config('app.dem', :'dem', false) \g /dev/null
do $$ begin perform public.orientation_decider(current_setting('app.dem')::uuid, false, ''); raise exception 'refus sans explication';
exception when sqlstate 'P0001' then raise notice 'ok : un refus doit être expliqué aux parents'; end $$;
select public.orientation_decider(:'dem', true, 'Accordé : résultats en mathématiques satisfaisants.') \g /dev/null
select pg_temp.verifier((select serie_id from public.orientations where inscription_id = :'ins3' and statut = 'acceptee') = :'sc'::uuid,
  'demande acceptée : elle remplace le choix précédent');
reset role; set role anon;
select pg_temp.verifier((public.parent_orientation(:'sp_o')->'demandes'->0->>'statut') = 'acceptee'
  and (public.parent_orientation(:'sp_o')->'demandes'->0->>'reponse') like 'Accordé%', 'parent : voit la réponse de l''établissement');
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null

-- 5. Changement de série en cours d'année
reset role;
insert into public.eleves (etablissement_id, matricule, nom, sexe) select etablissement_id, 'P9', 'NOAH', 'M' from public.personnels where id = :'admin_a' returning id as el9 \gset
insert into public.inscriptions (etablissement_id, exercice_id, classe_id, eleve_id)
  select etablissement_id, :'ex_a', :'c2a', :'el9' from public.personnels where id = :'admin_a' returning id as ins2 \gset
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select (public.orientation_enregistrer(jsonb_build_object('inscription_id', :'ins2', 'type', 'changement_serie', 'serie_id', :'sc', 'classe_id', :'c2c', 'motif', 'Réorientation scientifique'))->>'id') as chg \gset
select public.orientation_appliquer(:'chg') \g /dev/null
select pg_temp.verifier((select classe_id from public.inscriptions where id = :'ins2') = :'c2c'::uuid, 'changement de série appliqué : élève passé en 2nde C');
select set_config('app.chg', :'chg', false) \g /dev/null
do $$ begin perform public.orientation_appliquer(current_setting('app.chg')::uuid); raise exception 'appliqué deux fois';
exception when sqlstate 'P0001' then raise notice 'ok : un changement n''est appliqué qu''une fois'; end $$;

-- 6. Décisions de passage et mention officielle
select pg_temp.verifier(public.decisions_passage_enregistrer(jsonb_build_array(
  jsonb_build_object('inscription_id', :'ins3', 'decision', 'change_cycle', 'niveau_destination_id', :'n2', 'serie_destination_id', :'sc', 'classe_destination_id', :'c2c',
                     'mention', 'Promu(e) en 2nde C'),
  jsonb_build_object('inscription_id', :'ins_a', 'decision', 'redoublant', 'mention', 'Redoublant(e)'))) = 2, 'décisions de passage enregistrées (provisoires)');
select public.decisions_passage_enregistrer(jsonb_build_array(jsonb_build_object('inscription_id', :'ins3', 'decision', 'change_cycle', 'niveau_destination_id', :'n2',
  'serie_destination_id', :'sc', 'mention', 'Promu(e) en 2nde C')), true) \g /dev/null
select pg_temp.verifier((select statut from public.decisions_passage where inscription_id = :'ins3') = 'validee'
  and (select mention from public.decisions_passage where inscription_id = :'ins3') = 'Promu(e) en 2nde C', 'décision validée : mention « Promu(e) en 2nde C »');
do $$ begin perform public.decisions_passage_enregistrer('[{"inscription_id":"00000000-0000-0000-0000-000000000000","decision":"inconnue"}]'::jsonb); raise notice 'ok : élève inconnu ignoré';
end $$;
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.decisions_passage) = 2, 'le personnel lit les mentions (bulletins)');
do $$ begin perform public.decisions_passage_enregistrer('[]'::jsonb); raise exception 'enseignant décide';
exception when insufficient_privilege then raise notice 'ok : seule l''administration fixe les décisions de passage'; end $$;
select pg_temp.verifier((select count(*) from public.parcours_journal) = 0, 'enseignant : journal invisible');

-- 7. Cloisonnement
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.series) = 0 and (select count(*) from public.regles_passage) = 0 and (select count(*) from public.orientations) = 0
  and (select count(*) from public.decisions_passage) = 0, 'parcours invisibles pour un autre établissement');
reset role;
