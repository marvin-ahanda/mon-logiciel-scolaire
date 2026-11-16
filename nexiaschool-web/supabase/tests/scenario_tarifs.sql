-- Tarifs des offres en base : lecture publique, montant recalculé côté serveur, modification réservée au propriétaire
reset role;
set role anon;
select pg_temp.verifier((select jsonb_agg(x->>'offre') from jsonb_array_elements(public.tarifs_offres()) x) = '["essentiel", "pro", "premium"]'::jsonb,
  'tarifs : lisibles sans connexion, dans l''ordre des offres');
select pg_temp.verifier((select jsonb_object_agg(x->>'offre', (x->>'mensuel')::int) from jsonb_array_elements(public.tarifs_offres()) x)
  = '{"essentiel": 100, "pro": 150, "premium": 200}'::jsonb, 'tarifs : prix de test 100 / 150 / 200 FCFA par mois');
select pg_temp.verifier((select (x->>'annuel')::int from jsonb_array_elements(public.tarifs_offres()) x where x->>'offre' = 'pro') = 1500,
  'tarifs : annuel = 10 mois facturés');
do $$ begin perform 1 from public.tarifs; raise exception 'ÉCHEC : table lisible directement';
exception when insufficient_privilege then raise notice 'ok : tarifs : table inaccessible directement'; end $$;
do $$ begin perform public._montant_offre('pro', 'mensuel'); raise exception 'ÉCHEC : montant appelable depuis le navigateur';
exception when insufficient_privilege then raise notice 'ok : tarifs : calcul du montant réservé au serveur'; end $$;
reset role;
select pg_temp.verifier(public._montant_offre('essentiel', 'mensuel') = 100 and public._montant_offre('premium', 'annuel') = 2000,
  'tarifs : montant à payer calculé en base');
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "google"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_o', false) \g /dev/null
do $$ begin perform public.console_definir_tarif('pro', 1); raise exception 'ÉCHEC : prix changé par un établissement';
exception when insufficient_privilege then raise notice 'ok : tarifs : modification réservée au propriétaire de la plateforme'; end $$;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select pg_temp.verifier((select (x->>'mensuel')::int from jsonb_array_elements(public.console_definir_tarif('pro', 175)) x where x->>'offre' = 'pro') = 175,
  'tarifs : le propriétaire change un prix');
select public.console_definir_tarif('pro', 150) \g /dev/null
reset role;
