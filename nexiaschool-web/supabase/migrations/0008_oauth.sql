-- OAuth 2.1 (autorisation par code + PKCE, clients publics, enregistrement dynamique) pour les connecteurs
-- personnalisés de Claude.ai et des autres agents IA. Les jetons d'accès « nxo_… » ouvrent les mêmes outils que
-- les clés API, avec les droits de la personne qui a donné son accord.

create table public.oauth_clients (
  id text primary key,
  nom text not null,
  redirect_uris text[] not null,
  cree_le timestamptz not null default now()
);

create table public.oauth_codes (
  code_hash text primary key,
  client_id text not null references public.oauth_clients (id) on delete cascade,
  etablissement_id uuid not null,
  personnel_id uuid not null,
  redirect_uri text not null,
  code_challenge text not null,
  ecriture boolean not null default false,
  expire_le timestamptz not null,
  foreign key (personnel_id, etablissement_id) references public.personnels (id, etablissement_id) on delete cascade
);

create table public.jetons_oauth (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null,
  personnel_id uuid not null,
  client_id text not null references public.oauth_clients (id) on delete cascade,
  acces_hash text not null unique,
  acces_expire_le timestamptz not null,
  rafraichissement_hash text not null unique,
  rafraichissement_expire_le timestamptz not null,
  ecriture boolean not null default false,
  cree_le timestamptz not null default now(),
  derniere_utilisation timestamptz,
  revoque_le timestamptz,
  foreign key (personnel_id, etablissement_id) references public.personnels (id, etablissement_id) on delete cascade
);
create index on public.jetons_oauth (etablissement_id);

alter table public.oauth_clients enable row level security;
alter table public.oauth_codes enable row level security;
alter table public.jetons_oauth enable row level security;
create policy "ses applications, ou toutes pour l'administration" on public.jetons_oauth for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (personnel_id = auth.uid() or (select public.est_admin())));
create policy "nom des applications autorisées" on public.oauth_clients for select to authenticated
  using (exists (select 1 from public.jetons_oauth j where j.client_id = oauth_clients.id and j.etablissement_id = (select public.etab_courant())));
revoke all on public.oauth_clients, public.oauth_codes, public.jetons_oauth from anon, authenticated;
grant select (id, etablissement_id, personnel_id, client_id, ecriture, cree_le, derniere_utilisation, revoque_le, rafraichissement_expire_le)
  on public.jetons_oauth to authenticated;
grant select (id, nom) on public.oauth_clients to authenticated;

create or replace function public._b64url_sha256(p text) returns text
language sql immutable set search_path = '' as $$
  select rtrim(translate(encode(extensions.digest(p, 'sha256'), 'base64'), '+/', '-_'), '=')
$$;

-- Enregistrement dynamique (RFC 7591) : clients publics, adresses de retour en https (ou boucle locale)
create or replace function public.oauth_enregistrer_client(p_nom text, p_redirect_uris text[])
returns json language plpgsql volatile security definer set search_path = '' as $$
declare v_id text := 'nxc_' || encode(extensions.gen_random_bytes(12), 'hex'); u text;
begin
  if p_redirect_uris is null or cardinality(p_redirect_uris) = 0 or cardinality(p_redirect_uris) > 5 then
    raise exception 'redirect_uris : 1 à 5 adresses attendues.' using errcode = 'P0001';
  end if;
  foreach u in array p_redirect_uris loop
    if not (u ~ '^https://[^\s]+$' or u ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]+)?(/[^\s]*)?$') or char_length(u) > 500 then
      raise exception 'Adresse de retour refusée : %', u using errcode = 'P0001';
    end if;
  end loop;
  if (select count(*) from public.oauth_clients where cree_le > now() - interval '1 day') >= 500 then
    raise exception 'Trop d''enregistrements aujourd''hui.' using errcode = 'P0001';
  end if;
  insert into public.oauth_clients (id, nom, redirect_uris) values (v_id, left(coalesce(nullif(btrim(p_nom), ''), 'Application'), 100), p_redirect_uris);
  return json_build_object('client_id', v_id, 'client_name', left(coalesce(nullif(btrim(p_nom), ''), 'Application'), 100),
                           'redirect_uris', p_redirect_uris, 'token_endpoint_auth_method', 'none',
                           'grant_types', json_build_array('authorization_code', 'refresh_token'), 'response_types', json_build_array('code'));
end $$;

-- Informations affichées sur la page d'autorisation
create or replace function public.oauth_info_client(p_client_id text, p_redirect_uri text) returns json
language sql stable security definer set search_path = '' as $$
  select coalesce((select json_build_object('nom', nom) from public.oauth_clients where id = p_client_id and p_redirect_uri = any(redirect_uris)),
                  json_build_object('erreur', 'Application inconnue ou adresse de retour non enregistrée.'))
$$;

-- Accord donné par la personne connectée à NexIA School : renvoie un code (5 minutes, usage unique)
create or replace function public.oauth_autoriser(p_client_id text, p_redirect_uri text, p_code_challenge text, p_methode text, p_ecriture boolean)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); code text;
begin
  if v_etab is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  if not (select api_active from public.etablissements where id = v_etab) then
    raise exception 'L''accès des agents IA n''est pas activé pour votre établissement (Espace développeur, administration).' using errcode = 'P0001';
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

create or replace function public._oauth_emettre(p_etab uuid, p_personnel uuid, p_client text, p_ecriture boolean) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare acces text := 'nxo_' || encode(extensions.gen_random_bytes(24), 'hex'); rafr text := 'nxr_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  insert into public.jetons_oauth (etablissement_id, personnel_id, client_id, acces_hash, acces_expire_le, rafraichissement_hash, rafraichissement_expire_le, ecriture)
  values (p_etab, p_personnel, p_client, encode(extensions.digest(acces, 'sha256'), 'hex'), now() + interval '1 hour',
          encode(extensions.digest(rafr, 'sha256'), 'hex'), now() + interval '30 days', p_ecriture);
  return json_build_object('access_token', acces, 'token_type', 'Bearer', 'expires_in', 3600, 'refresh_token', rafr,
                           'scope', case when p_ecriture then 'lecture ecriture' else 'lecture' end);
end $$;

-- Échange du code contre des jetons (vérification PKCE)
create or replace function public.oauth_echanger_code(p_code text, p_verifier text, p_client_id text, p_redirect_uri text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare k record;
begin
  delete from public.oauth_codes where code_hash = encode(extensions.digest(coalesce(p_code, ''), 'sha256'), 'hex') returning * into k;
  if k.code_hash is null or k.expire_le < now() or k.client_id <> p_client_id or k.redirect_uri <> p_redirect_uri
     or public._b64url_sha256(coalesce(p_verifier, '')) <> k.code_challenge then
    return json_build_object('error', 'invalid_grant', 'error_description', 'Code invalide, expiré ou déjà utilisé.');
  end if;
  return public._oauth_emettre(k.etablissement_id, k.personnel_id, k.client_id, k.ecriture);
end $$;

-- Rafraîchissement (rotation du jeton de rafraîchissement)
create or replace function public.oauth_rafraichir(p_refresh text, p_client_id text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare j record;
begin
  update public.jetons_oauth set revoque_le = now()
   where rafraichissement_hash = encode(extensions.digest(coalesce(p_refresh, ''), 'sha256'), 'hex')
     and client_id = p_client_id and revoque_le is null and rafraichissement_expire_le > now()
  returning * into j;
  if j.id is null or not exists (select 1 from public.personnels p join public.etablissements e on e.id = p.etablissement_id
                                  where p.id = j.personnel_id and p.actif and e.api_active) then
    return json_build_object('error', 'invalid_grant', 'error_description', 'Jeton de rafraîchissement invalide ou révoqué.');
  end if;
  return public._oauth_emettre(j.etablissement_id, j.personnel_id, j.client_id, j.ecriture);
end $$;

create or replace function public.revoquer_jeton_oauth(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.jetons_oauth set revoque_le = now()
   where id = p_id and etablissement_id = public.etab_courant() and revoque_le is null and (personnel_id = auth.uid() or public.est_admin());
  if not found then raise exception 'Accès introuvable ou déjà révoqué.' using errcode = 'P0001'; end if;
end $$;

-- Le contexte API reconnaît désormais aussi les jetons OAuth « nxo_… »
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
   where p.id = k.personnel_id and p.actif and e.api_active;
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

-- Désactiver l'API révoque aussi les applications autorisées
create or replace function public.definir_api_active(p_active boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin();
begin
  update public.etablissements set api_active = p_active where id = v_etab;
  if not p_active then
    update public.cles_api set revoquee_le = now() where etablissement_id = v_etab and revoquee_le is null;
    update public.jetons_oauth set revoque_le = now() where etablissement_id = v_etab and revoque_le is null;
  end if;
end $$;

revoke execute on function public._b64url_sha256(text), public.oauth_enregistrer_client(text, text[]), public.oauth_info_client(text, text),
  public.oauth_autoriser(text, text, text, text, boolean), public._oauth_emettre(uuid, uuid, text, boolean),
  public.oauth_echanger_code(text, text, text, text), public.oauth_rafraichir(text, text), public.revoquer_jeton_oauth(uuid),
  public._api_contexte(text, boolean), public.definir_api_active(boolean) from public, anon, authenticated;
grant execute on function public.oauth_enregistrer_client(text, text[]), public.oauth_info_client(text, text),
  public.oauth_echanger_code(text, text, text, text), public.oauth_rafraichir(text, text) to anon, authenticated;
grant execute on function public.oauth_autoriser(text, text, text, text, boolean), public.revoquer_jeton_oauth(uuid),
  public.definir_api_active(boolean) to authenticated;
