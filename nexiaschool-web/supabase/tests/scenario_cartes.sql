-- Cartes scolaires : configuration, cachet et signature (accès restreint, remplacement, révocation), émission par lot,
-- réutilisation ou régénération, suspension, révocation, vérification publique sans données sensibles, cloisonnement
reset role;
update public.etablissements set offre = 'premium', offre_expire_le = null where id = (select etablissement_id from public.personnels where id = :'admin_a');
select etablissement_id as etab_c from public.personnels where id = :'admin_a' \gset
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null

-- 1. Configuration
select public.cartes_config_enregistrer('{"modele":"premium","couleur":"#0B46E5","couleur2":"#F2B705","champs":{"sexe":false},"verification_paiement":true}'::jsonb) \g /dev/null
select pg_temp.verifier((select modele from public.cartes_config) = 'premium' and (select verification_paiement from public.cartes_config),
  'cartes : modèle, couleurs et contenu enregistrés');
do $$ begin perform public.cartes_config_enregistrer('{"modele":"inconnu"}'::jsonb); raise exception 'modèle inconnu accepté';
exception when sqlstate 'P0001' then raise notice 'ok : cartes : modèle inconnu refusé'; end $$;
do $$ begin perform public.cartes_config_enregistrer('{"couleur":"bleu"}'::jsonb); raise exception 'couleur invalide acceptée';
exception when sqlstate 'P0001' then raise notice 'ok : cartes : couleur invalide refusée'; end $$;

-- 2. Cachet et signature : fichier déposé dans le compartiment privé, puis enregistré
reset role;
insert into storage.objects (bucket_id, name) values ('signatures', :'etab_c' || '/cachet-1.png'), ('signatures', :'etab_c' || '/signature-1.png'),
                                                     ('signatures', :'etab_c' || '/signature-2.png');
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select (public.signature_enregistrer('cachet', :'etab_c' || '/cachet-1.png', repeat('a', 64))->>'id') as cachet1 \gset
select (public.signature_enregistrer('signature', :'etab_c' || '/signature-1.png', repeat('b', 64))->>'id') as sig1 \gset
select set_config('app.etab_c', :'etab_c', false) \g /dev/null
do $$ begin perform public.signature_enregistrer('signature', current_setting('app.etab_c') || '/signature-9.png', repeat('c', 64)); raise exception 'fichier absent accepté';
exception when sqlstate 'P0001' then raise notice 'ok : signature : fichier absent du stockage refusé'; end $$;
do $$ begin perform public.signature_enregistrer('signature', '00000000-0000-0000-0000-000000000000/signature-1.png', repeat('c', 64)); raise exception 'autre dossier accepté';
exception when sqlstate 'P0001' then raise notice 'ok : signature : fichier d''un autre établissement refusé'; end $$;
select pg_temp.verifier((select count(*) from public.signatures_etablissement where statut = 'active') = 2, 'un cachet et une signature actifs');
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.signatures_etablissement) = 0, 'enseignant : cachets et signatures invisibles');
do $$ begin perform public.signature_revoquer((select id from public.signatures_etablissement limit 1), 'test'); raise exception 'enseignant révoque';
exception when insufficient_privilege or sqlstate 'P0001' then raise notice 'ok : un enseignant ne peut pas gérer les signatures'; end $$;

-- 3. Émission par lot
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select i.id as ins_m2c from public.inscriptions i join public.eleves e on e.id = i.eleve_id where e.matricule = 'M2' and i.etablissement_id = :'etab_c' \gset
select public.cartes_emettre(jsonb_build_array(jsonb_build_object('inscription_id', :'ins_a', 'empreinte', repeat('1', 64)),
  jsonb_build_object('inscription_id', :'ins_m2c', 'empreinte', repeat('2', 64)),
  jsonb_build_object('inscription_id', '00000000-0000-0000-0000-000000000000', 'empreinte', repeat('3', 64)))) as lot1 \gset
select set_config('app.lot1', :'lot1', false) \g /dev/null
select pg_temp.verifier(jsonb_array_length(current_setting('app.lot1')::jsonb) = 2
  and (select bool_and((x->>'nouvelle')::boolean and x->>'code' ~ '^[A-HJ-NP-Z2-9]{12}$') from jsonb_array_elements(current_setting('app.lot1')::jsonb) x),
  'émission : 2 cartes neuves avec code ; élève étranger ignoré');
select code as code_a from public.cartes_scolaires where inscription_id = :'ins_a' and statut = 'active' \gset
select pg_temp.verifier((select cachet_id from public.cartes_scolaires where code = :'code_a') = :'cachet1'::uuid
  and (select expire_le from public.cartes_scolaires where code = :'code_a') = date '2027-08-31',
  'chaque carte retient son cachet et sa signature ; expiration en fin d''année scolaire');
-- réimpression sans changement : même carte ; contenu modifié (classe, photo…) : nouvelle version
select public.cartes_emettre(jsonb_build_array(jsonb_build_object('inscription_id', :'ins_a', 'empreinte', repeat('1', 64)))) \g /dev/null
select pg_temp.verifier((select count(*) from public.cartes_scolaires where inscription_id = :'ins_a') = 1, 'réimpression à l''identique : même carte, même code');
select public.cartes_emettre(jsonb_build_array(jsonb_build_object('inscription_id', :'ins_a', 'empreinte', repeat('4', 64)))) \g /dev/null
select pg_temp.verifier((select statut from public.cartes_scolaires where code = :'code_a') = 'remplacee'
  and (select version from public.cartes_scolaires where inscription_id = :'ins_a' and statut = 'active') = 2,
  'contenu modifié : nouvelle carte (version 2), l''ancienne est remplacée');
reset role; set role anon;
select pg_temp.verifier((public.verifier_carte(:'code_a')->'carte'->>'statut') = 'remplacee', 'QR de l''ancienne carte : « remplacée »');
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select code as code_a2, id as carte_a2 from public.cartes_scolaires where inscription_id = :'ins_a' and statut = 'active' \gset

-- 4. Vérification publique : sans données sensibles ; situation de pension si l'établissement l'a choisi
reset role; set role anon;
select public.verifier_carte(lower(:'code_a2')) as v \gset
select set_config('app.v', :'v', false) \g /dev/null
select pg_temp.verifier((current_setting('app.v')::jsonb->'carte'->>'statut') = 'valide'
  and (current_setting('app.v')::jsonb->'carte'->>'eleve') ilike 'abena%'
  and not (current_setting('app.v')::jsonb->'carte' ?| array['matricule', 'date_naissance', 'photo', 'montant'])
  and (current_setting('app.v')::jsonb->'carte'->>'paiement') in ('a_jour', 'non_en_regle'),
  'QR : carte valide, nom et classe seulement, situation de pension (option activée)');
select pg_temp.verifier(public.verifier_carte('AAAAAAAAAAAA') is null, 'QR inconnu : rien n''est révélé');
do $$ begin perform 1 from public.cartes_scolaires; raise exception 'table lisible';
exception when insufficient_privilege then raise notice 'ok : cartes non lisibles sans connexion'; end $$;

-- 5. Suspension, réactivation, révocation
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select set_config('app.carte_a2', :'carte_a2', false) \g /dev/null
do $$ begin perform public.carte_changer_statut(current_setting('app.carte_a2')::uuid, 'suspendue', ''); raise exception 'suspension sans motif';
exception when sqlstate 'P0001' then raise notice 'ok : suspension refusée sans motif'; end $$;
select public.carte_changer_statut(:'carte_a2', 'suspendue', 'Carte déclarée perdue') \g /dev/null
reset role; set role anon;
select pg_temp.verifier((public.verifier_carte(:'code_a2')->'carte'->>'statut') = 'suspendue', 'QR : carte suspendue');
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.cartes_emettre(jsonb_build_array(jsonb_build_object('inscription_id', :'ins_a', 'empreinte', repeat('4', 64)))) as lot2 \gset
select set_config('app.lot2', :'lot2', false) \g /dev/null
select pg_temp.verifier((current_setting('app.lot2')::jsonb->0->>'statut') = 'suspendue', 'une carte suspendue n''est pas réimprimée par un lot');
select public.carte_changer_statut(:'carte_a2', 'active', '') \g /dev/null
select public.carte_changer_statut(:'carte_a2', 'revoquee', 'Élève exclu') \g /dev/null
do $$ begin perform public.carte_changer_statut(current_setting('app.carte_a2')::uuid, 'active', ''); raise exception 'carte révoquée réactivée';
exception when sqlstate 'P0001' then raise notice 'ok : une carte révoquée ne peut pas être réactivée'; end $$;
reset role; set role anon;
select pg_temp.verifier((public.verifier_carte(:'code_a2')->'carte'->>'statut') = 'revoquee', 'QR : carte révoquée');

-- 6. Révocation de la signature : les cartes qui la portent sont signalées ; la nouvelle signature sert aux nouvelles cartes
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select code as code_m2 from public.cartes_scolaires where inscription_id = :'ins_m2c' and statut = 'active' \gset
select public.signature_revoquer(:'sig1', 'Signature dérobée') \g /dev/null
reset role; set role anon;
select pg_temp.verifier((public.verifier_carte(:'code_m2')->'carte'->>'statut') = 'signature_revoquee', 'QR : carte signée avec une signature révoquée signalée');
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.signature_enregistrer('signature', :'etab_c' || '/signature-2.png', repeat('d', 64)) \g /dev/null
select public.cartes_emettre(jsonb_build_array(jsonb_build_object('inscription_id', :'ins_m2c', 'empreinte', repeat('2', 64)))) \g /dev/null
select pg_temp.verifier((select signature_id from public.cartes_scolaires where inscription_id = :'ins_m2c' and statut = 'active')
    = (select id from public.signatures_etablissement where type = 'signature' and statut = 'active'),
  'nouvelle signature : la carte est régénérée avec elle');
select pg_temp.verifier((select count(*) from public.cartes_journal where action in ('emission', 'suspension', 'reactivation', 'revocation', 'signature_revoque', 'cachet_importe', 'signature_importe')) >= 9,
  'journal : imports, émissions, suspensions, révocations');
do $$ begin insert into public.cartes_scolaires (etablissement_id) values (current_setting('app.etab_c')::uuid); raise exception 'écriture directe';
exception when insufficient_privilege then raise notice 'ok : aucune écriture directe dans les cartes'; end $$;

-- 7. Cloisonnement
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.cartes_scolaires) = 0 and (select count(*) from public.signatures_etablissement) = 0
  and (select count(*) from public.cartes_config) = 0, 'cartes et signatures invisibles pour un autre établissement');
reset role;
