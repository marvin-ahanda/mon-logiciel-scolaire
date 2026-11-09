-- Espace parents : connexion par l'élève, bulletins publiés, courrier routé selon l'objet, réponses, moratoire
reset role; set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select (public.nouveau_code_etablissement()->>'code') as code_p \gset
reset role; set role anon;
select set_config('request.jwt.claim.sub', '', false) \g /dev/null
select (public.ouvrir_etablissement('Collège Saint-Joseph', :'code_p')->>'jeton') as jeton_p \gset

-- 1. connexion du parent : nom et prénom dans n'importe quel ordre, matricule exact
select pg_temp.verifier((public.parent_connexion(:'jeton_p', 'Grâce Abena', 'M2')->>'erreur') like 'Élève introuvable%', 'matricule d''un autre élève : refusé');
select pg_temp.verifier((public.parent_connexion(:'jeton_p', 'Abena Marie', 'M1')->>'erreur') like 'Élève introuvable%', 'nom ne correspondant pas : refusé');
select pg_temp.verifier((public.parent_connexion('jeton-invalide', 'Abena Grâce', 'M1')->>'erreur') = 'jeton', 'sans établissement ouvert sur l''appareil : refusé');
select public.parent_connexion(:'jeton_p', 'grace  ABENA', ' M1 ') as cx \gset
select set_config('app.cx', :'cx', false) \g /dev/null
select pg_temp.verifier(current_setting('app.cx')::json->>'jeton' like 'nxp_%' and current_setting('app.cx')::json->>'classe' = '6e A',
  'prénom et nom inversés, matricule exact : connecté à l''espace de l''élève');
select (:'cx'::json->>'jeton') as sp \gset
select set_config('app.sp', :'sp', false) \g /dev/null
do $$ begin perform public.parent_portail('nxp_' || repeat('0', 64)); raise exception 'session inventée acceptée';
exception when sqlstate '28000' then raise notice 'ok : session inventée refusée'; end $$;

-- 2. portail : l'élève et son dossier disciplinaire, aucun autre élève
reset role;
insert into public.absences (etablissement_id, inscription_id, sequence_id, date, heures_non_justifiees, motif)
select i.etablissement_id, i.id, s.id, current_date - 3, 2, 'Test parents' from public.inscriptions i join public.sequences s on s.exercice_id = i.exercice_id and s.numero = 2
 where i.id = :'ins_a' on conflict do nothing;
set role anon;
select public.parent_portail(:'sp') as po \gset
select set_config('app.po', :'po', false) \g /dev/null
select pg_temp.verifier((current_setting('app.po')::jsonb #>> '{eleve,matricule}') = 'M1'
  and exists (select 1 from jsonb_array_elements(current_setting('app.po')::jsonb -> 'absences') a where a ->> 'motif' = 'Test parents' and (a ->> 'date') is not null)
  and jsonb_array_length(current_setting('app.po')::jsonb -> 'bulletins') = 0,
  'portail : identité, absences datées ; aucun bulletin tant que rien n''est publié');

-- 3. bulletins : publiés par l'administration seule, puis visibles du parent (sa copie uniquement)
do $$ begin perform public.parent_bulletin(current_setting('app.sp'), 't1'); raise exception 'bulletin non publié visible';
exception when sqlstate 'P0001' then raise notice 'ok : bulletin non publié invisible pour le parent'; end $$;
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select set_config('app.classe_a', :'classe_a', false), set_config('app.ins_a', :'ins_a', false) \g /dev/null
do $$ begin perform public.publier_bulletins(jsonb_build_object('classe_id', current_setting('app.classe_a'), 'periode', 't1',
    'bulletins', jsonb_build_array(jsonb_build_object('inscription_id', current_setting('app.ins_a'), 'contenu', '{}'::jsonb))));
  raise exception 'publication par un enseignant';
exception when insufficient_privilege then raise notice 'ok : seule l''administration publie les bulletins'; end $$;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select pg_temp.verifier((public.publier_bulletins(jsonb_build_object('classe_id', :'classe_a', 'periode', 't1', 'periode_libelle', 'Trimestre 1',
  'commun', '{"stats":{"effectif":2}}'::jsonb, 'bulletins', jsonb_build_array(jsonb_build_object('inscription_id', :'ins_a', 'contenu', '{"r":{"moyenne":12.5}}'::jsonb))))->>'eleves')::int = 1,
  'administration : bulletins du trimestre 1 publiés');
reset role; set role anon;
select pg_temp.verifier((public.parent_bulletin(:'sp', 't1') #>> '{contenu,r,moyenne}')::numeric = 12.5
  and jsonb_array_length(public.parent_portail(:'sp') -> 'bulletins') = 1, 'le parent consulte le bulletin publié de son enfant');
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.retirer_publication(:'classe_a', 't1') \g /dev/null
reset role; set role anon;
select pg_temp.verifier(jsonb_array_length(public.parent_portail(:'sp') -> 'bulletins') = 0, 'publication retirée : plus visible du parent');

-- 4. courrier : contrôles, routage selon l'objet
do $$ begin perform public.parent_envoyer_courrier(current_setting('app.sp'), '{"objet":"reclamation","parent_nom":"Abena Paul","parent_qualite":"pere","message":"court"}'::jsonb);
  raise exception 'message trop court accepté';
exception when sqlstate 'P0001' then raise notice 'ok : message trop court refusé'; end $$;
do $$ begin perform public.parent_envoyer_courrier(current_setting('app.sp'), '{"objet":"absence","parent_nom":"Abena Paul","parent_qualite":"pere","message":"Mon enfant sera absent."}'::jsonb);
  raise exception 'absence sans date acceptée';
exception when sqlstate 'P0001' then raise notice 'ok : demande d''absence sans date refusée'; end $$;
select public.parent_envoyer_courrier(:'sp', '{"objet":"reclamation","parent_nom":"Abena Paul","parent_qualite":"pere","ville":"Yaoundé","precision_objet":"Note de mathématiques","message":"La note de la séquence 2 semble erronée."}'::jsonb) ->> 'reference' as ref1 \gset
select public.parent_envoyer_courrier(:'sp', jsonb_build_object('objet', 'absence', 'parent_nom', 'Abena Paul', 'parent_qualite', 'pere',
  'details', jsonb_build_object('du', current_date + 2, 'au', current_date + 3), 'message', 'Mon enfant sera absent pour un rendez-vous médical.')) \g /dev/null
select public.parent_envoyer_courrier(:'sp', jsonb_build_object('objet', 'moratoire', 'parent_nom', 'Abena Paul', 'parent_qualite', 'pere',
  'details', jsonb_build_object('jusqu_au', current_date + 30, 'montant', 25000), 'message', 'Je sollicite un délai pour la deuxième tranche.')) \g /dev/null
select pg_temp.verifier(:'ref1' ~ '^C[0-9]{4}-0001$', 'courrier numéroté et archivé (référence ' || :'ref1' || ')');
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select pg_temp.verifier((public.courrier_notifications()->>'non_lus')::int = 2 and jsonb_array_length(public.courrier_liste()) = 3,
  'administration : prévenue pour la réclamation et le moratoire, consulte les 3 courriers (archives)');
select set_config('request.jwt.claim.sub', :'surv_a', false) \g /dev/null
select pg_temp.verifier((public.courrier_notifications()->>'non_lus')::int = 1 and jsonb_array_length(public.courrier_liste()) = 1
  and (public.courrier_liste() -> 0 ->> 'objet') = 'absence', 'surveillant général : seulement la demande d''absence');
select set_config('request.jwt.claim.sub', :'cpt', false) \g /dev/null
select pg_temp.verifier((public.courrier_notifications()->>'non_lus')::int = 1 and (public.courrier_liste() -> 0 ->> 'objet') = 'moratoire',
  'service financier : seulement le moratoire');
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select pg_temp.verifier(jsonb_array_length(public.courrier_liste()) = 0 and (public.courrier_notifications()->>'non_lus')::int = 0, 'enseignant : aucun courrier');

-- 5. réponses, moratoire accordé, lecture
select set_config('request.jwt.claim.sub', :'surv_a', false) \g /dev/null
select (select c ->> 'id' from jsonb_array_elements(public.courrier_liste()) c) as abs_id \gset
select public.courrier_repondre(:'abs_id'::uuid, 'Absence autorisée. Merci de nous avoir prévenus.', null, null) \g /dev/null
select public.courrier_marquer_lu(null) \g /dev/null
select pg_temp.verifier((public.courrier_notifications()->>'non_lus')::int = 0, 'surveillant : bulle remise à zéro après lecture');
select set_config('request.jwt.claim.sub', :'cpt', false) \g /dev/null
select (public.courrier_liste() -> 0 ->> 'id') as mor_id \gset
select set_config('app.mor_id', :'mor_id', false) \g /dev/null
do $$ begin perform public.courrier_repondre(current_setting('app.mor_id')::uuid, 'Accordé.', true, null); raise exception 'moratoire sans date accepté';
exception when sqlstate 'P0001' then raise notice 'ok : moratoire accordé sans date refusé'; end $$;
select public.courrier_repondre(:'mor_id'::uuid, 'Votre demande est acceptée : vous pouvez régler la deuxième tranche jusqu''à la date indiquée.', true, current_date + 20) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select pg_temp.verifier((public.moratoires_actifs() -> 0 ->> 'inscription_id') = :'ins_a' and (public.moratoires_actifs() -> 0 ->> 'jusqu_au')::date = current_date + 20,
  'moratoire accordé : signalé aux Finances jusqu''à la date convenue');
select set_config('request.jwt.claim.sub', :'surv_a', false) \g /dev/null
select set_config('app.ref_id', (select c ->> 'id' from jsonb_array_elements(public.courrier_liste()) c), false) \g /dev/null
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
do $$ begin perform public.courrier_repondre(current_setting('app.mor_id')::uuid, 'Réponse', null, null); raise exception 'enseignant répond';
exception when sqlstate 'P0001' then raise notice 'ok : un enseignant ne peut pas répondre au courrier'; end $$;
reset role; set role anon;
select pg_temp.verifier((public.parent_portail(:'sp')->>'reponses_non_lues')::int = 2, 'parent : 2 réponses non lues (bulle)');
select public.parent_marquer_reponses_lues(:'sp') \g /dev/null
select pg_temp.verifier((public.parent_portail(:'sp')->>'reponses_non_lues')::int = 0, 'parent : bulle remise à zéro après lecture');
select public.parent_deconnexion(:'sp') \g /dev/null
do $$ begin perform public.parent_portail(current_setting('app.sp')); raise exception 'session encore valide après déconnexion';
exception when sqlstate '28000' then raise notice 'ok : déconnexion du parent'; end $$;
do $$ begin perform 1 from public.courriers; raise exception 'table lisible';
exception when insufficient_privilege then raise notice 'ok : courriers non lisibles directement'; end $$;
reset role;
