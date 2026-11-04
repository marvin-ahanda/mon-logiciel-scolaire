-- Console du propriétaire de la plateforme NexIA School : vue d'ensemble, établissements, utilisateurs,
-- suspension, suppression, journal. Accès réservé aux comptes listés dans plateforme_admins (aucun droit direct
-- sur les tables : tout passe par des fonctions qui vérifient d'abord le propriétaire et journalisent les actions).

create table public.plateforme_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  ajoute_le timestamptz not null default now()
);
alter table public.plateforme_admins enable row level security;
revoke all on public.plateforme_admins from anon, authenticated;

insert into public.plateforme_admins (user_id)
select id from auth.users where lower(email) = 'marvinahanda944@gmail.com'
on conflict do nothing;

create table public.journal_plateforme (
  id bigint generated always as identity primary key,
  cree_le timestamptz not null default now(),
  auteur uuid,
  action text not null,
  cible text not null default '',
  details jsonb not null default '{}'
);
alter table public.journal_plateforme enable row level security;
revoke all on public.journal_plateforme from anon, authenticated;

-- Suspension d'un établissement : plus aucun accès (application, connexion, clés API), données conservées
alter table public.etablissements add column if not exists suspendu_le timestamptz;
alter table public.etablissements add column if not exists motif_suspension text not null default '' check (char_length(motif_suspension) <= 300);

create or replace function public.est_proprietaire() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.plateforme_admins where user_id = auth.uid())
$$;

create or replace function public._exiger_proprietaire() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.est_proprietaire() then raise exception 'Réservé au propriétaire de la plateforme.' using errcode = '42501'; end if;
end $$;

create or replace function public._journal_plateforme(p_action text, p_cible text, p_details jsonb) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.journal_plateforme (auteur, action, cible, details) values (auth.uid(), p_action, coalesce(p_cible, ''), coalesce(p_details, '{}'))
$$;

-- Les fonctions d'accès ignorent désormais les établissements suspendus : toutes les règles RLS en découlent
create or replace function public.etab_courant() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.etablissement_id from public.personnels p join public.etablissements e on e.id = p.etablissement_id
   where p.id = auth.uid() and p.actif and e.suspendu_le is null
$$;
create or replace function public.est_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.personnels p join public.etablissements e on e.id = p.etablissement_id
                  where p.id = auth.uid() and p.actif and p.role = 'admin' and e.suspendu_le is null)
$$;
create or replace function public.peut_discipline() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.personnels p join public.etablissements e on e.id = p.etablissement_id
                  where p.id = auth.uid() and p.actif and p.role in ('admin', 'surveillant') and e.suspendu_le is null)
$$;
create or replace function public._etab_du_jeton(p_jeton text) returns uuid
language sql stable security definer set search_path = '' as $$
  select j.etablissement_id from public.jetons_appareil j join public.etablissements e on e.id = j.etablissement_id
   where j.jeton_hash = encode(extensions.digest(coalesce(p_jeton, ''), 'sha256'), 'hex') and j.expire_le > now() and e.suspendu_le is null
$$;

create or replace function public.ouvrir_etablissement(p_nom text, p_code text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare
  cle text := 'etablissement:' || public._ip();
  e record; jeton text; attente int := public._minutes_de_blocage(cle);
begin
  if attente > 0 then
    raise exception 'Trop d''essais erronés depuis cet appareil. Réessayez dans % min.', attente using errcode = 'P0001';
  end if;
  select id, nom, code_hash, suspendu_le into e from public.etablissements where nom_normalise = public._normaliser(p_nom);
  -- même temps de réponse que le nom existe ou non (un hachage est calculé dans les deux cas)
  if not public._verifier(lower(btrim(coalesce(p_code, ''))), coalesce(e.code_hash, public._hacher('leurre'))) or e.id is null then
    perform public._echec(cle, 10, 15);
    return json_build_object('erreur', 'Nom ou code de l''établissement incorrect.');
  end if;
  perform public._reussite(cle);
  if e.suspendu_le is not null then
    return json_build_object('erreur', 'L''espace de cet établissement est suspendu. Contactez NexIA School : contact@nexiaacademy.net.');
  end if;
  delete from public.jetons_appareil where expire_le < now();
  jeton := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.jetons_appareil (jeton_hash, etablissement_id, expire_le)
  values (encode(extensions.digest(jeton, 'sha256'), 'hex'), e.id, now() + interval '30 days');
  return json_build_object('etablissement', e.nom, 'jeton', jeton);
end $$;

-- Clés API et jetons OAuth : refusés pour un établissement suspendu
create or replace function public._api_contexte(p_jeton text, p_ecriture boolean)
returns table (etab uuid, personnel uuid, role text, ecriture boolean, jeton_id uuid, source text)
language plpgsql volatile security definer set search_path = '' as $$
declare h text := encode(extensions.digest(coalesce(p_jeton, ''), 'sha256'), 'hex'); k record; n int;
begin
  if p_jeton like 'nxo_%' then
    select j.id, j.etablissement_id, j.personnel_id, j.ecriture, 'application : ' || c.nom as source into k
      from public.jetons_oauth j join public.oauth_clients c on c.id = j.client_id
     where j.acces_hash = h and j.revoque_le is null and j.acces_expire_le > now();
  else
    select c.id, c.etablissement_id, c.personnel_id, c.ecriture, 'clé : ' || c.nom as source into k
      from public.cles_api c where c.cle_hash = h and c.revoquee_le is null and (c.expire_le is null or c.expire_le > now());
  end if;
  if k.id is null then
    raise exception 'Clé API ou jeton invalide, expiré ou révoqué.' using errcode = '28000';
  end if;
  return query select k.etablissement_id, k.personnel_id, p.role, k.ecriture, k.id, k.source
    from public.personnels p join public.etablissements e on e.id = p.etablissement_id
   where p.id = k.personnel_id and p.actif and e.api_active and e.suspendu_le is null;
  if not found then raise exception 'Accès API désactivé pour cet établissement ou ce compte.' using errcode = '42501'; end if;
  if p_ecriture and not k.ecriture then
    raise exception 'Accès en lecture seule : autorisez l''écriture (nouvelle clé ou nouvelle autorisation).' using errcode = '42501';
  end if;
  insert into public.api_compteurs as a (jeton_id, minute, n) values (k.id, date_trunc('minute', now()), 1)
  on conflict on constraint api_compteurs_pkey do update set n = a.n + 1 returning a.n into n;
  if n > 60 then raise exception 'Limite de 60 appels par minute atteinte : réessayez dans un instant.' using errcode = 'P0429'; end if;
  delete from public.api_compteurs where minute < now() - interval '1 hour';
  if p_jeton like 'nxo_%' then
    update public.jetons_oauth set derniere_utilisation = now() where id = k.id and (derniere_utilisation is null or derniere_utilisation < now() - interval '1 minute');
  else
    update public.cles_api set derniere_utilisation = now() where id = k.id and (derniere_utilisation is null or derniere_utilisation < now() - interval '1 minute');
  end if;
  perform set_config('request.jwt.claim.sub', k.personnel_id::text, true);
end $$;

-- Statut du compte connecté (avant même la lecture du profil) : propriétaire ? établissement suspendu ?
create or replace function public.mon_compte() returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'proprietaire', public.est_proprietaire(),
    'suspendu', e.suspendu_le is not null,
    'motif', coalesce(e.motif_suspension, ''),
    'etablissement', e.nom)
  from (select 1) x
  left join public.personnels p on p.id = auth.uid()
  left join public.etablissements e on e.id = p.etablissement_id
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Lecture
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._stockage_etab(p_etab uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects
   where bucket_id in ('photos', 'logos') and name like p_etab::text || '/%'
$$;

create or replace function public._derniere_activite(p_etab uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select max(x) from (
    select max(p.derniere_connexion) x from public.personnels p where p.etablissement_id = p_etab
    union all select max(u.last_sign_in_at) from public.personnels p join auth.users u on u.id = p.id where p.etablissement_id = p_etab
    union all select max(n.maj) from public.notes n where n.etablissement_id = p_etab) t
$$;

create or replace function public.console_resume() returns json
language plpgsql stable security definer set search_path = '' as $$
declare r json;
begin
  perform public._exiger_proprietaire();
  with act as (select e.id, public._derniere_activite(e.id) d from public.etablissements e)
  select json_build_object(
    'etablissements', (select count(*) from public.etablissements),
    'suspendus', (select count(*) from public.etablissements where suspendu_le is not null),
    'nouveaux_7j', (select count(*) from public.etablissements where cree_le > now() - interval '7 days'),
    'nouveaux_30j', (select count(*) from public.etablissements where cree_le > now() - interval '30 days'),
    'actifs_7j', (select count(*) from act where d > now() - interval '7 days'),
    'actifs_30j', (select count(*) from act where d > now() - interval '30 days'),
    'personnels', (select count(*) from public.personnels),
    'personnels_actifs', (select count(*) from public.personnels where actif),
    'par_role', (select json_object_agg(role, n) from (select role, count(*) n from public.personnels group by role) x),
    'eleves', (select count(*) from public.eleves),
    'classes', (select count(*) from public.classes),
    'notes', (select count(*) from public.notes),
    'notes_7j', (select count(*) from public.notes where maj > now() - interval '7 days'),
    'api_actives', (select count(*) from public.etablissements where api_active),
    'appels_api_30j', (select count(*) from public.journal_api where cree_le > now() - interval '30 days'),
    'stockage_octets', (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects where bucket_id in ('photos', 'logos')),
    'base_octets', pg_database_size(current_database()),
    'inscriptions_par_mois', (
      select json_agg(json_build_object('mois', to_char(m, 'YYYY-MM'), 'n',
                      (select count(*) from public.etablissements e where date_trunc('month', e.cree_le) = m)) order by m)
        from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m),
    'derniers', (select coalesce(json_agg(json_build_object('id', id, 'nom', nom, 'ville', ville, 'cree_le', cree_le) order by cree_le desc), '[]')
                   from (select * from public.etablissements order by cree_le desc limit 5) x)
  ) into r;
  return r;
end $$;

create or replace function public.console_etablissements() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exiger_proprietaire();
  return coalesce((select json_agg(json_build_object(
      'id', e.id, 'nom', e.nom, 'ville', e.ville, 'telephone', e.telephone, 'site_web', e.site_web, 'cree_le', e.cree_le,
      'suspendu_le', e.suspendu_le, 'motif_suspension', e.motif_suspension, 'api_active', e.api_active,
      'fondateur', (select json_build_object('nom', public._libelle(p.nom, p.prenom), 'email', u.email)
                      from public.personnels p join auth.users u on u.id = p.id
                     where p.etablissement_id = e.id and p.compte_google order by p.cree_le limit 1),
      'personnels', (select count(*) from public.personnels p where p.etablissement_id = e.id),
      'eleves', (select count(*) from public.eleves x where x.etablissement_id = e.id),
      'classes', (select count(*) from public.classes x where x.etablissement_id = e.id),
      'notes', (select count(*) from public.notes x where x.etablissement_id = e.id),
      'derniere_activite', public._derniere_activite(e.id),
      'stockage_octets', public._stockage_etab(e.id),
      'contient_proprietaire', exists (select 1 from public.personnels p join public.plateforme_admins a on a.user_id = p.id where p.etablissement_id = e.id))
    order by e.cree_le desc) from public.etablissements e), '[]');
end $$;

create or replace function public.console_etablissement(p_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare r json;
begin
  perform public._exiger_proprietaire();
  select json_build_object(
    'id', e.id, 'nom', e.nom, 'ville', e.ville, 'adresse', e.adresse, 'telephone', e.telephone, 'site_web', e.site_web,
    'devise', e.devise, 'nom_chef', e.nom_chef, 'cree_le', e.cree_le, 'code_genere_le', e.code_genere_le, 'api_active', e.api_active,
    'suspendu_le', e.suspendu_le, 'motif_suspension', e.motif_suspension, 'logo', e.logo is not null,
    'derniere_activite', public._derniere_activite(e.id), 'stockage_octets', public._stockage_etab(e.id),
    'contient_proprietaire', exists (select 1 from public.personnels p join public.plateforme_admins a on a.user_id = p.id where p.etablissement_id = e.id),
    'compteurs', json_build_object(
      'eleves', (select count(*) from public.eleves x where x.etablissement_id = e.id),
      'classes', (select count(*) from public.classes x where x.etablissement_id = e.id),
      'matieres', (select count(*) from public.matieres x where x.etablissement_id = e.id),
      'notes', (select count(*) from public.notes x where x.etablissement_id = e.id),
      'absences', (select count(*) from public.absences x where x.etablissement_id = e.id),
      'cles_api', (select count(*) from public.cles_api x where x.etablissement_id = e.id and x.revoquee_le is null),
      'appels_api_30j', (select count(*) from public.journal_api x where x.etablissement_id = e.id and x.cree_le > now() - interval '30 days')),
    'exercices', coalesce((select json_agg(json_build_object('libelle', x.libelle, 'actif', x.actif) order by x.libelle desc)
                             from public.exercices x where x.etablissement_id = e.id), '[]'),
    'classes', coalesce((select json_agg(json_build_object('libelle', c.libelle,
                           'effectif', (select count(*) from public.inscriptions i join public.exercices x on x.id = i.exercice_id and x.actif where i.classe_id = c.id))
                           order by c.ordre, c.libelle) from public.classes c where c.etablissement_id = e.id), '[]'),
    'personnels', coalesce((select json_agg(json_build_object('id', p.id, 'nom', public._libelle(p.nom, p.prenom), 'role', p.role, 'actif', p.actif,
                              'compte_google', p.compte_google, 'email', case when p.compte_google then u.email end, 'cree_le', p.cree_le,
                              'derniere_connexion', greatest(p.derniere_connexion, case when p.compte_google then u.last_sign_in_at end),
                              'proprietaire', exists (select 1 from public.plateforme_admins a where a.user_id = p.id))
                              order by p.role, p.nom) from public.personnels p left join auth.users u on u.id = p.id where p.etablissement_id = e.id), '[]')
  ) into r from public.etablissements e where e.id = p_id;
  if r is null then raise exception 'Établissement introuvable.' using errcode = 'P0001'; end if;
  return r;
end $$;

-- Consultation des élèves d'un établissement : action explicite, journalisée (données de mineurs)
create or replace function public.console_eleves(p_id uuid) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare v_nom text;
begin
  perform public._exiger_proprietaire();
  select nom into v_nom from public.etablissements where id = p_id;
  if v_nom is null then raise exception 'Établissement introuvable.' using errcode = 'P0001'; end if;
  perform public._journal_plateforme('consultation des élèves', v_nom, json_build_object('etablissement_id', p_id)::jsonb);
  return coalesce((select json_agg(json_build_object('matricule', el.matricule, 'nom', public._libelle(el.nom, el.prenom), 'sexe', el.sexe,
            'classe', (select c.libelle from public.inscriptions i join public.exercices x on x.id = i.exercice_id and x.actif
                         join public.classes c on c.id = i.classe_id where i.eleve_id = el.id limit 1)) order by el.nom, el.prenom)
    from public.eleves el where el.etablissement_id = p_id), '[]');
end $$;

create or replace function public.console_utilisateurs() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exiger_proprietaire();
  return coalesce((select json_agg(json_build_object(
      'id', p.id, 'nom', public._libelle(p.nom, p.prenom), 'role', p.role, 'actif', p.actif, 'compte_google', p.compte_google,
      'email', case when p.compte_google then u.email end, 'cree_le', p.cree_le,
      'derniere_connexion', greatest(p.derniere_connexion, case when p.compte_google then u.last_sign_in_at end),
      'etablissement_id', e.id, 'etablissement', e.nom, 'etablissement_suspendu', e.suspendu_le is not null,
      'proprietaire', exists (select 1 from public.plateforme_admins a where a.user_id = p.id))
    order by e.nom, p.nom) from public.personnels p join public.etablissements e on e.id = p.etablissement_id left join auth.users u on u.id = p.id), '[]');
end $$;

create or replace function public.console_journal(p_limite int default 200) returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exiger_proprietaire();
  return coalesce((select json_agg(json_build_object('cree_le', j.cree_le, 'action', j.action, 'cible', j.cible, 'details', j.details,
            'auteur', coalesce((select u.email from auth.users u where u.id = j.auteur), '—')) order by j.cree_le desc)
    from (select * from public.journal_plateforme order by cree_le desc limit least(greatest(coalesce(p_limite, 200), 1), 1000)) j), '[]');
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.console_suspendre(p_id uuid, p_motif text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_nom text;
begin
  perform public._exiger_proprietaire();
  if char_length(btrim(coalesce(p_motif, ''))) < 3 then raise exception 'Indiquez le motif de la suspension.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.personnels p join public.plateforme_admins a on a.user_id = p.id where p.etablissement_id = p_id) then
    raise exception 'Cet établissement contient votre compte propriétaire : il ne peut pas être suspendu depuis la console.' using errcode = 'P0001';
  end if;
  update public.etablissements set suspendu_le = now(), motif_suspension = left(btrim(p_motif), 300) where id = p_id and suspendu_le is null returning nom into v_nom;
  if v_nom is null then raise exception 'Établissement introuvable ou déjà suspendu.' using errcode = 'P0001'; end if;
  delete from public.jetons_appareil where etablissement_id = p_id;
  perform public._journal_plateforme('suspension', v_nom, json_build_object('motif', btrim(p_motif))::jsonb);
end $$;

create or replace function public.console_reactiver(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_nom text;
begin
  perform public._exiger_proprietaire();
  update public.etablissements set suspendu_le = null, motif_suspension = '' where id = p_id and suspendu_le is not null returning nom into v_nom;
  if v_nom is null then raise exception 'Établissement introuvable ou non suspendu.' using errcode = 'P0001'; end if;
  perform public._journal_plateforme('réactivation', v_nom, '{}');
end $$;

create or replace function public.console_activer_utilisateur(p_id uuid, p_actif boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare p record;
begin
  perform public._exiger_proprietaire();
  select pe.*, e.nom etab into p from public.personnels pe join public.etablissements e on e.id = pe.etablissement_id where pe.id = p_id;
  if p.id is null then raise exception 'Utilisateur introuvable.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.plateforme_admins where user_id = p_id) then
    raise exception 'Votre compte propriétaire ne peut pas être désactivé.' using errcode = 'P0001';
  end if;
  update public.personnels set actif = p_actif where id = p_id;
  if not p_actif then
    update public.cles_api set revoquee_le = now() where personnel_id = p_id and revoquee_le is null;
    update public.jetons_oauth set revoque_le = now() where personnel_id = p_id and revoque_le is null;
  end if;
  perform public._journal_plateforme(case when p_actif then 'réactivation d''un utilisateur' else 'désactivation d''un utilisateur' end,
                                     public._libelle(p.nom, p.prenom) || ' (' || p.etab || ')', json_build_object('role', p.role)::jsonb);
end $$;

create or replace function public.console_supprimer_utilisateur(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare p record;
begin
  perform public._exiger_proprietaire();
  select pe.*, e.nom etab into p from public.personnels pe join public.etablissements e on e.id = pe.etablissement_id where pe.id = p_id;
  if p.id is null then raise exception 'Utilisateur introuvable.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.plateforme_admins where user_id = p_id) then
    raise exception 'Votre compte propriétaire ne peut pas être supprimé.' using errcode = 'P0001';
  end if;
  if p.role = 'admin' and not exists (select 1 from public.personnels x where x.etablissement_id = p.etablissement_id and x.role = 'admin' and x.actif and x.id <> p_id) then
    raise exception 'C''est le dernier administrateur de « % » : supprimez plutôt l''établissement, ou nommez d''abord un autre administrateur.', p.etab using errcode = 'P0001';
  end if;
  delete from auth.users where id = p_id;            -- le profil, ses clés et ses accès suivent (cascade)
  perform public._journal_plateforme('suppression d''un utilisateur', public._libelle(p.nom, p.prenom) || ' (' || p.etab || ')',
                                     json_build_object('role', p.role, 'compte_google', p.compte_google)::jsonb);
end $$;

-- Suppression définitive d'un établissement et de toutes ses données (les fichiers sont effacés ensuite
-- par la fonction serveur « console-fichiers », seule à pouvoir supprimer dans le stockage).
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
  delete from public.inscriptions where etablissement_id = p_id;          -- avant les classes (suppression restreinte)
  delete from auth.users where id in (select id from public.personnels where etablissement_id = p_id);
  delete from public.jetons_appareil where etablissement_id = p_id;
  delete from public.etablissements where id = p_id;
  perform public._journal_plateforme('suppression d''un établissement', e.nom,
                                     json_build_object('etablissement_id', p_id, 'personnels', n_pers, 'eleves', n_el)::jsonb);
  return json_build_object('supprime', true, 'etablissement_id', p_id);
end $$;

-- Utilisée par la fonction serveur : le propriétaire peut faire effacer les fichiers d'un établissement supprimé
create or replace function public.console_fichiers_purgeables(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.est_proprietaire() and not exists (select 1 from public.etablissements where id = p_id)
$$;

-- Droits
revoke execute on function public.est_proprietaire(), public._exiger_proprietaire(), public._journal_plateforme(text, text, jsonb),
  public.mon_compte(), public._stockage_etab(uuid), public._derniere_activite(uuid), public.console_resume(), public.console_etablissements(),
  public.console_etablissement(uuid), public.console_eleves(uuid), public.console_utilisateurs(), public.console_journal(int),
  public.console_suspendre(uuid, text), public.console_reactiver(uuid), public.console_activer_utilisateur(uuid, boolean),
  public.console_supprimer_utilisateur(uuid), public.console_supprimer_etablissement(uuid, text), public.console_fichiers_purgeables(uuid)
  from public, anon, authenticated;
grant execute on function public.est_proprietaire(), public.mon_compte(), public.console_resume(), public.console_etablissements(),
  public.console_etablissement(uuid), public.console_eleves(uuid), public.console_utilisateurs(), public.console_journal(int),
  public.console_suspendre(uuid, text), public.console_reactiver(uuid), public.console_activer_utilisateur(uuid, boolean),
  public.console_supprimer_utilisateur(uuid), public.console_supprimer_etablissement(uuid, text), public.console_fichiers_purgeables(uuid)
  to authenticated;
