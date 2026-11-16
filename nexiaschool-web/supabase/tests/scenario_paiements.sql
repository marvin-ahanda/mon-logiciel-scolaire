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
