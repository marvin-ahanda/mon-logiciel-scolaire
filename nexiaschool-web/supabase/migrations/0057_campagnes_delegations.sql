-- Pilotage institutionnel : calendrier des campagnes et accès exceptionnels gérés par les délégations elles-mêmes.
--  * La délégation départementale (DDES) fixe les campagnes des fiches statistiques des établissements de son département ;
--    la délégation régionale (DRES) fixe celles des synthèses départementales de sa région. Le titulaire seul les gère.
--  * Une campagne « nationale » (créée dans la Console, sans périmètre) reste possible ; pour une même année et une même
--    période, la campagne de la délégation prime sur la campagne nationale dans son périmètre.
--  * À la création (et à chaque changement de calendrier), les établissements concernés en sont notifiés ; ces notifications
--    ne sont lisibles que par les administrateurs des établissements (règle existante de inst_notifications_lire).
--  * La DRES accorde et révoque elle-même les accès exceptionnels aux fiches brutes de sa région (limités, journalisés,
--    signalés à la délégation départementale concernée).
--  * Messages d'erreur clairs à la saisie d'une campagne (année scolaire, dates), dans la Console comme dans les espaces.

-- ---------------------------------------------------------------------------------------------------------
-- 1. Périmètre des campagnes
-- ---------------------------------------------------------------------------------------------------------
alter table public.inst_campagnes add column departement_id uuid references public.inst_departements (id);
alter table public.inst_campagnes add column region_id uuid references public.inst_regions (id);
alter table public.inst_campagnes add column delegation_id uuid references public.inst_delegations (id);   -- auteur (null = Console)
alter table public.inst_campagnes add constraint inst_campagnes_perimetre_check
  check ((departement_id is null or niveau = 'etablissement') and (region_id is null or niveau = 'departement'));

do $$
declare v_nom text;
begin
  select conname into v_nom from pg_constraint
   where conrelid = 'public.inst_campagnes'::regclass and contype = 'u' and array_length(conkey, 1) = 3;
  if v_nom is not null then execute format('alter table public.inst_campagnes drop constraint %I', v_nom); end if;
end $$;
create unique index inst_campagnes_unique_perimetre on public.inst_campagnes (niveau, exercice_libelle, periode,
  coalesce(departement_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(region_id, '00000000-0000-0000-0000-000000000000'::uuid));

/**
 * Campagne applicable à un périmètre (département et région de l'établissement ou de la délégation) :
 * la campagne du périmètre, sinon la campagne nationale de même année et même période.
 */
create or replace function public._inst_campagne_applicable(c public.inst_campagnes, p_departement uuid, p_region uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(case
    when c.id is null then false
    when c.niveau = 'etablissement' then c.departement_id = p_departement
      or (c.departement_id is null and not exists (select 1 from public.inst_campagnes x where x.niveau = 'etablissement' and x.departement_id = p_departement
                                                    and x.exercice_libelle = c.exercice_libelle and x.periode = c.periode))
    when c.niveau = 'departement' then c.region_id = p_region
      or (c.region_id is null and not exists (select 1 from public.inst_campagnes x where x.niveau = 'departement' and x.region_id = p_region
                                               and x.exercice_libelle = c.exercice_libelle and x.periode = c.periode))
    else c.departement_id is null and c.region_id is null end, false)
$$;

/** Campagne applicable pour une année et une période données (périmètre d'abord, sinon nationale). */
create or replace function public._inst_campagne_pour(p_niveau text, p_exercice text, p_periode text, p_departement uuid, p_region uuid) returns public.inst_campagnes
language sql stable security definer set search_path = '' as $$
  select c.* from public.inst_campagnes c
   where c.niveau = p_niveau and c.exercice_libelle = p_exercice and c.periode = p_periode
     and public._inst_campagne_applicable(c, p_departement, p_region)
   order by (c.departement_id is not null or c.region_id is not null) desc limit 1
$$;

/** Département et région de l'utilisateur courant (délégation, sinon établissement administré). */
create or replace function public._inst_perimetre_courant() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_moi(); dl public.inst_delegations; v_dep uuid;
begin
  if m.id is not null then
    select * into dl from public.inst_delegations where id = m.delegation_id;
    return jsonb_build_object('departement_id', dl.departement_id, 'region_id', dl.region_id);
  end if;
  select departement_id into v_dep from public.etablissements where id = public.etab_courant();
  return jsonb_build_object('departement_id', v_dep, 'region_id', (select region_id from public.inst_departements where id = v_dep));
end $$;

create or replace function public._inst_campagne_json(c public.inst_campagnes) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'niveau', c.niveau, 'exercice', c.exercice_libelle, 'periode', c.periode, 'ouverture', c.ouverture,
           'echeance', c.echeance, 'prolongation', c.prolongation, 'echeance_effective', public._inst_echeance(c), 'ouvert', c.ouvert,
           'alertes_jours', c.alertes_jours,
           'etat', case when not c.ouvert then 'fermee' when public._aujourdhui() < c.ouverture then 'a_venir'
                        when public._aujourdhui() > public._inst_echeance(c) then 'echue' else 'ouverte' end,
           'nationale', c.departement_id is null and c.region_id is null,
           'departement_id', c.departement_id, 'departement', (select nom from public.inst_departements where id = c.departement_id),
           'region_id', c.region_id, 'region', (select nom from public.inst_regions where id = c.region_id),
           'auteur', (select nom from public.inst_delegations where id = c.delegation_id))
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 2. Saisie d'une campagne : contrôle et messages clairs (Console et délégations)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._inst_campagne_valider(p jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v_ex text := btrim(coalesce(p ->> 'exercice', '')); v_ouv date; v_ech date; v_pro date; v_al smallint[];
begin
  if coalesce(p ->> 'niveau', '') not in ('etablissement', 'departement', 'region') then raise exception 'Niveau de campagne inconnu.' using errcode = 'P0001'; end if;
  if v_ex !~ '^[0-9]{4}-[0-9]{4}$' or split_part(v_ex, '-', 2)::int <> split_part(v_ex, '-', 1)::int + 1 then
    raise exception 'Année scolaire : écrivez deux années qui se suivent, séparées par un tiret, par exemple 2026-2027.' using errcode = 'P0001';
  end if;
  if coalesce(p ->> 'periode', '') not in ('t1', 't2', 't3', 'annuel') then raise exception 'Choisissez la période (trimestre ou bilan annuel).' using errcode = 'P0001'; end if;
  begin v_ouv := nullif(btrim(p ->> 'ouverture'), '')::date; exception when others then v_ouv := null; end;
  if v_ouv is null then raise exception 'Indiquez la date d''ouverture de la campagne.' using errcode = 'P0001'; end if;
  begin v_ech := nullif(btrim(p ->> 'echeance'), '')::date; exception when others then v_ech := null; end;
  if v_ech is null then raise exception 'Indiquez la date d''échéance de la campagne.' using errcode = 'P0001'; end if;
  if v_ech < v_ouv then raise exception 'L''échéance doit être le jour de l''ouverture ou après.' using errcode = 'P0001'; end if;
  begin v_pro := nullif(btrim(coalesce(p ->> 'prolongation', '')), '')::date;
  exception when others then raise exception 'Date de prolongation invalide.' using errcode = 'P0001'; end;
  if v_pro is not null and v_pro < v_ech then raise exception 'La prolongation doit être le jour de l''échéance ou après.' using errcode = 'P0001'; end if;
  select coalesce(array_agg(distinct x::smallint order by x::smallint desc), array[7, 3, 1, 0, -1]::smallint[]) into v_al
    from jsonb_array_elements_text(coalesce(p -> 'alertes_jours', '[7, 3, 1, 0, -1]')) x where x ~ '^-?[0-9]{1,3}$' and x::int between -30 and 365;
  return jsonb_build_object('niveau', p ->> 'niveau', 'exercice', v_ex, 'periode', p ->> 'periode', 'ouverture', v_ouv, 'echeance', v_ech,
                            'prolongation', v_pro, 'ouvert', coalesce((p ->> 'ouvert')::boolean, true), 'alertes', to_jsonb(v_al));
end $$;

/** Enregistrement commun (création ou modification) ; l'appelant a déjà vérifié ses droits et fixé le périmètre. */
create or replace function public._inst_campagne_ecrire(p jsonb, p_departement uuid, p_region uuid, p_delegation uuid) returns public.inst_campagnes
language plpgsql volatile security definer set search_path = '' as $$
declare v jsonb := public._inst_campagne_valider(p); v_id uuid := nullif(p ->> 'id', '')::uuid; c public.inst_campagnes; v_al smallint[];
begin
  select array_agg(x::smallint) into v_al from jsonb_array_elements_text(v -> 'alertes') x;
  if v_id is null then
    begin
      insert into public.inst_campagnes (niveau, exercice_libelle, periode, ouverture, echeance, prolongation, ouvert, alertes_jours, departement_id, region_id, delegation_id)
      values (v ->> 'niveau', v ->> 'exercice', v ->> 'periode', (v ->> 'ouverture')::date, (v ->> 'echeance')::date, (v ->> 'prolongation')::date,
              (v ->> 'ouvert')::boolean, v_al, p_departement, p_region, p_delegation)
      returning * into c;
    exception when unique_violation then
      raise exception 'Une campagne existe déjà pour cette année scolaire et cette période : modifiez-la dans le tableau.' using errcode = 'P0001';
    end;
  else
    update public.inst_campagnes set ouverture = (v ->> 'ouverture')::date, echeance = (v ->> 'echeance')::date, prolongation = (v ->> 'prolongation')::date,
           ouvert = (v ->> 'ouvert')::boolean, alertes_jours = v_al
     where id = v_id and departement_id is not distinct from p_departement and region_id is not distinct from p_region
     returning * into c;
    if c.id is null then raise exception 'Campagne introuvable dans votre périmètre.' using errcode = 'P0001'; end if;
  end if;
  return c;
end $$;

/** Notification de la campagne (création ou changement de calendrier) aux destinataires de son périmètre. */
create or replace function public._inst_campagne_annoncer(c public.inst_campagnes, p_nouvelle boolean, p_auteur text) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare v_titre text; v_corps text; r record; n integer := 0;
begin
  v_titre := case when p_nouvelle then 'Nouvelle campagne' when not c.ouvert then 'Campagne fermée' else 'Calendrier modifié' end
          || ' : ' || case when c.niveau = 'etablissement' then 'fiche statistique ' else 'synthèse départementale ' end || upper(c.periode) || ' ' || c.exercice_libelle;
  v_corps := 'Ouverture le ' || to_char(c.ouverture, 'DD/MM/YYYY') || ', échéance le ' || to_char(public._inst_echeance(c), 'DD/MM/YYYY')
          || case when c.prolongation is not null then ' (prolongée)' else '' end || '. Fixée par ' || coalesce(p_auteur, 'NexIA School') || '.';
  if c.niveau = 'etablissement' then
    for r in select e.id from public.etablissements e
              where e.rattachement_statut in ('declare', 'verifie')
                and (e.departement_id = c.departement_id
                     or (c.departement_id is null and e.departement_id is not null and public._inst_campagne_applicable(c, e.departement_id,
                           (select region_id from public.inst_departements where id = e.departement_id))
                         -- campagne nationale : seulement là où une délégation départementale peut recevoir la fiche
                         and exists (select 1 from public.inst_delegations d where d.niveau = 'departement' and d.departement_id = e.departement_id and d.actif))) loop
      perform public._inst_notifier(r.id, null, 'campagne', v_titre, v_corps, '/fiches-statistiques', c.id); n := n + 1;
    end loop;
  elsif c.niveau = 'departement' then
    for r in select d.id from public.inst_delegations d
              where d.niveau = 'departement' and d.actif and (d.region_id = c.region_id or (c.region_id is null and public._inst_campagne_applicable(c, d.departement_id, d.region_id))) loop
      perform public._inst_notifier(null, r.id, 'campagne', v_titre, v_corps, '/institution/synthese', c.id); n := n + 1;
    end loop;
  end if;
  return n;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Console : campagnes nationales (messages clairs, annonce aux établissements)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.console_inst_campagne(p jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare c public.inst_campagnes; v_avant public.inst_campagnes; v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  perform public._exiger_proprietaire();
  if v_id is not null then
    select * into v_avant from public.inst_campagnes where id = v_id;
    if v_avant.id is null then raise exception 'Campagne introuvable.' using errcode = 'P0001'; end if;
    c := public._inst_campagne_ecrire(p || jsonb_build_object('niveau', v_avant.niveau, 'exercice', v_avant.exercice_libelle, 'periode', v_avant.periode,
                                        'ouvert', coalesce(p -> 'ouvert', to_jsonb(v_avant.ouvert))),
                                      v_avant.departement_id, v_avant.region_id, v_avant.delegation_id);
  else
    c := public._inst_campagne_ecrire(p, null, null, null);
  end if;
  if v_avant.id is null or v_avant.ouverture <> c.ouverture or public._inst_echeance(v_avant) <> public._inst_echeance(c) or v_avant.ouvert <> c.ouvert then
    perform public._inst_campagne_annoncer(c, v_avant.id is null, coalesce((select nom from public.inst_delegations where id = c.delegation_id), 'NexIA School'));
  end if;
  perform public._inst_journaliser('campagne', 'inst_campagne', c.id, p);
  return c.id;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 4. Délégations : gestion de leurs campagnes (titulaire)
-- ---------------------------------------------------------------------------------------------------------
/** Niveau des campagnes fixées par une délégation : la DDES fixe celles des établissements, la DRES celles des synthèses départementales. */
create or replace function public._inst_niveau_gere(dl public.inst_delegations) returns text
language sql immutable set search_path = '' as $$ select case dl.niveau when 'departement' then 'etablissement' when 'region' then 'departement' end $$;

create or replace function public.inst_campagnes_gerer() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger(); dl public.inst_delegations; v_niv text;
begin
  select * into dl from public.inst_delegations where id = m.delegation_id;
  v_niv := public._inst_niveau_gere(dl);
  return jsonb_build_object(
    'niveau', v_niv, 'peut_modifier', m.role = 'titulaire',
    'campagnes', (select coalesce(jsonb_agg(public._inst_campagne_json(c) || jsonb_build_object('modifiable',
                     c.departement_id is not distinct from case when v_niv = 'etablissement' then dl.departement_id end
                     and c.region_id is not distinct from case when v_niv = 'departement' then dl.region_id end and c.delegation_id = dl.id,
                     'fiches_publiees', (select count(*) from public.inst_fiches f where f.campagne_id = c.id and f.version_courante > 0))
                   order by c.exercice_libelle desc, c.periode desc), '[]'::jsonb)
                  from public.inst_campagnes c where c.niveau = v_niv and public._inst_campagne_applicable(c, dl.departement_id, dl.region_id)),
    'parametres', (select jsonb_build_object('inclure_digitalise', inclure_digitalise, 'formules_validees', formules_validees) from public.inst_parametres where id = 1),
    'annees', (select coalesce(jsonb_agg(distinct x.libelle order by x.libelle desc), '[]'::jsonb) from public.exercices x
                where x.libelle ~ '^[0-9]{4}-[0-9]{4}$' and exists (select 1 from public.etablissements e where e.id = x.etablissement_id
                  and (e.departement_id = dl.departement_id or e.departement_id in (select id from public.inst_departements where region_id = dl.region_id)))),
    'destinataires', case when v_niv = 'etablissement'
                       then (select count(*) from public.etablissements e where e.departement_id = dl.departement_id and e.rattachement_statut in ('declare', 'verifie'))
                       else (select count(*) from public.inst_delegations d where d.niveau = 'departement' and d.actif and d.region_id = dl.region_id) end);
end $$;

create or replace function public.inst_campagne_enregistrer(p jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger(); dl public.inst_delegations; v_niv text; c public.inst_campagnes; v_avant public.inst_campagnes;
        v_id uuid := nullif(p ->> 'id', '')::uuid; v_dep uuid; v_reg uuid;
begin
  if m.role <> 'titulaire' then raise exception 'Seul le titulaire de la délégation fixe le calendrier des campagnes.' using errcode = '42501'; end if;
  select * into dl from public.inst_delegations where id = m.delegation_id;
  v_niv := public._inst_niveau_gere(dl);
  if v_niv is null then raise exception 'Niveau de délégation inconnu.' using errcode = 'P0001'; end if;
  v_dep := case when v_niv = 'etablissement' then dl.departement_id end;
  v_reg := case when v_niv = 'departement' then dl.region_id end;
  if v_id is not null then
    select * into v_avant from public.inst_campagnes where id = v_id and delegation_id = dl.id
       and departement_id is not distinct from v_dep and region_id is not distinct from v_reg;
    if v_avant.id is null then raise exception 'Cette campagne n''a pas été créée par votre délégation : elle ne peut pas être modifiée ici.' using errcode = '42501'; end if;
    c := public._inst_campagne_ecrire(p || jsonb_build_object('niveau', v_niv, 'exercice', v_avant.exercice_libelle, 'periode', v_avant.periode,
                                        'ouvert', coalesce(p -> 'ouvert', to_jsonb(v_avant.ouvert))), v_dep, v_reg, dl.id);
  else
    -- une campagne nationale déjà commencée dans le périmètre reste la référence (les fiches y sont rattachées)
    if exists (select 1 from public.inst_campagnes n join public.inst_fiches f on f.campagne_id = n.id
                where n.niveau = v_niv and n.departement_id is null and n.region_id is null
                  and n.exercice_libelle = btrim(coalesce(p ->> 'exercice', '')) and n.periode = p ->> 'periode'
                  and ((v_niv = 'etablissement' and f.departement_id = dl.departement_id) or (v_niv = 'departement' and f.region_id = dl.region_id))) then
      raise exception 'Une campagne nationale est déjà en cours pour cette période et des fiches y ont été commencées dans votre circonscription : elle reste la référence.'
        using errcode = 'P0001';
    end if;
    c := public._inst_campagne_ecrire(p || jsonb_build_object('niveau', v_niv), v_dep, v_reg, dl.id);
  end if;
  if v_avant.id is null or v_avant.ouverture <> c.ouverture or public._inst_echeance(v_avant) <> public._inst_echeance(c) or v_avant.ouvert <> c.ouvert then
    perform public._inst_campagne_annoncer(c, v_avant.id is null, dl.nom);
  end if;
  perform public._inst_journaliser(case when v_avant.id is null then 'campagne créée' else 'campagne modifiée' end, 'inst_campagne', c.id, p);
  return c.id;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 5. Lecture et usage des campagnes : seulement celles qui s'appliquent au périmètre (redéfinitions)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.inst_campagnes_lire(p_niveau text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  v := public._inst_perimetre_courant();
  return (select coalesce(jsonb_agg(public._inst_campagne_json(c) order by c.exercice_libelle desc, c.periode desc), '[]'::jsonb)
            from public.inst_campagnes c where c.niveau = p_niveau
             and public._inst_campagne_applicable(c, (v ->> 'departement_id')::uuid, (v ->> 'region_id')::uuid));
end $$;

create or replace function public.inst_mes_fiches() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin(); v_dep uuid; v_reg uuid;
begin
  select e.departement_id, d.region_id into v_dep, v_reg from public.etablissements e left join public.inst_departements d on d.id = e.departement_id where e.id = v_etab;
  return jsonb_build_object(
    'localisation', public.etablissement_localisation_lire(),
    'campagnes', (select coalesce(jsonb_agg(public._inst_campagne_json(c) || jsonb_build_object(
                     'fiche', (select jsonb_build_object('id', f.id, 'statut', f.statut, 'version', f.version_courante, 'maj_le', f.maj_le)
                                 from public.inst_fiches f where f.niveau = 'etablissement' and f.etablissement_id = v_etab and f.campagne_id = c.id))
                     order by c.exercice_libelle desc, c.periode desc), '[]'::jsonb)
                    from public.inst_campagnes c where c.niveau = 'etablissement'
                     and (exists (select 1 from public.inst_fiches f where f.etablissement_id = v_etab and f.campagne_id = c.id)
                          or (c.ouvert and public._inst_campagne_applicable(c, v_dep, v_reg)))));
end $$;

create or replace function public.inst_fiche_preparer(p_campagne uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin(); c public.inst_campagnes; v_id uuid; e public.etablissements; v_reg uuid;
begin
  select * into e from public.etablissements where id = v_etab;
  select region_id into v_reg from public.inst_departements where id = e.departement_id;
  select * into c from public.inst_campagnes where id = p_campagne and niveau = 'etablissement';
  select id into v_id from public.inst_fiches where niveau = 'etablissement' and etablissement_id = v_etab and campagne_id = c.id;
  if v_id is not null then return v_id; end if;
  if c.id is null or not c.ouvert or not public._inst_campagne_applicable(c, e.departement_id, v_reg) then
    raise exception 'Campagne fermée ou introuvable.' using errcode = 'P0001';
  end if;
  if public._aujourdhui() < c.ouverture then raise exception 'La campagne n''est pas encore ouverte.' using errcode = 'P0001'; end if;
  insert into public.inst_fiches (niveau, campagne_id, etablissement_id, departement_id, region_id, exercice_libelle, periode, brouillon, maj_par)
  values ('etablissement', c.id, v_etab, e.departement_id, v_reg, c.exercice_libelle, c.periode, public._inst_preremplir(v_etab, c.exercice_libelle, c.periode), auth.uid())
  on conflict (etablissement_id, campagne_id) where niveau = 'etablissement' do nothing
  returning id into v_id;
  if v_id is null then
    return (select id from public.inst_fiches where niveau = 'etablissement' and etablissement_id = v_etab and campagne_id = c.id);
  end if;
  insert into public.inst_fiche_statuts (fiche_id, de, a, par, motif) values (v_id, null, 'brouillon', auth.uid(), 'Création (pré-remplissage)');
  return v_id;
end $$;

create or replace function public.inst_fiche_publier(p_fiche uuid, p_confirmer boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare f public.inst_fiches; c public.inst_campagnes; e public.etablissements; v_dest uuid; v_ind jsonb; v_anom jsonb; v_n integer; v_retard boolean;
        m public.inst_membres; dl public.inst_delegations; v_etab_c public.inst_campagnes; v_vers uuid[]; v_attendus integer; v_id uuid;
begin
  if public._inst_acces_fiche(p_fiche) <> 'proprietaire' then raise exception 'Seul l''auteur de la fiche peut la publier.' using errcode = '42501'; end if;
  select * into f from public.inst_fiches where id = p_fiche for update;
  if f.statut not in ('brouillon', 'prete', 'correction_demandee', 'corrigee') then raise exception 'Cette version est déjà publiée.' using errcode = 'P0001'; end if;
  select * into c from public.inst_campagnes where id = f.campagne_id;
  if f.niveau = 'etablissement' then
    select * into e from public.etablissements where id = f.etablissement_id;
    if e.departement_id is null or e.rattachement_statut <> 'verifie' then
      raise exception 'Le rattachement administratif de votre établissement (région, département) doit être renseigné et vérifié avant toute publication.' using errcode = 'P0001';
    end if;
    -- la fiche suit la campagne qui s'applique au département actuel (changement de département, campagne départementale créée entre-temps)
    v_etab_c := public._inst_campagne_pour('etablissement', f.exercice_libelle, f.periode, e.departement_id,
                                           (select region_id from public.inst_departements where id = e.departement_id));
    if v_etab_c.id is null then
      raise exception 'Aucune campagne de votre département ne correspond à cette période : la fiche ne peut pas être transmise. Elle reste enregistrée.' using errcode = 'P0001';
    end if;
    if v_etab_c.id <> c.id then
      if exists (select 1 from public.inst_fiches x where x.niveau = 'etablissement' and x.etablissement_id = e.id and x.campagne_id = v_etab_c.id) then
        raise exception 'Une autre fiche existe déjà pour la campagne de votre département sur cette période : publiez celle-ci.' using errcode = 'P0001';
      end if;
      update public.inst_fiches set campagne_id = v_etab_c.id where id = f.id;
      c := v_etab_c;
    end if;
  end if;
  if not c.ouvert then raise exception 'La campagne est fermée : la publication n''est plus possible.' using errcode = 'P0001'; end if;
  v_retard := public._aujourdhui() > public._inst_echeance(c);

  if f.niveau = 'etablissement' then
    v_dest := public._inst_delegation_etablissement(e.id);
    if v_dest is null then
      raise exception 'Aucune délégation départementale active n''est encore enregistrée pour votre département : la fiche ne peut pas être transmise. Elle reste enregistrée.' using errcode = 'P0001';
    end if;
    v_ind := public._inst_indicateurs(f.brouillon);
    update public.inst_fiches set departement_id = e.departement_id, region_id = (select region_id from public.inst_departements where id = e.departement_id) where id = f.id;
  else
    m := public._inst_exiger('synthese');
    select * into dl from public.inst_delegations where id = f.delegation_id;
    if f.niveau = 'departement' then
      v_etab_c := public._inst_campagne_pour('etablissement', f.exercice_libelle, f.periode, dl.departement_id, dl.region_id);
      select array_agg(v.id) into v_vers from public.inst_fiches fe
        join lateral (select id from public.inst_fiche_versions where fiche_id = fe.id and destinataire_id = dl.id order by version desc limit 1) v on true
       where fe.niveau = 'etablissement' and fe.campagne_id = v_etab_c.id;
      select count(*) into v_attendus from public.etablissements where departement_id = dl.departement_id and rattachement_statut = 'verifie';
      v_dest := public._inst_delegation_regionale(dl.id);
      if v_dest is null then raise exception 'Aucune délégation régionale active n''est enregistrée pour votre région : la synthèse ne peut pas être transmise.' using errcode = 'P0001'; end if;
    else
      v_etab_c := public._inst_campagne_pour('departement', f.exercice_libelle, f.periode, null, dl.region_id);
      select array_agg(v.id) into v_vers from public.inst_fiches fe
        join lateral (select id from public.inst_fiche_versions where fiche_id = fe.id and destinataire_id = dl.id order by version desc limit 1) v on true
       where fe.niveau = 'departement' and fe.campagne_id = v_etab_c.id;
      select count(*) into v_attendus from public.inst_departements where region_id = dl.region_id and actif;
    end if;
    v_ind := public._inst_consolider(coalesce(v_vers, '{}')) || jsonb_build_object('attendus', v_attendus,
               'observations', char_length(btrim(coalesce(f.brouillon ->> 'observations', ''))) > 0, 'anomalies', '[]'::jsonb);
    if coalesce((v_ind ->> 'nb_fiches')::int, 0) < v_attendus then
      v_ind := jsonb_set(v_ind, '{anomalies}', jsonb_build_array(jsonb_build_object('niveau', 'alerte', 'code', 'incomplet',
                 'message', (v_attendus - coalesce((v_ind ->> 'nb_fiches')::int, 0)) || ' document(s) attendu(s) non reçu(s) : la consolidation est partielle.')));
    end if;
  end if;

  v_anom := coalesce(v_ind -> 'anomalies', '[]');
  if exists (select 1 from jsonb_array_elements(v_anom) a where a ->> 'niveau' = 'bloquant') then
    raise exception 'Publication impossible : corrigez d''abord les anomalies bloquantes (valeurs négatives ou incohérentes).' using errcode = 'P0001';
  end if;
  if not p_confirmer and exists (select 1 from jsonb_array_elements(v_anom) a where a ->> 'niveau' = 'alerte') then
    raise exception 'Des anomalies sont signalées : vérifiez-les puis confirmez la publication.' using errcode = 'P0001', hint = 'confirmation';
  end if;

  v_n := f.version_courante + 1;
  insert into public.inst_fiche_versions (fiche_id, version, donnees, indicateurs, anomalies, destinataire_id, departement_id, region_id, en_retard, publie_par)
  values (f.id, v_n, f.brouillon, v_ind, v_anom, v_dest, (select departement_id from public.inst_fiches where id = f.id), (select region_id from public.inst_fiches where id = f.id),
          v_retard, auth.uid())
  returning id into v_id;
  update public.inst_fiches set version_courante = v_n where id = f.id;
  perform public._inst_statut(f.id, case when v_n = 1 then 'publiee' else 'republiee' end, case when v_retard then 'Publication après l''échéance' else '' end);
  if v_dest is not null then
    perform public._inst_notifier(null, v_dest, 'publication',
      case when f.niveau = 'etablissement' then 'Fiche reçue : ' || e.nom else 'Synthèse reçue : ' || dl.nom end
        || ' (' || upper(f.periode) || ' ' || f.exercice_libelle || ', version ' || v_n || ')',
      case when v_retard then 'Transmise après l''échéance.' else '' end, '/institution/fiches/' || f.id, f.id);
  end if;
  perform public._inst_journaliser('publication', 'inst_fiche', f.id, jsonb_build_object('version', v_n, 'destinataire', v_dest, 'en_retard', v_retard, 'niveau', f.niveau));
  return jsonb_build_object('version', v_n, 'en_retard', v_retard, 'destinataire', (select nom from public.inst_delegations where id = v_dest));
end $$;

/** Campagne demandée par une délégation, vérifiée pour son périmètre et son niveau. */
create or replace function public._inst_campagne_delegation(p_campagne uuid, dl public.inst_delegations, p_niveau text) returns public.inst_campagnes
language plpgsql stable security definer set search_path = '' as $$
declare c public.inst_campagnes;
begin
  select * into c from public.inst_campagnes where id = p_campagne and niveau = p_niveau;
  if c.id is not null and not public._inst_campagne_applicable(c, dl.departement_id, dl.region_id) then
    raise exception 'Cette campagne ne concerne pas votre circonscription.' using errcode = '42501';
  end if;
  return c;
end $$;

create or replace function public.inst_tableau_departement(p_campagne uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger(); dl public.inst_delegations; c public.inst_campagnes; v_lignes jsonb; v_ech date;
begin
  select * into dl from public.inst_delegations where id = m.delegation_id;
  if dl.niveau <> 'departement' then raise exception 'Réservé aux délégations départementales.' using errcode = '42501'; end if;
  c := public._inst_campagne_delegation(p_campagne, dl, 'etablissement');
  v_ech := public._inst_echeance(c);
  select coalesce(jsonb_agg(x order by x ->> 'nom'), '[]'::jsonb) into v_lignes from (
    select jsonb_build_object('id', e.id, 'nom', e.nom, 'ville', e.ville, 'code', upper(left(replace(e.id::text, '-', ''), 8)),
             'rattachement', e.rattachement_statut,
             'fiche_id', f.id, 'statut', case when v.version is null then 'non_publiee' else f.statut end,
             'version', v.version, 'premiere_publication', (select min(publie_le) from public.inst_fiche_versions where fiche_id = f.id and destinataire_id = dl.id),
             'derniere_publication', v.publie_le, 'en_retard', coalesce(v.en_retard, c.id is not null and public._aujourdhui() > v_ech),
             'jours_retard', case when v.version is null and public._aujourdhui() > v_ech then public._aujourdhui() - v_ech end,
             'derniere_action', (select s.le from public.inst_fiche_statuts s where s.fiche_id = f.id and v.version is not null order by s.le desc limit 1),
             'consultee', exists (select 1 from public.inst_journal j where j.objet = 'inst_fiche' and j.objet_id = f.id and j.action = 'consultation'),
             'appreciation', f.appreciation) x
      from public.etablissements e
      left join public.inst_fiches f on f.niveau = 'etablissement' and f.etablissement_id = e.id and f.campagne_id = c.id
      left join lateral (select version, publie_le, en_retard from public.inst_fiche_versions where fiche_id = f.id and destinataire_id = dl.id order by version desc limit 1) v on true
     where e.departement_id = dl.departement_id and e.rattachement_statut in ('declare', 'verifie')) z;
  return jsonb_build_object('campagne', case when c.id is not null then public._inst_campagne_json(c) end,
    'etablissements', v_lignes,
    'compteurs', jsonb_build_object(
       'etablissements', jsonb_array_length(v_lignes),
       'attendues', (select count(*) from jsonb_array_elements(v_lignes) x where x ->> 'rattachement' = 'verifie'),
       'a_verifier', (select count(*) from jsonb_array_elements(v_lignes) x where x ->> 'rattachement' = 'declare'),
       'publiees', (select count(*) from jsonb_array_elements(v_lignes) x where x ->> 'statut' <> 'non_publiee'),
       'non_publiees', (select count(*) from jsonb_array_elements(v_lignes) x where x ->> 'statut' = 'non_publiee' and x ->> 'rattachement' = 'verifie'),
       'en_retard', (select count(*) from jsonb_array_elements(v_lignes) x where x ->> 'statut' = 'non_publiee' and x ->> 'rattachement' = 'verifie' and (x ->> 'en_retard')::boolean),
       'publiees_en_retard', (select count(*) from jsonb_array_elements(v_lignes) x where x ->> 'statut' <> 'non_publiee' and (x ->> 'en_retard')::boolean),
       'correction', (select count(*) from jsonb_array_elements(v_lignes) x where x ->> 'statut' in ('correction_demandee', 'corrigee')),
       'examinees', (select count(*) from jsonb_array_elements(v_lignes) x where x ->> 'statut' = 'examinee')));
end $$;

create or replace function public.inst_consolidation(p_campagne uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger(); dl public.inst_delegations; c public.inst_campagnes; v_vers uuid[]; v_att integer; v_corr integer;
begin
  select * into dl from public.inst_delegations where id = m.delegation_id;
  c := public._inst_campagne_delegation(p_campagne, dl, case when dl.niveau = 'departement' then 'etablissement' else 'departement' end);
  if c.id is null then raise exception 'Campagne incompatible avec votre niveau.' using errcode = 'P0001'; end if;
  select array_agg(v.id), count(*) filter (where f.statut in ('correction_demandee', 'corrigee')) into v_vers, v_corr
    from public.inst_fiches f
    join lateral (select id from public.inst_fiche_versions where fiche_id = f.id and destinataire_id = dl.id order by version desc limit 1) v on true
   where f.campagne_id = c.id;
  if dl.niveau = 'departement' then
    select count(*) into v_att from public.etablissements where departement_id = dl.departement_id and rattachement_statut = 'verifie';
  else
    select count(*) into v_att from public.inst_departements where region_id = dl.region_id and actif;
  end if;
  return public._inst_consolider(coalesce(v_vers, '{}')) || jsonb_build_object(
    'campagne', public._inst_campagne_json(c), 'attendus', v_att, 'recus', coalesce(array_length(v_vers, 1), 0),
    'manquants', greatest(v_att - coalesce(array_length(v_vers, 1), 0), 0), 'en_correction', coalesce(v_corr, 0),
    'perimetre', dl.nom,
    'detail', (select coalesce(jsonb_agg(jsonb_build_object('fiche_id', f.id, 'nom', coalesce(e.nom, d2.nom), 'statut', f.statut, 'version', v.version,
                 'nb_fiches', v.indicateurs -> 'nb_fiches', 'indicateurs', v.indicateurs -> 'indicateurs') order by coalesce(e.nom, d2.nom)), '[]'::jsonb)
                 from public.inst_fiches f join public.inst_fiche_versions v on v.id = any (coalesce(v_vers, '{}')) and v.fiche_id = f.id
                 left join public.etablissements e on e.id = f.etablissement_id left join public.inst_delegations d2 on d2.id = f.delegation_id));
end $$;

create or replace function public.inst_tableau_region(p_campagne uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger(); dl public.inst_delegations; c public.inst_campagnes; v_l jsonb; v_ech date;
begin
  select * into dl from public.inst_delegations where id = m.delegation_id;
  if dl.niveau <> 'region' then raise exception 'Réservé aux délégations régionales.' using errcode = '42501'; end if;
  c := public._inst_campagne_delegation(p_campagne, dl, 'departement');
  v_ech := public._inst_echeance(c);
  select coalesce(jsonb_agg(x order by x ->> 'departement'), '[]'::jsonb) into v_l from (
    select jsonb_build_object('departement', dp.nom, 'departement_id', dp.id, 'delegation', d.nom, 'delegation_id', d.id,
             'active', d.id is not null and d.actif and exists (select 1 from public.inst_membres mm where mm.delegation_id = d.id and mm.role = 'titulaire' and mm.actif),
             'etablissements', (select count(*) from public.etablissements e where e.departement_id = dp.id and e.rattachement_statut = 'verifie'),
             'fiche_id', f.id, 'statut', case when v.version is null then 'non_publiee' else f.statut end, 'version', v.version, 'publie_le', v.publie_le,
             'en_retard', coalesce(v.en_retard, c.id is not null and public._aujourdhui() > v_ech), 'nb_fiches', v.nb) x
      from public.inst_departements dp
      left join public.inst_delegations d on d.niveau = 'departement' and d.departement_id = dp.id
      left join public.inst_fiches f on f.niveau = 'departement' and f.delegation_id = d.id and f.campagne_id = c.id
      left join lateral (select version, publie_le, en_retard, indicateurs -> 'nb_fiches' nb from public.inst_fiche_versions where fiche_id = f.id and destinataire_id = dl.id order by version desc limit 1) v on true
     where dp.region_id = dl.region_id and dp.actif) z;
  return jsonb_build_object('campagne', case when c.id is not null then public._inst_campagne_json(c) end, 'departements', v_l,
    'compteurs', jsonb_build_object('departements', jsonb_array_length(v_l),
       'delegations_actives', (select count(*) from jsonb_array_elements(v_l) x where (x ->> 'active')::boolean),
       'recues', (select count(*) from jsonb_array_elements(v_l) x where x ->> 'statut' <> 'non_publiee'),
       'en_retard', (select count(*) from jsonb_array_elements(v_l) x where x ->> 'statut' = 'non_publiee' and (x ->> 'en_retard')::boolean),
       'correction', (select count(*) from jsonb_array_elements(v_l) x where x ->> 'statut' in ('correction_demandee', 'corrigee')),
       'examinees', (select count(*) from jsonb_array_elements(v_l) x where x ->> 'statut' = 'examinee')));
end $$;

create or replace function public.inst_synthese_preparer(p_campagne uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger('synthese'); dl public.inst_delegations; c public.inst_campagnes; v_id uuid;
begin
  select * into dl from public.inst_delegations where id = m.delegation_id;
  c := public._inst_campagne_delegation(p_campagne, dl, dl.niveau);
  if c.id is null or not c.ouvert then raise exception 'Campagne fermée ou introuvable.' using errcode = 'P0001'; end if;
  select id into v_id from public.inst_fiches where delegation_id = dl.id and campagne_id = c.id;
  if v_id is not null then return v_id; end if;
  insert into public.inst_fiches (niveau, campagne_id, delegation_id, departement_id, region_id, exercice_libelle, periode, brouillon, maj_par)
  values (dl.niveau, c.id, dl.id, dl.departement_id, dl.region_id, c.exercice_libelle, c.periode,
          jsonb_build_object('responsable', btrim(m.prenom || ' ' || m.nom), 'observations', '', 'difficultes', '', 'recommandations', ''), auth.uid())
  on conflict (delegation_id, campagne_id) where niveau <> 'etablissement' do nothing
  returning id into v_id;
  if v_id is null then return (select id from public.inst_fiches where delegation_id = dl.id and campagne_id = c.id); end if;
  insert into public.inst_fiche_statuts (fiche_id, de, a, par, motif) values (v_id, null, 'brouillon', auth.uid(), 'Création');
  return v_id;
end $$;

create or replace function public.inst_syntheses() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger(); dl public.inst_delegations;
begin
  select * into dl from public.inst_delegations where id = m.delegation_id;
  return (select coalesce(jsonb_agg(public._inst_campagne_json(c) || jsonb_build_object('fiche', (select jsonb_build_object('id', f.id, 'statut', f.statut, 'version', f.version_courante)
             from public.inst_fiches f where f.delegation_id = dl.id and f.campagne_id = c.id)) order by c.exercice_libelle desc, c.periode desc), '[]'::jsonb)
    from public.inst_campagnes c where c.niveau = dl.niveau
     and (public._inst_campagne_applicable(c, dl.departement_id, dl.region_id) or exists (select 1 from public.inst_fiches f where f.delegation_id = dl.id and f.campagne_id = c.id)));
end $$;

create or replace function public.inst_relancer(p_campagne uuid, p_cibles uuid[], p_message text default '') returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger('examen'); dl public.inst_delegations; c public.inst_campagnes; v_n integer := 0; x uuid;
begin
  select * into dl from public.inst_delegations where id = m.delegation_id;
  select * into c from public.inst_campagnes where id = p_campagne;
  if c.id is null then raise exception 'Campagne introuvable.' using errcode = 'P0001'; end if;
  if not public._inst_campagne_applicable(c, dl.departement_id, dl.region_id) then raise exception 'Cette campagne ne concerne pas votre circonscription.' using errcode = '42501'; end if;
  if coalesce(cardinality(p_cibles), 0) > 500 then raise exception 'Cinq cents destinataires au plus par relance.' using errcode = 'P0001'; end if;
  foreach x in array coalesce(p_cibles, '{}') loop
    if dl.niveau = 'departement' and c.niveau = 'etablissement'
       and exists (select 1 from public.etablissements e where e.id = x and e.departement_id = dl.departement_id and e.rattachement_statut = 'verifie') then
      perform public._inst_notifier(x, null, 'relance', 'Relance : fiche statistique ' || upper(c.periode) || ' ' || c.exercice_libelle,
        coalesce(nullif(btrim(p_message), ''), 'Votre délégation départementale attend la publication de votre fiche (échéance : ' || to_char(public._inst_echeance(c), 'DD/MM/YYYY') || ').'),
        '/fiches-statistiques', c.id);
      v_n := v_n + 1;
    elsif dl.niveau = 'region' and c.niveau = 'departement'
       and exists (select 1 from public.inst_delegations d join public.inst_departements dp on dp.id = d.departement_id where d.id = x and dp.region_id = dl.region_id) then
      perform public._inst_notifier(null, x, 'relance', 'Relance : synthèse départementale ' || upper(c.periode) || ' ' || c.exercice_libelle,
        coalesce(nullif(btrim(p_message), ''), 'Votre délégation régionale attend la publication de votre synthèse.'), '/institution/synthese', c.id);
      v_n := v_n + 1;
    else
      raise exception 'Une cible ne relève pas de votre circonscription.' using errcode = '42501';
    end if;
  end loop;
  perform public._inst_journaliser('relance', 'inst_campagne', c.id, jsonb_build_object('cibles', coalesce(array_length(p_cibles, 1), 0)));
  return v_n;
end $$;

-- Alertes quotidiennes : chaque destinataire n'est alerté que pour la campagne qui s'applique à lui.
create or replace function public.inst_alertes_quotidiennes() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare c public.inst_campagnes; v_j integer; v_avant bigint; v_titre text; r record;
begin
  update public.inst_parametres set alertes_le = public._aujourdhui() where id = 1 and alertes_le is distinct from public._aujourdhui();
  if not found then return 0; end if;
  select count(*) into v_avant from public.inst_notifications;
  for c in select * from public.inst_campagnes where ouvert and niveau in ('etablissement', 'departement') loop
    v_j := public._inst_echeance(c) - public._aujourdhui();
    if public._aujourdhui() = c.ouverture then v_titre := 'Ouverture de la campagne';
    elsif v_j = any (c.alertes_jours) then
      v_titre := case when v_j > 1 then 'Échéance dans ' || v_j || ' jours' when v_j = 1 then 'Échéance demain' when v_j = 0 then 'Échéance aujourd''hui'
                      else 'Échéance dépassée' end;
    else continue;
    end if;
    if public._aujourdhui() < c.ouverture then continue; end if;
    if c.niveau = 'etablissement' then
      for r in select e.id from public.etablissements e join public.inst_departements dp on dp.id = e.departement_id
                where e.rattachement_statut = 'verifie' and public._inst_delegation_etablissement(e.id) is not null
                  and public._inst_campagne_applicable(c, e.departement_id, dp.region_id)
                  and not exists (select 1 from public.inst_fiches f where f.etablissement_id = e.id and f.campagne_id = c.id and f.version_courante > 0) loop
        perform public._inst_notifier(r.id, null, 'alerte', v_titre || ' : fiche statistique ' || upper(c.periode) || ' ' || c.exercice_libelle,
          'Échéance : ' || to_char(public._inst_echeance(c), 'DD/MM/YYYY'), '/fiches-statistiques', c.id, 'alerte:' || c.id || ':' || r.id || ':' || public._aujourdhui());
      end loop;
      if v_j = -1 then
        for r in select d.id, count(e.id) n from public.inst_delegations d join public.etablissements e on e.departement_id = d.departement_id and e.rattachement_statut = 'verifie'
                  where d.niveau = 'departement' and d.actif and public._inst_campagne_applicable(c, d.departement_id, d.region_id)
                    and not exists (select 1 from public.inst_fiches f where f.etablissement_id = e.id and f.campagne_id = c.id and f.version_courante > 0)
                  group by d.id loop
          perform public._inst_notifier(null, r.id, 'retard', r.n || ' établissement(s) en retard : ' || upper(c.periode) || ' ' || c.exercice_libelle, '',
            '/institution/retards', c.id, 'retard:' || c.id || ':' || r.id);
        end loop;
      end if;
    else
      for r in select d.id from public.inst_delegations d where d.niveau = 'departement' and d.actif
                  and public._inst_campagne_applicable(c, d.departement_id, d.region_id)
                  and exists (select 1 from public.inst_membres mm where mm.delegation_id = d.id and mm.role = 'titulaire' and mm.actif)
                  and not exists (select 1 from public.inst_fiches f where f.delegation_id = d.id and f.campagne_id = c.id and f.version_courante > 0) loop
        perform public._inst_notifier(null, r.id, 'alerte', v_titre || ' : synthèse départementale ' || upper(c.periode) || ' ' || c.exercice_libelle,
          'Échéance : ' || to_char(public._inst_echeance(c), 'DD/MM/YYYY'), '/institution/synthese', c.id, 'alerte:' || c.id || ':' || r.id || ':' || public._aujourdhui());
      end loop;
    end if;
  end loop;
  return (select count(*) from public.inst_notifications) - v_avant;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 6. IA & API (lecture seule) : seulement les campagnes de la circonscription
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.api_institution(p_cle text, p_outil text, p_args jsonb default '{}') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare a public.inst_acces_ia; m public.inst_membres; dl public.inst_delegations; c public.inst_campagnes; v_res jsonb; v_cat text[];
        v_campagnes jsonb; v_niveau_fiches text;
begin
  if p_cle is null or p_cle !~ '^nxd_[0-9a-f]{48}$' then raise exception 'Clé invalide.' using errcode = '42501'; end if;
  select * into a from public.inst_acces_ia where acces_hash = encode(extensions.digest(p_cle, 'sha256'), 'hex');
  if a.id is null or a.revoque_le is not null or a.expire_le < now() then raise exception 'Clé invalide, expirée ou révoquée.' using errcode = '42501'; end if;
  select * into m from public.inst_membres where id = a.membre_id;
  select * into dl from public.inst_delegations where id = a.delegation_id;
  if not m.actif or not dl.actif or m.delegation_id <> dl.id then raise exception 'Compte de délégation inactif.' using errcode = '42501'; end if;
  if (select count(*) from public.inst_journal where objet = 'mcp' and objet_id = dl.id and le > now() - interval '1 hour') >= 300 then
    raise exception 'Trop de requêtes : réessayez dans une heure.' using errcode = 'P0001';
  end if;
  v_cat := dl.ia_categories;
  update public.inst_acces_ia set dernier_usage = now() where id = a.id;
  v_niveau_fiches := case when dl.niveau = 'departement' then 'etablissement' else 'departement' end;
  if nullif(p_args ->> 'campagne_id', '') is not null then
    select * into c from public.inst_campagnes x where x.id = (p_args ->> 'campagne_id')::uuid and x.niveau = v_niveau_fiches
       and public._inst_campagne_applicable(x, dl.departement_id, dl.region_id);
  elsif nullif(p_args ->> 'periode', '') is not null then
    select * into c from public.inst_campagnes x where x.niveau = v_niveau_fiches and x.periode = p_args ->> 'periode'
       and public._inst_campagne_applicable(x, dl.departement_id, dl.region_id)
       and (nullif(p_args ->> 'annee_scolaire', '') is null or x.exercice_libelle = p_args ->> 'annee_scolaire') order by x.exercice_libelle desc limit 1;
  else
    select * into c from public.inst_campagnes x where x.niveau = v_niveau_fiches and x.ouverture <= public._aujourdhui()
       and public._inst_campagne_applicable(x, dl.departement_id, dl.region_id) order by x.ouverture desc limit 1;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'annee_scolaire', x.exercice_libelle, 'periode', x.periode, 'echeance', public._inst_echeance(x))
           order by x.exercice_libelle desc, x.periode desc), '[]'::jsonb) into v_campagnes from public.inst_campagnes x
   where x.niveau = v_niveau_fiches and public._inst_campagne_applicable(x, dl.departement_id, dl.region_id);

  if p_outil = 'contexte' then
    v_res := jsonb_build_object('delegation', dl.nom, 'niveau', dl.niveau, 'categories_autorisees', v_cat, 'campagnes', v_campagnes,
      'avertissement', 'Données transmises dans NexIA School ; NexIA School n''est pas un service officiel du MINESEC. Lecture seule.');
  elsif c.id is null then
    raise exception 'Aucune campagne correspondante.' using errcode = 'P0001';
  elsif p_outil = 'tableau_de_bord' then
    if not ('statuts' = any (v_cat)) then raise exception 'Catégorie « statuts » non autorisée pour cette délégation.' using errcode = '42501'; end if;
    perform set_config('request.jwt.claim.sub', m.user_id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', m.user_id::text, 'role', 'authenticated')::text, true);
    v_res := case when dl.niveau = 'departement' then public.inst_tableau_departement(c.id) else public.inst_tableau_region(c.id) end;
    v_res := v_res - 'etablissements' - 'departements' || jsonb_build_object('liste',
      (select coalesce(jsonb_agg(jsonb_build_object('nom', coalesce(x ->> 'nom', x ->> 'departement'), 'statut', x ->> 'statut', 'en_retard', x -> 'en_retard',
         'publie_le', coalesce(x -> 'derniere_publication', x -> 'publie_le'))), '[]'::jsonb)
         from jsonb_array_elements(coalesce(v_res -> 'etablissements', v_res -> 'departements')) x));
  elsif p_outil = 'consolidation' then
    if not ('indicateurs' = any (v_cat)) then raise exception 'Catégorie « indicateurs » non autorisée pour cette délégation.' using errcode = '42501'; end if;
    perform set_config('request.jwt.claim.sub', m.user_id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', m.user_id::text, 'role', 'authenticated')::text, true);
    v_res := public.inst_consolidation(c.id);
    if not ('detail_lignes' = any (v_cat)) then v_res := v_res - 'detail' - 'par_discipline'; else
      v_res := jsonb_set(v_res, '{detail}', (select coalesce(jsonb_agg(x - 'fiche_id'), '[]'::jsonb) from jsonb_array_elements(v_res -> 'detail') x));
    end if;
  elsif p_outil = 'detail_fiche' then
    if not ('detail_lignes' = any (v_cat)) then raise exception 'Catégorie « détail des lignes » non autorisée pour cette délégation.' using errcode = '42501'; end if;
    select jsonb_build_object('etablissement', coalesce(e.nom, d2.nom), 'version', v.version, 'publie_le', v.publie_le,
             'indicateurs', case when 'indicateurs' = any (v_cat) then v.indicateurs end,
             'lignes', case when 'noms_enseignants' = any (v_cat) then v.donnees -> 'lignes'
                            else (select coalesce(jsonb_agg(l - 'enseignant'), '[]'::jsonb) from jsonb_array_elements(v.donnees -> 'lignes') l) end)
      into v_res
      from public.inst_fiches f join lateral (select * from public.inst_fiche_versions where fiche_id = f.id and destinataire_id = dl.id order by version desc limit 1) v on true
      left join public.etablissements e on e.id = f.etablissement_id left join public.inst_delegations d2 on d2.id = f.delegation_id
     where f.campagne_id = c.id and (coalesce(e.nom, d2.nom) ilike '%' || coalesce(p_args ->> 'nom', '') || '%') limit 1;
    if v_res is null then raise exception 'Aucune fiche reçue correspondant à ce nom.' using errcode = 'P0001'; end if;
  elsif p_outil = 'courriers' then
    if not ('courriers' = any (v_cat)) then raise exception 'Catégorie « courriers » non autorisée pour cette délégation.' using errcode = '42501'; end if;
    v_res := jsonb_build_object('courriers', (select coalesce(jsonb_agg(jsonb_build_object('reference', k.reference, 'objet', k.objet, 'type', k.type, 'envoye_le', k.envoye_le,
               'date_limite', k.date_limite, 'destinataires', (select count(*) from public.inst_courrier_destinataires where courrier_id = k.id),
               'lus', (select count(*) from public.inst_courrier_destinataires where courrier_id = k.id and lu_le is not null),
               'reponses', (select count(*) from public.inst_courrier_destinataires where courrier_id = k.id and statut = 'repondu')) order by k.envoye_le desc), '[]'::jsonb)
             from (select * from public.inst_courriers where delegation_id = dl.id and statut <> 'brouillon' order by envoye_le desc limit 50) k));
  else
    raise exception 'Outil inconnu.' using errcode = 'P0001';
  end if;
  insert into public.inst_journal (auteur, action, objet, objet_id, details) values (m.user_id, 'appel MCP', 'mcp', dl.id, jsonb_build_object('outil', p_outil, 'campagne', c.id));
  return jsonb_build_object('perimetre', dl.nom, 'periode', case when c.id is not null then upper(c.periode) || ' ' || c.exercice_libelle end,
    'campagne_id', c.id, 'nb_fiches_utilisees', coalesce(v_res -> 'nb_fiches', v_res -> 'compteurs' -> 'publiees', v_res -> 'compteurs' -> 'recues'),
    'lecture_seule', true, 'donnees', v_res);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 7. Accès exceptionnels : accordés et révoqués par la délégation régionale elle-même (titulaire)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.inst_derogations() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger(); dl public.inst_delegations;
begin
  select * into dl from public.inst_delegations where id = m.delegation_id;
  if dl.niveau <> 'region' then raise exception 'Réservé aux délégations régionales.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'peut_modifier', m.role = 'titulaire',
    'derogations', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'etablissement', e.nom, 'departement', coalesce(dp.nom, dpe.nom), 'motif', g.motif,
                       'debut', g.debut, 'fin', g.fin, 'revoquee_le', g.revoquee_le, 'active', g.revoquee_le is null and now() between g.debut and g.fin,
                       'par_console', not exists (select 1 from public.inst_membres mm where mm.user_id = g.accorde_par and mm.delegation_id = dl.id))
                     order by g.cree_le desc), '[]'::jsonb)
                    from public.inst_derogations g left join public.etablissements e on e.id = g.etablissement_id
                    left join public.inst_departements dp on dp.id = g.departement_id left join public.inst_departements dpe on dpe.id = e.departement_id
                   where g.delegation_id = dl.id),
    'departements', (select coalesce(jsonb_agg(jsonb_build_object('id', dp.id, 'nom', dp.nom) order by dp.nom), '[]'::jsonb)
                      from public.inst_departements dp where dp.region_id = dl.region_id and dp.actif),
    'etablissements', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'nom', e.nom, 'departement_id', e.departement_id) order by e.nom), '[]'::jsonb)
                        from public.etablissements e join public.inst_departements dp on dp.id = e.departement_id
                       where dp.region_id = dl.region_id and e.rattachement_statut = 'verifie'));
end $$;

create or replace function public.inst_derogation_accorder(p_departement uuid, p_etablissement uuid, p_jours integer, p_motif text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger(); dl public.inst_delegations; v_dep uuid := p_departement; v_id uuid; v_ddes uuid;
begin
  select * into dl from public.inst_delegations where id = m.delegation_id;
  if dl.niveau <> 'region' then raise exception 'Seule une délégation régionale accorde un accès exceptionnel.' using errcode = '42501'; end if;
  if m.role <> 'titulaire' then raise exception 'Seul le titulaire de la délégation accorde un accès exceptionnel.' using errcode = '42501'; end if;
  if p_etablissement is not null then
    select departement_id into v_dep from public.etablissements where id = p_etablissement and rattachement_statut = 'verifie';
    if v_dep is null or (p_departement is not null and v_dep <> p_departement) then
      raise exception 'Cet établissement ne relève pas (ou pas encore de façon vérifiée) du département choisi.' using errcode = 'P0001';
    end if;
  end if;
  if v_dep is null or not exists (select 1 from public.inst_departements where id = v_dep and region_id = dl.region_id) then
    raise exception 'Choisissez un département ou un établissement de votre région.' using errcode = 'P0001';
  end if;
  -- pas d'accès en double : un accès actif couvrant déjà ce périmètre doit expirer ou être révoqué avant d'en accorder un autre
  if exists (select 1 from public.inst_derogations g where g.delegation_id = dl.id and g.revoquee_le is null and now() between g.debut and g.fin
               and ((g.etablissement_id is null and g.departement_id = v_dep) or (p_etablissement is not null and g.etablissement_id = p_etablissement))) then
    raise exception 'Un accès exceptionnel est déjà actif sur ce périmètre : révoquez-le ou attendez son expiration.' using errcode = 'P0001';
  end if;
  if coalesce(p_jours, 0) not between 1 and 90 then raise exception 'Durée : 1 à 90 jours.' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p_motif, ''))) not between 5 and 500 then raise exception 'Indiquez le motif de l''accès (5 à 500 caractères).' using errcode = 'P0001'; end if;
  insert into public.inst_derogations (delegation_id, etablissement_id, departement_id, motif, fin, accorde_par)
  values (dl.id, p_etablissement, case when p_etablissement is null then v_dep end, btrim(p_motif), now() + make_interval(days => p_jours), auth.uid())
  returning id into v_id;
  -- transparence : la délégation départementale concernée est prévenue
  select id into v_ddes from public.inst_delegations where niveau = 'departement' and departement_id = v_dep and actif;
  if v_ddes is not null then
    perform public._inst_notifier(null, v_ddes, 'derogation', 'Accès exceptionnel de ' || dl.nom || ' (' || p_jours || ' jours)',
      'Périmètre : ' || coalesce((select nom from public.etablissements where id = p_etablissement), 'tout le département') || '. Motif : ' || btrim(p_motif), '', v_id);
  end if;
  perform public._inst_journaliser('dérogation accordée', 'inst_delegation', dl.id,
    jsonb_build_object('derogation', v_id, 'etablissement', p_etablissement, 'departement', v_dep, 'jours', p_jours, 'par', 'délégation régionale'));
  return v_id;
end $$;

create or replace function public.inst_derogation_revoquer(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare m public.inst_membres := public._inst_exiger();
begin
  if m.role <> 'titulaire' then raise exception 'Seul le titulaire de la délégation révoque un accès exceptionnel.' using errcode = '42501'; end if;
  update public.inst_derogations set revoquee_le = now() where id = p_id and delegation_id = m.delegation_id and revoquee_le is null;
  if not found then raise exception 'Accès introuvable ou déjà révoqué.' using errcode = 'P0001'; end if;
  perform public._inst_journaliser('dérogation révoquée', 'inst_derogation', p_id, '{}');
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 8. Établissement : nombre de notifications non lues (administrateurs seulement), pour le menu
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.inst_notifications_non_lues() returns integer
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid;
begin
  if not public.est_admin() then return 0; end if;
  v_etab := public.etab_courant();
  return (select count(*) from public.inst_notifications where etablissement_id = v_etab and lu_le is null);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 9. Droits (même règle que 0055 : fonctions internes jamais exposées)
-- ---------------------------------------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'inst\_%' or p.proname like '\_inst\_%' or p.proname like 'console\_inst\_%'
                  or p.proname = 'api_institution') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname not like '\_%' then execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
grant execute on function public.api_institution(text, text, jsonb) to anon;
grant execute on function public.inst_alertes_quotidiennes() to anon;
grant execute on function public._inst_piece_deposable(text) to authenticated;
grant execute on function public._inst_piece_lisible(text) to authenticated;
