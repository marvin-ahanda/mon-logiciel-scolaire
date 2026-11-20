-- Récompenses et distinctions : configuration, présélection, décisions motivées, validation (codes QR), publication,
-- réouverture tracée, révocation, vérification publique, espace parents, cloisonnement entre établissements
reset role;
update public.etablissements set offre = 'premium', offre_expire_le = null where id = (select etablissement_id from public.personnels where id = :'admin_a');
set role authenticated;
select set_config('request.jwt.claims', '{"app_metadata": {"provider": "email"}}', false) \g /dev/null
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null

-- 1. Types de distinctions
select pg_temp.verifier(public.distinctions_initialiser() = 9, 'distinctions usuelles créées (9 types modifiables)');
select pg_temp.verifier(public.distinctions_initialiser() = 0, 'initialisation sans effet si des distinctions existent déjà');
select public.distinction_enregistrer('{"nom":"Prix du civisme","categorie":"specifique","periodicite":"trimestre",
  "criteres":{"moyenne_min":11,"nj_max":4,"sans_sanction":true,"paiement":"en_regle"},"selection":{"mode":"seuils"},
  "modele":"moderne","personnalisation":{"couleur":"#0B46E5","titre":"Prix du civisme"}}'::jsonb)->>'id' as d_civ \gset
select pg_temp.verifier((select count(*) from public.distinctions) = 10, 'distinction propre à l''établissement ajoutée');
do $$ begin perform public.distinction_enregistrer('{"nom":"Bornes","criteres":{"moyenne_min":15,"moyenne_max":12}}'::jsonb); raise exception 'bornes incohérentes';
exception when sqlstate 'P0001' then raise notice 'ok : bornes de moyenne incohérentes refusées'; end $$;
do $$ begin perform public.distinction_enregistrer('{"nom":"Couleur","personnalisation":{"couleur":"red;}"}}'::jsonb); raise exception 'couleur acceptée';
exception when sqlstate 'P0001' then raise notice 'ok : couleur invalide refusée'; end $$;
do $$ begin perform public.distinction_enregistrer('{"nom":"Prix du civisme"}'::jsonb); raise exception 'doublon';
exception when sqlstate 'P0001' then raise notice 'ok : deux distinctions de même nom refusées'; end $$;
do $$ begin insert into public.distinctions (nom) values ('Directe'); raise exception 'écriture directe';
exception when insufficient_privilege then raise notice 'ok : aucune écriture directe dans les distinctions'; end $$;

-- Période personnalisée (semestre)
select public.periode_perso_enregistrer(null, 'Semestre 1', '{3,1,2,2}')->>'id' as sem1 \gset
select pg_temp.verifier((select sequences from public.periodes_personnalisees where id = :'sem1') = '{1,2,3}'::smallint[],
  'période personnalisée : séquences dédoublonnées et triées');

-- 2. Seule l'administration configure et attribue
select set_config('request.jwt.claim.sub', :'prof_a', false) \g /dev/null
select set_config('app.d_civ', :'d_civ', false) \g /dev/null
do $$ begin perform public.distinctions_preselection(current_setting('app.d_civ')::uuid, 't1', 'Trimestre 1', '[]'::jsonb); raise exception 'enseignant attribue';
exception when insufficient_privilege then raise notice 'ok : un enseignant ne peut pas attribuer de distinction'; end $$;
select pg_temp.verifier((select count(*) from public.distinctions_sessions) = 0, 'enseignant : attributions invisibles');

-- 3. Présélection (calculée dans l'application) puis décisions manuelles motivées
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select i.id as ins_m2 from public.inscriptions i join public.eleves e on e.id = i.eleve_id where e.matricule = 'M2' \gset
select (public.distinctions_preselection(:'d_civ', 't1', 'Trimestre 1',
  jsonb_build_array(jsonb_build_object('inscription_id', :'ins_a', 'valeurs', '{"moyenne": 14.5, "rang": 1}'::jsonb),
                    '{"inscription_id": "00000000-0000-0000-0000-000000000000"}'::jsonb))->>'session_id') as sess \gset
select pg_temp.verifier((select count(*) from public.distinctions_attribuees where session_id = :'sess') = 1,
  'présélection : seuls les élèves de l''établissement et de l''exercice sont retenus');
select (select id from public.distinctions_attribuees where session_id = :'sess' and inscription_id = :'ins_a') as att_a \gset
select set_config('app.att_a', :'att_a', false) \g /dev/null
do $$ begin perform public.distinctions_decider(current_setting('app.att_a')::uuid, false, ''); raise exception 'retrait sans motif';
exception when sqlstate 'P0001' then raise notice 'ok : retrait refusé sans motif'; end $$;
select set_config('app.sess', :'sess', false) \g /dev/null
select set_config('app.ins_m2', :'ins_m2', false) \g /dev/null
do $$ begin perform public.distinctions_ajouter(current_setting('app.sess')::uuid, current_setting('app.ins_m2')::uuid, ''); raise exception 'ajout sans motif';
exception when sqlstate 'P0001' then raise notice 'ok : ajout manuel refusé sans motif'; end $$;
select public.distinctions_ajouter(:'sess', :'ins_m2', 'Dérogation : engagement exemplaire au club civique')->>'id' as att_m2 \gset
-- recalcul de la présélection : l'ajout manuel est conservé
select public.distinctions_preselection(:'d_civ', 't1', 'Trimestre 1', jsonb_build_array(jsonb_build_object('inscription_id', :'ins_a', 'valeurs', '{"moyenne": 14.75}'::jsonb))) \g /dev/null
select pg_temp.verifier((select count(*) from public.distinctions_attribuees where session_id = :'sess' and retenu) = 2
  and (select (valeurs->>'moyenne')::numeric from public.distinctions_attribuees where id = :'att_a') = 14.75,
  'recalcul : valeurs mises à jour, ajout manuel conservé');

-- 4. Validation : codes de vérification ; la liste est figée
select public.distinctions_valider(:'sess') \g /dev/null
select pg_temp.verifier((select count(*) from public.distinctions_attribuees where session_id = :'sess' and code ~ '^[A-HJ-NP-Z2-9]{12}$') = 2,
  'validation : chaque lauréat reçoit un code de vérification (QR)');
select code as code_m2 from public.distinctions_attribuees where id = :'att_m2' \gset
select set_config('app.att_m2', :'att_m2', false) \g /dev/null
do $$ begin perform public.distinctions_decider(current_setting('app.att_m2')::uuid, false, 'Erreur de saisie'); raise exception 'modification après validation';
exception when sqlstate 'P0001' then raise notice 'ok : une distinction validée ne se modifie pas sans réouverture'; end $$;
do $$ begin perform public.distinctions_supprimer_session(current_setting('app.sess')::uuid); raise exception 'suppression validée';
exception when sqlstate 'P0001' then raise notice 'ok : une distinction validée ne peut pas être supprimée'; end $$;
do $$ begin perform public.distinction_supprimer(current_setting('app.d_civ')::uuid); raise exception 'type attribué supprimé';
exception when sqlstate 'P0001' then raise notice 'ok : un type déjà attribué ne peut qu''être masqué'; end $$;

-- 5. Vérification publique du QR code
reset role; set role anon;
select pg_temp.verifier((public.verifier_distinction(lower(:'code_m2'))->'distinction'->>'statut') = 'valide'
  and (public.verifier_distinction(:'code_m2')->'distinction'->>'nom') = 'Prix du civisme'
  and (public.verifier_distinction(:'code_m2')->'etablissement'->>'nom') = 'Collège Saint-Joseph'
  and not (public.verifier_distinction(:'code_m2')->'distinction' ? 'motif'),
  'QR code : distinction authentique, sans le motif interne');
select pg_temp.verifier(public.verifier_distinction('AAAAAAAAAAAA') is null, 'QR code inconnu : rien n''est révélé');

-- 6. Publication et espace parents
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
select public.distinctions_publier(:'sess', true) \g /dev/null
select (public.nouveau_code_etablissement()->>'code') as code_d \gset
reset role; set role anon;
select set_config('request.jwt.claim.sub', '', false) \g /dev/null
select (public.ouvrir_etablissement('Collège Saint-Joseph', :'code_d')->>'jeton') as jeton_d \gset
select (public.parent_connexion(:'jeton_d', 'Grâce Abena', 'M1')->>'jeton') as sp_d \gset
select pg_temp.verifier(jsonb_array_length(public.parent_distinctions(:'sp_d')) = 1
  and (public.parent_distinctions(:'sp_d')->0->>'nom') = 'Prix du civisme',
  'parent : voit la distinction publiée de son enfant, et seulement la sienne');

-- 7. Réouverture tracée, retrait motivé, révocation du code
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_a', false) \g /dev/null
do $$ begin perform public.distinctions_rouvrir(current_setting('app.sess')::uuid, ''); raise exception 'réouverture sans motif';
exception when sqlstate 'P0001' then raise notice 'ok : réouverture refusée sans motif'; end $$;
select public.distinctions_rouvrir(:'sess', 'Erreur signalée par le conseil de classe') \g /dev/null
select public.distinctions_decider(:'att_m2', false, 'Dérogation annulée par le conseil') \g /dev/null
select public.distinctions_valider(:'sess') \g /dev/null
select pg_temp.verifier((select statut from public.distinctions_sessions where id = :'sess') = 'validee'
  and (select reouvertures from public.distinctions_sessions where id = :'sess') = 1,
  'réouverture : la distinction quitte l''espace parents jusqu''à la nouvelle publication');
select pg_temp.verifier((select count(*) from public.distinctions_journal where session_id = :'sess'
  and action in ('preselection', 'ajoute', 'validation', 'publication', 'reouverture', 'retire')) >= 7
  and exists (select 1 from public.distinctions_journal where session_id = :'sess' and action = 'reouverture' and motif like 'Erreur signalée%'),
  'journal : chaque étape est tracée avec son motif');
reset role; set role anon;
select pg_temp.verifier((public.verifier_distinction(:'code_m2')->'distinction'->>'statut') = 'revoquee',
  'QR code d''un lauréat retiré : distinction révoquée');
select pg_temp.verifier(jsonb_array_length(public.parent_distinctions(:'sp_d')) = 0, 'parent : distinction dépubliée pendant la révision');

-- 8. Cloisonnement : un autre établissement ne voit rien
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', :'admin_b', false) \g /dev/null
select pg_temp.verifier((select count(*) from public.distinctions) = 0 and (select count(*) from public.distinctions_sessions) = 0
  and (select count(*) from public.distinctions_attribuees) = 0 and (select count(*) from public.distinctions_journal) = 0,
  'distinctions invisibles pour un autre établissement');
do $$ begin perform public.distinctions_valider(current_setting('app.sess')::uuid); raise exception 'autre établissement valide';
exception when sqlstate 'P0001' or insufficient_privilege then raise notice 'ok : un autre établissement ne peut pas agir sur ces distinctions'; end $$;
reset role;
