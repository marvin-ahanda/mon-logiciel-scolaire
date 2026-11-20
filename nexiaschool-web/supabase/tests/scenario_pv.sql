-- PV et rapports : fonctionnalité réglable, réglages de l'établissement, registre numéroté, commentaires des PV individuels
-- (administration ou enseignant de la classe), publication aux parents (chacun ne voit que son enfant), retrait,
-- cloisonnement entre établissements
reset role;
update public.etablissements set offre = 'premium', offre_expire_le = null where id = (select etablissement_id from public.personnels where id = :'admin_a');
select pg_temp.verifier('pv' = any (public._fonctions_reglables()) and public.offre_requise('pv') = 'decouverte', 'PV et rapports : fonctionnalité réglable, comprise dans toutes les offres');
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null

-- 1. Réglages de l'établissement
select pg_temp.verifier((public.pv_enregistrer_reglages('{"seuil_reussite": 12, "signataires": [" Le censeur ", "Le proviseur"], "comparer_cycle": true}'::jsonb)->>'seuil_reussite')::numeric = 12,
  'réglages : seuil de réussite propre à l''établissement');
select pg_temp.verifier((select signataires = '["Le censeur", "Le proviseur"]'::jsonb and comparer_cycle and seuil_difficulte = 8 from public.pv_reglages),
  'réglages : signataires nettoyés, valeurs non fournies conservées');
do $$ begin perform public.pv_enregistrer_reglages('{"seuil_reussite": 25}'::jsonb); raise exception 'seuil hors bornes';
exception when sqlstate '22023' then raise notice 'ok : seuil de réussite hors de 0-20 refusé'; end $$;
do $$ begin perform public.pv_enregistrer_reglages('{"signataires": ["1","2","3","4","5","6","7"]}'::jsonb); raise exception '7 signataires';
exception when sqlstate '22023' then raise notice 'ok : 6 signataires au plus'; end $$;

-- 2. Registre : numéro unique, type et titre contrôlés
select public.pv_enregistrer('{"type": "classe", "titre": "PV de classe — 6e A", "perimetre": {"classe": "6e A"}, "format": "pdf", "partiel": true,
  "avertissements": ["1 note manquante"], "commentaire": "Classe sérieuse"}'::jsonb) as doc1 \gset
select public.pv_enregistrer('{"type": "etablissement", "titre": "PV général", "format": "xlsx"}'::jsonb) as doc2 \gset
select set_config('app.doc1', :'doc1', false), set_config('app.doc2', :'doc2', false) \g /dev/null
select pg_temp.verifier((current_setting('app.doc1')::jsonb->>'numero')::int + 1 = (current_setting('app.doc2')::jsonb->>'numero')::int
  and current_setting('app.doc2')::jsonb->>'reference' ~ '^PV-[0-9]{4}-[0-9]{6}$', 'registre : numéros uniques et consécutifs (PV-AAAA-000001)');
select pg_temp.verifier((select partiel and commentaire = 'Classe sérieuse' and genere_par_nom <> '' from public.pv_documents
  where id = (current_setting('app.doc1')::jsonb->>'id')::uuid), 'registre : PV partiel, commentaire et auteur conservés');
do $$ begin perform public.pv_enregistrer('{"type": "inconnu", "titre": "x"}'::jsonb); raise exception 'type inconnu';
exception when sqlstate '22023' then raise notice 'ok : type de PV inconnu refusé'; end $$;
do $$ begin perform public.pv_enregistrer('{"type": "classe", "titre": "x", "format": "docx"}'::jsonb); raise exception 'format inconnu';
exception when sqlstate '22023' then raise notice 'ok : format de sortie inconnu refusé'; end $$;
select public.pv_commenter((current_setting('app.doc2')::jsonb->>'id')::uuid, 'Résultats en hausse') \g /dev/null
select pg_temp.verifier((select commentaire from public.pv_documents where id = (current_setting('app.doc2')::jsonb->>'id')::uuid) = 'Résultats en hausse',
  'commentaire de la direction ajouté après génération');
do $$ begin insert into public.pv_documents (etablissement_id, type, numero, reference, titre) values (public.etab_courant(), 'classe', 999, 'X', 'X'); raise exception 'écriture directe';
exception when insufficient_privilege then raise notice 'ok : aucune écriture directe dans le registre'; end $$;

-- 3. Enseignant : ni registre ni publication ; commentaire seulement pour les élèves de ses classes
reset role;
insert into public.classes (etablissement_id, libelle, niveau) select etablissement_id, 'PV Z', '6e' from public.personnels where id = :'admin_a' returning id as classe_z \gset
insert into public.eleves (etablissement_id, matricule, nom, prenom, sexe) select etablissement_id, 'PVZ1', 'Zang', 'Paul', 'M' from public.personnels where id = :'admin_a' returning id as eleve_z \gset
insert into public.inscriptions (etablissement_id, exercice_id, classe_id, eleve_id) select x.etablissement_id, x.id, :'classe_z', :'eleve_z'
  from public.exercices x where x.actif and x.etablissement_id = (select etablissement_id from public.personnels where id = :'admin_a') returning id as ins_z \gset
set role authenticated;
select set_config('app.ins_a', :'ins_a', false), set_config('app.ins_z', :'ins_z', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
do $$ begin perform public.pv_enregistrer('{"type": "classe", "titre": "x"}'::jsonb); raise exception 'enseignant inscrit au registre';
exception when insufficient_privilege then raise notice 'ok : un enseignant ne génère pas de PV au registre'; end $$;
select pg_temp.verifier((select count(*) from public.pv_documents) = 0, 'enseignant : registre invisible');
select pg_temp.verifier((public.pv_commenter_eleve(:'ins_a', 't1', 'Bon trimestre, à poursuivre.')->>'fonction') = 'Enseignant',
  'enseignant de la classe : commentaire du PV individuel enregistré');
do $$ begin perform public.pv_commenter_eleve(current_setting('app.ins_z')::uuid, 't1', 'Hors de mes classes'); raise exception 'autre classe';
exception when insufficient_privilege then raise notice 'ok : pas de commentaire pour un élève d''une classe où l''enseignant n''intervient pas'; end $$;
do $$ begin perform public.pv_commenter_eleve(current_setting('app.ins_a')::uuid, 'trimestre', 'x'); raise exception 'période invalide';
exception when sqlstate '22023' then raise notice 'ok : période inconnue refusée'; end $$;
do $$ begin perform public.pv_publier(jsonb_build_object('periode', 't1', 'periode_libelle', 'Trimestre 1', 'pv', jsonb_build_array(jsonb_build_object('inscription_id', current_setting('app.ins_a'), 'contenu', '{}'::jsonb)))); raise exception 'enseignant publie';
exception when insufficient_privilege then raise notice 'ok : un enseignant ne publie pas de PV aux parents'; end $$;
select pg_temp.verifier((select count(*) from public.pv_commentaires) = 1, 'enseignant : il relit les commentaires de ses classes');

-- 4. Publication aux parents : copies figées, une par élève et par période
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select (public.pv_commenter_eleve(:'ins_a', 't1', '  Très bon travail.  ')->>'commentaire') as com_admin \gset
select pg_temp.verifier(:'com_admin' = 'Très bon travail.' and (select count(*) from public.pv_commentaires) = 2
  and (select commentaire from public.pv_commentaires where fonction = 'Enseignant') = 'Bon trimestre, à poursuivre.',
  'un commentaire par auteur : celui de l''administration n''écrase pas celui de l''enseignant');
select public.pv_commenter_eleve(:'ins_a', 't1', 'Excellent trimestre.') \g /dev/null
select pg_temp.verifier((select count(*) from public.pv_commentaires) = 2
  and (select commentaire from public.pv_commentaires where fonction = 'Administration') = 'Excellent trimestre.', 'chaque auteur modifie son propre commentaire');
select pg_temp.verifier((public.pv_publier(jsonb_build_object('periode', 't1', 'periode_libelle', 'Trimestre 1', 'portee', '6e A',
  'commun', '{"etablissement": {"nom": "Collège Saint-Joseph"}}'::jsonb, 'document_id', current_setting('app.doc1')::jsonb->>'id',
  'pv', jsonb_build_array(jsonb_build_object('inscription_id', :'ins_a', 'contenu', '{"eleve": {"nom": "ABENA", "matricule": "M1"}, "moyenne": 14}'::jsonb),
                          jsonb_build_object('inscription_id', :'ins_z', 'contenu', '{"eleve": {"nom": "ZANG", "matricule": "PVZ1"}, "moyenne": 9}'::jsonb))))->>'publies')::int = 2,
  'publication : deux PV individuels publiés');
select (public.pv_publier(jsonb_build_object('periode', 't1', 'periode_libelle', 'Trimestre 1',
  'pv', jsonb_build_array(jsonb_build_object('inscription_id', :'ins_a', 'contenu', '{"eleve": {"nom": "ABENA", "matricule": "M1"}, "moyenne": 15}'::jsonb))))->>'publies') as republies \gset
select pg_temp.verifier(:'republies'::int = 1
  and (select count(*) from public.pv_individuels_publies) = 2
  and (select (contenu->>'moyenne')::int from public.pv_individuels_publies where inscription_id = :'ins_a') = 15,
  'republication : la copie de la même période est remplacée, pas dupliquée');
do $$ begin perform public.pv_publier(jsonb_build_object('periode', 't1', 'periode_libelle', 'Trimestre 1', 'pv', jsonb_build_array(jsonb_build_object('inscription_id', current_setting('app.ins_a'), 'contenu', '[1]'::jsonb)))); raise exception 'contenu invalide';
exception when sqlstate '22023' then raise notice 'ok : contenu de PV invalide refusé'; end $$;
do $$ begin perform public.pv_publier(jsonb_build_object('periode', 't1', 'periode_libelle', 'Trimestre 1', 'pv', jsonb_build_array(jsonb_build_object('inscription_id',
  current_setting('app.ins_a'), 'contenu', '{"eleve": {"nom": "ZANG", "matricule": "PVZ1"}}'::jsonb)))); raise exception 'PV d''un autre élève';
exception when sqlstate '22023' then raise notice 'ok : le PV d''un autre élève ne peut pas être publié sous cette inscription'; end $$;
do $$ begin perform public.pv_publier(jsonb_build_object('periode', 't1', 'periode_libelle', 'Trimestre 1', 'pv', '[]'::jsonb)); raise exception 'publication vide';
exception when sqlstate 'P0001' then raise notice 'ok : publication vide refusée'; end $$;

-- 5. Espace parents : uniquement le PV de son enfant
select (public.nouveau_code_etablissement()->>'code') as code_pv \gset
reset role; set role anon;
select set_config('request.jwt.claim.sub', '', false) \g /dev/null
select (public.ouvrir_etablissement('Collège Saint-Joseph', :'code_pv')->>'jeton') as jeton_pv \gset
select (public.parent_connexion(:'jeton_pv', 'Grâce Abena', 'M1')->>'jeton') as sp \gset
select public.parent_pv(:'sp') as pv_parent \gset
select set_config('app.pv_parent', :'pv_parent', false) \g /dev/null
select pg_temp.verifier(jsonb_array_length(current_setting('app.pv_parent')::jsonb) = 1
  and current_setting('app.pv_parent')::jsonb->0->'contenu'->'eleve'->>'nom' = 'ABENA'
  and current_setting('app.pv_parent')::jsonb->0->>'periode_libelle' = 'Trimestre 1'
  and position('ZANG' in current_setting('app.pv_parent')) = 0, 'parent : il ne voit que le PV de son enfant');
reset role;
insert into public.fonctions_etablissement (etablissement_id, fonction, active) select etablissement_id, 'pv', false from public.personnels where id = :'admin_a';
set role anon;
select pg_temp.verifier(jsonb_array_length(public.parent_pv(:'sp')) = 0, 'fonctionnalité PV retirée à l''établissement : rien n''est montré aux parents');
reset role;
delete from public.fonctions_etablissement where fonction = 'pv' and etablissement_id = (select etablissement_id from public.personnels where id = :'admin_a');
set role anon;
do $$ begin perform public.parent_pv('nxp_' || repeat('0', 64)); raise exception 'session inventée';
exception when sqlstate '28000' then raise notice 'ok : PV inaccessibles sans session parent valide'; end $$;
do $$ begin perform 1 from public.pv_individuels_publies; raise exception 'lecture anonyme';
exception when insufficient_privilege then raise notice 'ok : copies publiées illisibles directement'; end $$;

-- 6. Retrait de la publication
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select pg_temp.verifier(public.pv_retirer('t1', array[:'ins_a'::uuid]) = 1, 'retrait de la publication d''un élève');
reset role; set role anon;
select pg_temp.verifier(jsonb_array_length(public.parent_pv(:'sp')) = 0, 'parent : PV retiré, il ne le voit plus');
reset role;
select pg_temp.verifier((select count(*) from public.pv_publications) = 1, 'publication devenue vide : retirée du registre des publications');

-- 7. Cloisonnement entre établissements
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.pv_documents) = 0 and (select count(*) from public.pv_commentaires) = 0
  and (select count(*) from public.pv_individuels_publies) = 0 and (select count(*) from public.pv_reglages) = 0,
  'un autre établissement ne voit ni registre, ni commentaires, ni publications, ni réglages');
do $$ begin perform public.pv_publier(jsonb_build_object('periode', 't1', 'periode_libelle', 'Trimestre 1', 'pv', jsonb_build_array(jsonb_build_object('inscription_id', current_setting('app.ins_z'), 'contenu', '{}'::jsonb)))); raise exception 'autre établissement';
exception when sqlstate 'P0001' or insufficient_privilege then raise notice 'ok : un autre établissement ne peut pas publier pour vos élèves'; end $$;
do $$ begin perform public.pv_commenter_eleve(current_setting('app.ins_a')::uuid, 't1', 'x'); raise exception 'autre établissement commente';
exception when sqlstate 'P0001' or insufficient_privilege then raise notice 'ok : un autre établissement ne peut pas commenter vos élèves'; end $$;
do $$ begin perform public.pv_commenter((current_setting('app.doc1')::jsonb->>'id')::uuid, 'x'); raise exception 'autre établissement';
exception when sqlstate 'P0001' or insufficient_privilege then raise notice 'ok : un autre établissement ne peut pas commenter votre registre'; end $$;

-- nettoyage : la classe de test et son élève
reset role;
delete from public.pv_individuels_publies where inscription_id = :'ins_z';
delete from public.pv_publications where not exists (select 1 from public.pv_individuels_publies x where x.publication_id = pv_publications.id);
delete from public.inscriptions where id = :'ins_z';
delete from public.eleves where id = :'eleve_z';
delete from public.classes where id = :'classe_z';

-- Annulation tracée d'un PV du registre (le numéro reste pris)
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select (public.pv_enregistrer('{"type": "classe", "titre": "PV de test à annuler"}'::jsonb) ->> 'id') as pv_annule \gset
select set_config('app.pv_annule', :'pv_annule', false) \g /dev/null
do $$ begin perform public.pv_annuler(current_setting('app.pv_annule')::uuid, ''); raise exception 'annulation sans motif acceptée';
exception when sqlstate 'P0001' then raise notice 'ok : motif d''annulation obligatoire'; end $$;
select public.pv_annuler(:'pv_annule', 'Document de test') \g /dev/null
select pg_temp.verifier((select annule_le is not null and annule_motif = 'Document de test' from public.pv_documents where id = :'pv_annule')
  and (public.pv_enregistrer('{"type": "classe", "titre": "Suivant"}'::jsonb) ->> 'numero')::int
      = (select numero from public.pv_documents where id = :'pv_annule') + 1,
  'PV annulé : conservé au registre avec son motif ; son numéro n''est pas réutilisé');
do $$ begin perform public.pv_annuler(current_setting('app.pv_annule')::uuid, 'encore'); raise exception 'double annulation acceptée';
exception when sqlstate 'P0001' then raise notice 'ok : un PV déjà annulé ne se réannule pas'; end $$;
