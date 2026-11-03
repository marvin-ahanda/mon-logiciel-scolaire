-- NexIASchool — schéma multi-établissements (Supabase, plan Free).
-- Toutes les données portent etablissement_id ; la sécurité par ligne (RLS) limite chaque membre du personnel
-- aux données de son établissement. Les clés étrangères composites (id, etablissement_id) empêchent de relier
-- des lignes de deux établissements différents.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------------------------------------
-- Établissements et personnel
-- ---------------------------------------------------------------------------------------------------------
create table public.etablissements (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (char_length(btrim(nom)) between 3 and 200),
  nom_normalise text not null unique,
  ville text not null default '' check (char_length(ville) <= 100),
  adresse text not null default '' check (char_length(adresse) <= 200),
  telephone text not null default '' check (char_length(telephone) <= 50),
  devise text not null default '' check (char_length(devise) <= 200),
  nom_chef text not null default '' check (char_length(nom_chef) <= 150),
  code_hash text not null,
  code_genere_le timestamptz not null default now(),
  cree_le timestamptz not null default now()
);

create table public.personnels (
  id uuid primary key references auth.users (id) on delete cascade,
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  nom text not null check (char_length(btrim(nom)) between 1 and 150),
  prenom text not null default '' check (char_length(prenom) <= 150),
  role text not null check (role in ('admin', 'enseignant')),
  matricule text not null default '' check (char_length(matricule) <= 30),
  telephone text not null default '' check (char_length(telephone) <= 30),
  actif boolean not null default true,
  code_hash text not null,
  code_genere_le timestamptz not null default now(),
  echecs smallint not null default 0,
  bloque_jusqu_a timestamptz,
  derniere_connexion timestamptz,
  cree_le timestamptz not null default now(),
  unique (id, etablissement_id)
);
create index on public.personnels (etablissement_id);

-- Jetons « appareil » : remis après saisie du nom et du code de l'établissement (30 jours), seule leur empreinte est gardée
create table public.jetons_appareil (
  jeton_hash text primary key,
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  expire_le timestamptz not null
);
create index on public.jetons_appareil (etablissement_id);

-- Compteurs d'échecs (essais de codes au hasard)
create table public.tentatives (
  cle text primary key,
  echecs integer not null default 0,
  bloque_jusqu_a timestamptz,
  maj timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------------------
-- Fonctions d'identité (utilisées par les règles RLS)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.etab_courant() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.etablissement_id from public.personnels p where p.id = auth.uid() and p.actif
$$;

create or replace function public.est_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.personnels p where p.id = auth.uid() and p.actif and p.role = 'admin')
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Données scolaires
-- ---------------------------------------------------------------------------------------------------------
create table public.exercices (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  libelle text not null check (libelle ~ '^[0-9]{4}-[0-9]{4}$'),
  actif boolean not null default false,
  cree_le timestamptz not null default now(),
  unique (etablissement_id, libelle),
  unique (id, etablissement_id)
);
create unique index exercice_actif_unique on public.exercices (etablissement_id) where actif;

create table public.sequences (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant(),
  exercice_id uuid not null,
  numero smallint not null check (numero between 1 and 6),
  trimestre smallint not null check (trimestre between 1 and 3),
  verrouillee boolean not null default false,
  unique (exercice_id, numero),
  unique (id, etablissement_id),
  foreign key (exercice_id, etablissement_id) references public.exercices (id, etablissement_id) on delete cascade
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  libelle text not null check (char_length(btrim(libelle)) between 1 and 50),
  niveau text not null default '' check (char_length(niveau) <= 50),
  ordre smallint not null default 0,
  coef_min smallint not null default 0 check (coef_min >= 0),
  unique (etablissement_id, libelle),
  unique (id, etablissement_id)
);

create table public.matieres (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  code text not null check (char_length(btrim(code)) between 1 and 15),
  libelle text not null check (char_length(btrim(libelle)) between 1 and 100),
  unique (etablissement_id, code),
  unique (id, etablissement_id)
);

create table public.attributions (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant(),
  exercice_id uuid not null,
  classe_id uuid not null,
  matiere_id uuid not null,
  enseignant_id uuid,
  coefficient smallint not null default 1 check (coefficient between 1 and 20),
  groupe smallint not null default 1 check (groupe between 1 and 3),
  unique (exercice_id, classe_id, matiere_id),
  unique (id, etablissement_id),
  foreign key (exercice_id, etablissement_id) references public.exercices (id, etablissement_id) on delete cascade,
  foreign key (classe_id, etablissement_id) references public.classes (id, etablissement_id) on delete cascade,
  foreign key (matiere_id, etablissement_id) references public.matieres (id, etablissement_id) on delete cascade,
  foreign key (enseignant_id, etablissement_id) references public.personnels (id, etablissement_id) on delete set null (enseignant_id)
);
create index on public.attributions (enseignant_id);

create table public.eleves (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  matricule text not null check (char_length(btrim(matricule)) between 1 and 30),
  nom text not null check (char_length(btrim(nom)) between 1 and 100),
  prenom text not null default '' check (char_length(prenom) <= 100),
  sexe text not null check (sexe in ('M', 'F')),
  date_naissance date,
  lieu_naissance text not null default '' check (char_length(lieu_naissance) <= 100),
  telephone_parent text not null default '' check (char_length(telephone_parent) <= 30),
  photo text,
  cree_le timestamptz not null default now(),
  unique (etablissement_id, matricule),
  unique (id, etablissement_id)
);

create table public.inscriptions (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant(),
  exercice_id uuid not null,
  classe_id uuid not null,
  eleve_id uuid not null,
  redoublant boolean not null default false,
  unique (exercice_id, eleve_id),
  unique (id, etablissement_id),
  foreign key (exercice_id, etablissement_id) references public.exercices (id, etablissement_id) on delete cascade,
  foreign key (classe_id, etablissement_id) references public.classes (id, etablissement_id) on delete restrict,
  foreign key (eleve_id, etablissement_id) references public.eleves (id, etablissement_id) on delete cascade
);
create index on public.inscriptions (classe_id);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant(),
  inscription_id uuid not null,
  attribution_id uuid not null,
  sequence_id uuid not null,
  valeur numeric(4, 2) not null check (valeur between 0 and 20),
  saisi_par uuid default auth.uid(),
  maj timestamptz not null default now(),
  unique (inscription_id, attribution_id, sequence_id),
  foreign key (inscription_id, etablissement_id) references public.inscriptions (id, etablissement_id) on delete cascade,
  foreign key (attribution_id, etablissement_id) references public.attributions (id, etablissement_id) on delete cascade,
  foreign key (sequence_id, etablissement_id) references public.sequences (id, etablissement_id) on delete cascade
);
create index on public.notes (attribution_id, sequence_id);
