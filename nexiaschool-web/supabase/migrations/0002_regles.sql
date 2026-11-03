-- Déclencheurs de cohérence, règles RLS et droits.

-- Six séquences (deux par trimestre) créées avec chaque exercice
create or replace function public.creer_sequences() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.sequences (etablissement_id, exercice_id, numero, trimestre)
  select new.etablissement_id, new.id, n, (n + 1) / 2 from generate_series(1, 6) as n;
  return new;
end $$;
create trigger exercice_sequences after insert on public.exercices
  for each row execute function public.creer_sequences();

-- Une note doit concerner un élève de la classe de l'attribution, une séquence du même exercice,
-- et une séquence non verrouillée.
create or replace function public.verifier_note() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a record; i record; s record;
begin
  if tg_op = 'DELETE' then
    select verrouillee into s from public.sequences where id = old.sequence_id;
    if s.verrouillee then raise exception 'Opération refusée : la séquence est verrouillée.' using errcode = 'P0001'; end if;
    return old;
  end if;
  select exercice_id, classe_id into a from public.attributions where id = new.attribution_id;
  select exercice_id, classe_id into i from public.inscriptions where id = new.inscription_id;
  select exercice_id, verrouillee into s from public.sequences where id = new.sequence_id;
  if a.classe_id is distinct from i.classe_id or a.exercice_id is distinct from i.exercice_id
     or a.exercice_id is distinct from s.exercice_id then
    raise exception 'Note incohérente (classe, élève ou séquence).' using errcode = 'P0001';
  end if;
  if s.verrouillee then raise exception 'Opération refusée : la séquence est verrouillée.' using errcode = 'P0001'; end if;
  new.maj := now();
  new.saisi_par := auth.uid();
  return new;
end $$;
create trigger note_coherente before insert or update or delete on public.notes
  for each row execute function public.verifier_note();

-- Un seul exercice actif : activer l'un désactive les autres
create or replace function public.exercice_actif_unique() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.actif then
    update public.exercices set actif = false
     where etablissement_id = new.etablissement_id and id <> new.id and actif;
  end if;
  return new;
end $$;
create trigger exercice_un_seul_actif before insert or update of actif on public.exercices
  for each row when (new.actif) execute function public.exercice_actif_unique();

-- ---------------------------------------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------------------------------------
alter table public.etablissements enable row level security;
alter table public.personnels enable row level security;
alter table public.jetons_appareil enable row level security;
alter table public.tentatives enable row level security;
alter table public.exercices enable row level security;
alter table public.sequences enable row level security;
alter table public.classes enable row level security;
alter table public.matieres enable row level security;
alter table public.attributions enable row level security;
alter table public.eleves enable row level security;
alter table public.inscriptions enable row level security;
alter table public.notes enable row level security;

-- Établissement et personnel : lecture de son établissement ; écritures uniquement par fonctions sécurisées
create policy "lecture de son établissement" on public.etablissements for select to authenticated
  using (id = (select public.etab_courant()));
create policy "l'administration modifie les informations" on public.etablissements for update to authenticated
  using (id = (select public.etab_courant()) and (select public.est_admin()))
  with check (id = (select public.etab_courant()));
create policy "lecture du personnel de son établissement" on public.personnels for select to authenticated
  using (etablissement_id = (select public.etab_courant()));
-- jetons_appareil, tentatives : aucune règle = aucun accès direct

-- Données scolaires : lecture par tout le personnel de l'établissement, écriture par l'administration
do $$
declare t text;
begin
  foreach t in array array['exercices', 'sequences', 'classes', 'matieres', 'attributions', 'eleves', 'inscriptions'] loop
    execute format('create policy "lecture" on public.%I for select to authenticated
                      using (etablissement_id = (select public.etab_courant()))', t);
    execute format('create policy "ajout par l''administration" on public.%I for insert to authenticated
                      with check (etablissement_id = (select public.etab_courant()) and (select public.est_admin()))', t);
    execute format('create policy "modification par l''administration" on public.%I for update to authenticated
                      using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()))
                      with check (etablissement_id = (select public.etab_courant()))', t);
    execute format('create policy "suppression par l''administration" on public.%I for delete to authenticated
                      using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()))', t);
  end loop;
end $$;

-- Notes : l'administration, ou l'enseignant de la matière dans cette classe
create or replace function public.peut_noter(p_attribution uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select public.est_admin()) or exists (
    select 1 from public.attributions a where a.id = p_attribution and a.enseignant_id = auth.uid()
      and a.etablissement_id = (select public.etab_courant()))
$$;
create policy "lecture" on public.notes for select to authenticated
  using (etablissement_id = (select public.etab_courant()));
create policy "saisie" on public.notes for insert to authenticated
  with check (etablissement_id = (select public.etab_courant()) and public.peut_noter(attribution_id));
create policy "correction" on public.notes for update to authenticated
  using (etablissement_id = (select public.etab_courant()) and public.peut_noter(attribution_id))
  with check (etablissement_id = (select public.etab_courant()) and public.peut_noter(attribution_id));
create policy "suppression" on public.notes for delete to authenticated
  using (etablissement_id = (select public.etab_courant()) and public.peut_noter(attribution_id));

-- ---------------------------------------------------------------------------------------------------------
-- Droits : rien pour les visiteurs anonymes (ils ne passent que par les fonctions de connexion) ;
-- colonnes sensibles (empreintes des codes, compteurs) jamais lisibles.
-- ---------------------------------------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on public.exercices, public.sequences, public.classes, public.matieres,
  public.attributions, public.eleves, public.inscriptions, public.notes to authenticated;
grant select (id, nom, ville, adresse, telephone, devise, nom_chef, code_genere_le, cree_le) on public.etablissements to authenticated;
grant update (ville, adresse, telephone, devise, nom_chef) on public.etablissements to authenticated;
grant select (id, etablissement_id, nom, prenom, role, matricule, telephone, actif, compte_google, code_genere_le, derniere_connexion, cree_le)
  on public.personnels to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.etab_courant(), public.est_admin(), public.peut_noter(uuid) to authenticated;
