-- Reçus des paiements d'abonnement : numéro unique et continu (NXS-2026-000001), reçu consultable en PDF par l'administrateur,
-- envoi par e-mail à la personne qui a payé (la fonction serveur « paiement » s'en charge et note l'envoi ici).

create sequence if not exists public.seq_recu_abonnement;
alter table public.paiements_abonnement
  add column if not exists numero_recu text unique,
  add column if not exists recu_envoye_le timestamptz;

/** Numéro de reçu suivant : NXS-AAAA-000001 (la suite ne reprend jamais à zéro, même d'une année à l'autre). */
create or replace function public._numero_recu(p_date timestamptz) returns text
language sql volatile security definer set search_path = '' as $$
  select 'NXS-' || to_char(p_date at time zone 'Africa/Douala', 'YYYY') || '-' || lpad(nextval('public.seq_recu_abonnement')::text, 6, '0')
$$;
revoke execute on function public._numero_recu(timestamptz) from public, anon, authenticated;

-- les paiements déjà validés reçoivent leur numéro, dans l'ordre des dates
do $$
declare r record;
begin
  for r in select id, paye_le from public.paiements_abonnement where statut = 'paye' and numero_recu is null order by paye_le, cree_le loop
    update public.paiements_abonnement set numero_recu = public._numero_recu(r.paye_le) where id = r.id;
  end loop;
end $$;

/** Validation d'un paiement (remplace celle de 0032) : attribue aussi le numéro de reçu. */
create or replace function public._paiement_valider(p_id uuid, p_transaction text, p_montant numeric) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare p public.paiements_abonnement; e public.etablissements; v_debut timestamptz; v_fin timestamptz; v_recu text;
begin
  select * into p from public.paiements_abonnement where id = p_id for update;
  if not found then raise exception 'Paiement introuvable.' using errcode = 'P0001'; end if;
  if p.statut = 'paye' then return jsonb_build_object('statut', 'paye', 'fin', p.fin, 'numero_recu', p.numero_recu, 'deja', true); end if;
  if p_montant is null or p_montant < p.montant then
    raise exception 'Montant payé (%) inférieur au montant dû (%).', p_montant, p.montant using errcode = 'P0001';
  end if;
  select * into e from public.etablissements where id = p.etablissement_id for update;
  v_debut := case when e.offre = p.offre and e.offre_expire_le is not null and e.offre_expire_le > now() then e.offre_expire_le else now() end;
  v_fin := v_debut + case p.periode when 'annuel' then interval '1 year' else interval '1 month' end;
  v_recu := public._numero_recu(now());
  update public.paiements_abonnement set statut = 'paye', paye_le = now(), transaction_id = p_transaction, debut = v_debut, fin = v_fin, numero_recu = v_recu where id = p.id;
  update public.etablissements set offre = p.offre, offre_periodicite = p.periode, offre_expire_le = v_fin where id = e.id;
  insert into public.journal_plateforme (auteur, action, cible, details)
  values (p.demande_par, 'paiement', e.nom, jsonb_build_object('offre', p.offre, 'periode', p.periode, 'montant', p.montant, 'fin', v_fin, 'recu', v_recu));
  return jsonb_build_object('statut', 'paye', 'offre', p.offre, 'fin', v_fin, 'numero_recu', v_recu);
end $$;

/** Contenu d'un reçu (sans autorisation : usage interne). */
create or replace function public._recu_contenu(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'numero', p.numero_recu, 'date', p.paye_le, 'offre', p.offre, 'periode', p.periode, 'montant', p.montant, 'devise', p.devise,
    'debut', p.debut, 'fin', p.fin, 'transaction', p.transaction_id, 'fournisseur', p.fournisseur,
    'etablissement', jsonb_build_object('nom', e.nom, 'ville', e.ville, 'adresse', e.adresse, 'telephone', e.telephone))
  from public.paiements_abonnement p join public.etablissements e on e.id = p.etablissement_id
  where p.id = p_id and p.statut = 'paye' and p.numero_recu is not null
$$;
revoke execute on function public._recu_contenu(uuid) from public, anon, authenticated;

/** Administrateur : reçu d'un de ses paiements. */
create or replace function public.recu_paiement(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); r jsonb;
begin
  if v_etab is null or not public.est_admin() then raise exception 'Réservé à l''administrateur de l''établissement.' using errcode = '42501'; end if;
  if not exists (select 1 from public.paiements_abonnement where id = p_id and etablissement_id = v_etab) then
    raise exception 'Paiement introuvable.' using errcode = 'P0001';
  end if;
  r := public._recu_contenu(p_id);
  if r is null then raise exception 'Aucun reçu : ce paiement n''est pas validé.' using errcode = 'P0001'; end if;
  return r;
end $$;
revoke execute on function public.recu_paiement(uuid) from public, anon;
grant execute on function public.recu_paiement(uuid) to authenticated;

/** Serveur : reçu à envoyer par e-mail (adresse de la personne qui a payé) ; vide si déjà envoyé. */
create or replace function public._recu_a_envoyer(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public._recu_contenu(p.id) || jsonb_build_object('email', u.email)
  from public.paiements_abonnement p left join auth.users u on u.id = p.demande_par
  where p.id = p_id and p.statut = 'paye' and p.recu_envoye_le is null and u.email is not null
$$;
create or replace function public._recu_marquer_envoye(p_id uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update public.paiements_abonnement set recu_envoye_le = now() where id = p_id and recu_envoye_le is null
$$;
revoke execute on function public._recu_a_envoyer(uuid), public._recu_marquer_envoye(uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public._recu_a_envoyer(uuid), public._recu_marquer_envoye(uuid) to service_role;
  end if;
end $$;

/** État de l'abonnement (remplace celui de 0032) : ajoute le numéro de reçu à chaque paiement. */
create or replace function public.mon_abonnement() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); e public.etablissements;
begin
  if v_etab is null or not public.est_admin() then raise exception 'Réservé à l''administrateur de l''établissement.' using errcode = '42501'; end if;
  select * into e from public.etablissements where id = v_etab;
  return jsonb_build_object(
    'offre', e.offre, 'periode', e.offre_periodicite, 'expire_le', e.offre_expire_le, 'effective', public._offre_effective(v_etab),
    'tarifs', public.tarifs_offres(),
    'paiements', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'offre', p.offre, 'periode', p.periode, 'montant', p.montant,
        'statut', p.statut, 'cree_le', p.cree_le, 'paye_le', p.paye_le, 'fin', p.fin, 'numero_recu', p.numero_recu) order by p.cree_le desc)
      from (select * from public.paiements_abonnement where etablissement_id = v_etab order by cree_le desc limit 20) p), '[]'::jsonb));
end $$;
