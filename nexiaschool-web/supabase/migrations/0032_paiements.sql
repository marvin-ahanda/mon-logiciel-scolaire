-- Paiement des abonnements par SasPay (mobile money, carte) et renouvellement automatique de l'échéance.
--  * L'administrateur choisit une offre et une période (mensuel / annuel) : paiement_preparer() enregistre la demande
--    avec le montant CALCULÉ EN BASE (_montant_offre), jamais celui envoyé par le navigateur.
--  * La fonction serveur « paiement » crée la page de paiement SasPay, puis revérifie le paiement auprès de SasPay
--    (retour du client, webhook ou ouverture de la page Abonnement) avant d'appeler _paiement_valider().
--  * _paiement_valider() active l'offre jusqu'à la nouvelle échéance : +1 mois ou +1 an. Payer la même offre avant
--    l'échéance prolonge à partir de l'échéance en cours (aucun jour perdu).
--  * À l'échéance, sans nouveau paiement, l'établissement repasse automatiquement en Découverte (_offre_effective) :
--    aucune tâche planifiée n'est nécessaire, le droit est recalculé à chaque action.

create table if not exists public.paiements_abonnement (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements(id) on delete cascade,
  offre text not null check (offre in ('essentiel', 'pro', 'premium')),
  periode text not null check (periode in ('mensuel', 'annuel')),
  montant integer not null check (montant > 0),
  devise text not null default 'XAF',
  statut text not null default 'en_attente' check (statut in ('en_attente', 'paye', 'echoue', 'annule')),
  fournisseur text not null default 'saspay',
  session_id text unique,                             -- identifiant de la session de paiement SasPay
  url_paiement text,
  transaction_id text,
  demande_par uuid references auth.users(id) on delete set null,
  cree_le timestamptz not null default now(),
  paye_le timestamptz,
  debut timestamptz,                                  -- période couverte par ce paiement
  fin timestamptz
);
create index if not exists paiements_abonnement_etab on public.paiements_abonnement (etablissement_id, cree_le desc);
create index if not exists paiements_abonnement_attente on public.paiements_abonnement (cree_le) where statut = 'en_attente';
alter table public.paiements_abonnement enable row level security;
revoke all on public.paiements_abonnement from anon, authenticated;
grant select on public.paiements_abonnement to authenticated;
drop policy if exists paiements_abonnement_lecture on public.paiements_abonnement;
create policy paiements_abonnement_lecture on public.paiements_abonnement for select to authenticated
  using (etablissement_id = public.etab_courant() and public.est_admin());

/** Administrateur : enregistre une demande de paiement et renvoie ce qu'il faut pour créer la page SasPay. */
create or replace function public.paiement_preparer(p_offre text, p_periode text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); v_id uuid; v_montant int; v_nom text; v_email text;
begin
  if v_etab is null or not public.est_admin() then
    raise exception 'Seul l''administrateur de l''établissement peut payer l''abonnement.' using errcode = '42501';
  end if;
  if p_offre not in ('essentiel', 'pro', 'premium') then raise exception 'Offre inconnue.' using errcode = 'P0001'; end if;
  if p_periode not in ('mensuel', 'annuel') then raise exception 'Période inconnue (mensuel ou annuel).' using errcode = 'P0001'; end if;
  -- pas plus de 10 demandes en attente par heure (évite les clics répétés)
  if (select count(*) from public.paiements_abonnement where etablissement_id = v_etab and statut = 'en_attente' and cree_le > now() - interval '1 hour') >= 10 then
    raise exception 'Trop de paiements en attente : réessayez dans quelques minutes.' using errcode = 'P0001';
  end if;
  v_montant := public._montant_offre(p_offre, p_periode);
  select nom into v_nom from public.etablissements where id = v_etab;
  select email into v_email from auth.users where id = auth.uid();
  insert into public.paiements_abonnement (etablissement_id, offre, periode, montant, demande_par)
  values (v_etab, p_offre, p_periode, v_montant, auth.uid()) returning id into v_id;
  return jsonb_build_object('id', v_id, 'montant', v_montant, 'devise', 'XAF', 'offre', p_offre, 'periode', p_periode,
                            'etablissement', v_nom, 'email', coalesce(v_email, ''));
end $$;
revoke execute on function public.paiement_preparer(text, text) from public, anon;
grant execute on function public.paiement_preparer(text, text) to authenticated;

/** Serveur : rattache la session SasPay créée à la demande. */
create or replace function public._paiement_session(p_id uuid, p_session text, p_url text) returns void
language sql volatile security definer set search_path = '' as $$
  update public.paiements_abonnement set session_id = p_session, url_paiement = p_url where id = p_id and statut = 'en_attente'
$$;

/** Serveur : le paiement a échoué ou a été annulé chez SasPay. */
create or replace function public._paiement_echec(p_id uuid, p_statut text) returns void
language sql volatile security definer set search_path = '' as $$
  update public.paiements_abonnement set statut = case when p_statut = 'annule' then 'annule' else 'echoue' end
   where id = p_id and statut = 'en_attente'
$$;

/**
 * Serveur : paiement confirmé par SasPay (montant vérifié). Active l'offre et calcule la nouvelle échéance.
 * Idempotent : un deuxième appel pour le même paiement ne prolonge pas deux fois.
 */
create or replace function public._paiement_valider(p_id uuid, p_transaction text, p_montant numeric) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare p public.paiements_abonnement; e public.etablissements; v_debut timestamptz; v_fin timestamptz;
begin
  select * into p from public.paiements_abonnement where id = p_id for update;
  if not found then raise exception 'Paiement introuvable.' using errcode = 'P0001'; end if;
  if p.statut = 'paye' then return jsonb_build_object('statut', 'paye', 'fin', p.fin, 'deja', true); end if;
  if p_montant is null or p_montant < p.montant then
    raise exception 'Montant payé (%) inférieur au montant dû (%).', p_montant, p.montant using errcode = 'P0001';
  end if;
  select * into e from public.etablissements where id = p.etablissement_id for update;
  -- même offre encore valide : on prolonge à partir de l'échéance ; sinon la nouvelle période commence maintenant
  v_debut := case when e.offre = p.offre and e.offre_expire_le is not null and e.offre_expire_le > now() then e.offre_expire_le else now() end;
  v_fin := v_debut + case p.periode when 'annuel' then interval '1 year' else interval '1 month' end;
  update public.paiements_abonnement set statut = 'paye', paye_le = now(), transaction_id = p_transaction, debut = v_debut, fin = v_fin where id = p.id;
  update public.etablissements set offre = p.offre, offre_periodicite = p.periode, offre_expire_le = v_fin where id = e.id;
  insert into public.journal_plateforme (auteur, action, cible, details)
  values (p.demande_par, 'paiement', e.nom, jsonb_build_object('offre', p.offre, 'periode', p.periode, 'montant', p.montant, 'fin', v_fin));
  return jsonb_build_object('statut', 'paye', 'offre', p.offre, 'fin', v_fin);
end $$;

/** Serveur : paiements en attente à revérifier (webhook, page Abonnement). */
create or replace function public._paiements_a_verifier(p_etab uuid, p_id uuid) returns table (id uuid, session_id text, montant integer)
language sql stable security definer set search_path = '' as $$
  select x.id, x.session_id, x.montant from public.paiements_abonnement x
   where x.statut = 'en_attente' and x.session_id is not null and x.cree_le > now() - interval '3 days'
     and (p_id is null or x.id = p_id) and (p_etab is null or x.etablissement_id = p_etab)
   order by x.cree_le desc limit 20
$$;

revoke execute on function public._paiement_session(uuid, text, text), public._paiement_echec(uuid, text),
  public._paiement_valider(uuid, text, numeric), public._paiements_a_verifier(uuid, uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public._paiement_session(uuid, text, text), public._paiement_echec(uuid, text),
      public._paiement_valider(uuid, text, numeric), public._paiements_a_verifier(uuid, uuid) to service_role;
  end if;
end $$;

/** Administrateur : état de l'abonnement et derniers paiements (page Abonnement). */
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
        'statut', p.statut, 'cree_le', p.cree_le, 'paye_le', p.paye_le, 'fin', p.fin) order by p.cree_le desc)
      from (select * from public.paiements_abonnement where etablissement_id = v_etab order by cree_le desc limit 20) p), '[]'::jsonb));
end $$;
revoke execute on function public.mon_abonnement() from public, anon;
grant execute on function public.mon_abonnement() to authenticated;
