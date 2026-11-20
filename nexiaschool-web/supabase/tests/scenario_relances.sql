-- Relances de paiement et insolvabilité : configuration, identification à une date, exclusions, planification anti-doublon,
-- annulation, exécution (palier le plus récent, échéance réglée), espace parents (lecture, accusé, réponse), courrier final
-- validé, exécution quotidienne, journal, droits et cloisonnement
reset role;
select etablissement_id as etab_r from public.personnels where id = :'admin_a' \gset
update public.etablissements set offre = 'premium', offre_expire_le = null where id = :'etab_r';
select set_config('app.etab_r', :'etab_r', false), set_config('app.ins_a', :'ins_a', false), set_config('app.ins_fin', :'ins_fin', false) \g /dev/null
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null

-- 1. Configuration par la comptabilité ; la validation du courrier final reste à l'administration
select set_config('request.jwt.claim.sub', :'cpt', false) \g /dev/null
select pg_temp.verifier(jsonb_array_length(public.relances_configurer('{"actif": true}'::jsonb)->'paliers') = 8,
  'comptable : envoi automatique activé, 8 paliers par défaut (J-10 à jour J)');
select pg_temp.verifier((select bool_and(x->>'texte' like '%contrôle%' or (x->>'jours')::int >= 7) and bool_and(x->>'texte' not ilike '%renvo%' and x->>'texte' not ilike '%congédi%')
  from public.relances_config, jsonb_array_elements(paliers) x), 'messages par défaut : contrôle et mesure possible, jamais de renvoi annoncé');
do $$ begin perform public.relances_configurer('{"validation_requise": false}'::jsonb); raise exception 'comptable règle la validation';
exception when insufficient_privilege then raise notice 'ok : seule l''administration règle la validation du courrier final'; end $$;
do $$ begin perform public.relances_configurer('{"paliers": [{"jours": 3, "titre": "A", "objet": "Objet", "texte": "Texte assez long"}, {"jours": 3, "titre": "B", "objet": "Objet", "texte": "Texte assez long"}]}'::jsonb); raise exception 'doublon de palier';
exception when sqlstate '22023' then raise notice 'ok : deux paliers au même nombre de jours refusés'; end $$;

-- 2. Identification à une date et exclusion (bourse)
select pg_temp.verifier(not exists (select 1 from jsonb_array_elements(public.relances_insolvables(null)) x where x->>'inscription_id' = current_setting('app.ins_a'))
  and exists (select 1 from jsonb_array_elements(public.relances_insolvables(((now() at time zone 'Africa/Douala')::date + 10))) x where x->>'inscription_id' = current_setting('app.ins_a')),
  'à la date donnée : à jour aujourd''hui, insolvable dans 10 jours (tranche 2 non réglée)');
select public.relances_exclure(:'ins_fin', 'bourse', 'Bourse d''excellence', null, null) as excl \gset
select pg_temp.verifier((select x->>'exclusion' from jsonb_array_elements(public.relances_insolvables(((now() at time zone 'Africa/Douala')::date + 10))) x where x->>'inscription_id' = current_setting('app.ins_fin')) = 'bourse',
  'élève boursier : signalé comme exclu des relances');
do $$ begin perform public.relances_exclure(current_setting('app.ins_a')::uuid, 'cadeau', '', null, null); raise exception 'type inconnu';
exception when sqlstate '22023' then raise notice 'ok : type d''exclusion inconnu refusé'; end $$;

select pg_temp.verifier((select x->>'exclusion' from jsonb_array_elements(public.relances_insolvables(((now() at time zone 'Africa/Douala')::date + 10))) x where x->>'inscription_id' = current_setting('app.ins_a')) = 'moratoire',
  'moratoire accordé par courrier : élève exclu automatiquement des relances');
reset role;
select i.id as ins_r, e.matricule as mat_r, btrim(e.nom || ' ' || e.prenom) as nom_r from public.inscriptions i join public.eleves e on e.id = i.eleve_id
 where e.nom = 'NOAH' and i.exercice_id = (select id from public.exercices where actif and etablissement_id = :'etab_r') \gset
set role authenticated;
-- 3. Planification (tranche 2 due dans 20 jours : on planifie depuis J+10)
select public.relances_planifier(((now() at time zone 'Africa/Douala')::date + 10)) as planifies \gset
select pg_temp.verifier(:'planifies'::int > 0 and (select count(*) from public.courriers_ecole where inscription_id = :'ins_r' and statut = 'programme') = 8
  and (select count(*) from public.courriers_ecole where inscription_id = :'ins_fin') = 0, 'planification : 8 relances pour l''élève insolvable, aucune pour le boursier');
select pg_temp.verifier(public.relances_planifier(((now() at time zone 'Africa/Douala')::date + 10)) = 0, 'anti-doublon : une nouvelle planification n''ajoute rien');
select pg_temp.verifier((select count(distinct numero) = count(*) and min(reference) like 'CE-____-%' from public.courriers_ecole), 'numéros de courrier uniques (CE-AAAA-000001)');

-- 4. Annulation avant exécution, modification d'un envoi programmé
select id as j10 from public.courriers_ecole where inscription_id = :'ins_r' and palier = 10 \gset
select set_config('app.j10', :'j10', false) \g /dev/null
do $$ begin perform public.courrier_ecole_annuler(current_setting('app.j10')::uuid, ''); raise exception 'annulation sans motif';
exception when sqlstate 'P0001' then raise notice 'ok : annulation refusée sans motif'; end $$;
select public.courrier_ecole_annuler(:'j10', 'Parent reçu en audience') \g /dev/null
select pg_temp.verifier((select statut from public.courriers_ecole where id = :'j10') = 'annule', 'envoi programmé annulé avant exécution');
do $$ begin perform public.courrier_ecole_annuler(current_setting('app.j10')::uuid, 'Encore'); raise exception 'double annulation';
exception when sqlstate 'P0001' then raise notice 'ok : un envoi déjà annulé ne peut pas l''être de nouveau'; end $$;

-- 5. Exécution à J+17 : seul le palier le plus récent (J-3) part, les plus anciens dus sont remplacés
reset role;
select public._relances_executer(:'etab_r', ((now() at time zone 'Africa/Douala')::date + 17)) as exec1 \gset
select set_config('app.exec1', :'exec1', false) \g /dev/null
select pg_temp.verifier((current_setting('app.exec1')::jsonb->>'envoyes')::int >= 1
  and (select palier from public.courriers_ecole where inscription_id = :'ins_r' and statut = 'envoye') = 3
  and (select count(*) from public.courriers_ecole where inscription_id = :'ins_r' and statut = 'annule' and motif like 'Remplacée%') = 3,
  'exécution : seul le dernier palier dû (J-3) est envoyé, les J-7, J-5, J-4 en retard sont remplacés');
select pg_temp.verifier((select corps like '%contrôle%' and corps like '%mesure administrative%' and corps like '% FCFA%' and corps not like '%{%'
  and objet not like '%{%' from public.courriers_ecole where inscription_id = :'ins_r' and statut = 'envoye'), 'courrier envoyé : variables remplies, contrôle annoncé');
-- l'échéance est réglée : le palier suivant est annulé, pas envoyé
insert into public.paiements (etablissement_id, inscription_id, montant, mode) values (:'etab_r', :'ins_r', 150000, 'especes');
select public._relances_executer(:'etab_r', ((now() at time zone 'Africa/Douala')::date + 18)) \g /dev/null
select pg_temp.verifier((select statut || '|' || motif from public.courriers_ecole where inscription_id = :'ins_r' and palier = 2) = 'annule|Échéance réglée',
  'échéance réglée entre-temps : relance annulée automatiquement');

-- 6. Espace parents : seul le courrier de l'enfant, lecture, accusé de réception, réponse
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select (public.nouveau_code_etablissement()->>'code') as code_r \gset
reset role; set role anon;
select set_config('request.jwt.claim.sub', '', false) \g /dev/null
select (public.ouvrir_etablissement('Collège Saint-Joseph', :'code_r')->>'jeton') as jeton_r \gset
select (public.parent_connexion(:'jeton_r', :'nom_r', :'mat_r')->>'jeton') as sp_r \gset
select set_config('app.sp_r', :'sp_r', false) \g /dev/null
select public.parent_courriers_ecole(:'sp_r') as ce \gset
select set_config('app.ce', :'ce', false) \g /dev/null
select pg_temp.verifier(jsonb_array_length(current_setting('app.ce')::jsonb) = 1 and current_setting('app.ce')::jsonb->0->>'lu_le' is null,
  'parent : un courrier reçu (envoyé), non encore lu ; les envois programmés ou annulés restent invisibles');
select (current_setting('app.ce')::jsonb->0->>'id') as ce_id \gset
select public.parent_courrier_ecole_marquer(:'sp_r', :'ce_id', false) \g /dev/null
select public.parent_courrier_ecole_marquer(:'sp_r', :'ce_id', true) \g /dev/null
select public.parent_courrier_ecole_repondre(:'sp_r', :'ce_id', 'Nous passerons régler lundi.') \g /dev/null
do $$ begin perform public.parent_courrier_ecole_repondre(current_setting('app.sp_r', true), gen_random_uuid(), 'Bonjour'); raise exception 'courrier inventé';
exception when sqlstate 'P0001' or sqlstate '28000' then raise notice 'ok : un parent ne répond qu''aux courriers de son enfant'; end $$;
reset role;
select pg_temp.verifier((select lu_le is not null and accuse_le is not null from public.courriers_ecole where id = :'ce_id')
  and (select count(*) from public.courriers_ecole_reponses where courrier_id = :'ce_id' and auteur = 'parent') = 1,
  'lecture, accusé de réception et réponse du parent enregistrés');

-- 7. Courrier final : rédigé par la comptabilité, validé par l'administration avant envoi
set role authenticated;
select set_config('request.jwt.claim.sub', :'cpt', false) \g /dev/null
do $$ begin perform public.courrier_final_creer(jsonb_build_object('inscriptions', jsonb_build_array(current_setting('app.ins_fin')), 'objet', 'Mesure administrative',
  'corps', 'Texte du courrier final suffisamment long.')); raise exception 'élève exclu';
exception when sqlstate 'P0001' then raise notice 'ok : courrier final refusé pour un élève exclu des relances (bourse)'; end $$;
do $$ begin perform public.courrier_final_creer(jsonb_build_object('inscriptions', jsonb_build_array(current_setting('app.ins_a')), 'objet', 'Mesure administrative',
  'corps', 'Texte du courrier final suffisamment long.')); raise exception 'élève à jour';
exception when sqlstate 'P0001' then raise notice 'ok : courrier final refusé pour un élève sans échéance échue impayée'; end $$;
select public.relances_fin_exclusion(:'excl') \g /dev/null
select pg_temp.verifier((select count(*) from public.finance_exclusions where inscription_id = :'ins_fin') = 0, 'exclusion commencée aujourd''hui : retirée dès qu''on y met fin');
select public.courrier_final_creer(jsonb_build_object('inscriptions', jsonb_build_array(:'ins_fin'), 'objet', 'Mesure administrative — {eleve}',
  'corps', 'Madame, Monsieur, après le contrôle, {eleve} ({classe}) ne pourra pas suivre les cours jusqu''à régularisation de {montant} FCFA.')) as fin \gset
select set_config('app.fin', :'fin', false) \g /dev/null
select (current_setting('app.fin')::jsonb->'ids'->>0) as fin_id \gset
select set_config('app.fin_id', :'fin_id', false) \g /dev/null
select pg_temp.verifier(current_setting('app.fin')::jsonb->>'statut' = 'a_valider'
  and (select objet from public.courriers_ecole where id = :'fin_id') = 'Mesure administrative — NANA', 'courrier final en attente de validation, variables remplies');
do $$ begin perform public.courrier_final_creer(jsonb_build_object('inscriptions', jsonb_build_array(current_setting('app.ins_fin')), 'objet', 'Mesure administrative — {eleve}',
  'corps', 'Madame, Monsieur, après le contrôle, {eleve} ({classe}) ne pourra pas suivre les cours jusqu''à régularisation de {montant} FCFA.')); raise exception 'doublon';
exception when sqlstate 'P0001' then raise notice 'ok : courrier final identique refusé le même jour (anti-doublon)'; end $$;
do $$ begin perform public.courrier_final_valider(array[current_setting('app.fin_id')::uuid], true, ''); raise exception 'comptable valide';
exception when insufficient_privilege then raise notice 'ok : le comptable ne valide pas le courrier final (réglage : administration)'; end $$;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
do $$ begin perform public.courrier_final_valider(array[current_setting('app.fin_id')::uuid], false, ''); raise exception 'refus sans motif';
exception when sqlstate 'P0001' then raise notice 'ok : refus sans motif impossible'; end $$;
select public.courrier_final_valider(array[:'fin_id'::uuid], true, '') as valides \gset
select pg_temp.verifier(:'valides'::int = 1 and (select statut || '|' || (valide_par is not null)::text from public.courriers_ecole where id = :'fin_id') = 'envoye|true',
  'administration : courrier final validé puis envoyé');
reset role; set role anon;
select pg_temp.verifier(jsonb_array_length(public.parent_courriers_ecole(:'sp_r')) = 1, 'le courrier final d''un autre élève reste invisible pour ce parent');

-- 8. Journal complet
reset role;
select pg_temp.verifier((select count(distinct action) from public.courriers_ecole_journal where etablissement_id = :'etab_r'
  and action in ('configuration', 'exclusion', 'creation', 'programmation', 'envoi', 'annulation', 'lecture', 'accuse', 'reponse', 'validation')) = 10,
  'journal : configuration, exclusion, création, programmation, envoi, annulation, lecture, accusé, réponse, validation');

-- 9. Exécution quotidienne (Worker) : une seule fois par jour
set role anon;
select public.relances_quotidiennes() as q1 \gset
select set_config('app.q1', :'q1', false) \g /dev/null
select pg_temp.verifier(case when (current_setting('app.q1')::jsonb->>'trop_tot')::boolean then true   -- avant 6 h (Douala) : rien n'est lancé
  else (current_setting('app.q1')::jsonb->>'etablissements')::int >= 1 and (public.relances_quotidiennes()->>'etablissements')::int = 0 end,
  'exécution quotidienne : pas avant 6 h, une seule fois par jour et par établissement');
do $$ begin perform public.relances_planifier(null); raise exception 'anonyme planifie';
exception when insufficient_privilege then raise notice 'ok : planification à la demande réservée à la comptabilité'; end $$;

-- 10. Droits et cloisonnement
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.courriers_ecole) = 0 and (select count(*) from public.finance_exclusions) = 0, 'enseignant : relances et exclusions invisibles');
do $$ begin perform public.relances_planifier(null); raise exception 'enseignant planifie';
exception when insufficient_privilege then raise notice 'ok : un enseignant ne programme pas de relances'; end $$;
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.courriers_ecole) = 0 and (select count(*) from public.courriers_ecole_journal) = 0
  and (select count(*) from public.relances_config) = 0, 'un autre établissement ne voit ni courriers, ni journal, ni configuration');
do $$ begin perform public.courrier_ecole_annuler(current_setting('app.j10')::uuid, 'Intrusion'); raise exception 'autre établissement';
exception when sqlstate 'P0001' or insufficient_privilege then raise notice 'ok : un autre établissement ne peut pas agir sur vos relances'; end $$;
reset role;
