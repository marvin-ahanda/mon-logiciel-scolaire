-- Discipline : sanctions, infractions, barème de la note de discipline, absences, retards, incidents.
-- Saisie par l'administration ou le surveillant général ; lecture par tout le personnel (note de conduite des bulletins).

create or replace function public.peut_discipline() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.personnels p where p.id = auth.uid() and p.actif and p.role in ('admin', 'surveillant'))
$$;

create table public.sanctions (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  libelle text not null check (char_length(btrim(libelle)) between 1 and 150),
  points_perdus numeric(4, 2) not null default 0 check (points_perdus between 0 and 20),
  unique (etablissement_id, libelle),
  unique (id, etablissement_id)
);

create table public.infractions (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant(),
  libelle text not null check (char_length(btrim(libelle)) between 1 and 200),
  sanction_id uuid not null,
  unique (etablissement_id, libelle),
  unique (id, etablissement_id),
  foreign key (sanction_id, etablissement_id) references public.sanctions (id, etablissement_id) on delete restrict
);

-- Barème : note = note_max − (retards × points_par_retard + heures NJ × points_par_heure + points des sanctions), minimum 0
create table public.parametres_discipline (
  exercice_id uuid primary key,
  etablissement_id uuid not null default public.etab_courant(),
  note_max numeric(4, 2) not null default 20 check (note_max between 1 and 20),
  points_par_retard numeric(4, 2) not null default 0.25 check (points_par_retard between 0 and 20),
  points_par_heure numeric(4, 2) not null default 0.25 check (points_par_heure between 0 and 20),
  foreign key (exercice_id, etablissement_id) references public.exercices (id, etablissement_id) on delete cascade
);

create table public.absences (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant(),
  inscription_id uuid not null,
  sequence_id uuid not null,
  date date not null,
  heures_non_justifiees smallint not null default 0 check (heures_non_justifiees between 0 and 24),
  heures_justifiees smallint not null default 0 check (heures_justifiees between 0 and 24),
  motif text not null default '' check (char_length(motif) <= 200),
  saisi_par uuid default auth.uid(),
  maj timestamptz not null default now(),
  unique (inscription_id, date),
  foreign key (inscription_id, etablissement_id) references public.inscriptions (id, etablissement_id) on delete cascade,
  foreign key (sequence_id, etablissement_id) references public.sequences (id, etablissement_id) on delete restrict
);
create index on public.absences (sequence_id);

create table public.retards (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant(),
  inscription_id uuid not null,
  sequence_id uuid not null,
  date date not null,
  saisi_par uuid default auth.uid(),
  unique (inscription_id, date),
  foreign key (inscription_id, etablissement_id) references public.inscriptions (id, etablissement_id) on delete cascade,
  foreign key (sequence_id, etablissement_id) references public.sequences (id, etablissement_id) on delete restrict
);
create index on public.retards (sequence_id);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant(),
  inscription_id uuid not null,
  sequence_id uuid not null,
  date date not null,
  infraction_id uuid not null,
  observation text not null default '' check (char_length(observation) <= 300),
  saisi_par uuid default auth.uid(),
  foreign key (inscription_id, etablissement_id) references public.inscriptions (id, etablissement_id) on delete cascade,
  foreign key (sequence_id, etablissement_id) references public.sequences (id, etablissement_id) on delete restrict,
  foreign key (infraction_id, etablissement_id) references public.infractions (id, etablissement_id) on delete restrict
);
create index on public.incidents (sequence_id);

-- Un barème par exercice, créé avec l'exercice
create or replace function public.creer_parametres_discipline() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.parametres_discipline (exercice_id, etablissement_id) values (new.id, new.etablissement_id);
  return new;
end $$;
create trigger exercice_parametres_discipline after insert on public.exercices
  for each row execute function public.creer_parametres_discipline();

-- Élève et séquence du même exercice ; séquence verrouillée = plus de saisie
create or replace function public.verifier_evenement_discipline() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s record; ex uuid;
begin
  select exercice_id, verrouillee into s from public.sequences where id = case when tg_op = 'DELETE' then old.sequence_id else new.sequence_id end;
  if s.verrouillee then raise exception 'Opération refusée : la séquence est verrouillée.' using errcode = 'P0001'; end if;
  if tg_op = 'DELETE' then return old; end if;
  select exercice_id into ex from public.inscriptions where id = new.inscription_id;
  if ex is distinct from s.exercice_id then
    raise exception 'L''élève et la séquence doivent appartenir au même exercice.' using errcode = 'P0001';
  end if;
  new.saisi_par := auth.uid();
  return new;
end $$;
create trigger absence_coherente before insert or update or delete on public.absences for each row execute function public.verifier_evenement_discipline();
create trigger retard_coherent before insert or update or delete on public.retards for each row execute function public.verifier_evenement_discipline();
create trigger incident_coherent before insert or update or delete on public.incidents for each row execute function public.verifier_evenement_discipline();

-- RLS
alter table public.sanctions enable row level security;
alter table public.infractions enable row level security;
alter table public.parametres_discipline enable row level security;
alter table public.absences enable row level security;
alter table public.retards enable row level security;
alter table public.incidents enable row level security;

do $$
declare t text; ecrire text;
begin
  foreach t in array array['sanctions', 'infractions', 'parametres_discipline', 'absences', 'retards', 'incidents'] loop
    ecrire := case when t in ('sanctions', 'infractions', 'parametres_discipline') then '(select public.est_admin())'
                   else '(select public.peut_discipline())' end;
    execute format('create policy "lecture" on public.%I for select to authenticated
                      using (etablissement_id = (select public.etab_courant()))', t);
    execute format('create policy "ajout" on public.%I for insert to authenticated
                      with check (etablissement_id = (select public.etab_courant()) and %s)', t, ecrire);
    execute format('create policy "modification" on public.%I for update to authenticated
                      using (etablissement_id = (select public.etab_courant()) and %s)
                      with check (etablissement_id = (select public.etab_courant()))', t, ecrire);
    execute format('create policy "suppression" on public.%I for delete to authenticated
                      using (etablissement_id = (select public.etab_courant()) and %s)', t, ecrire);
  end loop;
end $$;

revoke all on public.sanctions, public.infractions, public.parametres_discipline, public.absences, public.retards, public.incidents
  from anon, authenticated;
grant select, insert, update, delete on public.sanctions, public.infractions, public.parametres_discipline, public.absences,
  public.retards, public.incidents to authenticated;
revoke execute on function public.peut_discipline(), public.creer_parametres_discipline(), public.verifier_evenement_discipline()
  from public, anon, authenticated;
grant execute on function public.peut_discipline() to authenticated;
