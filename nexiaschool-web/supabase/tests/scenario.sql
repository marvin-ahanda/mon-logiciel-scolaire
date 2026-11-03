-- Scénario de bout en bout (psql) : chaque vérification lève une exception si elle échoue.
\set ON_ERROR_STOP 1
\set QUIET 1
create or replace function pg_temp.verifier(cond boolean, message text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'ÉCHEC : %', message; end if; raise notice 'ok : %', message; end $$;

-- Visiteur anonyme : inscription de deux établissements
set role anon;
select (r->>'code_etablissement') as code_a, (r->>'code_personnel') as code_admin_a
  from (select public.inscrire_etablissement('Collège Saint-Joseph', 'Yaoundé', 'Mballa', 'Paul') r) x \gset
select (r->>'code_etablissement') as code_b, (r->>'code_personnel') as code_admin_b
  from (select public.inscrire_etablissement('Lycée de Bonabéri', 'Douala', 'Ngo', 'Marie') r) x \gset
select pg_temp.verifier(:'code_a' ~ '^[a-hjkmnp-z0-9]{8}$', 'code établissement de 8 caractères');
select pg_temp.verifier(:'code_admin_a' ~ '^[a-hjkmnp-z0-9]{6}$', 'code personnel de 6 caractères');
do $$ begin perform public.inscrire_etablissement('college saint joseph', '', 'X', ''); raise exception 'doublon accepté';
exception when sqlstate 'P0001' then raise notice 'ok : nom en double refusé'; end $$;

-- Un anonyme ne lit rien directement
do $$ begin perform * from public.etablissements; raise exception 'lecture anonyme permise';
exception when insufficient_privilege then raise notice 'ok : tables fermées aux anonymes'; end $$;

-- Étape 1 : nom + code
select pg_temp.verifier((public.ouvrir_etablissement('Collège Saint-Joseph', 'mauvais0')->>'erreur') is not null, 'mauvais code refusé');
select (public.ouvrir_etablissement('college  saint-joseph', upper(:'code_a'))->>'jeton') as jeton_a \gset
select pg_temp.verifier(length(:'jeton_a') = 64, 'jeton appareil remis (accents, casse ignorés)');
select (public.ouvrir_etablissement('Lycée de Bonabéri', :'code_b')->>'jeton') as jeton_b \gset

-- Étape 2 : liste du personnel limitée à l'établissement
select public.personnels_etablissement(:'jeton_a') as liste_a \gset
select pg_temp.verifier(json_array_length((:'liste_a'::json)->'personnels') = 1
       and (:'liste_a'::json)->'personnels'->0->>'nom' = 'MBALLA Paul', 'liste du personnel de A seulement');
select (:'liste_a'::json)->'personnels'->0->>'id' as admin_a \gset
select (public.personnels_etablissement(:'jeton_b')::json)->'personnels'->0->>'id' as admin_b \gset
select pg_temp.verifier((public.personnels_etablissement('faux')->>'erreur') = 'jeton', 'jeton inconnu refusé');

-- Connexion : code d'un autre établissement, mauvais code, bon code
select pg_temp.verifier((public.connexion_personnel(:'jeton_a', :'admin_b'::uuid, :'code_admin_b')->>'erreur') is not null,
       'personnel d''un autre établissement refusé');
select pg_temp.verifier((public.connexion_personnel(:'jeton_a', :'admin_a'::uuid, 'zzzzz9')->>'erreur') like 'Code incorrect%', 'mauvais code personnel');
select public.connexion_personnel(:'jeton_a', :'admin_a'::uuid, :'code_admin_a') as cx \gset
reset role;
select pg_temp.verifier(extensions.crypt((:'cx'::json)->>'secret', encrypted_password) = encrypted_password,
       'mot de passe de session posé sur le compte Auth') from auth.users where id = :'admin_a';

-- Blocage après 5 essais
set role anon;
select public.connexion_personnel(:'jeton_b', :'admin_b'::uuid, 'zzzzz9') from generate_series(1, 5) \g /dev/null
select pg_temp.verifier((public.connexion_personnel(:'jeton_b', :'admin_b'::uuid, :'code_admin_b')->>'erreur') like '%bloqué%',
       'blocage après 5 essais, même avec le bon code');

-- Administrateur A connecté
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select pg_temp.verifier(public.est_admin(), 'A est administrateur');
insert into public.exercices (libelle, actif) values ('2026-2027', true) returning id as ex_a \gset
select pg_temp.verifier((select count(*) from public.sequences where exercice_id = :'ex_a') = 6, 'six séquences créées');
insert into public.classes (libelle, niveau) values ('6e A', '6e') returning id as classe_a \gset
insert into public.matieres (code, libelle) values ('MATH', 'Mathématiques') returning id as math_a \gset
select (public.creer_personnel('Essomba', 'Carine', 'enseignant', 'E1', '')->>'id') as prof_a \gset
insert into public.attributions (exercice_id, classe_id, matiere_id, enseignant_id, coefficient)
  values (:'ex_a', :'classe_a', :'math_a', :'prof_a', 4) returning id as attr_a \gset
insert into public.eleves (matricule, nom, sexe) values ('M1', 'Abena', 'F') returning id as eleve_a \gset
insert into public.inscriptions (exercice_id, classe_id, eleve_id) values (:'ex_a', :'classe_a', :'eleve_a') returning id as ins_a \gset
select id as seq1 from public.sequences where exercice_id = :'ex_a' and numero = 1 \gset
insert into public.notes (inscription_id, attribution_id, sequence_id, valeur) values (:'ins_a', :'attr_a', :'seq1', 14.5);
select pg_temp.verifier((select count(*) from public.personnels) = 2, 'A voit son personnel (2)');
do $$ begin perform code_hash from public.personnels; raise exception 'empreinte lisible';
exception when insufficient_privilege then raise notice 'ok : empreintes des codes illisibles'; end $$;

-- Administrateur B : ne voit rien de A, ne peut rien y écrire
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.eleves) = 0 and (select count(*) from public.notes) = 0
       and (select count(*) from public.personnels) = 1 and (select count(*) from public.etablissements) = 1, 'B ne voit rien de A');
update public.eleves set nom = 'Pirate' where id = :'eleve_a';
reset role;
select pg_temp.verifier((select nom from public.eleves where id = :'eleve_a') = 'Abena', 'B ne modifie pas les élèves de A');
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
insert into public.exercices (libelle, actif) values ('2026-2027', true) returning id as ex_b \gset
do $$ begin
  insert into public.attributions (exercice_id, classe_id, matiere_id, coefficient)
  values (current_setting('app.ex_b', true)::uuid, null, null, 1);
exception when others then raise notice 'ok : attribution incomplète refusée'; end $$;
select set_config('app.classe_a', :'classe_a', false), set_config('app.math_a', :'math_a', false), set_config('app.ex_b', :'ex_b', false) \g /dev/null
do $$ begin
  insert into public.attributions (exercice_id, classe_id, matiere_id, coefficient)
  values (current_setting('app.ex_b')::uuid, current_setting('app.classe_a')::uuid, current_setting('app.math_a')::uuid, 1);
  raise exception 'liaison entre établissements acceptée';
exception when foreign_key_violation then raise notice 'ok : impossible de relier une classe d''un autre établissement'; end $$;

-- Enseignant A : saisit ses notes, ne modifie pas la structure
reset role;
select id as prof_a_id from public.personnels where id = :'prof_a' \gset
set role authenticated;
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
update public.notes set valeur = 15 where inscription_id = :'ins_a';
select pg_temp.verifier((select valeur from public.notes where inscription_id = :'ins_a') = 15, 'l''enseignant corrige sa note');
do $$ begin
  insert into public.classes (libelle) values ('Pirate');
  raise exception 'classe créée par un enseignant';
exception when insufficient_privilege then raise notice 'ok : l''enseignant ne crée pas de classe'; end $$;
reset role;
do $$ begin
  set local role authenticated;
  perform public.creer_personnel('X', '', 'admin', '', '');
  raise exception 'enseignant crée un compte';
exception when insufficient_privilege then raise notice 'ok : seul l''administrateur crée du personnel'; end $$;

-- Verrouillage d'une séquence
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
update public.sequences set verrouillee = true where id = :'seq1';
do $$ begin
  update public.notes set valeur = 2;
  raise exception 'note modifiée dans une séquence verrouillée';
exception when sqlstate 'P0001' then raise notice 'ok : séquence verrouillée protégée'; end $$;

-- Nouveau code d'établissement : l'ancien et les jetons ne valent plus
select (public.nouveau_code_etablissement()->>'code') as nouveau_a \gset
set role anon;
select pg_temp.verifier((public.personnels_etablissement(:'jeton_a')->>'erreur') = 'jeton', 'jetons révoqués');
select pg_temp.verifier((public.ouvrir_etablissement('Collège Saint-Joseph', :'code_a')->>'erreur') is not null, 'ancien code refusé');
select pg_temp.verifier((public.ouvrir_etablissement('Collège Saint-Joseph', :'nouveau_a')->>'jeton') is not null, 'nouveau code accepté');

-- Garde-fous de l'administrateur
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select set_config('app.admin_a', :'admin_a', false) \g /dev/null
do $$ begin
  perform public.modifier_personnel(current_setting('app.admin_a')::uuid, 'MBALLA', 'Paul', 'enseignant', true, '', '');
  raise exception 'auto-rétrogradation acceptée';
exception when sqlstate 'P0001' then raise notice 'ok : un administrateur ne se retire pas ses droits'; end $$;
reset role;
\echo SCÉNARIO TERMINÉ
