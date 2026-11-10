-- Bulletins réservés à l'administration, aux surveillants et au service financier (comptables / caissiers) :
-- les enseignants saisissent et consultent les notes, mais n'éditent pas les bulletins authentifiés (QR code).
alter function public.emettre_bulletins(jsonb) rename to _emettre_bulletins;
revoke execute on function public._emettre_bulletins(jsonb) from public, anon, authenticated;

create or replace function public.emettre_bulletins(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.personnels where id = auth.uid() and actif and role in ('admin', 'surveillant', 'comptable')) then
    raise exception 'Les bulletins sont réservés à l''administration, aux surveillants et au service financier.' using errcode = '42501';
  end if;
  return public._emettre_bulletins(p);
end $$;

revoke execute on function public.emettre_bulletins(jsonb) from public, anon, authenticated;
grant execute on function public.emettre_bulletins(jsonb) to authenticated;
