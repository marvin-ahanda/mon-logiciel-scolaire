-- Paramètre de l'établissement : les surveillants généraux et / ou les comptables (caissiers) peuvent, comme les enseignants,
-- se voir confier des matières et saisir les notes de ces matières. Désactivé par défaut.

alter table public.etablissements add column if not exists notes_surveillants boolean not null default false;
alter table public.etablissements add column if not exists notes_comptables boolean not null default false;
grant select (notes_surveillants, notes_comptables) on public.etablissements to authenticated;
grant update (notes_surveillants, notes_comptables) on public.etablissements to authenticated;     -- administration (règle RLS)

/** Le membre peut-il se voir confier une matière (et en saisir les notes) ? */
create or replace function public._peut_enseigner(p_personnel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.personnels p join public.etablissements e on e.id = p.etablissement_id
                  where p.id = p_personnel and p.actif
                    and (p.role in ('enseignant', 'admin') or (p.role = 'surveillant' and e.notes_surveillants)
                         or (p.role = 'comptable' and e.notes_comptables)))
$$;

create or replace function public.verifier_enseignant_attribution() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.enseignant_id is not null and not exists (
       select 1 from public.personnels p where p.id = new.enseignant_id and p.etablissement_id = new.etablissement_id) then
    raise exception 'Membre du personnel introuvable.' using errcode = 'P0001';
  end if;
  if new.enseignant_id is not null and not public._peut_enseigner(new.enseignant_id) then
    raise exception 'Une matière ne peut être confiée qu''à un enseignant, à l''administration, ou à un surveillant ou un comptable si les paramètres de l''établissement le permettent.' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Saisie : l'administration, ou la personne à qui la matière est confiée si son rôle y est autorisé
create or replace function public.peut_noter(p_attribution uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select public.est_admin()) or (exists (
    select 1 from public.attributions a where a.id = p_attribution and a.enseignant_id = auth.uid()
      and a.etablissement_id = (select public.etab_courant())) and public._peut_enseigner(auth.uid()))
$$;

revoke execute on function public._peut_enseigner(uuid) from public, anon, authenticated;
