-- MCP : outils d'écriture supplémentaires (finances, personnel, discipline, décisions).
-- Chaque fonction place l'identité du propriétaire de la clé (via _api_contexte) puis réutilise la logique validée de
-- l'application, qui applique elle-même le contrôle de rôle (peut_finance, _exiger_admin, peut_discipline).
-- Les noms d'élèves sont résolus côté serveur MCP ; ici on reçoit un matricule (correspondance exacte).

-- Frais de scolarité (administration ou comptabilité)
create or replace function public.api_finance_frais(p_cle text, p_pension_nouveaux int, p_pension_anciens int, p_echeances jsonb)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare c record;
begin
  select * into c from public._api_contexte(p_cle, true);
  perform public.finance_enregistrer_frais(p_pension_nouveaux, p_pension_anciens, p_echeances);
  perform public._api_journal(c.etab, c.personnel, c.source, 'enregistrer_frais',
    jsonb_build_object('pension_nouveaux', p_pension_nouveaux, 'pension_anciens', p_pension_anciens));
  return json_build_object('ok', true);
end $$;

-- Enregistrer le paiement d'un élève (administration ou comptabilité). Le reçu (numéro) est attribué par le déclencheur.
create or replace function public.api_enregistrer_paiement(p_cle text, p_classe text, p_matricule text, p_montant int,
                                                           p_mode text, p_date date, p_reference text, p_observation text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare c record; ex uuid; cl uuid; ins uuid; v_num int; v_mode text := coalesce(nullif(btrim(p_mode), ''), 'especes');
begin
  select * into c from public._api_contexte(p_cle, true);
  if not public.peut_finance() then raise exception 'Enregistrer un paiement est réservé à l''administration et à la comptabilité.' using errcode = '42501'; end if;
  if v_mode not in ('especes', 'mobile_money', 'virement', 'cheque', 'autre') then
    raise exception 'Mode de paiement inconnu : especes, mobile_money, virement, cheque ou autre.' using errcode = 'P0001';
  end if;
  if coalesce(p_montant, 0) <= 0 then raise exception 'Le montant doit être positif.' using errcode = 'P0001'; end if;
  select id into ex from public.exercices where etablissement_id = c.etab and actif;
  if ex is null then raise exception 'Aucun exercice actif.' using errcode = 'P0001'; end if;
  cl := public._api_classe(c.etab, p_classe);
  select i.id into ins from public.inscriptions i join public.eleves e on e.id = i.eleve_id
   where i.classe_id = cl and i.exercice_id = ex and public._normaliser(e.matricule) = public._normaliser(p_matricule);
  if ins is null then raise exception 'Élève de matricule « % » absent de la classe « % ».', p_matricule, p_classe using errcode = 'P0001'; end if;
  insert into public.paiements (inscription_id, montant, date_paiement, mode, reference, observation)
  values (ins, p_montant, coalesce(p_date, (now() at time zone 'Africa/Douala')::date), v_mode, left(coalesce(p_reference, ''), 80), left(coalesce(p_observation, ''), 200))
  returning numero into v_num;
  perform public._api_journal(c.etab, c.personnel, c.source, 'enregistrer_paiement',
    jsonb_build_object('classe', p_classe, 'matricule', p_matricule, 'montant', p_montant, 'mode', v_mode, 'recu', v_num));
  return json_build_object('recu', v_num, 'matricule', p_matricule, 'montant', p_montant, 'mode', v_mode);
end $$;

-- Créer un membre du personnel (administration) : renvoie son code d'accès à usage unique.
create or replace function public.api_creer_personnel(p_cle text, p_nom text, p_prenom text, p_role text, p_matricule text, p_telephone text, p_poste text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare c record; r json;
begin
  select * into c from public._api_contexte(p_cle, true);
  r := public.creer_personnel(p_nom, p_prenom, p_role, coalesce(p_matricule, ''), coalesce(p_telephone, ''), coalesce(p_poste, ''));
  perform public._api_journal(c.etab, c.personnel, c.source, 'creer_personnel', jsonb_build_object('role', p_role, 'nom', p_nom));
  return r;
end $$;

-- Seuils d'alerte de discipline (surveillant général ou administration)
create or replace function public.api_discipline_seuils(p_cle text, p_heures int, p_sanctions jsonb)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare c record;
begin
  select * into c from public._api_contexte(p_cle, true);
  perform public.discipline_enregistrer_seuils(p_heures, p_sanctions);
  perform public._api_journal(c.etab, c.personnel, c.source, 'discipline_seuils', jsonb_build_object('heures', p_heures));
  return json_build_object('ok', true);
end $$;

-- Critères de décision de fin de période (administration)
create or replace function public.api_criteres_decision(p_cle text, p_periode text, p_criteres jsonb)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare c record; n int;
begin
  select * into c from public._api_contexte(p_cle, true);
  n := public.enregistrer_criteres_decision(p_periode, p_criteres);
  perform public._api_journal(c.etab, c.personnel, c.source, 'criteres_decision', jsonb_build_object('periode', p_periode, 'enregistres', n));
  return json_build_object('enregistres', n);
end $$;

revoke execute on function public.api_finance_frais(text, int, int, jsonb), public.api_enregistrer_paiement(text, text, text, int, text, date, text, text),
  public.api_creer_personnel(text, text, text, text, text, text, text), public.api_discipline_seuils(text, int, jsonb),
  public.api_criteres_decision(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.api_finance_frais(text, int, int, jsonb), public.api_enregistrer_paiement(text, text, text, int, text, date, text, text),
  public.api_creer_personnel(text, text, text, text, text, text, text), public.api_discipline_seuils(text, int, jsonb),
  public.api_criteres_decision(text, text, jsonb) to anon;
