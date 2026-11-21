-- Modèle des établissements : Découverte / Premium (toutes les fonctions), capacité = élèves inscrits de l'année,
-- souscription au tarif de l'effectif, augmentation de capacité, renouvellement, échéance, anciens abonnements,
-- une seule offre gratuite par adresse e-mail, configuration centralisée.
reset role;
alter table public.etablissements alter column offre set default 'decouverte';
insert into auth.users (id, email) values ('28282828-2828-4828-8828-282828282828', 'fondateur.offres@gmail.com'),
                                          ('29292929-2929-4929-8929-292929292929', 'Fondateur.Offres+deux@googlemail.com');
\set admin_o 28282828-2828-4828-8828-282828282828
\set admin_o2 29292929-2929-4929-8929-292929292929
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "google"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_o', false) \g /dev/null
select public.creer_etablissement_google('École des offres', 'Bertoua', '', '', '', '', 'Biya', 'Anne') \g /dev/null
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
select public.etab_courant() as etab_o \gset
select set_config('app.etab_o', :'etab_o', false) \g /dev/null

-- 1. Découverte : fonctions de base, période limitée
select pg_temp.verifier(public.etat_abonnement() ->> 'offre' = 'decouverte'
  and (public.etat_abonnement() ->> 'decouverte_fin')::timestamptz between now() + interval '119 days' and now() + interval '121 days',
  'offres : un nouvel établissement démarre en Découverte (120 jours)');
select pg_temp.verifier(public.offre_inclut('notes') and public.offre_inclut('bulletins') and not public.offre_inclut('finances')
  and not public.offre_inclut('smarteval') and not public.offre_inclut('ia') and not public.offre_inclut('edt'),
  'offres : Découverte = fonctions de base seulement');
select pg_temp.verifier(public.offre_requise('edt') = 'premium' and public.offre_requise('notes') = 'decouverte' and public.offre_requise('module_futur') = 'premium',
  'offres : toute fonction non gratuite (y compris future) relève de Premium');
do $$ begin perform public.discipline_enregistrer_seuils(10, '[]'); raise exception 'ÉCHEC : seuils en Découverte';
exception when sqlstate 'P0001' then
  if sqlerrm like 'ÉCHEC%' or sqlerrm not like '%offre Premium%' then raise; end if;
  raise notice 'ok : offres : fonction Premium refusée en Découverte — %', sqlerrm; end $$;
do $$ begin perform public.definir_ia_personnelle(true); raise exception 'ÉCHEC : IA en Découverte';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : offres : IA et API refusées en Découverte'; end $$;
do $$ begin update public.etablissements set offre = 'premium' where id = public.etab_courant(); raise exception 'ÉCHEC : offre changée par l''établissement';
exception when insufficient_privilege then raise notice 'ok : offres : l''établissement ne change pas lui-même sa formule'; end $$;
do $$ begin perform public.console_definir_offre(public.etab_courant(), 'premium', 'annuel', null); raise exception 'ÉCHEC : formule attribuée par l''établissement';
exception when insufficient_privilege then raise notice 'ok : offres : attribution réservée au propriétaire de la plateforme'; end $$;

-- 2. Capacité de Découverte : 50 élèves INSCRITS (les élèves sans inscription ne comptent pas)
insert into public.exercices (libelle, actif) values ('2026-2027', true) returning id as ex_o \gset
insert into public.classes (libelle) values ('6e A') returning id as cl_o \gset
insert into public.eleves (matricule, nom, prenom, sexe) select 'O' || g, 'Élève', 'N' || g, 'M' from generate_series(1, 130) g;
select pg_temp.verifier((select count(*) from public.eleves where etablissement_id = :'etab_o') = 130, 'capacité : les élèves non inscrits (prospects) ne sont pas limités');
insert into public.inscriptions (exercice_id, classe_id, eleve_id)
  select :'ex_o', :'cl_o', id from public.eleves where etablissement_id = :'etab_o' and matricule in (select 'O' || g from generate_series(1, 50) g);
select pg_temp.verifier((public.etat_abonnement() ->> 'capacite')::int = 50 and (public.etat_abonnement() ->> 'eleves_actifs')::int = 50
  and (public.etat_abonnement() ->> 'places_restantes')::int = 0, 'capacité : Découverte = 50 élèves inscrits, 0 place restante');
select id as eleve51 from public.eleves where matricule = 'O51' and etablissement_id = :'etab_o' \gset
select set_config('app.eleve51', :'eleve51', false), set_config('app.ex_o', :'ex_o', false), set_config('app.cl_o', :'cl_o', false) \g /dev/null
do $$ begin insert into public.inscriptions (exercice_id, classe_id, eleve_id)
  values (current_setting('app.ex_o')::uuid, current_setting('app.cl_o')::uuid, current_setting('app.eleve51')::uuid); raise exception 'ÉCHEC : 51e inscription';
exception when sqlstate 'P0001' then
  if sqlerrm like 'ÉCHEC%' or sqlerrm not like 'Vous avez atteint la limite d''élèves autorisée par votre abonnement actuel (50 élèves)%' then raise; end if;
  raise notice 'ok : capacité : 51e élève refusé — %', sqlerrm; end $$;
-- un retrait d'inscription (élève sortant, archivé) libère une place
delete from public.inscriptions where eleve_id = (select id from public.eleves where matricule = 'O1' and etablissement_id = :'etab_o');
insert into public.inscriptions (exercice_id, classe_id, eleve_id) values (:'ex_o', :'cl_o', :'eleve51');
select pg_temp.verifier((public.etat_abonnement() ->> 'eleves_actifs')::int = 50, 'capacité : une inscription retirée libère une place, réutilisée');
-- la réactivation de l'élève retiré nécessite une place
do $$ begin insert into public.inscriptions (exercice_id, classe_id, eleve_id)
  values (current_setting('app.ex_o')::uuid, current_setting('app.cl_o')::uuid, (select id from public.eleves where matricule = 'O1' and etablissement_id = current_setting('app.etab_o')::uuid));
  raise exception 'ÉCHEC : réactivation sans place';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : capacité : réactivation refusée sans place disponible'; end $$;
-- plafond de 10 comptes du personnel en Découverte
select public.creer_personnel('Agent', 'N' || g, 'enseignant', '', '') from generate_series(1, 9) g \g /dev/null
do $$ begin perform public.creer_personnel('Agent', 'N10', 'enseignant', '', ''); raise exception 'ÉCHEC : 11e compte';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : offres : 11e compte du personnel refusé en Découverte'; end $$;

-- 3. Souscription Premium : montant calculé en base (500 FCFA par élève, minimum 50 000)
select pg_temp.verifier((public.paiement_preparer_produit('{"produit": "etab_abonnement", "capacite": 120}') ->> 'montant')::int = 60000
  and (public.paiement_preparer_produit('{"produit": "etab_abonnement", "capacite": 30}') ->> 'montant')::int = 50000,
  'paiements : 120 élèves = 60 000 FCFA ; 30 élèves = minimum de 50 000 FCFA');
select (public.paiement_preparer_produit('{"produit": "etab_abonnement", "capacite": 100, "montant": 1}') ->> 'id') as pai_o \gset
select pg_temp.verifier((select montant from public.paiements_abonnement where id = :'pai_o') = 50000, 'paiements : le montant envoyé par le navigateur est ignoré');
do $$ begin perform public.paiement_preparer_produit('{"produit": "etab_abonnement", "capacite": 0}'); raise exception 'ÉCHEC : capacité nulle';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : paiements : effectif invalide refusé'; end $$;
do $$ begin perform public.paiement_preparer_produit('{"produit": "or"}'); raise exception 'ÉCHEC : produit inconnu';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : paiements : produit inconnu refusé'; end $$;
do $$ begin perform public.paiement_preparer('pro', 'mensuel'); raise exception 'ÉCHEC : ancienne formule';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : paiements : anciennes formules retirées'; end $$;
do $$ begin perform public._paiement_valider(gen_random_uuid(), 't', 1); raise exception 'ÉCHEC : validation depuis le navigateur';
exception when insufficient_privilege then raise notice 'ok : paiements : seule la fonction serveur valide un paiement'; end $$;
do $$ begin update public.paiements_abonnement set statut = 'paye'; raise exception 'ÉCHEC : paiement modifié';
exception when insufficient_privilege then raise notice 'ok : paiements : l''établissement ne modifie pas ses paiements'; end $$;
select pg_temp.verifier(public.etat_abonnement() ->> 'offre' = 'decouverte', 'paiements : rien n''est activé avant la vérification du paiement');
reset role;
do $$ begin perform public._paiement_valider((select id from public.paiements_abonnement where montant = 50000 and produit = 'etab_abonnement'
  and etablissement_id = current_setting('app.etab_o')::uuid order by cree_le desc limit 1), 'tx', 49999); raise exception 'ÉCHEC : montant insuffisant';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : paiements : montant payé insuffisant refusé'; end $$;
select public._paiement_valider(:'pai_o', 'tx-o1', 50000) \g /dev/null
select pg_temp.verifier((public._paiement_valider(:'pai_o', 'tx-o1', 50000) ->> 'deja')::boolean
  and (select count(*) from public.abonnements_etablissement where etablissement_id = :'etab_o') = 1,
  'paiements : notification répétée sans double activation');
select pg_temp.verifier(public._offre_effective(:'etab_o') = 'premium' and public._capacite_eleves(:'etab_o') = 100
  and (select offre_expire_le between now() + interval '12 months' - interval '1 minute' and now() + interval '12 months' from public.etablissements where id = :'etab_o'),
  'paiements : Premium actif 12 mois à compter du paiement, capacité 100');
select pg_temp.verifier((select bool_and(public._offre_inclut(:'etab_o', f)) from unnest(public._fonctions_reglables()) f),
  'premium : absolument toutes les fonctionnalités sont ouvertes');

-- 4. Capacité Premium : 100 élèves inscrits, pas 101
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_o', false) \g /dev/null
insert into public.inscriptions (exercice_id, classe_id, eleve_id)
  select :'ex_o', :'cl_o', e.id from public.eleves e where e.etablissement_id = :'etab_o'
     and not exists (select 1 from public.inscriptions i where i.eleve_id = e.id) order by e.matricule limit 50;
select pg_temp.verifier((public.etat_abonnement() ->> 'eleves_actifs')::int = 100 and (public.etat_abonnement() ->> 'places_restantes')::int = 0,
  'capacité : 100 élèves inscrits pour 100 souscrits');
do $$ begin insert into public.inscriptions (exercice_id, classe_id, eleve_id)
  select current_setting('app.ex_o')::uuid, current_setting('app.cl_o')::uuid, e.id from public.eleves e where e.etablissement_id = current_setting('app.etab_o')::uuid
     and not exists (select 1 from public.inscriptions i where i.eleve_id = e.id) limit 5;
  raise exception 'ÉCHEC : lot au-delà de la capacité';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : capacité : ajout en masse refusé au-delà de 100 (rien n''est inscrit)'; end $$;
select pg_temp.verifier((public.etat_abonnement() ->> 'eleves_actifs')::int = 100, 'capacité : le lot refusé n''a rien inscrit');
do $$ begin perform public.api_ajouter_eleve('nxs_' || repeat('0', 48), 'X', 'X', 'X', 'M', null, '6e A'); raise exception 'ÉCHEC : API';
exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : capacité : l''API passe par le même contrôle (clé invalide ici)'; end $$;

-- 5. Augmentation de capacité : 100 → 120 = 10 000 FCFA, échéance conservée, activation après paiement
select offre_expire_le as fin_o from public.etablissements where id = :'etab_o' \gset
select (public.paiement_preparer_produit('{"produit": "etab_extension", "capacite": 120}') ->> 'id') as pai_x \gset
select pg_temp.verifier((select montant from public.paiements_abonnement where id = :'pai_x') = 10000, 'augmentation : 100 → 120 élèves = 10 000 FCFA');
do $$ begin perform public.paiement_preparer_produit('{"produit": "etab_extension", "capacite": 90}'); raise exception 'ÉCHEC : diminution';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : augmentation : diminution refusée en cours d''abonnement'; end $$;
do $$ begin perform public.paiement_preparer_produit('{"produit": "etab_abonnement", "capacite": 200}'); raise exception 'ÉCHEC : renouvellement prématuré';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : renouvellement : impossible plus de 60 jours avant l''échéance'; end $$;
reset role;
-- un paiement échoué ne change rien
select public._paiement_echec(:'pai_x', 'echoue') \g /dev/null
select pg_temp.verifier(public._capacite_eleves(:'etab_o') = 100, 'augmentation : paiement échoué, capacité inchangée');
set role authenticated;
select (public.paiement_preparer_produit('{"produit": "etab_extension", "capacite": 120}') ->> 'id') as pai_x2 \gset
reset role;
select public._paiement_valider(:'pai_x2', 'tx-x2', 10000) \g /dev/null
select pg_temp.verifier(public._capacite_eleves(:'etab_o') = 120 and (select offre_expire_le from public.etablissements where id = :'etab_o') = :'fin_o'::timestamptz
  and (select montant_paye from public.abonnements_etablissement where etablissement_id = :'etab_o') = 60000
  and exists (select 1 from public.abonnements_historique where etablissement_id = :'etab_o' and type = 'extension' and capacite_avant = 100 and capacite_apres = 120),
  'augmentation : capacité 120 après paiement vérifié, échéance conservée, historique');

-- 6. Renouvellement dans les 60 jours : capacité modifiée (80), période suivante à l'échéance ; minimum = 100 élèves
update public.abonnements_etablissement set fin = now() + interval '10 days' where etablissement_id = :'etab_o';
update public.etablissements set offre_expire_le = now() + interval '10 days' where id = :'etab_o';
set role authenticated;
select (public.paiement_preparer_produit('{"produit": "etab_abonnement", "capacite": 80}') ->> 'id') as pai_r \gset
select pg_temp.verifier((select montant from public.paiements_abonnement where id = :'pai_r') = 50000, 'renouvellement : 80 élèves = minimum de 50 000 FCFA');
reset role;
select offre_expire_le as fin_r from public.etablissements where id = :'etab_o' \gset
select public._paiement_valider(:'pai_r', 'tx-r', 50000) \g /dev/null
select pg_temp.verifier(public._capacite_eleves(:'etab_o') = 120
  and (select debut from public.abonnements_etablissement where etablissement_id = :'etab_o' order by debut desc limit 1) = :'fin_r'::timestamptz
  and (select offre_expire_le from public.etablissements where id = :'etab_o') = :'fin_r'::timestamptz + interval '12 months',
  'renouvellement anticipé : la capacité en cours reste 120 ; la nouvelle période commence à l''échéance (aucun jour perdu)');
-- passage à la nouvelle période : capacité 100 (le minimum annuel couvre 100 élèves)
update public.abonnements_etablissement set debut = debut - interval '11 days', fin = fin - interval '11 days' where etablissement_id = :'etab_o';
update public.etablissements set offre_expire_le = offre_expire_le - interval '11 days' where id = :'etab_o';
select pg_temp.verifier(public._capacite_eleves(:'etab_o') = 100, 'renouvellement : nouvelle période avec la capacité choisie (minimum annuel : 100 élèves)');

-- 7. Échéance dépassée (après le délai de grâce) : consultation seulement, aucune donnée supprimée
update public.abonnements_etablissement set debut = now() - interval '2 years', fin = now() - interval '20 days' where etablissement_id = :'etab_o';
update public.etablissements set offre_expire_le = now() - interval '20 days', decouverte_fin = now() - interval '1 day' where id = :'etab_o';
select pg_temp.verifier(public._offre_effective(:'etab_o') = 'expiree' and not public._offre_inclut(:'etab_o', 'notes') and public._capacite_eleves(:'etab_o') = 0
  and (select count(*) from public.inscriptions where etablissement_id = :'etab_o') = 100,
  'échéance : formule expirée, plus de saisie ni d''inscription, données conservées');
set role authenticated;
do $$ begin insert into public.inscriptions (exercice_id, classe_id, eleve_id)
  select current_setting('app.ex_o')::uuid, current_setting('app.cl_o')::uuid, e.id from public.eleves e where e.etablissement_id = current_setting('app.etab_o')::uuid
     and not exists (select 1 from public.inscriptions i where i.eleve_id = e.id) limit 1;
  raise exception 'ÉCHEC : inscription après échéance';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' or sqlerrm not like '%arrivé à échéance%' then raise; end if;
  raise notice 'ok : échéance : nouvelle inscription refusée — %', sqlerrm; end $$;
select pg_temp.verifier((public.etat_abonnement() ->> 'renouvelable')::boolean, 'échéance : le renouvellement reste possible');
reset role;

-- 8. Ancien abonnement (formule Pro payée) : Premium jusqu'à l'échéance, effectif illimité
update public.etablissements set offre = 'pro', offre_expire_le = now() + interval '20 days' where id = :'etab_o';
delete from public.abonnements_etablissement where etablissement_id = :'etab_o';
select pg_temp.verifier(public._offre_effective(:'etab_o') = 'premium' and public._capacite_eleves(:'etab_o') is null,
  'ancien abonnement : toutes les fonctions et effectif illimité jusqu''à l''échéance payée');

-- 9. Une seule offre gratuite par adresse e-mail (variantes Gmail comprises)
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "google"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_o2', false) \g /dev/null
select public.creer_etablissement_google('École bis des offres', 'Bertoua', '', '', '', '', 'Biya', 'Anne') \g /dev/null
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
select pg_temp.verifier(public.etat_abonnement() ->> 'offre' = 'expiree',
  'essai gratuit : la même adresse (variante +étiquette, points, googlemail) n''obtient pas une seconde Découverte');
reset role;

-- 10. Configuration centralisée (propriétaire de la plateforme)
set role anon;
select pg_temp.verifier((public.offres_publiques() -> 'etablissement' ->> 'prix_eleve')::int = 500
  and (public.offres_publiques() -> 'etablissement' ->> 'minimum_annuel')::int = 50000
  and (public.offres_publiques() -> 'smarteval' ->> 'prix_annuel')::int = 5000
  and (public.offres_publiques() -> 'smarteval' -> 'groupe' ->> 'prix_annuel')::int = 15000,
  'configuration : tarifs publics lisibles sans connexion (500 / 50 000 / 5 000 / 15 000 FCFA)');
do $$ begin perform 1 from public.config_commerciale; raise exception 'ÉCHEC : configuration lisible';
exception when insufficient_privilege then raise notice 'ok : configuration : table inaccessible directement'; end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_o', false) \g /dev/null
do $$ begin perform public.console_definir_config('{"etab_prix_eleve": 1}'); raise exception 'ÉCHEC : prix changé par un établissement';
exception when insufficient_privilege then raise notice 'ok : configuration : modification réservée au propriétaire'; end $$;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select pg_temp.verifier((public.console_definir_config('{"etab_prix_eleve": 600}') ->> 'etab_prix_eleve')::int = 600, 'configuration : le propriétaire change le prix par élève');
reset role;
select pg_temp.verifier(public._montant_etablissement(100) = 60000, 'configuration : les montants suivent le nouveau prix');
set role authenticated;
do $$ begin perform public.console_definir_config('{"etab_prix_eleve": -5}'); raise exception 'ÉCHEC : prix négatif';
exception when sqlstate '22023' then raise notice 'ok : configuration : valeur invalide refusée'; end $$;
select public.console_definir_config('{"etab_prix_eleve": 500}') \g /dev/null
reset role;

-- remise en Découverte de l'école des offres pour la suite (scénarios fonctions, tarifs, paiements)
update public.etablissements set offre = 'decouverte', offre_expire_le = null, decouverte_fin = now() + interval '120 days' where id = :'etab_o';
delete from public.inscriptions where etablissement_id = :'etab_o' and eleve_id not in
  (select id from public.eleves where etablissement_id = :'etab_o' and matricule in (select 'O' || g from generate_series(2, 51) g));
