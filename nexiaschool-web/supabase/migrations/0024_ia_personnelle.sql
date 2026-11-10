-- IA et API activées par chaque personnel, pour son seul compte ; SmartEval ouvert à tous les personnels, sans préalable IA.
--  * personnels.ia_active : le personnel a activé la connexion de son compte à une IA (MCP ou clé API). Clés, autorisations OAuth
--    et appels du serveur MCP dépendent désormais de ce choix personnel, et non plus d'un réglage de tout l'établissement.
--  * etablissements.api_active devient un simple indicateur (au moins un personnel a activé l'IA), tenu à jour automatiquement.
--  * SmartEval : créer et publier une évaluation ne demande plus d'IA connectée ; tout personnel peut créer, sur son espace.
--    Classes et matières proposées : celles qui lui sont confiées ; l'administration, et tout personnel sans matière confiée,
--    choisissent parmi toutes les classes et matières du programme de l'année.

alter table public.personnels add column if not exists ia_active boolean not null default false;
alter table public.personnels add column if not exists ia_active_le timestamptz;
grant select (ia_active, ia_active_le) on public.personnels to authenticated;

-- Reprise : qui avait déjà une clé ou une application autorisée dans un établissement où l'accès était activé la garde
update public.personnels p set ia_active = true, ia_active_le = now()
  from public.etablissements e
 where e.id = p.etablissement_id and e.api_active and not p.ia_active
   and (exists (select 1 from public.cles_api k where k.personnel_id = p.id and k.revoquee_le is null and (k.expire_le is null or k.expire_le > now()))
     or exists (select 1 from public.jetons_oauth j where j.personnel_id = p.id and j.revoque_le is null and j.rafraichissement_expire_le > now()));
update public.etablissements e set api_active = exists (select 1 from public.personnels p where p.etablissement_id = e.id and p.actif and p.ia_active);

-- IA activée pour ce personnel (compte actif, établissement non suspendu)
create or replace function public._ia_active(p_personnel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.ia_active and p.actif and e.suspendu_le is null from public.personnels p join public.etablissements e on e.id = p.etablissement_id
                    where p.id = p_personnel), false)
$$;

/** Active ou désactive la connexion IA et API du personnel connecté (et de lui seul). Désactiver révoque ses clés et applications. */
create or replace function public.definir_ia_personnelle(p_active boolean) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant();
begin
  if v_etab is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  update public.personnels set ia_active = coalesce(p_active, false), ia_active_le = case when p_active then now() end where id = auth.uid();
  if not coalesce(p_active, false) then
    update public.cles_api set revoquee_le = now() where personnel_id = auth.uid() and revoquee_le is null;
    update public.jetons_oauth set revoque_le = now() where personnel_id = auth.uid() and revoque_le is null;
  end if;
  update public.etablissements set api_active = exists (select 1 from public.personnels where etablissement_id = v_etab and actif and ia_active) where id = v_etab;
  return coalesce(p_active, false);
end $$;

-- L'ancien réglage d'établissement n'existe plus : chaque personnel décide pour son compte
create or replace function public.definir_api_active(p_active boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  raise exception 'L''accès IA se règle désormais par chaque personnel, pour son compte, dans la rubrique « IA et API ».' using errcode = 'P0001';
end $$;

create or replace function public.creer_cle_api(p_nom text, p_ecriture boolean, p_jours int)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); cle text; v_id uuid;
begin
  if v_etab is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  if not public._ia_active(auth.uid()) then
    raise exception 'Activez d''abord la connexion IA et API de votre compte (rubrique « IA et API »).' using errcode = 'P0001';
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

create or replace function public.oauth_autoriser(p_client_id text, p_redirect_uri text, p_code_challenge text, p_methode text, p_ecriture boolean)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); code text;
begin
  if v_etab is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  if not public._ia_active(auth.uid()) then
    raise exception 'Activez d''abord la connexion IA et API de votre compte (rubrique « IA et API »).' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.oauth_clients where id = p_client_id and p_redirect_uri = any(redirect_uris)) then
    raise exception 'Application inconnue ou adresse de retour non enregistrée.' using errcode = 'P0001';
  end if;
  if coalesce(p_methode, '') <> 'S256' or coalesce(p_code_challenge, '') !~ '^[A-Za-z0-9_-]{43,128}$' then
    raise exception 'PKCE (S256) obligatoire.' using errcode = 'P0001';
  end if;
  code := encode(extensions.gen_random_bytes(32), 'hex');
  delete from public.oauth_codes where expire_le < now();
  insert into public.oauth_codes (code_hash, client_id, etablissement_id, personnel_id, redirect_uri, code_challenge, ecriture, expire_le)
  values (encode(extensions.digest(code, 'sha256'), 'hex'), p_client_id, v_etab, auth.uid(), p_redirect_uri, p_code_challenge,
          coalesce(p_ecriture, false), now() + interval '5 minutes');
  return json_build_object('code', code);
end $$;

create or replace function public.oauth_rafraichir(p_refresh text, p_client_id text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare j record;
begin
  update public.jetons_oauth set revoque_le = now()
   where rafraichissement_hash = encode(extensions.digest(coalesce(p_refresh, ''), 'sha256'), 'hex')
     and client_id = p_client_id and revoque_le is null and rafraichissement_expire_le > now()
  returning * into j;
  if j.id is null or not public._ia_active(j.personnel_id) then
    return json_build_object('error', 'invalid_grant', 'error_description', 'Jeton de rafraîchissement invalide ou révoqué.');
  end if;
  return public._oauth_emettre(j.etablissement_id, j.personnel_id, j.client_id, j.ecriture);
end $$;

-- Contexte d'un appel API / MCP : la connexion IA du personnel doit être activée
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
    from public.personnels p where p.id = k.personnel_id and public._ia_active(p.id);
  if not found then raise exception 'Connexion IA désactivée pour ce compte (rubrique « IA et API »).' using errcode = '42501'; end if;
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

-- IA connectée au compte (sert à proposer l'analyse par l'IA, plus à autoriser la création)
create or replace function public._smarteval_ia(p_personnel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public._ia_active(p_personnel)
     and (exists (select 1 from public.cles_api where personnel_id = p_personnel and revoquee_le is null and (expire_le is null or expire_le > now()))
       or exists (select 1 from public.jetons_oauth where personnel_id = p_personnel and revoque_le is null and rafraichissement_expire_le > now()))
$$;

-- Choix libre des classes et matières : administration, ou personnel à qui aucune matière n'est confiée cette année
create or replace function public._smarteval_libre(p_personnel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.personnels p where p.id = p_personnel and p.role = 'admin')
      or not exists (select 1 from public.attributions a join public.exercices x on x.id = a.exercice_id and x.actif where a.enseignant_id = p_personnel)
$$;

create or replace function public._smarteval_matieres(p_personnel uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with libre as (select public._smarteval_libre(p_personnel) v)
  select coalesce(jsonb_agg(jsonb_build_object('matiere_id', m.id, 'code', m.code, 'libelle', m.libelle,
           'classes', (select jsonb_agg(jsonb_build_object('id', c.id, 'libelle', c.libelle) order by c.ordre, c.libelle)
                         from public.classes c
                        where exists (select 1 from public.attributions a2 where a2.classe_id = c.id and a2.matiere_id = m.id and a2.exercice_id = x.id
                                        and ((select v from libre) or a2.enseignant_id = p_personnel))))
         order by m.libelle), '[]'::jsonb)
    from public.matieres m
    join public.personnels p on p.id = p_personnel and p.etablissement_id = m.etablissement_id
    join public.exercices x on x.etablissement_id = m.etablissement_id and x.actif
   where exists (select 1 from public.attributions a where a.matiere_id = m.id and a.exercice_id = x.id
                   and ((select v from libre) or a.enseignant_id = p_personnel))
$$;

create or replace function public.smarteval_contexte() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); s record;
begin
  if v_etab is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  select * into s from public._smarteval_sequence(v_etab);
  return jsonb_build_object(
    'ia_connectee', public._smarteval_ia(auth.uid()),
    'ia_active', public._ia_active(auth.uid()),
    'api_active', public._ia_active(auth.uid()),
    'libre', public._smarteval_libre(auth.uid()),
    'sequence', case when s.id is not null then jsonb_build_object('id', s.id, 'numero', s.numero) end,
    'matieres', public._smarteval_matieres(auth.uid()));
end $$;

/**
 * Enregistre (crée ou modifie) une évaluation non publiée — ouvert à tout personnel, sans préalable IA.
 * p = { id?, titre, consignes, competence, matiere_id, classes: [uuid], questions: [...] }
 */
create or replace function public.smarteval_enregistrer(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_etab uuid := public.etab_courant(); v_id uuid := nullif(p ->> 'id', '')::uuid; e public.evaluations; s record;
  v_classes uuid[]; v_mat uuid := nullif(p ->> 'matiere_id', '')::uuid; v_q jsonb; v_libre boolean := public._smarteval_libre(auth.uid());
begin
  if v_etab is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  select * into s from public._smarteval_sequence(v_etab);
  if s.id is null then raise exception 'Aucune séquence en cours : toutes les séquences sont verrouillées.' using errcode = 'P0001'; end if;
  if btrim(coalesce(p ->> 'titre', '')) = '' then raise exception 'Donnez un titre à l''évaluation.' using errcode = 'P0001'; end if;
  if btrim(coalesce(p ->> 'competence', '')) = '' then raise exception 'Indiquez la compétence visée.' using errcode = 'P0001'; end if;
  if v_mat is null or not exists (select 1 from public.attributions where matiere_id = v_mat and exercice_id = s.exercice_id
                                     and (v_libre or enseignant_id = auth.uid())) then
    raise exception 'Choisissez une matière du programme de cette année.' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct a.classe_id), '{}') into v_classes from public.attributions a
   where a.matiere_id = v_mat and a.exercice_id = s.exercice_id and (v_libre or a.enseignant_id = auth.uid())
     and a.classe_id::text in (select jsonb_array_elements_text(coalesce(p -> 'classes', '[]'::jsonb)));
  if cardinality(v_classes) = 0 then raise exception 'Choisissez au moins une classe.' using errcode = 'P0001'; end if;
  v_q := public._smarteval_questions(p -> 'questions');
  if v_id is null then
    insert into public.evaluations (etablissement_id, auteur_id, exercice_id, sequence_id, matiere_id, classes, titre, consignes, competence, questions)
    values (v_etab, auth.uid(), s.exercice_id, s.id, v_mat, v_classes, left(btrim(p ->> 'titre'), 150), left(coalesce(p ->> 'consignes', ''), 3000),
            left(btrim(p ->> 'competence'), 600), v_q)
    returning id into v_id;
  else
    e := public._smarteval_mienne(v_id);
    if e.jeton is not null then raise exception 'Évaluation déjà publiée : elle ne peut plus être modifiée.' using errcode = 'P0001'; end if;
    update public.evaluations set sequence_id = s.id, exercice_id = s.exercice_id, matiere_id = v_mat, classes = v_classes,
           titre = left(btrim(p ->> 'titre'), 150), consignes = left(coalesce(p ->> 'consignes', ''), 3000),
           competence = left(btrim(p ->> 'competence'), 600), questions = v_q, modifie_le = now()
     where id = v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.smarteval_publier(p_id uuid, p_valeur int, p_unite text, p_entete jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare e public.evaluations; v_jeton text; v_debut timestamptz;
begin
  e := public._smarteval_mienne(p_id);
  if p_unite not in ('heures', 'jours', 'semaines') or p_valeur is null or p_valeur < 1
     or (p_unite = 'heures' and p_valeur > 720) or (p_unite = 'jours' and p_valeur > 60) or (p_unite = 'semaines' and p_valeur > 8) then
    raise exception 'Durée invalide : 1 à 720 heures, 1 à 60 jours ou 1 à 8 semaines.' using errcode = 'P0001';
  end if;
  if p_entete is not null and pg_column_size(p_entete) > 250000 then raise exception 'En-tête trop volumineux (logo).' using errcode = 'P0001'; end if;
  v_jeton := coalesce(e.jeton, translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_'));
  v_debut := coalesce(e.publiee_le, now());
  update public.evaluations set jeton = v_jeton, publiee_le = v_debut,
         ferme_le = v_debut + case p_unite when 'heures' then make_interval(hours => p_valeur) when 'jours' then make_interval(days => p_valeur)
                                            else make_interval(days => 7 * p_valeur) end,
         duree_valeur = p_valeur, duree_unite = p_unite,
         entete = case when e.jeton is null then coalesce(p_entete, '{}'::jsonb) else e.entete end, modifie_le = now()
   where id = p_id returning * into e;
  return jsonb_build_object('jeton', e.jeton, 'publiee_le', e.publiee_le, 'ferme_le', e.ferme_le);
end $$;

revoke execute on function public._ia_active(uuid), public._smarteval_libre(uuid), public.definir_ia_personnelle(boolean) from public, anon, authenticated;
grant execute on function public.definir_ia_personnelle(boolean) to authenticated;
