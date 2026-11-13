-- Offres d'abonnement (Découverte, Essentiel, Pro, Premium) et droits correspondants.
--
--  * etablissements.offre : offre souscrite ; offre_periodicite (mensuel / annuel) ; offre_expire_le (fin de la période payée,
--    vide = sans échéance). Une offre payante échue retombe sur « Découverte » : les données restent, seules les fonctions
--    avancées se figent (consultation possible, plus d'ajout ni de modification).
--  * Les fonctions avancées sont contrôlées ici, à l'écriture, quelle que soit la façon d'écrire (application, import, API, MCP).
--    L'application les montre aussi, floutées, aux offres inférieures (invitation à passer à l'offre supérieure).
--  * Plafonds : Découverte = 50 élèves et 10 comptes du personnel ; Essentiel = 500 élèves.
--  * Les établissements déjà inscrits avant les offres passent en Premium (aucune fonction ne leur est retirée).
--  * Le propriétaire de la plateforme attribue l'offre depuis sa console (console_definir_offre), après paiement.

alter table public.etablissements add column if not exists offre text not null default 'decouverte'
  check (offre in ('decouverte', 'essentiel', 'pro', 'premium'));
alter table public.etablissements add column if not exists offre_periodicite text not null default 'mensuel'
  check (offre_periodicite in ('mensuel', 'annuel'));
alter table public.etablissements add column if not exists offre_expire_le timestamptz;

-- établissements existants : tout reste disponible
update public.etablissements set offre = 'premium' where offre = 'decouverte';

grant select (offre, offre_periodicite, offre_expire_le) on public.etablissements to authenticated;
-- l'offre ne se modifie jamais par l'établissement lui-même
revoke update (offre, offre_periodicite, offre_expire_le) on public.etablissements from public, anon, authenticated;

/** Rang d'une offre (1 = Découverte … 4 = Premium). */
create or replace function public._rang_offre(p_offre text) returns int
language sql immutable set search_path = '' as $$
  select coalesce(array_position(array['decouverte', 'essentiel', 'pro', 'premium'], p_offre), 1)
$$;

/** Offre minimale d'une fonction avancée. */
create or replace function public.offre_requise(p_fonction text) returns text
language sql immutable set search_path = '' as $$
  select case p_fonction
    when 'discipline' then 'essentiel'     -- infractions, suivi disciplinaire, seuils et alertes (l'appel du jour reste en Découverte)
    when 'finances'   then 'essentiel'     -- frais, échéances, paiements, reçus, moratoires
    when 'decisions'  then 'essentiel'     -- décisions de fin de période
    when 'qr'         then 'essentiel'     -- bulletins authentifiés par QR code anti-fraude
    when 'excel'      then 'essentiel'     -- import / export Excel complet (personnel, programme, notes)
    when 'smarteval'  then 'pro'
    when 'edt'        then 'pro'           -- génération automatique des emplois du temps
    when 'parents'    then 'pro'           -- espace parents, publication des bulletins, courrier
    when 'statistiques' then 'pro'         -- statistiques avancées, alertes de retard de saisie
    when 'ia'         then 'premium'       -- IA intégrée, clés API, connexion MCP / OAuth
    else 'premium' end
$$;

/** Offre en vigueur d'un établissement (Découverte si l'offre payée est échue). */
create or replace function public._offre_effective(p_etab uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select case when e.offre_expire_le is not null and e.offre_expire_le < now() then 'decouverte' else e.offre end
                     from public.etablissements e where e.id = p_etab), 'decouverte')
$$;

create or replace function public._offre_inclut(p_etab uuid, p_fonction text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public._rang_offre(public._offre_effective(p_etab)) >= public._rang_offre(public.offre_requise(p_fonction))
$$;

/** Pour l'établissement de la personne connectée. */
create or replace function public.offre_inclut(p_fonction text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public._offre_inclut(public.etab_courant(), p_fonction)
$$;

create or replace function public._libelle_offre(p_offre text) returns text
language sql immutable set search_path = '' as $$
  select case p_offre when 'essentiel' then 'Essentiel' when 'pro' then 'Pro' when 'premium' then 'Premium' else 'Découverte' end
$$;

create or replace function public._exiger_offre(p_etab uuid, p_fonction text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_etab is not null and not public._offre_inclut(p_etab, p_fonction) then
    raise exception 'Pour bénéficier de cette fonctionnalité, veuillez passer à une offre supérieure (offre % ou plus).',
      public._libelle_offre(public.offre_requise(p_fonction)) using errcode = 'P0001', hint = 'offre:' || public.offre_requise(p_fonction);
  end if;
end $$;

/** Déclencheur générique : la fonction avancée (1er argument) doit être comprise dans l'offre de l'établissement de la ligne. */
create or replace function public._controle_offre() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public._exiger_offre(new.etablissement_id, tg_argv[0]);
  return new;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
      ('incidents', 'discipline'), ('seuils_discipline', 'discipline'), ('seuils_sanctions', 'discipline'),
      ('frais_scolarite', 'finances'), ('echeances', 'finances'), ('paiements', 'finances'),
      ('criteres_decision', 'decisions'),
      ('bulletins_emis', 'qr'),
      ('evaluations', 'smarteval'),
      ('emplois_du_temps', 'edt'), ('edt_brouillons', 'edt'),
      ('publications_bulletins', 'parents'), ('sessions_parents', 'parents'), ('courriers', 'parents'),
      ('cles_api', 'ia'), ('oauth_codes', 'ia'), ('jetons_oauth', 'ia')) as t(tbl, fonction)
  loop
    execute format('drop trigger if exists offre_%1$s on public.%1$I', r.tbl);
    execute format('create trigger offre_%1$s before insert or update on public.%1$I for each row execute function public._controle_offre(%2$L)',
                   r.tbl, r.fonction);
  end loop;
end $$;

-- réponses au courrier (pas de colonne établissement : celui du courrier)
create or replace function public._controle_offre_reponse() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public._exiger_offre((select c.etablissement_id from public.courriers c where c.id = new.courrier_id), 'parents');
  return new;
end $$;
drop trigger if exists offre_courrier_reponses on public.courrier_reponses;
create trigger offre_courrier_reponses before insert on public.courrier_reponses
  for each row execute function public._controle_offre_reponse();

-- activation de l'IA par un personnel : Premium
create or replace function public._controle_offre_ia() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.ia_active and not coalesce(old.ia_active, false) then perform public._exiger_offre(new.etablissement_id, 'ia'); end if;
  return new;
end $$;
drop trigger if exists offre_ia_personnel on public.personnels;
create trigger offre_ia_personnel before insert or update of ia_active on public.personnels
  for each row execute function public._controle_offre_ia();

-- l'accès IA (clés API, MCP) cesse aussi tant que l'offre ne comprend pas l'IA
create or replace function public._ia_active(p_personnel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.ia_active and p.actif and e.suspendu_le is null and public._offre_inclut(e.id, 'ia')
                     from public.personnels p join public.etablissements e on e.id = p.etablissement_id where p.id = p_personnel), false)
$$;

/** Plafonds d'effectifs : élèves (Découverte 50, Essentiel 500) et comptes du personnel (Découverte 10). */
create or replace function public._controle_plafond() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_offre text := public._offre_effective(new.etablissement_id); v_max int; v_n int;
begin
  if tg_table_name = 'eleves' then
    v_max := case v_offre when 'decouverte' then 50 when 'essentiel' then 500 end;
  else
    v_max := case v_offre when 'decouverte' then 10 end;
  end if;
  if v_max is null then return new; end if;
  -- verrou par établissement : deux ajouts simultanés ne dépassent pas le plafond
  perform pg_advisory_xact_lock(hashtext('plafond:' || tg_table_name || ':' || new.etablissement_id::text));
  execute format('select count(*) from public.%I where etablissement_id = $1', tg_table_name) into v_n using new.etablissement_id;
  if v_n >= v_max then
    raise exception 'Votre offre % est limitée à % %. Pour bénéficier de cette fonctionnalité, veuillez passer à une offre supérieure.',
      public._libelle_offre(v_offre), v_max, case when tg_table_name = 'eleves' then 'élèves' else 'comptes du personnel' end
      using errcode = 'P0001', hint = 'offre:' || case when v_offre = 'decouverte' and tg_table_name = 'eleves' then 'essentiel'
                                                       when v_offre = 'decouverte' then 'essentiel' else 'pro' end;
  end if;
  return new;
end $$;
drop trigger if exists plafond_eleves on public.eleves;
create trigger plafond_eleves before insert on public.eleves for each row execute function public._controle_plafond();
drop trigger if exists plafond_personnels on public.personnels;
create trigger plafond_personnels before insert on public.personnels for each row execute function public._controle_plafond();

-- Console du propriétaire : offres de tous les établissements, et attribution
create or replace function public.console_offres() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exiger_proprietaire();
  return coalesce((select json_agg(json_build_object('id', e.id, 'offre', e.offre, 'periodicite', e.offre_periodicite,
            'expire_le', e.offre_expire_le, 'effective', public._offre_effective(e.id))) from public.etablissements e), '[]');
end $$;

create or replace function public.console_definir_offre(p_id uuid, p_offre text, p_periodicite text, p_expire_le timestamptz)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_nom text;
begin
  perform public._exiger_proprietaire();
  if p_offre not in ('decouverte', 'essentiel', 'pro', 'premium') then raise exception 'Offre inconnue.' using errcode = 'P0001'; end if;
  if coalesce(p_periodicite, 'mensuel') not in ('mensuel', 'annuel') then raise exception 'Périodicité inconnue.' using errcode = 'P0001'; end if;
  update public.etablissements set offre = p_offre, offre_periodicite = coalesce(p_periodicite, 'mensuel'),
         offre_expire_le = case when p_offre = 'decouverte' then null else p_expire_le end
   where id = p_id returning nom into v_nom;
  if v_nom is null then raise exception 'Établissement introuvable.' using errcode = 'P0001'; end if;
  perform public._journal_plateforme('offre', v_nom, json_build_object('offre', p_offre, 'periodicite', p_periodicite, 'expire_le', p_expire_le)::jsonb);
end $$;

revoke execute on function public._rang_offre(text), public._offre_effective(uuid), public._offre_inclut(uuid, text), public._libelle_offre(text),
  public._exiger_offre(uuid, text), public._controle_offre(), public._controle_offre_reponse(), public._controle_offre_ia(),
  public._controle_plafond(), public._ia_active(uuid) from public, anon, authenticated;
revoke execute on function public.offre_requise(text), public.offre_inclut(text), public.console_offres(),
  public.console_definir_offre(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.offre_requise(text), public.offre_inclut(text), public.console_offres(),
  public.console_definir_offre(uuid, text, text, timestamptz) to authenticated;
