-- Courriers administratifs aux parents : modèles, pièce jointe PDF, ciblage (élèves, groupe, paiement), protection contre le
-- mauvais groupe (nombre + empreinte), variables, envoi immédiat et programmé, annulation, espace parents (lecture, pièce,
-- accusé), confirmation de lecture, renvoi d'un échec, droits (comptable, enseignant) et cloisonnement
reset role;
select etablissement_id as etab_c from public.personnels where id = :'admin_a' \gset
select set_config('app.etab_c', :'etab_c', false) \g /dev/null
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null

-- 1. Modèles
select public.courrier_modele_enregistrer('{"nom": "Réunion de rentrée", "sujet": "reunion", "objet": "Réunion des parents — {classe}",
  "corps": "Madame, Monsieur, les {parent} sont conviés à la réunion du {date}. Reste à payer : {montant_du} FCFA."}'::jsonb) as modele \gset
do $$ begin perform public.courrier_modele_enregistrer('{"nom": "Réunion de rentrée", "objet": "Objet", "corps": "Texte assez long"}'::jsonb); raise exception 'doublon';
exception when sqlstate 'P0001' then raise notice 'ok : deux modèles de même nom refusés'; end $$;
do $$ begin perform public.courrier_modele_enregistrer('{"nom": "X", "sujet": "fete", "objet": "Objet", "corps": "Texte assez long"}'::jsonb); raise exception 'sujet inconnu';
exception when sqlstate '22023' then raise notice 'ok : sujet de courrier inconnu refusé'; end $$;
select pg_temp.verifier((select count(*) from public.courriers_modeles) = 1, 'modèle de courrier enregistré');

-- 2. Pièce jointe : seulement un PDF
select public.courrier_piece_ajouter('convocation.pdf', encode(convert_to('%PDF-1.4 test', 'UTF8'), 'base64')) as piece \gset
do $$ begin perform public.courrier_piece_ajouter('virus.exe', encode(convert_to('MZ binaire', 'UTF8'), 'base64')); raise exception 'non PDF';
exception when sqlstate '22023' then raise notice 'ok : une pièce jointe qui n''est pas un PDF est refusée'; end $$;
do $$ begin perform 1 from public.courriers_pieces where donnees is not null; raise exception 'contenu lisible';
exception when insufficient_privilege then raise notice 'ok : le contenu des pièces jointes ne se lit pas directement'; end $$;

-- 3. Aperçu et protection contre le mauvais groupe
select public.courrier_admin_apercu(jsonb_build_object('mode', 'groupe', 'classes', jsonb_build_array(:'classe_a'))) as ap \gset
select set_config('app.ap', :'ap', false) \g /dev/null
select (current_setting('app.ap')::jsonb->>'nombre')::int as nb, current_setting('app.ap')::jsonb->>'empreinte' as emp \gset
select pg_temp.verifier(:'nb'::int >= 2 and current_setting('app.ap')::jsonb->'classes'->0->>'classe' = '6e A', 'aperçu : nombre de destinataires et répartition par classe');
select pg_temp.verifier((public.courrier_admin_apercu('{"mode": "groupe", "paiement": "non_en_regle"}'::jsonb)->>'nombre')::int
  < (public.courrier_admin_apercu('{"mode": "groupe"}'::jsonb)->>'nombre')::int, 'ciblage par statut de paiement : seuls les élèves non en règle');
do $$ begin perform public.courrier_admin_envoyer(jsonb_build_object('sujet', 'reunion', 'objet', 'Réunion', 'corps', 'Texte assez long pour un courrier',
  'ciblage', jsonb_build_object('mode', 'groupe', 'classes', jsonb_build_array(current_setting('app.classe_a', true))), 'confirmation', jsonb_build_object('nombre', '1', 'empreinte', 'x')));
  raise exception 'envoi sans bonne confirmation';
exception when sqlstate 'P0001' then raise notice 'ok : envoi refusé si le nombre de destinataires confirmé est faux'; end $$;
select set_config('app.classe_a', :'classe_a', false), set_config('app.nb', :'nb', false) \g /dev/null
do $$ begin perform public.courrier_admin_envoyer(jsonb_build_object('sujet', 'reunion', 'objet', 'Réunion', 'corps', 'Texte assez long pour un courrier',
  'ciblage', jsonb_build_object('mode', 'groupe', 'classes', jsonb_build_array(current_setting('app.classe_a'))),
  'confirmation', jsonb_build_object('nombre', current_setting('app.nb'), 'empreinte', 'empreinte-perimee'))); raise exception 'groupe changé accepté';
exception when sqlstate 'P0001' then raise notice 'ok : envoi refusé si le groupe a changé depuis l''aperçu'; end $$;

-- 4. Envoi immédiat à la classe, avec pièce jointe et variables
select public.courrier_admin_envoyer(jsonb_build_object('sujet', 'reunion', 'objet', (select objet from public.courriers_modeles where id = :'modele'),
  'corps', (select corps from public.courriers_modeles where id = :'modele'), 'piece_id', :'piece', 'description_cible', 'Classe de 6e A',
  'ciblage', jsonb_build_object('mode', 'groupe', 'classes', jsonb_build_array(:'classe_a')),
  'confirmation', jsonb_build_object('nombre', :'nb', 'empreinte', :'emp'))) as env \gset
select set_config('app.env', :'env', false) \g /dev/null
select (current_setting('app.env')::jsonb->>'envoi_id') as envoi \gset
select pg_temp.verifier((current_setting('app.env')::jsonb->>'destinataires')::int = :'nb'::int and current_setting('app.env')::jsonb->>'statut' = 'envoye'
  and (select count(*) from public.courriers_ecole where envoi_id = :'envoi' and statut = 'envoye' and categorie = 'administratif') = :'nb'::int,
  'envoi par lot : un courrier par élève de la classe, envoyé');
select pg_temp.verifier((select bool_and(objet = 'Réunion des parents — 6e A' and corps like '%Parents de %' and corps like '% FCFA.' and corps not like '%{%')
  from public.courriers_ecole where envoi_id = :'envoi'), 'variables remplies (classe, parent, date, montant dû)');

-- 5. Envoi individuel programmé, puis annulé ; un autre programmé dans le passé est distribué à l'ouverture
select public.courrier_admin_envoyer(jsonb_build_object('sujet', 'convocation', 'objet', 'Convocation de {eleve}', 'corps', 'Votre enfant {eleve} est convoqué.',
  'ciblage', jsonb_build_object('mode', 'eleves', 'inscriptions', jsonb_build_array(:'ins_a')), 'programme_le', (now() + interval '3 days')::text,
  'confirmation', jsonb_build_object('nombre', '1', 'empreinte', md5(:'ins_a')))) ->> 'envoi_id' as envoi_prog \gset
select pg_temp.verifier((select statut from public.courriers_envois where id = :'envoi_prog') = 'programme'
  and (select statut from public.courriers_ecole where envoi_id = :'envoi_prog') = 'programme', 'envoi individuel programmé (pas encore visible)');
select public.courrier_admin_annuler(:'envoi_prog', 'Rendez-vous déplacé') \g /dev/null
select pg_temp.verifier((select statut from public.courriers_envois where id = :'envoi_prog') = 'annule'
  and (select statut from public.courriers_ecole where envoi_id = :'envoi_prog') = 'annule', 'envoi programmé annulé avant son heure');
select public.courrier_admin_envoyer(jsonb_build_object('sujet', 'rappel', 'objet', 'Rappel pour {eleve}', 'corps', 'Rappel : sortie scolaire demain.',
  'ciblage', jsonb_build_object('mode', 'eleves', 'inscriptions', jsonb_build_array(:'ins_a')), 'programme_le', (now() + interval '2 hours')::text,
  'confirmation', jsonb_build_object('nombre', '1', 'empreinte', md5(:'ins_a')))) ->> 'envoi_id' as envoi_tard \gset
reset role;
update public.courriers_envois set programme_le = now() - interval '1 minute' where id = :'envoi_tard';   -- l'heure est venue
set role authenticated;
select set_config('app.envoi_tard', :'envoi_tard', false) \g /dev/null
do $$ begin perform public.courrier_admin_annuler(current_setting('app.envoi_tard')::uuid, 'Trop tard'); raise exception 'annulation après l''heure';
exception when sqlstate 'P0001' then raise notice 'ok : un envoi dont l''heure est passée ne peut plus être annulé'; end $$;
select pg_temp.verifier((select corps from public.courriers_ecole where envoi_id = :'envoi_tard') like 'Rappel%', 'texte rendu de nouveau au moment de l''envoi programmé');
reset role;

-- 6. Espace parents : courriers de l'enfant (le programmé échu est distribué), pièce jointe, confirmation selon l'envoi
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select (public.nouveau_code_etablissement()->>'code') as code_c \gset
reset role; set role anon;
select set_config('request.jwt.claim.sub', '', false) \g /dev/null
select (public.ouvrir_etablissement('Collège Saint-Joseph', :'code_c')->>'jeton') as jeton_c2 \gset
select (public.parent_connexion(:'jeton_c2', 'Grâce Abena', 'M1')->>'jeton') as sp_c \gset
select public.parent_courriers_ecole(:'sp_c') as pce \gset
select set_config('app.pce', :'pce', false) \g /dev/null
select pg_temp.verifier((select count(*) from jsonb_array_elements(current_setting('app.pce')::jsonb) x where x->>'categorie' = 'administratif') = 2
  and not exists (select 1 from jsonb_array_elements(current_setting('app.pce')::jsonb) x where x->>'objet' like 'Convocation%'),
  'parent : courrier de la classe et rappel programmé échu reçus ; courrier annulé invisible');
select (select x->>'id' from jsonb_array_elements(current_setting('app.pce')::jsonb) x where x->>'piece' = 'convocation.pdf') as c_piece \gset
select pg_temp.verifier(convert_from(decode(public.parent_courrier_piece(:'sp_c', :'c_piece')->>'donnees', 'base64'), 'UTF8') like '\%PDF-%',
  'parent : pièce jointe PDF téléchargeable');
select pg_temp.verifier((select (x->>'confirmation')::boolean from jsonb_array_elements(current_setting('app.pce')::jsonb) x where x->>'id' = :'c_piece') = false,
  'confirmation de lecture non demandée tant que l''administration ne l''a pas activée');
select public.parent_courrier_ecole_marquer(:'sp_c', :'c_piece', true) \g /dev/null
reset role;
select pg_temp.verifier((select lu_le is not null and accuse_le is null from public.courriers_ecole where id = :'c_piece'),
  'ouverture notée ; accusé de réception refusé tant que l''établissement ne l''a pas demandé');
set role anon;

-- 7. Confirmation de lecture : liste des élèves dont le parent a ouvert le courrier
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
do $$ begin perform public.courrier_admin_lectures((current_setting('app.env')::jsonb->>'envoi_id')::uuid); raise exception 'lectures sans activation';
exception when sqlstate 'P0001' then raise notice 'ok : liste des lectures disponible seulement si la confirmation est activée'; end $$;
select public.courrier_admin_confirmation(:'envoi', true) \g /dev/null
select public.courrier_admin_lectures(:'envoi') as lect \gset
select set_config('app.lect', :'lect', false) \g /dev/null
select pg_temp.verifier((select count(*) from jsonb_array_elements(current_setting('app.lect')::jsonb) x where x->>'lu_le' is not null) = 1
  and jsonb_array_length(current_setting('app.lect')::jsonb) = :'nb'::int, 'confirmation de lecture : on voit quel élève (parent) a ouvert le courrier');

-- 8. Renvoi d'un courrier en échec
reset role;
update public.courriers_ecole set statut = 'echoue', erreur = 'test' where id = (select id from public.courriers_ecole where envoi_id = :'envoi' and inscription_id <> :'ins_a' limit 1)
  returning id as c_echec \gset
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.courrier_ecole_renvoyer(:'c_echec') \g /dev/null
select pg_temp.verifier((select statut from public.courriers_ecole where id = :'c_echec') = 'envoye', 'courrier en échec renvoyé');
select set_config('app.c_echec', :'c_echec', false) \g /dev/null
do $$ begin perform public.courrier_ecole_renvoyer(current_setting('app.c_echec')::uuid); raise exception 'renvoi d''un courrier envoyé';
exception when sqlstate 'P0001' then raise notice 'ok : seul un courrier en échec peut être renvoyé'; end $$;
select pg_temp.verifier((select count(*) from public.courriers_ecole_journal where action in ('renvoi', 'modele', 'piece', 'envoi', 'programmation', 'annulation')
  and etablissement_id = :'etab_c') >= 6, 'journal : modèle, pièce, envoi, programmation, annulation et renvoi tracés');

-- 9. Droits : le comptable ne voit ni n'envoie de courrier administratif ; l'enseignant non plus
select set_config('request.jwt.claim.sub', :'cpt', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.courriers_ecole where categorie = 'administratif') = 0 and (select count(*) from public.courriers_envois) = 0
  and (select count(*) from public.courriers_ecole where categorie = 'relance') > 0, 'comptable : relances visibles, courriers administratifs invisibles');
select pg_temp.verifier((select count(*) from public.courriers_ecole_journal where action in ('modele', 'piece') or details ? 'envoi') = 0
  and (select count(*) from public.courriers_ecole_journal where action = 'configuration') > 0, 'comptable : journal des relances seulement (ni modèles, ni pièces, ni envois administratifs)');
do $$ begin perform public.courrier_admin_apercu('{"mode": "groupe"}'::jsonb); raise exception 'comptable cible';
exception when insufficient_privilege then raise notice 'ok : le comptable ne peut pas envoyer de courrier administratif'; end $$;
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
do $$ begin perform public.courrier_modele_enregistrer('{"nom": "Prof", "objet": "Objet", "corps": "Texte assez long"}'::jsonb); raise exception 'enseignant';
exception when insufficient_privilege then raise notice 'ok : un enseignant ne crée pas de modèle'; end $$;

-- 10. Cloisonnement
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.courriers_envois) = 0 and (select count(*) from public.courriers_modeles) = 0
  and (select count(*) from public.courriers_pieces) = 0, 'un autre établissement ne voit ni envois, ni modèles, ni pièces jointes');
reset role;
