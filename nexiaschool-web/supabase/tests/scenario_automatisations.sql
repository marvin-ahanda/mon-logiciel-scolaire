-- Automatisations personnelles (catalogue guidé) : règle par personne, actions limitées au rôle, fréquence et prochaine
-- exécution, rapports envoyés à soi-même ou à la direction, données limitées aux droits de l'auteur, exécution horaire,
-- offre Premium, cloisonnement
reset role;
select etablissement_id as etab_au from public.personnels where id = :'admin_a' \gset
update public.etablissements set offre = 'premium', offre_expire_le = null where id = :'etab_au';
reset role;
select pg_temp.verifier(public._auto_prochaine('{"type": "hebdo", "jours": [5], "heure": "16:00"}', '2026-11-20 14:00:00+01')
  = '2026-11-20 16:00:00+01'::timestamptz
  and public._auto_prochaine('{"type": "hebdo", "jours": [5], "heure": "16:00"}', '2026-11-20 16:00:00+01') = '2026-11-27 16:00:00+01'::timestamptz
  and public._auto_prochaine('{"type": "mensuel", "jour_mois": 31, "heure": "07:00"}', '2026-11-05 10:00:00+01') = '2026-11-30 07:00:00+01'::timestamptz,
  'prochaine exécution : vendredi 16 h (heure de Douala), puis la semaine suivante ; « le 31 » = dernier jour d''un mois court');
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null

-- 1. Le surveillant : absences de la semaine, chaque vendredi à 16 h, à la direction
select set_config('request.jwt.claim.sub', :'surv_a', false) \g /dev/null
select (public.automatisation_enregistrer('{"texte_source": "Chaque vendredi à 16 h, prépare un rapport des absences de la semaine et envoie-le au directeur.",
  "action": "rapport_absences", "parametres": {"periode": "semaine"}, "frequence": {"type": "hebdo", "jours": [5], "heure": "16:00"}, "destinataire": "direction"}')->>'id') as auto_s \gset
select pg_temp.verifier((select extract(isodow from prochaine_execution at time zone 'Africa/Douala') = 5
  and to_char(prochaine_execution at time zone 'Africa/Douala', 'HH24:MI') = '16:00' from public.automatisations where id = :'auto_s'),
  'règle du surveillant enregistrée, prochaine exécution un vendredi à 16:00');
do $$ begin perform public.automatisation_enregistrer('{"action": "rapport_paiements", "frequence": {"type": "quotidien", "heure": "18:00"}}'); raise exception 'surveillant et paiements';
exception when insufficient_privilege then raise notice 'ok : une action hors du rôle est refusée (surveillant : paiements)'; end $$;
do $$ begin perform public.automatisation_enregistrer('{"action": "rapport_absences", "frequence": {"type": "hebdo", "jours": [], "heure": "16:00"}}'); raise exception 'aucun jour';
exception when sqlstate '22023' then raise notice 'ok : fréquence hebdomadaire sans jour refusée'; end $$;
do $$ begin perform public.automatisation_enregistrer('{"action": "rapport_absences", "frequence": {"type": "quotidien", "heure": "25:00"}}'); raise exception 'heure invalide';
exception when sqlstate '22023' then raise notice 'ok : heure invalide refusée'; end $$;
-- seuil d'heures non justifiées (« plus de 10 h ») : conservé, validé, appliqué au rapport
select (public.automatisation_enregistrer('{"action": "rapport_absences", "parametres": {"periode": "mois", "seuil_heures": 10},
  "frequence": {"type": "hebdo", "jours": [1], "heure": "08:00"}}')->>'id') as auto_seuil \gset
do $$ begin perform public.automatisation_enregistrer('{"action": "rapport_absences", "parametres": {"seuil_heures": 0}, "frequence": {"type": "quotidien", "heure": "08:00"}}'); raise exception 'seuil nul';
exception when sqlstate '22023' then raise notice 'ok : seuil d''heures hors limites refusé'; end $$;
reset role;
select pg_temp.verifier((select (parametres->>'seuil_heures')::int = 10 from public.automatisations where id = :'auto_seuil')
  and (select (public._auto_contenu(a, 'surveillant')->>'seuil_heures')::int = 10
         and not exists (select 1 from jsonb_array_elements(public._auto_contenu(a, 'surveillant')->'eleves') e where (e->>'heures_nj')::int < 10)
       from public.automatisations a where a.id = :'auto_seuil'),
  'seuil d''heures conservé et appliqué : seuls les élèves ayant au moins 10 h non justifiées sont listés');
delete from public.automatisations where id = :'auto_seuil';
set role authenticated;
select set_config('request.jwt.claim.sub', :'surv_a', false) \g /dev/null

-- 2. Exécution : la direction reçoit le rapport, avec les absences de la période
select public.automatisation_executer_maintenant(:'auto_s') as recus_s \gset
reset role;
select pg_temp.verifier(:'recus_s'::int = (select count(*) from public.personnels where etablissement_id = :'etab_au' and role = 'admin' and actif)
  and (select bool_and(contenu ? 'heures_non_justifiees' and contenu ? 'par_classe') from public.automatisations_rapports where automatisation_id = :'auto_s'),
  'exécution : un rapport des absences pour chaque membre de la direction');
select pg_temp.verifier((select prochaine_execution > now() from public.automatisations where id = :'auto_s'), 'l''essai ne décale pas la planification');
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.automatisations_rapports where automatisation_id = :'auto_s') = 1
  and (select count(*) from public.automatisations) = 0, 'la direction voit le rapport reçu, pas la règle du surveillant');
select id as rapport_s from public.automatisations_rapports where automatisation_id = :'auto_s' \gset
select public.rapport_marquer_lu(:'rapport_s') \g /dev/null
select pg_temp.verifier((select lu_le is not null from public.automatisations_rapports where id = :'rapport_s'), 'rapport marqué lu');

-- 3. L'enseignant : notes non saisies de SES classes, à lui-même ; rappel personnel
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select (public.automatisation_enregistrer('{"action": "rapport_saisie", "frequence": {"type": "hebdo", "jours": [1], "heure": "07:00"}, "destinataire": "moi"}')->>'id') as auto_p \gset
select public.automatisation_executer_maintenant(:'auto_p') \g /dev/null
reset role;
select pg_temp.verifier(not exists (select 1 from public.automatisations_rapports r, jsonb_array_elements(r.contenu->'lignes') l
   where r.automatisation_id = :'auto_p' and l->>'enseignant' is distinct from (select public._libelle(nom, prenom) from public.personnels where id = :'prof_a')),
  'enseignant : le rapport ne porte que sur ses propres matières');
set role authenticated;
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select (public.automatisation_enregistrer('{"action": "rappel", "parametres": {"texte": "Préparer le conseil de classe"}, "frequence": {"type": "hebdo", "jours": [4], "heure": "15:00"}, "destinataire": "direction"}')->>'id') as auto_r \gset
select public.automatisation_executer_maintenant(:'auto_r') \g /dev/null
select pg_temp.verifier((select contenu->>'texte' from public.automatisations_rapports where automatisation_id = :'auto_r') = 'Préparer le conseil de classe'
  and (select count(*) from public.automatisations) = 2, 'rappel personnel reçu ; l''enseignant ne voit que ses propres règles');
do $$ begin perform public.automatisation_supprimer((select id from public.automatisations limit 1)); end $$;
select set_config('app.auto_s', :'auto_s', false) \g /dev/null
do $$ begin perform public.automatisation_supprimer(current_setting('app.auto_s')::uuid); raise exception 'règle d''un autre';
exception when sqlstate 'P0001' then raise notice 'ok : on ne supprime pas la règle d''un collègue'; end $$;

-- 4. Comptable : impayés ; exécution horaire des règles dues
select set_config('request.jwt.claim.sub', :'cpt', false) \g /dev/null
select (public.automatisation_enregistrer('{"action": "rapport_impayes", "parametres": {"periode": "mois"}, "frequence": {"type": "mensuel", "jour_mois": 5, "heure": "07:00"}}')->>'id') as auto_c \gset
reset role;
update public.automatisations set prochaine_execution = now() - interval '1 minute' where id = :'auto_c';
set role anon;
select public.automatisations_executer() as exec_h \gset
reset role;
select pg_temp.verifier((select count(*) from public.automatisations_rapports where automatisation_id = :'auto_c' and contenu ? 'eleves_non_en_regle') = 1
  and (select prochaine_execution > now() from public.automatisations where id = :'auto_c'), 'exécution horaire : règle due exécutée et reprogrammée');
select pg_temp.verifier((public.automatisations_executer()->>'automatisations')::int = 0, 'une règle déjà exécutée ne repart pas avant son heure');

-- 5. Offre : hors Premium, les règles sont mises en pause
update public.etablissements set offre = 'decouverte' where id = :'etab_au';   -- Découverte : pas d'automatisations
update public.automatisations set prochaine_execution = now() - interval '1 minute' where id = :'auto_s';
select public.automatisations_executer() \g /dev/null
select pg_temp.verifier((select not active and derniere_erreur like '%offre%' from public.automatisations where id = :'auto_s'), 'hors offre Premium : règle mise en pause');
set role authenticated;
select set_config('request.jwt.claim.sub', :'surv_a', false) \g /dev/null
do $$ begin perform public.automatisation_enregistrer('{"action": "rapport_absences", "frequence": {"type": "quotidien", "heure": "08:00"}}'); raise exception 'hors offre';
exception when sqlstate 'P0001' then raise notice 'ok : création refusée hors offre Premium'; end $$;
reset role;
update public.etablissements set offre = 'premium' where id = :'etab_au';

-- 6. Cloisonnement
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.automatisations) = 0 and (select count(*) from public.automatisations_rapports) = 0,
  'un autre établissement ne voit ni règles ni rapports');
reset role;
