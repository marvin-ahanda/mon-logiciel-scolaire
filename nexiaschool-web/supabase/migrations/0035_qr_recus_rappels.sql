-- 1. QR code anti-fraude des reçus : chaque reçu porte un code de vérification secret (20 caractères, impossible à deviner).
--    Le QR code imprimé ouvre https://nexiaschool.com/recu/<code> ; la page publique affiche ce qui a été réellement payé.
-- 2. Rappels de fin d'abonnement : chaque jour, de J-5 jusqu'au dernier jour (heure du Cameroun), un e-mail bref aux
--    administrateurs de l'établissement (« Fin d'abonnement dans 5 jours. Pensez à le renouveler. »). Un seul rappel par jour.

-- --- 1. Code de vérification des reçus -----------------------------------------------------------------------------
alter table public.paiements_abonnement add column if not exists code_verif text unique;

create or replace function public._code_verif_recu() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.numero_recu is not null and new.code_verif is null then
    new.code_verif := upper(substr(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 1, 20));
  end if;
  return new;
end $$;
drop trigger if exists code_verif_recu on public.paiements_abonnement;
create trigger code_verif_recu before insert or update on public.paiements_abonnement
  for each row execute function public._code_verif_recu();
update public.paiements_abonnement set numero_recu = numero_recu where numero_recu is not null and code_verif is null;   -- reçus déjà émis

/** Contenu d'un reçu (remplace celui de 0033) : ajoute le code de vérification. */
create or replace function public._recu_contenu(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'numero', p.numero_recu, 'code', p.code_verif, 'date', p.paye_le, 'offre', p.offre, 'periode', p.periode, 'montant', p.montant, 'devise', p.devise,
    'debut', p.debut, 'fin', p.fin, 'transaction', p.transaction_id, 'fournisseur', p.fournisseur,
    'etablissement', jsonb_build_object('nom', e.nom, 'ville', e.ville, 'adresse', e.adresse, 'telephone', e.telephone))
  from public.paiements_abonnement p join public.etablissements e on e.id = p.etablissement_id
  where p.id = p_id and p.statut = 'paye' and p.numero_recu is not null
$$;

/** Public (QR code) : un reçu existe-t-il avec ce code ? Renvoie seulement ce qui figure sur le reçu, sinon null. */
create or replace function public.verifier_recu(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('numero', p.numero_recu, 'date', p.paye_le, 'offre', p.offre, 'periode', p.periode, 'montant', p.montant,
           'devise', p.devise, 'debut', p.debut, 'fin', p.fin, 'etablissement', e.nom, 'ville', e.ville)
  from public.paiements_abonnement p join public.etablissements e on e.id = p.etablissement_id
  where p.code_verif = upper(btrim(coalesce(p_code, ''))) and p.statut = 'paye' and length(btrim(coalesce(p_code, ''))) = 20
$$;
revoke execute on function public.verifier_recu(text) from public;
grant execute on function public.verifier_recu(text) to anon, authenticated;

-- --- 2. Rappels de fin d'abonnement ----------------------------------------------------------------------------------
create table if not exists public.rappels_abonnement (
  etablissement_id uuid not null references public.etablissements(id) on delete cascade,
  echeance timestamptz not null,
  jours integer not null check (jours between 0 and 5),
  envoye_le timestamptz not null default now(),
  primary key (etablissement_id, echeance, jours)
);
alter table public.rappels_abonnement enable row level security;
revoke all on public.rappels_abonnement from anon, authenticated;

/** Jours restants avant l'échéance, en dates du Cameroun (0 = dernier jour). */
create or replace function public._jours_restants(p_echeance timestamptz) returns integer
language sql stable set search_path = '' as $$
  select ((p_echeance at time zone 'Africa/Douala')::date - (now() at time zone 'Africa/Douala')::date)::integer
$$;

/** Serveur : rappels du jour à envoyer (offre payante, échéance dans 0 à 5 jours, rappel pas encore envoyé aujourd'hui). */
create or replace function public._rappels_a_envoyer() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('etablissement_id', e.id, 'etablissement', e.nom, 'offre', e.offre, 'echeance', e.offre_expire_le,
           'jours', public._jours_restants(e.offre_expire_le), 'emails', a.emails)), '[]'::jsonb)
  from public.etablissements e
  join lateral (select array_agg(distinct u.email) emails from public.personnels pe join auth.users u on u.id = pe.id
                 where pe.etablissement_id = e.id and pe.role = 'admin' and pe.actif and u.email is not null and u.email not like '%.invalid') a on a.emails is not null
  where e.offre <> 'decouverte' and e.offre_expire_le is not null and e.offre_expire_le > now()
    and public._jours_restants(e.offre_expire_le) between 0 and 5
    and not exists (select 1 from public.rappels_abonnement r where r.etablissement_id = e.id and r.echeance = e.offre_expire_le
                     and r.jours = public._jours_restants(e.offre_expire_le))
$$;

/** Serveur : note qu'un rappel a été envoyé (une seule fois par établissement, échéance et jour). */
create or replace function public._rappel_envoye(p_etab uuid, p_echeance timestamptz, p_jours integer) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.rappels_abonnement (etablissement_id, echeance, jours) values (p_etab, p_echeance, p_jours) on conflict do nothing
$$;

revoke execute on function public._rappels_a_envoyer(), public._rappel_envoye(uuid, timestamptz, integer) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public._rappels_a_envoyer(), public._rappel_envoye(uuid, timestamptz, integer) to service_role;
  end if;
end $$;
