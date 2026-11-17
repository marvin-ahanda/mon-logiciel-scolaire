-- MCP : courrier des parents — lister et répondre. On réutilise courrier_liste() et courrier_repondre(), qui
-- appliquent eux-mêmes la visibilité par rôle (_courrier_visible) et l'établissement. _api_contexte place l'identité.

create or replace function public.api_courrier_liste(p_cle text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c record;
begin
  select * into c from public._api_contexte(p_cle, false);
  return public.courrier_liste();
end $$;

create or replace function public.api_courrier_repondre(p_cle text, p_id uuid, p_message text, p_moratoire_accorde boolean, p_jusqu_au date)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare c record; r jsonb;
begin
  select * into c from public._api_contexte(p_cle, true);
  r := public.courrier_repondre(p_id, p_message, p_moratoire_accorde, p_jusqu_au);
  perform public._api_journal(c.etab, c.personnel, c.source, 'repondre_courrier', jsonb_build_object('courrier', p_id, 'moratoire', p_moratoire_accorde));
  return r;
end $$;

revoke execute on function public.api_courrier_liste(text), public.api_courrier_repondre(text, uuid, text, boolean, date) from public, anon, authenticated;
grant execute on function public.api_courrier_liste(text), public.api_courrier_repondre(text, uuid, text, boolean, date) to anon;
