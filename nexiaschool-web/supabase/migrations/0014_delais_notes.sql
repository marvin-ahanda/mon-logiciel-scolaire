-- Délai de saisie des notes par séquence, fixé par l'administration. Une fois le délai passé, les enseignants qui n'ont pas
-- saisi toutes les notes d'une de leurs classes déclenchent une alerte pour toute l'administration (lue / non lue par membre).

alter table public.sequences add column if not exists date_limite_notes date;

create table public.notes_alertes_lues (
  personnel_id uuid not null references public.personnels (id) on delete cascade,
  sequence_id uuid not null references public.sequences (id) on delete cascade,
  date_limite date not null,
  lu_le timestamptz not null default now(),
  primary key (personnel_id, sequence_id, date_limite)
);
alter table public.notes_alertes_lues enable row level security;
revoke all on public.notes_alertes_lues from anon, authenticated;

/**
 * Séquences de l'année active dont le délai de saisie est dépassé (et non verrouillées) avec, pour chacune, les enseignants
 * qui ne sont pas à jour et les classes / matières où des notes manquent. Réservé à l'administration.
 */
create or replace function public.notes_retards() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); ex uuid; jour date := (now() at time zone 'Africa/Douala')::date; r json;
begin
  if not public.est_admin() then return json_build_object('sequences', '[]'::json, 'non_lues', 0); end if;
  select id into ex from public.exercices where etablissement_id = v_etab and actif;
  with seq as (
    select s.id, s.numero, s.trimestre, s.date_limite_notes from public.sequences s
     where s.exercice_id = ex and s.date_limite_notes is not null and s.date_limite_notes < jour and not s.verrouillee),
  eff as (select classe_id, count(*)::int n from public.inscriptions where exercice_id = ex group by classe_id),
  att as (
    select a.id, a.classe_id, a.enseignant_id, c.libelle classe, c.ordre classe_ordre, m.code, m.libelle matiere, eff.n effectif
      from public.attributions a join public.classes c on c.id = a.classe_id join public.matieres m on m.id = a.matiere_id
      join eff on eff.classe_id = a.classe_id
     where a.exercice_id = ex and eff.n > 0),
  manque as (
    select seq.id sequence_id, att.*, (select count(*)::int from public.notes n join public.inscriptions i on i.id = n.inscription_id
                                        where n.attribution_id = att.id and n.sequence_id = seq.id and i.classe_id = att.classe_id) saisies
      from seq cross join att),
  retard as (select * from manque where saisies < effectif),
  par_ens as (
    select r.sequence_id, r.enseignant_id, p.nom, p.prenom, p.role, p.telephone,
           json_agg(json_build_object('classe', r.classe, 'code', r.code, 'matiere', r.matiere, 'saisies', r.saisies, 'effectif', r.effectif)
                    order by r.classe_ordre, r.classe, r.code) classes,
           sum(r.effectif - r.saisies)::int manquantes
      from retard r join public.personnels p on p.id = r.enseignant_id group by r.sequence_id, r.enseignant_id, p.nom, p.prenom, p.role, p.telephone),
  s2 as (
    select seq.*, exists (select 1 from public.notes_alertes_lues l where l.personnel_id = auth.uid() and l.sequence_id = seq.id
                           and l.date_limite = seq.date_limite_notes) lue
      from seq where exists (select 1 from par_ens where par_ens.sequence_id = seq.id))
  select json_build_object('aujourdhui', jour,
    'non_lues', (select count(*) from s2 where not lue),
    'sequences', coalesce((select json_agg(json_build_object('sequence_id', s2.id, 'numero', s2.numero, 'trimestre', s2.trimestre,
        'date_limite', s2.date_limite_notes, 'jours_retard', jour - s2.date_limite_notes, 'lue', s2.lue,
        'enseignants', (select json_agg(json_build_object('enseignant_id', e.enseignant_id, 'nom', e.nom, 'prenom', e.prenom, 'role', e.role,
                                                          'telephone', e.telephone, 'manquantes', e.manquantes, 'classes', e.classes)
                                        order by e.nom, e.prenom) from par_ens e where e.sequence_id = s2.id),
        'sans_enseignant', coalesce((select json_agg(json_build_object('classe', r.classe, 'code', r.code, 'matiere', r.matiere, 'saisies', r.saisies,
                                                                      'effectif', r.effectif) order by r.classe_ordre, r.classe, r.code)
                                     from retard r where r.sequence_id = s2.id and r.enseignant_id is null), '[]'::json))
        order by s2.numero) from s2), '[]'::json))
    into r;
  return r;
end $$;

create or replace function public.notes_marquer_alertes_lues() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare s json;
begin
  if not public.est_admin() then raise exception 'Réservé à l''administration de l''établissement.' using errcode = '42501'; end if;
  for s in select * from json_array_elements(public.notes_retards() -> 'sequences') loop
    insert into public.notes_alertes_lues (personnel_id, sequence_id, date_limite)
    values (auth.uid(), (s ->> 'sequence_id')::uuid, (s ->> 'date_limite')::date) on conflict do nothing;
  end loop;
end $$;

revoke execute on function public.notes_retards(), public.notes_marquer_alertes_lues() from public, anon, authenticated;
grant execute on function public.notes_retards(), public.notes_marquer_alertes_lues() to authenticated;
