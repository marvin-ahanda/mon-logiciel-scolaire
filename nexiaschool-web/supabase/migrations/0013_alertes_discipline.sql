-- Alertes de discipline : le surveillant général (ou l'administration) fixe des seuils pour l'année en cours ;
-- dès qu'un élève les atteint (heures d'absence non justifiées cumulées, nombre de sanctions d'un type : blâmes,
-- avertissements…), une alerte est notifiée à toute l'administration et à tous les surveillants. Chaque membre a ses
-- alertes lues / non lues.

create table public.seuils_discipline (
  etablissement_id uuid primary key default public.etab_courant() references public.etablissements (id) on delete cascade,
  heures_non_justifiees smallint check (heures_non_justifiees between 1 and 1000),      -- null : pas d'alerte sur les absences
  maj timestamptz not null default now(),
  maj_par uuid
);
create table public.seuils_sanctions (
  sanction_id uuid primary key,
  etablissement_id uuid not null default public.etab_courant(),
  seuil smallint not null check (seuil between 1 and 100),
  foreign key (sanction_id, etablissement_id) references public.sanctions (id, etablissement_id) on delete cascade
);
alter table public.seuils_discipline enable row level security;
alter table public.seuils_sanctions enable row level security;
create policy "lecture" on public.seuils_discipline for select to authenticated using (etablissement_id = (select public.etab_courant()));
create policy "lecture" on public.seuils_sanctions for select to authenticated using (etablissement_id = (select public.etab_courant()));
grant select on public.seuils_discipline, public.seuils_sanctions to authenticated;   -- écriture : fonction ci-dessous

create table public.discipline_alertes_lues (
  personnel_id uuid not null references public.personnels (id) on delete cascade,
  inscription_id uuid not null references public.inscriptions (id) on delete cascade,
  motif text not null,                      -- « heures » ou identifiant de la sanction
  seuil smallint not null,
  lu_le timestamptz not null default now(),
  primary key (personnel_id, inscription_id, motif, seuil)
);
alter table public.discipline_alertes_lues enable row level security;
revoke all on public.discipline_alertes_lues from anon, authenticated;

/** Enregistre les seuils (administration ou surveillant général). p_sanctions : [{ sanction_id, seuil }] (seuil vide = pas d'alerte). */
create or replace function public.discipline_enregistrer_seuils(p_heures int, p_sanctions jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); l jsonb;
begin
  if not public.peut_discipline() then
    raise exception 'Réservé au surveillant général et à l''administration.' using errcode = '42501';
  end if;
  if p_heures is not null and p_heures not between 1 and 1000 then
    raise exception 'Seuil d''heures d''absence : nombre entier de 1 à 1000.' using errcode = 'P0001';
  end if;
  insert into public.seuils_discipline (etablissement_id, heures_non_justifiees, maj, maj_par) values (v_etab, p_heures, now(), auth.uid())
  on conflict (etablissement_id) do update set heures_non_justifiees = excluded.heures_non_justifiees, maj = now(), maj_par = auth.uid();
  delete from public.seuils_sanctions where etablissement_id = v_etab;
  for l in select * from jsonb_array_elements(coalesce(p_sanctions, '[]')) loop
    if nullif(l ->> 'seuil', '') is null then continue; end if;
    if (l ->> 'seuil')::int not between 1 and 100 then
      raise exception 'Seuil de sanctions : nombre entier de 1 à 100.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.sanctions where id = (l ->> 'sanction_id')::uuid and etablissement_id = v_etab) then
      raise exception 'Sanction inconnue.' using errcode = 'P0001';
    end if;
    insert into public.seuils_sanctions (sanction_id, etablissement_id, seuil) values ((l ->> 'sanction_id')::uuid, v_etab, (l ->> 'seuil')::int);
  end loop;
end $$;

/**
 * Élèves de l'année active qui atteignent au moins un seuil, avec leur situation et les motifs de l'alerte.
 * Une alerte (élève, motif, seuil) est « nouvelle » tant que le membre connecté ne l'a pas ouverte.
 */
create or replace function public.discipline_alertes() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); ex uuid; h int; r json;
begin
  if not public.peut_discipline() then return json_build_object('eleves', '[]'::json, 'non_lues', 0, 'configure', false); end if;
  select id into ex from public.exercices where etablissement_id = v_etab and actif;
  select heures_non_justifiees into h from public.seuils_discipline where etablissement_id = v_etab;
  if ex is null or (h is null and not exists (select 1 from public.seuils_sanctions where etablissement_id = v_etab)) then
    return json_build_object('eleves', '[]'::json, 'non_lues', 0, 'configure', ex is not null and h is not null);
  end if;
  with ins as (
    select i.id, el.matricule, el.nom, el.prenom, el.sexe, c.libelle classe, c.ordre classe_ordre
      from public.inscriptions i join public.eleves el on el.id = i.eleve_id join public.classes c on c.id = i.classe_id
     where i.exercice_id = ex),
  abs as (select inscription_id, sum(heures_non_justifiees)::int nj, sum(heures_justifiees)::int j from public.absences
           where inscription_id in (select id from ins) group by inscription_id),
  ret as (select inscription_id, count(*)::int n from public.retards where inscription_id in (select id from ins) group by inscription_id),
  san as (select x.inscription_id, f.sanction_id, s.libelle, count(*)::int n
            from public.incidents x join public.infractions f on f.id = x.infraction_id join public.sanctions s on s.id = f.sanction_id
           where x.inscription_id in (select id from ins) group by x.inscription_id, f.sanction_id, s.libelle),
  motifs as (
    select ins.id inscription_id, 'heures'::text motif, null::text libelle, coalesce(abs.nj, 0) valeur, h seuil
      from ins left join abs on abs.inscription_id = ins.id where h is not null and coalesce(abs.nj, 0) >= h
    union all
    select san.inscription_id, san.sanction_id::text, san.libelle, san.n, ss.seuil
      from san join public.seuils_sanctions ss on ss.sanction_id = san.sanction_id where san.n >= ss.seuil),
  m2 as (
    select m.*, exists (select 1 from public.discipline_alertes_lues l where l.personnel_id = auth.uid() and l.inscription_id = m.inscription_id
                         and l.motif = m.motif and l.seuil = m.seuil) lue from motifs m)
  select json_build_object('configure', true,
    'seuils', json_build_object('heures', h, 'sanctions', (select coalesce(json_agg(json_build_object('sanction_id', ss.sanction_id, 'libelle', s.libelle, 'seuil', ss.seuil)
                                                                                 order by s.libelle), '[]'::json)
                                                          from public.seuils_sanctions ss join public.sanctions s on s.id = ss.sanction_id
                                                         where ss.etablissement_id = v_etab)),
    'non_lues', (select count(distinct inscription_id) from m2 where not lue),
    'eleves', coalesce((select json_agg(json_build_object(
        'inscription_id', ins.id, 'matricule', ins.matricule, 'nom', ins.nom, 'prenom', ins.prenom, 'sexe', ins.sexe, 'classe', ins.classe,
        'heures_nj', coalesce(abs.nj, 0), 'heures_j', coalesce(abs.j, 0), 'retards', coalesce(ret.n, 0),
        'sanctions', coalesce((select json_agg(json_build_object('libelle', san.libelle, 'nombre', san.n) order by san.libelle) from san where san.inscription_id = ins.id), '[]'::json),
        'motifs', (select json_agg(json_build_object('motif', m2.motif, 'libelle', m2.libelle, 'valeur', m2.valeur, 'seuil', m2.seuil, 'lue', m2.lue)
                                   order by m2.motif = 'heures' desc, m2.libelle) from m2 where m2.inscription_id = ins.id),
        'nouvelle', exists (select 1 from m2 where m2.inscription_id = ins.id and not m2.lue))
        order by ins.classe_ordre, ins.classe, ins.nom, ins.prenom)
      from ins left join abs on abs.inscription_id = ins.id left join ret on ret.inscription_id = ins.id
     where ins.id in (select inscription_id from m2)), '[]'::json))
    into r;
  return r;
end $$;

create or replace function public.discipline_marquer_alertes_lues() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare e json; m json;
begin
  if not public.peut_discipline() then
    raise exception 'Réservé au surveillant général et à l''administration.' using errcode = '42501';
  end if;
  for e in select * from json_array_elements(public.discipline_alertes() -> 'eleves') loop
    for m in select * from json_array_elements(e -> 'motifs') loop
      insert into public.discipline_alertes_lues (personnel_id, inscription_id, motif, seuil)
      values (auth.uid(), (e ->> 'inscription_id')::uuid, m ->> 'motif', (m ->> 'seuil')::int) on conflict do nothing;
    end loop;
  end loop;
end $$;

revoke execute on function public.discipline_enregistrer_seuils(int, jsonb), public.discipline_alertes(), public.discipline_marquer_alertes_lues()
  from public, anon, authenticated;
grant execute on function public.discipline_enregistrer_seuils(int, jsonb), public.discipline_alertes(), public.discipline_marquer_alertes_lues()
  to authenticated;
