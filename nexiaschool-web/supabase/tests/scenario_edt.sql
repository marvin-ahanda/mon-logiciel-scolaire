-- Emploi du temps : validation serveur des contraintes obligatoires, versions, officialisation, publication, droits et isolation
reset role; set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
insert into public.salles (nom, type) values ('Labo 1', 'Laboratoire') returning id as salle_a \gset
insert into public.classes (libelle, niveau) values ('6e EDT', '6e') returning id as classe_edt \gset
select pg_temp.verifier((select count(*) from public.salles) = 1, 'emploi du temps : l''administration déclare une salle spécialisée');

-- Configuration : 2 jours de 3 périodes (récréation entre la 2e et la 3e), 2 enseignants, 2 classes, 1 laboratoire, 1 h de permanence
select jsonb_build_object(
  'horaires', jsonb_build_object('jours', '[1,2]'::jsonb, 'debut', '07:30', 'fin', '10:30', 'duree', 55,
     'periodes', '[{"debut":"07:30","fin":"08:25"},{"debut":"08:25","fin":"09:20"},{"debut":"09:35","fin":"10:30"}]'::jsonb,
     'pauses', '[{"id":"p1","libelle":"Récréation","type":"pause","debut":"09:20","fin":"09:35","jours":[]}]'::jsonb),
  'salles', jsonb_build_array(jsonb_build_object('id', :'salle_a', 'nom', 'Labo 1', 'type', 'Laboratoire')),
  'enseignants', jsonb_build_array(
     jsonb_build_object('cle', 'e1', 'nom', 'Essomba', 'prenom', 'Carine', 'personnel_id', :'prof_a', 'jours', '[1,2]'::jsonb, 'creneaux', '[]'::jsonb),
     jsonb_build_object('cle', 'e2', 'nom', 'Bella', 'prenom', 'Ada', 'jours', '[2]'::jsonb, 'creneaux', '[]'::jsonb)),
  'affectations', jsonb_build_array(
     jsonb_build_object('id', 'a1', 'enseignant', 'e1', 'classe_id', :'classe_a', 'classe', '6e A', 'discipline', 'Mathématiques', 'matiere_id', :'math_a', 'volume', 2),
     jsonb_build_object('id', 'a2', 'enseignant', 'e1', 'classe_id', :'classe_edt', 'classe', '6e EDT', 'discipline', 'Mathématiques', 'volume', 1),
     jsonb_build_object('id', 'a3', 'enseignant', 'e2', 'classe_id', :'classe_edt', 'classe', '6e EDT', 'discipline', 'SVT', 'volume', 2)),
  'classes', jsonb_build_object(:'classe_edt', jsonb_build_object('salles', jsonb_build_object('SVT', 'Laboratoire'),
     'permanences', jsonb_build_object('heures', 1, 'jours', '[1]'::jsonb, 'debut', '', 'fin', ''))),
  'generales', '{"enseignant":{"max_jour":3,"max_consecutives":2,"disponibilites":"strictes"},"classe":{"max_jour":3,"max_consecutives":2}}'::jsonb
) as cfg \gset
select jsonb_build_array(
  jsonb_build_object('c', :'classe_a', 'j', 1, 'p', 0, 'a', 'a1', 's', null),
  jsonb_build_object('c', :'classe_a', 'j', 1, 'p', 1, 'a', 'a1', 's', null),
  jsonb_build_object('c', :'classe_edt', 'j', 2, 'p', 0, 'a', 'a2', 's', null),
  jsonb_build_object('c', :'classe_edt', 'j', 2, 'p', 1, 'a', 'a3', 's', :'salle_a'),
  jsonb_build_object('c', :'classe_edt', 'j', 2, 'p', 2, 'a', 'a3', 's', :'salle_a'),
  jsonb_build_object('c', :'classe_edt', 'j', 1, 'p', 0, 'a', null, 's', null)) as grille \gset

-- brouillon du parcours guidé
select public.edt_brouillon_enregistrer(:'ex_a', jsonb_build_object('config', :'cfg'::jsonb), 3) \g /dev/null
select pg_temp.verifier((public.edt_brouillon_lire(:'ex_a') ->> 'etape')::int = 3 and (public.edt_brouillon_lire(:'ex_a') #> '{donnees,config,affectations}') is not null,
  'emploi du temps : brouillon enregistré et relu (étape 3)');

select public.edt_enregistrer(jsonb_build_object('exercice_id', :'ex_a', 'periode', 'annee', 'nom', 'Version A', 'config', :'cfg'::jsonb,
  'grille', :'grille'::jsonb, 'bilan', '{"cout":12}'::jsonb)) ->> 'id' as edt1 \gset
select pg_temp.verifier(jsonb_array_length(public.edt_versions(:'ex_a')) = 1 and (public.edt_versions(:'ex_a') -> 0 ->> 'statut') = 'provisoire'
  and (public.edt_versions(:'ex_a') -> 0 ->> 'numero') = '1', 'emploi du temps : version valide enregistrée (n° 1, provisoire)');

-- chaque contrainte obligatoire violée est refusée par le serveur
create or replace function pg_temp.refuse(p_cfg jsonb, p_grille jsonb, p_motif text) returns void language plpgsql as $$
begin
  perform public.edt_enregistrer(jsonb_build_object('exercice_id', current_setting('app.ex_a'), 'periode', 'annee', 'nom', 'X', 'config', p_cfg, 'grille', p_grille));
  raise exception 'ÉCHEC : accepté malgré %', p_motif;
exception when sqlstate 'P0001' then
  if sqlerrm like 'ÉCHEC%' then raise; end if;
  raise notice 'ok : refusé (%) — %', p_motif, sqlerrm;
end $$;
select set_config('app.ex_a', :'ex_a', false) \g /dev/null
select pg_temp.refuse(:'cfg', jsonb_set(jsonb_set(:'grille'::jsonb, '{2,j}', '1'), '{2,p}', '1'), 'enseignant à deux endroits en même temps');
select pg_temp.refuse(:'cfg', jsonb_set(:'grille'::jsonb, '{1,c}', to_jsonb(:'classe_a'::text)) || jsonb_build_array(jsonb_build_object('c', :'classe_a', 'j', 1, 'p', 0, 'a', 'a1')), 'deux cours en même temps dans une classe');
select pg_temp.refuse(:'cfg', jsonb_set(:'grille'::jsonb, '{1,p}', '5'), 'période inexistante');
select pg_temp.refuse(jsonb_set(:'cfg'::jsonb, '{horaires,pauses}', '[{"type":"pause","debut":"08:25","fin":"09:20","jours":[1]}]'), :'grille', 'cours pendant une pause propre au lundi');
select pg_temp.refuse(:'cfg', jsonb_set(:'grille'::jsonb, '{3,j}', '1'), 'enseignant indisponible ce jour-là');
select pg_temp.refuse(:'cfg', (:'grille'::jsonb) - 4, 'volume horaire non respecté');
select pg_temp.refuse(:'cfg', (:'grille'::jsonb) - 5, 'permanence manquante');
select pg_temp.refuse(:'cfg', jsonb_set(jsonb_set(jsonb_set(:'grille'::jsonb, '{5,j}', '2'), '{2,j}', '1'), '{2,p}', '2'), 'permanence hors de ses jours');
select pg_temp.refuse(:'cfg', jsonb_set(:'grille'::jsonb, '{3,s}', 'null'), 'salle spécialisée absente');
select pg_temp.refuse(jsonb_set(:'cfg'::jsonb, '{generales,classe,max_consecutives}', '1'), :'grille', 'trop d''heures consécutives d''une même matière');
select pg_temp.refuse(jsonb_set(:'cfg'::jsonb, '{generales,enseignant,max_jour}', '1'), :'grille', 'maximum d''heures par jour de l''enseignant');
select pg_temp.refuse(jsonb_set(:'cfg'::jsonb, '{classes}', (:'cfg'::jsonb -> 'classes') || jsonb_build_object(:'classe_a', jsonb_build_object('interdits', '["1-0"]'::jsonb))), :'grille', 'créneau interdit à la classe');
select pg_temp.refuse(jsonb_set(:'cfg'::jsonb, '{affectations,0,classe_id}', to_jsonb(gen_random_uuid()::text)), :'grille', 'classe inconnue de l''établissement');
select pg_temp.refuse(jsonb_set(:'cfg'::jsonb, '{salles,0,id}', to_jsonb(gen_random_uuid()::text)), :'grille', 'salle inconnue');
select pg_temp.refuse(:'cfg', '"rien"'::jsonb, 'grille illisible');

-- versions : officialisation, publication, suppression
select public.edt_enregistrer(jsonb_build_object('exercice_id', :'ex_a', 'periode', 'annee', 'nom', 'Version B', 'config', :'cfg'::jsonb, 'grille', :'grille'::jsonb)) ->> 'numero' as num2 \gset
select pg_temp.verifier(:'num2' = '2', 'emploi du temps : nouvelle version numérotée 2 (les précédentes sont conservées)');
select public.edt_officialiser(:'edt1') \g /dev/null
select (public.edt_versions(:'ex_a') -> 0 ->> 'id') as edt2 \gset
select public.edt_officialiser(:'edt2') \g /dev/null
select pg_temp.verifier((select string_agg((x ->> 'numero') || (x ->> 'statut'), ',' order by x ->> 'numero') from jsonb_array_elements(public.edt_versions(:'ex_a')) x) = '1archive,2officiel',
  'emploi du temps : une seule version officielle par année et période, l''ancienne est archivée');
select set_config('app.edt1', :'edt1', false) \g /dev/null
do $$ begin perform public.edt_publier(current_setting('app.edt1')::uuid, true); raise exception 'publication d''une version archivée';
exception when sqlstate 'P0001' then raise notice 'ok : seule la version officielle peut être publiée'; end $$;
select public.edt_publier(:'edt2', true) \g /dev/null
select set_config('app.edt2', :'edt2', false) \g /dev/null
do $$ begin perform public.edt_supprimer(current_setting('app.edt2')::uuid); raise exception 'suppression de la version officielle';
exception when sqlstate 'P0001' then raise notice 'ok : la version officielle ne se supprime pas'; end $$;
select public.edt_renommer(:'edt1', 'Ancienne version') \g /dev/null
select pg_temp.verifier((public.edt_lire(:'edt1') ->> 'nom') = 'Ancienne version', 'emploi du temps : version renommée');

-- le personnel ne voit que la version publiée, et ne peut rien modifier
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select pg_temp.verifier(jsonb_array_length(public.edt_versions(:'ex_a')) = 1 and (public.edt_lire(:'edt2') ->> 'statut') = 'officiel',
  'emploi du temps : l''enseignant consulte la seule version publiée');
do $$ begin perform public.edt_lire(current_setting('app.edt1')::uuid); raise exception 'version non publiée lue';
exception when sqlstate 'P0001' then raise notice 'ok : version non publiée invisible pour l''enseignant'; end $$;
do $$ begin perform public.edt_enregistrer('{}'::jsonb); raise exception 'enseignant enregistre';
exception when insufficient_privilege then raise notice 'ok : seule l''administration enregistre un emploi du temps'; end $$;
do $$ begin perform public.edt_brouillon_lire(current_setting('app.ex_a')::uuid); raise exception 'enseignant lit le brouillon';
exception when insufficient_privilege then raise notice 'ok : brouillon réservé à l''administration'; end $$;
do $$ begin perform public.edt_publier(current_setting('app.edt2')::uuid, false); raise exception 'enseignant retire la publication';
exception when insufficient_privilege then raise notice 'ok : publication réservée à l''administration'; end $$;
do $$ begin insert into public.salles (nom) values ('Salle X'); raise exception 'enseignant crée une salle';
exception when insufficient_privilege then raise notice 'ok : salles gérées par l''administration'; end $$;
do $$ begin perform 1 from public.emplois_du_temps; raise exception 'lecture directe de la table';
exception when insufficient_privilege then raise notice 'ok : aucun accès direct aux emplois du temps'; end $$;
select pg_temp.verifier((select count(*) from public.salles) = 1, 'emploi du temps : le personnel lit les salles de son établissement');

-- un autre établissement ne voit et ne touche rien
reset role;
insert into auth.users (id, email) values ('27272727-2727-4727-8727-272727272727', 'fondateur.edt@gmail.com');
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "google"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', '27272727-2727-4727-8727-272727272727', false) \g /dev/null
select public.creer_etablissement_google('Collège de l''emploi du temps', 'Kribi', '', '', '', '', 'Owona', 'Eric') \g /dev/null
select pg_temp.verifier(public.est_admin(), 'emploi du temps : administrateur d''un troisième établissement');
select pg_temp.verifier(jsonb_array_length(public.edt_versions(:'ex_a')) = 0 and (select count(*) from public.salles) = 0
  and public.edt_brouillon_lire(:'ex_a') is null, 'emploi du temps : invisible pour un autre établissement');
do $$ begin perform public.edt_lire(current_setting('app.edt2')::uuid); raise exception 'lecture par un autre établissement';
exception when sqlstate 'P0001' then raise notice 'ok : version d''un autre établissement introuvable'; end $$;
do $$ begin perform public.edt_brouillon_enregistrer(current_setting('app.ex_a')::uuid, '{}'::jsonb, 1); raise exception 'brouillon sur l''année d''un autre';
exception when sqlstate 'P0001' then raise notice 'ok : année scolaire d''un autre établissement refusée'; end $$;
do $$ begin perform public.edt_officialiser(current_setting('app.edt1')::uuid); raise exception 'officialisation par un autre établissement';
exception when sqlstate 'P0001' then raise notice 'ok : versions d''un autre établissement intouchables'; end $$;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.edt_supprimer(:'edt1') \g /dev/null
select public.edt_brouillon_supprimer(:'ex_a') \g /dev/null
select pg_temp.verifier(jsonb_array_length(public.edt_versions(:'ex_a')) = 1 and public.edt_brouillon_lire(:'ex_a') is null,
  'emploi du temps : version archivée et brouillon supprimés');
reset role;
