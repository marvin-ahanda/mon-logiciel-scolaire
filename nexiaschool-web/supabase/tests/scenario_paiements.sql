-- Paiement des abonnements : demande par l'administrateur, montant fixé en base, validation serveur, prolongation, échéance
reset role;
update public.etablissements set offre = 'decouverte', offre_expire_le = null
 where id = (select etablissement_id from public.personnels where id = :'admin_o');
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "google"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_o', false) \g /dev/null
select (public.paiement_preparer('pro', 'mensuel')->>'id')::uuid as pai1 \gset
select pg_temp.verifier((select montant from public.paiements_abonnement where id = :'pai1') = 150, 'paiements : montant fixé en base (Pro mensuel = 150 FCFA)');
select pg_temp.verifier((public.paiement_preparer('premium', 'annuel')->>'montant')::int = 2000, 'paiements : Premium annuel = 2 000 FCFA (10 mois)');
do $$ begin perform public.paiement_preparer('or', 'mensuel'); raise exception 'ÉCHEC : offre inconnue acceptée';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : paiements : offre inconnue refusée'; end $$;
do $$ begin perform public._paiement_valider(gen_random_uuid(), 't', 1); raise exception 'ÉCHEC : validation depuis le navigateur';
exception when insufficient_privilege then raise notice 'ok : paiements : seule la fonction serveur valide un paiement'; end $$;
do $$ begin update public.paiements_abonnement set statut = 'paye'; raise exception 'ÉCHEC : paiement modifié par l''établissement';
exception when insufficient_privilege then raise notice 'ok : paiements : l''établissement ne modifie pas ses paiements'; end $$;
select pg_temp.verifier((select count(*) from public.paiements_abonnement) = 2, 'paiements : l''administrateur voit ses seuls paiements');
select pg_temp.verifier(public.mon_abonnement()->>'effective' = 'decouverte', 'paiements : avant paiement, offre Découverte');
reset role;

-- validation par le serveur (montant insuffisant refusé, puis bon montant)
do $$ begin perform public._paiement_valider((select id from public.paiements_abonnement where montant = 150 limit 1), 'tx1', 100); raise exception 'ÉCHEC : montant insuffisant accepté';
exception when sqlstate 'P0001' then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : paiements : montant payé insuffisant refusé'; end $$;
select public._paiement_valider(:'pai1', 'tx1', 150) \g /dev/null
select pg_temp.verifier((select e.offre = 'pro' and e.offre_periodicite = 'mensuel' and e.offre_expire_le between now() + interval '1 month' - interval '1 minute' and now() + interval '1 month'
  from public.etablissements e join public.paiements_abonnement p on p.etablissement_id = e.id where p.id = :'pai1'), 'paiements : Pro actif pour un mois après paiement');
select pg_temp.verifier((public._paiement_valider(:'pai1', 'tx1', 150)->>'deja')::boolean, 'paiements : validation idempotente (pas de double prolongation)');
-- renouvellement anticipé : la nouvelle période part de l'échéance en cours
select e.id as etab_p, e.offre_expire_le as fin1 from public.etablissements e join public.paiements_abonnement p on p.etablissement_id = e.id where p.id = :'pai1' \gset
insert into public.paiements_abonnement (etablissement_id, offre, periode, montant) values (:'etab_p', 'pro', 'annuel', 1500) returning id as pai2 \gset
select public._paiement_valider(:'pai2', 'tx2', 1500) \g /dev/null
select pg_temp.verifier((select offre_expire_le from public.etablissements where id = :'etab_p') = (:'fin1'::timestamptz + interval '1 year'),
  'paiements : renouvellement avant l''échéance prolongé à partir de l''échéance (annuel = +1 an)');
-- échéance dépassée : coupure automatique, sans tâche planifiée
update public.etablissements set offre_expire_le = now() - interval '1 second' where id = :'etab_p';
select pg_temp.verifier(public._offre_effective(:'etab_p') = 'decouverte' and not public._offre_inclut(:'etab_p', 'smarteval'),
  'paiements : à l''échéance sans renouvellement, retour automatique en Découverte');
insert into public.paiements_abonnement (etablissement_id, offre, periode, montant) values (:'etab_p', 'pro', 'mensuel', 150) returning id as pai3 \gset
select public._paiement_valider(:'pai3', 'tx3', 150) \g /dev/null
select pg_temp.verifier(public._offre_effective(:'etab_p') = 'pro'
  and (select offre_expire_le > now() + interval '27 days' from public.etablissements where id = :'etab_p'), 'paiements : paiement après coupure : réactivé pour un mois à partir d''aujourd''hui');
select public._paiement_echec((select id from public.paiements_abonnement where montant = 2000 limit 1), 'annule') \g /dev/null
select pg_temp.verifier((select statut from public.paiements_abonnement where montant = 2000 limit 1) = 'annule', 'paiements : paiement annulé enregistré');
-- remet l'établissement des offres en Découverte pour la suite
update public.etablissements set offre = 'decouverte', offre_expire_le = null where id = :'etab_p';

-- Reçus : numéro unique et continu, reçu consultable par l'administrateur de l'établissement seulement
reset role;
insert into public.paiements_abonnement (etablissement_id, offre, periode, montant, demande_par)
  select etablissement_id, 'essentiel', 'mensuel', 100, id from public.personnels where id = :'admin_o' returning id as pair1 \gset
select public._paiement_valider(:'pair1', 'tx-recu1', 100) \g /dev/null
insert into public.paiements_abonnement (etablissement_id, offre, periode, montant, demande_par)
  select etablissement_id, 'essentiel', 'mensuel', 100, id from public.personnels where id = :'admin_o' returning id as pair2 \gset
select public._paiement_valider(:'pair2', 'tx-recu2', 100) \g /dev/null
select pg_temp.verifier((select numero_recu ~ '^NXS-[0-9]{4}-[0-9]{6}$' from public.paiements_abonnement where id = :'pair1'), 'reçus : numéro de la forme NXS-AAAA-000001');
select pg_temp.verifier((select b.numero_recu > a.numero_recu from public.paiements_abonnement a, public.paiements_abonnement b where a.id = :'pair1' and b.id = :'pair2'),
  'reçus : numéros croissants, sans doublon');
select pg_temp.verifier((select count(*) from public.paiements_abonnement where statut = 'paye' and numero_recu is null) = 0, 'reçus : tout paiement validé a un numéro');
select pg_temp.verifier(public._paiement_valider(:'pair1', 'tx-recu1', 100)->>'numero_recu' = (select numero_recu from public.paiements_abonnement where id = :'pair1'),
  'reçus : revalider un paiement ne change pas son numéro');
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "google"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_o', false) \g /dev/null
select pg_temp.verifier(public.recu_paiement(:'pair1')->>'numero' = (select numero_recu from public.paiements_abonnement where id = :'pair1')
  and (public.recu_paiement(:'pair1')->>'montant')::int = 100 and public.recu_paiement(:'pair1')->'etablissement'->>'nom' = 'École des offres',
  'reçus : l''administrateur obtient le contenu de son reçu');
select pg_temp.verifier((select bool_and(p->>'numero_recu' is not null) from jsonb_array_elements(public.mon_abonnement()->'paiements') p where p->>'statut' = 'paye'),
  'reçus : numéros visibles dans l''historique');
do $$ begin perform public._recu_a_envoyer(gen_random_uuid()); raise exception 'ÉCHEC : données d''envoi lisibles depuis le navigateur';
exception when insufficient_privilege then raise notice 'ok : reçus : préparation de l''e-mail réservée au serveur'; end $$;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
do $$ begin perform public.recu_paiement((select id from public.paiements_abonnement where numero_recu is not null limit 1)); raise exception 'ÉCHEC : reçu d''un autre établissement';
exception when sqlstate 'P0001' or insufficient_privilege then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'ok : reçus : le reçu d''un autre établissement est refusé'; end $$;
reset role;
update public.etablissements set offre = 'decouverte', offre_expire_le = null where id = (select etablissement_id from public.personnels where id = :'admin_o');

-- QR code anti-fraude des reçus
reset role;
select pg_temp.verifier((select bool_and(code_verif ~ '^[0-9A-F]{20}$') and count(*) > 0 from public.paiements_abonnement where numero_recu is not null),
  'QR reçus : chaque reçu a un code de vérification de 20 caractères');
select pg_temp.verifier((select count(distinct code_verif) = count(*) from public.paiements_abonnement where numero_recu is not null), 'QR reçus : codes tous différents');
select code_verif as code_r, numero_recu as num_r from public.paiements_abonnement where id = :'pair1' \gset
set role anon;
select pg_temp.verifier(public.verifier_recu(:'code_r')->>'numero' = :'num_r' and (public.verifier_recu(lower(:'code_r'))->>'montant')::int = 100,
  'QR reçus : la page publique retrouve le reçu (même en minuscules), sans connexion');
select pg_temp.verifier(public.verifier_recu('ABCDEF0123456789ABCD') is null and public.verifier_recu('') is null and public.verifier_recu(left(:'code_r', 19)) is null,
  'QR reçus : code inconnu ou tronqué : aucun reçu');
select pg_temp.verifier(not (public.verifier_recu(:'code_r') ? 'transaction') and not (public.verifier_recu(:'code_r') ? 'code'),
  'QR reçus : la page publique ne dévoile ni la transaction ni le code');
do $$ begin perform 1 from public.paiements_abonnement; raise exception 'ÉCHEC : paiements lisibles sans connexion';
exception when insufficient_privilege then raise notice 'ok : QR reçus : les paiements restent inaccessibles sans connexion'; end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "google"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_o', false) \g /dev/null
select pg_temp.verifier(public.recu_paiement(:'pair1')->>'code' = :'code_r', 'QR reçus : le reçu de l''administrateur contient son code');

-- Rappels de fin d'abonnement (J-5 à J-0, un par jour)
reset role;
select etablissement_id as etab_r from public.personnels where id = :'admin_o' \gset
delete from public.rappels_abonnement;
update public.etablissements set offre = 'pro', offre_expire_le = now() + interval '5 days' where id = :'etab_r';
select pg_temp.verifier((select (x->>'jours')::int = 5 and x->'emails' ? 'fondateur.offres@gmail.com' from jsonb_array_elements(public._rappels_a_envoyer()) x
  where x->>'etablissement_id' = :'etab_r'), 'rappels : J-5, destiné à l''administrateur (e-mail Google)');
select public._rappel_envoye(:'etab_r', (select offre_expire_le from public.etablissements where id = :'etab_r'), 5) \g /dev/null
select pg_temp.verifier(not exists (select 1 from jsonb_array_elements(public._rappels_a_envoyer()) x where x->>'etablissement_id' = :'etab_r'),
  'rappels : un seul rappel par jour');
update public.rappels_abonnement set envoye_le = now() - interval '1 day';
update public.etablissements set offre_expire_le = offre_expire_le - interval '1 day' where id = :'etab_r';
select pg_temp.verifier((select (x->>'jours')::int from jsonb_array_elements(public._rappels_a_envoyer()) x where x->>'etablissement_id' = :'etab_r') = 4,
  'rappels : le lendemain, nouveau rappel à J-4');
update public.etablissements set offre_expire_le = now() + interval '2 hours' where id = :'etab_r';
select pg_temp.verifier((select (x->>'jours')::int from jsonb_array_elements(public._rappels_a_envoyer()) x where x->>'etablissement_id' = :'etab_r') in (0, 1),
  'rappels : dernier jour encore rappelé');
update public.etablissements set offre_expire_le = now() + interval '7 days' where id = :'etab_r';
select pg_temp.verifier(not exists (select 1 from jsonb_array_elements(public._rappels_a_envoyer()) x where x->>'etablissement_id' = :'etab_r'),
  'rappels : pas de rappel à plus de 5 jours');
update public.etablissements set offre_expire_le = now() - interval '1 hour' where id = :'etab_r';
select pg_temp.verifier(not exists (select 1 from jsonb_array_elements(public._rappels_a_envoyer()) x where x->>'etablissement_id' = :'etab_r'),
  'rappels : plus de rappel une fois l''abonnement terminé');
update public.etablissements set offre = 'decouverte', offre_expire_le = now() + interval '3 days' where id = :'etab_r';
select pg_temp.verifier(not exists (select 1 from jsonb_array_elements(public._rappels_a_envoyer()) x where x->>'etablissement_id' = :'etab_r'),
  'rappels : jamais pour l''offre gratuite Découverte');
select pg_temp.verifier(not exists (select 1 from jsonb_array_elements(public._rappels_a_envoyer()) x, jsonb_array_elements_text(x->'emails') m where m like '%.invalid'),
  'rappels : jamais aux comptes du personnel sans e-mail réel');
set role authenticated;
do $$ begin perform public._rappels_a_envoyer(); raise exception 'ÉCHEC : rappels lisibles depuis le navigateur';
exception when insufficient_privilege then raise notice 'ok : rappels : liste réservée au serveur'; end $$;
reset role;
update public.etablissements set offre = 'decouverte', offre_expire_le = null where id = :'etab_r';
