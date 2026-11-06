-- Import du fichier Excel complet d'un établissement (sections, classes, matières, personnel, programme, élèves)
reset role;
insert into auth.users (id, email) values ('44444444-4444-4444-4444-444444444444', 'fondateur.c@gmail.com');
\set admin_c 44444444-4444-4444-4444-444444444444
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "google"}}', false),
       set_config('request.jwt.claim.sub', :'admin_c', false) \g /dev/null
select public.creer_etablissement_google('Collège Import', 'Bafoussam', '', '', '', '', 'Tchoua', 'Henri') \g /dev/null

create or replace function pg_temp.fichier(annee text, classe_eleve text) returns jsonb language sql as $$
  select jsonb_build_object('annee', annee,
    'sections', '[{"libelle": "Francophone", "ordre": 1}, {"libelle": "Anglophone", "ordre": 2}]'::jsonb,
    'classes', '[{"libelle": "6e A", "niveau": "6e", "section": "francophone", "cycle": 1, "ordre": 1},
                 {"libelle": "Form 1", "niveau": "Form 1", "section": "Anglophone", "cycle": 1, "ordre": 2}]'::jsonb,
    'matieres', '[{"code": "math", "libelle": "Mathématiques"}, {"code": "FR", "libelle": "Français"}, {"code": "ENG", "libelle": "English"}]'::jsonb,
    'personnels', '[{"nom": "Kamga", "prenom": "Joël", "role": "enseignant", "matricule": "P01", "telephone": "699"},
                    {"nom": "Ndi", "prenom": "Grace", "role": "comptable"}, {"nom": "Tchoua", "prenom": "Henri", "role": "enseignant"}]'::jsonb,
    'programme', '[{"classe": "6e A", "matiere": "MATH", "coefficient": 4, "groupe": 1, "enseignant": "P01"},
                   {"classe": "6E a", "matiere": "fr", "coefficient": 3, "groupe": 1, "enseignant": "TCHOUA Henri"},
                   {"classe": "Form 1", "matiere": "ENG", "coefficient": 5, "groupe": 2}]'::jsonb,
    'eleves', jsonb_build_array(
       jsonb_build_object('matricule', 'C001', 'nom', 'Abena', 'prenom', 'Lucie', 'sexe', 'F', 'date_naissance', '2014-02-14',
                          'telephone_parent', '677 00 00 00', 'classe', classe_eleve, 'redoublant', true, 'nouveau', false),
       jsonb_build_object('matricule', 'C002', 'nom', 'Smith', 'prenom', 'John', 'sexe', 'M', 'classe', 'Form 1')))
$$;

select set_config('request.jwt.claim.sub', :'surv_a', false) \g /dev/null
do $$ begin perform public.importer_ecole(pg_temp.fichier('2026-2027', '6e A')); raise exception 'import par un surveillant';
exception when insufficient_privilege then raise notice 'ok : import complet réservé à l''administration'; end $$;

select set_config('request.jwt.claim.sub', :'admin_c', false) \g /dev/null
do $$ begin perform public.importer_ecole(pg_temp.fichier('', '6e A')); raise exception 'import sans année';
exception when sqlstate 'P0001' then raise notice 'ok : sans année active, l''année scolaire est demandée'; end $$;
do $$ begin perform public.importer_ecole(pg_temp.fichier('2026-2027', '5e Z')); raise exception 'classe inconnue acceptée';
exception when sqlstate 'P0001' then raise notice 'ok : classe inconnue refusée'; end $$;
select pg_temp.verifier((select count(*) from public.classes) = 0 and (select count(*) from public.personnels) = 1
  and (select count(*) from public.exercices) = 0, 'import refusé : rien n''est enregistré (tout ou rien)');

select public.importer_ecole(pg_temp.fichier('2026-2027', '6e A')) as r \gset
select set_config('app.r', :'r', false) \g /dev/null
select pg_temp.verifier((current_setting('app.r')::json->>'annee_creee')::boolean
  and (select count(*) from public.sequences s join public.exercices e on e.id = s.exercice_id where e.actif) = 6,
  'année 2026-2027 créée, activée, avec ses six séquences');
select pg_temp.verifier((select count(*) from public.sections) = 2 and (select count(*) from public.classes where section_id is not null and cycle = 1) = 2,
  'sections et classes créées, rattachées à leur section et à leur cycle');
select pg_temp.verifier((select string_agg(code, ',' order by code) from public.matieres) = 'ENG,FR,MATH', 'matières créées (codes en majuscules)');
select pg_temp.verifier((current_setting('app.r')::json->'personnels'->>'crees')::int = 2 and (current_setting('app.r')::json->'personnels'->>'existants')::int = 1
  and json_array_length(current_setting('app.r')::json->'codes') = 2
  and (select role from public.personnels where nom = 'NDI') = 'comptable'
  and (select role from public.personnels where nom = 'TCHOUA') = 'admin',
  'personnel : 2 créés avec un code, le fondateur reconnu et laissé administrateur');
select pg_temp.verifier((select count(*) from public.attributions a join public.personnels p on p.id = a.enseignant_id
                          where (p.nom = 'KAMGA' and a.coefficient = 4) or (p.nom = 'TCHOUA' and a.coefficient = 3)) = 2
  and (select groupe from public.attributions a join public.matieres m on m.id = a.matiere_id where m.code = 'ENG') = 2,
  'matières par classe : coefficients, groupes et enseignants (matricule ou nom) enregistrés');
select pg_temp.verifier((select count(*) from public.inscriptions i join public.eleves e on e.id = i.eleve_id
                          where e.matricule = 'C001' and i.redoublant and not i.nouveau) = 1
  and (select telephone_parent from public.eleves where matricule = 'C001') = '677 00 00 00'
  and (select count(*) from public.inscriptions) = 2, 'élèves inscrits dans leur classe (redoublant, ancien, contact du parent)');

-- Le nouveau personnel peut se connecter avec le code renvoyé
select (public.ouvrir_etablissement('Collège Import', (public.nouveau_code_etablissement()->>'code'))->>'jeton') as jeton_c \gset
select (select id from public.personnels where nom = 'KAMGA') as kamga \gset
select pg_temp.verifier((public.connexion_personnel(:'jeton_c', :'kamga'::uuid,
  (select c->>'code' from json_array_elements(current_setting('app.r')::json->'codes') c where c->>'nom' = 'KAMGA Joël'))->>'erreur') is null,
  'un membre importé se connecte avec le code affiché');

-- Réimport du même fichier : mise à jour, aucun doublon, aucun nouveau code
select set_config('request.jwt.claim.sub', :'admin_c', false) \g /dev/null
select public.importer_ecole(pg_temp.fichier('2027-2028', '6e A')) as r2 \gset
select set_config('app.r2', :'r2', false) \g /dev/null
select pg_temp.verifier((current_setting('app.r2')::json->'eleves'->>'modifies')::int = 2 and json_array_length(current_setting('app.r2')::json->'codes') = 0
  and (select count(*) from public.classes) = 2 and (select count(*) from public.personnels) = 3 and (select count(*) from public.exercices) = 1,
  'réimport : tout est mis à jour, sans doublon ni nouvelle année');

-- Un enseignant inconnu bloque tout l'import
do $$ begin perform public.importer_ecole(jsonb_build_object('programme', '[{"classe": "6e A", "matiere": "MATH", "coefficient": 2, "enseignant": "Inconnu"}]'::jsonb));
  raise exception 'enseignant inconnu accepté';
exception when sqlstate 'P0001' then raise notice 'ok : enseignant introuvable refusé'; end $$;

-- Isolation : un autre établissement ne voit rien de cet import
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.classes where libelle = 'Form 1') = 0, 'les données importées restent dans leur établissement');
reset role;
