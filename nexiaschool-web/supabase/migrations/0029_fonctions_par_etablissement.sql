-- Réglage fonctionnalité par fonctionnalité, établissement par établissement, par le propriétaire de la plateforme.
--
--  * Une « dérogation » active ou désactive une fonctionnalité pour un établissement, jusqu'à une date (ou sans échéance).
--    Elle l'emporte sur l'offre tant qu'elle court ; à l'échéance, l'établissement retrouve simplement les droits de son
--    offre. L'offre souscrite (etablissements.offre) n'est jamais modifiée par une dérogation.
--  * Seule une activation est annoncée : les administrateurs de l'établissement reçoivent une notification (fonctionnalités
--    offertes et échéance). Une désactivation s'applique aussitôt, sans notification.
--  * En plus des fonctions avancées de 0028, les fonctions de base deviennent réglables : saisie des notes, appel du jour,
--    bulletins, import / export Excel des élèves, classes et matières ; « plafonds » lève les limites d'effectifs.

create or replace function public._fonctions_reglables() returns text[]
language sql immutable set search_path = '' as $$
  select array['notes', 'appel', 'bulletins', 'excel_base', 'plafonds',
               'discipline', 'finances', 'decisions', 'qr', 'excel', 'smarteval', 'edt', 'parents', 'statistiques', 'ia']
$$;

/** Offre minimale de chaque fonction (les fonctions de base sont comprises dans toutes les offres ; « plafonds » : Pro). */
create or replace function public.offre_requise(p_fonction text) returns text
language sql immutable set search_path = '' as $$
  select case p_fonction
    when 'notes'      then 'decouverte'
    when 'appel'      then 'decouverte'
    when 'bulletins'  then 'decouverte'
    when 'excel_base' then 'decouverte'
    when 'plafonds'   then 'pro'           -- effectifs illimités (élèves et personnel)
    when 'discipline' then 'essentiel'
    when 'finances'   then 'essentiel'
    when 'decisions'  then 'essentiel'
    when 'qr'         then 'essentiel'
    when 'excel'      then 'essentiel'
    when 'smarteval'  then 'pro'
    when 'edt'        then 'pro'
    when 'parents'    then 'pro'
    when 'statistiques' then 'pro'
    when 'ia'         then 'premium'
    else 'premium' end
$$;

create table if not exists public.fonctions_etablissement (
  etablissement_id uuid not null references public.etablissements(id) on delete cascade,
  fonction text not null check (fonction = any (public._fonctions_reglables())),
  active boolean not null,                          -- true : activée en plus de l'offre ; false : retirée
  fin timestamptz,                                  -- échéance (vide = sans échéance)
  maj timestamptz not null default now(),
  maj_par uuid,
  primary key (etablissement_id, fonction)
);
alter table public.fonctions_etablissement enable row level security;
revoke all on public.fonctions_etablissement from public, anon, authenticated;

-- notifications aux administrateurs de l'établissement (activations seulement)
create table if not exists public.notifications_offre (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements(id) on delete cascade,
  fonctions jsonb not null,                         -- [{ "fonction": "smarteval", "fin": "2026-12-31T…" | null }, …]
  cree_le timestamptz not null default now()
);
create table if not exists public.notifications_offre_lues (
  notification_id uuid not null references public.notifications_offre(id) on delete cascade,
  personnel_id uuid not null references public.personnels(id) on delete cascade,
  lue_le timestamptz not null default now(),
  primary key (notification_id, personnel_id)
);
alter table public.notifications_offre enable row level security;
alter table public.notifications_offre_lues enable row level security;
revoke all on public.notifications_offre, public.notifications_offre_lues from public, anon, authenticated;

/** Droit effectif : dérogation en cours, sinon offre en vigueur. */
create or replace function public._offre_inclut(p_etab uuid, p_fonction text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select d.active from public.fonctions_etablissement d
      where d.etablissement_id = p_etab and d.fonction = p_fonction and (d.fin is null or d.fin > now())),
    public._rang_offre(public._offre_effective(p_etab)) >= public._rang_offre(public.offre_requise(p_fonction)))
$$;

-- message adapté quand c'est une fonction de base qui a été retirée
create or replace function public._exiger_offre(p_etab uuid, p_fonction text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_etab is not null and not public._offre_inclut(p_etab, p_fonction) then
    if public._rang_offre(public._offre_effective(p_etab)) >= public._rang_offre(public.offre_requise(p_fonction)) then
      raise exception 'Cette fonctionnalité est momentanément désactivée pour votre établissement. Contactez NexIA pour la réactiver.'
        using errcode = 'P0001', hint = 'offre:desactivee';
    end if;
    raise exception 'Pour bénéficier de cette fonctionnalité, veuillez passer à une offre supérieure (offre % ou plus).',
      public._libelle_offre(public.offre_requise(p_fonction)) using errcode = 'P0001', hint = 'offre:' || public.offre_requise(p_fonction);
  end if;
end $$;

-- fonctions de base : notes, appel du jour (absences et retards)
do $$
declare r record;
begin
  for r in select * from (values ('notes', 'notes'), ('absences', 'appel'), ('retards', 'appel')) as t(tbl, fonction)
  loop
    execute format('drop trigger if exists offre_%1$s on public.%1$I', r.tbl);
    execute format('create trigger offre_%1$s before insert or update on public.%1$I for each row execute function public._controle_offre(%2$L)', r.tbl, r.fonction);
  end loop;
end $$;

-- plafonds : levés par l'offre (Pro et plus) ou par une dérogation « plafonds »
create or replace function public._controle_plafond() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_offre text := public._offre_effective(new.etablissement_id); v_max int; v_n int;
begin
  if public._offre_inclut(new.etablissement_id, 'plafonds') then return new; end if;
  if tg_table_name = 'eleves' then
    v_max := case v_offre when 'decouverte' then 50 when 'essentiel' then 500 end;
  else
    v_max := case v_offre when 'decouverte' then 10 end;
  end if;
  if v_max is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('plafond:' || tg_table_name || ':' || new.etablissement_id::text));
  execute format('select count(*) from public.%I where etablissement_id = $1', tg_table_name) into v_n using new.etablissement_id;
  if v_n >= v_max then
    raise exception 'Votre offre % est limitée à % %. Pour bénéficier de cette fonctionnalité, veuillez passer à une offre supérieure.',
      public._libelle_offre(v_offre), v_max, case when tg_table_name = 'eleves' then 'élèves' else 'comptes du personnel' end
      using errcode = 'P0001', hint = 'offre:' || case when v_offre = 'decouverte' then 'essentiel' else 'pro' end;
  end if;
  return new;
end $$;

/** Droits effectifs de l'établissement de la personne connectée, fonction par fonction (lu par l'application). */
create or replace function public.mes_fonctions() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(f, public._offre_inclut(public.etab_courant(), f)), '{}'::jsonb)
           || jsonb_build_object('__offertes', coalesce((
                select jsonb_agg(jsonb_build_object('fonction', d.fonction, 'fin', d.fin) order by d.fonction)
                  from public.fonctions_etablissement d
                 where d.etablissement_id = public.etab_courant() and d.active and (d.fin is null or d.fin > now())
                   and public._rang_offre(public._offre_effective(d.etablissement_id)) < public._rang_offre(public.offre_requise(d.fonction))), '[]'::jsonb))
    from unnest(public._fonctions_reglables()) f
$$;

/** Notifications non lues (administrateurs de l'établissement seulement). */
create or replace function public.notifications_offre_non_lues() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'fonctions', n.fonctions, 'cree_le', n.cree_le) order by n.cree_le), '[]'::jsonb)
    from public.notifications_offre n
   where public.est_admin() and n.etablissement_id = public.etab_courant()
     and not exists (select 1 from public.notifications_offre_lues l where l.notification_id = n.id and l.personnel_id = auth.uid())
$$;

create or replace function public.notification_offre_lue(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.est_admin() then return; end if;
  insert into public.notifications_offre_lues (notification_id, personnel_id)
    select n.id, auth.uid() from public.notifications_offre n where n.id = p_id and n.etablissement_id = public.etab_courant()
  on conflict do nothing;
end $$;

-- ---------- console du propriétaire ----------
create or replace function public.console_fonctions(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exiger_proprietaire();
  if not exists (select 1 from public.etablissements where id = p_id) then raise exception 'Établissement introuvable.' using errcode = 'P0001'; end if;
  return (select jsonb_agg(jsonb_build_object(
      'fonction', f, 'requise', public.offre_requise(f),
      'par_offre', public._rang_offre(public._offre_effective(p_id)) >= public._rang_offre(public.offre_requise(f)),
      'derogation', (select jsonb_build_object('active', d.active, 'fin', d.fin, 'echue', d.fin is not null and d.fin <= now(), 'maj', d.maj)
                       from public.fonctions_etablissement d where d.etablissement_id = p_id and d.fonction = f),
      'effective', public._offre_inclut(p_id, f)) order by o)
    from unnest(public._fonctions_reglables()) with ordinality as x(f, o));
end $$;

/** Applique des réglages : [{ "fonction": …, "etat": "active" | "desactive" | "offre", "fin": "…" | null }, …].
    « offre » retire la dérogation (retour aux droits de l'offre). Les activations sont notifiées aux administrateurs. */
create or replace function public.console_definir_fonctions(p_id uuid, p_reglages jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_nom text; r jsonb; v_f text; v_etat text; v_fin timestamptz; v_notif jsonb := '[]'::jsonb; v_avant boolean; n int := 0;
begin
  perform public._exiger_proprietaire();
  select nom into v_nom from public.etablissements where id = p_id;
  if v_nom is null then raise exception 'Établissement introuvable.' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_reglages) <> 'array' then raise exception 'Réglages illisibles.' using errcode = 'P0001'; end if;
  for r in select * from jsonb_array_elements(p_reglages) loop
    v_f := r->>'fonction'; v_etat := r->>'etat'; v_fin := nullif(r->>'fin', '')::timestamptz;
    if not (v_f = any (public._fonctions_reglables())) then raise exception 'Fonctionnalité inconnue : %.', v_f using errcode = 'P0001'; end if;
    if v_etat not in ('active', 'desactive', 'offre') then raise exception 'État inconnu : %.', v_etat using errcode = 'P0001'; end if;
    if v_fin is not null and v_fin <= now() then raise exception 'L''échéance doit être dans le futur (%).', v_f using errcode = 'P0001'; end if;
    v_avant := public._offre_inclut(p_id, v_f);
    if v_etat = 'offre' then
      delete from public.fonctions_etablissement where etablissement_id = p_id and fonction = v_f;
    else
      insert into public.fonctions_etablissement (etablissement_id, fonction, active, fin, maj, maj_par)
        values (p_id, v_f, v_etat = 'active', v_fin, now(), auth.uid())
      on conflict (etablissement_id, fonction) do update set active = excluded.active, fin = excluded.fin, maj = now(), maj_par = auth.uid();
      -- notification : seulement une activation qui ouvre une fonction que l'offre ne comprend pas
      if v_etat = 'active' and public._rang_offre(public._offre_effective(p_id)) < public._rang_offre(public.offre_requise(v_f)) then
        v_notif := v_notif || jsonb_build_array(jsonb_build_object('fonction', v_f, 'fin', v_fin));
      end if;
    end if;
    n := n + 1;
  end loop;
  if jsonb_array_length(v_notif) > 0 then
    insert into public.notifications_offre (etablissement_id, fonctions) values (p_id, v_notif);
  end if;
  perform public._journal_plateforme('fonctionnalités', v_nom, jsonb_build_object('reglages', p_reglages));
  return jsonb_build_object('appliques', n, 'notifies', jsonb_array_length(v_notif));
end $$;

revoke execute on function public._fonctions_reglables() from public, anon, authenticated;
revoke execute on function public.mes_fonctions(), public.notifications_offre_non_lues(), public.notification_offre_lue(uuid),
  public.console_fonctions(uuid), public.console_definir_fonctions(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.mes_fonctions(), public.notifications_offre_non_lues(), public.notification_offre_lue(uuid),
  public.console_fonctions(uuid), public.console_definir_fonctions(uuid, jsonb) to authenticated;
