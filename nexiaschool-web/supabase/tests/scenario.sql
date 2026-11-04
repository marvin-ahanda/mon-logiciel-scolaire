-- Scénario de bout en bout (psql) : chaque vérification lève une exception si elle échoue.
\set ON_ERROR_STOP 1
\set QUIET 1
create or replace function pg_temp.verifier(cond boolean, message text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'ÉCHEC : %', message; end if; raise notice 'ok : %', message; end $$;

-- Deux fondateurs connectés avec Google créent leur établissement
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'fondateur.a@gmail.com'),
                                          ('22222222-2222-2222-2222-222222222222', 'fondateur.b@gmail.com'),
                                          ('33333333-3333-3333-3333-333333333333', 'pirate@example.com');
\set admin_a 11111111-1111-1111-1111-111111111111
\set admin_b 22222222-2222-2222-2222-222222222222
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false),
       set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
do $$ begin perform public.creer_etablissement_google('Faux', '', '', '', '', '', 'X', ''); raise exception 'création sans Google';
exception when insufficient_privilege then raise notice 'ok : création réservée aux comptes Google'; end $$;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "google"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.creer_etablissement_google('Collège Saint-Joseph', 'Yaoundé', 'BP 12', '+237 600', 'Travail', 'M. le Principal', 'Mballa', 'Paul')->>'code_etablissement' as code_a \gset
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
select public.creer_etablissement_google('Lycée de Bonabéri', 'Douala', '', '', '', '', 'Ngo', 'Marie')->>'code_etablissement' as code_b \gset
do $$ begin perform public.creer_etablissement_google('Autre école', '', '', '', '', '', 'Ngo', ''); raise exception 'deux établissements';
exception when sqlstate 'P0001' then raise notice 'ok : un compte Google = un établissement'; end $$;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false) \g /dev/null
do $$ begin perform public.creer_etablissement_google('college saint joseph', '', '', '', '', '', 'X', ''); raise exception 'doublon accepté';
exception when sqlstate 'P0001' then raise notice 'ok : nom en double refusé'; end $$;
reset role;
select pg_temp.verifier(:'code_a' ~ '^[a-hjkmnp-z0-9]{8}$', 'code établissement de 8 caractères');
-- Chaque fondateur crée un compte à code pour tester la connexion par code
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select (r->>'id') as code_user_a, (r->>'code') as code_admin_a from (select public.creer_personnel('Abena', 'Rose', 'admin', '', '') r) x \gset
select pg_temp.verifier(:'code_admin_a' ~ '^[a-hjkmnp-z0-9]{6}$', 'code personnel de 6 caractères');
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
select (r->>'id') as code_user_b, (r->>'code') as code_admin_b from (select public.creer_personnel('Fouda', 'Luc', 'admin', '', '') r) x \gset
reset role;
set role anon;

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
       and (:'liste_a'::json)->'personnels'->0->>'nom' = 'ABENA Rose', 'liste de A seulement, sans le fondateur Google');
select pg_temp.verifier((public.personnels_etablissement('faux')->>'erreur') = 'jeton', 'jeton inconnu refusé');

-- Connexion : code d'un autre établissement, mauvais code, bon code
select pg_temp.verifier((public.connexion_personnel(:'jeton_a', :'code_user_b'::uuid, :'code_admin_b')->>'erreur') is not null,
       'personnel d''un autre établissement refusé');
select pg_temp.verifier((public.connexion_personnel(:'jeton_a', :'code_user_a'::uuid, 'zzzzz9')->>'erreur') like 'Code incorrect%', 'mauvais code personnel');
select pg_temp.verifier((public.connexion_personnel(:'jeton_a', :'admin_a'::uuid, 'x')->>'erreur') is not null, 'le fondateur Google ne se connecte pas par code');
select public.connexion_personnel(:'jeton_a', :'code_user_a'::uuid, :'code_admin_a') as cx \gset
reset role;
select pg_temp.verifier(extensions.crypt((:'cx'::json)->>'secret', encrypted_password) = encrypted_password,
       'mot de passe de session posé sur le compte Auth') from auth.users where id = :'code_user_a';

-- Blocage après 5 essais
set role anon;
select public.connexion_personnel(:'jeton_b', :'code_user_b'::uuid, 'zzzzz9') from generate_series(1, 5) \g /dev/null
select pg_temp.verifier((public.connexion_personnel(:'jeton_b', :'code_user_b'::uuid, :'code_admin_b')->>'erreur') like '%bloqué%',
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
select pg_temp.verifier((select count(*) from public.personnels) = 3, 'A voit son personnel (3)');
do $$ begin perform code_hash from public.personnels; raise exception 'empreinte lisible';
exception when insufficient_privilege then raise notice 'ok : empreintes des codes illisibles'; end $$;

-- Administrateur B : ne voit rien de A, ne peut rien y écrire
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.eleves) = 0 and (select count(*) from public.notes) = 0
       and (select count(*) from public.personnels) = 2 and (select count(*) from public.etablissements) = 1, 'B ne voit rien de A');
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

-- Discipline : surveillant général
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select (public.creer_personnel('Yombi', 'Marc', 'surveillant', '', '')->>'id') as surv_a \gset
insert into public.sanctions (libelle, points_perdus) values ('Avertissement', 1) returning id as sanc_a \gset
insert into public.infractions (libelle, sanction_id) values ('Bavardage', :'sanc_a') returning id as inf_a \gset
select pg_temp.verifier((select count(*) from public.parametres_discipline where exercice_id = :'ex_a') = 1, 'barème créé avec l''exercice');
select set_config('request.jwt.claim.sub', :'surv_a', false) \g /dev/null
insert into public.absences (inscription_id, sequence_id, date, heures_non_justifiees, heures_justifiees) values (:'ins_a', :'seq1', '2026-10-05', 3, 1);
insert into public.retards (inscription_id, sequence_id, date) values (:'ins_a', :'seq1', '2026-10-05');
insert into public.incidents (inscription_id, sequence_id, date, infraction_id) values (:'ins_a', :'seq1', '2026-10-06', :'inf_a');
select pg_temp.verifier((select count(*) from public.absences) = 1 and (select count(*) from public.incidents) = 1, 'le surveillant saisit l''appel et les infractions');
do $$ begin insert into public.sanctions (libelle) values ('Pirate'); raise exception 'sanction créée par le surveillant';
exception when insufficient_privilege then raise notice 'ok : le barème reste à l''administration'; end $$;
do $$ begin insert into public.notes (inscription_id, attribution_id, sequence_id, valeur)
  select inscription_id, attribution_id, sequence_id, 1 from public.notes limit 1; raise exception 'note saisie par le surveillant';
exception when insufficient_privilege or unique_violation then raise notice 'ok : le surveillant ne saisit pas de notes'; end $$;
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.absences) = 1, 'l''enseignant lit la discipline (bulletins)');
do $$ begin insert into public.retards (inscription_id, sequence_id, date) select inscription_id, sequence_id, '2026-10-07' from public.absences limit 1;
  raise exception 'retard saisi par un enseignant';
exception when insufficient_privilege then raise notice 'ok : l''enseignant ne saisit pas la discipline'; end $$;
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.absences) = 0, 'B ne voit pas la discipline de A');

-- Import Excel des élèves (administration, tout ou rien)
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.importer_eleves(format('[{"matricule":"M1","nom":"abena","prenom":"Lucie","sexe":"F","classe_id":"%s"},
  {"matricule":"M2","nom":"Bella","sexe":"M","date_naissance":"2014-03-01","classe_id":"%s"}]', :'classe_a', :'classe_a')::jsonb) as imp \gset
select pg_temp.verifier((:'imp'::json->>'crees')::int = 1 and (:'imp'::json->>'modifies')::int = 1, 'import : 1 création, 1 mise à jour');
select pg_temp.verifier((select prenom from public.eleves where matricule = 'M1') = 'Lucie', 'import : élève existant mis à jour');
select pg_temp.verifier((select count(*) from public.inscriptions) = 2, 'import : inscription dans la classe');
do $$ begin perform public.importer_eleves('[{"matricule":"M3","nom":"X","sexe":"M"},{"matricule":"M4","nom":"Y","sexe":"Z"}]'::jsonb);
  raise exception 'import partiel accepté';
exception when check_violation then raise notice 'ok : import tout ou rien (une ligne invalide annule tout)'; end $$;
select pg_temp.verifier((select count(*) from public.eleves where matricule = 'M3') = 0, 'import : aucune ligne enregistrée après erreur');
select set_config('app.classe_b_x', :'classe_a', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
do $$ begin perform public.importer_eleves(format('[{"matricule":"Z1","nom":"X","sexe":"M","classe_id":"%s"}]', current_setting('app.classe_b_x'))::jsonb);
  raise exception 'classe d''un autre établissement acceptée';
exception when foreign_key_violation or sqlstate 'P0001' then raise notice 'ok : import vers une classe d''un autre établissement refusé'; end $$;
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
do $$ begin perform public.importer_eleves('[]'::jsonb); raise exception 'import par un enseignant';
exception when insufficient_privilege then raise notice 'ok : import réservé à l''administration'; end $$;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null

-- Verrouillage d'une séquence
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
update public.sequences set verrouillee = true where id = :'seq1';
do $$ begin
  update public.notes set valeur = 2;
  raise exception 'note modifiée dans une séquence verrouillée';
exception when sqlstate 'P0001' then raise notice 'ok : séquence verrouillée protégée'; end $$;
do $$ begin
  delete from public.absences;
  raise exception 'absence supprimée dans une séquence verrouillée';
exception when sqlstate 'P0001' then raise notice 'ok : discipline d''une séquence verrouillée protégée'; end $$;

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

-- ================================ API (serveur MCP) et OAuth ================================
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
do $$ begin perform public.creer_cle_api('Claude', false, 30); raise exception 'clé créée sans activation';
exception when sqlstate 'P0001' then raise notice 'ok : API désactivée par défaut'; end $$;
select public.definir_api_active(true) \g /dev/null
select public.creer_cle_api('Lecture', false, 30)->>'cle' as cle_lect \gset
select public.creer_cle_api('Admin écriture', true, 0)->>'cle' as cle_admin \gset
select pg_temp.verifier(:'cle_lect' ~ '^nxs_[0-9a-f]{48}$', 'clé API au format nxs_…');
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select public.creer_cle_api('Prof', true, 30)->>'cle' as cle_prof \gset
select set_config('request.jwt.claim.sub', :'surv_a', false) \g /dev/null
select public.creer_cle_api('Surveillant', true, 30)->>'cle' as cle_surv \gset
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
select public.definir_api_active(true) \g /dev/null
select public.creer_cle_api('B', true, 30)->>'cle' as cle_b \gset
reset role;
select pg_temp.verifier((select count(*) from public.cles_api where cle_hash like 'nxs%') = 0, 'clés stockées sous forme d''empreinte');
select set_config('request.jwt.claim.sub', '', false) \g /dev/null
set role anon;
select pg_temp.verifier((public.api_contexte(:'cle_lect')->'etablissement'->>'nom') = 'Collège Saint-Joseph', 'outil contexte');
select pg_temp.verifier(json_array_length(public.api_classes(:'cle_lect')) = 1, 'outil classes');
select pg_temp.verifier(json_array_length(public.api_donnees_classe(:'cle_lect', '6E a')->'eleves') >= 1, 'outil données de classe (nom de classe tolérant)');
do $$ begin perform public.api_contexte('nxs_faux'); raise exception 'clé fausse acceptée';
exception when sqlstate '28000' then raise notice 'ok : clé inconnue refusée'; end $$;
select set_config('app.cle_b', :'cle_b', false), set_config('app.cle_lect', :'cle_lect', false), set_config('app.cle_prof', :'cle_prof', false),
       set_config('app.cle_surv', :'cle_surv', false), set_config('app.cle_admin', :'cle_admin', false) \g /dev/null
do $$ begin perform public.api_donnees_classe(current_setting('app.cle_b'), '6e A'); raise exception 'B lit une classe de A';
exception when sqlstate 'P0001' then raise notice 'ok : la clé de B ne voit pas les classes de A'; end $$;
do $$ begin perform public.api_saisir_notes(current_setting('app.cle_lect'), '6e A', 'MATH', 2, '[{"matricule":"M1","note":12}]');
  raise exception 'écriture avec une clé en lecture';
exception when insufficient_privilege then raise notice 'ok : clé en lecture seule refusée en écriture'; end $$;
select pg_temp.verifier((public.api_saisir_notes(:'cle_prof', '6e A', 'Mathématiques', 2, '[{"matricule":"M1","note":"13,5"},{"matricule":"M2","note":null}]')->>'notes_enregistrees')::int = 1,
       'l''enseignant saisit ses notes par l''API');
do $$ begin perform public.api_saisir_notes(current_setting('app.cle_prof'), '6e A', 'MATH', 2, '[{"matricule":"M1","note":19},{"matricule":"INCONNU","note":10}]');
  raise exception 'saisie partielle acceptée';
exception when sqlstate 'P0001' then raise notice 'ok : saisie par l''API tout ou rien'; end $$;
reset role;
select pg_temp.verifier((select valeur from public.notes n join public.sequences s on s.id = n.sequence_id where s.numero = 2 limit 1) = 13.5, 'aucune note modifiée après erreur');
select pg_temp.verifier((select saisi_par from public.notes n join public.sequences s on s.id = n.sequence_id where s.numero = 2 limit 1) = :'prof_a', 'auteur de la note = propriétaire de la clé');
set role anon;
do $$ begin perform public.api_enregistrer_appel(current_setting('app.cle_prof'), '6e A', current_date, 2, '[]'); raise exception 'appel par un enseignant';
exception when insufficient_privilege then raise notice 'ok : l''appel par API reste au surveillant et à l''administration'; end $$;
select pg_temp.verifier((public.api_enregistrer_appel(:'cle_surv', '6e A', current_date, 2, '[{"matricule":"M1","heures_non_justifiees":2,"retard":true}]')->>'retards')::int = 1,
       'le surveillant fait l''appel par l''API');
do $$ begin perform public.api_ajouter_eleve(current_setting('app.cle_prof'), 'X9', 'X', '', 'M', null, ''); raise exception 'élève ajouté par un enseignant';
exception when insufficient_privilege then raise notice 'ok : ajout d''élève réservé à l''administration'; end $$;
select pg_temp.verifier((public.api_ajouter_eleve(:'cle_admin', 'API1', 'Nkoulou', 'Paul', 'm', '2014-05-02', '6e A')->>'matricule') = 'API1', 'l''administration ajoute un élève par l''API');
reset role;
select pg_temp.verifier((select count(*) from public.journal_api) = 3, 'journal : 3 actions d''écriture tracées');
-- Limite d'appels
set role anon;
do $$ declare k int; begin
  for k in 1 .. 70 loop perform public.api_contexte(current_setting('app.cle_lect')); end loop;
  raise exception 'pas de limite';
exception when sqlstate 'P0429' then raise notice 'ok : limite de 60 appels par minute'; end $$;
-- Révocation
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select public.revoquer_cle_api((select id from public.cles_api where nom = 'Prof')) \g /dev/null
reset role; set role anon;
do $$ begin perform public.api_contexte(current_setting('app.cle_prof')); raise exception 'clé révoquée acceptée';
exception when sqlstate '28000' then raise notice 'ok : clé révoquée refusée'; end $$;

-- OAuth
reset role;
select pg_temp.verifier(public._b64url_sha256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk') = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'PKCE S256 conforme à la RFC 7636') from (select 1) x;
set role anon;
do $$ begin perform public.oauth_enregistrer_client('Pirate', array['http://evil.example/cb']); raise exception 'adresse http acceptée';
exception when sqlstate 'P0001' then raise notice 'ok : adresse de retour non https refusée'; end $$;
select public.oauth_enregistrer_client('Claude', array['https://claude.ai/api/mcp/auth_callback'])->>'client_id' as client \gset
select pg_temp.verifier((public.oauth_info_client(:'client', 'https://claude.ai/api/mcp/auth_callback')->>'nom') = 'Claude', 'client enregistré');
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.oauth_autoriser(:'client', 'https://claude.ai/api/mcp/auth_callback', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'S256', false)->>'code' as code1 \gset
reset role; set role anon;
select pg_temp.verifier((public.oauth_echanger_code(:'code1', 'mauvais-verificateur', :'client', 'https://claude.ai/api/mcp/auth_callback')->>'error') = 'invalid_grant', 'mauvais vérificateur PKCE refusé');
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.oauth_autoriser(:'client', 'https://claude.ai/api/mcp/auth_callback', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'S256', false)->>'code' as code2 \gset
reset role; set role anon;
select public.oauth_echanger_code(:'code2', 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', :'client', 'https://claude.ai/api/mcp/auth_callback') as jetons \gset
select pg_temp.verifier((:'jetons'::json->>'access_token') like 'nxo_%' and (:'jetons'::json->>'expires_in')::int = 3600, 'code échangé contre des jetons');
select pg_temp.verifier((public.oauth_echanger_code(:'code2', 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', :'client', 'https://claude.ai/api/mcp/auth_callback')->>'error') = 'invalid_grant', 'code à usage unique');
select pg_temp.verifier((public.api_contexte(:'jetons'::json->>'access_token')->'utilisateur'->>'role') = 'admin', 'le jeton OAuth ouvre les outils MCP');
select set_config('app.acces', :'jetons'::json->>'access_token', false) \g /dev/null
do $$ begin perform public.api_ajouter_eleve(current_setting('app.acces'), 'O1', 'X', '', 'M', null, ''); raise exception 'écriture avec jeton lecture';
exception when insufficient_privilege then raise notice 'ok : jeton OAuth en lecture seule'; end $$;
select public.oauth_rafraichir(:'jetons'::json->>'refresh_token', :'client') as jetons2 \gset
select pg_temp.verifier((:'jetons2'::json->>'access_token') like 'nxo_%', 'rafraîchissement');
do $$ begin perform public.api_contexte(current_setting('app.acces')); raise exception 'ancien jeton accepté';
exception when sqlstate '28000' then raise notice 'ok : ancien jeton révoqué après rafraîchissement'; end $$;
select pg_temp.verifier((public.oauth_rafraichir(:'jetons'::json->>'refresh_token', :'client')->>'error') = 'invalid_grant', 'ancien jeton de rafraîchissement refusé');
-- Désactivation de l'API par l'administration : tout est révoqué
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.definir_api_active(false) \g /dev/null
reset role; set role anon;
select set_config('app.acces2', :'jetons2'::json->>'access_token', false) \g /dev/null
do $$ begin perform public.api_contexte(current_setting('app.acces2')); raise exception 'jeton accepté après désactivation';
exception when sqlstate '28000' then raise notice 'ok : désactiver l''API révoque clés et applications'; end $$;
reset role;
select set_config('app.surv', :'surv_a', false), set_config('app.attr', :'attr_a', false) \g /dev/null

-- Identité de l'établissement : site web et logo ; matières confiées aux seuls enseignants
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
update public.etablissements set site_web = 'www.Saint-Joseph.CM/' where id = public.etab_courant();
select pg_temp.verifier((select site_web from public.etablissements where id = public.etab_courant()) = 'https://www.saint-joseph.cm', 'site web normalisé (https, minuscules, sans / final)');
do $$ begin update public.etablissements set site_web = 'pas un site' where id = public.etab_courant(); raise exception 'site invalide accepté';
exception when sqlstate 'P0001' then raise notice 'ok : site web invalide refusé'; end $$;
update public.etablissements set logo = public.etab_courant()::text || '/logo-1.png' where id = public.etab_courant();
do $$ begin update public.etablissements set logo = 'autre/logo-1.png' where id = public.etab_courant(); raise exception 'logo hors dossier accepté';
exception when check_violation then raise notice 'ok : le logo doit rester dans le dossier de l''établissement'; end $$;
insert into storage.objects (bucket_id, name) values ('logos', public.etab_courant()::text || '/logo-1.png');
do $$ begin insert into storage.objects (bucket_id, name) values ('logos', gen_random_uuid()::text || '/logo-1.png'); raise exception 'logo écrit chez un autre';
exception when insufficient_privilege then raise notice 'ok : pas d''envoi de logo dans le dossier d''un autre établissement'; end $$;
select set_config('request.jwt.claim.sub', :'surv_a', false) \g /dev/null
select pg_temp.verifier((select count(*) from storage.objects where bucket_id = 'logos') = 1, 'le personnel lit le logo de son établissement');
do $$ begin insert into storage.objects (bucket_id, name) values ('logos', public.etab_courant()::text || '/logo-2.png'); raise exception 'logo envoyé par le surveillant';
exception when insufficient_privilege then raise notice 'ok : seul l''administrateur change le logo'; end $$;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
do $$ begin update public.attributions set enseignant_id = current_setting('app.surv')::uuid where id = current_setting('app.attr')::uuid; raise exception 'matière confiée au surveillant';
exception when sqlstate 'P0001' then raise notice 'ok : une matière ne peut pas être confiée au surveillant général'; end $$;
update public.attributions set coefficient = coefficient where id = :'attr_a';
select pg_temp.verifier(true, 'les autres modifications d''une attribution restent possibles');
reset role;
\ir scenario_finance.sql
\ir scenario_console.sql
\echo SCÉNARIO TERMINÉ
