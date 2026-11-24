-- Pilotage financier (0054) : scénarios d'acceptation A à F de la mission « Finances »
--  A facturation · B encaissements · C dépenses · D trésorerie · E paie · F assistant financier via MCP
-- (G non-régression : l'ensemble des autres scénarios du banc, exécutés avant celui-ci)
-- Établissement dédié, pour ne dépendre d'aucun autre scénario.
reset role;
-- lecture directe des calculs internes (fonctions non exposées aux comptes) pour les vérifications
create or replace function pg_temp.solde(p uuid) returns bigint language sql security definer as $$ select public._solde_compte(p, public._aujourdhui()) $$;
create or replace function pg_temp.droits(p uuid) returns text[] language sql security definer as $$ select public._droits_finance(p) $$;
insert into auth.users (id, email) values ('4f1a4ce0-0000-4000-8000-00000000f1a4', 'directeur.finances@gmail.com');
\set admin_f 4f1a4ce0-0000-4000-8000-00000000f1a4
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "google"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_f', false) \g /dev/null
select public.creer_etablissement_google('Institut Pilote des Finances', 'Bafoussam', '', '', '', '', 'Kamga', 'Jean') \g /dev/null
select public.etab_courant() as etab_f \gset
reset role;
update public.etablissements set offre = 'premium' where id = :'etab_f';
delete from public.fonctions_etablissement where etablissement_id = :'etab_f';
set role authenticated;
insert into public.exercices (libelle, actif) values ('2026-2027', true) returning id as ex_f \gset
insert into public.classes (libelle, niveau) values ('Tle A', 'Tle') returning id as cl_f1 \gset
insert into public.classes (libelle, niveau) values ('3e B', '3e') returning id as cl_f2 \gset
insert into public.eleves (matricule, nom, prenom, sexe) values ('PF1', 'MBALLA', 'Anne', 'F') returning id as el1 \gset
insert into public.eleves (matricule, nom, prenom, sexe) values ('PF2', 'NKOLO', 'Paul', 'M') returning id as el2 \gset
insert into public.eleves (matricule, nom, prenom, sexe) values ('PF3', 'ATANGA', 'Rita', 'F') returning id as el3 \gset
insert into public.inscriptions (exercice_id, classe_id, eleve_id) values (:'ex_f', :'cl_f1', :'el1') returning id as i1 \gset
insert into public.inscriptions (exercice_id, classe_id, eleve_id) values (:'ex_f', :'cl_f1', :'el2') returning id as i2 \gset
insert into public.inscriptions (exercice_id, classe_id, eleve_id) values (:'ex_f', :'cl_f2', :'el3') returning id as i3 \gset
select (public.creer_personnel('Ngono', 'Paule', 'comptable', 'C1', '')->>'id') as compta \gset
select (public.creer_personnel('Owona', 'Eric', 'comptable', 'C2', '')->>'id') as caissier \gset
select (public.creer_personnel('Biyong', 'Luc', 'enseignant', 'E1', '')->>'id') as prof_f \gset
select set_config('app.i1', :'i1', false), set_config('app.i2', :'i2', false), set_config('app.i3', :'i3', false),
       set_config('app.cl_f1', :'cl_f1', false), set_config('app.cl_f2', :'cl_f2', false), set_config('app.etab_f', :'etab_f', false) \g /dev/null

-- Droits financiers : l'administration restreint un comptable au rôle de caissier
select public.finance_droits_definir(:'caissier', array['caisse']) \g /dev/null
select pg_temp.verifier(pg_temp.droits(:'caissier') = array['caisse']
  and pg_temp.droits(:'compta') @> array['caisse', 'facturation', 'depenses', 'tresorerie', 'rapports', 'assistant']
  and not ('paie' = any (pg_temp.droits(:'compta'))) and not ('validation' = any (pg_temp.droits(:'compta')))
  and pg_temp.droits(:'prof_f') = '{}' and cardinality(pg_temp.droits(:'admin_f')) = 8,
  'droits : administration = tout ; comptable = tous les droits du caissier et plus (sans validation ni paie) ; caissier = caisse ; enseignant = rien');
select set_config('request.jwt.claim.sub', :'compta', false) \g /dev/null
do $$ begin perform public.finance_droits_definir(current_setting('app.i1')::uuid, null); raise exception 'ÉCHEC : droits modifiés par le comptable';
exception when insufficient_privilege then raise notice 'ok : seuls les administrateurs règlent les droits financiers'; end $$;

-- Pension de l'année (Frais et délais) : 150 000, inscription échue, tranche 1 échue
select public.finance_enregistrer_frais(150000, 150000, json_build_array(
  json_build_object('montant', 30000, 'date_limite', public._aujourdhui() - 30), json_build_object('montant', 30000, 'date_limite', public._aujourdhui() - 5),
  json_build_object('montant', 30000, 'date_limite', public._aujourdhui() + 30), json_build_object('montant', 30000, 'date_limite', public._aujourdhui() + 60),
  json_build_object('montant', 30000, 'date_limite', public._aujourdhui() + 90))::jsonb) \g /dev/null

-- D.1 Comptes de trésorerie (avant tout encaissement, pour l'affectation automatique)
select public.finance_compte_enregistrer(json_build_object('libelle', 'Caisse principale', 'type', 'caisse', 'modes', json_build_array('especes'),
  'solde_initial', 100000, 'date_solde_initial', public._aujourdhui() - 10, 'par_defaut', true)::jsonb) as caisse \gset
select public.finance_compte_enregistrer(json_build_object('libelle', 'Banque Atlantique', 'type', 'banque', 'modes', json_build_array('virement', 'cheque'),
  'solde_initial', 500000, 'date_solde_initial', public._aujourdhui() - 10)::jsonb) as banque \gset
select public.finance_compte_enregistrer(json_build_object('libelle', 'MTN MoMo école', 'type', 'mtn_momo', 'modes', json_build_array('mtn_momo'),
  'solde_initial', 0, 'date_solde_initial', public._aujourdhui() - 10)::jsonb) as momo \gset
select pg_temp.verifier((select count(*) from public.comptes_financiers where etablissement_id = :'etab_f') = 3
  and pg_temp.solde(:'caisse') = 100000, 'D1 : trois comptes créés (caisse, banque, MTN MoMo) avec leur solde initial');

-- =========================================================================================================
-- A. Facturation (comptable)
-- =========================================================================================================
do $$ begin perform public.finance_categorie_enregistrer(json_build_object('libelle', 'Frais d''examen', 'tranches', json_build_array(
    json_build_object('pourcentage', 60, 'date_limite', public._aujourdhui()), json_build_object('pourcentage', 30, 'date_limite', public._aujourdhui() + 9)))::jsonb);
  raise exception 'ÉCHEC : tranches à 90 %% acceptées';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : A3 tranches dont le total n''est pas 100 %% refusées'; end $$;
select public.finance_categorie_enregistrer(json_build_object('libelle', 'Frais d''examen', 'description', 'Examens officiels',
  'montants', json_build_array(json_build_object('classe_id', :'cl_f1', 'montant', 20000), json_build_object('classe_id', null, 'montant', 10000)),
  'tranches', json_build_array(json_build_object('libelle', 'Première moitié', 'pourcentage', 50, 'date_limite', public._aujourdhui() - 1),
                               json_build_object('libelle', 'Solde', 'pourcentage', 50, 'date_limite', public._aujourdhui() + 30)))::jsonb) as cat_exam \gset
select set_config('app.cat_exam', :'cat_exam', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.frais_montants where categorie_id = :'cat_exam') = 2
  and (select count(*) from public.frais_tranches where categorie_id = :'cat_exam') = 2,
  'A1-A3 : catégorie créée, montant propre à la Tle A et montant « toutes classes », deux échéances');
select public.finance_facturer(json_build_object('categorie_id', :'cat_exam', 'classe_id', :'cl_f1')::jsonb) as fac1 \gset
select public.finance_facturer(json_build_object('categorie_id', :'cat_exam', 'classe_id', :'cl_f2')::jsonb) as fac2 \gset
select pg_temp.verifier((:'fac1'::json->>'crees')::int = 2 and (:'fac2'::json->>'crees')::int = 1
  and (select montant_brut from public.factures where inscription_id = :'i1' and categorie_id = :'cat_exam') = 20000
  and (select montant_brut from public.factures where inscription_id = :'i3' and categorie_id = :'cat_exam') = 10000,
  'A4 : factures générées (20 000 en Tle A, 10 000 ailleurs)');
select public.finance_facturer(json_build_object('categorie_id', :'cat_exam', 'classe_id', :'cl_f1')::jsonb) as fac3 \gset
select pg_temp.verifier((:'fac3'::json->>'crees')::int = 0 and (:'fac3'::json->>'ignores')::int = 2
  and (select count(distinct numero) = count(*) from public.factures where etablissement_id = :'etab_f'),
  'A5 : aucune facture en double (élèves déjà facturés ignorés), numéros uniques');
do $$ begin insert into public.factures (exercice_id, inscription_id, numero, montant_brut) values (gen_random_uuid(), current_setting('app.i1')::uuid, 999, 1);
  raise exception 'ÉCHEC : facture insérée directement';
exception when insufficient_privilege then raise notice 'ok : A5 aucune facture créée hors du service de facturation'; end $$;
select public.finance_facturer(json_build_object('categorie_id', null, 'classe_id', :'cl_f1')::jsonb) \g /dev/null
select pg_temp.verifier((select count(*) from public.factures where categorie_id is null and etablissement_id = :'etab_f') = 2, 'A4 : factures de pension émises (Tle A)');

-- A6 Bourse de 20 % sur la pension de i1 ; exonération des frais d'examen pour i2
select public.finance_remise_accorder(json_build_object('inscription_id', :'i1', 'nature', 'bourse', 'type', 'pourcentage', 'valeur', 20,
  'motif', 'Bourse d''excellence')::jsonb) as remise1 \gset
select public.finance_remise_accorder(json_build_object('inscription_id', :'i2', 'categorie_id', :'cat_exam', 'nature', 'exoneration',
  'motif', 'Enfant du personnel')::jsonb) \g /dev/null
do $$ begin perform public.finance_remise_accorder(json_build_object('inscription_id', current_setting('app.i3'), 'nature', 'reduction', 'type', 'montant', 'valeur', 5000, 'motif', '')::jsonb);
  raise exception 'ÉCHEC : remise sans motif';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : A6 une remise exige un motif'; end $$;
create or replace function pg_temp.sit(p uuid) returns json language sql as $$ select public.finance_situation_eleve(p) $$;
create or replace function pg_temp.fe(p uuid) returns json language sql as $$
  select e from json_array_elements(public.finance_eleves(null)->'eleves') e where (e->>'inscription_id')::uuid = p $$;
select pg_temp.verifier((pg_temp.fe(:'i1')->>'total_du')::int = 120000 and (pg_temp.fe(:'i1')->>'remise')::int = 30000
  and (pg_temp.fe(:'i1')->'lignes'->4->>'montant')::int = 0 and (pg_temp.fe(:'i1')->'lignes'->0->>'montant')::int = 30000,
  'A6 : bourse de 20 % → dû 120 000, la remise allège la dernière tranche (inscription inchangée)');
select pg_temp.verifier((select s->>'reste' from json_array_elements(pg_temp.sit(:'i2')->'autres') s where (s->>'categorie_id')::uuid = :'cat_exam')::int = 0,
  'A6 : exonération des frais d''examen → reste 0');
select (select r.accorde_par = :'compta'::uuid and r.motif = 'Bourse d''excellence' and r.accorde_le is not null from public.finance_remises r where r.id = :'remise1') as tr \gset
select pg_temp.verifier(:'tr'::boolean, 'A6 : remise tracée (auteur, motif, date)');

-- A7 Dette antérieure (créance d'une année précédente) suivie à part
select public.finance_categorie_enregistrer(json_build_object('libelle', 'Reliquat 2025-2026', 'nature', 'dette_anterieure')::jsonb) as cat_dette \gset
select public.finance_facturer(json_build_object('categorie_id', :'cat_dette', 'inscriptions', json_build_array(:'i3'), 'montant', 45000)::jsonb) \g /dev/null
select pg_temp.verifier((select (s->>'reste')::int = 45000 and (s->>'retard')::int = 45000 and s->>'nature' = 'dette_anterieure'
    from json_array_elements(pg_temp.sit(:'i3')->'autres') s where (s->>'categorie_id')::uuid = :'cat_dette')
  and (pg_temp.sit(:'i3')->'pension'->>'reste')::int = 150000,
  'A7 : dette antérieure conservée (45 000 exigibles), distincte de la pension de l''année');

-- =========================================================================================================
-- B. Encaissements (caissier : droit « caisse » seulement)
-- =========================================================================================================
select set_config('request.jwt.claim.sub', :'caissier', false) \g /dev/null
do $$ begin perform public.finance_facturer(json_build_object('categorie_id', current_setting('app.cat_exam'), 'classe_id', current_setting('app.cl_f2'))::jsonb);
  raise exception 'ÉCHEC : facturation par le caissier';
exception when insufficient_privilege then raise notice 'ok : le caissier ne facture pas'; end $$;
select public.finance_encaisser(json_build_object('inscription_id', :'i3', 'categorie_id', :'cat_exam', 'montant', 10000, 'mode', 'especes',
  'payeur', 'Mme ATANGA', 'cle', 'cle-b1-0000001')::jsonb) as rb1 \gset
select pg_temp.verifier((select (s->>'reste')::int from json_array_elements(pg_temp.sit(:'i3')->'autres') s where (s->>'categorie_id')::uuid = :'cat_exam') = 0,
  'B1 : paiement intégral des frais d''examen → reste 0');
select public.finance_encaisser(json_build_object('inscription_id', :'i1', 'montant', 50000, 'mode', 'mtn_momo', 'reference', 'MP2611.1234',
  'cle', 'cle-b2-0000001')::jsonb) as rb2 \gset
select pg_temp.verifier((pg_temp.sit(:'i1')->'pension'->>'reste')::int = 70000 and (pg_temp.fe(:'i1')->>'paye')::int = 50000,
  'B2-B3 : paiement partiel de 50 000 → solde de l''élève 70 000 (après bourse)');
select pg_temp.verifier((:'rb2'::json->>'numero')::int = (:'rb1'::json->>'numero')::int + 1
  and (select count(*) = count(distinct numero) from public.paiements where etablissement_id = :'etab_f'), 'B5 : numéros de reçu uniques et consécutifs');
select pg_temp.verifier((public.verifier_document_finance(:'rb2'::json->>'code_verif')->>'statut') = 'valide'
  and (public.verifier_document_finance(:'rb2'::json->>'code_verif')->>'beneficiaire') = 'M. A.'
  and public.verifier_document_finance('ABCDEF') is null, 'B4 : le QR code du reçu se vérifie (initiales seulement) ; un faux code ne donne rien');
select public.finance_encaisser(json_build_object('inscription_id', :'i1', 'montant', 50000, 'mode', 'mtn_momo', 'cle', 'cle-b2-0000001')::jsonb) as rb2bis \gset
select pg_temp.verifier((:'rb2bis'::json->>'deja_enregistre')::boolean and (:'rb2bis'::json->>'id') = (:'rb2'::json->>'id')
  and (select count(*) from public.paiements where cle_idempotence = 'cle-b2-0000001') = 1, 'B7 : double envoi (même clé) → un seul encaissement');
do $$ begin perform public.finance_encaisser(json_build_object('inscription_id', current_setting('app.i3'), 'categorie_id', current_setting('app.cat_exam'),
    'montant', 1000, 'mode', 'especes')::jsonb); raise exception 'ÉCHEC : trop-perçu sur une rubrique';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : B7 un encaissement au-delà du reste dû est refusé'; end $$;
do $$ begin perform public.finance_encaisser(json_build_object('inscription_id', current_setting('app.i1'), 'montant', 1000, 'mode', 'carte')::jsonb);
  raise exception 'ÉCHEC : mode non proposé accepté';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : un mode de paiement non proposé par l''établissement est refusé'; end $$;
-- B8 paiement en attente : jamais compté avant confirmation
select public.finance_encaisser(json_build_object('inscription_id', :'i1', 'montant', 20000, 'mode', 'mtn_momo', 'reference', 'MP-ATT-1',
  'en_attente', true, 'cle', 'cle-b8-0000001')::jsonb) as att1 \gset
select public.finance_encaisser(json_build_object('inscription_id', :'i1', 'montant', 5000, 'mode', 'mtn_momo', 'en_attente', true)::jsonb) as att2 \gset
select pg_temp.verifier((pg_temp.sit(:'i1')->'pension'->>'reste')::int = 70000, 'B8 : un paiement en attente ne réduit pas le solde');
select public.finance_attente_traiter((:'att1'::json->>'attente_id')::uuid, true, 'Confirmé sur le relevé MoMo') as conf1 \gset
select public.finance_attente_traiter((:'att2'::json->>'attente_id')::uuid, false, 'Transaction introuvable chez l''opérateur') \g /dev/null
select pg_temp.verifier((pg_temp.sit(:'i1')->'pension'->>'reste')::int = 50000
  and (select statut from public.paiements_attente where id = (:'att2'::json->>'attente_id')::uuid) = 'rejete',
  'B8 : confirmé → compté (reste 50 000) ; rejeté → jamais compté');
-- B9 annulation tracée (remboursement d'une erreur) par contre-écriture
select public.finance_encaisser(json_build_object('inscription_id', :'i2', 'montant', 15000, 'mode', 'especes')::jsonb) as rb9 \gset
select public.finance_annuler_paiement((:'rb9'::json->>'id')::uuid, 'Montant saisi par erreur') \g /dev/null
select pg_temp.verifier((select count(*) from public.paiements where id = (:'rb9'::json->>'id')::uuid) = 1
  and (pg_temp.sit(:'i2')->'pension'->>'paye')::int = 0
  and (public.verifier_document_finance((select code_verif from public.paiements where id = (:'rb9'::json->>'id')::uuid))->>'statut') = 'annule',
  'B9 : annulation par contre-écriture : reçu conservé, marqué annulé, solde rétabli, journalisée');
reset role;
select pg_temp.verifier(exists (select 1 from public.finance_journal where action = 'annulation encaissement' and objet_id = (:'rb9'::json->>'id')::uuid),
  'B9 : annulation journalisée (auteur, motif)');
set role authenticated;
select pg_temp.verifier(json_array_length(public.finance_encaissements(json_build_object('debut', public._aujourdhui() - 1)::jsonb)) = 5,
  'B6 : historique des encaissements (4 reçus et 1 contre-écriture)');
do $$ begin perform public.finance_tableau_bord(null, null); raise exception 'ÉCHEC : tableau de bord ouvert au caissier';
exception when insufficient_privilege then raise notice 'ok : le caissier n''a pas le tableau de bord (droit rapports)'; end $$;

-- D.2 Affectation des encaissements aux comptes
select pg_temp.verifier(pg_temp.solde(:'caisse') = 100000 + 10000 + 15000 - 15000
  and pg_temp.solde(:'momo') = 70000,
  'D2 : espèces → caisse (annulation déduite), MTN MoMo → compte MoMo (50 000 + 20 000 confirmés)');

-- =========================================================================================================
-- C. Dépenses (comptable : saisie ; administration : validation ; comptable : paiement)
-- =========================================================================================================
select set_config('request.jwt.claim.sub', :'caissier', false) \g /dev/null
do $$ begin perform public.finance_depense_categorie_enregistrer('{"libelle":"Pirate"}'); raise exception 'ÉCHEC : dépense par le caissier';
exception when insufficient_privilege then raise notice 'ok : le caissier ne saisit pas de dépense'; end $$;
select set_config('request.jwt.claim.sub', :'compta', false) \g /dev/null
select public.finance_depense_categorie_enregistrer('{"libelle":"Fournitures scolaires"}') as dcat \gset
select public.finance_fournisseur_enregistrer('{"nom":"Librairie du Centre","telephone":"699 11 22 33"}') as fourn \gset
insert into storage.objects (bucket_id, name) values ('justificatifs', :'etab_f' || '/depenses/facture-craies.pdf');
select pg_temp.verifier((select count(*) from storage.objects where bucket_id = 'justificatifs') = 1, 'C3 : pièce justificative déposée dans le compartiment privé');
do $$ begin perform public.finance_depense_enregistrer(json_build_object('categorie_id', (select id from public.depenses_categories where libelle = 'Fournitures scolaires'),
    'libelle', 'Craies', 'montant', 1000, 'justificatif', 'autre-ecole/depenses/x.pdf')::jsonb); raise exception 'ÉCHEC : justificatif d''un autre établissement';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : C3 un justificatif hors de l''établissement est refusé'; end $$;
select public.finance_depense_enregistrer(json_build_object('categorie_id', :'dcat', 'fournisseur_id', :'fourn', 'libelle', 'Craies et cahiers',
  'montant', 25000, 'justificatif', :'etab_f' || '/depenses/facture-craies.pdf')::jsonb) as dep1 \gset
select public.finance_depense_enregistrer(json_build_object('categorie_id', :'dcat', 'libelle', 'Photocopies', 'montant', 8000, 'soumettre', true)::jsonb) as dep2 \gset
select set_config('app.dep1', :'dep1'::json->>'id', false) \g /dev/null
select public.finance_depense_action((:'dep1'::json->>'id')::uuid, 'soumettre') \g /dev/null
do $$ begin perform public.finance_depense_action(current_setting('app.dep1')::uuid, 'approuver'); raise exception 'ÉCHEC : auto-validation';
exception when insufficient_privilege then raise notice 'ok : C5 le comptable ne valide pas (droit validation requis)'; end $$;
select pg_temp.verifier(pg_temp.solde(:'caisse') = 110000, 'C : une dépense en attente ne touche pas la trésorerie');
select set_config('request.jwt.claim.sub', :'admin_f', false) \g /dev/null
select public.finance_depense_action((:'dep1'::json->>'id')::uuid, 'approuver') \g /dev/null
do $$ begin perform public.finance_depense_action((select id from public.depenses where libelle = 'Photocopies'), 'rejeter', '{}'); raise exception 'ÉCHEC : rejet sans motif';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : C5 un rejet exige un motif'; end $$;
select public.finance_depense_action((:'dep2'::json->>'id')::uuid, 'rejeter', '{"motif":"Devis manquant"}') \g /dev/null
select pg_temp.verifier((select statut from public.depenses where id = (:'dep1'::json->>'id')::uuid) = 'approuvee'
  and (select statut from public.depenses where id = (:'dep2'::json->>'id')::uuid) = 'rejetee'
  and pg_temp.solde(:'caisse') = 110000, 'C4-C5 : approbation et rejet ; une dépense approuvée non payée ne sort pas de la caisse');
select set_config('request.jwt.claim.sub', :'compta', false) \g /dev/null
select public.finance_depense_action((:'dep1'::json->>'id')::uuid, 'payer', json_build_object('compte_id', :'caisse', 'mode', 'especes')::jsonb) \g /dev/null
select pg_temp.verifier((select statut from public.depenses where id = (:'dep1'::json->>'id')::uuid) = 'payee'
  and pg_temp.solde(:'caisse') = 85000
  and (select count(*) from public.mouvements_tresorerie where source_id = (:'dep1'::json->>'id')::uuid) = 1,
  'C6-C7 : dépense payée → une seule sortie de caisse (110 000 → 85 000)');
reset role;
select pg_temp.verifier((select count(*) from public.finance_journal where objet = 'depense' and objet_id = (:'dep1'::json->>'id')::uuid) = 4,
  'C8 : historique complet (création, soumission, approbation, paiement)');
set role authenticated;
do $$ begin perform public.finance_depense_action(current_setting('app.dep1')::uuid, 'payer', '{}'); raise exception 'ÉCHEC : dépense payée deux fois';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : une dépense ne se paie qu''une fois'; end $$;

-- =========================================================================================================
-- D. Trésorerie (suite)
-- =========================================================================================================
select public.finance_tableau_bord(public._aujourdhui() - 1, public._aujourdhui()) as tb_avant \gset
select public.finance_virement(json_build_object('compte_source', :'caisse', 'compte_destination', :'banque', 'montant', 30000, 'motif', 'Versement en banque')::jsonb) as vir \gset
select public.finance_tableau_bord(public._aujourdhui() - 1, public._aujourdhui()) as tb_apres \gset
select pg_temp.verifier(pg_temp.solde(:'caisse') = 55000 and pg_temp.solde(:'banque') = 530000,
  'D4 : virement caisse → banque (55 000 / 530 000)');
select pg_temp.verifier((:'tb_avant'::json->'encaissements'->>'total') = (:'tb_apres'::json->'encaissements'->>'total')
  and (:'tb_avant'::json->'depenses'->>'total') = (:'tb_apres'::json->'depenses'->>'total')
  and (:'tb_apres'::json->'encaissements'->>'total')::int = 10000 + 50000 + 20000 + 15000 - 15000
  and (:'tb_apres'::json->'depenses'->>'total')::int = 25000,
  'D5 : le virement ne crée ni recette ni dépense (tableau de bord inchangé)');
do $$ begin perform public.finance_virement(json_build_object('compte_source', (select id from public.comptes_financiers where libelle = 'Caisse principale'),
    'compte_destination', (select id from public.comptes_financiers where libelle = 'Banque Atlantique'), 'montant', 999999)::jsonb);
  raise exception 'ÉCHEC : caisse négative';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : une caisse ne peut pas devenir négative'; end $$;
-- D6-D7 clôtures : veille de la caisse sans écart ; banque avec écart justifié obligatoire
select public.finance_cloturer(json_build_object('compte_id', :'caisse', 'date', public._aujourdhui() - 1, 'solde_constate', 100000)::jsonb) as clo1 \gset
select pg_temp.verifier((:'clo1'::json->>'ecart')::int = 0, 'D6 : clôture journalière de la caisse sans écart');
do $$ begin perform public.finance_encaisser(json_build_object('inscription_id', current_setting('app.i2'), 'montant', 1000, 'mode', 'especes', 'date', public._aujourdhui() - 1)::jsonb);
  raise exception 'ÉCHEC : écriture sur une journée clôturée';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : D6 une journée clôturée ne reçoit plus d''opération'; end $$;
do $$ begin perform public.finance_cloturer(json_build_object('compte_id', (select id from public.comptes_financiers where libelle = 'Banque Atlantique'), 'date', public._aujourdhui() - 1, 'solde_constate', 499500)::jsonb);
  raise exception 'ÉCHEC : écart sans justification';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : D7 un écart de caisse exige une justification'; end $$;
select public.finance_cloturer(json_build_object('compte_id', :'banque', 'date', public._aujourdhui() - 1, 'solde_constate', 499500, 'justification', 'Frais bancaires non encore saisis')::jsonb) as clo2 \gset
select pg_temp.verifier((:'clo2'::json->>'ecart')::int = -500 and (select count(*) from public.clotures_caisse where compte_id = :'banque') = 1,
  'D7 : écart de -500 enregistré avec sa justification');
do $$ begin update public.clotures_caisse set solde_constate = 0; raise exception 'ÉCHEC : clôture modifiable';
exception when insufficient_privilege then raise notice 'ok : une clôture est définitive'; end $$;
-- D8 rapprochement (relevé importé, suggestion, confirmation manuelle) — rien n'est rapproché automatiquement
select public.finance_releve_importer(:'banque', json_build_array(
  json_build_object('date', public._aujourdhui(), 'libelle', 'VERSEMENT ESPECES', 'montant', 30000),
  json_build_object('date', public._aujourdhui(), 'libelle', 'FRAIS TENUE DE COMPTE', 'montant', -500))::jsonb) as rel1 \gset
select public.finance_releve_importer(:'banque', json_build_array(
  json_build_object('date', public._aujourdhui(), 'libelle', 'VERSEMENT ESPECES', 'montant', 30000))::jsonb) as rel2 \gset
select pg_temp.verifier((:'rel1'::json->>'importees')::int = 2 and (:'rel2'::json->>'doublons')::int = 1, 'D8 : relevé importé ; ligne déjà importée détectée comme doublon');
select (select l->'suggestions'->0->>'id' from json_array_elements(public.finance_rapprochement(:'banque')->'lignes') l where (l->>'montant')::int = 30000) as sugg,
       (select l->>'id' from json_array_elements(public.finance_rapprochement(:'banque')->'lignes') l where (l->>'montant')::int = 30000) as lig30,
       (select l->>'id' from json_array_elements(public.finance_rapprochement(:'banque')->'lignes') l where (l->>'montant')::int = -500) as lig5 \gset
select pg_temp.verifier(:'sugg' is not null and (select l.mouvement_id is null from public.lignes_releve l where l.id = :'lig30'),
  'D8 : le virement est proposé pour la ligne de 30 000, sans rapprochement automatique');
select public.finance_rapprocher(:'lig30', :'sugg') \g /dev/null
select set_config('app.lig5', :'lig5', false), set_config('app.sugg', :'sugg', false) \g /dev/null
do $$ begin perform public.finance_rapprocher(current_setting('app.lig5')::uuid, current_setting('app.sugg')::uuid); raise exception 'ÉCHEC : montants différents rapprochés';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : D8 rapprochement refusé si les montants diffèrent'; end $$;
select pg_temp.verifier((select mouvement_id from public.lignes_releve where id = :'lig30') = :'sugg'::uuid
  and (select mouvement_id is null from public.lignes_releve where id = :'lig5'), 'D8 : mouvement externe rapproché après confirmation ; la ligne de frais reste à traiter');

-- =========================================================================================================
-- E. Paie (administration ; le comptable n'a pas le droit « paie » par défaut)
-- =========================================================================================================
do $$ begin perform public.finance_paies(null); raise exception 'ÉCHEC : paie ouverte au comptable';
exception when insufficient_privilege then raise notice 'ok : E10 la paie est fermée au comptable sans droit « paie »'; end $$;
select set_config('request.jwt.claim.sub', :'admin_f', false) \g /dev/null
select date_trunc('month', public._aujourdhui())::date as mois \gset
select public.finance_paie_element_ajouter(json_build_object('personnel_id', :'compta', 'type', 'base', 'montant', 200000, 'date_effet', :'mois')::jsonb) \g /dev/null
select public.finance_paie_element_ajouter(json_build_object('personnel_id', :'compta', 'type', 'prime', 'libelle', 'Prime de responsabilité', 'montant', 15000, 'date_effet', :'mois')::jsonb) \g /dev/null
select public.finance_paie_element_ajouter(json_build_object('personnel_id', :'compta', 'type', 'retenue', 'libelle', 'Avance sur salaire', 'montant', 5000, 'date_effet', :'mois')::jsonb) \g /dev/null
select public.finance_paie_parametre_enregistrer(json_build_object('libelle', 'Cotisation (taux à vérifier)', 'type', 'cotisation_salariale', 'mode', 'taux',
  'valeur', 4, 'actif', true, 'date_effet', :'mois')::jsonb) \g /dev/null
do $$ begin perform public.finance_paie_parametre_enregistrer('{"libelle":"Impôt","type":"impot","mode":"taux","valeur":10,"verifie":true}'); raise exception 'ÉCHEC : vérifié sans source';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : un paramètre ne se marque « vérifié » qu''avec sa source officielle'; end $$;
select pg_temp.verifier((select count(*) from public.paie_parametres where etablissement_id = :'etab_f') = 1, 'aucun paramètre de paie fourni par défaut (aucun taux codé)');
select public.finance_paie_preparer(:'mois', null) as prep \gset
select pg_temp.verifier((:'prep'::json->>'creees')::int = 1, 'E1-E3 : paie du mois préparée pour le seul employé ayant un salaire de base');
select id as paie1 from public.paies where personnel_id = :'compta' and periode = :'mois' \gset
select pg_temp.verifier((select brut = 215000 and retenues = 5000 + 8600 and net = 215000 - 13600 and parametres_non_verifies from public.paies where id = :'paie1'),
  'E4 : brut 215 000 ; retenues 5 000 + 4 % (8 600) ; net 201 400 ; paramètre non vérifié signalé');
select public.finance_paie_preparer(:'mois', null) as prep2 \gset
select pg_temp.verifier((:'prep2'::json->>'creees')::int = 0, 'E : une seule paie par employé et par mois');
select public.finance_paie_action(:'paie1', 'soumettre') \g /dev/null
select public.finance_paie_action(:'paie1', 'valider') \g /dev/null
select public.finance_paie_action(:'paie1', 'payer', json_build_object('compte_id', :'banque', 'mode', 'virement')::jsonb) \g /dev/null
select pg_temp.verifier((select statut from public.paies where id = :'paie1') = 'payee'
  and (select count(*) from public.depenses where paie_id = :'paie1' and statut = 'payee' and montant = 201400) = 1
  and (select count(*) from public.mouvements_tresorerie m join public.depenses d on d.id = m.source_id where d.paie_id = :'paie1') = 1
  and pg_temp.solde(:'banque') = 530000 - 201400,
  'E6-E8 : paie validée puis payée → une seule dépense « Salaires » et un seul mouvement de banque');
select set_config('app.paie1', :'paie1', false) \g /dev/null
do $$ begin perform public.finance_paie_action(current_setting('app.paie1')::uuid, 'payer', '{}'); raise exception 'ÉCHEC : paie payée deux fois';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : E8 une paie ne se paie qu''une fois'; end $$;
select public.finance_paie_element_ajouter(json_build_object('personnel_id', :'compta', 'type', 'base', 'montant', 220000,
  'date_effet', (:'mois'::date + interval '1 month')::date)::jsonb) \g /dev/null
select pg_temp.verifier((select count(*) from public.paie_elements where personnel_id = :'compta' and type = 'base') = 2
  and (select date_fin from public.paie_elements where personnel_id = :'compta' and type = 'base' and montant = 200000) = (:'mois'::date + interval '1 month' - interval '1 day')::date,
  'E9 : historique salarial conservé (l''ancienne base prend fin la veille de la nouvelle)');
-- E10 confidentialité
select set_config('request.jwt.claim.sub', :'compta', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.paies) = 0 and (select count(*) from public.paie_elements) = 0
  and (select count(*) from public.depenses where paie_id is not null) = 0
  and not exists (select 1 from json_array_elements(public.finance_depenses('{}')) d where (d->>'paie')::boolean)
  and json_array_length(public.mes_bulletins_paie()) = 1,
  'E10 : sans droit « paie », aucune paie ni dépense de salaire visible ; chacun voit son propre bulletin');
do $$ begin perform public.finance_rapport('masse_salariale', null, null); raise exception 'ÉCHEC : masse salariale sans droit paie';
exception when insufficient_privilege then raise notice 'ok : E10 rapport de masse salariale réservé au droit « paie »'; end $$;
select pg_temp.verifier(not ((public.verifier_document_finance((select x->>'code_verif' from json_array_elements(public.mes_bulletins_paie()) x limit 1))) ?| array['montant', 'net', 'brut']),
  'E10 : la vérification publique d''un bulletin de paie ne montre aucun montant');
select set_config('request.jwt.claim.sub', :'prof_f', false) \g /dev/null
select pg_temp.verifier(json_array_length(public.mes_bulletins_paie()) = 0 and (select count(*) from public.paiements) = 0
  and (select count(*) from public.mouvements_tresorerie) = 0, 'isolation : un enseignant sans droit financier ne voit rien');

-- =========================================================================================================
-- F. Assistant financier via MCP (lecture seule, droits vérifiés côté serveur, journalisé)
-- =========================================================================================================
select set_config('request.jwt.claim.sub', :'admin_f', false) \g /dev/null
select public.definir_ia_personnelle(true) \g /dev/null
select (public.creer_cle_api('Assistant direction', false, 0))->>'cle' as cle_dir \gset
select set_config('request.jwt.claim.sub', :'compta', false) \g /dev/null
select public.definir_ia_personnelle(true) \g /dev/null
select (public.creer_cle_api('Assistant comptable', false, 0))->>'cle' as cle_cpt \gset
select set_config('request.jwt.claim.sub', :'caissier', false) \g /dev/null
select public.definir_ia_personnelle(true) \g /dev/null
select (public.creer_cle_api('Assistant caisse', false, 0))->>'cle' as cle_cai \gset
-- second établissement (isolation) : sans compte de trésorerie ni pension configurée
reset role;
insert into auth.users (id, email) values ('4f1a4ce0-0000-4000-8000-00000000f1b5', 'autre.directeur@gmail.com');
set role authenticated;
select set_config('request.jwt.claim.sub', '4f1a4ce0-0000-4000-8000-00000000f1b5', false) \g /dev/null
select public.creer_etablissement_google('Collège Témoin Isolation', 'Ebolowa', '', '', '', '', 'Mvondo', 'Alice') \g /dev/null
select public.etab_courant() as etab_g \gset
reset role;
update public.etablissements set offre = 'premium' where id = :'etab_g';
set role authenticated;
insert into public.exercices (libelle, actif) values ('2026-2027', true) \g /dev/null
select public.definir_ia_personnelle(true) \g /dev/null
select (public.creer_cle_api('Assistant B', true, 0))->>'cle' as cle_fb \gset
select set_config('app.cle_dir_ro', :'cle_dir', false) \g /dev/null
reset role;
select count(*) as nb_paiements_avant from public.paiements \gset
set role anon;
select public.api_finance(:'cle_dir', 'finance_tableau_bord', json_build_object('debut', public._aujourdhui() - 1, 'fin', public._aujourdhui())::jsonb) as f1 \gset
select pg_temp.verifier((:'f1'::json->'resultat'->'encaissements'->>'total')::int = 80000 and (:'f1'::json->'periode'->>'origine') = 'parametres'
  and (:'f1'::json->>'lecture_seule')::boolean, 'F1 : tableau de bord consulté via MCP (80 000 encaissés nets, période indiquée)');
select public.api_finance(:'cle_dir', 'finance_rapport', '{"type":"encaissements_mode"}'::jsonb) as f2 \gset
select pg_temp.verifier((select (l->>'montant')::int from json_array_elements(:'f2'::json->'resultat'->'lignes') l where l->>'mode' = 'mtn_momo') = 70000,
  'F2 : encaissements par mode (MTN MoMo : 70 000)');
select public.api_finance(:'cle_cpt', 'finance_rapport', '{"type":"impayes"}'::jsonb) as f3 \gset
select pg_temp.verifier((:'f3'::json->'resultat'->'totaux'->>'reste')::int = 50000 + 20000 + 150000 + 150000 + 45000,
  'F3 : impayés exacts (pension après bourse et paiements, examen, dette antérieure)');
select public.api_finance(:'cle_cpt', 'finance_depenses', '{"statut":"payee"}'::jsonb) as f4 \gset
select pg_temp.verifier(json_array_length(:'f4'::json->'resultat') = 1, 'F4 : dépenses payées (sans la dépense de salaire pour le comptable)');
select public.api_finance(:'cle_cpt', 'finance_tresorerie', '{}'::jsonb) as f5 \gset
select pg_temp.verifier((select (c->>'solde')::int from json_array_elements(:'f5'::json->'resultat'->'comptes') c where c->>'libelle' = 'Caisse principale') = 55000,
  'F5 : solde de caisse exact (55 000)');
select public.api_finance(:'cle_cpt', 'finance_rapport', '{"type":"masse_salariale"}'::jsonb) as f6a \gset
select public.api_finance(:'cle_dir', 'finance_rapport', '{"type":"masse_salariale"}'::jsonb) as f6b \gset
select pg_temp.verifier(:'f6a'::json->>'statut' = 'refuse' and :'f6a'::json->'resultat' is null
  and (:'f6b'::json->'resultat'->'totaux'->>'net')::int = 201400, 'F6 : paie refusée au comptable, accessible à la direction');
select public.api_finance(:'cle_dir', 'finance_tableau_bord', '{"annee_scolaire":"2026-2027"}'::jsonb) as f7 \gset
select public.api_finance(:'cle_dir', 'finance_tableau_bord', '{"annee_scolaire":"1990-1991"}'::jsonb) as f7b \gset
select pg_temp.verifier(:'f7'::json->'periode'->>'origine' = 'annee_scolaire' and :'f7b'::json->>'statut' = 'erreur',
  'F7 : filtrage par année scolaire ; année inconnue signalée');
select public.api_finance(:'cle_fb', 'finance_tableau_bord', '{}'::jsonb) as f8 \gset
select pg_temp.verifier(json_array_length(:'f8'::json->'manquants') >= 1, 'F8 : données manquantes signalées explicitement (aucun compte de trésorerie)');
select public.api_finance(:'cle_cai', 'finance_tableau_bord', '{}'::jsonb) as f9 \gset
select pg_temp.verifier(:'f9'::json->>'statut' = 'refuse' and :'f9'::json->'resultat' is null, 'F9 : caissier sans droit « assistant » : accès refusé');
select public.api_finance(:'cle_fb', 'finance_situation_eleve', '{"matricule":"PF1"}'::jsonb) as f10 \gset
select pg_temp.verifier(:'f10'::json->>'statut' = 'erreur' and :'f10'::json->'resultat' is null, 'F10 : aucun accès aux élèves d''un autre établissement');
select public.api_finance(:'cle_dir', 'enregistrer_paiement', '{"matricule":"PF1","montant":1000}'::jsonb) as f11 \gset
do $$ begin perform public.api_enregistrer_paiement(current_setting('app.cle_dir_ro'), '', '', 1, 'especes', null, '', ''); raise exception 'ÉCHEC : écriture en lecture seule';
exception when insufficient_privilege or sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : F11 une clé en lecture seule ne peut rien enregistrer'; end $$;
reset role;
select pg_temp.verifier(:'f11'::json->>'statut' = 'erreur' and (select count(*) from public.paiements) = :'nb_paiements_avant'::int,
  'F11 : l''assistant ne modifie aucune transaction (aucun outil d''écriture financier)');
select pg_temp.verifier((select count(*) from public.journal_api where etablissement_id = :'etab_f' and outil like 'finance%') >= 10
  and exists (select 1 from public.journal_api where etablissement_id = :'etab_f' and details->>'statut' = 'refuse')
  and not exists (select 1 from public.journal_api where outil like 'finance%' and (details ? 'montant' or details ? 'matricule' or details::text like '%MBALLA%' or details::text like '%PF1%')),
  'F12 : chaque appel est journalisé (outil, période, statut) sans montant, nom ni matricule');

-- Corrections de la relecture
set role authenticated;
select set_config('request.jwt.claim.sub', :'caissier', false) \g /dev/null
select public.finance_encaisser(json_build_object('inscription_id', :'i2', 'montant', 3000, 'mode', 'orange_money')::jsonb) as rsc \gset
select pg_temp.solde(:'caisse') + pg_temp.solde(:'banque') + pg_temp.solde(:'momo') as total_avant \gset
select public.finance_annuler_paiement((:'rsc'::json->>'id')::uuid, 'Erreur de saisie') \g /dev/null
select pg_temp.verifier((select compte_id from public.paiements where annule_paiement_id = (:'rsc'::json->>'id')::uuid) is null
  and pg_temp.solde(:'caisse') + pg_temp.solde(:'banque') + pg_temp.solde(:'momo') = :'total_avant'::bigint,
  'relecture : la contre-écriture d''un paiement sans compte ne crée aucun mouvement de trésorerie');
do $$ begin insert into public.paiements (inscription_id, categorie_id, montant, mode)
    values (current_setting('app.i1')::uuid, current_setting('app.cat_exam')::uuid, 999999, 'especes'); raise exception 'ÉCHEC : trop-perçu par insertion directe';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : relecture : l''insertion directe respecte le reste dû'; end $$;
select set_config('request.jwt.claim.sub', :'compta', false) \g /dev/null
do $$ begin perform solde_initial from public.comptes_financiers limit 1; raise exception 'ÉCHEC : solde initial lisible';
exception when insufficient_privilege then raise notice 'ok : relecture : solde initial réservé aux fonctions de trésorerie'; end $$;
select pg_temp.verifier((select count(*) from public.mouvements_tresorerie where paie) = 0
  and exists (select 1 from json_array_elements(public.finance_mouvements(:'banque', public._aujourdhui() - 1, public._aujourdhui())->'mouvements') m
              where m->>'source_type' = 'paie' and (m->>'montant')::int = -201400)
  and not exists (select 1 from json_array_elements(public.finance_rapport('journal_tresorerie', null, null)->'lignes') l where l->>'libelle' like '%NGONO%'),
  'relecture : sans droit « paie », les salaires ne sont visibles qu''agrégés, sans nom');
reset role;

-- Suppression d'un établissement par la console : toutes ses données financières partent avec lui (paie comprise)
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.console_supprimer_etablissement(:'etab_f', 'Institut Pilote des Finances') \g /dev/null
reset role;
select pg_temp.verifier(not exists (select 1 from public.paies where etablissement_id = :'etab_f')
  and not exists (select 1 from public.mouvements_tresorerie where etablissement_id = :'etab_f')
  and not exists (select 1 from public.paiements where etablissement_id = :'etab_f')
  and not exists (select 1 from public.etablissements where id = :'etab_f'),
  'console : l''établissement est supprimé avec ses paies, mouvements et encaissements');
