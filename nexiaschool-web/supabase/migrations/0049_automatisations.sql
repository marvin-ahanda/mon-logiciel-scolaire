-- Automatisations personnelles (catalogue guidé) — offre Premium (fonctionnalité « ia »).
-- Chaque membre du personnel décrit en langage naturel ce qu'il veut automatiser ; l'application le traduit en une règle tirée
-- d'un catalogue d'actions sûres (src/lib/automatisations.js), la montre, puis l'enregistre ici pour SON seul compte.
-- La base revérifie tout (action autorisée pour le rôle, fréquence, destinataire) et exécute les règles côté serveur, chaque heure
-- (Worker planifié), avec les droits de leur auteur : un enseignant ne reçoit que les données de ses classes.
-- Destinataires : soi-même, ou la direction (membres de l'administration). Les rapports arrivent dans la boîte
-- « Rapports reçus » de l'application. Aucune règle propre à un établissement n'est codée en dur.

create table if not exists public.automatisations (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  personnel_id uuid not null references public.personnels (id) on delete cascade,
  libelle text not null default '' check (char_length(libelle) <= 120),
  texte_source text not null default '' check (char_length(texte_source) <= 1000),        -- la demande telle qu'écrite
  action text not null check (action in ('rapport_absences', 'rapport_saisie', 'rapport_discipline', 'rapport_paiements', 'rapport_impayes', 'rappel')),
  parametres jsonb not null default '{}'::jsonb check (jsonb_typeof(parametres) = 'object' and pg_column_size(parametres) <= 4000),
  frequence jsonb not null check (jsonb_typeof(frequence) = 'object'),
  destinataire text not null default 'moi' check (destinataire in ('moi', 'direction')),
  active boolean not null default true,
  prochaine_execution timestamptz,
  derniere_execution timestamptz,
  derniere_erreur text not null default '',
  cree_le timestamptz not null default now(),
  maj timestamptz not null default now()
);
create index if not exists automatisations_dues on public.automatisations (prochaine_execution) where active;
create index if not exists automatisations_personnel on public.automatisations (personnel_id);

create table if not exists public.automatisations_rapports (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  automatisation_id uuid references public.automatisations (id) on delete set null,
  auteur_id uuid references public.personnels (id) on delete set null,
  auteur text not null default '',
  destinataire_id uuid not null references public.personnels (id) on delete cascade,
  action text not null,
  titre text not null,
  contenu jsonb not null,
  cree_le timestamptz not null default now(),
  lu_le timestamptz
);
create index if not exists automatisations_rapports_dest on public.automatisations_rapports (destinataire_id, cree_le desc);

alter table public.automatisations enable row level security;
alter table public.automatisations_rapports enable row level security;
create policy "les siennes" on public.automatisations for select to authenticated
  using (personnel_id = (select auth.uid()) and etablissement_id = (select public.etab_courant()));
create policy "ceux qu'on reçoit" on public.automatisations_rapports for select to authenticated
  using (destinataire_id = (select auth.uid()) and etablissement_id = (select public.etab_courant()));
revoke all on public.automatisations, public.automatisations_rapports from anon, authenticated;
grant select on public.automatisations, public.automatisations_rapports to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Règles
-- ---------------------------------------------------------------------------------------------------------

/** Rôles autorisés pour chaque action (même catalogue que src/lib/automatisations.js). */
create or replace function public._auto_action_permise(p_action text, p_role text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_action
    when 'rapport_absences' then p_role in ('admin', 'surveillant', 'enseignant')
    when 'rapport_saisie' then p_role in ('admin', 'enseignant')
    when 'rapport_discipline' then p_role in ('admin', 'surveillant')
    when 'rapport_paiements' then p_role in ('admin', 'comptable')
    when 'rapport_impayes' then p_role in ('admin', 'comptable')
    when 'rappel' then p_role in ('admin', 'surveillant', 'enseignant', 'comptable')
    else false end
$$;

/** Fréquence normalisée et validée : { type: quotidien | hebdo | mensuel, jours: [1..7], jour_mois: 1..31, heure: HH:MM }. */
create or replace function public._auto_frequence(f jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v_type text := f->>'type'; v_jours jsonb; v_heure text := coalesce(f->>'heure', '07:00');
begin
  if v_type not in ('quotidien', 'hebdo', 'mensuel') then raise exception 'Fréquence inconnue.' using errcode = '22023'; end if;
  if v_heure !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Heure invalide (HH:MM).' using errcode = '22023'; end if;
  if v_type = 'mensuel' then
    if coalesce(f->>'jour_mois', '') !~ '^([1-9]|[12][0-9]|3[01])$' then raise exception 'Jour du mois : de 1 à 31.' using errcode = '22023'; end if;
    return jsonb_build_object('type', 'mensuel', 'jours', '[]'::jsonb, 'jour_mois', (f->>'jour_mois')::int, 'heure', v_heure);
  end if;
  select coalesce(jsonb_agg(distinct (x #>> '{}')::int order by (x #>> '{}')::int), '[]'::jsonb) into v_jours
    from jsonb_array_elements(case when jsonb_typeof(f->'jours') = 'array' then f->'jours' else '[]'::jsonb end) x
   where (x #>> '{}') ~ '^[1-7]$';
  if jsonb_array_length(v_jours) = 0 then
    if v_type = 'hebdo' then raise exception 'Choisissez au moins un jour de la semaine.' using errcode = '22023'; end if;
    v_jours := '[1,2,3,4,5,6,7]'::jsonb;
  end if;
  return jsonb_build_object('type', v_type, 'jours', v_jours, 'jour_mois', null, 'heure', v_heure);
end $$;

/** Prochaine exécution (heure de Douala) strictement après p_apres. */
create or replace function public._auto_prochaine(f jsonb, p_apres timestamptz) returns timestamptz
language plpgsql stable set search_path = '' as $$
declare d date := (p_apres at time zone 'Africa/Douala')::date; k int; j date; quand timestamptz; dernier int;
begin
  for k in 0 .. 70 loop
    j := d + k;
    dernier := extract(day from (date_trunc('month', j) + interval '1 month - 1 day'))::int;
    if (f->>'type' = 'mensuel' and extract(day from j)::int = least((f->>'jour_mois')::int, dernier))
       or (f->>'type' <> 'mensuel' and (f->'jours') @> to_jsonb(extract(isodow from j)::int)) then
      quand := (j + (f->>'heure')::time) at time zone 'Africa/Douala';
      if quand > p_apres then return quand; end if;
    end if;
  end loop;
  return null;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Contenu des rapports (droits de l'auteur)
-- ---------------------------------------------------------------------------------------------------------

/** Classes visibles par l'auteur : toutes (administration, surveillance, comptabilité) ou celles de l'enseignant. */
create or replace function public._auto_classes(p_etab uuid, p_personnel uuid, p_role text) returns table (classe_id uuid)
language sql stable security definer set search_path = '' as $$
  select c.id from public.classes c where c.etablissement_id = p_etab and (p_role <> 'enseignant' or exists (
    select 1 from public.attributions a join public.exercices x on x.id = a.exercice_id and x.actif
     where a.classe_id = c.id and a.enseignant_id = p_personnel))
$$;

create or replace function public._auto_contenu(a public.automatisations, p_role text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare jour date := public._aujourdhui(); fin date; debut date; ex uuid; r jsonb;
begin
  -- avant midi, la période se termine la veille (un rapport du matin porte sur la journée écoulée) ; à partir de midi, aujourd'hui inclus
  fin := case when extract(hour from now() at time zone 'Africa/Douala') < 12 then jour - 1 else jour end;
  debut := case coalesce(a.parametres->>'periode', 'jour') when 'semaine' then fin - 6 when 'mois' then fin - 29 else fin end;
  select id into ex from public.exercices where etablissement_id = a.etablissement_id and actif;
  if a.action = 'rappel' then
    return jsonb_build_object('texte', coalesce(a.parametres->>'texte', ''));
  elsif a.action = 'rapport_absences' then
    with abs as (select ab.*, i.classe_id, i.eleve_id from public.absences ab join public.inscriptions i on i.id = ab.inscription_id
                  where ab.etablissement_id = a.etablissement_id and ab.date between debut and fin
                    and i.classe_id in (select classe_id from public._auto_classes(a.etablissement_id, a.personnel_id, p_role))),
         ret as (select rt.*, i.classe_id, i.eleve_id from public.retards rt join public.inscriptions i on i.id = rt.inscription_id
                  where rt.etablissement_id = a.etablissement_id and rt.date between debut and fin
                    and i.classe_id in (select classe_id from public._auto_classes(a.etablissement_id, a.personnel_id, p_role)))
    select jsonb_build_object('du', debut, 'au', fin,
      'heures_non_justifiees', coalesce((select sum(heures_non_justifiees) from abs), 0), 'heures_justifiees', coalesce((select sum(heures_justifiees) from abs), 0),
      'eleves_absents', (select count(distinct eleve_id) from abs), 'retards', (select count(*) from ret),
      'par_classe', (select coalesce(jsonb_agg(jsonb_build_object('classe', c.libelle, 'heures_nj', x.nj, 'heures_j', x.j, 'eleves', x.n) order by c.ordre, c.libelle), '[]'::jsonb)
                       from (select classe_id, sum(heures_non_justifiees) nj, sum(heures_justifiees) j, count(distinct eleve_id) n from abs group by classe_id) x
                       join public.classes c on c.id = x.classe_id),
      'eleves', (select coalesce(jsonb_agg(jsonb_build_object('eleve', public._libelle(e.nom, e.prenom), 'classe', c.libelle, 'heures_nj', x.nj, 'heures_j', x.j) order by x.nj desc, e.nom), '[]'::jsonb)
                   from (select eleve_id, classe_id, sum(heures_non_justifiees) nj, sum(heures_justifiees) j from abs group by eleve_id, classe_id order by 3 desc limit 30) x
                   join public.eleves e on e.id = x.eleve_id join public.classes c on c.id = x.classe_id))
    into r;
  elsif a.action = 'rapport_saisie' then
    if not exists (select 1 from public.sequences s where s.exercice_id = ex and not s.verrouillee) then
      return jsonb_build_object('sequence', null, 'lignes', '[]'::jsonb, 'total_manquantes', 0);   -- aucune séquence ouverte : rien à saisir
    end if;
    with seq as (select s.id, s.numero from public.sequences s where s.exercice_id = ex and not s.verrouillee order by s.numero limit 1),
         att as (select at.id, at.classe_id, m.libelle matiere, public._libelle(p.nom, p.prenom) enseignant
                   from public.attributions at join public.matieres m on m.id = at.matiere_id left join public.personnels p on p.id = at.enseignant_id
                  where at.exercice_id = ex and (p_role <> 'enseignant' or at.enseignant_id = a.personnel_id)),
         manq as (select att.*, (select count(*) from public.inscriptions i where i.classe_id = att.classe_id and i.exercice_id = ex)
                          - (select count(*) from public.notes n where n.attribution_id = att.id and n.sequence_id = (select id from seq)) manquantes
                    from att)
    select jsonb_build_object('sequence', (select numero from seq),
      'lignes', (select coalesce(jsonb_agg(jsonb_build_object('classe', c.libelle, 'matiere', m.matiere, 'enseignant', m.enseignant, 'notes_manquantes', m.manquantes)
                   order by m.manquantes desc, c.libelle), '[]'::jsonb) from manq m join public.classes c on c.id = m.classe_id where m.manquantes > 0),
      'total_manquantes', coalesce((select sum(manquantes) from manq where manquantes > 0), 0))
    into r;
  elsif a.action = 'rapport_discipline' then
    select jsonb_build_object('du', debut, 'au', fin,
      'incidents', (select coalesce(jsonb_agg(jsonb_build_object('date', d.date, 'eleve', public._libelle(e.nom, e.prenom), 'classe', c.libelle, 'infraction', f.libelle,
                       'observation', d.observation) order by d.date desc), '[]'::jsonb)
                      from public.incidents d join public.inscriptions i on i.id = d.inscription_id join public.eleves e on e.id = i.eleve_id
                      join public.classes c on c.id = i.classe_id join public.infractions f on f.id = d.infraction_id
                     where d.etablissement_id = a.etablissement_id and d.date between debut and fin))
    into r;
  elsif a.action = 'rapport_paiements' then
    select jsonb_build_object('du', debut, 'au', fin, 'nombre', count(*), 'total', coalesce(sum(p.montant), 0), 'devise', 'FCFA',
      'par_mode', (select coalesce(jsonb_object_agg(z.mode, z.s), '{}'::jsonb) from (select mode, sum(montant) s from public.paiements
                     where etablissement_id = a.etablissement_id and date_paiement between debut and fin group by mode) z))
      into r from public.paiements p where p.etablissement_id = a.etablissement_id and p.date_paiement between debut and fin;
  elsif a.action = 'rapport_impayes' then
    with t as (select s.inscription_id, sum(s.reste) filter (where s.date_limite < jour) echu from public._tranches_situation(a.etablissement_id, jour) s
                 where public._relance_exclusion(s.inscription_id, jour) is null group by s.inscription_id)   -- bourses, exonérations, accords, moratoires exclus
    select jsonb_build_object('au', jour, 'devise', 'FCFA', 'eleves_non_en_regle', count(*) filter (where echu > 0), 'montant_en_retard', coalesce(sum(echu), 0),
      'eleves', (select coalesce(jsonb_agg(jsonb_build_object('eleve', public._libelle(e.nom, e.prenom), 'classe', c.libelle, 'en_retard', z.echu) order by z.echu desc), '[]'::jsonb)
                   from (select * from t where echu > 0 order by echu desc limit 40) z join public.inscriptions i on i.id = z.inscription_id
                   join public.eleves e on e.id = i.eleve_id join public.classes c on c.id = i.classe_id))
      into r from t;
  end if;
  return r;
end $$;

/** Exécute une automatisation : rapport au(x) destinataire(s), prochaine exécution. Erreur notée sur la règle. */
create or replace function public._auto_executer(p_id uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare a public.automatisations; v_role text; v_nom text; c jsonb; n int := 0; titres jsonb := jsonb_build_object(
  'rapport_absences', 'Rapport des absences et retards', 'rapport_saisie', 'Rapport des notes non saisies', 'rapport_discipline', 'Rapport des incidents de discipline',
  'rapport_paiements', 'Rapport des paiements encaissés', 'rapport_impayes', 'Rapport des élèves non en règle', 'rappel', 'Rappel');
begin
  select * into a from public.automatisations where id = p_id for update;
  if a.id is null then return 0; end if;
  select p.role, public._libelle(p.nom, p.prenom) into v_role, v_nom from public.personnels p join public.etablissements e on e.id = p.etablissement_id
   where p.id = a.personnel_id and p.actif and e.suspendu_le is null and p.etablissement_id = a.etablissement_id;
  begin
    if v_role is null or not public._offre_inclut(a.etablissement_id, 'ia') then
      update public.automatisations set active = false, derniere_erreur = 'Compte inactif ou offre sans automatisations : règle mise en pause.' where id = a.id;
      return 0;
    end if;
    if not public._auto_action_permise(a.action, v_role) then raise exception 'Cette action n''est plus permise pour votre rôle.'; end if;
    c := public._auto_contenu(a, v_role);
    insert into public.automatisations_rapports (etablissement_id, automatisation_id, auteur_id, auteur, destinataire_id, action, titre, contenu)
    select a.etablissement_id, a.id, a.personnel_id, coalesce(v_nom, ''), d.id, a.action,
           left(coalesce(nullif(a.libelle, ''), titres->>a.action), 200), coalesce(c, '{}'::jsonb)
      from (select a.personnel_id id where a.destinataire = 'moi'
            union select p.id from public.personnels p where a.destinataire = 'direction' and p.etablissement_id = a.etablissement_id and p.actif and p.role = 'admin') d;
    get diagnostics n = row_count;
    update public.automatisations set derniere_execution = now(), derniere_erreur = '',
      prochaine_execution = public._auto_prochaine(frequence, greatest(now(), coalesce(prochaine_execution, now()))) where id = a.id;
  exception when others then
    update public.automatisations set derniere_erreur = left(sqlerrm, 300),
      prochaine_execution = public._auto_prochaine(frequence, greatest(now(), coalesce(prochaine_execution, now()))) where id = a.id;
  end;
  -- ménage : rapports reçus gardés 180 jours
  delete from public.automatisations_rapports where etablissement_id = a.etablissement_id and cree_le < now() - interval '180 days';
  return n;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Fonctions du personnel
-- ---------------------------------------------------------------------------------------------------------

/** Enregistre (ou modifie) une automatisation de l'utilisateur connecté. p = { id?, libelle, texte_source, action, parametres,
 *  frequence, destinataire, active } */
create or replace function public.automatisation_enregistrer(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); v_role text := public._mon_role(); v_id uuid; f jsonb; v_par jsonb := '{}'::jsonb; r public.automatisations;
begin
  if v_role is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  perform public._exiger_offre(v_etab, 'ia');
  if not public._auto_action_permise(p->>'action', v_role) then
    raise exception 'Cette action n''est pas permise pour votre rôle.' using errcode = '42501';
  end if;
  f := public._auto_frequence(coalesce(p->'frequence', '{}'::jsonb));
  if coalesce(p->>'destinataire', 'moi') not in ('moi', 'direction') then raise exception 'Destinataire : vous-même ou la direction.' using errcode = '22023'; end if;
  if p->>'action' = 'rappel' then
    if char_length(btrim(coalesce(p->'parametres'->>'texte', ''))) not between 2 and 300 then raise exception 'Texte du rappel : 2 à 300 caractères.' using errcode = '22023'; end if;
    v_par := jsonb_build_object('texte', btrim(p->'parametres'->>'texte'));
    p := p || '{"destinataire": "moi"}'::jsonb;                    -- un rappel personnel reste personnel
  else
    if coalesce(p->'parametres'->>'periode', 'jour') not in ('jour', 'semaine', 'mois') then raise exception 'Période : jour, semaine ou mois.' using errcode = '22023'; end if;
    v_par := jsonb_build_object('periode', coalesce(p->'parametres'->>'periode', 'jour'));
  end if;
  v_id := nullif(p->>'id', '')::uuid;
  if v_id is null then
    if (select count(*) from public.automatisations where personnel_id = auth.uid()) >= 20 then
      raise exception 'Vingt automatisations au plus par personne.' using errcode = 'P0001';
    end if;
    insert into public.automatisations (etablissement_id, personnel_id, libelle, texte_source, action, parametres, frequence, destinataire, active, prochaine_execution)
    values (v_etab, auth.uid(), left(btrim(coalesce(p->>'libelle', '')), 120), left(coalesce(p->>'texte_source', ''), 1000), p->>'action', v_par, f,
            coalesce(p->>'destinataire', 'moi'), coalesce((p->>'active')::boolean, true), public._auto_prochaine(f, now()))
    returning * into r;
  else
    update public.automatisations set libelle = left(btrim(coalesce(p->>'libelle', '')), 120), texte_source = left(coalesce(p->>'texte_source', texte_source), 1000),
      action = p->>'action', parametres = v_par, frequence = f, destinataire = coalesce(p->>'destinataire', 'moi'),
      active = coalesce((p->>'active')::boolean, active), prochaine_execution = public._auto_prochaine(f, now()), derniere_erreur = '', maj = now()
     where id = v_id and personnel_id = auth.uid() returning * into r;
    if r.id is null then raise exception 'Automatisation introuvable.' using errcode = 'P0001'; end if;
  end if;
  return to_jsonb(r);
exception when invalid_text_representation then raise exception 'Automatisation introuvable.' using errcode = 'P0001';
end $$;

create or replace function public.automatisation_activer(p_id uuid, p_active boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_active then perform public._exiger_offre(public.etab_courant(), 'ia'); end if;
  update public.automatisations set active = coalesce(p_active, false), derniere_erreur = '',
    prochaine_execution = case when p_active then public._auto_prochaine(frequence, now()) else prochaine_execution end
   where id = p_id and personnel_id = auth.uid();
  if not found then raise exception 'Automatisation introuvable.' using errcode = 'P0001'; end if;
end $$;

create or replace function public.automatisation_supprimer(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from public.automatisations where id = p_id and personnel_id = auth.uid();
  if not found then raise exception 'Automatisation introuvable.' using errcode = 'P0001'; end if;
end $$;

/** Exécute tout de suite une automatisation de l'utilisateur (essai) ; la planification suivante est conservée. */
create or replace function public.automatisation_executer_maintenant(p_id uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare v_prochaine timestamptz; n int;
begin
  perform public._exiger_offre(public.etab_courant(), 'ia');
  select prochaine_execution into v_prochaine from public.automatisations where id = p_id and personnel_id = auth.uid();
  if not found then raise exception 'Automatisation introuvable.' using errcode = 'P0001'; end if;
  if (select count(*) from public.automatisations_rapports where auteur_id = auth.uid() and cree_le > now() - interval '1 hour') >= 30
     or (select derniere_execution > now() - interval '1 minute' from public.automatisations where id = p_id) then
    raise exception 'Trop d''essais : réessayez dans une heure.' using errcode = 'P0001';
  end if;
  n := public._auto_executer(p_id);
  update public.automatisations set prochaine_execution = v_prochaine where id = p_id;
  return n;
end $$;

create or replace function public.rapport_marquer_lu(p_id uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update public.automatisations_rapports set lu_le = coalesce(lu_le, now()) where id = p_id and destinataire_id = auth.uid()
$$;

/** Exécution des automatisations dues (appelée chaque heure par le Worker planifié) : compteurs seulement. */
create or replace function public.automatisations_executer() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare x record; n int := 0; rapports int := 0;
begin
  for x in select id from public.automatisations where active and prochaine_execution <= now() order by prochaine_execution limit 500 for update skip locked loop
    rapports := rapports + public._auto_executer(x.id);
    n := n + 1;
  end loop;
  return jsonb_build_object('automatisations', n, 'rapports', rapports);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------------------------------------------------------
revoke execute on function public._auto_action_permise(text, text), public._auto_frequence(jsonb), public._auto_prochaine(jsonb, timestamptz),
  public._auto_classes(uuid, uuid, text), public._auto_contenu(public.automatisations, text), public._auto_executer(uuid) from public, anon, authenticated;
revoke execute on function public.automatisation_enregistrer(jsonb), public.automatisation_activer(uuid, boolean), public.automatisation_supprimer(uuid),
  public.automatisation_executer_maintenant(uuid), public.rapport_marquer_lu(uuid), public.automatisations_executer() from public, anon;
grant execute on function public.automatisation_enregistrer(jsonb), public.automatisation_activer(uuid, boolean), public.automatisation_supprimer(uuid),
  public.automatisation_executer_maintenant(uuid), public.rapport_marquer_lu(uuid) to authenticated;
-- exécution horaire : Worker planifié avec la clé publique (ne traite que les règles dues, ne renvoie que des compteurs)
grant execute on function public.automatisations_executer() to anon;
