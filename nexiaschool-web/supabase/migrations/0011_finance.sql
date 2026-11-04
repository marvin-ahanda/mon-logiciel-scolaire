-- Finances (frais de scolarité) : rôle comptable / caissier, sections et cycles des classes, pension des nouveaux et des
-- anciens élèves, échéancier (inscription + 4 tranches avec délais), paiements avec reçus numérotés, situation de chaque
-- élève et alertes de retard pour l'administration et la comptabilité. Montants en francs CFA (entiers).

-- ---------------------------------------------------------------------------------------------------------
-- Rôle « comptable » (comptable ou caissier)
-- ---------------------------------------------------------------------------------------------------------
alter table public.personnels drop constraint if exists personnels_role_check;
alter table public.personnels add constraint personnels_role_check check (role in ('admin', 'enseignant', 'surveillant', 'comptable'));

create or replace function public.peut_finance() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.personnels p join public.etablissements e on e.id = p.etablissement_id
                  where p.id = auth.uid() and p.actif and p.role in ('admin', 'comptable') and e.suspendu_le is null)
$$;

create or replace function public.creer_personnel(p_nom text, p_prenom text, p_role text, p_matricule text, p_telephone text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin(); v_id uuid := gen_random_uuid(); code text := public._generer_code(6);
begin
  if p_role not in ('admin', 'enseignant', 'surveillant', 'comptable') then raise exception 'Rôle inconnu.' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p_nom, ''))) < 1 then raise exception 'Le nom est obligatoire.' using errcode = 'P0001'; end if;
  if (select count(*) from public.personnels where etablissement_id = v_etab) >= 300 then
    raise exception 'Nombre maximal de comptes atteint (300).' using errcode = 'P0001';
  end if;
  perform public._creer_compte_auth(v_id);
  insert into public.personnels (id, etablissement_id, nom, prenom, role, matricule, telephone, code_hash)
  values (v_id, v_etab, upper(btrim(p_nom)), btrim(coalesce(p_prenom, '')), p_role, btrim(coalesce(p_matricule, '')),
          btrim(coalesce(p_telephone, '')), public._hacher(code));
  return json_build_object('id', v_id, 'nom', public._libelle(p_nom, p_prenom), 'code', code);
end $$;

create or replace function public.modifier_personnel(p_id uuid, p_nom text, p_prenom text, p_role text, p_actif boolean,
                                                     p_matricule text, p_telephone text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin();
begin
  if p_role not in ('admin', 'enseignant', 'surveillant', 'comptable') then raise exception 'Rôle inconnu.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.personnels where id = p_id and etablissement_id = v_etab) then
    raise exception 'Membre du personnel introuvable.' using errcode = 'P0001';
  end if;
  if p_id = auth.uid() and (p_role <> 'admin' or not p_actif) then
    raise exception 'Vous ne pouvez pas retirer vos propres droits d''administration.' using errcode = 'P0001';
  end if;
  update public.personnels set nom = upper(btrim(p_nom)), prenom = btrim(coalesce(p_prenom, '')), role = p_role, actif = p_actif,
         matricule = btrim(coalesce(p_matricule, '')), telephone = btrim(coalesce(p_telephone, ''))
   where id = p_id;
  if not exists (select 1 from public.personnels where etablissement_id = v_etab and actif and role = 'admin') then
    raise exception 'Il doit rester au moins un compte d''administration actif.' using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Sections (anglophone, francophone, technique…) et cycles des classes, définis par l'administration
-- ---------------------------------------------------------------------------------------------------------
create table public.sections (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  libelle text not null check (char_length(btrim(libelle)) between 1 and 60),
  ordre smallint not null default 0,
  unique (etablissement_id, libelle),
  unique (id, etablissement_id)
);
alter table public.sections enable row level security;
create policy "lecture" on public.sections for select to authenticated using (etablissement_id = (select public.etab_courant()));
create policy "ajout par l'administration" on public.sections for insert to authenticated
  with check (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));
create policy "modification par l'administration" on public.sections for update to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin())) with check (etablissement_id = (select public.etab_courant()));
create policy "suppression par l'administration" on public.sections for delete to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));
grant select, insert, update, delete on public.sections to authenticated;

alter table public.classes add column if not exists section_id uuid;
alter table public.classes add column if not exists cycle smallint check (cycle in (1, 2));
alter table public.classes add constraint classes_section_fkey foreign key (section_id, etablissement_id)
  references public.sections (id, etablissement_id) on delete set null (section_id);

-- Nouvel élève (pension des nouveaux) ou ancien (pension des anciens), pour l'exercice
alter table public.inscriptions add column if not exists nouveau boolean not null default true;

-- ---------------------------------------------------------------------------------------------------------
-- Frais de scolarité et échéancier de l'exercice
-- ---------------------------------------------------------------------------------------------------------
create table public.frais_scolarite (
  exercice_id uuid primary key,
  etablissement_id uuid not null default public.etab_courant(),
  pension_nouveaux integer not null check (pension_nouveaux between 0 and 100000000),
  pension_anciens integer not null check (pension_anciens between 0 and 100000000),
  maj timestamptz not null default now(),
  maj_par uuid default auth.uid(),
  foreign key (exercice_id, etablissement_id) references public.exercices (id, etablissement_id) on delete cascade
);
create table public.echeances (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant(),
  exercice_id uuid not null,
  rang smallint not null check (rang between 0 and 4),            -- 0 = inscription, 1 à 4 = tranches
  libelle text not null,
  montant integer not null check (montant between 0 and 100000000),
  date_limite date not null,
  unique (exercice_id, rang),
  foreign key (exercice_id, etablissement_id) references public.exercices (id, etablissement_id) on delete cascade
);
create table public.paiements (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant(),
  inscription_id uuid not null,
  numero integer not null,
  montant integer not null check (montant between 1 and 100000000),
  date_paiement date not null default current_date,
  mode text not null default 'especes' check (mode in ('especes', 'mobile_money', 'virement', 'cheque', 'autre')),
  reference text not null default '' check (char_length(reference) <= 80),
  observation text not null default '' check (char_length(observation) <= 200),
  saisi_par uuid default auth.uid(),
  cree_le timestamptz not null default now(),
  unique (etablissement_id, numero),
  -- restreint : on ne peut pas effacer une inscription qui porte des paiements (l'historique comptable est conservé)
  foreign key (inscription_id, etablissement_id) references public.inscriptions (id, etablissement_id) on delete restrict
);
create index on public.paiements (inscription_id);

-- Numéro de reçu séquentiel par établissement ; date de paiement plausible
create or replace function public.preparer_paiement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.date_paiement > (now() at time zone 'Africa/Douala')::date then
    raise exception 'La date du paiement ne peut pas être dans le futur.' using errcode = 'P0001';
  end if;
  if new.date_paiement < (now() at time zone 'Africa/Douala')::date - 730 then
    raise exception 'Date de paiement trop ancienne.' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('recu:' || new.etablissement_id::text));
  new.numero := coalesce((select max(numero) from public.paiements where etablissement_id = new.etablissement_id), 0) + 1;
  new.saisi_par := auth.uid();
  new.cree_le := now();
  return new;
end $$;
create trigger paiement_numerote before insert on public.paiements for each row execute function public.preparer_paiement();

alter table public.frais_scolarite enable row level security;
alter table public.echeances enable row level security;
alter table public.paiements enable row level security;
create policy "lecture par la comptabilité" on public.frais_scolarite for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.peut_finance()));
create policy "lecture par la comptabilité" on public.echeances for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.peut_finance()));
create policy "lecture par la comptabilité" on public.paiements for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.peut_finance()));
create policy "encaissement par la comptabilité" on public.paiements for insert to authenticated
  with check (etablissement_id = (select public.etab_courant()) and (select public.peut_finance()));
-- annulation : l'administration à tout moment, le caissier seulement pour ses propres encaissements des dernières 24 h
create policy "annulation" on public.paiements for delete to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.peut_finance())
         and ((select public.est_admin()) or (saisi_par = auth.uid() and cree_le > now() - interval '24 hours')));
grant select on public.frais_scolarite, public.echeances to authenticated;
grant select, delete on public.paiements to authenticated;
grant insert (inscription_id, montant, date_paiement, mode, reference, observation) on public.paiements to authenticated;

-- Enregistrement des frais et des délais (tout ou rien, contrôlé)
create or replace function public.finance_enregistrer_frais(p_pension_nouveaux int, p_pension_anciens int, p_echeances jsonb)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); ex uuid; l jsonb; somme_tranches bigint := 0; precedente date; n int := 0; k int;
begin
  if not public.peut_finance() then raise exception 'Réservé à l''administration et à la comptabilité.' using errcode = '42501'; end if;
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
-- Situation financière des élèves (une seule règle de calcul, utilisée par les écrans et les alertes)
--  * dû total = pension de la catégorie (nouveau / ancien) ;
--  * échéancier : inscription + 4 tranches ; l'écart entre la pension et le total saisi est porté sur l'inscription ;
--  * les paiements couvrent les échéances dans l'ordre ; une échéance dont le délai est passé et qui n'est pas soldée
--    met l'élève « non en règle ».
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.finance_eleves(p_classe uuid default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); ex uuid; f record; jour date := (now() at time zone 'Africa/Douala')::date; total_lignes bigint; r json;
begin
  if not public.peut_finance() then raise exception 'Réservé à l''administration et à la comptabilité.' using errcode = '42501'; end if;
  select id into ex from public.exercices where etablissement_id = v_etab and actif;
  select * into f from public.frais_scolarite where exercice_id = ex;
  if ex is null or f.exercice_id is null or (select count(*) from public.echeances where exercice_id = ex) <> 5 then
    return json_build_object('configure', false, 'aujourdhui', jour, 'eleves', '[]'::json);
  end if;
  select sum(montant) into total_lignes from public.echeances where exercice_id = ex;
  with ins as (
    select i.id, i.nouveau, el.matricule, el.nom, el.prenom, el.sexe, c.id classe_id, c.libelle classe, c.ordre classe_ordre, c.cycle,
           s.id section_id, s.libelle section, case when i.nouveau then f.pension_nouveaux else f.pension_anciens end pension
      from public.inscriptions i join public.eleves el on el.id = i.eleve_id join public.classes c on c.id = i.classe_id
      left join public.sections s on s.id = c.section_id
     where i.exercice_id = ex and (p_classe is null or i.classe_id = p_classe)),
  pay as (
    select p.inscription_id, sum(p.montant) paye, max(p.date_paiement) derniere,
           json_agg(json_build_object('id', p.id, 'numero', p.numero, 'montant', p.montant, 'date', p.date_paiement, 'mode', p.mode,
                    'reference', p.reference, 'observation', p.observation, 'cree_le', p.cree_le,
                    'saisi_par', (select public._libelle(x.nom, x.prenom) from public.personnels x where x.id = p.saisi_par),
                    'annulable', public.est_admin() or (p.saisi_par = auth.uid() and p.cree_le > now() - interval '24 hours'))
                    order by p.date_paiement, p.numero) liste
      from public.paiements p where p.inscription_id in (select id from ins) group by p.inscription_id),
  lig as (
    select ins.id ins_id, ec.rang, ec.libelle, ec.date_limite,
           ec.montant + case when ec.rang = 0 then ins.pension - total_lignes else 0 end montant
      from ins cross join public.echeances ec where ec.exercice_id = ex),
  lig2 as (
    select l.*, coalesce(sum(l.montant) over (partition by l.ins_id order by l.rang rows between unbounded preceding and 1 preceding), 0) cum_avant
      from lig l),
  lig3 as (
    select l.*, least(greatest(coalesce(p.paye, 0) - l.cum_avant, 0), l.montant) paye_ligne from lig2 l left join pay p on p.inscription_id = l.ins_id),
  syn as (
    select ins_id,
           json_agg(json_build_object('rang', rang, 'libelle', libelle, 'montant', montant, 'date_limite', date_limite, 'paye', paye_ligne,
                    'reste', montant - paye_ligne, 'echue', date_limite < jour, 'en_retard', date_limite < jour and paye_ligne < montant) order by rang) lignes,
           coalesce(sum(montant) filter (where date_limite < jour), 0) du_echu,
           min(date_limite) filter (where date_limite < jour and paye_ligne < montant) premier_retard,
           coalesce(sum(montant - paye_ligne) filter (where date_limite < jour), 0) montant_retard,
           (array_agg(json_build_object('libelle', libelle, 'reste', montant - paye_ligne, 'date_limite', date_limite) order by rang)
              filter (where paye_ligne < montant))[1] prochaine,
           string_agg(libelle, ', ' order by rang) filter (where date_limite < jour and paye_ligne < montant) tranches_en_retard
      from lig3 group by ins_id)
  select json_build_object('configure', true, 'aujourdhui', jour,
    'frais', json_build_object('pension_nouveaux', f.pension_nouveaux, 'pension_anciens', f.pension_anciens),
    'eleves', coalesce(json_agg(json_build_object(
      'inscription_id', ins.id, 'matricule', ins.matricule, 'nom', ins.nom, 'prenom', ins.prenom, 'sexe', ins.sexe, 'nouveau', ins.nouveau,
      'classe_id', ins.classe_id, 'classe', ins.classe, 'cycle', ins.cycle, 'section_id', ins.section_id, 'section', ins.section,
      'total_du', ins.pension, 'paye', coalesce(p.paye, 0), 'reste', greatest(ins.pension - coalesce(p.paye, 0), 0),
      'trop_percu', greatest(coalesce(p.paye, 0) - ins.pension, 0), 'derniere_date', p.derniere,
      'du_echu', syn.du_echu, 'retard', syn.montant_retard, 'en_regle', syn.montant_retard = 0,
      'statut', case when coalesce(p.paye, 0) >= ins.pension then 'solde' when syn.montant_retard > 0 then 'en_retard' else 'a_jour' end,
      'tranches_en_retard', syn.tranches_en_retard, 'premier_retard', syn.premier_retard,
      'jours_retard', case when syn.premier_retard is not null then jour - syn.premier_retard end,
      'prochaine', syn.prochaine, 'lignes', syn.lignes, 'paiements', coalesce(p.liste, '[]'::json))
      order by ins.classe_ordre, ins.classe, ins.nom, ins.prenom), '[]'::json))
    into r
    from ins left join pay p on p.inscription_id = ins.id join syn on syn.ins_id = ins.id;
  return r;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Alertes de retard : une alerte par échéance dont le délai est passé et qui laisse des élèves non en règle.
-- Chaque membre (administration, comptabilité) a ses alertes lues / non lues.
-- ---------------------------------------------------------------------------------------------------------
create table public.finance_alertes_lues (
  personnel_id uuid not null references public.personnels (id) on delete cascade,
  exercice_id uuid not null references public.exercices (id) on delete cascade,
  rang smallint not null,
  date_limite date not null,
  lu_le timestamptz not null default now(),
  primary key (personnel_id, exercice_id, rang, date_limite)
);
alter table public.finance_alertes_lues enable row level security;
revoke all on public.finance_alertes_lues from anon, authenticated;

create or replace function public.finance_alertes() returns json
language plpgsql stable security definer set search_path = '' as $$
declare s json; ex uuid;
begin
  if not public.peut_finance() then return json_build_object('alertes', '[]'::json, 'non_lues', 0, 'insolvables', 0); end if;
  s := public.finance_eleves(null);
  if not (s ->> 'configure')::boolean then return json_build_object('alertes', '[]'::json, 'non_lues', 0, 'insolvables', 0); end if;
  select id into ex from public.exercices where etablissement_id = public.etab_courant() and actif;
  return (with l as (
      select (x ->> 'rang')::int rang, x ->> 'libelle' libelle, (x ->> 'date_limite')::date date_limite, (x ->> 'en_retard')::boolean en_retard
        from json_array_elements(s -> 'eleves') e, json_array_elements(e -> 'lignes') x),
    a as (select rang, libelle, date_limite, count(*) filter (where en_retard) eleves from l
           where date_limite < (s ->> 'aujourdhui')::date group by rang, libelle, date_limite having count(*) filter (where en_retard) > 0),
    a2 as (select a.*, exists (select 1 from public.finance_alertes_lues r where r.personnel_id = auth.uid() and r.exercice_id = ex
                                and r.rang = a.rang and r.date_limite = a.date_limite) lue from a)
    select json_build_object(
      'alertes', coalesce((select json_agg(json_build_object('rang', rang, 'libelle', libelle, 'date_limite', date_limite, 'eleves', eleves, 'lue', lue) order by rang) from a2), '[]'::json),
      'non_lues', (select count(*) from a2 where not lue),
      'insolvables', (select count(*) from json_array_elements(s -> 'eleves') e where not (e ->> 'en_regle')::boolean)));
end $$;

create or replace function public.finance_marquer_alertes_lues() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare ex uuid; a json;
begin
  if not public.peut_finance() then raise exception 'Réservé à l''administration et à la comptabilité.' using errcode = '42501'; end if;
  select id into ex from public.exercices where etablissement_id = public.etab_courant() and actif;
  for a in select * from json_array_elements(public.finance_alertes() -> 'alertes') loop
    insert into public.finance_alertes_lues (personnel_id, exercice_id, rang, date_limite)
    values (auth.uid(), ex, (a ->> 'rang')::int, (a ->> 'date_limite')::date) on conflict do nothing;
  end loop;
end $$;

-- La suppression d'un établissement depuis la console efface aussi ses paiements
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
  delete from public.inscriptions where etablissement_id = p_id;          -- avant les classes (suppression restreinte)
  delete from auth.users where id in (select id from public.personnels where etablissement_id = p_id);
  delete from public.jetons_appareil where etablissement_id = p_id;
  delete from public.etablissements where id = p_id;
  perform public._journal_plateforme('suppression d''un établissement', e.nom,
                                     json_build_object('etablissement_id', p_id, 'personnels', n_pers, 'eleves', n_el)::jsonb);
  return json_build_object('supprime', true, 'etablissement_id', p_id);
end $$;

-- Droits d'exécution
revoke execute on function public.peut_finance(), public.preparer_paiement(), public.finance_enregistrer_frais(int, int, jsonb),
  public.finance_eleves(uuid), public.finance_alertes(), public.finance_marquer_alertes_lues(),
  public.creer_personnel(text, text, text, text, text), public.modifier_personnel(uuid, text, text, text, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.peut_finance(), public.finance_enregistrer_frais(int, int, jsonb), public.finance_eleves(uuid),
  public.finance_alertes(), public.finance_marquer_alertes_lues(),
  public.creer_personnel(text, text, text, text, text), public.modifier_personnel(uuid, text, text, text, boolean, text, text)
  to authenticated;
