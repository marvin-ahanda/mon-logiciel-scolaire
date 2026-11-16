-- Tarifs des offres, en base : référence unique pour la page d'accueil et, demain, pour le paiement en ligne
-- (le montant à payer sera toujours recalculé ici, jamais repris du navigateur).
-- Prix de TEST (paiements de quelques francs) : Essentiel 100, Pro 150, Premium 200 FCFA par mois.
-- Paiement annuel : 10 mois facturés au lieu de 12 (2 mois offerts).

create table if not exists public.tarifs (
  offre text primary key check (offre in ('essentiel', 'pro', 'premium')),
  mensuel integer not null check (mensuel > 0),
  mois_factures_par_an integer not null default 10 check (mois_factures_par_an between 1 and 12),
  devise text not null default 'XAF',
  maj timestamptz not null default now()
);
alter table public.tarifs enable row level security;
revoke all on public.tarifs from anon, authenticated;     -- lecture par tarifs_offres(), écriture par la console seulement

insert into public.tarifs (offre, mensuel) values ('essentiel', 100), ('pro', 150), ('premium', 200)
on conflict (offre) do update set mensuel = excluded.mensuel, maj = now();

/** Montant (FCFA) d'une offre pour une période ('mensuel' ou 'annuel'). Base du futur paiement. */
create or replace function public._montant_offre(p_offre text, p_periode text) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare t public.tarifs;
begin
  select * into t from public.tarifs where offre = p_offre;
  if not found then raise exception 'Offre inconnue : %', p_offre using errcode = 'P0001'; end if;
  if p_periode = 'mensuel' then return t.mensuel; end if;
  if p_periode = 'annuel' then return t.mensuel * t.mois_factures_par_an; end if;
  raise exception 'Période inconnue : % (mensuel ou annuel).', p_periode using errcode = 'P0001';
end $$;
revoke execute on function public._montant_offre(text, text) from public, anon, authenticated;

/** Tarifs publics (page d'accueil) : [{ offre, mensuel, annuel, mois_factures_par_an, devise }]. */
create or replace function public.tarifs_offres() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('offre', offre, 'mensuel', mensuel, 'annuel', mensuel * mois_factures_par_an,
           'mois_factures_par_an', mois_factures_par_an, 'devise', devise) order by public._rang_offre(offre)), '[]'::jsonb)
  from public.tarifs
$$;
grant execute on function public.tarifs_offres() to anon, authenticated;

/** Console : changer le prix mensuel d'une offre (propriétaire de la plateforme). */
create or replace function public.console_definir_tarif(p_offre text, p_mensuel integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public._exiger_proprietaire();
  if p_mensuel is null or p_mensuel <= 0 then raise exception 'Prix invalide.' using errcode = 'P0001'; end if;
  update public.tarifs set mensuel = p_mensuel, maj = now() where offre = p_offre;
  if not found then raise exception 'Offre inconnue : %', p_offre using errcode = 'P0001'; end if;
  return public.tarifs_offres();
end $$;
revoke execute on function public.console_definir_tarif(text, integer) from public, anon;
grant execute on function public.console_definir_tarif(text, integer) to authenticated;
