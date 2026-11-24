-- Finances : pilotage financier complet (frais et facturation, encaissements et reçus, dépenses et fournisseurs, trésorerie et
-- banques, paie du personnel, rapports, assistant IA via MCP en lecture seule).
-- Principes :
--  * une seule source de vérité : la pension reste calculée par frais_scolarite + echeances + paiements (catégorie nulle) ;
--    les autres frais (catégories) et les dettes antérieures sont dus par facture ; remises, exonérations et bourses tracées ;
--  * aucune suppression : un encaissement s'annule par contre-écriture (montant négatif lié), une dépense par statut ;
--  * trésorerie : un journal de mouvements alimenté uniquement par déclencheurs (encaissements, dépenses payées, virements) ;
--    soldes recalculés à partir de ce journal ; les virements internes ne sont ni des recettes ni des dépenses ;
--  * la paie payée produit UNE dépense « salaires » (et donc un seul mouvement de trésorerie) ;
--  * aucun taux réglementaire n'est codé : les cotisations et retenues sont des paramètres saisis par l'établissement,
--    inactifs et « non vérifiés » par défaut ;
--  * droits financiers par personne, vérifiés côté serveur ; isolation stricte par établissement.

-- ---------------------------------------------------------------------------------------------------------
-- Droits financiers
--   caisse : encaisser, reçus, paiements en attente     facturation : frais, factures, remises, dettes antérieures
--   depenses : saisir des dépenses, fournisseurs         validation : approuver / rejeter, annulations au-delà de 24 h
--   tresorerie : comptes, virements, clôtures, rapprochement, payer une dépense
--   paie : salaires et bulletins de paie                 rapports : tableau de bord et rapports   assistant : IA via MCP
-- L'administration a tous les droits ; le comptable a par défaut tous ceux du caissier et davantage (sauf validation et paie),
-- l'administration peut les ajuster pour chaque personne (ex. un caissier limité à « caisse »).
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._codes_droits_finance() returns text[]
language sql immutable set search_path = '' as $$
  select array['caisse', 'facturation', 'depenses', 'validation', 'tresorerie', 'paie', 'rapports', 'assistant']::text[] $$;
create or replace function public._droits_finance_comptable() returns text[]
language sql immutable set search_path = '' as $$
  select array['caisse', 'facturation', 'depenses', 'tresorerie', 'rapports', 'assistant']::text[] $$;

create table public.finance_droits (
  personnel_id uuid primary key references public.personnels (id) on delete cascade,
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  droits text[] not null default '{}',
  maj timestamptz not null default now(),
  maj_par uuid default auth.uid(),
  check (droits <@ array['caisse', 'facturation', 'depenses', 'validation', 'tresorerie', 'paie', 'rapports', 'assistant']::text[])
);
alter table public.finance_droits enable row level security;
revoke all on public.finance_droits from anon, authenticated;
grant select on public.finance_droits to authenticated;
create policy "lecture par l'administration" on public.finance_droits for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));

create or replace function public._droits_finance(p_personnel uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when p.role = 'admin' then public._codes_droits_finance()
                when d.personnel_id is not null then d.droits
                when p.role = 'comptable' then public._droits_finance_comptable()
                else '{}'::text[] end
      from public.personnels p join public.etablissements e on e.id = p.etablissement_id
      left join public.finance_droits d on d.personnel_id = p.id
     where p.id = p_personnel and p.actif and e.suspendu_le is null), '{}'::text[])
$$;
create or replace function public.a_droit_finance(p_code text) returns boolean
language sql stable security definer set search_path = '' as $$ select p_code = any (public._droits_finance(auth.uid())) $$;
create or replace function public.mes_droits_finance() returns text[]
language sql stable security definer set search_path = '' as $$ select public._droits_finance(auth.uid()) $$;

-- Accès à la rubrique Finances : toute personne ayant un droit de consultation des encaissements
create or replace function public.peut_finance() returns boolean
language sql stable security definer set search_path = '' as $$
  select public._droits_finance(auth.uid()) && array['caisse', 'facturation', 'validation', 'tresorerie', 'rapports']::text[]
$$;

-- Droit exigé pour une écriture : renvoie l'établissement ; l'offre « finances » doit être active
create or replace function public._finance_exiger(p_code text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant();
begin
  if v_etab is null or not public.a_droit_finance(p_code) then
    raise exception 'Action réservée aux personnes ayant le droit financier « % ».', p_code using errcode = '42501';
  end if;
  perform public._exiger_offre(v_etab, 'finances');
  return v_etab;
end $$;

-- Droit exigé pour une lecture (pas de contrôle d'offre : les données restent consultables)
create or replace function public._finance_lire(variadic p_codes text[]) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant();
begin
  if v_etab is null or not (public._droits_finance(auth.uid()) && p_codes) then
    raise exception 'Consultation réservée aux personnes ayant un droit financier adapté.' using errcode = '42501';
  end if;
  return v_etab;
end $$;

create or replace function public.finance_droits_lister() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin();
begin
  return (select coalesce(json_agg(json_build_object('personnel_id', p.id, 'nom', public._libelle(p.nom, p.prenom), 'role', p.role,
            'personnalise', d.personnel_id is not null, 'droits', public._droits_finance(p.id)) order by p.role, p.nom, p.prenom), '[]'::json)
    from public.personnels p left join public.finance_droits d on d.personnel_id = p.id
   where p.etablissement_id = v_etab and p.actif);
end $$;

-- p_droits nul : retour aux droits par défaut du rôle
create or replace function public.finance_droits_definir(p_personnel uuid, p_droits text[]) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin(); r text;
begin
  select role into r from public.personnels where id = p_personnel and etablissement_id = v_etab;
  if r is null then raise exception 'Membre du personnel introuvable.' using errcode = 'P0001'; end if;
  if r = 'admin' then raise exception 'L''administration a toujours tous les droits financiers.' using errcode = 'P0001'; end if;
  if p_droits is null then
    delete from public.finance_droits where personnel_id = p_personnel;
  else
    if not (p_droits <@ public._codes_droits_finance()) then raise exception 'Droit financier inconnu.' using errcode = 'P0001'; end if;
    insert into public.finance_droits (personnel_id, etablissement_id, droits) values (p_personnel, v_etab, p_droits)
    on conflict (personnel_id) do update set droits = excluded.droits, maj = now(), maj_par = auth.uid();
  end if;
  perform public._finance_journaliser('droits', 'personnel', p_personnel, jsonb_build_object('droits', coalesce(to_jsonb(p_droits), '"défaut"'::jsonb)));
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Journal financier (traçabilité ; aucune donnée salariale détaillée)
-- ---------------------------------------------------------------------------------------------------------
create table public.finance_journal (
  id bigint generated always as identity primary key,
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  personnel_id uuid,
  action text not null,
  objet text not null,
  objet_id uuid,
  details jsonb not null default '{}',
  cree_le timestamptz not null default now()
);
create index on public.finance_journal (etablissement_id, cree_le desc);
alter table public.finance_journal enable row level security;
revoke all on public.finance_journal from anon, authenticated;
grant select on public.finance_journal to authenticated;
create policy "lecture par l'administration et la validation" on public.finance_journal for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and ((select public.est_admin()) or (select public.a_droit_finance('validation'))));

create or replace function public._finance_journaliser(p_action text, p_objet text, p_objet_id uuid, p_details jsonb) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.finance_journal (etablissement_id, personnel_id, action, objet, objet_id, details)
  values (public.etab_courant(), auth.uid(), p_action, p_objet, p_objet_id, coalesce(p_details, '{}'))
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Paramètres financiers de l'établissement (modes de paiement proposés, mentions des documents)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._modes_paiement() returns text[]
language sql immutable set search_path = '' as $$
  select array['especes', 'mtn_momo', 'orange_money', 'mobile_money', 'virement', 'cheque', 'carte', 'autre']::text[] $$;

alter table public.paiements drop constraint if exists paiements_mode_check;
alter table public.paiements add constraint paiements_mode_check
  check (mode in ('especes', 'mtn_momo', 'orange_money', 'mobile_money', 'virement', 'cheque', 'carte', 'autre'));

create table public.finance_parametres (
  etablissement_id uuid primary key references public.etablissements (id) on delete cascade,
  modes_actifs text[] not null default array['especes', 'mtn_momo', 'orange_money', 'virement', 'cheque']::text[],
  devise text not null default 'XAF' check (devise ~ '^[A-Z]{3}$'),
  mention_documents text not null default '' check (char_length(mention_documents) <= 300),
  maj timestamptz not null default now(),
  maj_par uuid default auth.uid(),
  check (modes_actifs <@ array['especes', 'mtn_momo', 'orange_money', 'mobile_money', 'virement', 'cheque', 'carte', 'autre']::text[])
);
alter table public.finance_parametres enable row level security;
revoke all on public.finance_parametres from anon, authenticated;
grant select on public.finance_parametres to authenticated;
create policy "lecture" on public.finance_parametres for select to authenticated
  using (etablissement_id = (select public.etab_courant()));

create or replace function public.finance_parametres_enregistrer(p jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin(); m text[];
begin
  select array_agg(x) into m from jsonb_array_elements_text(coalesce(p -> 'modes_actifs', '[]')) x;
  if m is null or cardinality(m) = 0 then raise exception 'Choisissez au moins un mode de paiement.' using errcode = 'P0001'; end if;
  if not (m <@ public._modes_paiement()) then raise exception 'Mode de paiement inconnu.' using errcode = 'P0001'; end if;
  insert into public.finance_parametres (etablissement_id, modes_actifs, devise, mention_documents)
  values (v_etab, m, coalesce(nullif(upper(btrim(p ->> 'devise')), ''), 'XAF'), left(btrim(coalesce(p ->> 'mention_documents', '')), 300))
  on conflict (etablissement_id) do update set modes_actifs = excluded.modes_actifs, devise = excluded.devise,
    mention_documents = excluded.mention_documents, maj = now(), maj_par = auth.uid();
  perform public._finance_journaliser('parametres', 'etablissement', v_etab, jsonb_build_object('modes', m));
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Catégories de frais (hors pension) : montant par classe (ou pour toutes les classes), conditions, échéancier en tranches.
-- Nature « dette_anterieure » : dette d'une année précédente, facturée élève par élève et suivie à part.
-- ---------------------------------------------------------------------------------------------------------
create table public.frais_categories (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  exercice_id uuid not null,
  libelle text not null check (char_length(btrim(libelle)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 300),
  conditions text not null default '' check (char_length(conditions) <= 300),
  nature text not null default 'frais' check (nature in ('frais', 'dette_anterieure')),
  obligatoire boolean not null default true,
  actif boolean not null default true,
  ordre smallint not null default 0,
  cree_le timestamptz not null default now(),
  cree_par uuid default auth.uid(),
  unique (exercice_id, libelle),
  unique (id, etablissement_id),
  foreign key (exercice_id, etablissement_id) references public.exercices (id, etablissement_id) on delete cascade
);
create table public.frais_montants (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null,
  categorie_id uuid not null,
  classe_id uuid references public.classes (id) on delete cascade,   -- nul : toutes les classes
  montant integer not null check (montant between 0 and 100000000),
  foreign key (categorie_id, etablissement_id) references public.frais_categories (id, etablissement_id) on delete cascade
);
create unique index frais_montants_unique on public.frais_montants (categorie_id, coalesce(classe_id, '00000000-0000-0000-0000-000000000000'::uuid));
create table public.frais_tranches (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null,
  categorie_id uuid not null,
  rang smallint not null check (rang between 1 and 12),
  libelle text not null check (char_length(btrim(libelle)) between 1 and 60),
  pourcentage numeric(5, 2) not null check (pourcentage > 0 and pourcentage <= 100),
  date_limite date not null,
  unique (categorie_id, rang),
  foreign key (categorie_id, etablissement_id) references public.frais_categories (id, etablissement_id) on delete cascade
);
alter table public.frais_categories enable row level security;
alter table public.frais_montants enable row level security;
alter table public.frais_tranches enable row level security;
revoke all on public.frais_categories, public.frais_montants, public.frais_tranches from anon, authenticated;
grant select on public.frais_categories, public.frais_montants, public.frais_tranches to authenticated;
create policy "lecture par la comptabilité" on public.frais_categories for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.peut_finance()));
create policy "lecture par la comptabilité" on public.frais_montants for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.peut_finance()));
create policy "lecture par la comptabilité" on public.frais_tranches for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.peut_finance()));

/** Crée ou modifie une catégorie (et remplace ses montants par classe et ses tranches). */
create or replace function public.finance_categorie_enregistrer(p jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._finance_exiger('facturation'); ex uuid; v_id uuid := nullif(p ->> 'id', '')::uuid; l jsonb; somme numeric := 0;
        precedente date; k int := 0; v_nature text := coalesce(nullif(p ->> 'nature', ''), 'frais');
begin
  select id into ex from public.exercices where etablissement_id = v_etab and actif;
  if ex is null then raise exception 'Aucun exercice actif.' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p ->> 'libelle', ''))) = 0 then raise exception 'Le libellé est obligatoire.' using errcode = 'P0001'; end if;
  if public._normaliser(p ->> 'libelle') in ('pension', 'scolarite', 'pension scolarite') then
    raise exception 'La pension se règle dans « Frais et délais » : choisissez un autre libellé.' using errcode = 'P0001';
  end if;
  if v_nature not in ('frais', 'dette_anterieure') then raise exception 'Nature inconnue.' using errcode = 'P0001'; end if;
  for l in select * from jsonb_array_elements(coalesce(p -> 'tranches', '[]')) loop
    k := k + 1;
    if (l ->> 'pourcentage') is null or (l ->> 'date_limite') is null then
      raise exception 'Pourcentage et date limite obligatoires pour chaque tranche.' using errcode = 'P0001';
    end if;
    if precedente is not null and (l ->> 'date_limite')::date < precedente then
      raise exception 'Les dates limites des tranches doivent se suivre.' using errcode = 'P0001';
    end if;
    precedente := (l ->> 'date_limite')::date;
    somme := somme + (l ->> 'pourcentage')::numeric;
  end loop;
  if k > 0 and somme <> 100 then raise exception 'Le total des tranches doit faire 100 %% (actuellement % %%).', somme using errcode = 'P0001'; end if;
  if v_id is null then
    insert into public.frais_categories (etablissement_id, exercice_id, libelle, description, conditions, nature, obligatoire, actif, ordre)
    values (v_etab, ex, btrim(p ->> 'libelle'), left(coalesce(p ->> 'description', ''), 300), left(coalesce(p ->> 'conditions', ''), 300), v_nature,
            coalesce((p ->> 'obligatoire')::boolean, v_nature = 'frais'), coalesce((p ->> 'actif')::boolean, true), coalesce((p ->> 'ordre')::int, 0))
    returning id into v_id;
  else
    update public.frais_categories set libelle = btrim(p ->> 'libelle'), description = left(coalesce(p ->> 'description', ''), 300),
           conditions = left(coalesce(p ->> 'conditions', ''), 300), obligatoire = coalesce((p ->> 'obligatoire')::boolean, obligatoire),
           actif = coalesce((p ->> 'actif')::boolean, actif), ordre = coalesce((p ->> 'ordre')::int, ordre)
     where id = v_id and etablissement_id = v_etab;
    if not found then raise exception 'Catégorie introuvable.' using errcode = 'P0001'; end if;
  end if;
  if p ? 'montants' then
    delete from public.frais_montants where categorie_id = v_id;
    for l in select * from jsonb_array_elements(p -> 'montants') loop
      if nullif(l ->> 'classe_id', '') is not null and not exists (select 1 from public.classes where id = (l ->> 'classe_id')::uuid and etablissement_id = v_etab) then
        raise exception 'Classe inconnue.' using errcode = 'P0001';
      end if;
      insert into public.frais_montants (etablissement_id, categorie_id, classe_id, montant)
      values (v_etab, v_id, nullif(l ->> 'classe_id', '')::uuid, (l ->> 'montant')::int);
    end loop;
  end if;
  if p ? 'tranches' then
    delete from public.frais_tranches where categorie_id = v_id;
    k := 0;
    for l in select * from jsonb_array_elements(p -> 'tranches') loop
      k := k + 1;
      insert into public.frais_tranches (etablissement_id, categorie_id, rang, libelle, pourcentage, date_limite)
      values (v_etab, v_id, k, coalesce(nullif(btrim(l ->> 'libelle'), ''), format('Tranche %s', k)), (l ->> 'pourcentage')::numeric, (l ->> 'date_limite')::date);
    end loop;
  end if;
  perform public._finance_journaliser('categorie', 'frais_categorie', v_id, jsonb_build_object('libelle', p ->> 'libelle'));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Remises, réductions, exonérations, bourses, aides, décisions administratives (motif, auteur, date ; annulables, jamais effacées)
-- categorie_id nul : sur la pension
-- ---------------------------------------------------------------------------------------------------------
create table public.finance_remises (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant(),
  inscription_id uuid not null,
  categorie_id uuid,
  nature text not null check (nature in ('reduction', 'exoneration', 'bourse', 'aide', 'decision')),
  type text not null check (type in ('montant', 'pourcentage')),
  valeur numeric(12, 2) not null check (valeur > 0),
  motif text not null check (char_length(btrim(motif)) between 3 and 300),
  accorde_par uuid default auth.uid(),
  accorde_le timestamptz not null default now(),
  annulee_le timestamptz,
  annulee_par uuid,
  motif_annulation text check (char_length(motif_annulation) <= 300),
  check (type = 'montant' or valeur <= 100),
  foreign key (inscription_id, etablissement_id) references public.inscriptions (id, etablissement_id) on delete cascade,
  foreign key (categorie_id, etablissement_id) references public.frais_categories (id, etablissement_id)
);
create index on public.finance_remises (inscription_id);
alter table public.finance_remises enable row level security;
revoke all on public.finance_remises from anon, authenticated;
grant select on public.finance_remises to authenticated;
create policy "lecture par la comptabilité" on public.finance_remises for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.peut_finance()));

/** Total des remises actives d'une inscription pour une rubrique (nul = pension), plafonné au montant brut. */
create or replace function public._remise_totale(p_insc uuid, p_categorie uuid, p_brut bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  select least(greatest(p_brut, 0), coalesce(sum(case when r.type = 'pourcentage' then round(p_brut * r.valeur / 100.0) else r.valeur end), 0))::bigint
    from public.finance_remises r
   where r.inscription_id = p_insc and r.categorie_id is not distinct from p_categorie and r.annulee_le is null
$$;

create or replace function public.finance_remise_accorder(p jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._finance_exiger('facturation'); v_id uuid; v_nature text := p ->> 'nature'; v_type text := p ->> 'type';
        v_val numeric := (p ->> 'valeur')::numeric; v_cat uuid := nullif(p ->> 'categorie_id', '')::uuid;
begin
  if not exists (select 1 from public.inscriptions where id = (p ->> 'inscription_id')::uuid and etablissement_id = v_etab) then
    raise exception 'Inscription introuvable.' using errcode = 'P0001';
  end if;
  if v_cat is not null and not exists (select 1 from public.frais_categories where id = v_cat and etablissement_id = v_etab) then
    raise exception 'Rubrique introuvable.' using errcode = 'P0001';
  end if;
  if v_nature = 'exoneration' then v_type := 'pourcentage'; v_val := 100; end if;
  if v_type not in ('montant', 'pourcentage') or coalesce(v_val, 0) <= 0 or (v_type = 'pourcentage' and v_val > 100) then
    raise exception 'Valeur de remise invalide.' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p ->> 'motif', ''))) < 3 then raise exception 'Le motif est obligatoire.' using errcode = 'P0001'; end if;
  insert into public.finance_remises (etablissement_id, inscription_id, categorie_id, nature, type, valeur, motif)
  values (v_etab, (p ->> 'inscription_id')::uuid, v_cat, v_nature, v_type, v_val, btrim(p ->> 'motif')) returning id into v_id;
  perform public._finance_journaliser('remise', 'finance_remise', v_id, jsonb_build_object('nature', v_nature, 'type', v_type, 'valeur', v_val));
  return v_id;
end $$;

create or replace function public.finance_remise_annuler(p_id uuid, p_motif text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._finance_exiger('facturation');
begin
  if char_length(btrim(coalesce(p_motif, ''))) < 3 then raise exception 'Le motif d''annulation est obligatoire.' using errcode = 'P0001'; end if;
  update public.finance_remises set annulee_le = now(), annulee_par = auth.uid(), motif_annulation = left(btrim(p_motif), 300)
   where id = p_id and etablissement_id = v_etab and annulee_le is null;
  if not found then raise exception 'Remise introuvable ou déjà annulée.' using errcode = 'P0001'; end if;
  perform public._finance_journaliser('annulation remise', 'finance_remise', p_id, jsonb_build_object('motif', left(btrim(p_motif), 300)));
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Factures : un numéro unique par établissement ; une seule facture active par élève et par rubrique (pas de doublon).
-- Montant brut figé à l'émission ; remises et paiements appliqués en direct (statut calculé).
-- ---------------------------------------------------------------------------------------------------------
create table public.factures (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant(),
  exercice_id uuid not null,
  inscription_id uuid not null,
  categorie_id uuid,                                               -- nul : pension
  numero integer not null,
  libelle text not null default '' check (char_length(libelle) <= 200),
  montant_brut bigint not null check (montant_brut between 0 and 1000000000),
  emise_le timestamptz not null default now(),
  emise_par uuid default auth.uid(),
  annulee_le timestamptz,
  annulee_par uuid,
  motif_annulation text check (char_length(motif_annulation) <= 300),
  code_verif text not null unique default upper(replace(gen_random_uuid()::text, '-', '')),
  unique (etablissement_id, numero),
  foreign key (inscription_id, etablissement_id) references public.inscriptions (id, etablissement_id) on delete cascade,
  foreign key (categorie_id, etablissement_id) references public.frais_categories (id, etablissement_id)
);
create unique index factures_une_active on public.factures (inscription_id, coalesce(categorie_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where annulee_le is null;
alter table public.factures enable row level security;
revoke all on public.factures from anon, authenticated;
grant select on public.factures to authenticated;
create policy "lecture par la comptabilité" on public.factures for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.peut_finance()));

-- ---------------------------------------------------------------------------------------------------------
-- Comptes de trésorerie (caisse, banque, MTN MoMo, Orange Money…) : définis ici car les encaissements y sont rattachés
-- ---------------------------------------------------------------------------------------------------------
create table public.comptes_financiers (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  libelle text not null check (char_length(btrim(libelle)) between 1 and 80),
  type text not null check (type in ('caisse', 'banque', 'mtn_momo', 'orange_money', 'autre')),
  numero text not null default '' check (char_length(numero) <= 60),
  modes text[] not null default '{}',                              -- modes de paiement encaissés sur ce compte par défaut
  solde_initial bigint not null default 0 check (solde_initial between -1000000000000 and 1000000000000),
  date_solde_initial date not null,
  devise text not null default 'XAF' check (devise ~ '^[A-Z]{3}$'),
  par_defaut boolean not null default false,
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  cree_par uuid default auth.uid(),
  unique (etablissement_id, libelle),
  unique (id, etablissement_id),
  check (modes <@ array['especes', 'mtn_momo', 'orange_money', 'mobile_money', 'virement', 'cheque', 'carte', 'autre']::text[])
);
alter table public.comptes_financiers enable row level security;
revoke all on public.comptes_financiers from anon, authenticated;
-- solde initial et date : réservés aux fonctions de trésorerie (finance_tresorerie)
grant select (id, etablissement_id, libelle, type, numero, modes, devise, par_defaut, actif, cree_le) on public.comptes_financiers to authenticated;
create policy "lecture par la comptabilité" on public.comptes_financiers for select to authenticated
  using (etablissement_id = (select public.etab_courant())
         and ((select public.peut_finance()) or (select public.a_droit_finance('depenses'))));

-- ---------------------------------------------------------------------------------------------------------
-- Encaissements : rubrique, compte, payeur, idempotence, annulation par contre-écriture, code de vérification (QR)
-- ---------------------------------------------------------------------------------------------------------
alter table public.paiements add column if not exists categorie_id uuid;
alter table public.paiements add column if not exists compte_id uuid;
alter table public.paiements add column if not exists payeur text not null default '' check (char_length(payeur) <= 120);
alter table public.paiements add column if not exists cle_idempotence text check (char_length(cle_idempotence) between 8 and 80);
alter table public.paiements add column if not exists annule_paiement_id uuid unique references public.paiements (id);
alter table public.paiements add column if not exists motif_annulation text check (char_length(motif_annulation) <= 300);
alter table public.paiements add column if not exists attente_id uuid unique;
-- valeur par défaut volatile : chaque reçu déjà émis reçoit son propre code, sans déclencher les contrôles de mise à jour
alter table public.paiements add column if not exists code_verif text unique default upper(replace(gen_random_uuid()::text, '-', ''));
alter table public.paiements drop constraint if exists paiements_categorie_fkey;
alter table public.paiements add constraint paiements_categorie_fkey foreign key (categorie_id, etablissement_id)
  references public.frais_categories (id, etablissement_id);
alter table public.paiements drop constraint if exists paiements_compte_fkey;
alter table public.paiements add constraint paiements_compte_fkey foreign key (compte_id, etablissement_id)
  references public.comptes_financiers (id, etablissement_id);
alter table public.paiements drop constraint if exists paiements_montant_check;
alter table public.paiements add constraint paiements_montant_check check (
  (annule_paiement_id is null and montant between 1 and 100000000) or (annule_paiement_id is not null and montant between -100000000 and -1));
create unique index if not exists paiements_idempotence on public.paiements (etablissement_id, cle_idempotence) where cle_idempotence is not null;
create index if not exists paiements_date on public.paiements (etablissement_id, date_paiement);

-- plus aucune suppression physique : l'annulation passe par finance_annuler_paiement (contre-écriture)
drop policy if exists "annulation" on public.paiements;
revoke delete on public.paiements from authenticated;
drop policy if exists "encaissement par la comptabilité" on public.paiements;
create policy "encaissement par la caisse" on public.paiements for insert to authenticated
  with check (etablissement_id = (select public.etab_courant()) and (select public.a_droit_finance('caisse')));
revoke insert on public.paiements from authenticated;
grant insert (inscription_id, montant, date_paiement, mode, reference, observation, categorie_id, compte_id, payeur, cle_idempotence)
  on public.paiements to authenticated;

create or replace function public.preparer_paiement() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ex_insc uuid; v_reste bigint;
begin
  if auth.uid() is not null and new.annule_paiement_id is null and not public.a_droit_finance('caisse') then
    raise exception 'Encaissement réservé aux personnes ayant le droit financier « caisse ».' using errcode = '42501';
  end if;
  if new.annule_paiement_id is null then
    if new.date_paiement > public._aujourdhui() then
      raise exception 'La date du paiement ne peut pas être dans le futur.' using errcode = 'P0001';
    end if;
    if new.date_paiement < public._aujourdhui() - 730 then
      raise exception 'Date de paiement trop ancienne.' using errcode = 'P0001';
    end if;
  end if;
  if new.annule_paiement_id is null then
    if not (new.mode = any (coalesce((select fp.modes_actifs from public.finance_parametres fp where fp.etablissement_id = new.etablissement_id),
                                     array['especes', 'mtn_momo', 'orange_money', 'mobile_money', 'virement', 'cheque']::text[]) || array['mobile_money']::text[])) then
      raise exception 'Mode de paiement non proposé par l''établissement.' using errcode = 'P0001';
    end if;
  end if;
  if new.categorie_id is not null and new.annule_paiement_id is null then
    select exercice_id into ex_insc from public.inscriptions where id = new.inscription_id;
    if not exists (select 1 from public.frais_categories c where c.id = new.categorie_id and c.exercice_id = ex_insc) then
      raise exception 'Cette rubrique n''appartient pas à l''année scolaire de l''élève.' using errcode = 'P0001';
    end if;
    -- un encaissement à la fois par élève et par rubrique : le reste dû est relu après le verrou
    perform pg_advisory_xact_lock(hashtext('frais:' || new.inscription_id::text || ':' || new.categorie_id::text));
    select s.reste into v_reste from public._frais_situation(new.etablissement_id, new.inscription_id) s where s.categorie_id = new.categorie_id;
    if v_reste is null then raise exception 'Aucune facture active pour cette rubrique.' using errcode = 'P0001'; end if;
    if new.montant > v_reste then
      raise exception 'Le montant (% FCFA) dépasse le reste à payer (% FCFA).', new.montant, v_reste using errcode = 'P0001';
    end if;
  end if;
  if new.annule_paiement_id is not null then
    null;                                       -- contre-écriture : même compte que l'original (même nul), actif ou non
  elsif new.compte_id is null then
    select c.id into new.compte_id from public.comptes_financiers c
     where c.etablissement_id = new.etablissement_id and c.actif and new.mode = any (c.modes)
     order by c.par_defaut desc, c.cree_le limit 1;
  elsif not exists (select 1 from public.comptes_financiers c where c.id = new.compte_id and c.actif) then
    raise exception 'Compte de trésorerie inactif.' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('recu:' || new.etablissement_id::text));
  new.numero := coalesce((select max(numero) from public.paiements where etablissement_id = new.etablissement_id), 0) + 1;
  new.saisi_par := auth.uid();
  new.cree_le := now();
  new.code_verif := upper(replace(gen_random_uuid()::text, '-', ''));
  return new;
end $$;

/**
 * Encaisser (caisse). Idempotent : la même clé renvoie le reçu déjà émis au lieu d'en créer un second.
 * p : inscription_id, categorie_id (nul = pension), montant, mode, date, reference, payeur, observation, compte_id, cle, en_attente
 * en_attente = vrai (paiement mobile ou chèque non encore confirmé) : enregistré à part, jamais compté comme encaissé.
 */
create or replace function public.finance_encaisser(p jsonb) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._finance_exiger('caisse'); v_cle text := nullif(btrim(p ->> 'cle'), ''); r record; v_insc uuid := (p ->> 'inscription_id')::uuid;
        v_cat uuid := nullif(p ->> 'categorie_id', '')::uuid; v_montant int := (p ->> 'montant')::int; v_mode text := coalesce(nullif(p ->> 'mode', ''), 'especes');
        v_reste bigint; v_id uuid; v_modes text[];
begin
  if v_cle is not null then
    select id, numero, code_verif, montant into r from public.paiements where etablissement_id = v_etab and cle_idempotence = v_cle;
    if r.id is not null then return json_build_object('id', r.id, 'numero', r.numero, 'code_verif', r.code_verif, 'deja_enregistre', true); end if;
    select id into v_id from public.paiements_attente where etablissement_id = v_etab and cle_idempotence = v_cle;
    if v_id is not null then return json_build_object('attente_id', v_id, 'deja_enregistre', true); end if;
  end if;
  if not exists (select 1 from public.inscriptions where id = v_insc and etablissement_id = v_etab) then
    raise exception 'Élève introuvable.' using errcode = 'P0001';
  end if;
  if coalesce(v_montant, 0) <= 0 then raise exception 'Le montant doit être positif.' using errcode = 'P0001'; end if;
  select modes_actifs into v_modes from public.finance_parametres where etablissement_id = v_etab;
  if not (v_mode = any (coalesce(v_modes, array['especes', 'mtn_momo', 'orange_money', 'mobile_money', 'virement', 'cheque']::text[]))) then
    raise exception 'Mode de paiement non proposé par l''établissement.' using errcode = 'P0001';
  end if;
  if v_cat is not null then
    select s.reste into v_reste from public._frais_situation(v_etab, v_insc) s where s.categorie_id = v_cat;
    if v_reste is null then raise exception 'Aucune facture pour cette rubrique : émettez d''abord la facture.' using errcode = 'P0001'; end if;
    if v_montant > v_reste then raise exception 'Le montant (% FCFA) dépasse le reste à payer (% FCFA).', v_montant, v_reste using errcode = 'P0001'; end if;
  end if;
  if coalesce((p ->> 'en_attente')::boolean, false) then
    insert into public.paiements_attente (etablissement_id, inscription_id, categorie_id, montant, mode, reference, payeur, observation, compte_id, cle_idempotence)
    values (v_etab, v_insc, v_cat, v_montant, v_mode, left(coalesce(p ->> 'reference', ''), 80), left(coalesce(p ->> 'payeur', ''), 120),
            left(coalesce(p ->> 'observation', ''), 200), nullif(p ->> 'compte_id', '')::uuid, v_cle) returning id into v_id;
    perform public._finance_journaliser('paiement en attente', 'paiement_attente', v_id, jsonb_build_object('montant', v_montant, 'mode', v_mode));
    return json_build_object('attente_id', v_id);
  end if;
  begin
    insert into public.paiements (etablissement_id, inscription_id, categorie_id, montant, date_paiement, mode, reference, observation, payeur, compte_id, cle_idempotence)
    values (v_etab, v_insc, v_cat, v_montant, coalesce(nullif(p ->> 'date', '')::date, public._aujourdhui()), v_mode,
            left(coalesce(p ->> 'reference', ''), 80), left(coalesce(p ->> 'observation', ''), 200), left(coalesce(p ->> 'payeur', ''), 120),
            nullif(p ->> 'compte_id', '')::uuid, v_cle)
    returning id, numero, code_verif into r;
  exception when unique_violation then
    select id, numero, code_verif into r from public.paiements where etablissement_id = v_etab and cle_idempotence = v_cle;
    if r.id is null then raise; end if;
    return json_build_object('id', r.id, 'numero', r.numero, 'code_verif', r.code_verif, 'deja_enregistre', true);
  end;
  perform public._finance_journaliser('encaissement', 'paiement', r.id, jsonb_build_object('numero', r.numero, 'montant', v_montant, 'mode', v_mode));
  return json_build_object('id', r.id, 'numero', r.numero, 'code_verif', r.code_verif);
end $$;

/** Annuler un encaissement : contre-écriture datée du jour (l'original reste visible, marqué annulé). */
create or replace function public.finance_annuler_paiement(p_id uuid, p_motif text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); p public.paiements; r record;
begin
  select * into p from public.paiements where id = p_id and etablissement_id = v_etab for update;
  if p.id is null then raise exception 'Encaissement introuvable.' using errcode = 'P0001'; end if;
  if p.annule_paiement_id is not null then raise exception 'Une contre-écriture ne s''annule pas.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.paiements where annule_paiement_id = p.id) then raise exception 'Cet encaissement est déjà annulé.' using errcode = 'P0001'; end if;
  if not (public.a_droit_finance('validation')
          or (public.a_droit_finance('caisse') and p.saisi_par = auth.uid() and p.cree_le > now() - interval '24 hours')) then
    raise exception 'Annulation réservée à la validation (ou à l''auteur de l''encaissement dans les 24 heures).' using errcode = '42501';
  end if;
  perform public._exiger_offre(v_etab, 'finances');
  if char_length(btrim(coalesce(p_motif, ''))) < 3 then raise exception 'Le motif d''annulation est obligatoire.' using errcode = 'P0001'; end if;
  insert into public.paiements (etablissement_id, inscription_id, categorie_id, montant, date_paiement, mode, reference, observation, payeur,
                                compte_id, annule_paiement_id, motif_annulation)
  values (v_etab, p.inscription_id, p.categorie_id, -p.montant, public._aujourdhui(), p.mode, p.reference, format('Annulation du reçu n° %s', p.numero),
          p.payeur, p.compte_id, p.id, left(btrim(p_motif), 300))
  returning id, numero into r;
  perform public._finance_journaliser('annulation encaissement', 'paiement', p.id, jsonb_build_object('numero', p.numero, 'contre_ecriture', r.numero, 'motif', left(btrim(p_motif), 300)));
  return json_build_object('id', r.id, 'numero', r.numero);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Paiements en attente (mobile money, chèque…) : jamais comptés comme encaissés avant confirmation
-- ---------------------------------------------------------------------------------------------------------
create table public.paiements_attente (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null,
  inscription_id uuid not null,
  categorie_id uuid,
  montant integer not null check (montant between 1 and 100000000),
  mode text not null check (mode in ('especes', 'mtn_momo', 'orange_money', 'mobile_money', 'virement', 'cheque', 'carte', 'autre')),
  reference text not null default '' check (char_length(reference) <= 80),
  payeur text not null default '' check (char_length(payeur) <= 120),
  observation text not null default '' check (char_length(observation) <= 200),
  compte_id uuid,
  cle_idempotence text,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'confirme', 'rejete')),
  paiement_id uuid unique references public.paiements (id),
  cree_par uuid default auth.uid(),
  cree_le timestamptz not null default now(),
  traite_par uuid,
  traite_le timestamptz,
  motif text check (char_length(motif) <= 300),
  foreign key (inscription_id, etablissement_id) references public.inscriptions (id, etablissement_id) on delete cascade,
  foreign key (categorie_id, etablissement_id) references public.frais_categories (id, etablissement_id),
  foreign key (compte_id, etablissement_id) references public.comptes_financiers (id, etablissement_id)
);
create unique index paiements_attente_idempotence on public.paiements_attente (etablissement_id, cle_idempotence) where cle_idempotence is not null;
alter table public.paiements_attente enable row level security;
revoke all on public.paiements_attente from anon, authenticated;
grant select on public.paiements_attente to authenticated;
create policy "lecture par la comptabilité" on public.paiements_attente for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.peut_finance()));
alter table public.paiements drop constraint if exists paiements_attente_fkey;
alter table public.paiements add constraint paiements_attente_fkey foreign key (attente_id) references public.paiements_attente (id);

create or replace function public.finance_attente_traiter(p_id uuid, p_confirmer boolean, p_motif text, p_date date default null) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._finance_exiger('caisse'); a public.paiements_attente; r record;
begin
  select * into a from public.paiements_attente where id = p_id and etablissement_id = v_etab for update;
  if a.id is null or a.statut <> 'en_attente' then raise exception 'Paiement en attente introuvable ou déjà traité.' using errcode = 'P0001'; end if;
  if not p_confirmer then
    if char_length(btrim(coalesce(p_motif, ''))) < 3 then raise exception 'Le motif du rejet est obligatoire.' using errcode = 'P0001'; end if;
    update public.paiements_attente set statut = 'rejete', traite_par = auth.uid(), traite_le = now(), motif = left(btrim(p_motif), 300) where id = a.id;
    perform public._finance_journaliser('rejet paiement en attente', 'paiement_attente', a.id, jsonb_build_object('motif', left(btrim(p_motif), 300)));
    return json_build_object('statut', 'rejete');
  end if;
  insert into public.paiements (etablissement_id, inscription_id, categorie_id, montant, date_paiement, mode, reference, observation, payeur, compte_id, attente_id)
  values (v_etab, a.inscription_id, a.categorie_id, a.montant, coalesce(p_date, public._aujourdhui()), a.mode, a.reference, a.observation, a.payeur, a.compte_id, a.id)
  returning id, numero, code_verif into r;
  update public.paiements_attente set statut = 'confirme', paiement_id = r.id, traite_par = auth.uid(), traite_le = now(), motif = nullif(left(btrim(coalesce(p_motif, '')), 300), '')
   where id = a.id;
  perform public._finance_journaliser('confirmation paiement en attente', 'paiement', r.id, jsonb_build_object('numero', r.numero, 'montant', a.montant));
  return json_build_object('statut', 'confirme', 'id', r.id, 'numero', r.numero, 'code_verif', r.code_verif);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Pension : une seule règle de calcul (reprise de 0011), étendue aux remises.
--  * montant brut de chaque échéance : comme avant (l'écart pension / total saisi est porté sur l'inscription) ;
--  * les remises de pension réduisent les échéances en partant de la dernière (une bourse allège la fin de l'année) ;
--  * seuls les encaissements de pension (catégorie nulle, contre-écritures comprises) sont imputés, dans l'ordre des échéances.
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._pension_lignes(p_etab uuid, p_insc uuid)
returns table (inscription_id uuid, eleve_id uuid, echeance_id uuid, rang smallint, libelle text, date_limite date,
               montant bigint, brut bigint, pension bigint, remise bigint)
language sql stable security definer set search_path = '' as $$
  with ex as (select x.id from public.exercices x where x.etablissement_id = p_etab and x.actif),
  f as (select fs.* from public.frais_scolarite fs join ex on ex.id = fs.exercice_id),
  ech as (select e.* from public.echeances e join ex on ex.id = e.exercice_id),
  tot as (select sum(montant) total, count(*) n from ech),
  ins as (select i.id, i.eleve_id, (case when i.nouveau then f.pension_nouveaux else f.pension_anciens end)::bigint pension
            from public.inscriptions i join ex on ex.id = i.exercice_id cross join f where p_insc is null or i.id = p_insc),
  ins2 as (select ins.*, public._remise_totale(ins.id, null, ins.pension) remise from ins),
  lig as (select ins2.id ins_id, ins2.eleve_id, ech.id ec_id, ech.rang, ech.libelle, ech.date_limite, ins2.pension, ins2.remise,
                 (ech.montant + case when ech.rang = 0 then ins2.pension - tot.total else 0 end)::bigint brut
            from ins2 cross join tot cross join ech where tot.n = 5),
  lig2 as (select l.*, coalesce(sum(l.brut) over (partition by l.ins_id order by l.rang desc rows between unbounded preceding and 1 preceding), 0) cum_apres
             from lig l)
  select l.ins_id, l.eleve_id, l.ec_id, l.rang, l.libelle, l.date_limite,
         (l.brut - least(greatest(l.remise - l.cum_apres, 0), l.brut))::bigint, l.brut, l.pension, l.remise
    from lig2 l
$$;

create or replace function public._tranches_situation(p_etab uuid, p_date date, p_insc uuid)
returns table (inscription_id uuid, eleve_id uuid, echeance_id uuid, rang smallint, libelle text, date_limite date, montant bigint, paye bigint, reste bigint)
language sql stable security definer set search_path = '' as $$
  with lig as (select * from public._pension_lignes(p_etab, p_insc)),
  pay as (select p.inscription_id, sum(p.montant) paye from public.paiements p
           where p.etablissement_id = p_etab and p.categorie_id is null and p.date_paiement <= p_date
             and (p_insc is null or p.inscription_id = p_insc) group by p.inscription_id),
  lig2 as (select l.*, coalesce(sum(l.montant) over (partition by l.inscription_id order by l.rang rows between unbounded preceding and 1 preceding), 0) cum_avant
             from lig l)
  select l.inscription_id, l.eleve_id, l.echeance_id, l.rang, l.libelle, l.date_limite, l.montant,
         least(greatest(coalesce(p.paye, 0) - l.cum_avant, 0), l.montant)::bigint,
         (l.montant - least(greatest(coalesce(p.paye, 0) - l.cum_avant, 0), l.montant))::bigint
    from lig2 l left join pay p on p.inscription_id = l.inscription_id
$$;

create or replace function public._en_regle(p_inscription uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with e as (select etablissement_id from public.inscriptions where id = p_inscription),
       t as (select s.* from e cross join lateral public._tranches_situation(e.etablissement_id, public._aujourdhui(), p_inscription) s)
  select case when (select count(*) from t) = 0 then null
              else coalesce((select sum(reste) from t where date_limite < public._aujourdhui()), 0) = 0 end
$$;

create or replace function public.finance_eleves(p_classe uuid default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); ex uuid; f record; jour date := public._aujourdhui(); r json;
begin
  if not public.peut_finance() then raise exception 'Réservé à l''administration et à la comptabilité.' using errcode = '42501'; end if;
  select id into ex from public.exercices where etablissement_id = v_etab and actif;
  select * into f from public.frais_scolarite where exercice_id = ex;
  if ex is null or f.exercice_id is null or (select count(*) from public.echeances where exercice_id = ex) <> 5 then
    return json_build_object('configure', false, 'aujourdhui', jour, 'eleves', '[]'::json);
  end if;
  with ins as (
    select i.id, i.nouveau, el.matricule, el.nom, el.prenom, el.sexe, c.id classe_id, c.libelle classe, c.ordre classe_ordre, c.cycle,
           s.id section_id, s.libelle section
      from public.inscriptions i join public.eleves el on el.id = i.eleve_id join public.classes c on c.id = i.classe_id
      left join public.sections s on s.id = c.section_id
     where i.exercice_id = ex and (p_classe is null or i.classe_id = p_classe)),
  pl as (select l.* from public._pension_lignes(v_etab, null) l where l.inscription_id in (select id from ins)),
  tete as (select distinct on (inscription_id) inscription_id, pension, remise from pl order by inscription_id),
  pay as (
    select p.inscription_id, sum(p.montant) paye, max(p.date_paiement) filter (where p.annule_paiement_id is null) derniere,
           coalesce(json_agg(json_build_object('id', p.id, 'numero', p.numero, 'montant', p.montant, 'date', p.date_paiement, 'mode', p.mode,
                    'reference', p.reference, 'observation', p.observation, 'payeur', p.payeur, 'cree_le', p.cree_le, 'code_verif', p.code_verif,
                    'saisi_par', (select public._libelle(x.nom, x.prenom) from public.personnels x where x.id = p.saisi_par),
                    'annule', exists (select 1 from public.paiements a where a.annule_paiement_id = p.id),
                    'annulable', not exists (select 1 from public.paiements a where a.annule_paiement_id = p.id)
                                 and (public.a_droit_finance('validation') or (p.saisi_par = auth.uid() and p.cree_le > now() - interval '24 hours')))
                    order by p.date_paiement, p.numero) filter (where p.annule_paiement_id is null), '[]'::json) liste
      from public.paiements p where p.categorie_id is null and p.inscription_id in (select id from ins) group by p.inscription_id),
  lig2 as (
    select l.*, coalesce(sum(l.montant) over (partition by l.inscription_id order by l.rang rows between unbounded preceding and 1 preceding), 0) cum_avant
      from pl l),
  lig3 as (
    select l.*, least(greatest(coalesce(p.paye, 0) - l.cum_avant, 0), l.montant) paye_ligne from lig2 l left join pay p on p.inscription_id = l.inscription_id),
  syn as (
    select inscription_id ins_id,
           json_agg(json_build_object('rang', rang, 'libelle', libelle, 'montant', montant, 'brut', brut, 'date_limite', date_limite, 'paye', paye_ligne,
                    'reste', montant - paye_ligne, 'echue', date_limite < jour, 'en_retard', date_limite < jour and paye_ligne < montant) order by rang) lignes,
           coalesce(sum(montant) filter (where date_limite < jour), 0) du_echu,
           min(date_limite) filter (where date_limite < jour and paye_ligne < montant) premier_retard,
           coalesce(sum(montant - paye_ligne) filter (where date_limite < jour), 0) montant_retard,
           (array_agg(json_build_object('libelle', libelle, 'reste', montant - paye_ligne, 'date_limite', date_limite) order by rang)
              filter (where paye_ligne < montant))[1] prochaine,
           string_agg(libelle, ', ' order by rang) filter (where date_limite < jour and paye_ligne < montant) tranches_en_retard
      from lig3 group by inscription_id)
  select json_build_object('configure', true, 'aujourdhui', jour,
    'frais', json_build_object('pension_nouveaux', f.pension_nouveaux, 'pension_anciens', f.pension_anciens),
    'eleves', coalesce(json_agg(json_build_object(
      'inscription_id', ins.id, 'matricule', ins.matricule, 'nom', ins.nom, 'prenom', ins.prenom, 'sexe', ins.sexe, 'nouveau', ins.nouveau,
      'classe_id', ins.classe_id, 'classe', ins.classe, 'cycle', ins.cycle, 'section_id', ins.section_id, 'section', ins.section,
      'pension', t.pension, 'remise', t.remise, 'total_du', t.pension - t.remise, 'paye', coalesce(p.paye, 0),
      'reste', greatest(t.pension - t.remise - coalesce(p.paye, 0), 0),
      'trop_percu', greatest(coalesce(p.paye, 0) - (t.pension - t.remise), 0), 'derniere_date', p.derniere,
      'du_echu', syn.du_echu, 'retard', syn.montant_retard, 'en_regle', syn.montant_retard = 0,
      'statut', case when coalesce(p.paye, 0) >= t.pension - t.remise then 'solde' when syn.montant_retard > 0 then 'en_retard' else 'a_jour' end,
      'tranches_en_retard', syn.tranches_en_retard, 'premier_retard', syn.premier_retard,
      'jours_retard', case when syn.premier_retard is not null then jour - syn.premier_retard end,
      'prochaine', syn.prochaine, 'lignes', syn.lignes, 'paiements', coalesce(p.liste, '[]'::json))
      order by ins.classe_ordre, ins.classe, ins.nom, ins.prenom), '[]'::json))
    into r
    from ins join tete t on t.inscription_id = ins.id left join pay p on p.inscription_id = ins.id join syn on syn.ins_id = ins.id;
  return r;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Autres frais (catégories) : dû = factures actives - remises ; retard selon les tranches de la catégorie
-- (sans tranche : exigible à l'émission de la facture pour une dette antérieure, sinon pas de retard).
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._frais_situation(p_etab uuid, p_insc uuid)
returns table (inscription_id uuid, categorie_id uuid, libelle text, nature text, brut bigint, remise bigint, du bigint, paye bigint,
               reste bigint, retard bigint, factures json)
language sql stable security definer set search_path = '' as $$
  with fa as (select f.* from public.factures f where f.etablissement_id = p_etab and f.categorie_id is not null and f.annulee_le is null
                and (p_insc is null or f.inscription_id = p_insc)),
  b as (select fa.inscription_id, fa.categorie_id, sum(fa.montant_brut)::bigint brut,
               json_agg(json_build_object('id', fa.id, 'numero', fa.numero, 'montant_brut', fa.montant_brut, 'emise_le', fa.emise_le, 'code_verif', fa.code_verif)) factures
          from fa group by fa.inscription_id, fa.categorie_id),
  b2 as (select b.*, public._remise_totale(b.inscription_id, b.categorie_id, b.brut) remise from b),
  pay as (select p.inscription_id, p.categorie_id, sum(p.montant)::bigint paye from public.paiements p
           where p.etablissement_id = p_etab and p.categorie_id is not null and (p_insc is null or p.inscription_id = p_insc)
           group by p.inscription_id, p.categorie_id),
  ech as (select t.categorie_id, coalesce(sum(t.pourcentage) filter (where t.date_limite < public._aujourdhui()), 0) pct, count(*) n
            from public.frais_tranches t where t.etablissement_id = p_etab group by t.categorie_id)
  select b2.inscription_id, b2.categorie_id, c.libelle, c.nature, b2.brut, b2.remise, b2.brut - b2.remise, coalesce(pay.paye, 0),
         greatest(b2.brut - b2.remise - coalesce(pay.paye, 0), 0),
         greatest(case when coalesce(ech.n, 0) > 0 then round((b2.brut - b2.remise) * ech.pct / 100.0)::bigint
                       when c.nature = 'dette_anterieure' then b2.brut - b2.remise else 0 end - coalesce(pay.paye, 0), 0),
         b2.factures
    from b2 join public.frais_categories c on c.id = b2.categorie_id
    left join pay on pay.inscription_id = b2.inscription_id and pay.categorie_id = b2.categorie_id
    left join ech on ech.categorie_id = b2.categorie_id
$$;

/**
 * Émettre les factures d'une rubrique (nulle = pension) pour une classe ou une liste d'élèves. Sans doublon : un élève qui a
 * déjà une facture active pour la rubrique est ignoré. Montant : pension de la catégorie de l'élève, montant de la classe
 * (ou « toutes classes ») pour une catégorie, montant saisi pour une dette antérieure.
 */
create or replace function public.finance_facturer(p jsonb) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._finance_exiger('facturation'); ex uuid; v_cat uuid := nullif(p ->> 'categorie_id', '')::uuid; c public.frais_categories;
        v_classe uuid := nullif(p ->> 'classe_id', '')::uuid; v_ins uuid[]; i record; v_montant bigint; n_crees int := 0; n_ignores int := 0;
        v_num int; fs record; v_lib text;
begin
  select id into ex from public.exercices where etablissement_id = v_etab and actif;
  if ex is null then raise exception 'Aucun exercice actif.' using errcode = 'P0001'; end if;
  if v_cat is not null then
    select * into c from public.frais_categories where id = v_cat and etablissement_id = v_etab and exercice_id = ex;
    if c.id is null then raise exception 'Rubrique introuvable pour l''année en cours.' using errcode = 'P0001'; end if;
    if not c.actif then raise exception 'Rubrique désactivée.' using errcode = 'P0001'; end if;
    v_lib := c.libelle;
  else
    select * into fs from public.frais_scolarite where exercice_id = ex;
    if fs.exercice_id is null then raise exception 'Configurez d''abord la pension (Frais et délais).' using errcode = 'P0001'; end if;
    v_lib := 'Pension / scolarité';
  end if;
  select array_agg(x::uuid) into v_ins from jsonb_array_elements_text(coalesce(p -> 'inscriptions', '[]')) x;
  if v_ins is null and v_classe is null then raise exception 'Choisissez une classe ou des élèves.' using errcode = 'P0001'; end if;
  if c.id is not null and (c.nature = 'dette_anterieure' or not c.obligatoire) and v_ins is null then
    raise exception 'Cette rubrique se facture élève par élève.' using errcode = 'P0001';
  end if;
  if c.nature = 'dette_anterieure' and coalesce((p ->> 'montant')::bigint, 0) <= 0 then
    raise exception 'Indiquez le montant de la dette antérieure.' using errcode = 'P0001';
  end if;
  for i in select ins.id, ins.classe_id, ins.nouveau from public.inscriptions ins
            where ins.etablissement_id = v_etab and ins.exercice_id = ex
              and (v_ins is null or ins.id = any (v_ins)) and (v_classe is null or ins.classe_id = v_classe) loop
    if exists (select 1 from public.factures f where f.inscription_id = i.id and f.categorie_id is not distinct from v_cat and f.annulee_le is null) then
      n_ignores := n_ignores + 1; continue;
    end if;
    if v_cat is null then
      v_montant := case when i.nouveau then fs.pension_nouveaux else fs.pension_anciens end;
    elsif c.nature = 'dette_anterieure' or (p ->> 'montant') is not null then
      v_montant := (p ->> 'montant')::bigint;
    else
      select m.montant into v_montant from public.frais_montants m where m.categorie_id = v_cat and (m.classe_id = i.classe_id or m.classe_id is null)
       order by m.classe_id nulls last limit 1;
      if v_montant is null then n_ignores := n_ignores + 1; continue; end if;
    end if;
    if v_montant < 0 then raise exception 'Montant invalide.' using errcode = 'P0001'; end if;
    perform pg_advisory_xact_lock(hashtext('facture:' || v_etab::text));
    v_num := coalesce((select max(numero) from public.factures where etablissement_id = v_etab), 0) + 1;
    insert into public.factures (etablissement_id, exercice_id, inscription_id, categorie_id, numero, libelle, montant_brut)
    values (v_etab, ex, i.id, v_cat, v_num, left(coalesce(nullif(btrim(p ->> 'libelle'), ''), v_lib), 200), v_montant);
    n_crees := n_crees + 1;
    v_montant := null;
  end loop;
  perform public._finance_journaliser('facturation', 'factures', v_cat, jsonb_build_object('rubrique', v_lib, 'crees', n_crees, 'ignores', n_ignores));
  return json_build_object('crees', n_crees, 'ignores', n_ignores);
end $$;

create or replace function public.finance_facture_annuler(p_id uuid, p_motif text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._finance_exiger('validation'); f public.factures; paye bigint;
begin
  select * into f from public.factures where id = p_id and etablissement_id = v_etab and annulee_le is null for update;
  if f.id is null then raise exception 'Facture introuvable ou déjà annulée.' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p_motif, ''))) < 3 then raise exception 'Le motif d''annulation est obligatoire.' using errcode = 'P0001'; end if;
  if f.categorie_id is not null then
    select coalesce(sum(montant), 0) into paye from public.paiements where inscription_id = f.inscription_id and categorie_id = f.categorie_id;
    if paye > 0 then raise exception 'Des encaissements existent pour cette rubrique : annulez-les d''abord.' using errcode = 'P0001'; end if;
  end if;
  update public.factures set annulee_le = now(), annulee_par = auth.uid(), motif_annulation = left(btrim(p_motif), 300) where id = f.id;
  perform public._finance_journaliser('annulation facture', 'facture', f.id, jsonb_build_object('numero', f.numero, 'motif', left(btrim(p_motif), 300)));
end $$;

/** Recherche d'élèves pour la caisse : nom, prénom, matricule ou classe ; reste à payer (pension + autres frais). */
create or replace function public.finance_rechercher(p_q text, p_classe uuid default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public._finance_lire('caisse', 'facturation', 'validation', 'tresorerie', 'rapports'); ex uuid; q text := public._normaliser(coalesce(p_q, ''));
begin
  select id into ex from public.exercices where etablissement_id = v_etab and actif;
  if ex is null then return '[]'::json; end if;
  if char_length(q) < 2 and p_classe is null then return '[]'::json; end if;
  return (with ins as (
      select i.id, el.matricule, el.nom, el.prenom, c.libelle classe, c.ordre
        from public.inscriptions i join public.eleves el on el.id = i.eleve_id join public.classes c on c.id = i.classe_id
       where i.exercice_id = ex and (p_classe is null or i.classe_id = p_classe)
         and (char_length(q) < 2 or public._normaliser(el.nom || ' ' || coalesce(el.prenom, '')) like '%' || q || '%'
              or public._normaliser(coalesce(el.prenom, '') || ' ' || el.nom) like '%' || q || '%'
              or public._normaliser(coalesce(el.matricule, '')) = q or public._normaliser(c.libelle) = q)
       order by c.ordre, c.libelle, el.nom, el.prenom limit 60)
    select coalesce(json_agg(json_build_object('inscription_id', ins.id, 'matricule', ins.matricule, 'nom', ins.nom, 'prenom', ins.prenom,
             'classe', ins.classe,
             'reste_pension', coalesce((select sum(t.reste) from public._tranches_situation(v_etab, public._aujourdhui(), ins.id) t), 0),
             'reste_autres', coalesce((select sum(s.reste) from public._frais_situation(v_etab, ins.id) s), 0))), '[]'::json)
      from ins);
end $$;

/** Dossier financier complet d'un élève (caisse) : pension, autres frais, factures, remises, encaissements, attentes. */
create or replace function public.finance_situation_eleve(p_insc uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public._finance_lire('caisse', 'facturation', 'validation', 'tresorerie', 'rapports'); i record; jour date := public._aujourdhui();
begin
  select ins.id, ins.exercice_id, el.matricule, el.nom, el.prenom, c.libelle classe, x.libelle annee, ins.nouveau into i
    from public.inscriptions ins join public.eleves el on el.id = ins.eleve_id join public.classes c on c.id = ins.classe_id
    join public.exercices x on x.id = ins.exercice_id
   where ins.id = p_insc and ins.etablissement_id = v_etab;
  if i.id is null then raise exception 'Élève introuvable.' using errcode = 'P0001'; end if;
  return json_build_object(
    'eleve', json_build_object('inscription_id', i.id, 'matricule', i.matricule, 'nom', i.nom, 'prenom', i.prenom, 'classe', i.classe,
                               'annee', i.annee, 'nouveau', i.nouveau),
    'pension', (select json_build_object('lignes', coalesce(json_agg(json_build_object('rang', t.rang, 'libelle', t.libelle, 'date_limite', t.date_limite,
                  'montant', t.montant, 'paye', t.paye, 'reste', t.reste, 'en_retard', t.date_limite < jour and t.reste > 0) order by t.rang), '[]'::json),
                  'du', coalesce(sum(t.montant), 0), 'paye', coalesce(sum(t.paye), 0), 'reste', coalesce(sum(t.reste), 0),
                  'retard', coalesce(sum(t.reste) filter (where t.date_limite < jour), 0),
                  'brut', (select max(l.pension) from public._pension_lignes(v_etab, p_insc) l),
                  'remise', (select max(l.remise) from public._pension_lignes(v_etab, p_insc) l))
                from public._tranches_situation(v_etab, '9999-12-31'::date, p_insc) t),
    'autres', (select coalesce(json_agg(json_build_object('categorie_id', s.categorie_id, 'libelle', s.libelle, 'nature', s.nature, 'brut', s.brut,
                  'remise', s.remise, 'du', s.du, 'paye', s.paye, 'reste', s.reste, 'retard', s.retard, 'factures', s.factures) order by s.libelle), '[]'::json)
                from public._frais_situation(v_etab, p_insc) s),
    'factures', (select coalesce(json_agg(json_build_object('id', f.id, 'numero', f.numero, 'categorie_id', f.categorie_id, 'libelle', f.libelle,
                  'montant_brut', f.montant_brut, 'emise_le', f.emise_le, 'annulee_le', f.annulee_le, 'code_verif', f.code_verif) order by f.numero), '[]'::json)
                from public.factures f where f.inscription_id = p_insc),
    'remises', (select coalesce(json_agg(json_build_object('id', r.id, 'categorie_id', r.categorie_id, 'nature', r.nature, 'type', r.type, 'valeur', r.valeur,
                  'motif', r.motif, 'accorde_le', r.accorde_le, 'accorde_par', (select public._libelle(x.nom, x.prenom) from public.personnels x where x.id = r.accorde_par),
                  'annulee_le', r.annulee_le, 'motif_annulation', r.motif_annulation) order by r.accorde_le), '[]'::json)
                from public.finance_remises r where r.inscription_id = p_insc),
    'paiements', (select coalesce(json_agg(json_build_object('id', p.id, 'numero', p.numero, 'categorie_id', p.categorie_id,
                  'rubrique', coalesce((select c.libelle from public.frais_categories c where c.id = p.categorie_id), 'Pension / scolarité'),
                  'montant', p.montant, 'date', p.date_paiement, 'mode', p.mode, 'reference', p.reference, 'payeur', p.payeur, 'observation', p.observation,
                  'code_verif', p.code_verif, 'cree_le', p.cree_le, 'compte_id', p.compte_id,
                  'saisi_par', (select public._libelle(x.nom, x.prenom) from public.personnels x where x.id = p.saisi_par),
                  'annule_paiement_id', p.annule_paiement_id, 'motif_annulation', p.motif_annulation,
                  'annule', exists (select 1 from public.paiements a where a.annule_paiement_id = p.id),
                  'annulable', p.annule_paiement_id is null and not exists (select 1 from public.paiements a where a.annule_paiement_id = p.id)
                               and (public.a_droit_finance('validation') or (p.saisi_par = auth.uid() and p.cree_le > now() - interval '24 hours')))
                  order by p.numero), '[]'::json)
                from public.paiements p where p.inscription_id = p_insc),
    'attentes', (select coalesce(json_agg(json_build_object('id', a.id, 'montant', a.montant, 'mode', a.mode, 'reference', a.reference, 'statut', a.statut,
                  'cree_le', a.cree_le, 'categorie_id', a.categorie_id) order by a.cree_le), '[]'::json)
                from public.paiements_attente a where a.inscription_id = p_insc));
end $$;

/** Historique des encaissements avec filtres (période, mode, rubrique, agent, classe). */
create or replace function public.finance_encaissements(p jsonb) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public._finance_lire('caisse', 'validation', 'tresorerie', 'rapports');
        d1 date := coalesce(nullif(p ->> 'debut', '')::date, public._aujourdhui() - 30); d2 date := coalesce(nullif(p ->> 'fin', '')::date, public._aujourdhui());
begin
  return (select coalesce(json_agg(json_build_object('id', x.id, 'numero', x.numero, 'date', x.date_paiement, 'montant', x.montant, 'mode', x.mode,
            'reference', x.reference, 'payeur', x.payeur, 'eleve', public._libelle(el.nom, el.prenom), 'matricule', el.matricule, 'classe', c.libelle,
            'rubrique', coalesce(fc.libelle, 'Pension / scolarité'), 'categorie_id', x.categorie_id, 'inscription_id', x.inscription_id,
            'agent', (select public._libelle(pe.nom, pe.prenom) from public.personnels pe where pe.id = x.saisi_par), 'code_verif', x.code_verif,
            'compte', (select cf.libelle from public.comptes_financiers cf where cf.id = x.compte_id),
            'contre_ecriture', x.annule_paiement_id is not null, 'motif_annulation', x.motif_annulation,
            'annule', exists (select 1 from public.paiements a where a.annule_paiement_id = x.id)) order by x.numero desc), '[]'::json)
    from (select * from public.paiements pa where pa.etablissement_id = v_etab and pa.date_paiement between d1 and d2
            and (nullif(p ->> 'mode', '') is null or pa.mode = p ->> 'mode')
            and (nullif(p ->> 'agent', '') is null or pa.saisi_par = (p ->> 'agent')::uuid)
            and (not (p ? 'categorie_id') or pa.categorie_id is not distinct from nullif(p ->> 'categorie_id', '')::uuid)
            and (nullif(p ->> 'classe_id', '') is null
                 or exists (select 1 from public.inscriptions ci where ci.id = pa.inscription_id and ci.classe_id = (p ->> 'classe_id')::uuid))
          order by pa.numero desc limit 2000) x
    join public.inscriptions i on i.id = x.inscription_id join public.eleves el on el.id = i.eleve_id join public.classes c on c.id = i.classe_id
    left join public.frais_categories fc on fc.id = x.categorie_id
   where nullif(p ->> 'classe_id', '') is null or i.classe_id = (p ->> 'classe_id')::uuid);
end $$;

/** Paiements en attente de confirmation (et derniers traités), avec l'élève et la rubrique. */
create or replace function public.finance_attentes() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public._finance_lire('caisse', 'validation', 'tresorerie', 'rapports');
begin
  return (select coalesce(json_agg(json_build_object('id', a.id, 'inscription_id', a.inscription_id, 'eleve', public._libelle(el.nom, el.prenom),
            'matricule', el.matricule, 'classe', c.libelle, 'rubrique', coalesce(fc.libelle, 'Pension / scolarité'), 'montant', a.montant, 'mode', a.mode,
            'reference', a.reference, 'payeur', a.payeur, 'statut', a.statut, 'cree_le', a.cree_le, 'motif', a.motif, 'traite_le', a.traite_le,
            'cree_par', (select public._libelle(x.nom, x.prenom) from public.personnels x where x.id = a.cree_par)) order by a.statut <> 'en_attente', a.cree_le desc), '[]'::json)
    from (select * from public.paiements_attente pa where pa.etablissement_id = v_etab
            and (pa.statut = 'en_attente' or pa.traite_le > now() - interval '30 days') order by pa.cree_le desc limit 500) a
    join public.inscriptions i on i.id = a.inscription_id join public.eleves el on el.id = i.eleve_id join public.classes c on c.id = i.classe_id
    left join public.frais_categories fc on fc.id = a.categorie_id);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Trésorerie : journal des mouvements (alimenté uniquement par déclencheurs), virements, clôtures, rapprochement
-- ---------------------------------------------------------------------------------------------------------
create table public.mouvements_tresorerie (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null,
  compte_id uuid not null,
  date_mouvement date not null,
  montant bigint not null check (montant <> 0),                   -- positif : entrée ; négatif : sortie
  nature text not null check (nature in ('encaissement', 'annulation_encaissement', 'depense', 'annulation_depense',
                                         'virement_sortant', 'virement_entrant')),
  source_type text not null check (source_type in ('paiement', 'depense', 'depense_annulation', 'virement')),
  source_id uuid not null,
  libelle text not null default '' check (char_length(libelle) <= 200),
  paie boolean not null default false,                              -- paiement de salaire : détail réservé au droit « paie »
  cree_par uuid,
  cree_le timestamptz not null default now(),
  unique (source_type, source_id, compte_id),
  unique (id, etablissement_id),
  foreign key (compte_id, etablissement_id) references public.comptes_financiers (id, etablissement_id)
);
create index on public.mouvements_tresorerie (compte_id, date_mouvement);
alter table public.mouvements_tresorerie enable row level security;
revoke all on public.mouvements_tresorerie from anon, authenticated;
grant select on public.mouvements_tresorerie to authenticated;
create policy "lecture par la trésorerie" on public.mouvements_tresorerie for select to authenticated
  using (etablissement_id = (select public.etab_courant())
         and ((select public.a_droit_finance('tresorerie')) or (select public.a_droit_finance('rapports')) or (select public.a_droit_finance('validation')))
         and (not paie or (select public.a_droit_finance('paie'))));

-- Une journée clôturée d'un compte ne reçoit plus de mouvement
create or replace function public._mouvement_controle() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.clotures_caisse c where c.compte_id = new.compte_id and c.date_cloture >= new.date_mouvement) then
    raise exception 'La caisse « % » est clôturée au % : enregistrez l''opération à une date ultérieure.',
      (select libelle from public.comptes_financiers where id = new.compte_id), new.date_mouvement using errcode = 'P0001';
  end if;
  new.cree_par := auth.uid();
  new.cree_le := now();
  return new;
end $$;
create trigger mouvement_controle before insert on public.mouvements_tresorerie for each row execute function public._mouvement_controle();

create or replace function public._paiement_vers_tresorerie() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.compte_id is not null then
    insert into public.mouvements_tresorerie (etablissement_id, compte_id, date_mouvement, montant, nature, source_type, source_id, libelle)
    values (new.etablissement_id, new.compte_id, new.date_paiement, new.montant,
            case when new.annule_paiement_id is null then 'encaissement' else 'annulation_encaissement' end, 'paiement', new.id,
            case when new.annule_paiement_id is null then format('Reçu n° %s', new.numero) else format('Annulation (contre-écriture n° %s)', new.numero) end);
  end if;
  return null;
end $$;
create trigger paiement_tresorerie after insert on public.paiements for each row execute function public._paiement_vers_tresorerie();

create or replace function public._solde_compte(p_compte uuid, p_date date) returns bigint
language sql stable security definer set search_path = '' as $$
  select c.solde_initial + coalesce((select sum(m.montant) from public.mouvements_tresorerie m
                                      where m.compte_id = c.id and m.date_mouvement >= c.date_solde_initial and m.date_mouvement <= p_date), 0)
    from public.comptes_financiers c where c.id = p_compte
$$;

create or replace function public.finance_compte_enregistrer(p jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._finance_exiger('tresorerie'); v_id uuid := nullif(p ->> 'id', '')::uuid; m text[];
begin
  select coalesce(array_agg(x), '{}') into m from jsonb_array_elements_text(coalesce(p -> 'modes', '[]')) x;
  if not (m <@ public._modes_paiement()) then raise exception 'Mode de paiement inconnu.' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p ->> 'libelle', ''))) = 0 then raise exception 'Le libellé est obligatoire.' using errcode = 'P0001'; end if;
  if coalesce((p ->> 'par_defaut')::boolean, false) then
    update public.comptes_financiers set par_defaut = false where etablissement_id = v_etab and id is distinct from v_id;
  end if;
  if v_id is null then
    insert into public.comptes_financiers (etablissement_id, libelle, type, numero, modes, solde_initial, date_solde_initial, devise, par_defaut)
    values (v_etab, btrim(p ->> 'libelle'), p ->> 'type', left(btrim(coalesce(p ->> 'numero', '')), 60), m, coalesce((p ->> 'solde_initial')::bigint, 0),
            coalesce(nullif(p ->> 'date_solde_initial', '')::date, public._aujourdhui()),
            coalesce((select devise from public.finance_parametres where etablissement_id = v_etab), 'XAF'), coalesce((p ->> 'par_defaut')::boolean, false))
    returning id into v_id;
  else
    -- le solde initial et sa date ne changent plus une fois des mouvements enregistrés (les soldes en dépendent)
    if exists (select 1 from public.mouvements_tresorerie where compte_id = v_id)
       and exists (select 1 from public.comptes_financiers where id = v_id
                    and (solde_initial <> coalesce((p ->> 'solde_initial')::bigint, solde_initial)
                         or date_solde_initial <> coalesce(nullif(p ->> 'date_solde_initial', '')::date, date_solde_initial))) then
      raise exception 'Le solde initial ne peut plus être modifié : des mouvements existent sur ce compte.' using errcode = 'P0001';
    end if;
    update public.comptes_financiers set libelle = btrim(p ->> 'libelle'), type = coalesce(p ->> 'type', type), numero = left(btrim(coalesce(p ->> 'numero', '')), 60),
           modes = m, solde_initial = coalesce((p ->> 'solde_initial')::bigint, solde_initial),
           date_solde_initial = coalesce(nullif(p ->> 'date_solde_initial', '')::date, date_solde_initial),
           par_defaut = coalesce((p ->> 'par_defaut')::boolean, par_defaut), actif = coalesce((p ->> 'actif')::boolean, actif)
     where id = v_id and etablissement_id = v_etab;
    if not found then raise exception 'Compte introuvable.' using errcode = 'P0001'; end if;
  end if;
  perform public._finance_journaliser('compte', 'compte_financier', v_id, jsonb_build_object('libelle', p ->> 'libelle', 'type', p ->> 'type'));
  return v_id;
end $$;

create or replace function public.finance_tresorerie() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public._finance_lire('tresorerie', 'rapports', 'validation', 'caisse', 'depenses'); jour date := public._aujourdhui(); voir_soldes boolean;
begin
  voir_soldes := public._droits_finance(auth.uid()) && array['tresorerie', 'rapports', 'validation']::text[];
  return json_build_object('aujourdhui', jour, 'comptes', (select coalesce(json_agg(json_build_object(
      'id', c.id, 'libelle', c.libelle, 'type', c.type, 'numero', c.numero, 'modes', c.modes, 'devise', c.devise, 'par_defaut', c.par_defaut,
      'actif', c.actif, 'solde_initial', case when voir_soldes then c.solde_initial end, 'date_solde_initial', c.date_solde_initial,
      'solde', case when voir_soldes then public._solde_compte(c.id, jour) end,
      'derniere_cloture', (select max(k.date_cloture) from public.clotures_caisse k where k.compte_id = c.id))
      order by c.actif desc, c.par_defaut desc, c.libelle), '[]'::json) from public.comptes_financiers c where c.etablissement_id = v_etab));
end $$;

create or replace function public.finance_mouvements(p_compte uuid, p_debut date, p_fin date) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public._finance_lire('tresorerie', 'rapports', 'validation');
begin
  if not exists (select 1 from public.comptes_financiers where id = p_compte and etablissement_id = v_etab) then
    raise exception 'Compte introuvable.' using errcode = 'P0001';
  end if;
  return json_build_object('solde_debut', public._solde_compte(p_compte, p_debut - 1), 'solde_fin', public._solde_compte(p_compte, p_fin),
    'mouvements', (with m as (select x.* from public.mouvements_tresorerie x join public.comptes_financiers c on c.id = x.compte_id
                               where x.compte_id = p_compte and x.date_mouvement between greatest(p_debut, c.date_solde_initial) and p_fin),
                        -- sans droit « paie » : salaires regroupés par jour, sans détail par personne
                        v as (select m.id, m.date_mouvement, m.montant, m.nature, m.libelle, m.source_type, m.source_id, m.cree_le,
                                     exists (select 1 from public.lignes_releve l where l.mouvement_id = m.id) rapproche
                                from m where not m.paie or public.a_droit_finance('paie')
                              union all
                              select null, m.date_mouvement, sum(m.montant), 'depense', 'Salaires (détail réservé au droit « paie »)', 'paie', null, max(m.cree_le), false
                                from m where m.paie and not public.a_droit_finance('paie') group by m.date_mouvement)
                   select coalesce(json_agg(json_build_object('id', coalesce(v.id::text, 'paie-' || v.date_mouvement), 'date', v.date_mouvement, 'montant', v.montant,
                            'nature', v.nature, 'libelle', v.libelle, 'source_type', v.source_type, 'source_id', v.source_id, 'rapproche', v.rapproche)
                            order by v.date_mouvement, v.cree_le), '[]'::json) from v));
end $$;

-- Virements internes (caisse → banque…) : deux mouvements, jamais comptés comme recette ou dépense
create table public.virements_tresorerie (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null,
  compte_source uuid not null,
  compte_destination uuid not null,
  montant bigint not null check (montant between 1 and 1000000000000),
  date_virement date not null,
  motif text not null default '' check (char_length(motif) <= 200),
  reference text not null default '' check (char_length(reference) <= 80),
  cree_par uuid default auth.uid(),
  cree_le timestamptz not null default now(),
  check (compte_source <> compte_destination),
  foreign key (compte_source, etablissement_id) references public.comptes_financiers (id, etablissement_id),
  foreign key (compte_destination, etablissement_id) references public.comptes_financiers (id, etablissement_id)
);
alter table public.virements_tresorerie enable row level security;
revoke all on public.virements_tresorerie from anon, authenticated;
grant select on public.virements_tresorerie to authenticated;
create policy "lecture par la trésorerie" on public.virements_tresorerie for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and ((select public.a_droit_finance('tresorerie')) or (select public.a_droit_finance('rapports'))));

create or replace function public.finance_virement(p jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._finance_exiger('tresorerie'); v_id uuid; s public.comptes_financiers; d public.comptes_financiers;
        v_montant bigint := (p ->> 'montant')::bigint; v_date date := coalesce(nullif(p ->> 'date', '')::date, public._aujourdhui());
begin
  select * into s from public.comptes_financiers where id = (p ->> 'compte_source')::uuid and etablissement_id = v_etab and actif;
  select * into d from public.comptes_financiers where id = (p ->> 'compte_destination')::uuid and etablissement_id = v_etab and actif;
  if s.id is null or d.id is null then raise exception 'Comptes source et destination actifs obligatoires.' using errcode = 'P0001'; end if;
  if s.id = d.id then raise exception 'Les deux comptes doivent être différents.' using errcode = 'P0001'; end if;
  if coalesce(v_montant, 0) <= 0 then raise exception 'Le montant doit être positif.' using errcode = 'P0001'; end if;
  if v_date > public._aujourdhui() then raise exception 'La date ne peut pas être dans le futur.' using errcode = 'P0001'; end if;
  if s.devise <> d.devise then raise exception 'Les deux comptes doivent avoir la même devise.' using errcode = 'P0001'; end if;
  perform 1 from public.comptes_financiers where id = s.id for update;
  if s.type = 'caisse' and public._solde_compte(s.id, v_date) < v_montant then
    raise exception 'Solde insuffisant dans la caisse « % ».', s.libelle using errcode = 'P0001';
  end if;
  insert into public.virements_tresorerie (etablissement_id, compte_source, compte_destination, montant, date_virement, motif, reference)
  values (v_etab, s.id, d.id, v_montant, v_date, left(btrim(coalesce(p ->> 'motif', '')), 200), left(btrim(coalesce(p ->> 'reference', '')), 80))
  returning id into v_id;
  insert into public.mouvements_tresorerie (etablissement_id, compte_id, date_mouvement, montant, nature, source_type, source_id, libelle)
  values (v_etab, s.id, v_date, -v_montant, 'virement_sortant', 'virement', v_id, format('Virement vers %s', d.libelle)),
         (v_etab, d.id, v_date, v_montant, 'virement_entrant', 'virement', v_id, format('Virement depuis %s', s.libelle));
  perform public._finance_journaliser('virement', 'virement', v_id, jsonb_build_object('montant', v_montant, 'source', s.libelle, 'destination', d.libelle));
  return v_id;
end $$;

-- Clôture journalière (caisse ou tout compte) : solde théorique, solde constaté, écart justifié ; définitive
create table public.clotures_caisse (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null,
  compte_id uuid not null,
  date_cloture date not null,
  solde_theorique bigint not null,
  solde_constate bigint not null,
  ecart bigint generated always as (solde_constate - solde_theorique) stored,
  justification text not null default '' check (char_length(justification) <= 500),
  billetage jsonb,
  cloture_par uuid default auth.uid(),
  cree_le timestamptz not null default now(),
  unique (compte_id, date_cloture),
  foreign key (compte_id, etablissement_id) references public.comptes_financiers (id, etablissement_id)
);
alter table public.clotures_caisse enable row level security;
revoke all on public.clotures_caisse from anon, authenticated;
grant select on public.clotures_caisse to authenticated;
create policy "lecture par la trésorerie" on public.clotures_caisse for select to authenticated
  using (etablissement_id = (select public.etab_courant())
         and ((select public.a_droit_finance('tresorerie')) or (select public.a_droit_finance('rapports')) or (select public.a_droit_finance('validation'))));

create or replace function public.finance_cloturer(p jsonb) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._finance_exiger('tresorerie'); c public.comptes_financiers; v_date date := coalesce(nullif(p ->> 'date', '')::date, public._aujourdhui());
        theo bigint; constate bigint := (p ->> 'solde_constate')::bigint; v_id uuid; v_just text := btrim(coalesce(p ->> 'justification', ''));
begin
  -- verrou du compte : aucune écriture ne s'intercale entre le calcul du solde théorique et la clôture
  select * into c from public.comptes_financiers where id = (p ->> 'compte_id')::uuid and etablissement_id = v_etab for update;
  if c.id is null then raise exception 'Compte introuvable.' using errcode = 'P0001'; end if;
  if v_date > public._aujourdhui() then raise exception 'On ne clôture pas une journée future.' using errcode = 'P0001'; end if;
  if v_date < c.date_solde_initial then raise exception 'Date antérieure au solde initial du compte.' using errcode = 'P0001'; end if;
  if constate is null then raise exception 'Indiquez le solde constaté (comptage).' using errcode = 'P0001'; end if;
  if exists (select 1 from public.clotures_caisse where compte_id = c.id and date_cloture >= v_date) then
    raise exception 'Cette journée (ou une journée postérieure) est déjà clôturée.' using errcode = 'P0001';
  end if;
  theo := public._solde_compte(c.id, v_date);
  if constate <> theo and char_length(v_just) < 5 then
    raise exception 'Écart de % FCFA : une justification est obligatoire.', constate - theo using errcode = 'P0001';
  end if;
  insert into public.clotures_caisse (etablissement_id, compte_id, date_cloture, solde_theorique, solde_constate, justification, billetage)
  values (v_etab, c.id, v_date, theo, constate, left(v_just, 500), case when jsonb_typeof(p -> 'billetage') = 'object' then p -> 'billetage' end)
  returning id into v_id;
  perform public._finance_journaliser('clôture', 'cloture_caisse', v_id, jsonb_build_object('compte', c.libelle, 'date', v_date, 'ecart', constate - theo));
  return json_build_object('id', v_id, 'solde_theorique', theo, 'solde_constate', constate, 'ecart', constate - theo);
end $$;

-- Rapprochement bancaire : relevé importé (CSV lu par le navigateur), suggestions, confirmation manuelle obligatoire
create table public.lignes_releve (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null,
  compte_id uuid not null,
  date_operation date not null,
  libelle text not null default '' check (char_length(libelle) <= 200),
  reference text not null default '' check (char_length(reference) <= 80),
  montant bigint not null check (montant <> 0),
  empreinte text not null,
  importe_par uuid default auth.uid(),
  importe_le timestamptz not null default now(),
  mouvement_id uuid unique,
  rapproche_par uuid,
  rapproche_le timestamptz,
  unique (compte_id, empreinte),
  foreign key (compte_id, etablissement_id) references public.comptes_financiers (id, etablissement_id),
  foreign key (mouvement_id, etablissement_id) references public.mouvements_tresorerie (id, etablissement_id)
);
alter table public.lignes_releve enable row level security;
revoke all on public.lignes_releve from anon, authenticated;
grant select on public.lignes_releve to authenticated;
create policy "lecture par la trésorerie" on public.lignes_releve for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and ((select public.a_droit_finance('tresorerie')) or (select public.a_droit_finance('rapports'))));

/** Import d'un relevé : les lignes déjà importées (même date, montant, libellé, référence et rang) sont ignorées. */
create or replace function public.finance_releve_importer(p_compte uuid, p_lignes jsonb) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._finance_exiger('tresorerie'); l jsonb; n_ok int := 0; n_doublons int := 0; n_erreurs int := 0; emp text; k int := 0;
begin
  if not exists (select 1 from public.comptes_financiers where id = p_compte and etablissement_id = v_etab) then
    raise exception 'Compte introuvable.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) > 5000 then
    raise exception 'Relevé invalide (5 000 lignes au plus).' using errcode = 'P0001';
  end if;
  for l in select * from jsonb_array_elements(p_lignes) loop
    k := k + 1;
    begin
      if (l ->> 'date') is null or coalesce((l ->> 'montant')::bigint, 0) = 0 then n_erreurs := n_erreurs + 1; continue; end if;
      emp := md5(concat_ws('|', l ->> 'date', (l ->> 'montant')::bigint, public._normaliser(coalesce(l ->> 'libelle', '')),
                           btrim(coalesce(l ->> 'reference', '')), coalesce(l ->> 'occurrence', '1')));
      insert into public.lignes_releve (etablissement_id, compte_id, date_operation, libelle, reference, montant, empreinte)
      values (v_etab, p_compte, (l ->> 'date')::date, left(btrim(coalesce(l ->> 'libelle', '')), 200), left(btrim(coalesce(l ->> 'reference', '')), 80),
              (l ->> 'montant')::bigint, emp)
      on conflict (compte_id, empreinte) do nothing;
      if found then n_ok := n_ok + 1; else n_doublons := n_doublons + 1; end if;
    exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
      n_erreurs := n_erreurs + 1;
    end;
  end loop;
  perform public._finance_journaliser('import relevé', 'compte_financier', p_compte, jsonb_build_object('importees', n_ok, 'doublons', n_doublons, 'erreurs', n_erreurs));
  return json_build_object('importees', n_ok, 'doublons', n_doublons, 'erreurs', n_erreurs);
end $$;

/** Lignes du relevé et suggestions (même montant, dates à ± 7 jours, mouvement non encore rapproché). Rien n'est rapproché automatiquement. */
create or replace function public.finance_rapprochement(p_compte uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public._finance_lire('tresorerie', 'rapports');
begin
  if not exists (select 1 from public.comptes_financiers where id = p_compte and etablissement_id = v_etab) then
    raise exception 'Compte introuvable.' using errcode = 'P0001';
  end if;
  return json_build_object(
    'lignes', (select coalesce(json_agg(json_build_object('id', l.id, 'date', l.date_operation, 'libelle', l.libelle, 'reference', l.reference,
                'montant', l.montant, 'mouvement_id', l.mouvement_id, 'rapproche_le', l.rapproche_le,
                'suggestions', case when l.mouvement_id is null then (select coalesce(json_agg(json_build_object('id', m.id, 'date', m.date_mouvement,
                    'libelle', m.libelle, 'montant', m.montant, 'ecart_jours', abs(m.date_mouvement - l.date_operation)) order by abs(m.date_mouvement - l.date_operation)), '[]'::json)
                  from public.mouvements_tresorerie m where m.compte_id = l.compte_id and m.montant = l.montant and (not m.paie or public.a_droit_finance('paie'))
                   and abs(m.date_mouvement - l.date_operation) <= 7 and not exists (select 1 from public.lignes_releve x where x.mouvement_id = m.id)) end)
                order by l.date_operation, l.importe_le), '[]'::json) from public.lignes_releve l where l.compte_id = p_compte),
    'mouvements_non_rapproches', (select count(*) from public.mouvements_tresorerie m where m.compte_id = p_compte
                                   and not exists (select 1 from public.lignes_releve x where x.mouvement_id = m.id)));
end $$;

create or replace function public.finance_rapprocher(p_ligne uuid, p_mouvement uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._finance_exiger('tresorerie'); l public.lignes_releve; m public.mouvements_tresorerie;
begin
  select * into l from public.lignes_releve where id = p_ligne and etablissement_id = v_etab for update;
  if l.id is null then raise exception 'Ligne de relevé introuvable.' using errcode = 'P0001'; end if;
  if p_mouvement is null then
    update public.lignes_releve set mouvement_id = null, rapproche_par = null, rapproche_le = null where id = l.id;
    perform public._finance_journaliser('annulation rapprochement', 'ligne_releve', l.id, '{}');
    return;
  end if;
  select * into m from public.mouvements_tresorerie where id = p_mouvement and etablissement_id = v_etab;
  if m.id is null or m.compte_id <> l.compte_id then raise exception 'Mouvement introuvable sur ce compte.' using errcode = 'P0001'; end if;
  if m.montant <> l.montant then raise exception 'Les montants diffèrent : rapprochement refusé.' using errcode = 'P0001'; end if;
  if l.mouvement_id is not null then raise exception 'Cette ligne est déjà rapprochée.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.lignes_releve where mouvement_id = m.id) then raise exception 'Ce mouvement est déjà rapproché.' using errcode = 'P0001'; end if;
  update public.lignes_releve set mouvement_id = m.id, rapproche_par = auth.uid(), rapproche_le = now() where id = l.id;
  perform public._finance_journaliser('rapprochement', 'ligne_releve', l.id, jsonb_build_object('mouvement', m.id));
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Dépenses et fournisseurs. Circuit : brouillon → en_attente → approuvee | rejetee ; approuvee → payee ; annulation tracée.
-- Seule une dépense payée sort de la trésorerie. Les dépenses de salaires (liées à la paie) restent réservées au droit « paie ».
-- ---------------------------------------------------------------------------------------------------------
create table public.depenses_categories (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  libelle text not null check (char_length(btrim(libelle)) between 1 and 80),
  actif boolean not null default true,
  systeme text check (systeme in ('salaires')),
  unique (etablissement_id, libelle),
  unique (id, etablissement_id)
);
create unique index depenses_categories_systeme on public.depenses_categories (etablissement_id, systeme) where systeme is not null;
create table public.fournisseurs (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  nom text not null check (char_length(btrim(nom)) between 1 and 120),
  contact text not null default '' check (char_length(contact) <= 120),
  telephone text not null default '' check (char_length(telephone) <= 40),
  email text not null default '' check (char_length(email) <= 120),
  adresse text not null default '' check (char_length(adresse) <= 200),
  identifiant_fiscal text not null default '' check (char_length(identifiant_fiscal) <= 60),
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  unique (etablissement_id, nom),
  unique (id, etablissement_id)
);
create table public.depenses (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null,
  numero integer not null,
  categorie_id uuid not null,
  fournisseur_id uuid,
  libelle text not null check (char_length(btrim(libelle)) between 1 and 200),
  montant bigint not null check (montant between 1 and 1000000000000),
  date_depense date not null,
  statut text not null default 'brouillon' check (statut in ('brouillon', 'en_attente', 'approuvee', 'rejetee', 'payee', 'annulee')),
  justificatif text check (char_length(justificatif) <= 300),
  observation text not null default '' check (char_length(observation) <= 300),
  compte_id uuid,
  mode text check (mode in ('especes', 'mtn_momo', 'orange_money', 'mobile_money', 'virement', 'cheque', 'carte', 'autre')),
  reference_paiement text not null default '' check (char_length(reference_paiement) <= 80),
  date_paiement date,
  paie_id uuid unique,
  cree_par uuid default auth.uid(),
  cree_le timestamptz not null default now(),
  soumise_le timestamptz,
  valide_par uuid,
  valide_le timestamptz,
  motif_rejet text check (char_length(motif_rejet) <= 300),
  paye_par uuid,
  paye_le timestamptz,
  annule_par uuid,
  annule_le timestamptz,
  motif_annulation text check (char_length(motif_annulation) <= 300),
  payee_avant_annulation boolean not null default false,
  unique (etablissement_id, numero),
  foreign key (categorie_id, etablissement_id) references public.depenses_categories (id, etablissement_id),
  foreign key (fournisseur_id, etablissement_id) references public.fournisseurs (id, etablissement_id),
  foreign key (compte_id, etablissement_id) references public.comptes_financiers (id, etablissement_id),
  check (statut <> 'payee' or (compte_id is not null and date_paiement is not null))
);
create index on public.depenses (etablissement_id, statut);
alter table public.depenses_categories enable row level security;
alter table public.fournisseurs enable row level security;
alter table public.depenses enable row level security;
revoke all on public.depenses_categories, public.fournisseurs, public.depenses from anon, authenticated;
grant select on public.depenses_categories, public.fournisseurs, public.depenses to authenticated;
create policy "lecture" on public.depenses_categories for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.mes_droits_finance()) && array['depenses', 'validation', 'tresorerie', 'rapports', 'paie']::text[]);
create policy "lecture" on public.fournisseurs for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.mes_droits_finance()) && array['depenses', 'validation', 'tresorerie', 'rapports']::text[]);
create policy "lecture" on public.depenses for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.mes_droits_finance()) && array['depenses', 'validation', 'tresorerie', 'rapports']::text[]
         and (paie_id is null or (select public.a_droit_finance('paie'))));

create or replace function public._depense_vers_tresorerie() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.statut = 'payee' and (tg_op = 'INSERT' or old.statut <> 'payee') then
    insert into public.mouvements_tresorerie (etablissement_id, compte_id, date_mouvement, montant, nature, source_type, source_id, libelle, paie)
    values (new.etablissement_id, new.compte_id, new.date_paiement, -new.montant, 'depense', 'depense', new.id,
            case when new.paie_id is null then format('Dépense n° %s : %s', new.numero, left(new.libelle, 150)) else 'Salaires' end, new.paie_id is not null);
  elsif tg_op = 'UPDATE' and old.statut = 'payee' and new.statut = 'annulee' then
    insert into public.mouvements_tresorerie (etablissement_id, compte_id, date_mouvement, montant, nature, source_type, source_id, libelle, paie)
    values (new.etablissement_id, new.compte_id, public._aujourdhui(), new.montant, 'annulation_depense', 'depense_annulation', new.id,
            case when new.paie_id is null then format('Annulation de la dépense n° %s', new.numero) else 'Annulation de salaires' end, new.paie_id is not null);
  end if;
  return null;
end $$;
create trigger depense_tresorerie after insert or update of statut on public.depenses for each row execute function public._depense_vers_tresorerie();

create or replace function public.finance_fournisseur_enregistrer(p jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._finance_exiger('depenses'); v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  if char_length(btrim(coalesce(p ->> 'nom', ''))) = 0 then raise exception 'Le nom du fournisseur est obligatoire.' using errcode = 'P0001'; end if;
  if v_id is null then
    insert into public.fournisseurs (etablissement_id, nom, contact, telephone, email, adresse, identifiant_fiscal)
    values (v_etab, btrim(p ->> 'nom'), left(btrim(coalesce(p ->> 'contact', '')), 120), left(btrim(coalesce(p ->> 'telephone', '')), 40),
            left(btrim(coalesce(p ->> 'email', '')), 120), left(btrim(coalesce(p ->> 'adresse', '')), 200), left(btrim(coalesce(p ->> 'identifiant_fiscal', '')), 60))
    returning id into v_id;
  else
    update public.fournisseurs set nom = btrim(p ->> 'nom'), contact = left(btrim(coalesce(p ->> 'contact', '')), 120),
           telephone = left(btrim(coalesce(p ->> 'telephone', '')), 40), email = left(btrim(coalesce(p ->> 'email', '')), 120),
           adresse = left(btrim(coalesce(p ->> 'adresse', '')), 200), identifiant_fiscal = left(btrim(coalesce(p ->> 'identifiant_fiscal', '')), 60),
           actif = coalesce((p ->> 'actif')::boolean, actif)
     where id = v_id and etablissement_id = v_etab;
    if not found then raise exception 'Fournisseur introuvable.' using errcode = 'P0001'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.finance_depense_categorie_enregistrer(p jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._finance_exiger('depenses'); v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  if char_length(btrim(coalesce(p ->> 'libelle', ''))) = 0 then raise exception 'Le libellé est obligatoire.' using errcode = 'P0001'; end if;
  if v_id is null then
    insert into public.depenses_categories (etablissement_id, libelle) values (v_etab, btrim(p ->> 'libelle')) returning id into v_id;
  else
    update public.depenses_categories set libelle = btrim(p ->> 'libelle'), actif = coalesce((p ->> 'actif')::boolean, actif)
     where id = v_id and etablissement_id = v_etab and systeme is null;
    if not found then raise exception 'Catégorie introuvable (ou catégorie système non modifiable).' using errcode = 'P0001'; end if;
  end if;
  return v_id;
end $$;

/** Créer ou modifier une dépense (brouillon ou rejetée). p.soumettre = vrai : envoyée directement en validation. */
create or replace function public.finance_depense_enregistrer(p jsonb) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._finance_exiger('depenses'); v_id uuid := nullif(p ->> 'id', '')::uuid; d public.depenses; v_num int;
        v_just text := nullif(btrim(coalesce(p ->> 'justificatif', '')), '');
begin
  if coalesce((p ->> 'montant')::bigint, 0) <= 0 then raise exception 'Le montant doit être positif.' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p ->> 'libelle', ''))) = 0 then raise exception 'Le libellé est obligatoire.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.depenses_categories where id = (p ->> 'categorie_id')::uuid and etablissement_id = v_etab and actif and systeme is null) then
    raise exception 'Catégorie de dépense invalide.' using errcode = 'P0001';
  end if;
  if v_just is not null and v_just not like v_etab::text || '/depenses/%' then raise exception 'Justificatif invalide.' using errcode = 'P0001'; end if;
  if v_id is null then
    perform pg_advisory_xact_lock(hashtext('depense:' || v_etab::text));
    v_num := coalesce((select max(numero) from public.depenses where etablissement_id = v_etab), 0) + 1;
    insert into public.depenses (etablissement_id, numero, categorie_id, fournisseur_id, libelle, montant, date_depense, justificatif, observation)
    values (v_etab, v_num, (p ->> 'categorie_id')::uuid, nullif(p ->> 'fournisseur_id', '')::uuid, btrim(p ->> 'libelle'), (p ->> 'montant')::bigint,
            coalesce(nullif(p ->> 'date_depense', '')::date, public._aujourdhui()), v_just, left(btrim(coalesce(p ->> 'observation', '')), 300))
    returning * into d;
  else
    select * into d from public.depenses where id = v_id and etablissement_id = v_etab for update;
    if d.id is null or d.paie_id is not null then raise exception 'Dépense introuvable.' using errcode = 'P0001'; end if;
    if d.statut not in ('brouillon', 'rejetee') then raise exception 'Seule une dépense en brouillon ou rejetée se modifie.' using errcode = 'P0001'; end if;
    update public.depenses set categorie_id = (p ->> 'categorie_id')::uuid, fournisseur_id = nullif(p ->> 'fournisseur_id', '')::uuid,
           libelle = btrim(p ->> 'libelle'), montant = (p ->> 'montant')::bigint, date_depense = coalesce(nullif(p ->> 'date_depense', '')::date, date_depense),
           justificatif = coalesce(v_just, justificatif), observation = left(btrim(coalesce(p ->> 'observation', '')), 300), statut = 'brouillon', motif_rejet = null
     where id = v_id returning * into d;
  end if;
  if coalesce((p ->> 'soumettre')::boolean, false) then
    update public.depenses set statut = 'en_attente', soumise_le = now() where id = d.id returning * into d;
  end if;
  perform public._finance_journaliser(case when v_id is null then 'création dépense' else 'modification dépense' end, 'depense', d.id,
                                      jsonb_build_object('numero', d.numero, 'montant', d.montant, 'statut', d.statut));
  return json_build_object('id', d.id, 'numero', d.numero, 'statut', d.statut);
end $$;

/** Actions du circuit : soumettre, approuver, rejeter, payer, annuler. */
create or replace function public.finance_depense_action(p_id uuid, p_action text, p jsonb default '{}') returns json
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); d public.depenses; v_motif text := btrim(coalesce(p ->> 'motif', '')); c public.comptes_financiers;
        v_date date;
begin
  select * into d from public.depenses where id = p_id and etablissement_id = v_etab for update;
  if d.id is null then raise exception 'Dépense introuvable.' using errcode = 'P0001'; end if;
  if d.paie_id is not null and p_action <> 'annuler' then raise exception 'Une dépense de salaire se gère depuis la paie.' using errcode = 'P0001'; end if;
  if p_action = 'soumettre' then
    perform public._finance_exiger('depenses');
    if d.statut not in ('brouillon', 'rejetee') then raise exception 'Seul un brouillon se soumet.' using errcode = 'P0001'; end if;
    update public.depenses set statut = 'en_attente', soumise_le = now(), motif_rejet = null where id = d.id;
  elsif p_action in ('approuver', 'rejeter') then
    perform public._finance_exiger('validation');
    if d.statut <> 'en_attente' then raise exception 'Seule une dépense en attente se valide ou se rejette.' using errcode = 'P0001'; end if;
    if d.cree_par = auth.uid() and not public.est_admin() then
      raise exception 'Vous ne pouvez pas valider votre propre dépense.' using errcode = '42501';
    end if;
    if p_action = 'rejeter' and char_length(v_motif) < 3 then raise exception 'Le motif du rejet est obligatoire.' using errcode = 'P0001'; end if;
    update public.depenses set statut = case when p_action = 'approuver' then 'approuvee' else 'rejetee' end, valide_par = auth.uid(), valide_le = now(),
           motif_rejet = case when p_action = 'rejeter' then left(v_motif, 300) end where id = d.id;
  elsif p_action = 'payer' then
    perform public._finance_exiger('tresorerie');
    if d.statut <> 'approuvee' then raise exception 'Seule une dépense approuvée se paie.' using errcode = 'P0001'; end if;
    select * into c from public.comptes_financiers where id = (p ->> 'compte_id')::uuid and etablissement_id = v_etab and actif for update;
    if c.id is null then raise exception 'Choisissez le compte de paiement.' using errcode = 'P0001'; end if;
    v_date := coalesce(nullif(p ->> 'date', '')::date, public._aujourdhui());
    if v_date > public._aujourdhui() then raise exception 'La date de paiement ne peut pas être dans le futur.' using errcode = 'P0001'; end if;
    if c.type = 'caisse' and public._solde_compte(c.id, v_date) < d.montant then
      raise exception 'Solde insuffisant dans la caisse « % ».', c.libelle using errcode = 'P0001';
    end if;
    update public.depenses set statut = 'payee', compte_id = c.id, date_paiement = v_date, mode = coalesce(nullif(p ->> 'mode', ''), 'especes'),
           reference_paiement = left(btrim(coalesce(p ->> 'reference', '')), 80), paye_par = auth.uid(), paye_le = now() where id = d.id;
  elsif p_action = 'annuler' then
    if d.statut in ('annulee', 'rejetee') then raise exception 'Dépense déjà close.' using errcode = 'P0001'; end if;
    if d.statut = 'payee' or d.paie_id is not null then perform public._finance_exiger('validation');
    elsif not (public.a_droit_finance('validation') or (d.cree_par = auth.uid() and public.a_droit_finance('depenses'))) then
      raise exception 'Annulation réservée à l''auteur ou à la validation.' using errcode = '42501';
    end if;
    if d.paie_id is not null and exists (select 1 from public.paies where id = d.paie_id and statut <> 'annulee') then
      raise exception 'Annulez la paie correspondante (rubrique Paie).' using errcode = 'P0001';
    end if;
    if char_length(v_motif) < 3 then raise exception 'Le motif d''annulation est obligatoire.' using errcode = 'P0001'; end if;
    update public.depenses set statut = 'annulee', annule_par = auth.uid(), annule_le = now(), motif_annulation = left(v_motif, 300),
           payee_avant_annulation = d.statut = 'payee' where id = d.id;
  else
    raise exception 'Action inconnue.' using errcode = 'P0001';
  end if;
  perform public._finance_journaliser(p_action || ' dépense', 'depense', d.id, jsonb_build_object('numero', d.numero, 'motif', nullif(v_motif, '')));
  return json_build_object('id', d.id, 'statut', (select statut from public.depenses where id = d.id));
end $$;

create or replace function public.finance_depenses(p jsonb) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public._finance_lire('depenses', 'validation', 'tresorerie', 'rapports'); voir_paie boolean := public.a_droit_finance('paie');
begin
  return (select coalesce(json_agg(json_build_object('id', d.id, 'numero', d.numero, 'libelle', d.libelle, 'montant', d.montant, 'date_depense', d.date_depense,
            'statut', d.statut, 'categorie_id', d.categorie_id, 'categorie', dc.libelle, 'fournisseur_id', d.fournisseur_id, 'fournisseur', f.nom,
            'justificatif', d.justificatif, 'observation', d.observation, 'compte_id', d.compte_id, 'compte', cf.libelle, 'mode', d.mode,
            'reference_paiement', d.reference_paiement, 'date_paiement', d.date_paiement, 'paie', d.paie_id is not null,
            'cree_par', (select public._libelle(x.nom, x.prenom) from public.personnels x where x.id = d.cree_par), 'cree_le', d.cree_le, 'mien', d.cree_par = auth.uid(),
            'valide_par', (select public._libelle(x.nom, x.prenom) from public.personnels x where x.id = d.valide_par), 'valide_le', d.valide_le,
            'motif_rejet', d.motif_rejet, 'motif_annulation', d.motif_annulation, 'annule_le', d.annule_le) order by d.numero desc), '[]'::json)
    from public.depenses d join public.depenses_categories dc on dc.id = d.categorie_id
    left join public.fournisseurs f on f.id = d.fournisseur_id left join public.comptes_financiers cf on cf.id = d.compte_id
   where d.etablissement_id = v_etab and (d.paie_id is null or voir_paie)
     and (nullif(p ->> 'statut', '') is null or d.statut = p ->> 'statut')
     and d.date_depense between coalesce(nullif(p ->> 'debut', '')::date, '2000-01-01'::date) and coalesce(nullif(p ->> 'fin', '')::date, '2999-12-31'::date));
end $$;

-- Justificatifs (PDF ou image) : compartiment privé, chemin <etablissement>/depenses/<fichier>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('justificatifs', 'justificatifs', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
create policy "justificatifs : lecture par les finances" on storage.objects for select to authenticated
  using (bucket_id = 'justificatifs' and (storage.foldername(name))[1] = (select public.etab_courant())::text
         and (select public.mes_droits_finance()) && array['depenses', 'validation', 'tresorerie', 'rapports']::text[]);
create policy "justificatifs : ajout par les finances" on storage.objects for insert to authenticated
  with check (bucket_id = 'justificatifs' and (storage.foldername(name))[1] = (select public.etab_courant())::text
              and (storage.foldername(name))[2] = 'depenses' and (select public.a_droit_finance('depenses')));

-- ---------------------------------------------------------------------------------------------------------
-- Paie du personnel (suivi des salaires et bulletins de paie ; ce n'est pas un logiciel de paie certifié).
--  * éléments de paie historisés (base, primes, indemnités, retenues) avec date d'effet ;
--  * paramètres (cotisations, impôts, retenues) saisis par l'établissement : inactifs et « non vérifiés » par défaut,
--    aucune valeur réglementaire fournie ; un bulletin calculé avec un paramètre non vérifié le signale ;
--  * statuts : brouillon → en_verification → validee → payee ; annulee à tout moment (tracé) ;
--  * le paiement crée UNE dépense « Salaires » payée (un seul mouvement de trésorerie, pas de double comptage).
-- ---------------------------------------------------------------------------------------------------------
create table public.paie_parametres (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  libelle text not null check (char_length(btrim(libelle)) between 1 and 120),
  type text not null check (type in ('cotisation_salariale', 'cotisation_patronale', 'impot', 'retenue')),
  mode text not null check (mode in ('taux', 'montant')),
  valeur numeric(14, 4) not null check (valeur >= 0),
  plafond bigint check (plafond > 0),                                -- assiette plafonnée (mode taux)
  actif boolean not null default false,
  verifie boolean not null default false,
  source text not null default '' check (char_length(source) <= 300),
  date_effet date not null,
  verifie_par uuid,
  verifie_le timestamptz,
  cree_par uuid default auth.uid(),
  cree_le timestamptz not null default now(),
  check (mode = 'montant' or valeur <= 100)
);
create table public.paie_elements (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  personnel_id uuid not null references public.personnels (id) on delete cascade,
  type text not null check (type in ('base', 'prime', 'indemnite', 'retenue')),
  libelle text not null check (char_length(btrim(libelle)) between 1 and 120),
  montant bigint not null check (montant between 0 and 1000000000),
  date_effet date not null,
  date_fin date,
  cree_par uuid default auth.uid(),
  cree_le timestamptz not null default now(),
  check (date_fin is null or date_fin >= date_effet - 1)
);
create index on public.paie_elements (personnel_id, date_effet);
create table public.paies (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  personnel_id uuid not null references public.personnels (id),
  periode date not null check (extract(day from periode) = 1),
  numero integer not null,
  statut text not null default 'brouillon' check (statut in ('brouillon', 'en_verification', 'validee', 'payee', 'annulee')),
  brut bigint not null default 0,
  retenues bigint not null default 0,
  net bigint not null default 0,
  charges_patronales bigint not null default 0,
  details jsonb not null default '{}',
  parametres_non_verifies boolean not null default false,
  compte_id uuid,
  date_paiement date,
  depense_id uuid unique,
  code_verif text not null unique default upper(replace(gen_random_uuid()::text, '-', '')),
  cree_par uuid default auth.uid(),
  cree_le timestamptz not null default now(),
  valide_par uuid,
  valide_le timestamptz,
  paye_par uuid,
  paye_le timestamptz,
  annule_par uuid,
  annule_le timestamptz,
  motif_annulation text check (char_length(motif_annulation) <= 300),
  unique (etablissement_id, numero),
  foreign key (compte_id, etablissement_id) references public.comptes_financiers (id, etablissement_id)
);
create unique index paies_une_par_mois on public.paies (personnel_id, periode) where statut <> 'annulee';
alter table public.paie_parametres enable row level security;
alter table public.paie_elements enable row level security;
alter table public.paies enable row level security;
revoke all on public.paie_parametres, public.paie_elements, public.paies from anon, authenticated;
grant select on public.paie_parametres, public.paie_elements, public.paies to authenticated;
create policy "lecture par la paie" on public.paie_parametres for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.a_droit_finance('paie')));
create policy "lecture par la paie" on public.paie_elements for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.a_droit_finance('paie')));
create policy "lecture par la paie" on public.paies for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.a_droit_finance('paie')));

create or replace function public.finance_paie_parametre_enregistrer(p jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._finance_exiger('paie'); v_id uuid := nullif(p ->> 'id', '')::uuid; v_verifie boolean := coalesce((p ->> 'verifie')::boolean, false);
begin
  if char_length(btrim(coalesce(p ->> 'libelle', ''))) = 0 then raise exception 'Le libellé est obligatoire.' using errcode = 'P0001'; end if;
  if v_verifie and char_length(btrim(coalesce(p ->> 'source', ''))) < 3 then
    raise exception 'Indiquez la source officielle (texte, barème, date) avant de marquer le paramètre comme vérifié.' using errcode = 'P0001';
  end if;
  if v_id is null then
    insert into public.paie_parametres (etablissement_id, libelle, type, mode, valeur, plafond, actif, verifie, source, date_effet, verifie_par, verifie_le)
    values (v_etab, btrim(p ->> 'libelle'), p ->> 'type', p ->> 'mode', (p ->> 'valeur')::numeric, nullif(p ->> 'plafond', '')::bigint,
            coalesce((p ->> 'actif')::boolean, false), v_verifie, left(btrim(coalesce(p ->> 'source', '')), 300),
            coalesce(nullif(p ->> 'date_effet', '')::date, public._aujourdhui()), case when v_verifie then auth.uid() end, case when v_verifie then now() end)
    returning id into v_id;
  else
    update public.paie_parametres set libelle = btrim(p ->> 'libelle'), type = p ->> 'type', mode = p ->> 'mode', valeur = (p ->> 'valeur')::numeric,
           plafond = nullif(p ->> 'plafond', '')::bigint, actif = coalesce((p ->> 'actif')::boolean, actif), source = left(btrim(coalesce(p ->> 'source', '')), 300),
           date_effet = coalesce(nullif(p ->> 'date_effet', '')::date, date_effet), verifie = v_verifie,
           verifie_par = case when v_verifie then auth.uid() end, verifie_le = case when v_verifie then now() end
     where id = v_id and etablissement_id = v_etab;
    if not found then raise exception 'Paramètre introuvable.' using errcode = 'P0001'; end if;
  end if;
  perform public._finance_journaliser('paramètre de paie', 'paie_parametre', v_id, jsonb_build_object('libelle', p ->> 'libelle', 'actif', p ->> 'actif', 'verifie', v_verifie));
  return v_id;
end $$;

create or replace function public.finance_paie_element_ajouter(p jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._finance_exiger('paie'); v_id uuid; v_date date := coalesce(nullif(p ->> 'date_effet', '')::date, date_trunc('month', public._aujourdhui())::date);
begin
  if not exists (select 1 from public.personnels where id = (p ->> 'personnel_id')::uuid and etablissement_id = v_etab) then
    raise exception 'Membre du personnel introuvable.' using errcode = 'P0001';
  end if;
  if (p ->> 'type') not in ('base', 'prime', 'indemnite', 'retenue') then raise exception 'Type d''élément inconnu.' using errcode = 'P0001'; end if;
  if coalesce((p ->> 'montant')::bigint, -1) < 0 then raise exception 'Montant invalide.' using errcode = 'P0001'; end if;
  -- nouvelle base : la précédente prend fin la veille (historique conservé)
  if p ->> 'type' = 'base' then
    update public.paie_elements set date_fin = v_date - 1
     where personnel_id = (p ->> 'personnel_id')::uuid and type = 'base' and date_effet < v_date and (date_fin is null or date_fin >= v_date);
    if exists (select 1 from public.paie_elements where personnel_id = (p ->> 'personnel_id')::uuid and type = 'base' and date_effet >= v_date) then
      raise exception 'Un salaire de base existe déjà à cette date ou après.' using errcode = 'P0001';
    end if;
  end if;
  insert into public.paie_elements (etablissement_id, personnel_id, type, libelle, montant, date_effet, date_fin)
  values (v_etab, (p ->> 'personnel_id')::uuid, p ->> 'type', coalesce(nullif(btrim(p ->> 'libelle'), ''), case p ->> 'type' when 'base' then 'Salaire de base' else p ->> 'type' end),
          (p ->> 'montant')::bigint, v_date, nullif(p ->> 'date_fin', '')::date)
  returning id into v_id;
  perform public._finance_journaliser('élément de paie', 'paie_element', v_id, jsonb_build_object('type', p ->> 'type'));
  return v_id;
end $$;

create or replace function public.finance_paie_element_clore(p_id uuid, p_date_fin date) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._finance_exiger('paie');
begin
  update public.paie_elements set date_fin = p_date_fin where id = p_id and etablissement_id = v_etab and p_date_fin >= date_effet - 1;
  if not found then raise exception 'Élément introuvable ou date de fin invalide.' using errcode = 'P0001'; end if;
  perform public._finance_journaliser('fin d''élément de paie', 'paie_element', p_id, '{}');
end $$;

/** Calcul d'un mois : éléments en vigueur à la fin du mois, paramètres actifs à cette date. */
create or replace function public._paie_calcul(p_etab uuid, p_personnel uuid, p_periode date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare fin date := (p_periode + interval '1 month' - interval '1 day')::date; base bigint; gains bigint; ret_el bigint; brut bigint; lignes jsonb;
        sal bigint := 0; pat bigint := 0; nv boolean := false; x record; m bigint;
begin
  select montant into base from public.paie_elements where personnel_id = p_personnel and type = 'base' and date_effet <= fin
     and (date_fin is null or date_fin >= p_periode) order by date_effet desc limit 1;
  if base is null then return null; end if;
  select coalesce(sum(montant) filter (where type in ('prime', 'indemnite')), 0), coalesce(sum(montant) filter (where type = 'retenue'), 0),
         coalesce(jsonb_agg(jsonb_build_object('type', type, 'libelle', libelle, 'montant', montant) order by type, libelle) filter (where type <> 'base'), '[]')
    into gains, ret_el, lignes
    from public.paie_elements where personnel_id = p_personnel and date_effet <= fin and (date_fin is null or date_fin >= p_periode);
  brut := base + gains;
  lignes := jsonb_build_array(jsonb_build_object('type', 'base', 'libelle', 'Salaire de base', 'montant', base)) || lignes;
  for x in select * from public.paie_parametres where etablissement_id = p_etab and actif and date_effet <= fin order by type, libelle loop
    m := case when x.mode = 'taux' then round(least(brut, coalesce(x.plafond, brut)) * x.valeur / 100.0) else round(x.valeur) end;
    if not x.verifie then nv := true; end if;
    lignes := lignes || jsonb_build_object('type', x.type, 'libelle', x.libelle, 'montant', m, 'mode', x.mode, 'valeur', x.valeur, 'verifie', x.verifie);
    if x.type = 'cotisation_patronale' then pat := pat + m; else sal := sal + m; end if;
  end loop;
  return jsonb_build_object('brut', brut, 'retenues', ret_el + sal, 'net', brut - ret_el - sal, 'charges_patronales', pat, 'lignes', lignes,
                            'parametres_non_verifies', nv, 'calcule_le', now());
end $$;

create or replace function public.finance_paie_preparer(p_periode date, p_personnels uuid[] default null) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._finance_exiger('paie'); per date := date_trunc('month', p_periode)::date; x record; c jsonb; n int := 0; ign int := 0; v_num int;
begin
  if per > date_trunc('month', public._aujourdhui())::date + interval '1 month' then raise exception 'Période trop lointaine.' using errcode = 'P0001'; end if;
  for x in select p.id from public.personnels p where p.etablissement_id = v_etab and p.actif and (p_personnels is null or p.id = any (p_personnels)) loop
    if exists (select 1 from public.paies where personnel_id = x.id and periode = per and statut <> 'annulee') then ign := ign + 1; continue; end if;
    c := public._paie_calcul(v_etab, x.id, per);
    if c is null then ign := ign + 1; continue; end if;
    if (c ->> 'net')::bigint <= 0 then raise exception 'Net à payer nul ou négatif pour un membre du personnel : vérifiez ses retenues.' using errcode = 'P0001'; end if;
    perform pg_advisory_xact_lock(hashtext('paie:' || v_etab::text));
    v_num := coalesce((select max(numero) from public.paies where etablissement_id = v_etab), 0) + 1;
    insert into public.paies (etablissement_id, personnel_id, periode, numero, brut, retenues, net, charges_patronales, details, parametres_non_verifies)
    values (v_etab, x.id, per, v_num, (c ->> 'brut')::bigint, (c ->> 'retenues')::bigint, (c ->> 'net')::bigint, (c ->> 'charges_patronales')::bigint, c,
            (c ->> 'parametres_non_verifies')::boolean);
    n := n + 1;
  end loop;
  perform public._finance_journaliser('préparation paie', 'paies', null, jsonb_build_object('periode', per, 'creees', n, 'ignorees', ign));
  return json_build_object('creees', n, 'ignorees', ign);
end $$;

create or replace function public.finance_paie_action(p_id uuid, p_action text, p jsonb default '{}') returns json
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._finance_exiger('paie'); x public.paies; c jsonb; v_cat uuid; v_dep uuid; v_num int; cpt public.comptes_financiers;
        v_date date; v_motif text := btrim(coalesce(p ->> 'motif', ''));
begin
  select * into x from public.paies where id = p_id and etablissement_id = v_etab for update;
  if x.id is null then raise exception 'Paie introuvable.' using errcode = 'P0001'; end if;
  if p_action = 'recalculer' then
    if x.statut <> 'brouillon' then raise exception 'Seul un brouillon se recalcule.' using errcode = 'P0001'; end if;
    c := public._paie_calcul(v_etab, x.personnel_id, x.periode);
    if c is null then raise exception 'Aucun salaire de base en vigueur pour cette période.' using errcode = 'P0001'; end if;
    if (c ->> 'net')::bigint <= 0 then raise exception 'Net à payer nul ou négatif : vérifiez les retenues.' using errcode = 'P0001'; end if;
    update public.paies set brut = (c ->> 'brut')::bigint, retenues = (c ->> 'retenues')::bigint, net = (c ->> 'net')::bigint,
           charges_patronales = (c ->> 'charges_patronales')::bigint, details = c, parametres_non_verifies = (c ->> 'parametres_non_verifies')::boolean where id = x.id;
  elsif p_action = 'soumettre' then
    if x.statut <> 'brouillon' then raise exception 'Seul un brouillon passe en vérification.' using errcode = 'P0001'; end if;
    update public.paies set statut = 'en_verification' where id = x.id;
  elsif p_action = 'renvoyer' then
    if x.statut <> 'en_verification' then raise exception 'Seule une paie en vérification se renvoie en brouillon.' using errcode = 'P0001'; end if;
    update public.paies set statut = 'brouillon' where id = x.id;
  elsif p_action = 'valider' then
    perform public._finance_exiger('validation');
    if x.statut <> 'en_verification' then raise exception 'Seule une paie en vérification se valide.' using errcode = 'P0001'; end if;
    if x.personnel_id = auth.uid() then raise exception 'Vous ne pouvez pas valider votre propre paie.' using errcode = '42501'; end if;
    update public.paies set statut = 'validee', valide_par = auth.uid(), valide_le = now() where id = x.id;
  elsif p_action = 'payer' then
    perform public._finance_exiger('tresorerie');
    if x.statut <> 'validee' then raise exception 'Seule une paie validée se paie.' using errcode = 'P0001'; end if;
    select * into cpt from public.comptes_financiers where id = (p ->> 'compte_id')::uuid and etablissement_id = v_etab and actif for update;
    if cpt.id is null then raise exception 'Choisissez le compte de paiement.' using errcode = 'P0001'; end if;
    v_date := coalesce(nullif(p ->> 'date', '')::date, public._aujourdhui());
    if v_date > public._aujourdhui() then raise exception 'La date de paiement ne peut pas être dans le futur.' using errcode = 'P0001'; end if;
    if cpt.type = 'caisse' and public._solde_compte(cpt.id, v_date) < x.net then
      raise exception 'Solde insuffisant dans la caisse « % ».', cpt.libelle using errcode = 'P0001';
    end if;
    insert into public.depenses_categories (etablissement_id, libelle, systeme) values (v_etab, 'Salaires', 'salaires')
    on conflict (etablissement_id, systeme) where systeme is not null do nothing;
    select id into v_cat from public.depenses_categories where etablissement_id = v_etab and systeme = 'salaires';
    perform pg_advisory_xact_lock(hashtext('depense:' || v_etab::text));
    v_num := coalesce((select max(numero) from public.depenses where etablissement_id = v_etab), 0) + 1;
    insert into public.depenses (etablissement_id, numero, categorie_id, libelle, montant, date_depense, statut, compte_id, mode, reference_paiement,
                                 date_paiement, paie_id, valide_par, valide_le, paye_par, paye_le)
    values (v_etab, v_num, v_cat, format('Salaires %s — bulletin n° %s', to_char(x.periode, 'MM/YYYY'), x.numero), x.net, v_date, 'payee', cpt.id,
            coalesce(nullif(p ->> 'mode', ''), 'virement'), left(btrim(coalesce(p ->> 'reference', '')), 80), v_date, x.id, x.valide_par, x.valide_le, auth.uid(), now())
    returning id into v_dep;
    update public.paies set statut = 'payee', compte_id = cpt.id, date_paiement = v_date, depense_id = v_dep, paye_par = auth.uid(), paye_le = now() where id = x.id;
  elsif p_action = 'annuler' then
    if x.statut = 'annulee' then raise exception 'Paie déjà annulée.' using errcode = 'P0001'; end if;
    if x.statut in ('validee', 'payee') then perform public._finance_exiger('validation'); end if;
    if char_length(v_motif) < 3 then raise exception 'Le motif d''annulation est obligatoire.' using errcode = 'P0001'; end if;
    update public.paies set statut = 'annulee', annule_par = auth.uid(), annule_le = now(), motif_annulation = left(v_motif, 300) where id = x.id;
    if x.depense_id is not null then
      update public.depenses set statut = 'annulee', annule_par = auth.uid(), annule_le = now(), motif_annulation = left(v_motif, 300),
             payee_avant_annulation = statut = 'payee' where id = x.depense_id and statut <> 'annulee';
    end if;
  else
    raise exception 'Action inconnue.' using errcode = 'P0001';
  end if;
  perform public._finance_journaliser(p_action || ' paie', 'paie', x.id, jsonb_build_object('periode', x.periode));  -- aucun montant
  return json_build_object('id', x.id, 'statut', (select statut from public.paies where id = x.id));
end $$;

create or replace function public.finance_paies(p_periode date default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public._finance_lire('paie');
begin
  return json_build_object(
    'paies', (select coalesce(json_agg(json_build_object('id', x.id, 'numero', x.numero, 'periode', x.periode, 'statut', x.statut, 'personnel_id', x.personnel_id,
               'nom', public._libelle(pe.nom, pe.prenom), 'matricule', pe.matricule, 'poste', pe.poste, 'role', pe.role, 'brut', x.brut, 'retenues', x.retenues,
               'net', x.net, 'charges_patronales', x.charges_patronales, 'details', x.details, 'parametres_non_verifies', x.parametres_non_verifies,
               'date_paiement', x.date_paiement, 'code_verif', x.code_verif, 'motif_annulation', x.motif_annulation,
               'compte', (select libelle from public.comptes_financiers where id = x.compte_id)) order by x.periode desc, pe.nom), '[]'::json)
              from public.paies x join public.personnels pe on pe.id = x.personnel_id
             where x.etablissement_id = v_etab and (p_periode is null or x.periode = date_trunc('month', p_periode)::date)),
    'personnel', (select coalesce(json_agg(json_build_object('id', pe.id, 'nom', public._libelle(pe.nom, pe.prenom), 'role', pe.role, 'poste', pe.poste,
               'elements', (select coalesce(json_agg(json_build_object('id', e.id, 'type', e.type, 'libelle', e.libelle, 'montant', e.montant,
                             'date_effet', e.date_effet, 'date_fin', e.date_fin) order by e.type, e.date_effet desc), '[]'::json)
                            from public.paie_elements e where e.personnel_id = pe.id)) order by pe.nom, pe.prenom), '[]'::json)
              from public.personnels pe where pe.etablissement_id = v_etab and pe.actif),
    'parametres', (select coalesce(json_agg(json_build_object('id', a.id, 'libelle', a.libelle, 'type', a.type, 'mode', a.mode, 'valeur', a.valeur,
               'plafond', a.plafond, 'actif', a.actif, 'verifie', a.verifie, 'source', a.source, 'date_effet', a.date_effet) order by a.type, a.libelle), '[]'::json)
              from public.paie_parametres a where a.etablissement_id = v_etab));
end $$;

/** Bulletins de paie de la personne connectée (validés ou payés uniquement). */
create or replace function public.mes_bulletins_paie() returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('id', x.id, 'numero', x.numero, 'periode', x.periode, 'statut', x.statut, 'brut', x.brut, 'retenues', x.retenues,
           'net', x.net, 'details', x.details, 'date_paiement', x.date_paiement, 'code_verif', x.code_verif,
           'parametres_non_verifies', x.parametres_non_verifies) order by x.periode desc), '[]'::json)
    from public.paies x where x.personnel_id = auth.uid() and x.statut in ('validee', 'payee')
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Tableau de bord et rapports (calculés côté serveur à partir des écritures ; aucune valeur stockée en double)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.finance_tableau_bord(p_debut date, p_fin date) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public._finance_lire('rapports', 'validation', 'tresorerie'); jour date := public._aujourdhui();
        d1 date := coalesce(p_debut, date_trunc('month', public._aujourdhui())::date); d2 date := coalesce(p_fin, public._aujourdhui());
        pension record; autres record; r json; voir_paie boolean := public.a_droit_finance('paie');
begin
  if d2 < d1 then raise exception 'Période invalide.' using errcode = 'P0001'; end if;
  select coalesce(sum(t.montant), 0) du, coalesce(sum(t.paye), 0) paye, coalesce(sum(t.reste), 0) reste,
         coalesce(sum(t.reste) filter (where t.date_limite < jour), 0) retard,
         count(distinct t.inscription_id) filter (where t.date_limite < jour and t.reste > 0) eleves_retard
    into pension from public._tranches_situation(v_etab, '9999-12-31'::date, null) t;
  select coalesce(sum(s.du), 0) du, coalesce(sum(s.paye), 0) paye, coalesce(sum(s.reste), 0) reste, coalesce(sum(s.retard), 0) retard,
         coalesce(sum(s.reste) filter (where s.nature = 'dette_anterieure'), 0) dettes
    into autres from public._frais_situation(v_etab, null) s;
  with pa as (select p.*, coalesce(fc.libelle, 'Pension / scolarité') rubrique from public.paiements p left join public.frais_categories fc on fc.id = p.categorie_id
               where p.etablissement_id = v_etab and p.date_paiement between d1 and d2),
       de as (select d.*, dc.libelle categorie from public.depenses d join public.depenses_categories dc on dc.id = d.categorie_id
               where d.etablissement_id = v_etab and d.statut = 'payee' and d.date_paiement between d1 and d2)
  select json_build_object(
    'periode', json_build_object('debut', d1, 'fin', d2), 'aujourdhui', jour,
    'encaissements', json_build_object('total', (select coalesce(sum(montant), 0) from pa),
        'recus', (select count(*) from pa where annule_paiement_id is null), 'annulations', (select count(*) from pa where annule_paiement_id is not null),
        'par_mode', (select coalesce(json_agg(json_build_object('mode', mode, 'montant', m) order by m desc), '[]'::json)
                       from (select mode, sum(montant) m from pa group by mode) z),
        'par_rubrique', (select coalesce(json_agg(json_build_object('rubrique', rubrique, 'montant', m) order by m desc), '[]'::json)
                       from (select rubrique, sum(montant) m from pa group by rubrique) z),
        'par_jour', (select coalesce(json_agg(json_build_object('date', j, 'montant', m) order by j), '[]'::json)
                       from (select date_paiement j, sum(montant) m from pa group by date_paiement) z)),
    'depenses', json_build_object('total', (select coalesce(sum(montant), 0) from de where paie_id is null or voir_paie),
        'salaires', case when voir_paie then (select coalesce(sum(montant), 0) from de where paie_id is not null) end,
        'par_categorie', (select coalesce(json_agg(json_build_object('categorie', categorie, 'montant', m) order by m desc), '[]'::json)
                       from (select categorie, sum(montant) m from de where paie_id is null or voir_paie group by categorie) z),
        'par_jour', (select coalesce(json_agg(json_build_object('date', j, 'montant', m) order by j), '[]'::json)
                       from (select date_paiement j, sum(montant) m from de where paie_id is null or voir_paie group by date_paiement) z),
        'en_attente', (select count(*) from public.depenses where etablissement_id = v_etab and statut = 'en_attente'),
        'a_payer', (select count(*) from public.depenses where etablissement_id = v_etab and statut = 'approuvee')),
    'creances', json_build_object('pension_du', pension.du, 'pension_paye', pension.paye, 'pension_reste', pension.reste, 'pension_retard', pension.retard,
        'eleves_en_retard', pension.eleves_retard, 'autres_du', autres.du, 'autres_paye', autres.paye, 'autres_reste', autres.reste,
        'autres_retard', autres.retard, 'dettes_anterieures', autres.dettes,
        'taux_recouvrement', case when pension.du + autres.du > 0 then round(100.0 * (pension.paye + autres.paye) / (pension.du + autres.du), 1) end),
    'attentes', (select count(*) from public.paiements_attente where etablissement_id = v_etab and statut = 'en_attente'),
    'tresorerie', (select coalesce(json_agg(json_build_object('id', c.id, 'libelle', c.libelle, 'type', c.type, 'solde', public._solde_compte(c.id, jour))
                    order by c.libelle), '[]'::json) from public.comptes_financiers c where c.etablissement_id = v_etab and c.actif),
    'ecarts_caisse', (select coalesce(json_agg(json_build_object('date', k.date_cloture, 'compte', c.libelle, 'ecart', k.ecart) order by k.date_cloture desc), '[]'::json)
                      from public.clotures_caisse k join public.comptes_financiers c on c.id = k.compte_id
                     where k.etablissement_id = v_etab and k.ecart <> 0 and k.date_cloture between d1 and d2),
    'masse_salariale', case when voir_paie then (select json_build_object('brut', coalesce(sum(brut), 0), 'net', coalesce(sum(net), 0), 'bulletins', count(*))
                         from public.paies where etablissement_id = v_etab and statut in ('validee', 'payee') and periode between date_trunc('month', d1)::date and d2) end)
  into r;
  return r;
end $$;

/**
 * Rapports financiers : { titre, colonnes [{cle, libelle, type}], lignes [...], totaux {...} }.
 * Types : journal_encaissements, encaissements_mode, encaissements_classe, impayes, remises, annulations, factures,
 *         depenses_categorie, depenses_fournisseur, journal_tresorerie, clotures, rapprochement, synthese_mensuelle, masse_salariale (droit paie).
 */
create or replace function public.finance_rapport(p_type text, p_debut date, p_fin date, p_compte uuid default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public._finance_lire('rapports', 'validation'); d1 date := coalesce(p_debut, '2000-01-01'::date); d2 date := coalesce(p_fin, public._aujourdhui());
        col json; lig json; tot json; titre text; jour date := public._aujourdhui(); voir_paie boolean := public.a_droit_finance('paie');
begin
  if p_type = 'journal_encaissements' then
    titre := 'Journal des encaissements';
    col := '[{"cle":"date","libelle":"Date","type":"date"},{"cle":"numero","libelle":"Reçu","type":"texte"},{"cle":"eleve","libelle":"Élève","type":"texte"},{"cle":"classe","libelle":"Classe","type":"texte"},{"cle":"rubrique","libelle":"Rubrique","type":"texte"},{"cle":"mode","libelle":"Mode","type":"mode"},{"cle":"agent","libelle":"Agent","type":"texte"},{"cle":"montant","libelle":"Montant","type":"montant"}]';
    select coalesce(json_agg(json_build_object('date', p.date_paiement, 'numero', p.numero::text || case when p.annule_paiement_id is not null then ' (annulation)' else '' end,
             'eleve', public._libelle(el.nom, el.prenom), 'classe', c.libelle, 'rubrique', coalesce(fc.libelle, 'Pension / scolarité'), 'mode', p.mode,
             'agent', (select public._libelle(x.nom, x.prenom) from public.personnels x where x.id = p.saisi_par), 'montant', p.montant) order by p.date_paiement, p.numero), '[]'::json),
           json_build_object('montant', coalesce(sum(p.montant), 0))
      into lig, tot
      from public.paiements p join public.inscriptions i on i.id = p.inscription_id join public.eleves el on el.id = i.eleve_id
      join public.classes c on c.id = i.classe_id left join public.frais_categories fc on fc.id = p.categorie_id
     where p.etablissement_id = v_etab and p.date_paiement between d1 and d2;
  elsif p_type = 'encaissements_mode' then
    titre := 'Encaissements par mode de paiement';
    col := '[{"cle":"mode","libelle":"Mode","type":"mode"},{"cle":"nombre","libelle":"Reçus","type":"nombre"},{"cle":"montant","libelle":"Montant net","type":"montant"}]';
    select coalesce(json_agg(json_build_object('mode', mode, 'nombre', n, 'montant', m) order by m desc), '[]'::json), json_build_object('nombre', sum(n), 'montant', coalesce(sum(m), 0))
      into lig, tot from (select mode, count(*) filter (where annule_paiement_id is null) n, sum(montant) m from public.paiements
                          where etablissement_id = v_etab and date_paiement between d1 and d2 group by mode) z;
  elsif p_type = 'encaissements_classe' then
    titre := 'Encaissements par classe';
    col := '[{"cle":"classe","libelle":"Classe","type":"texte"},{"cle":"nombre","libelle":"Reçus","type":"nombre"},{"cle":"montant","libelle":"Montant net","type":"montant"}]';
    select coalesce(json_agg(json_build_object('classe', classe, 'nombre', n, 'montant', m) order by ordre, classe), '[]'::json), json_build_object('nombre', sum(n), 'montant', coalesce(sum(m), 0))
      into lig, tot from (select c.libelle classe, c.ordre, count(*) filter (where p.annule_paiement_id is null) n, sum(p.montant) m
                            from public.paiements p join public.inscriptions i on i.id = p.inscription_id join public.classes c on c.id = i.classe_id
                           where p.etablissement_id = v_etab and p.date_paiement between d1 and d2 group by c.libelle, c.ordre) z;
  elsif p_type = 'impayes' then
    titre := format('Impayés au %s', to_char(least(d2, jour), 'DD/MM/YYYY'));
    col := '[{"cle":"eleve","libelle":"Élève","type":"texte"},{"cle":"matricule","libelle":"Matricule","type":"texte"},{"cle":"classe","libelle":"Classe","type":"texte"},{"cle":"du","libelle":"Dû","type":"montant"},{"cle":"paye","libelle":"Payé","type":"montant"},{"cle":"reste","libelle":"Reste","type":"montant"},{"cle":"retard","libelle":"En retard","type":"montant"}]';
    with t as (select inscription_id, sum(montant) du, sum(paye) paye, sum(reste) reste, coalesce(sum(reste) filter (where date_limite < least(d2, jour)), 0) retard
                 from public._tranches_situation(v_etab, least(d2, jour), null) group by inscription_id
               union all
               select inscription_id, du, paye, reste, retard from public._frais_situation(v_etab, null)),
         g as (select inscription_id, sum(du) du, sum(paye) paye, sum(reste) reste, sum(retard) retard from t group by inscription_id having sum(reste) > 0)
    select coalesce(json_agg(json_build_object('eleve', public._libelle(el.nom, el.prenom), 'matricule', el.matricule, 'classe', c.libelle,
             'du', g.du, 'paye', g.paye, 'reste', g.reste, 'retard', g.retard) order by c.ordre, c.libelle, el.nom), '[]'::json),
           json_build_object('du', coalesce(sum(g.du), 0), 'paye', coalesce(sum(g.paye), 0), 'reste', coalesce(sum(g.reste), 0), 'retard', coalesce(sum(g.retard), 0))
      into lig, tot from g join public.inscriptions i on i.id = g.inscription_id join public.eleves el on el.id = i.eleve_id join public.classes c on c.id = i.classe_id;
  elsif p_type = 'remises' then
    titre := 'Remises, exonérations et bourses';
    col := '[{"cle":"date","libelle":"Date","type":"date"},{"cle":"eleve","libelle":"Élève","type":"texte"},{"cle":"classe","libelle":"Classe","type":"texte"},{"cle":"rubrique","libelle":"Rubrique","type":"texte"},{"cle":"nature","libelle":"Nature","type":"texte"},{"cle":"valeur","libelle":"Valeur","type":"texte"},{"cle":"motif","libelle":"Motif","type":"texte"},{"cle":"auteur","libelle":"Accordée par","type":"texte"},{"cle":"statut","libelle":"Statut","type":"texte"}]';
    select coalesce(json_agg(json_build_object('date', r.accorde_le::date, 'eleve', public._libelle(el.nom, el.prenom), 'classe', c.libelle,
             'rubrique', coalesce(fc.libelle, 'Pension / scolarité'), 'nature', r.nature,
             'valeur', case when r.type = 'pourcentage' then trim(to_char(r.valeur, 'FM990.##')) || ' %' else trim(to_char(r.valeur, 'FM999G999G999G990')) end,
             'motif', r.motif, 'auteur', (select public._libelle(x.nom, x.prenom) from public.personnels x where x.id = r.accorde_par),
             'statut', case when r.annulee_le is null then 'active' else 'annulée' end) order by r.accorde_le), '[]'::json), json_build_object('nombre', count(*))
      into lig, tot from public.finance_remises r join public.inscriptions i on i.id = r.inscription_id join public.eleves el on el.id = i.eleve_id
      join public.classes c on c.id = i.classe_id left join public.frais_categories fc on fc.id = r.categorie_id
     where r.etablissement_id = v_etab and r.accorde_le::date between d1 and d2;
  elsif p_type = 'annulations' then
    titre := 'Annulations d''encaissements';
    col := '[{"cle":"date","libelle":"Date","type":"date"},{"cle":"numero","libelle":"Reçu annulé","type":"texte"},{"cle":"eleve","libelle":"Élève","type":"texte"},{"cle":"montant","libelle":"Montant","type":"montant"},{"cle":"motif","libelle":"Motif","type":"texte"},{"cle":"auteur","libelle":"Annulé par","type":"texte"}]';
    select coalesce(json_agg(json_build_object('date', a.date_paiement, 'numero', o.numero::text, 'eleve', public._libelle(el.nom, el.prenom), 'montant', o.montant,
             'motif', a.motif_annulation, 'auteur', (select public._libelle(x.nom, x.prenom) from public.personnels x where x.id = a.saisi_par)) order by a.date_paiement), '[]'::json),
           json_build_object('montant', coalesce(sum(o.montant), 0))
      into lig, tot from public.paiements a join public.paiements o on o.id = a.annule_paiement_id join public.inscriptions i on i.id = a.inscription_id
      join public.eleves el on el.id = i.eleve_id where a.etablissement_id = v_etab and a.date_paiement between d1 and d2;
  elsif p_type = 'factures' then
    titre := 'Factures émises';
    col := '[{"cle":"date","libelle":"Date","type":"date"},{"cle":"numero","libelle":"Facture","type":"texte"},{"cle":"eleve","libelle":"Élève","type":"texte"},{"cle":"classe","libelle":"Classe","type":"texte"},{"cle":"rubrique","libelle":"Rubrique","type":"texte"},{"cle":"montant","libelle":"Montant brut","type":"montant"},{"cle":"statut","libelle":"Statut","type":"texte"}]';
    select coalesce(json_agg(json_build_object('date', f.emise_le::date, 'numero', 'FAC-' || lpad(f.numero::text, 6, '0'), 'eleve', public._libelle(el.nom, el.prenom),
             'classe', c.libelle, 'rubrique', f.libelle, 'montant', f.montant_brut, 'statut', case when f.annulee_le is null then 'active' else 'annulée' end) order by f.numero), '[]'::json),
           json_build_object('montant', coalesce(sum(f.montant_brut) filter (where f.annulee_le is null), 0))
      into lig, tot from public.factures f join public.inscriptions i on i.id = f.inscription_id join public.eleves el on el.id = i.eleve_id
      join public.classes c on c.id = i.classe_id where f.etablissement_id = v_etab and f.emise_le::date between d1 and d2;
  elsif p_type in ('depenses_categorie', 'depenses_fournisseur') then
    titre := case when p_type = 'depenses_categorie' then 'Dépenses payées par catégorie' else 'Dépenses payées par fournisseur' end;
    col := json_build_array(json_build_object('cle', 'groupe', 'libelle', case when p_type = 'depenses_categorie' then 'Catégorie' else 'Fournisseur' end, 'type', 'texte'),
             json_build_object('cle', 'nombre', 'libelle', 'Dépenses', 'type', 'nombre'), json_build_object('cle', 'montant', 'libelle', 'Montant', 'type', 'montant'));
    select coalesce(json_agg(json_build_object('groupe', g, 'nombre', n, 'montant', m) order by m desc), '[]'::json), json_build_object('nombre', sum(n), 'montant', coalesce(sum(m), 0))
      into lig, tot from (select case when p_type = 'depenses_categorie' then dc.libelle else coalesce(f.nom, '(sans fournisseur)') end g, count(*) n, sum(d.montant) m
                            from public.depenses d join public.depenses_categories dc on dc.id = d.categorie_id left join public.fournisseurs f on f.id = d.fournisseur_id
                           where d.etablissement_id = v_etab and d.statut = 'payee' and d.date_paiement between d1 and d2 and (d.paie_id is null or voir_paie)
                           group by 1) z;
  elsif p_type = 'journal_tresorerie' then
    titre := 'Journal de trésorerie';
    col := '[{"cle":"date","libelle":"Date","type":"date"},{"cle":"compte","libelle":"Compte","type":"texte"},{"cle":"libelle","libelle":"Opération","type":"texte"},{"cle":"entree","libelle":"Entrée","type":"montant"},{"cle":"sortie","libelle":"Sortie","type":"montant"}]';
    with m as (select x.date_mouvement, c.libelle compte, x.libelle, x.montant, x.cree_le from public.mouvements_tresorerie x join public.comptes_financiers c on c.id = x.compte_id
                where x.etablissement_id = v_etab and x.date_mouvement between greatest(d1, c.date_solde_initial) and d2 and (p_compte is null or x.compte_id = p_compte)
                  and (not x.paie or voir_paie)
               union all                                                  -- sans droit « paie » : salaires regroupés par jour et par compte
               select x.date_mouvement, c.libelle, 'Salaires', sum(x.montant), max(x.cree_le) from public.mouvements_tresorerie x join public.comptes_financiers c on c.id = x.compte_id
                where x.etablissement_id = v_etab and x.date_mouvement between greatest(d1, c.date_solde_initial) and d2 and (p_compte is null or x.compte_id = p_compte)
                  and x.paie and not voir_paie group by x.date_mouvement, c.libelle)
    select coalesce(json_agg(json_build_object('date', m.date_mouvement, 'compte', m.compte, 'libelle', m.libelle,
             'entree', case when m.montant > 0 then m.montant end, 'sortie', case when m.montant < 0 then -m.montant end) order by m.date_mouvement, m.cree_le), '[]'::json),
           json_build_object('entree', coalesce(sum(m.montant) filter (where m.montant > 0), 0), 'sortie', coalesce(-sum(m.montant) filter (where m.montant < 0), 0))
      into lig, tot from m;
  elsif p_type = 'clotures' then
    titre := 'Clôtures de caisse';
    col := '[{"cle":"date","libelle":"Date","type":"date"},{"cle":"compte","libelle":"Compte","type":"texte"},{"cle":"theorique","libelle":"Théorique","type":"montant"},{"cle":"constate","libelle":"Constaté","type":"montant"},{"cle":"ecart","libelle":"Écart","type":"montant"},{"cle":"justification","libelle":"Justification","type":"texte"},{"cle":"auteur","libelle":"Clôturé par","type":"texte"}]';
    select coalesce(json_agg(json_build_object('date', k.date_cloture, 'compte', c.libelle, 'theorique', k.solde_theorique, 'constate', k.solde_constate, 'ecart', k.ecart,
             'justification', k.justification, 'auteur', (select public._libelle(x.nom, x.prenom) from public.personnels x where x.id = k.cloture_par)) order by k.date_cloture), '[]'::json),
           json_build_object('ecart', coalesce(sum(k.ecart), 0))
      into lig, tot from public.clotures_caisse k join public.comptes_financiers c on c.id = k.compte_id
     where k.etablissement_id = v_etab and k.date_cloture between d1 and d2 and (p_compte is null or k.compte_id = p_compte);
  elsif p_type = 'rapprochement' then
    titre := 'État du rapprochement bancaire';
    col := '[{"cle":"date","libelle":"Date","type":"date"},{"cle":"compte","libelle":"Compte","type":"texte"},{"cle":"libelle","libelle":"Libellé du relevé","type":"texte"},{"cle":"montant","libelle":"Montant","type":"montant"},{"cle":"statut","libelle":"Statut","type":"texte"}]';
    select coalesce(json_agg(json_build_object('date', l.date_operation, 'compte', c.libelle, 'libelle', l.libelle, 'montant', l.montant,
             'statut', case when l.mouvement_id is null then 'non rapprochée' else 'rapprochée' end) order by l.date_operation), '[]'::json),
           json_build_object('non_rapprochees', count(*) filter (where l.mouvement_id is null))
      into lig, tot from public.lignes_releve l join public.comptes_financiers c on c.id = l.compte_id
     where l.etablissement_id = v_etab and l.date_operation between d1 and d2 and (p_compte is null or l.compte_id = p_compte);
  elsif p_type = 'synthese_mensuelle' then
    titre := case when voir_paie then 'Synthèse mensuelle des recettes et dépenses' else 'Synthèse mensuelle des recettes et dépenses (hors salaires)' end;
    col := '[{"cle":"mois","libelle":"Mois","type":"texte"},{"cle":"recettes","libelle":"Recettes","type":"montant"},{"cle":"depenses","libelle":"Dépenses","type":"montant"},{"cle":"solde","libelle":"Solde","type":"montant"}]';
    with r as (select date_trunc('month', date_paiement)::date m, sum(montant) v from public.paiements where etablissement_id = v_etab and date_paiement between d1 and d2 group by 1),
         d as (select date_trunc('month', date_paiement)::date m, sum(montant) v from public.depenses where etablissement_id = v_etab and statut = 'payee'
                and date_paiement between d1 and d2 and (paie_id is null or voir_paie) group by 1),
         mm as (select m from r union select m from d)
    select coalesce(json_agg(json_build_object('mois', to_char(mm.m, 'MM/YYYY'), 'recettes', coalesce(r.v, 0), 'depenses', coalesce(d.v, 0),
             'solde', coalesce(r.v, 0) - coalesce(d.v, 0)) order by mm.m), '[]'::json),
           json_build_object('recettes', coalesce(sum(r.v), 0), 'depenses', coalesce(sum(d.v), 0), 'solde', coalesce(sum(r.v), 0) - coalesce(sum(d.v), 0))
      into lig, tot from mm left join r on r.m = mm.m left join d on d.m = mm.m;
  elsif p_type = 'masse_salariale' then
    if not voir_paie then raise exception 'Rapport réservé au droit « paie ».' using errcode = '42501'; end if;
    titre := 'Masse salariale';
    col := '[{"cle":"periode","libelle":"Période","type":"texte"},{"cle":"employe","libelle":"Employé","type":"texte"},{"cle":"brut","libelle":"Brut","type":"montant"},{"cle":"retenues","libelle":"Retenues","type":"montant"},{"cle":"net","libelle":"Net","type":"montant"},{"cle":"charges","libelle":"Charges patronales","type":"montant"},{"cle":"statut","libelle":"Statut","type":"texte"}]';
    select coalesce(json_agg(json_build_object('periode', to_char(x.periode, 'MM/YYYY'), 'employe', public._libelle(pe.nom, pe.prenom), 'brut', x.brut, 'retenues', x.retenues,
             'net', x.net, 'charges', x.charges_patronales, 'statut', x.statut) order by x.periode, pe.nom), '[]'::json),
           json_build_object('brut', coalesce(sum(x.brut), 0), 'retenues', coalesce(sum(x.retenues), 0), 'net', coalesce(sum(x.net), 0), 'charges', coalesce(sum(x.charges_patronales), 0))
      into lig, tot from public.paies x join public.personnels pe on pe.id = x.personnel_id
     where x.etablissement_id = v_etab and x.statut in ('validee', 'payee') and x.periode between date_trunc('month', d1)::date and d2;
  else
    raise exception 'Type de rapport inconnu.' using errcode = 'P0001';
  end if;
  return json_build_object('type', p_type, 'titre', titre, 'debut', d1, 'fin', d2, 'colonnes', col, 'lignes', lig, 'totaux', tot, 'genere_le', now());
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Vérification publique d'un document (QR code) : données minimales, aucun montant de salaire, initiales seulement
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.verifier_document_finance(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c text := upper(btrim(coalesce(p_code, ''))); p record; f record; x record;
begin
  if c !~ '^[0-9A-F]{32}$' then return null; end if;
  select pa.numero, pa.date_paiement, pa.montant, pa.annule_paiement_id, e.nom etab, el.nom, el.prenom,
         exists (select 1 from public.paiements a where a.annule_paiement_id = pa.id) annule into p
    from public.paiements pa join public.etablissements e on e.id = pa.etablissement_id
    join public.inscriptions i on i.id = pa.inscription_id join public.eleves el on el.id = i.eleve_id where pa.code_verif = c;
  if found then
    return jsonb_build_object('type', case when p.annule_paiement_id is null then 'recu' else 'contre_ecriture' end, 'etablissement', p.etab,
      'numero', p.numero, 'date', p.date_paiement, 'montant', p.montant, 'beneficiaire', left(p.nom, 1) || '. ' || left(coalesce(p.prenom, ''), 1) || '.',
      'statut', case when p.annule then 'annule' else 'valide' end);
  end if;
  select fa.numero, fa.emise_le, fa.montant_brut, fa.annulee_le, e.nom etab, el.nom, el.prenom into f
    from public.factures fa join public.etablissements e on e.id = fa.etablissement_id
    join public.inscriptions i on i.id = fa.inscription_id join public.eleves el on el.id = i.eleve_id where fa.code_verif = c;
  if found then
    return jsonb_build_object('type', 'facture', 'etablissement', f.etab, 'numero', 'FAC-' || lpad(f.numero::text, 6, '0'), 'date', f.emise_le::date,
      'montant', f.montant_brut, 'beneficiaire', left(f.nom, 1) || '. ' || left(coalesce(f.prenom, ''), 1) || '.',
      'statut', case when f.annulee_le is null then 'valide' else 'annule' end);
  end if;
  select pa.numero, pa.periode, pa.statut, e.nom etab, pe.nom, pe.prenom into x
    from public.paies pa join public.etablissements e on e.id = pa.etablissement_id join public.personnels pe on pe.id = pa.personnel_id
   where pa.code_verif = c and pa.statut in ('validee', 'payee', 'annulee');
  if found then
    return jsonb_build_object('type', 'bulletin_paie', 'etablissement', x.etab, 'numero', x.numero, 'periode', to_char(x.periode, 'MM/YYYY'),
      'beneficiaire', left(x.nom, 1) || '. ' || left(coalesce(x.prenom, ''), 1) || '.', 'statut', case when x.statut = 'annulee' then 'annule' else 'valide' end);
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Assistant financier (IA de l'utilisateur via MCP) : lecture seule, droits vérifiés ici à chaque appel,
-- journal (outil, période, statut, erreur) sans montant, nom ni matricule.
--  args : debut, fin (période) ou annee_scolaire (« 2025-2026 » : de la création de cette année dans NexIA à la création
--  de la suivante, ou à aujourd'hui) ; type (rapport) ; matricule (situation d'un élève) ; statut (dépenses).
-- La réponse précise la période, son origine et les données manquantes (« manquants ») au lieu de les deviner.
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.api_finance(p_cle text, p_outil text, p_args jsonb) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare c record; a jsonb := coalesce(p_args, '{}'); r json; d1 date; d2 date; ex uuid; ins uuid; x record; origine text := 'parametres';
        manquants text[] := '{}'; v_statut text := 'ok'; v_err text;
begin
  select * into c from public._api_contexte(p_cle, false);
  begin
    if not public.a_droit_finance('assistant') then
      raise exception 'L''assistant financier n''est pas autorisé pour ce compte (droit « assistant »).' using errcode = '42501';
    end if;
    if nullif(a ->> 'annee_scolaire', '') is not null and nullif(a ->> 'debut', '') is null then
      select e.id, e.cree_le::date debut,
             (select min(n.cree_le)::date - 1 from public.exercices n where n.etablissement_id = c.etab and n.cree_le > e.cree_le) fin into x
        from public.exercices e where e.etablissement_id = c.etab and e.libelle = btrim(a ->> 'annee_scolaire');
      if x.id is null then raise exception 'Année scolaire « % » inconnue dans NexIA School.', a ->> 'annee_scolaire' using errcode = 'P0001'; end if;
      d1 := x.debut; d2 := coalesce(x.fin, public._aujourdhui()); origine := 'annee_scolaire';
    else
      d1 := coalesce(nullif(a ->> 'debut', '')::date, date_trunc('month', public._aujourdhui())::date);
      d2 := coalesce(nullif(a ->> 'fin', '')::date, public._aujourdhui());
      if nullif(a ->> 'debut', '') is null then origine := 'mois_en_cours'; end if;
    end if;
    if not exists (select 1 from public.comptes_financiers where etablissement_id = c.etab) then
      manquants := array_append(manquants, 'Aucun compte de trésorerie configuré : soldes et mouvements indisponibles.');
    end if;
    if not exists (select 1 from public.frais_scolarite f join public.exercices e on e.id = f.exercice_id and e.actif where e.etablissement_id = c.etab) then
      manquants := array_append(manquants, 'Pension de l''année en cours non configurée : créances de pension indisponibles.');
    end if;
    if p_outil = 'finance_tableau_bord' then
      r := public.finance_tableau_bord(d1, d2);
    elsif p_outil = 'finance_rapport' then
      if (a ->> 'type') = 'masse_salariale' and not public.a_droit_finance('paie') then
        raise exception 'Les données de paie sont réservées au droit « paie ».' using errcode = '42501';
      end if;
      r := public.finance_rapport(a ->> 'type', d1, d2, null);
    elsif p_outil = 'finance_tresorerie' then
      r := public.finance_tresorerie();
    elsif p_outil = 'finance_situation_eleve' then
      select id into ex from public.exercices where etablissement_id = c.etab and actif;
      select i.id into ins from public.inscriptions i join public.eleves e on e.id = i.eleve_id
       where i.exercice_id = ex and public._normaliser(e.matricule) = public._normaliser(a ->> 'matricule') limit 1;
      if ins is null then raise exception 'Aucun élève de l''année en cours ne porte ce matricule.' using errcode = 'P0001'; end if;
      r := public.finance_situation_eleve(ins);
    elsif p_outil = 'finance_depenses' then
      r := public.finance_depenses(jsonb_build_object('debut', d1, 'fin', d2, 'statut', a ->> 'statut'));
    else
      raise exception 'Outil financier inconnu.' using errcode = 'P0001';
    end if;
  exception when others then
    v_statut := case when sqlstate = '42501' then 'refuse' else 'erreur' end;
    v_err := left(sqlerrm, 200);
  end;
  perform public._api_journal(c.etab, c.personnel, c.source, p_outil,
    jsonb_strip_nulls(jsonb_build_object('debut', d1, 'fin', d2, 'type', a ->> 'type', 'statut', v_statut, 'erreur', v_err, 'lecture_seule', true)));
  if v_statut <> 'ok' then
    return json_build_object('erreur', v_err, 'statut', v_statut);
  end if;
  return json_build_object('periode', json_build_object('debut', d1, 'fin', d2, 'origine', origine), 'manquants', to_json(manquants),
    'lecture_seule', true, 'resultat', r);
end $$;


-- Frais et délais (pension) : désormais réservé au droit « facturation » (le comptable l'a par défaut)
create or replace function public.finance_enregistrer_frais(p_pension_nouveaux int, p_pension_anciens int, p_echeances jsonb)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); ex uuid; l jsonb; somme_tranches bigint := 0; precedente date; n int := 0; k int;
begin
  if not public.a_droit_finance('facturation') then raise exception 'Réservé aux personnes ayant le droit financier « facturation ».' using errcode = '42501'; end if;
  perform public._exiger_offre(v_etab, 'finances');
  select id into ex from public.exercices where etablissement_id = v_etab and actif;
  if ex is null then raise exception 'Aucun exercice actif : l''administration doit d''abord créer l''année scolaire.' using errcode = 'P0001'; end if;
  if coalesce(p_pension_nouveaux, -1) < 0 or coalesce(p_pension_anciens, -1) < 0 then
    raise exception 'Indiquez la pension des nouveaux et des anciens élèves.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_echeances) <> 'array' or jsonb_array_length(p_echeances) <> 5 then
    raise exception 'L''échéancier doit comporter l''inscription et les quatre tranches.' using errcode = 'P0001';
  end if;
  for k in 0..4 loop
    l := p_echeances -> k;
    if (l ->> 'montant') is null or (l ->> 'montant')::numeric < 0 or (l ->> 'date_limite') is null then
      raise exception 'Montant et délai obligatoires pour %.', case when k = 0 then 'l''inscription' else format('la tranche %s', k) end using errcode = 'P0001';
    end if;
    if precedente is not null and (l ->> 'date_limite')::date < precedente then
      raise exception 'Les délais doivent se suivre dans l''ordre (inscription, puis tranches 1 à 4).' using errcode = 'P0001';
    end if;
    precedente := (l ->> 'date_limite')::date;
    if k > 0 then somme_tranches := somme_tranches + (l ->> 'montant')::bigint; end if;
  end loop;
  if somme_tranches > least(p_pension_nouveaux, p_pension_anciens) then
    raise exception 'Le total des quatre tranches (% FCFA) dépasse la pension : l''inscription serait négative.', somme_tranches using errcode = 'P0001';
  end if;
  insert into public.frais_scolarite (exercice_id, etablissement_id, pension_nouveaux, pension_anciens)
  values (ex, v_etab, p_pension_nouveaux, p_pension_anciens)
  on conflict (exercice_id) do update set pension_nouveaux = excluded.pension_nouveaux, pension_anciens = excluded.pension_anciens, maj = now(), maj_par = auth.uid();
  for k in 0..4 loop
    l := p_echeances -> k;
    insert into public.echeances (etablissement_id, exercice_id, rang, libelle, montant, date_limite)
    values (v_etab, ex, k, case when k = 0 then 'Inscription' else format('Tranche %s', k) end, (l ->> 'montant')::int, (l ->> 'date_limite')::date)
    on conflict (exercice_id, rang) do update set montant = excluded.montant, date_limite = excluded.date_limite, libelle = excluded.libelle;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Suppression d'un établissement (console) : toutes les données financières suivent l'établissement
-- ---------------------------------------------------------------------------------------------------------
alter table public.paiements_attente drop constraint if exists paiements_attente_paiement_id_fkey;
alter table public.paiements_attente add constraint paiements_attente_paiement_id_fkey foreign key (paiement_id) references public.paiements (id) on delete set null;
do $$
declare t text;
begin
  foreach t in array array['frais_montants', 'frais_tranches', 'finance_remises', 'factures', 'paiements_attente', 'mouvements_tresorerie',
                           'virements_tresorerie', 'clotures_caisse', 'lignes_releve', 'depenses'] loop
    execute format('alter table public.%I add constraint %I foreign key (etablissement_id) references public.etablissements (id) on delete cascade', t, t || '_etab_fkey');
  end loop;
end $$;

-- La suppression d'un établissement depuis la console emporte aussi ses paies (le personnel est supprimé ensuite)
create or replace function public.console_supprimer_etablissement(p_id uuid, p_confirmation text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare e record; n_pers int; n_el int;
begin
  perform public._exiger_proprietaire();
  select id, nom into e from public.etablissements where id = p_id;
  if e.id is null then raise exception 'Établissement introuvable.' using errcode = 'P0001'; end if;
  if public._normaliser(coalesce(p_confirmation, '')) <> public._normaliser(e.nom) then
    raise exception 'Confirmation incorrecte : saisissez exactement le nom de l''établissement.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.personnels p join public.plateforme_admins a on a.user_id = p.id where p.etablissement_id = p_id) then
    raise exception 'Cet établissement contient votre compte propriétaire : il ne peut pas être supprimé depuis la console.' using errcode = 'P0001';
  end if;
  select count(*) into n_pers from public.personnels where etablissement_id = p_id;
  select count(*) into n_el from public.eleves where etablissement_id = p_id;
  delete from public.paiements where etablissement_id = p_id;              -- l'historique financier part avec l'établissement
  delete from public.paies where etablissement_id = p_id;                  -- paies : rattachées au personnel, supprimé ensuite
  delete from public.inscriptions where etablissement_id = p_id;          -- avant les classes (suppression restreinte)
  delete from auth.users where id in (select id from public.personnels where etablissement_id = p_id);
  delete from public.jetons_appareil where etablissement_id = p_id;
  delete from public.etablissements where id = p_id;
  perform public._journal_plateforme('suppression d''un établissement', e.nom,
                                     json_build_object('etablissement_id', p_id, 'personnels', n_pers, 'eleves', n_el)::jsonb);
  return json_build_object('supprime', true, 'etablissement_id', p_id);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------------------------------------------------------
revoke execute on function public._codes_droits_finance(), public._droits_finance_comptable(), public._droits_finance(uuid), public._finance_exiger(text),
  public._finance_lire(text[]), public._finance_journaliser(text, text, uuid, jsonb), public._modes_paiement(), public._remise_totale(uuid, uuid, bigint),
  public._pension_lignes(uuid, uuid), public._frais_situation(uuid, uuid), public._mouvement_controle(), public._paiement_vers_tresorerie(),
  public._solde_compte(uuid, date), public._depense_vers_tresorerie(), public._paie_calcul(uuid, uuid, date)
  from public, anon, authenticated;
revoke execute on function public.a_droit_finance(text), public.mes_droits_finance(), public.finance_droits_lister(), public.finance_droits_definir(uuid, text[]),
  public.finance_parametres_enregistrer(jsonb), public.finance_categorie_enregistrer(jsonb), public.finance_remise_accorder(jsonb), public.finance_remise_annuler(uuid, text),
  public.finance_encaisser(jsonb), public.finance_annuler_paiement(uuid, text), public.finance_attente_traiter(uuid, boolean, text, date),
  public.finance_facturer(jsonb), public.finance_facture_annuler(uuid, text), public.finance_rechercher(text, uuid), public.finance_situation_eleve(uuid),
  public.finance_encaissements(jsonb), public.finance_attentes(), public.finance_compte_enregistrer(jsonb), public.finance_tresorerie(), public.finance_mouvements(uuid, date, date),
  public.finance_virement(jsonb), public.finance_cloturer(jsonb), public.finance_releve_importer(uuid, jsonb), public.finance_rapprochement(uuid),
  public.finance_rapprocher(uuid, uuid), public.finance_fournisseur_enregistrer(jsonb), public.finance_depense_categorie_enregistrer(jsonb),
  public.finance_depense_enregistrer(jsonb), public.finance_depense_action(uuid, text, jsonb), public.finance_depenses(jsonb),
  public.finance_paie_parametre_enregistrer(jsonb), public.finance_paie_element_ajouter(jsonb), public.finance_paie_element_clore(uuid, date),
  public.finance_paie_preparer(date, uuid[]), public.finance_paie_action(uuid, text, jsonb), public.finance_paies(date), public.mes_bulletins_paie(),
  public.finance_tableau_bord(date, date), public.finance_rapport(text, date, date, uuid), public.api_finance(text, text, jsonb),
  public.verifier_document_finance(text)
  from public, anon;
grant execute on function public.a_droit_finance(text), public.mes_droits_finance(), public.finance_droits_lister(), public.finance_droits_definir(uuid, text[]),
  public.finance_parametres_enregistrer(jsonb), public.finance_categorie_enregistrer(jsonb), public.finance_remise_accorder(jsonb), public.finance_remise_annuler(uuid, text),
  public.finance_encaisser(jsonb), public.finance_annuler_paiement(uuid, text), public.finance_attente_traiter(uuid, boolean, text, date),
  public.finance_facturer(jsonb), public.finance_facture_annuler(uuid, text), public.finance_rechercher(text, uuid), public.finance_situation_eleve(uuid),
  public.finance_encaissements(jsonb), public.finance_attentes(), public.finance_compte_enregistrer(jsonb), public.finance_tresorerie(), public.finance_mouvements(uuid, date, date),
  public.finance_virement(jsonb), public.finance_cloturer(jsonb), public.finance_releve_importer(uuid, jsonb), public.finance_rapprochement(uuid),
  public.finance_rapprocher(uuid, uuid), public.finance_fournisseur_enregistrer(jsonb), public.finance_depense_categorie_enregistrer(jsonb),
  public.finance_depense_enregistrer(jsonb), public.finance_depense_action(uuid, text, jsonb), public.finance_depenses(jsonb),
  public.finance_paie_parametre_enregistrer(jsonb), public.finance_paie_element_ajouter(jsonb), public.finance_paie_element_clore(uuid, date),
  public.finance_paie_preparer(date, uuid[]), public.finance_paie_action(uuid, text, jsonb), public.finance_paies(date), public.mes_bulletins_paie(),
  public.finance_tableau_bord(date, date), public.finance_rapport(text, date, date, uuid)
  to authenticated;
grant execute on function public.verifier_document_finance(text) to anon, authenticated;
-- api_finance : appelée par la fonction MCP (clé publique + clé API de l'utilisateur), comme les autres outils api_*
revoke execute on function public.api_finance(text, text, jsonb) from authenticated;
grant execute on function public.api_finance(text, text, jsonb) to anon;
