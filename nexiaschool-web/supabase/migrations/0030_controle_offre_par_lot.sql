-- Notes, absences, retards : le droit (offre ou réglage de la plateforme) est vérifié une fois par instruction et par
-- établissement concerné, au lieu d'une fois par ligne. Même protection, mais les gros imports (des dizaines de milliers
-- de notes) ne paient plus un contrôle par ligne.

create or replace function public._controle_offre_lot() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select distinct etablissement_id from nouvelles where etablissement_id is not null loop
    perform public._exiger_offre(r.etablissement_id, tg_argv[0]);
  end loop;
  return null;
end $$;
revoke execute on function public._controle_offre_lot() from public, anon, authenticated;

do $$
declare r record;
begin
  for r in select * from (values ('notes', 'notes'), ('absences', 'appel'), ('retards', 'appel')) as t(tbl, fonction)
  loop
    execute format('drop trigger if exists offre_%1$s on public.%1$I', r.tbl);
    execute format('drop trigger if exists offre_%1$s_ajout on public.%1$I', r.tbl);
    execute format('drop trigger if exists offre_%1$s_modif on public.%1$I', r.tbl);
    execute format('create trigger offre_%1$s_ajout after insert on public.%1$I referencing new table as nouvelles
                    for each statement execute function public._controle_offre_lot(%2$L)', r.tbl, r.fonction);
    execute format('create trigger offre_%1$s_modif after update on public.%1$I referencing new table as nouvelles
                    for each statement execute function public._controle_offre_lot(%2$L)', r.tbl, r.fonction);
  end loop;
end $$;
