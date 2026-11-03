-- API NexIA School pour agents IA (serveur MCP) : activation par établissement, clés API personnelles,
-- journal des actions, limite d'appels, et fonctions « outils » appelées par le serveur MCP.
-- Chaque outil vérifie la clé puis agit avec les droits de son propriétaire (rôle, matières, établissement).

alter table public.etablissements add column if not exists api_active boolean not null default false;
grant select (api_active) on public.etablissements to authenticated;

create table public.cles_api (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null,
  personnel_id uuid not null,
  nom text not null check (char_length(btrim(nom)) between 1 and 80),
  prefixe text not null,
  cle_hash text not null unique,
  ecriture boolean not null default false,
  expire_le timestamptz,
  cree_le timestamptz not null default now(),
  derniere_utilisation timestamptz,
  revoquee_le timestamptz,
  foreign key (personnel_id, etablissement_id) references public.personnels (id, etablissement_id) on delete cascade
);
create index on public.cles_api (etablissement_id);

create table public.journal_api (
  id bigint generated always as identity primary key,
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  personnel_id uuid,
  source text not null,                 -- « clé : nom » ou « application : nom »
  outil text not null,
  details jsonb not null default '{}',
  cree_le timestamptz not null default now()
);
create index on public.journal_api (etablissement_id, cree_le desc);

create table public.api_compteurs (
  jeton_id uuid not null,
  minute timestamptz not null,
  n integer not null default 0,
  primary key (jeton_id, minute)
);

alter table public.cles_api enable row level security;
alter table public.journal_api enable row level security;
alter table public.api_compteurs enable row level security;
create policy "ses clés, ou toutes pour l'administration" on public.cles_api for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (personnel_id = auth.uid() or (select public.est_admin())));
create policy "journal : le sien, ou tout pour l'administration" on public.journal_api for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (personnel_id = auth.uid() or (select public.est_admin())));
revoke all on public.cles_api, public.journal_api, public.api_compteurs from anon, authenticated;
grant select (id, etablissement_id, personnel_id, nom, prefixe, ecriture, expire_le, cree_le, derniere_utilisation, revoquee_le)
  on public.cles_api to authenticated;
grant select on public.journal_api to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Gestion depuis l'application
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.definir_api_active(p_active boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin();
begin
  update public.etablissements set api_active = p_active where id = v_etab;
  if not p_active then update public.cles_api set revoquee_le = now() where etablissement_id = v_etab and revoquee_le is null; end if;
end $$;

create or replace function public.creer_cle_api(p_nom text, p_ecriture boolean, p_jours int)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); cle text; v_id uuid;
begin
  if v_etab is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  if not (select api_active from public.etablissements where id = v_etab) then
    raise exception 'L''accès API n''est pas activé pour cet établissement (Espace développeur, réservé à l''administration).' using errcode = 'P0001';
  end if;
  if (select count(*) from public.cles_api where personnel_id = auth.uid() and revoquee_le is null) >= 10 then
    raise exception 'Vous avez déjà 10 clés actives : révoquez-en une avant d''en créer une autre.' using errcode = 'P0001';
  end if;
  cle := 'nxs_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.cles_api (etablissement_id, personnel_id, nom, prefixe, cle_hash, ecriture, expire_le)
  values (v_etab, auth.uid(), left(btrim(p_nom), 80), left(cle, 12), encode(extensions.digest(cle, 'sha256'), 'hex'), coalesce(p_ecriture, false),
          case when coalesce(p_jours, 0) > 0 then now() + make_interval(days => least(p_jours, 365)) end)
  returning id into v_id;
  return json_build_object('id', v_id, 'cle', cle);
end $$;

create or replace function public.revoquer_cle_api(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.cles_api set revoquee_le = now()
   where id = p_id and etablissement_id = public.etab_courant() and revoquee_le is null
     and (personnel_id = auth.uid() or public.est_admin());
  if not found then raise exception 'Clé introuvable ou déjà révoquée.' using errcode = 'P0001'; end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Contexte d'un appel API : vérifie la clé, l'activation, la limite d'appels et les droits d'écriture.
-- Place l'identité du propriétaire dans la requête : auth.uid(), etab_courant(), est_admin()… s'appliquent.
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._api_contexte(p_jeton text, p_ecriture boolean)
returns table (etab uuid, personnel uuid, role text, ecriture boolean, jeton_id uuid, source text)
language plpgsql volatile security definer set search_path = '' as $$
declare h text := encode(extensions.digest(coalesce(p_jeton, ''), 'sha256'), 'hex'); k record; n int;
begin
  select c.id, c.etablissement_id, c.personnel_id, c.ecriture, 'clé : ' || c.nom as source into k
    from public.cles_api c where c.cle_hash = h and c.revoquee_le is null and (c.expire_le is null or c.expire_le > now());
  if k.id is null then
    raise exception 'Clé API invalide, expirée ou révoquée.' using errcode = '28000';
  end if;
  return query select k.etablissement_id, k.personnel_id, p.role, k.ecriture, k.id, k.source
    from public.personnels p join public.etablissements e on e.id = p.etablissement_id
   where p.id = k.personnel_id and p.actif and e.api_active;
  if not found then raise exception 'Accès API désactivé pour cet établissement ou ce compte.' using errcode = '42501'; end if;
  if p_ecriture and not k.ecriture then
    raise exception 'Cette clé est en lecture seule : créez une clé avec le droit d''écriture.' using errcode = '42501';
  end if;
  insert into public.api_compteurs as a (jeton_id, minute, n) values (k.id, date_trunc('minute', now()), 1)
  on conflict on constraint api_compteurs_pkey do update set n = a.n + 1 returning a.n into n;
  if n > 60 then raise exception 'Limite de 60 appels par minute atteinte : réessayez dans un instant.' using errcode = 'P0429'; end if;
  delete from public.api_compteurs where minute < now() - interval '1 hour';
  update public.cles_api set derniere_utilisation = now() where id = k.id and (derniere_utilisation is null or derniere_utilisation < now() - interval '1 minute');
  perform set_config('request.jwt.claim.sub', k.personnel_id::text, true);
end $$;

create or replace function public._api_journal(p_etab uuid, p_personnel uuid, p_source text, p_outil text, p_details jsonb) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.journal_api (etablissement_id, personnel_id, source, outil, details) values (p_etab, p_personnel, p_source, p_outil, coalesce(p_details, '{}'))
$$;

create or replace function public._api_classe(p_etab uuid, p_classe text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  select id into v from public.classes where etablissement_id = p_etab and public._normaliser(libelle) = public._normaliser(p_classe);
  if v is null then raise exception 'Classe « % » introuvable. Utilisez l''outil lister_classes.', p_classe using errcode = 'P0001'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Outils en lecture
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.api_contexte(p_cle text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare c record; ex record;
begin
  select * into c from public._api_contexte(p_cle, false);
  select * into ex from public.exercices where etablissement_id = c.etab and actif;
  return json_build_object(
    'etablissement', (select json_build_object('nom', nom, 'ville', ville, 'chef', nom_chef) from public.etablissements where id = c.etab),
    'utilisateur', (select json_build_object('nom', public._libelle(nom, prenom), 'role', role) from public.personnels where id = c.personnel),
    'droit_ecriture', c.ecriture,
    'exercice_actif', ex.libelle,
    'sequences', coalesce((select json_agg(json_build_object('numero', numero, 'trimestre', trimestre, 'verrouillee', verrouillee) order by numero)
                           from public.sequences where exercice_id = ex.id), '[]'::json));
end $$;

create or replace function public.api_classes(p_cle text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare c record; ex uuid;
begin
  select * into c from public._api_contexte(p_cle, false);
  select id into ex from public.exercices where etablissement_id = c.etab and actif;
  return coalesce((select json_agg(json_build_object('classe', cl.libelle, 'niveau', cl.niveau,
            'effectif', (select count(*) from public.inscriptions i where i.classe_id = cl.id and i.exercice_id = ex),
            'mes_matieres', (select json_agg(m.libelle order by m.libelle) from public.attributions a join public.matieres m on m.id = a.matiere_id
                              where a.classe_id = cl.id and a.exercice_id = ex and a.enseignant_id = c.personnel))
          order by cl.ordre, cl.libelle)
     from public.classes cl where cl.etablissement_id = c.etab), '[]'::json);
end $$;

-- Toutes les données d'une classe pour l'exercice actif (le serveur MCP calcule moyennes, rangs, statistiques, discipline).
-- Un enseignant n'accède qu'aux classes où il enseigne.
create or replace function public.api_donnees_classe(p_cle text, p_classe text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare c record; ex uuid; cl uuid; ins uuid[];
begin
  select * into c from public._api_contexte(p_cle, false);
  select id into ex from public.exercices where etablissement_id = c.etab and actif;
  if ex is null then raise exception 'Aucun exercice actif dans l''établissement.' using errcode = 'P0001'; end if;
  cl := public._api_classe(c.etab, p_classe);
  if c.role = 'enseignant' and not exists (select 1 from public.attributions where classe_id = cl and exercice_id = ex and enseignant_id = c.personnel) then
    raise exception 'Vous n''enseignez pas dans la classe « % ».', p_classe using errcode = '42501';
  end if;
  select array_agg(id) into ins from public.inscriptions where classe_id = cl and exercice_id = ex;
  return json_build_object(
    'classe', (select json_build_object('libelle', libelle, 'coef_min', coef_min) from public.classes where id = cl),
    'exercice', (select libelle from public.exercices where id = ex),
    'sequences', (select json_agg(json_build_object('id', id, 'numero', numero, 'trimestre', trimestre, 'verrouillee', verrouillee) order by numero) from public.sequences where exercice_id = ex),
    'attributions', coalesce((select json_agg(json_build_object('id', a.id, 'code', m.code, 'matiere', m.libelle, 'coefficient', a.coefficient, 'groupe', a.groupe,
                         'enseignant', coalesce((select public._libelle(p.nom, p.prenom) from public.personnels p where p.id = a.enseignant_id), '')))
                       from public.attributions a join public.matieres m on m.id = a.matiere_id where a.classe_id = cl and a.exercice_id = ex), '[]'::json),
    'eleves', coalesce((select json_agg(json_build_object('inscription_id', i.id, 'matricule', e.matricule, 'nom', e.nom, 'prenom', e.prenom, 'sexe', e.sexe,
                         'date_naissance', e.date_naissance, 'redoublant', i.redoublant) order by e.nom, e.prenom)
                       from public.inscriptions i join public.eleves e on e.id = i.eleve_id where i.id = any(ins)), '[]'::json),
    'notes', coalesce((select json_agg(json_build_object('inscription_id', n.inscription_id, 'attribution_id', n.attribution_id, 'sequence_id', n.sequence_id, 'valeur', n.valeur))
                       from public.notes n where n.inscription_id = any(ins)), '[]'::json),
    'absences', coalesce((select json_agg(json_build_object('inscription_id', inscription_id, 'sequence_id', sequence_id, 'date', date,
                         'heures_non_justifiees', heures_non_justifiees, 'heures_justifiees', heures_justifiees))
                       from public.absences where inscription_id = any(ins)), '[]'::json),
    'retards', coalesce((select json_agg(json_build_object('inscription_id', inscription_id, 'sequence_id', sequence_id, 'date', date))
                       from public.retards where inscription_id = any(ins)), '[]'::json),
    'incidents', coalesce((select json_agg(json_build_object('inscription_id', x.inscription_id, 'sequence_id', x.sequence_id, 'date', x.date,
                         'libelle', f.libelle, 'points', s.points_perdus))
                       from public.incidents x join public.infractions f on f.id = x.infraction_id join public.sanctions s on s.id = f.sanction_id
                      where x.inscription_id = any(ins)), '[]'::json),
    'bareme', (select json_build_object('note_max', note_max, 'points_par_retard', points_par_retard, 'points_par_heure', points_par_heure)
                 from public.parametres_discipline where exercice_id = ex));
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Outils en écriture (tout ou rien)
-- ---------------------------------------------------------------------------------------------------------
-- p_notes : [{ "matricule": "...", "note": 12.5 }] ; une note vide (null) n'efface rien.
create or replace function public.api_saisir_notes(p_cle text, p_classe text, p_matiere text, p_sequence int, p_notes jsonb)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare c record; ex uuid; cl uuid; att uuid; seq record; l jsonb; ins uuid; v numeric; nb int := 0;
begin
  select * into c from public._api_contexte(p_cle, true);
  select id into ex from public.exercices where etablissement_id = c.etab and actif;
  cl := public._api_classe(c.etab, p_classe);
  select a.id into att from public.attributions a join public.matieres m on m.id = a.matiere_id
   where a.classe_id = cl and a.exercice_id = ex and (public._normaliser(m.code) = public._normaliser(p_matiere) or public._normaliser(m.libelle) = public._normaliser(p_matiere));
  if att is null then raise exception 'Matière « % » non enseignée en « % ».', p_matiere, p_classe using errcode = 'P0001'; end if;
  if not public.peut_noter(att) then raise exception 'Vous ne pouvez pas saisir les notes de cette matière dans cette classe.' using errcode = '42501'; end if;
  select id, verrouillee into seq from public.sequences where exercice_id = ex and numero = p_sequence;
  if seq.id is null then raise exception 'Séquence % inexistante (1 à 6).', p_sequence using errcode = 'P0001'; end if;
  if seq.verrouillee then raise exception 'La séquence % est verrouillée.', p_sequence using errcode = 'P0001'; end if;
  if jsonb_typeof(p_notes) <> 'array' or jsonb_array_length(p_notes) > 200 then raise exception 'Liste de notes invalide (200 au plus).' using errcode = 'P0001'; end if;
  for l in select * from jsonb_array_elements(p_notes) loop
    if l -> 'note' is null or jsonb_typeof(l -> 'note') = 'null' then continue; end if;
    select i.id into ins from public.inscriptions i join public.eleves e on e.id = i.eleve_id
     where i.classe_id = cl and i.exercice_id = ex and e.matricule = btrim(l ->> 'matricule');
    if ins is null then raise exception 'Élève de matricule « % » absent de la classe « % ».', l ->> 'matricule', p_classe using errcode = 'P0001'; end if;
    v := round(replace(l ->> 'note', ',', '.')::numeric, 2);
    if v < 0 or v > 20 then raise exception 'Note % invalide pour %, valeur entre 0 et 20.', l ->> 'note', l ->> 'matricule' using errcode = 'P0001'; end if;
    insert into public.notes (etablissement_id, inscription_id, attribution_id, sequence_id, valeur) values (c.etab, ins, att, seq.id, v)
    on conflict (inscription_id, attribution_id, sequence_id) do update set valeur = excluded.valeur;
    nb := nb + 1;
  end loop;
  perform public._api_journal(c.etab, c.personnel, c.source, 'saisir_notes',
    jsonb_build_object('classe', p_classe, 'matiere', p_matiere, 'sequence', p_sequence, 'notes', nb));
  return json_build_object('notes_enregistrees', nb);
end $$;

-- p_lignes : [{ "matricule", "heures_non_justifiees", "heures_justifiees", "motif", "retard" }] — l'appel du jour remplace celui déjà saisi
create or replace function public.api_enregistrer_appel(p_cle text, p_classe text, p_date date, p_sequence int, p_lignes jsonb)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare c record; ex uuid; cl uuid; seq uuid; l jsonb; ins uuid; nj int; j int; nb_abs int := 0; nb_ret int := 0;
begin
  select * into c from public._api_contexte(p_cle, true);
  if not public.peut_discipline() then raise exception 'L''appel est réservé à l''administration et au surveillant général.' using errcode = '42501'; end if;
  if p_date > current_date then raise exception 'La date de l''appel ne peut pas être dans le futur.' using errcode = 'P0001'; end if;
  select id into ex from public.exercices where etablissement_id = c.etab and actif;
  cl := public._api_classe(c.etab, p_classe);
  select id into seq from public.sequences where exercice_id = ex and numero = p_sequence;
  if seq is null then raise exception 'Séquence % inexistante (1 à 6).', p_sequence using errcode = 'P0001'; end if;
  for l in select * from jsonb_array_elements(coalesce(p_lignes, '[]')) loop
    select i.id into ins from public.inscriptions i join public.eleves e on e.id = i.eleve_id
     where i.classe_id = cl and i.exercice_id = ex and e.matricule = btrim(l ->> 'matricule');
    if ins is null then raise exception 'Élève de matricule « % » absent de la classe « % ».', l ->> 'matricule', p_classe using errcode = 'P0001'; end if;
    nj := coalesce((l ->> 'heures_non_justifiees')::int, 0); j := coalesce((l ->> 'heures_justifiees')::int, 0);
    delete from public.absences where inscription_id = ins and date = p_date;
    delete from public.retards where inscription_id = ins and date = p_date;
    if nj > 0 or j > 0 then
      insert into public.absences (etablissement_id, inscription_id, sequence_id, date, heures_non_justifiees, heures_justifiees, motif)
      values (c.etab, ins, seq, p_date, nj, j, left(coalesce(l ->> 'motif', ''), 200));
      nb_abs := nb_abs + 1;
    end if;
    if coalesce((l ->> 'retard')::boolean, false) then
      insert into public.retards (etablissement_id, inscription_id, sequence_id, date) values (c.etab, ins, seq, p_date);
      nb_ret := nb_ret + 1;
    end if;
  end loop;
  perform public._api_journal(c.etab, c.personnel, c.source, 'enregistrer_appel',
    jsonb_build_object('classe', p_classe, 'date', p_date, 'absences', nb_abs, 'retards', nb_ret));
  return json_build_object('absences', nb_abs, 'retards', nb_ret);
end $$;

create or replace function public.api_ajouter_eleve(p_cle text, p_matricule text, p_nom text, p_prenom text, p_sexe text,
                                                    p_date_naissance date, p_classe text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare c record; ex uuid; cl uuid; v uuid;
begin
  select * into c from public._api_contexte(p_cle, true);
  if not public.est_admin() then raise exception 'L''ajout d''élèves est réservé à l''administration.' using errcode = '42501'; end if;
  select id into ex from public.exercices where etablissement_id = c.etab and actif;
  cl := case when coalesce(p_classe, '') <> '' then public._api_classe(c.etab, p_classe) end;
  if exists (select 1 from public.eleves where etablissement_id = c.etab and matricule = btrim(p_matricule)) then
    raise exception 'Le matricule « % » existe déjà.', p_matricule using errcode = 'P0001';
  end if;
  insert into public.eleves (etablissement_id, matricule, nom, prenom, sexe, date_naissance)
  values (c.etab, btrim(p_matricule), upper(btrim(p_nom)), btrim(coalesce(p_prenom, '')), upper(p_sexe), p_date_naissance) returning id into v;
  if cl is not null and ex is not null then
    insert into public.inscriptions (etablissement_id, exercice_id, classe_id, eleve_id) values (c.etab, ex, cl, v);
  end if;
  perform public._api_journal(c.etab, c.personnel, c.source, 'ajouter_eleve', jsonb_build_object('matricule', p_matricule, 'classe', p_classe));
  return json_build_object('eleve', public._libelle(p_nom, p_prenom), 'matricule', btrim(p_matricule), 'classe', p_classe);
end $$;

-- Droits d'exécution
revoke execute on function public.definir_api_active(boolean), public.creer_cle_api(text, boolean, int), public.revoquer_cle_api(uuid),
  public._api_contexte(text, boolean), public._api_journal(uuid, uuid, text, text, jsonb), public._api_classe(uuid, text),
  public.api_contexte(text), public.api_classes(text), public.api_donnees_classe(text, text),
  public.api_saisir_notes(text, text, text, int, jsonb), public.api_enregistrer_appel(text, text, date, int, jsonb),
  public.api_ajouter_eleve(text, text, text, text, text, date, text) from public, anon, authenticated;
grant execute on function public.definir_api_active(boolean), public.creer_cle_api(text, boolean, int), public.revoquer_cle_api(uuid) to authenticated;
grant execute on function public.api_contexte(text), public.api_classes(text), public.api_donnees_classe(text, text),
  public.api_saisir_notes(text, text, text, int, jsonb), public.api_enregistrer_appel(text, text, date, int, jsonb),
  public.api_ajouter_eleve(text, text, text, text, text, date, text) to anon;
