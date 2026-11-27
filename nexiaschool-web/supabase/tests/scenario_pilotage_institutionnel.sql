-- Pilotage institutionnel (0055) : scénarios d'acceptation A à I
--  A référentiel · B comptes et unicité · C fiches et formules · D routage départemental · E consolidation
--  F routage régional · G courriers · H IA / MCP · I non-régression et protections
reset role;
create or replace function pg_temp.ind(p jsonb) returns jsonb language sql security definer as $$ select public._inst_indicateurs(p) $$;
create or replace function pg_temp.etre(p uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', p::text, false) $$;
create or replace function pg_temp.dep(p text) returns uuid language sql security definer as $$ select id from public.inst_departements where nom = p $$;
create or replace function pg_temp.reg(p text) returns uuid language sql security definer as $$ select id from public.inst_regions where nom = p $$;

insert into auth.users (id, email, email_confirmed_at) values
  ('1a5e0000-0000-4000-8000-000000000001', 'proprietaire.inst@gmail.com', now()),
  ('1a5e0000-0000-4000-8000-000000000011', 'chef.lycee.mfoundi@gmail.com', now()),
  ('1a5e0000-0000-4000-8000-000000000012', 'chef.college.mfoundi@yahoo.fr', now()),
  ('1a5e0000-0000-4000-8000-000000000013', 'chef.lycee.lekie@gmail.com', now()),
  ('1a5e0000-0000-4000-8000-000000000014', 'chef.lycee.wouri@gmail.com', now()),
  ('1a5e0000-0000-4000-8000-000000000021', 'ddes.mfoundi@minesec-exemple.cm', now()),
  ('1a5e0000-0000-4000-8000-000000000022', 'autre.candidat@outlook.com', now()),
  ('1a5e0000-0000-4000-8000-000000000023', 'nouveau.ddes.mfoundi@gmail.com', now()),
  ('1a5e0000-0000-4000-8000-000000000024', 'ddes.wouri@gmail.com', now()),
  ('1a5e0000-0000-4000-8000-000000000031', 'dres.centre@gmail.com', now()),
  ('1a5e0000-0000-4000-8000-000000000041', 'collaborateur.ddes@gmail.com', now());
insert into auth.users (id, email) values ('1a5e0000-0000-4000-8000-000000000029', 'non.confirme@gmail.com');
insert into public.plateforme_admins (user_id) values ('1a5e0000-0000-4000-8000-000000000001');
\set P 1a5e0000-0000-4000-8000-000000000001
\set E1 1a5e0000-0000-4000-8000-000000000011
\set E2 1a5e0000-0000-4000-8000-000000000012
\set E3 1a5e0000-0000-4000-8000-000000000013
\set E4 1a5e0000-0000-4000-8000-000000000014
\set D1 1a5e0000-0000-4000-8000-000000000021
\set D1B 1a5e0000-0000-4000-8000-000000000022
\set D1N 1a5e0000-0000-4000-8000-000000000023
\set W1 1a5e0000-0000-4000-8000-000000000024
\set D0 1a5e0000-0000-4000-8000-000000000029
\set R1 1a5e0000-0000-4000-8000-000000000031
\set C1 1a5e0000-0000-4000-8000-000000000041
select set_config('app.P', :'P', false), set_config('app.E1', :'E1', false), set_config('app.E2', :'E2', false), set_config('app.E3', :'E3', false),
       set_config('app.D1', :'D1', false), set_config('app.D1B', :'D1B', false), set_config('app.D1N', :'D1N', false), set_config('app.W1', :'W1', false),
       set_config('app.D0', :'D0', false), set_config('app.R1', :'R1', false), set_config('app.C1', :'C1', false) \g /dev/null
select count(*) as etabs_avant from public.etablissements \gset

-- Établissements (créés avant toute délégation)
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "google"}}', false) \g /dev/null
select pg_temp.etre(:'E1') \g /dev/null
select public.creer_etablissement_google('Lycée Pilote de Mfoundi', 'Yaoundé', '', '', '', '', 'Essomba', 'Marie') \g /dev/null
select public.etab_courant() as etab1 \gset
insert into public.exercices (libelle, actif) values ('2026-2027', true) returning id as ex1 \gset
insert into public.classes (libelle, niveau) values ('2nde C', '2nde') returning id as cl1 \gset
insert into public.classes (libelle, niveau) values ('Tle D', 'Tle') returning id as cl2 \gset
insert into public.matieres (code, libelle) values ('MATH', 'Mathématiques') returning id as ma1 \gset
insert into public.matieres (code, libelle) values ('PCT', 'Physique-Chimie') returning id as ma2 \gset
select (public.creer_personnel('Abena', 'Luc', 'enseignant', 'P1', '')->>'id') as prof1 \gset
insert into public.attributions (exercice_id, classe_id, matiere_id, enseignant_id) values (:'ex1', :'cl1', :'ma1', :'prof1'), (:'ex1', :'cl2', :'ma2', :'prof1');
insert into public.eleves (matricule, nom, prenom, sexe) values ('IN1', 'ONANA', 'Paul', 'M') returning id as el1 \gset
insert into public.eleves (matricule, nom, prenom, sexe) values ('IN2', 'MEKA', 'Rose', 'F') returning id as el2 \gset
insert into public.inscriptions (exercice_id, classe_id, eleve_id) values (:'ex1', :'cl1', :'el1'), (:'ex1', :'cl2', :'el2');
select pg_temp.etre(:'E2') \g /dev/null
select public.creer_etablissement_google('Collège de la Cité Verte', 'Yaoundé', '', '', '', '', 'Ndzana', 'Paul') \g /dev/null
select public.etab_courant() as etab2 \gset
select pg_temp.etre(:'E3') \g /dev/null
select public.creer_etablissement_google('Lycée de Monatélé', 'Monatélé', '', '', '', '', 'Atangana', 'Rita') \g /dev/null
select public.etab_courant() as etab3 \gset
select pg_temp.etre(:'E4') \g /dev/null
select public.creer_etablissement_google('Lycée de Bonabéri', 'Douala', '', '', '', '', 'Ekwalla', 'Jean') \g /dev/null
select public.etab_courant() as etab4 \gset
select set_config('app.etab1', :'etab1', false), set_config('app.etab2', :'etab2', false), set_config('app.etab3', :'etab3', false) \g /dev/null

-- =========================================================================================================
-- A. Référentiel territorial
-- =========================================================================================================
select pg_temp.verifier((select count(*) from public.inst_regions) = 10 and (select count(*) from public.inst_departements) = 58
  and not exists (select 1 from public.inst_departements where verifie) and not exists (select 1 from public.inst_regions where verifie),
  'A1 : 10 régions et 58 départements pré-remplis, tous « à vérifier »');
reset role; set role anon;
select pg_temp.verifier((select count(*) from public.inst_departements where region_id = pg_temp.reg('Centre')) = 10, 'A2 : lecture publique des départements filtrés par région');
reset role; set role authenticated;
do $$ begin insert into public.inst_regions (nom, nom_norm) values ('Fictive', 'fictive'); raise exception 'ÉCHEC : écriture directe du référentiel';
exception when insufficient_privilege then raise notice 'ok : A3 référentiel non modifiable directement'; end $$;
do $$ begin perform pg_temp.etre(current_setting('app.E1')::uuid); perform public.console_inst_circonscription('{"objet": "region", "nom": "Fictive"}');
  raise exception 'ÉCHEC : référentiel modifié par un établissement';
exception when insufficient_privilege then raise notice 'ok : A4 seul le propriétaire administre le référentiel'; end $$;
select pg_temp.etre(:'P') \g /dev/null
select public.console_inst_circonscription(json_build_object('objet', 'departement', 'region_id', pg_temp.reg('Centre'), 'nom', 'Département d''essai')::jsonb) as dep_essai \gset
select public.console_inst_circonscription(json_build_object('objet', 'departement', 'id', :'dep_essai', 'region_id', pg_temp.reg('Centre'), 'nom', 'Département d''essai', 'actif', false, 'code', 'ESS')::jsonb) \g /dev/null
select public.console_inst_circonscription(json_build_object('objet', 'departement', 'id', pg_temp.dep('Mfoundi'), 'region_id', pg_temp.reg('Centre'), 'nom', 'Mfoundi', 'verifie', true)::jsonb) \g /dev/null
reset role;
select pg_temp.verifier((select count(*) from public.inst_referentiel_historique where objet_id = :'dep_essai') = 2
  and (select verifie from public.inst_departements where nom = 'Mfoundi'), 'A5 : création et modification historisées ; validation d''un département');
set role anon;
select pg_temp.verifier(not exists (select 1 from public.inst_departements where nom = 'Département d''essai'), 'A6 : un département désactivé n''est plus proposé');
reset role;
select pg_temp.verifier((select count(*) from public.etablissements where departement_id is null and rattachement_statut = 'absent') = :etabs_avant + 4,
  'A7 : aucun établissement existant rattaché d''office (localisation absente, à déclarer)');

-- =========================================================================================================
-- B. Comptes de délégués, validation, unicité, changement de titulaire, collaborateurs
-- =========================================================================================================
set role authenticated;
select set_config('app.mfoundi', pg_temp.dep('Mfoundi')::text, false), set_config('app.centre', pg_temp.reg('Centre')::text, false),
       set_config('app.wouri', pg_temp.dep('Wouri')::text, false), set_config('app.littoral', pg_temp.reg('Littoral')::text, false),
       set_config('app.lekie', pg_temp.dep('Lekié')::text, false) \g /dev/null
select pg_temp.dep('Mfoundi') as mfoundi, pg_temp.dep('Lekié') as lekie \gset
do $$ begin perform pg_temp.etre(current_setting('app.E1')::uuid);
  perform public.inst_demande_enregistrer(jsonb_build_object('niveau', 'departement', 'region_id', current_setting('app.centre'), 'departement_id', current_setting('app.mfoundi')));
  raise exception 'ÉCHEC : compte d''établissement devenu délégué';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : B1 un compte d''établissement ne peut pas demander un compte de délégué'; end $$;
-- e-mail non vérifié : soumission refusée
select pg_temp.etre(:'D0') \g /dev/null
select public.inst_demande_enregistrer(json_build_object('niveau', 'departement', 'region_id', current_setting('app.centre'), 'departement_id', current_setting('app.lekie'),
  'nom', 'Test', 'telephone', '699000000', 'fonction', 'Délégué', 'justificatif', 'demandes/' || :'D0' || '/acte.pdf')::jsonb) \g /dev/null
do $$ begin perform public.inst_demande_soumettre(); raise exception 'ÉCHEC : soumission sans e-mail vérifié';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : B2 adresse e-mail vérifiée exigée'; end $$;
-- demande complète (adresse hors Gmail acceptée)
select pg_temp.etre(:'D1') \g /dev/null
select public.inst_demande_enregistrer(json_build_object('niveau', 'departement', 'region_id', current_setting('app.centre'), 'departement_id', current_setting('app.mfoundi'),
  'nom', 'Mbarga', 'prenom', 'Alain', 'telephone', '677112233', 'fonction', 'Délégué départemental')::jsonb) \g /dev/null
do $$ begin perform public.inst_demande_soumettre(); raise exception 'ÉCHEC : soumission sans justificatif';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : B3 justificatif obligatoire'; end $$;
do $$ begin perform public.inst_demande_enregistrer(jsonb_build_object('niveau', 'departement', 'region_id', current_setting('app.centre'), 'departement_id', current_setting('app.mfoundi'),
    'justificatif', 'demandes/' || current_setting('app.D1B') || '/vol.pdf'));
  raise exception 'ÉCHEC : justificatif d''un autre compte';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : B4 justificatif limité au dossier du demandeur'; end $$;
do $$ begin perform public.inst_demande_enregistrer(jsonb_build_object('niveau', 'departement', 'region_id', current_setting('app.littoral'), 'departement_id', current_setting('app.mfoundi')));
  raise exception 'ÉCHEC : département hors région';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : B5 département filtré par région'; end $$;
select public.inst_demande_enregistrer(json_build_object('niveau', 'departement', 'region_id', current_setting('app.centre'), 'departement_id', current_setting('app.mfoundi'),
  'nom', 'Mbarga', 'prenom', 'Alain', 'telephone', '677112233', 'fonction', 'Délégué départemental', 'justificatif', 'demandes/' || :'D1' || '/note.pdf')::jsonb) \g /dev/null
select public.inst_demande_soumettre() ->> 'statut' as st \gset
select pg_temp.verifier(:'st' = 'soumise' and (public.inst_mon_espace() -> 'membre') = 'null'::jsonb, 'B6 : demande soumise, aucun accès avant validation');
do $$ begin perform public.inst_tableau_departement(null); raise exception 'ÉCHEC : espace délégué ouvert avant validation';
exception when insufficient_privilege then raise notice 'ok : B7 espace inaccessible tant que la demande n''est pas approuvée'; end $$;
reset role;
select id as dem1 from public.inst_demandes where user_id = :'D1' \gset
set role authenticated;
select pg_temp.etre(:'D1') \g /dev/null
do $$ begin perform public.console_inst_decider((select id from public.inst_demandes limit 1), 'approuvee'); raise exception 'ÉCHEC : auto-validation';
exception when insufficient_privilege then raise notice 'ok : B8 seul le propriétaire valide les demandes'; end $$;
select pg_temp.etre(:'P') \g /dev/null
select public.console_inst_decider(:'dem1', 'approuvee') ->> 'delegation_id' as del_mfoundi \gset
select set_config('app.del_mfoundi', :'del_mfoundi', false) \g /dev/null
select pg_temp.etre(:'D1') \g /dev/null
select pg_temp.verifier(public.inst_mon_espace() -> 'delegation' ->> 'departement' = 'Mfoundi' and public.inst_mon_espace() -> 'membre' ->> 'role' = 'titulaire',
  'B9 : demande approuvée → titulaire de la délégation départementale du Mfoundi');
-- unicité : seconde demande pour la même circonscription
select pg_temp.etre(:'D1B') \g /dev/null
select public.inst_demande_enregistrer(json_build_object('niveau', 'departement', 'region_id', current_setting('app.centre'), 'departement_id', current_setting('app.mfoundi'),
  'nom', 'Fouda', 'telephone', '690000001', 'fonction', 'Délégué', 'justificatif', 'demandes/' || :'D1B' || '/acte.pdf')::jsonb) \g /dev/null
do $$ begin perform public.inst_demande_soumettre(); raise exception 'ÉCHEC : seconde délégation pour le Mfoundi';
exception when sqlstate 'P0001' then
  if sqlerrm <> 'Une délégation est déjà enregistrée pour cette circonscription administrative. Si vous êtes le nouveau responsable de cette délégation, veuillez contacter l''administrateur de NexIA School pour procéder à la mise à jour de la désignation.' then raise; end if;
  raise notice 'ok : B10 message exact d''unicité de la circonscription'; end $$;
reset role;
do $$ begin insert into public.inst_delegations (niveau, region_id, departement_id, nom) values ('departement', current_setting('app.centre')::uuid, current_setting('app.mfoundi')::uuid, 'Doublon direct');
  raise exception 'ÉCHEC : doublon en base';
exception when unique_violation then raise notice 'ok : B11 contrainte d''unicité en base sur le département'; end $$;
do $$ begin insert into public.inst_membres (delegation_id, user_id, role) values (current_setting('app.del_mfoundi')::uuid, current_setting('app.D1B')::uuid, 'titulaire');
  raise exception 'ÉCHEC : deux titulaires actifs';
exception when unique_violation then raise notice 'ok : B12 un seul titulaire actif par délégation'; end $$;
-- délégués du Wouri (départemental) et du Centre (régional)
set role authenticated;
select pg_temp.etre(:'W1') \g /dev/null
select public.inst_demande_enregistrer(json_build_object('niveau', 'departement', 'region_id', current_setting('app.littoral'), 'departement_id', current_setting('app.wouri'),
  'nom', 'Din', 'telephone', '699000002', 'fonction', 'Délégué', 'justificatif', 'demandes/' || :'W1' || '/a.pdf')::jsonb) \g /dev/null
select public.inst_demande_soumettre() \g /dev/null
select pg_temp.etre(:'R1') \g /dev/null
select public.inst_demande_enregistrer(json_build_object('niveau', 'region', 'region_id', current_setting('app.centre'), 'departement_id', current_setting('app.mfoundi'),
  'nom', 'Ngah', 'telephone', '699000003', 'fonction', 'Déléguée régionale', 'justificatif', 'demandes/' || :'R1' || '/a.pdf')::jsonb) \g /dev/null
select public.inst_demande_soumettre() \g /dev/null
reset role;
select id as dem_w from public.inst_demandes where user_id = :'W1' \gset
select id as dem_r from public.inst_demandes where user_id = :'R1' \gset
select id as dem_b from public.inst_demandes where user_id = :'D1B' \gset
select set_config('app.dem_b', :'dem_b', false) \g /dev/null
set role authenticated;
select pg_temp.etre(:'P') \g /dev/null
select public.console_inst_decider(:'dem_w', 'approuvee') ->> 'delegation_id' as del_wouri \gset
select public.console_inst_decider(:'dem_r', 'approuvee') ->> 'delegation_id' as del_centre \gset
select set_config('app.del_centre', :'del_centre', false), set_config('app.del_wouri', :'del_wouri', false) \g /dev/null
select pg_temp.verifier((select count(*) from jsonb_array_elements(public.console_inst_demandes()) x where x ->> 'id' = :'dem_b' and (x ->> 'circonscription_prise')::boolean) = 1,
  'B13 : la demande bloquée reste visible par le propriétaire (circonscription déjà prise)');
do $$ begin perform public.console_inst_decider(current_setting('app.dem_b')::uuid, 'rejetee', ''); raise exception 'ÉCHEC : rejet sans motif';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : B14 motif obligatoire pour un rejet'; end $$;
-- changement de titulaire : même entité, ancien accès révoqué, historique conservé
select pg_temp.etre(:'D1N') \g /dev/null
select public.inst_demande_enregistrer(json_build_object('niveau', 'departement', 'region_id', current_setting('app.centre'), 'departement_id', current_setting('app.mfoundi'),
  'nom', 'Owona', 'prenom', 'Claire', 'telephone', '677998877', 'fonction', 'Déléguée départementale', 'justificatif', 'demandes/' || :'D1N' || '/nomination.pdf')::jsonb) \g /dev/null
reset role;
select id as dem_n from public.inst_demandes where user_id = :'D1N' \gset
set role authenticated;
select pg_temp.etre(:'P') \g /dev/null
do $$ begin perform public.console_inst_changer_titulaire(current_setting('app.del_mfoundi')::uuid, (select null::uuid), 'x'); raise exception 'ÉCHEC';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : B15 motif et demande exigés pour changer de titulaire'; end $$;
select public.console_inst_changer_titulaire(:'del_mfoundi', :'dem_n', 'Nomination par note de service') \g /dev/null
select public.console_inst_decider(:'dem_b', 'rejetee', 'Circonscription déjà pourvue') \g /dev/null
select pg_temp.etre(:'D1') \g /dev/null
do $$ begin perform public.inst_tableau_departement(null); raise exception 'ÉCHEC : ancien titulaire encore actif';
exception when insufficient_privilege then raise notice 'ok : B16 accès de l''ancien titulaire révoqué'; end $$;
select pg_temp.etre(:'D1N') \g /dev/null
reset role;
select pg_temp.verifier((select count(*) from public.inst_delegations where departement_id = :'mfoundi') = 1
  and (select count(*) from public.inst_membres where delegation_id = :'del_mfoundi') = 2
  and (select count(*) from public.inst_membres where delegation_id = :'del_mfoundi' and actif) = 1
  and exists (select 1 from public.inst_journal where action = 'changement de titulaire' and objet_id = :'del_mfoundi'),
  'B17 : même délégation, ancien titulaire conservé (révoqué) dans l''historique, changement journalisé');
set role authenticated;
select pg_temp.etre(:'P') \g /dev/null
select set_config('app.dem_n', :'dem_n', false) \g /dev/null
do $$ begin perform public.console_inst_decider(current_setting('app.dem_n')::uuid, 'rejetee', 'Essai de rejet'); raise exception 'ÉCHEC : rejet d''un titulaire en place';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : B17b une demande approuvée ne peut être que suspendue (accès retiré)'; end $$;
select pg_temp.etre(:'D1N') \g /dev/null
do $$ begin perform public.inst_collaborateur_ajouter('collaborateur.ddes@gmail.com', array['courriers']); raise exception 'ÉCHEC : collaborateurs non autorisés';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : B18 collaborateurs soumis à l''autorisation du propriétaire'; end $$;
select pg_temp.etre(:'P') \g /dev/null
select public.console_inst_delegation(:'del_mfoundi', '{"collaborateurs_autorises": true}') \g /dev/null
select pg_temp.etre(:'D1N') \g /dev/null
select public.inst_collaborateur_ajouter('collaborateur.ddes@gmail.com', array['courriers']) \g /dev/null
select pg_temp.etre(:'C1') \g /dev/null
select pg_temp.verifier(public.inst_mon_espace() -> 'membre' ->> 'role' = 'collaborateur' and public.inst_mon_espace() -> 'delegation' ->> 'id' = :'del_mfoundi',
  'B19 : collaborateur rattaché à la délégation existante');
do $$ begin perform public.inst_demande_enregistrer(jsonb_build_object('niveau', 'departement', 'region_id', current_setting('app.centre'), 'departement_id', current_setting('app.lekie')));
  raise exception 'ÉCHEC : un collaborateur crée une seconde délégation';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : B20 un collaborateur ne peut pas créer de délégation'; end $$;

-- =========================================================================================================
-- C. Fiches de synthèse statistiques : campagnes, pré-remplissage, formules et protections
-- =========================================================================================================
select pg_temp.etre(:'P') \g /dev/null
select public.console_inst_campagne(json_build_object('niveau', 'etablissement', 'exercice', '2026-2027', 'periode', 't1',
  'ouverture', public._aujourdhui() - 5, 'echeance', public._aujourdhui() + 10)::jsonb) as camp_t1 \gset
select public.console_inst_campagne(json_build_object('niveau', 'departement', 'exercice', '2026-2027', 'periode', 't1',
  'ouverture', public._aujourdhui() - 5, 'echeance', public._aujourdhui() + 20)::jsonb) as camp_d1 \gset
select public.console_inst_campagne(json_build_object('niveau', 'etablissement', 'exercice', '2026-2027', 'periode', 't3',
  'ouverture', public._aujourdhui() - 20, 'echeance', public._aujourdhui() - 1)::jsonb) as camp_t3 \gset
select set_config('app.camp_t1', :'camp_t1', false) \g /dev/null
do $$ begin perform public.console_inst_campagne(jsonb_build_object('niveau', 'etablissement', 'exercice', '2026-2027', 'periode', 't2',
    'ouverture', public._aujourdhui(), 'echeance', public._aujourdhui() - 3)); raise exception 'ÉCHEC : échéance avant ouverture';
exception when check_violation or sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : C1 calendrier cohérent exigé'; end $$;
select pg_temp.etre(:'E1') \g /dev/null
select public.inst_fiche_preparer(:'camp_t1') as fiche1 \gset
select set_config('app.fiche1', :'fiche1', false) \g /dev/null
select public.inst_fiche_lire(:'fiche1') as f1 \gset
select pg_temp.verifier(jsonb_array_length((:'f1')::jsonb -> 'brouillon' -> 'lignes') = 2
  and (:'f1')::jsonb -> 'brouillon' -> 'lignes' -> 0 ->> 'source' = 'auto'
  and (:'f1')::jsonb -> 'brouillon' -> 'lignes' -> 0 ->> 'enseignant' ilike 'Abena%'
  and (:'f1')::jsonb -> 'brouillon' -> 'lignes' -> 0 -> 'prevues_t' = 'null'::jsonb
  and ((:'f1')::jsonb -> 'brouillon' -> 'synthese' ->> 'eleves')::int = 2 and ((:'f1')::jsonb -> 'brouillon' -> 'synthese' ->> 'disciplines')::int = 2,
  'C2 : fiche pré-remplie (classes, disciplines, enseignant, effectifs) sans valeur de leçon ni d''heure inventée');
select pg_temp.verifier(public.inst_fiche_preparer(:'camp_t1') = :'fiche1', 'C3 : une seule fiche par établissement et par période');
-- pondération : (6 + 2) / 10 et 15 / 30 → 23 / 40 = 57,5 % (et non la moyenne 65 %)
select pg_temp.verifier((pg_temp.ind('{"lignes": [{"discipline": "M", "prevues_t": 10, "faites_t": 6, "digit_t": 2}, {"discipline": "P", "prevues_t": 30, "faites_t": 15, "digit_t": 0}]}')
  -> 'indicateurs' -> 'couverture_theorie' ->> 'taux')::numeric = 57.5, 'C4 : agrégation pondérée (somme des numérateurs / somme des dénominateurs)');
select pg_temp.ind('{"lignes": [{"prevues_t": 10, "faites_t": null, "digit_t": 0}, {"prevues_t": "na", "faites_t": 3, "digit_t": 0}, {"prevues_t": 0, "faites_t": 2, "digit_t": 0}, {"prevues_t": 4, "faites_t": 5, "digit_t": 0}]}') as ind2 \gset
select pg_temp.verifier((:'ind2')::jsonb -> 'indicateurs' -> 'couverture_theorie' ->> 'manquantes' = '1'
  and ((:'ind2')::jsonb -> 'indicateurs' -> 'couverture_theorie' ->> 'den')::numeric = 4
  and exists (select 1 from jsonb_array_elements((:'ind2')::jsonb -> 'anomalies') a where a ->> 'code' = 'denominateur_nul' and a ->> 'niveau' = 'alerte')
  and exists (select 1 from jsonb_array_elements((:'ind2')::jsonb -> 'anomalies') a where a ->> 'code' = 'depasse_100' and a ->> 'niveau' = 'alerte')
  and exists (select 1 from jsonb_array_elements((:'ind2')::jsonb -> 'anomalies') a where a ->> 'code' = 'manquant' and a ->> 'niveau' = 'info'),
  'C5 : manquant exclu (jamais zéro), non applicable ignoré, division par zéro et dépassement de 100 % signalés sans blocage');
select pg_temp.verifier((pg_temp.ind('{"lignes": [{"prevues_t": 10, "faites_t": -1, "digit_t": 0}], "assiduite": {"eleves": {"heures_dues": 10, "heures_absence": 12}}}') -> 'anomalies') @> '[{"niveau": "bloquant", "code": "negatif"}]'
  and (pg_temp.ind('{"assiduite": {"eleves": {"heures_dues": 10, "heures_absence": 12}}}') -> 'anomalies') @> '[{"niveau": "bloquant", "code": "incoherent"}]'
  and (pg_temp.ind('{"assiduite": {"enseignants": {"heures_dues": 200, "heures_absence": 10}}}') -> 'indicateurs' -> 'assiduite_enseignants' ->> 'taux')::numeric = 95,
  'C6 : valeurs négatives et totaux incohérents bloquants ; assiduité calculée');
select public.inst_fiche_enregistrer(:'fiche1', '{"lignes": [
   {"classe": "2nde C", "discipline": "Mathématiques", "enseignant": "Abena Luc", "source": "auto", "prevues_t": 20, "prevues_p": 4, "faites_t": 14, "faites_p": 2, "digit_t": 2, "digit_p": 0, "heures_dues_t": 60, "heures_dues_p": 10, "heures_faites_t": 50, "heures_faites_p": 8},
   {"classe": "Tle D", "discipline": "Physique-Chimie", "enseignant": "Abena Luc", "source": "auto", "prevues_t": 10, "prevues_p": 6, "faites_t": 12, "faites_p": 3, "digit_t": 0, "digit_p": 0, "heures_dues_t": 40, "heures_dues_p": 20, "heures_faites_t": 30, "heures_faites_p": 15}],
  "synthese": {"eleves": 2, "enseignants": 1, "classes": 2, "disciplines": 2},
  "assiduite": {"enseignants": {"heures_dues": 130, "heures_absence": 5}, "eleves": {"heures_dues": 600, "heures_absence": 30}},
  "observations": "Bon démarrage du trimestre."}', true) ->> 'statut' as st \gset
select pg_temp.verifier(:'st' = 'prete', 'C7 : enregistrement du brouillon et passage à « prête à publier »');
select pg_temp.etre(:'E2') \g /dev/null
do $$ begin perform public.inst_fiche_lire(current_setting('app.fiche1')::uuid); raise exception 'ÉCHEC : fiche lue par un autre établissement';
exception when insufficient_privilege then raise notice 'ok : C8 fiche invisible pour un autre établissement'; end $$;
do $$ begin perform public.inst_fiche_enregistrer(current_setting('app.fiche1')::uuid, '{}'); raise exception 'ÉCHEC : fiche modifiée par un autre établissement';
exception when insufficient_privilege then raise notice 'ok : C9 fiche non modifiable par un autre établissement'; end $$;

-- =========================================================================================================
-- D. Routage vers la délégation départementale et examen
-- =========================================================================================================
select pg_temp.etre(:'E1') \g /dev/null
do $$ begin perform public.inst_fiche_publier(current_setting('app.fiche1')::uuid, true); raise exception 'ÉCHEC : publication sans rattachement';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : D1 publication refusée sans rattachement'; end $$;
select public.etablissement_localisation(:'mfoundi') ->> 'statut' as st \gset
select pg_temp.verifier(:'st' = 'declare', 'D2 : rattachement déclaré, à vérifier');
do $$ begin perform public.inst_fiche_publier(current_setting('app.fiche1')::uuid, true); raise exception 'ÉCHEC : publication avec rattachement non vérifié';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : D3 publication refusée tant que le rattachement n''est pas vérifié'; end $$;
select pg_temp.etre(:'E2') \g /dev/null
select public.etablissement_localisation(:'mfoundi') \g /dev/null
select pg_temp.etre(:'E3') \g /dev/null
select public.etablissement_localisation(:'lekie') \g /dev/null
select pg_temp.etre(:'W1') \g /dev/null
do $$ begin perform public.inst_verifier_rattachement(current_setting('app.etab1')::uuid, true); raise exception 'ÉCHEC : vérification hors département';
exception when insufficient_privilege then raise notice 'ok : D4 une délégation ne vérifie que les établissements de son département'; end $$;
select pg_temp.etre(:'D1N') \g /dev/null
select pg_temp.verifier((select count(*) from jsonb_array_elements(public.inst_notifications_lire()) n where n ->> 'type' = 'rattachement') = 2,
  'D5 : la délégation est notifiée des rattachements déclarés dans son département');
select public.inst_verifier_rattachement(:'etab1', true) \g /dev/null
select public.inst_verifier_rattachement(:'etab2', true) \g /dev/null
select pg_temp.etre(:'P') \g /dev/null
select public.inst_verifier_rattachement(:'etab3', true) \g /dev/null
select pg_temp.etre(:'E3') \g /dev/null
select public.inst_fiche_preparer(:'camp_t1') as fiche3 \gset
select set_config('app.fiche3', :'fiche3', false) \g /dev/null
do $$ begin perform public.inst_fiche_publier(current_setting('app.fiche3')::uuid, true); raise exception 'ÉCHEC : publication sans délégation';
exception when sqlstate 'P0001' then if sqlerrm not like 'Aucune délégation départementale active%' then raise; end if;
  raise notice 'ok : D6 publication refusée si la délégation départementale n''existe pas ou n''est pas active'; end $$;
select pg_temp.etre(:'E1') \g /dev/null
do $$ begin perform public.inst_fiche_publier(current_setting('app.fiche1')::uuid, false); raise exception 'ÉCHEC : anomalies non confirmées';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : D7 confirmation exigée quand des anomalies sont signalées'; end $$;
select public.inst_fiche_publier(:'fiche1', true) as pub \gset
reset role;
select pg_temp.verifier((:'pub')::jsonb ->> 'version' = '1' and not ((:'pub')::jsonb ->> 'en_retard')::boolean
  and (select statut from public.inst_fiches where id = :'fiche1') = 'publiee'
  and (select destinataire_id from public.inst_fiche_versions where fiche_id = :'fiche1') = :'del_mfoundi'
  and exists (select 1 from public.inst_notifications where delegation_id = :'del_mfoundi' and type = 'publication' and objet_id = :'fiche1'),
  'D8 : publication enregistrée, destinée à la seule délégation du Mfoundi, notifiée');
set role authenticated;
select pg_temp.etre(:'W1') \g /dev/null
do $$ begin perform public.inst_fiche_lire(current_setting('app.fiche1')::uuid); raise exception 'ÉCHEC : fiche lue par une autre délégation départementale';
exception when insufficient_privilege then raise notice 'ok : D9 fiche invisible pour une autre délégation départementale'; end $$;
select pg_temp.etre(:'R1') \g /dev/null
do $$ begin perform public.inst_fiche_lire(current_setting('app.fiche1')::uuid); raise exception 'ÉCHEC : fiche brute lue par la délégation régionale';
exception when insufficient_privilege then raise notice 'ok : D10 la délégation régionale ne voit pas les fiches brutes'; end $$;
select pg_temp.etre(:'P') \g /dev/null
select public.console_inst_derogation(:'del_centre', null, :'etab1', 7, 'Enquête ponctuelle demandée') \g /dev/null
select pg_temp.etre(:'R1') \g /dev/null
select pg_temp.verifier(public.inst_fiche_lire(:'fiche1') ->> 'acces' = 'derogation', 'D11 : lecture exceptionnelle par dérogation explicite et limitée');
reset role;
select pg_temp.verifier(exists (select 1 from public.inst_journal where action = 'consultation par dérogation' and objet_id = :'fiche1' and auteur = :'R1'), 'D12 : consultation par dérogation journalisée');
update public.inst_derogations set revoquee_le = now();
set role authenticated;
do $$ begin perform public.inst_fiche_lire(current_setting('app.fiche1')::uuid); raise exception 'ÉCHEC : dérogation révoquée encore active';
exception when insufficient_privilege then raise notice 'ok : D13 dérogation révoquée → accès retiré'; end $$;
-- examen par la délégation départementale
select pg_temp.etre(:'C1') \g /dev/null
do $$ begin perform public.inst_fiche_demander_correction(current_setting('app.fiche1')::uuid, 'Revoir les leçons'); raise exception 'ÉCHEC : collaborateur sans droit d''examen';
exception when insufficient_privilege then raise notice 'ok : D14 permissions limitées du collaborateur appliquées'; end $$;
select pg_temp.etre(:'D1N') \g /dev/null
select pg_temp.verifier(public.inst_fiche_lire(:'fiche1') ->> 'statut' = 'en_examen', 'D15 : ouverture par la délégation → « en cours d''examen »');
select public.inst_fiche_commenter(:'fiche1', 'Merci pour la transmission.') \g /dev/null
select public.inst_fiche_demander_correction(:'fiche1', 'Leçons faites supérieures aux leçons prévues en Physique-Chimie.', array['ligne 2']) \g /dev/null
select pg_temp.etre(:'E1') \g /dev/null
select pg_temp.verifier(public.inst_fiche_lire(:'fiche1') ->> 'statut' = 'correction_demandee'
  and jsonb_array_length(public.inst_fiche_lire(:'fiche1') -> 'commentaires') = 2
  and exists (select 1 from jsonb_array_elements(public.inst_notifications_lire()) n where n ->> 'type' = 'correction'),
  'D16 : correction demandée, commentaires horodatés visibles, établissement notifié');
select jsonb_set(public.inst_fiche_lire(:'fiche1') -> 'brouillon', '{lignes,1,faites_t}', '9') as corrige \gset
select public.inst_fiche_enregistrer(:'fiche1', :'corrige') ->> 'statut' as st \gset
select pg_temp.verifier(:'st' = 'corrigee', 'D17 : modification après demande → « corrigée »');
select public.inst_fiche_publier(:'fiche1', false) ->> 'version' as v2 \gset
reset role;
select pg_temp.verifier(:'v2' = '2' and (select statut from public.inst_fiches where id = :'fiche1') = 'republiee'
  and (select donnees -> 'lignes' -> 1 ->> 'faites_t' from public.inst_fiche_versions where fiche_id = :'fiche1' and version = 1) = '12'
  and (select count(*) from public.inst_fiche_statuts where fiche_id = :'fiche1') >= 6,
  'D18 : republication en version 2, version 1 conservée intacte, statuts historisés');
do $$ begin update public.inst_fiche_versions set donnees = '{}' where fiche_id = current_setting('app.fiche1')::uuid; raise exception 'ÉCHEC : version modifiée';
exception when insufficient_privilege then raise notice 'ok : D19 version publiée immuable'; end $$;
set role authenticated;
select pg_temp.etre(:'D1N') \g /dev/null
select public.inst_fiche_examinee(:'fiche1', 'satisfaisant') \g /dev/null
select public.inst_tableau_departement(:'camp_t1') as tb \gset
select pg_temp.verifier(((:'tb')::jsonb -> 'compteurs' ->> 'attendues')::int = 2 and ((:'tb')::jsonb -> 'compteurs' ->> 'publiees')::int = 1
  and ((:'tb')::jsonb -> 'compteurs' ->> 'non_publiees')::int = 1 and ((:'tb')::jsonb -> 'compteurs' ->> 'examinees')::int = 1
  and not exists (select 1 from jsonb_array_elements((:'tb')::jsonb -> 'etablissements') x where x ->> 'nom' in ('Lycée de Monatélé', 'Lycée de Bonabéri')),
  'D20 : tableau de bord départemental limité au Mfoundi (attendues, publiées, non publiées, examinées)');
select pg_temp.verifier(public.inst_relancer(:'camp_t1', array[:'etab2'::uuid]) = 1, 'D21 : relance d''un établissement du département');
do $$ begin perform public.inst_relancer(current_setting('app.camp_t1')::uuid, array[current_setting('app.etab3')::uuid]); raise exception 'ÉCHEC : relance hors département';
exception when insufficient_privilege then raise notice 'ok : D22 relance hors circonscription refusée'; end $$;

-- =========================================================================================================
-- E. Consolidation départementale (les manquants ne valent jamais zéro)
-- =========================================================================================================
select public.inst_consolidation(:'camp_t1') as co1 \gset
select pg_temp.verifier(((:'co1')::jsonb ->> 'recus')::int = 1 and ((:'co1')::jsonb ->> 'manquants')::int = 1 and ((:'co1')::jsonb ->> 'nb_fiches')::int = 1
  and ((:'co1')::jsonb -> 'indicateurs' -> 'couverture_theorie' ->> 'den')::numeric = 30
  and ((:'co1')::jsonb -> 'indicateurs' -> 'couverture_theorie' ->> 'num')::numeric = 25,
  'E1 : consolidation partielle annoncée (1 reçue sur 2), calcul sur les seules données reçues');
select pg_temp.etre(:'E2') \g /dev/null
select public.inst_fiche_preparer(:'camp_t1') as fiche2 \gset
select public.inst_fiche_enregistrer(:'fiche2', '{"lignes": [{"classe": "6e A", "discipline": "Mathématiques", "prevues_t": 50, "faites_t": 30, "digit_t": 5},
  {"classe": "6e B", "discipline": "Français", "prevues_t": 40, "faites_t": null, "digit_t": 0}], "synthese": {"eleves": 120}}') \g /dev/null
select public.inst_fiche_publier(:'fiche2', false) \g /dev/null
select pg_temp.etre(:'D1N') \g /dev/null
select public.inst_consolidation(:'camp_t1') as co2 \gset
select pg_temp.verifier(((:'co2')::jsonb ->> 'recus')::int = 2 and ((:'co2')::jsonb ->> 'manquants')::int = 0
  and ((:'co2')::jsonb -> 'indicateurs' -> 'couverture_theorie' ->> 'den')::numeric = 80
  and ((:'co2')::jsonb -> 'indicateurs' -> 'couverture_theorie' ->> 'taux')::numeric = round((25 + 35) / 80.0 * 100, 2)
  and ((:'co2')::jsonb -> 'synthese' -> 'eleves' ->> 'total')::int = 122
  and ((:'co2')::jsonb -> 'par_discipline' -> 'Mathématiques' -> 'couverture_theorie' ->> 'den')::numeric = 70
  and ((:'co2')::jsonb -> 'indicateurs' -> 'assiduite_eleves' ->> 'fiches')::int = 1,
  'E2 : consolidation pondérée ; ligne incomplète exclue ; nombre de fiches comptées affiché par indicateur');

-- =========================================================================================================
-- F. Routage régional : synthèse départementale → délégation régionale de la même région
-- =========================================================================================================
select public.inst_synthese_preparer(:'camp_d1') as syn1 \gset
select set_config('app.syn1', :'syn1', false) \g /dev/null
select public.inst_fiche_enregistrer(:'syn1', '{"observations": "Transmission complète.", "difficultes": "Retards de programme en PCT.", "recommandations": "Renforcer les TP."}') \g /dev/null
select public.inst_fiche_publier(:'syn1', false) as pubs \gset
reset role;
select pg_temp.verifier((select destinataire_id from public.inst_fiche_versions where fiche_id = :'syn1') = :'del_centre'
  and ((select indicateurs from public.inst_fiche_versions where fiche_id = :'syn1') ->> 'nb_fiches')::int = 2,
  'F1 : synthèse départementale transmise à la seule délégation régionale du Centre, consolidation figée (2 fiches)');
set role authenticated;
select pg_temp.etre(:'R1') \g /dev/null
select public.inst_tableau_region(:'camp_d1') as tr \gset
select public.inst_consolidation(:'camp_d1') as cr \gset
select pg_temp.verifier(((:'tr')::jsonb -> 'compteurs' ->> 'recues')::int = 1 and ((:'tr')::jsonb -> 'compteurs' ->> 'departements')::int = 10
  and ((:'cr')::jsonb ->> 'recus')::int = 1 and ((:'cr')::jsonb ->> 'manquants')::int = 9
  and ((:'cr')::jsonb -> 'indicateurs' -> 'couverture_theorie' ->> 'den')::numeric = 80
  and ((:'cr')::jsonb -> 'synthese' -> 'eleves' ->> 'total')::int = 122 and ((:'cr')::jsonb -> 'synthese' -> 'eleves' ->> 'fiches')::int = 2,
  'F2 : tableau régional et consolidation régionale (1 synthèse sur 10 départements, calcul pondéré)');
select pg_temp.verifier(public.inst_fiche_lire(:'syn1') ->> 'acces' = 'destinataire', 'F3 : la délégation régionale lit la synthèse départementale reçue');
select pg_temp.etre(:'W1') \g /dev/null
do $$ begin perform public.inst_fiche_lire(current_setting('app.syn1')::uuid); raise exception 'ÉCHEC : synthèse lue hors région';
exception when insufficient_privilege then raise notice 'ok : F4 synthèse invisible hors de son circuit'; end $$;
do $$ begin perform public.inst_consolidation(current_setting('app.camp_t1')::uuid) -> 'nb_fiches'; perform pg_temp.verifier(
    (public.inst_consolidation(current_setting('app.camp_t1')::uuid) ->> 'nb_fiches')::int = 0, 'F5 : la délégation du Wouri ne consolide aucune fiche du Mfoundi'); end $$;
-- publication tardive signalée
select pg_temp.etre(:'E2') \g /dev/null
select public.inst_fiche_preparer(:'camp_t3') as fiche_t3 \gset
select public.inst_fiche_publier(:'fiche_t3', true) ->> 'en_retard' as retard \gset
select pg_temp.verifier(:'retard' = 'true', 'F6 : publication après l''échéance acceptée et marquée en retard');

-- =========================================================================================================
-- G. Courriers institutionnels
-- =========================================================================================================
select pg_temp.etre(:'C1') \g /dev/null
select public.inst_courrier_enregistrer('{"type": "rappel", "objet": "Rappel des échéances du premier trimestre", "corps": "Madame, Monsieur le Chef d''établissement, ..."}') as cour1 \gset
select set_config('app.cour1', :'cour1', false) \g /dev/null
do $$ begin perform public.inst_courrier_envoyer(current_setting('app.cour1')::uuid, array[current_setting('app.etab1')::uuid, current_setting('app.etab3')::uuid]);
  raise exception 'ÉCHEC : courrier hors département';
exception when insufficient_privilege then raise notice 'ok : G1 destinataire hors circonscription refusé'; end $$;
select public.inst_courrier_envoyer(:'cour1', null, true) as env \gset
select pg_temp.verifier((:'env')::jsonb ->> 'destinataires' = '2' and (:'env')::jsonb ->> 'reference' like 'DDES/____/0001', 'G2 : envoi à tous les établissements du département, référence attribuée');
reset role;
do $$ begin update public.inst_courriers set corps = 'modifié' where id = current_setting('app.cour1')::uuid; raise exception 'ÉCHEC : courrier modifié après envoi';
exception when insufficient_privilege then raise notice 'ok : G3 aucune modification après envoi'; end $$;
set role authenticated;
select pg_temp.etre(:'E3') \g /dev/null
select pg_temp.verifier(jsonb_array_length(public.inst_courriers_recus()) = 0, 'G4 : un établissement hors destinataires ne voit pas le courrier');
select pg_temp.etre(:'E1') \g /dev/null
select public.inst_courriers_recus() -> 0 ->> 'destinataire_id' as dest1 \gset
select public.inst_courrier_lu(:'dest1') \g /dev/null
select public.inst_courrier_repondre(:'dest1', 'Bien reçu, nous nous y conformerons.', array['reponses/' || :'etab1' || '/accuse.pdf']) \g /dev/null
do $$ begin perform public.inst_courrier_repondre((select (public.inst_courriers_recus() -> 0 ->> 'destinataire_id')::uuid), 'x', array['reponses/autre/x.pdf']);
  raise exception 'ÉCHEC : pièce jointe hors dossier';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : G5 pièces jointes limitées au dossier de l''expéditeur'; end $$;
select pg_temp.etre(:'D1N') \g /dev/null
select public.inst_courriers_envoyes() -> 0 as suivi \gset
select pg_temp.verifier((select count(*) from jsonb_array_elements((:'suivi')::jsonb -> 'destinataires') d where d ->> 'statut' = 'repondu' and jsonb_array_length(d -> 'reponses') = 1) = 1
  and (select count(*) from jsonb_array_elements((:'suivi')::jsonb -> 'destinataires') d where d ->> 'statut' = 'distribue') = 1,
  'G6 : suivi des destinataires (lu, réponse reçue, distribué)');
select pg_temp.etre(:'R1') \g /dev/null
select public.inst_courrier_enregistrer('{"type": "rapport", "objet": "Demande de rapport trimestriel", "corps": "..."}') as cour2 \gset
select set_config('app.cour2', :'cour2', false) \g /dev/null
do $$ begin perform public.inst_courrier_envoyer(current_setting('app.cour2')::uuid, array[current_setting('app.del_wouri')::uuid]); raise exception 'ÉCHEC : courrier régional hors région';
exception when insufficient_privilege then raise notice 'ok : G7 la délégation régionale n''écrit qu''aux délégations de sa région'; end $$;
select public.inst_courrier_envoyer(:'cour2', array[:'del_mfoundi'::uuid]) ->> 'reference' as ref2 \gset
select pg_temp.etre(:'D1N') \g /dev/null
select pg_temp.verifier(public.inst_courriers_recus() -> 0 ->> 'reference' = :'ref2' and :'ref2' like 'DRES/%', 'G8 : courrier régional reçu par la délégation départementale');

-- =========================================================================================================
-- H. IA & API (MCP) : lecture seule, périmètre, minimisation
-- =========================================================================================================
select public.inst_ia_creer_cle('Assistant') as cle \gset
select set_config('app.cle', :'cle', false) \g /dev/null
reset role; set role anon;
select public.api_institution(:'cle', 'tableau_de_bord', json_build_object('campagne_id', :'camp_t1')::jsonb) as r1 \gset
select pg_temp.verifier((:'r1')::jsonb ->> 'perimetre' like '%Mfoundi' and (:'r1')::jsonb ->> 'periode' = 'T1 2026-2027' and ((:'r1')::jsonb ->> 'lecture_seule')::boolean
  and (:'r1')::jsonb ? 'nb_fiches_utilisees' and jsonb_array_length((:'r1')::jsonb -> 'donnees' -> 'liste') = 2,
  'H1 : réponse citant période, périmètre et nombre de fiches ; limitée au département');
select public.api_institution(:'cle', 'consolidation', json_build_object('campagne_id', :'camp_t1')::jsonb) as r2 \gset
select pg_temp.verifier(not ((:'r2')::jsonb -> 'donnees' ? 'detail') and ((:'r2')::jsonb -> 'donnees' ->> 'nb_fiches')::int = 2, 'H2 : indicateurs consolidés sans détail par défaut');
do $$ begin perform public.api_institution(current_setting('app.cle'), 'detail_fiche', '{"nom": "Lycée"}'); raise exception 'ÉCHEC : catégorie non autorisée';
exception when insufficient_privilege then raise notice 'ok : H3 catégorie de données non autorisée refusée'; end $$;
do $$ begin perform public.api_institution(current_setting('app.cle'), 'publier_fiche', '{}'); raise exception 'ÉCHEC : outil d''écriture';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : H4 aucun outil d''écriture (publier, modifier, valider, envoyer)'; end $$;
do $$ begin perform public.api_institution('nxd_' || repeat('0', 48), 'contexte', '{}'); raise exception 'ÉCHEC : clé inconnue acceptée';
exception when insufficient_privilege then raise notice 'ok : H5 clé inconnue refusée'; end $$;
reset role; set role authenticated;
select pg_temp.etre(:'P') \g /dev/null
select public.console_inst_delegation(:'del_mfoundi', '{"ia_categories": ["statuts", "indicateurs", "detail_lignes"]}') \g /dev/null
reset role; set role anon;
select public.api_institution(:'cle', 'detail_fiche', json_build_object('campagne_id', :'camp_t1', 'nom', 'Pilote')::jsonb) as r3 \gset
select pg_temp.verifier(jsonb_array_length((:'r3')::jsonb -> 'donnees' -> 'lignes') = 2 and not ((:'r3')::jsonb -> 'donnees' -> 'lignes' -> 0 ? 'enseignant')
  and not ((:'r3')::jsonb::text like '%ONANA%'), 'H6 : détail autorisé sans nom d''enseignant ni d''élève');
reset role;
select pg_temp.verifier((select count(*) from public.inst_journal where action = 'appel MCP' and objet_id = :'del_mfoundi') = 3, 'H7 : appels MCP réussis journalisés');
set role authenticated;
select pg_temp.etre(:'D1N') \g /dev/null
select public.inst_ia_revoquer((public.inst_ia_cles() -> 'cles' -> 0 ->> 'id')::uuid) \g /dev/null
reset role; set role anon;
do $$ begin perform public.api_institution(current_setting('app.cle'), 'contexte', '{}'); raise exception 'ÉCHEC : clé révoquée acceptée';
exception when insufficient_privilege then raise notice 'ok : H8 clé révoquée refusée'; end $$;

-- =========================================================================================================
-- I. Protections et non-régression
-- =========================================================================================================
do $$ begin perform public.inst_fiche_publier(current_setting('app.fiche1')::uuid, true); raise exception 'ÉCHEC : appel anonyme';
exception when insufficient_privilege then raise notice 'ok : I1 fonctions institutionnelles fermées aux visiteurs anonymes'; end $$;
reset role;
do $$ begin update public.inst_journal set action = 'x'; raise exception 'ÉCHEC : journal modifié';
exception when insufficient_privilege then raise notice 'ok : I2 journal d''audit infalsifiable'; end $$;
set role authenticated;
do $$ begin perform pg_temp.etre(current_setting('app.E1')::uuid); perform * from public.inst_fiche_versions; raise exception 'ÉCHEC : lecture directe des versions';
exception when insufficient_privilege then raise notice 'ok : I3 aucune lecture directe des tables institutionnelles'; end $$;
-- alertes quotidiennes idempotentes
select pg_temp.etre(:'P') \g /dev/null
select public.console_inst_campagne(json_build_object('niveau', 'etablissement', 'exercice', '2026-2027', 'periode', 't2',
  'ouverture', public._aujourdhui(), 'echeance', public._aujourdhui() + 30)::jsonb) as camp_t2 \gset
reset role; set role anon;
select public.inst_alertes_quotidiennes() as n1 \gset
select public.inst_alertes_quotidiennes() as n2 \gset
reset role;
select pg_temp.verifier(:n1 >= 2 and :n2 = 0
  and (select count(*) from public.inst_notifications where objet_id = :'camp_t2' and type = 'alerte' and etablissement_id in (:'etab1', :'etab2')) = 2
  and not exists (select 1 from public.inst_notifications where objet_id = :'camp_t2' and type = 'alerte' and etablissement_id in (:'etab3', :'etab4')),
  'I4 : alertes d''ouverture aux seuls établissements rattachés et routables, sans doublon');
-- bilan annuel : cumul des trimestres publiés et périodes manquantes signalées
set role authenticated;
select pg_temp.etre(:'P') \g /dev/null
select public.console_inst_campagne(json_build_object('niveau', 'etablissement', 'exercice', '2026-2027', 'periode', 'annuel',
  'ouverture', public._aujourdhui() - 1, 'echeance', public._aujourdhui() + 60)::jsonb) as camp_an \gset
select pg_temp.etre(:'E1') \g /dev/null
select public.inst_fiche_preparer(:'camp_an') as fiche_an \gset
select public.inst_fiche_lire(:'fiche_an') -> 'brouillon' as an \gset
select pg_temp.verifier((:'an')::jsonb -> 'periodes_manquantes' = '["t2", "t3"]'::jsonb and ((:'an')::jsonb -> 'lignes' -> 0 ->> 'prevues_t')::numeric = 20,
  'I5 : fiche annuelle pré-remplie par cumul des trimestres publiés, trimestres manquants signalés');
reset role;
select pg_temp.verifier((select count(*) from public.etablissements where id in (:'etab1', :'etab2', :'etab3') and rattachement_statut = 'verifie') = 3,
  'I6 : rattachements vérifiés conservés');
reset role;
