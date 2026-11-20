-- Assistants IA des parents (MCP : Claude, Grok…) — offre Premium (fonctionnalité « ia » de l'établissement).
-- Un parent connecte son IA depuis l'espace de son enfant : clé personnelle « nxa_… » (affichée une seule fois, valable
-- 180 jours) ou autorisation OAuth (connecteur Claude.ai, adresses de retour vérifiées). L'IA n'accède qu'aux données de
-- CET enfant et aux informations de l'école que le parent voit déjà : chaque appel ouvre une session parent éphémère
-- (2 minutes, jamais renvoyée) et passe par les mêmes fonctions « parent_* » que l'espace parents.
-- Écritures (écrire à l'école, répondre à un courrier, accuser réception) : l'IA ne fait que PRÉPARER un brouillon ; le parent
-- le valide lui-même dans son espace (onglet « Mon assistant IA »). Une consigne cachée dans un texte ne peut donc rien envoyer.
-- Chaque appel est journalisé, y compris les appels en erreur ; 300 appels par heure et par accès ; accès révocables.

-- ---------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.acces_ia_parents (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  eleve_id uuid not null references public.eleves (id) on delete cascade,
  type text not null check (type in ('cle', 'oauth')),
  libelle text not null default '' check (char_length(libelle) <= 60),
  client_id text references public.oauth_clients (id) on delete cascade,
  acces_hash text not null unique,
  acces_expire_le timestamptz not null,                         -- clé : 180 jours ; OAuth : 1 heure
  rafraichissement_hash text unique,
  rafraichissement_expire_le timestamptz,
  cree_le timestamptz not null default now(),
  derniere_utilisation timestamptz,
  revoque_le timestamptz
);
create index if not exists acces_ia_parents_eleve on public.acces_ia_parents (eleve_id);

create table if not exists public.journal_api_parents (
  id bigint generated always as identity primary key,
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  acces_id uuid references public.acces_ia_parents (id) on delete cascade,
  outil text not null,
  erreur text not null default '',
  le timestamptz not null default now()
);
create index if not exists journal_api_parents_acces on public.journal_api_parents (acces_id, le desc);

create table if not exists public.oauth_codes_parents (
  code_hash text primary key,
  client_id text not null references public.oauth_clients (id) on delete cascade,
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  eleve_id uuid not null references public.eleves (id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  expire_le timestamptz not null
);

-- Hôtes de retour OAuth acceptés pour un parent (applications d'IA reconnues) : protège contre une application qui se ferait
-- passer pour « Claude » avec une adresse de retour piégée. Liste tenue par la plateforme (console), pas par les écoles.
create table if not exists public.oauth_hotes_parents (
  hote text primary key check (hote ~ '^[a-z0-9.-]+$'),
  nom text not null default ''
);
insert into public.oauth_hotes_parents (hote, nom) values ('claude.ai', 'Claude'), ('claude.com', 'Claude') on conflict do nothing;

-- Écritures préparées par l'assistant, en attente de la validation du parent
create table if not exists public.brouillons_ia_parents (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  eleve_id uuid not null references public.eleves (id) on delete cascade,
  acces_id uuid references public.acces_ia_parents (id) on delete set null,
  action text not null check (action in ('ecrire_ecole', 'repondre_courrier', 'accuser_reception')),
  contenu jsonb not null check (jsonb_typeof(contenu) = 'object' and pg_column_size(contenu) <= 20000),
  statut text not null default 'en_attente' check (statut in ('en_attente', 'envoye', 'rejete')),
  cree_le timestamptz not null default now(),
  traite_le timestamptz
);
create index if not exists brouillons_ia_parents_eleve on public.brouillons_ia_parents (eleve_id, statut);

alter table public.acces_ia_parents enable row level security;
alter table public.journal_api_parents enable row level security;
alter table public.oauth_codes_parents enable row level security;
alter table public.oauth_hotes_parents enable row level security;
alter table public.brouillons_ia_parents enable row level security;
-- l'administration voit combien de parents ont connecté une IA (sans les secrets) et leurs appels
create policy "administration" on public.acces_ia_parents for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));
create policy "administration" on public.journal_api_parents for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));
revoke all on public.acces_ia_parents, public.journal_api_parents, public.oauth_codes_parents, public.oauth_hotes_parents, public.brouillons_ia_parents
  from anon, authenticated;
grant select (id, etablissement_id, eleve_id, type, libelle, cree_le, derniere_utilisation, revoque_le) on public.acces_ia_parents to authenticated;
grant select on public.journal_api_parents to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Situation financière ciblée : la règle de 0046 limitée à une inscription (pas de calcul pour toute l'école)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._tranches_situation(p_etab uuid, p_date date, p_insc uuid)
returns table (inscription_id uuid, eleve_id uuid, echeance_id uuid, rang smallint, libelle text, date_limite date, montant bigint, paye bigint, reste bigint)
language sql stable security definer set search_path = '' as $$
  with ex as (select x.id from public.exercices x where x.etablissement_id = p_etab and x.actif),
  f as (select fs.* from public.frais_scolarite fs join ex on ex.id = fs.exercice_id),
  ech as (select e.* from public.echeances e join ex on ex.id = e.exercice_id),
  tot as (select sum(montant) total, count(*) n from ech),
  ins as (select i.id, i.eleve_id, case when i.nouveau then f.pension_nouveaux else f.pension_anciens end pension
            from public.inscriptions i join ex on ex.id = i.exercice_id cross join f where p_insc is null or i.id = p_insc),
  pay as (select p.inscription_id, sum(p.montant) paye from public.paiements p
           where p.etablissement_id = p_etab and p.date_paiement <= p_date and (p_insc is null or p.inscription_id = p_insc) group by p.inscription_id),
  lig as (select ins.id ins_id, ins.eleve_id, ech.id ec_id, ech.rang, ech.libelle, ech.date_limite,
                 (ech.montant + case when ech.rang = 0 then ins.pension - tot.total else 0 end)::bigint montant
            from ins cross join tot cross join ech where tot.n = 5),
  lig2 as (select l.*, coalesce(sum(l.montant) over (partition by l.ins_id order by l.rang rows between unbounded preceding and 1 preceding), 0) cum_avant
             from lig l)
  select l.ins_id, l.eleve_id, l.ec_id, l.rang, l.libelle, l.date_limite, l.montant,
         least(greatest(coalesce(p.paye, 0) - l.cum_avant, 0), l.montant)::bigint,
         (l.montant - least(greatest(coalesce(p.paye, 0) - l.cum_avant, 0), l.montant))::bigint
    from lig2 l left join pay p on p.inscription_id = l.ins_id
$$;
create or replace function public._tranches_situation(p_etab uuid, p_date date)
returns table (inscription_id uuid, eleve_id uuid, echeance_id uuid, rang smallint, libelle text, date_limite date, montant bigint, paye bigint, reste bigint)
language sql stable security definer set search_path = '' as $$
  select * from public._tranches_situation(p_etab, p_date, null)
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Outils internes
-- ---------------------------------------------------------------------------------------------------------

/** L'établissement de l'élève offre-t-il l'IA aux parents (offre Premium ou fonctionnalité activée par NexIA) ? */
create or replace function public._ia_parents_ouverte(p_etab uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select e.suspendu_le is null from public.etablissements e where e.id = p_etab), false) and public._offre_inclut(p_etab, 'ia')
$$;

/** Accès IA d'un parent : vérifie la clé ou le jeton, l'offre, l'inscription de l'élève, la limite d'appels (verrou par accès) ;
 *  journalise. Erreur 28000 : accès refusé (le serveur MCP répond 401). */
create or replace function public._api_parent(p_cle text, p_outil text) returns public.acces_ia_parents
language plpgsql volatile security definer set search_path = '' as $$
declare a public.acces_ia_parents; n int;
begin
  if coalesce(p_cle, '') !~ '^nxa_[0-9a-f]{48}$' then raise exception 'Clé d''accès parent invalide.' using errcode = '28000'; end if;
  select * into a from public.acces_ia_parents where acces_hash = encode(extensions.digest(p_cle, 'sha256'), 'hex');
  if a.id is null or a.revoque_le is not null or a.acces_expire_le < now() then
    raise exception 'Accès révoqué ou expiré : reconnectez votre assistant depuis l''espace parents.' using errcode = '28000';
  end if;
  if not public._ia_parents_ouverte(a.etablissement_id) then
    raise exception 'La connexion d''un assistant IA n''est pas ouverte pour cet établissement (offre Premium).' using errcode = '28000';
  end if;
  if not exists (select 1 from public.inscriptions i join public.exercices x on x.id = i.exercice_id and x.actif
                  where i.eleve_id = a.eleve_id and i.etablissement_id = a.etablissement_id) then
    raise exception 'L''élève n''est pas inscrit pour l''année en cours.' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtext('ia_parent:' || a.id::text));     -- appels simultanés : comptés l'un après l'autre
  select count(*) into n from public.journal_api_parents where acces_id = a.id and le > now() - interval '1 hour';
  if n >= 300 then raise exception 'Limite atteinte : 300 appels par heure. Réessayez plus tard.' using errcode = 'P0001'; end if;
  insert into public.journal_api_parents (etablissement_id, acces_id, outil) values (a.etablissement_id, a.id, left(coalesce(p_outil, ''), 40));
  update public.acces_ia_parents set derniere_utilisation = now()
   where id = a.id and (derniere_utilisation is null or derniere_utilisation < now() - interval '1 minute');
  return a;
end $$;

/** Situation financière de l'élève pour son parent : échéancier, paiements (n° de reçu), prochaine échéance. */
create or replace function public._parent_finances(p_etab uuid, p_eleve uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_insc uuid; jour date := public._aujourdhui();
begin
  select i.id into v_insc from public.inscriptions i join public.exercices x on x.id = i.exercice_id and x.actif
   where i.eleve_id = p_eleve and i.etablissement_id = p_etab;
  return (with t as (select * from public._tranches_situation(p_etab, jour, v_insc))
    select jsonb_build_object(
      'configure', exists (select 1 from t), 'aujourdhui', jour,
      'echeances', (select coalesce(jsonb_agg(jsonb_build_object('libelle', libelle, 'date_limite', date_limite, 'montant', montant, 'paye', paye, 'reste', reste,
                       'echue', date_limite < jour) order by rang), '[]'::jsonb) from t),
      'total_du', (select coalesce(sum(montant), 0) from t), 'total_paye', (select coalesce(sum(paye), 0) from t), 'reste', (select coalesce(sum(reste), 0) from t),
      'en_retard', (select coalesce(sum(reste), 0) from t where date_limite < jour),
      'prochaine_echeance', (select jsonb_build_object('libelle', libelle, 'date_limite', date_limite, 'reste', reste) from t where reste > 0 order by rang limit 1),
      'paiements', (select coalesce(jsonb_agg(jsonb_build_object('recu', p.numero, 'date', p.date_paiement, 'montant', p.montant) order by p.date_paiement), '[]'::jsonb)
                      from public.paiements p where p.inscription_id = v_insc),
      'devise', 'FCFA'));
end $$;

/** Emploi du temps publié de la classe de l'élève (le plus récent) : jour, horaire, matière, enseignant. */
create or replace function public._parent_emploi_du_temps(p_etab uuid, p_eleve uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_classe uuid; e public.emplois_du_temps; per jsonb;
begin
  select i.classe_id into v_classe from public.inscriptions i join public.exercices x on x.id = i.exercice_id and x.actif
   where i.eleve_id = p_eleve and i.etablissement_id = p_etab;
  select * into e from public.emplois_du_temps where etablissement_id = p_etab and publie and statut = 'officiel'
     and exercice_id = (select id from public.exercices where etablissement_id = p_etab and actif) order by publie_le desc nulls last limit 1;
  if e.id is null then return jsonb_build_object('publie', false, 'message', 'Aucun emploi du temps publié pour le moment.'); end if;
  per := coalesce(e.config #> '{horaires,periodes}', '[]'::jsonb);
  return jsonb_build_object('publie', true, 'nom', e.nom, 'periode', e.periode, 'jours_semaine', 'lundi = 1 … dimanche = 7',
    'cours', (select coalesce(jsonb_agg(jsonb_build_object('jour', (g->>'j')::int, 'debut', per -> (g->>'p')::int ->> 'debut', 'fin', per -> (g->>'p')::int ->> 'fin',
                'matiere', coalesce(af->>'discipline', 'Permanence'),
                'enseignant', (select en->>'nom' from jsonb_array_elements(coalesce(e.config->'enseignants', '[]')) en where en->>'cle' = af->>'enseignant' limit 1))
                order by (g->>'j')::int, (g->>'p')::int), '[]'::jsonb)
              from jsonb_array_elements(e.grille) g
              left join lateral (select x from jsonb_array_elements(coalesce(e.config->'affectations', '[]')) x where x->>'id' = g->>'a' limit 1) a(af) on true
             where g->>'c' = v_classe::text));
end $$;

/** Session parent éphémère (2 minutes) : les mêmes fonctions et les mêmes règles que l'espace parents. */
create or replace function public._session_parent_ephemere(p_etab uuid, p_eleve uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare jeton text := 'nxp_' || encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into public.sessions_parents (jeton_hash, etablissement_id, eleve_id, expire_le)
  values (encode(extensions.digest(jeton, 'sha256'), 'hex'), p_etab, p_eleve, now() + interval '2 minutes');
  return jeton;
end $$;

create or replace function public._fin_session_ephemere(p_jeton text) returns void
language sql volatile security definer set search_path = '' as $$
  delete from public.sessions_parents where jeton_hash = encode(extensions.digest(p_jeton, 'sha256'), 'hex')
$$;

/** Contrôle et normalisation d'une écriture préparée par l'assistant (avant brouillon). */
create or replace function public._ia_brouillon_contenu(p_outil text, p_eleve uuid, a jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_outil = 'ecrire_ecole' then
    if coalesce(a->>'objet', '') not in ('reclamation', 'audience', 'suggestion', 'moratoire', 'absence') then
      raise exception 'Objet du courrier : reclamation, audience, suggestion, moratoire ou absence.' using errcode = 'P0001';
    end if;
    if char_length(btrim(coalesce(a->>'message', ''))) not between 10 and 4000 then raise exception 'Message de 10 à 4 000 caractères.' using errcode = 'P0001'; end if;
    return jsonb_build_object('objet', a->>'objet', 'parent_nom', left(coalesce(a->>'parent_nom', ''), 120), 'parent_qualite', coalesce(a->>'parent_qualite', ''),
      'precision_objet', left(coalesce(a->>'precision_objet', ''), 150), 'message', btrim(a->>'message'),
      'details', case when jsonb_typeof(a->'details') = 'object' then a->'details' else '{}'::jsonb end);
  end if;
  if not exists (select 1 from public.courriers_ecole c where c.id::text = coalesce(a->>'courrier_id', '') and c.eleve_id = p_eleve and c.statut = 'envoye') then
    raise exception 'Courrier introuvable (voir l''outil courriers).' using errcode = 'P0001';
  end if;
  if p_outil = 'repondre_courrier' then
    if char_length(btrim(coalesce(a->>'message', ''))) not between 2 and 4000 then raise exception 'Message de 2 à 4 000 caractères.' using errcode = 'P0001'; end if;
    return jsonb_build_object('courrier_id', a->>'courrier_id', 'message', btrim(a->>'message'),
      'objet_courrier', (select objet from public.courriers_ecole where id::text = a->>'courrier_id'));
  end if;
  return jsonb_build_object('courrier_id', a->>'courrier_id', 'objet_courrier', (select objet from public.courriers_ecole where id::text = a->>'courrier_id'));
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Point d'entrée des outils MCP « parent »
-- ---------------------------------------------------------------------------------------------------------

/** Outil MCP d'un parent. Lecture : contexte, bulletin, pv, discipline, finances, courriers, distinctions, orientation,
 *  emploi_du_temps. Écriture : ecrire_ecole, repondre_courrier, accuser_reception → brouillon que le parent valide dans son
 *  espace. Une erreur de l'outil est renvoyée sous la forme { erreur } (l'appel reste compté et journalisé). */
create or replace function public.api_parent(p_cle text, p_outil text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare a public.acces_ia_parents; jeton text; r jsonb; arg jsonb := coalesce(p_args, '{}'::jsonb); portail jsonb; v_id uuid;
begin
  a := public._api_parent(p_cle, p_outil);                                   -- refus d'accès : exception (401)
  if pg_column_size(arg) > 20000 then
    update public.journal_api_parents set erreur = 'arguments trop volumineux' where id = (select max(id) from public.journal_api_parents where acces_id = a.id);
    return jsonb_build_object('erreur', 'Arguments trop volumineux.');
  end if;
  begin
    jeton := public._session_parent_ephemere(a.etablissement_id, a.eleve_id);
    case p_outil
      when 'contexte' then
        portail := public.parent_portail(jeton);
        r := jsonb_build_object('etablissement', portail->'etablissement', 'eleve', portail->'eleve',
               'bulletins_publies', portail->'bulletins', 'courriers_envoyes_par_le_parent', portail->'courriers',
               'brouillons_en_attente', (select count(*) from public.brouillons_ia_parents where eleve_id = a.eleve_id and statut = 'en_attente'),
               'outils', 'bulletin (notes d''une période publiée), pv (performances et évolution), discipline (absences, retards), finances, courriers, distinctions, orientation, emploi_du_temps');
      when 'bulletin' then r := public.parent_bulletin(jeton, coalesce(arg->>'periode', ''));
      when 'pv' then r := public.parent_pv(jeton);
      when 'discipline' then
        portail := public.parent_portail(jeton);
        r := jsonb_build_object('absences', portail->'absences', 'retards', portail->'retards', 'incidents', portail->'incidents', 'sequences', portail->'sequences');
      when 'finances' then r := public._parent_finances(a.etablissement_id, a.eleve_id);
      when 'courriers' then
        r := jsonb_build_object('courriers_de_l_ecole', public.parent_courriers_ecole(jeton), 'courriers_envoyes_par_le_parent', public.parent_portail(jeton)->'courriers');
      when 'distinctions' then r := public.parent_distinctions(jeton);
      when 'orientation' then r := public.parent_orientation(jeton);
      when 'emploi_du_temps' then r := public._parent_emploi_du_temps(a.etablissement_id, a.eleve_id);
      when 'ecrire_ecole', 'repondre_courrier', 'accuser_reception' then
        if (select count(*) from public.brouillons_ia_parents where eleve_id = a.eleve_id and statut = 'en_attente') >= 20 then
          raise exception 'Trop de brouillons en attente : le parent doit d''abord les traiter dans son espace.' using errcode = 'P0001';
        end if;
        insert into public.brouillons_ia_parents (etablissement_id, eleve_id, acces_id, action, contenu)
        values (a.etablissement_id, a.eleve_id, a.id, p_outil, public._ia_brouillon_contenu(p_outil, a.eleve_id, arg)) returning id into v_id;
        r := jsonb_build_object('brouillon', v_id, 'statut', 'en_attente',
               'a_faire', 'Rien n''est encore envoyé. Dites au parent d''ouvrir son espace parents NexIA School (onglet « Mon assistant IA ») pour relire et valider ce brouillon.');
      else raise exception 'Outil inconnu : %', p_outil using errcode = 'P0001';
    end case;
    perform public._fin_session_ephemere(jeton);
    return r;
  exception when others then                                                 -- erreur de l'outil : session éphémère annulée, appel compté
    update public.journal_api_parents set erreur = left(sqlerrm, 200) where id = (select max(id) from public.journal_api_parents where acces_id = a.id);
    return jsonb_build_object('erreur', case when sqlstate in ('P0001', '22023', '28000') then sqlerrm else 'Erreur lors de l''exécution de l''outil.' end);
  end;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Gestion par le parent (espace parents)
-- ---------------------------------------------------------------------------------------------------------

/** État de la connexion IA du parent : ouverte ou non (offre), accès en cours, brouillons à valider. */
create or replace function public.parent_ia_etat(p_session text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s record;
begin
  select * into s from public._parent_session(p_session);
  return jsonb_build_object('ouverte', public._ia_parents_ouverte(s.etab),
    'acces', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'type', a.type, 'libelle', coalesce(nullif(a.libelle, ''), c.nom, ''),
                'cree_le', a.cree_le, 'expire_le', case when a.type = 'cle' then a.acces_expire_le end, 'derniere_utilisation', a.derniere_utilisation)
                order by a.cree_le desc), '[]'::jsonb)
                from public.acces_ia_parents a left join public.oauth_clients c on c.id = a.client_id
               where a.eleve_id = s.eleve and a.etablissement_id = s.etab and a.revoque_le is null
                 and ((a.type = 'cle' and a.acces_expire_le > now()) or (a.type = 'oauth' and a.rafraichissement_expire_le > now()))),
    'brouillons', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'action', b.action, 'contenu', b.contenu, 'cree_le', b.cree_le) order by b.cree_le), '[]'::jsonb)
                     from public.brouillons_ia_parents b where b.eleve_id = s.eleve and b.etablissement_id = s.etab and b.statut = 'en_attente'));
end $$;

create or replace function public._ia_parents_actifs(p_eleve uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.acces_ia_parents a where a.eleve_id = p_eleve and a.revoque_le is null
     and ((a.type = 'cle' and a.acces_expire_le > now()) or (a.type = 'oauth' and a.rafraichissement_expire_le > now()))
$$;

/** Nouvelle clé personnelle (affichée une seule fois, valable 180 jours). 5 accès actifs au plus par élève. */
create or replace function public.parent_ia_creer_cle(p_session text, p_libelle text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s record; cle text := 'nxa_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  select * into s from public._parent_session(p_session);
  if not public._ia_parents_ouverte(s.etab) then
    raise exception 'La connexion d''un assistant IA n''est pas ouverte pour cet établissement (offre Premium).' using errcode = 'P0001';
  end if;
  if public._ia_parents_actifs(s.eleve) >= 5 then raise exception 'Cinq accès au plus : révoquez-en un avant d''en créer un autre.' using errcode = 'P0001'; end if;
  insert into public.acces_ia_parents (etablissement_id, eleve_id, type, libelle, acces_hash, acces_expire_le)
  values (s.etab, s.eleve, 'cle', left(btrim(coalesce(p_libelle, '')), 60), encode(extensions.digest(cle, 'sha256'), 'hex'), now() + interval '180 days');
  return jsonb_build_object('cle', cle, 'expire_le', now() + interval '180 days');
end $$;

create or replace function public.parent_ia_revoquer(p_session text, p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare s record;
begin
  select * into s from public._parent_session(p_session);
  update public.acces_ia_parents set revoque_le = now() where id = p_id and eleve_id = s.eleve and etablissement_id = s.etab and revoque_le is null;
  if not found then raise exception 'Accès introuvable ou déjà révoqué.' using errcode = 'P0001'; end if;
end $$;

/** Validation (envoi) ou rejet par le parent d'un brouillon préparé par son assistant. */
create or replace function public.parent_ia_brouillon(p_session text, p_id uuid, p_envoyer boolean, p_parent_nom text default null, p_parent_qualite text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare s record; b public.brouillons_ia_parents; c jsonb; r jsonb := '{}'::jsonb;
begin
  select * into s from public._parent_session(p_session);
  select * into b from public.brouillons_ia_parents where id = p_id and eleve_id = s.eleve and etablissement_id = s.etab and statut = 'en_attente' for update;
  if b.id is null then raise exception 'Brouillon introuvable ou déjà traité.' using errcode = 'P0001'; end if;
  if p_envoyer then
    c := b.contenu;
    if b.action = 'ecrire_ecole' then
      -- le parent peut compléter ou corriger son identité au moment de valider
      c := c || jsonb_strip_nulls(jsonb_build_object('parent_nom', nullif(btrim(coalesce(p_parent_nom, '')), ''), 'parent_qualite', nullif(p_parent_qualite, '')));
      r := public.parent_envoyer_courrier(p_session, c);
    elsif b.action = 'repondre_courrier' then
      perform public.parent_courrier_ecole_repondre(p_session, (c->>'courrier_id')::uuid, c->>'message');
    else
      perform public.parent_courrier_ecole_marquer(p_session, (c->>'courrier_id')::uuid, true);
    end if;
  end if;
  update public.brouillons_ia_parents set statut = case when p_envoyer then 'envoye' else 'rejete' end, traite_le = now() where id = b.id;
  return jsonb_build_object('statut', case when p_envoyer then 'envoye' else 'rejete' end, 'resultat', r);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- OAuth (connecteur Claude.ai) pour les parents
-- ---------------------------------------------------------------------------------------------------------

/** Hôte d'une adresse de retour reconnue pour les parents (ou boucle locale de développement). */
create or replace function public._hote_parent_autorise(p_uri text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_uri ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]+)?/', false)
      or exists (select 1 from public.oauth_hotes_parents h
                  where lower(substring(p_uri from '^https://([^/:?#]+)')) in (h.hote) or lower(substring(p_uri from '^https://([^/:?#]+)')) like '%.' || h.hote)
$$;

/** Application et hôte de retour, pour la page d'autorisation des parents. */
create or replace function public.oauth_info_client_parent(p_client_id text, p_redirect_uri text) returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object('hote', substring(p_redirect_uri from '^https?://([^/:?#]+)'), 'reconnu', public._hote_parent_autorise(p_redirect_uri))
$$;

/** Accord donné par le parent connecté à l'espace de son enfant : code d'autorisation (5 minutes, usage unique). */
create or replace function public.oauth_autoriser_parent(p_session text, p_client_id text, p_redirect_uri text, p_code_challenge text, p_methode text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare s record; code text;
begin
  select * into s from public._parent_session(p_session);
  if not public._ia_parents_ouverte(s.etab) then
    raise exception 'La connexion d''un assistant IA n''est pas ouverte pour cet établissement (offre Premium).' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.oauth_clients where id = p_client_id and p_redirect_uri = any(redirect_uris)) then
    raise exception 'Application inconnue ou adresse de retour non enregistrée.' using errcode = 'P0001';
  end if;
  if not public._hote_parent_autorise(p_redirect_uri) then
    raise exception 'Cette application n''est pas reconnue pour l''espace parents : utilisez une clé personnelle.' using errcode = 'P0001';
  end if;
  if coalesce(p_methode, '') <> 'S256' or coalesce(p_code_challenge, '') !~ '^[A-Za-z0-9_-]{43,128}$' then
    raise exception 'PKCE (S256) obligatoire.' using errcode = 'P0001';
  end if;
  if public._ia_parents_actifs(s.eleve) >= 5 then raise exception 'Cinq accès au plus : révoquez-en un avant d''en créer un autre.' using errcode = 'P0001'; end if;
  code := encode(extensions.gen_random_bytes(32), 'hex');
  delete from public.oauth_codes_parents where expire_le < now();
  insert into public.oauth_codes_parents (code_hash, client_id, etablissement_id, eleve_id, redirect_uri, code_challenge, expire_le)
  values (encode(extensions.digest(code, 'sha256'), 'hex'), p_client_id, s.etab, s.eleve, p_redirect_uri, p_code_challenge, now() + interval '5 minutes');
  return json_build_object('code', code);
end $$;

create or replace function public._oauth_emettre_parent(p_etab uuid, p_eleve uuid, p_client text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare acces text := 'nxa_' || encode(extensions.gen_random_bytes(24), 'hex'); rafr text := 'nxq_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  insert into public.acces_ia_parents (etablissement_id, eleve_id, type, client_id, acces_hash, acces_expire_le, rafraichissement_hash, rafraichissement_expire_le)
  values (p_etab, p_eleve, 'oauth', p_client, encode(extensions.digest(acces, 'sha256'), 'hex'), now() + interval '1 hour',
          encode(extensions.digest(rafr, 'sha256'), 'hex'), now() + interval '30 days');
  return json_build_object('access_token', acces, 'token_type', 'Bearer', 'expires_in', 3600, 'refresh_token', rafr, 'scope', 'parent');
end $$;

-- Échange du code : personnel (0008) ou parent
create or replace function public.oauth_echanger_code(p_code text, p_verifier text, p_client_id text, p_redirect_uri text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare k record; kp record; h text := encode(extensions.digest(coalesce(p_code, ''), 'sha256'), 'hex');
begin
  delete from public.oauth_codes where code_hash = h returning * into k;
  if k.code_hash is not null then
    if k.expire_le < now() or k.client_id <> p_client_id or k.redirect_uri <> p_redirect_uri
       or public._b64url_sha256(coalesce(p_verifier, '')) <> k.code_challenge then
      return json_build_object('error', 'invalid_grant', 'error_description', 'Code invalide, expiré ou déjà utilisé.');
    end if;
    return public._oauth_emettre(k.etablissement_id, k.personnel_id, k.client_id, k.ecriture);
  end if;
  delete from public.oauth_codes_parents where code_hash = h returning * into kp;
  if kp.code_hash is null or kp.expire_le < now() or kp.client_id <> p_client_id or kp.redirect_uri <> p_redirect_uri
     or public._b64url_sha256(coalesce(p_verifier, '')) <> kp.code_challenge then
    return json_build_object('error', 'invalid_grant', 'error_description', 'Code invalide, expiré ou déjà utilisé.');
  end if;
  return public._oauth_emettre_parent(kp.etablissement_id, kp.eleve_id, kp.client_id);
end $$;

-- Rafraîchissement : personnel (0024) ou parent (« nxq_… », rotation ; un jeton déjà utilisé révoque toute la lignée)
create or replace function public.oauth_rafraichir(p_refresh text, p_client_id text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare j record; a public.acces_ia_parents; ancien public.acces_ia_parents; h text := encode(extensions.digest(coalesce(p_refresh, ''), 'sha256'), 'hex');
begin
  if p_refresh like 'nxq_%' then
    update public.acces_ia_parents set revoque_le = now()
     where rafraichissement_hash = h and client_id = p_client_id and revoque_le is null and rafraichissement_expire_le > now()
    returning * into a;
    if a.id is null then
      -- réutilisation d'un jeton déjà échangé : vol probable, tous les accès de cette application pour cet élève sont révoqués
      select * into ancien from public.acces_ia_parents where rafraichissement_hash = h and client_id = p_client_id;
      if ancien.id is not null then
        update public.acces_ia_parents set revoque_le = now() where eleve_id = ancien.eleve_id and client_id = ancien.client_id and revoque_le is null;
      end if;
      return json_build_object('error', 'invalid_grant', 'error_description', 'Jeton de rafraîchissement invalide ou révoqué.');
    end if;
    if not public._ia_parents_ouverte(a.etablissement_id) then
      return json_build_object('error', 'invalid_grant', 'error_description', 'Jeton de rafraîchissement invalide ou révoqué.');
    end if;
    return public._oauth_emettre_parent(a.etablissement_id, a.eleve_id, a.client_id);
  end if;
  update public.jetons_oauth set revoque_le = now()
   where rafraichissement_hash = h and client_id = p_client_id and revoque_le is null and rafraichissement_expire_le > now()
  returning * into j;
  if j.id is null or not public._ia_active(j.personnel_id) then
    return json_build_object('error', 'invalid_grant', 'error_description', 'Jeton de rafraîchissement invalide ou révoqué.');
  end if;
  return public._oauth_emettre(j.etablissement_id, j.personnel_id, j.client_id, j.ecriture);
end $$;

-- Ménage quotidien (appelé par l'exécution quotidienne) : journal des appels des assistants gardé 90 jours, brouillons 30 jours
create or replace function public._ia_parents_menage() returns void
language sql volatile security definer set search_path = '' as $$
  delete from public.journal_api_parents where le < now() - interval '90 days';
  delete from public.brouillons_ia_parents where cree_le < now() - interval '30 days';
  delete from public.acces_ia_parents where revoque_le < now() - interval '90 days' or (type = 'oauth' and rafraichissement_expire_le < now() - interval '90 days');
$$;

-- Exécution quotidienne (0047) complétée du ménage des accès IA des parents
create or replace function public.relances_quotidiennes() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare e record; jour date := public._aujourdhui(); n int := 0; envoyes int := 0; echecs int := 0; distribues int;
begin
  distribues := public._courriers_admin_liberer(null);
  perform public._ia_parents_menage();
  -- pièces jointes déposées puis jamais envoyées (abandonnées depuis plus de 2 jours)
  delete from public.courriers_pieces pc where pc.cree_le < now() - interval '2 days'
     and not exists (select 1 from public.courriers_envois ev where ev.piece_id = pc.id);
  if extract(hour from now() at time zone 'Africa/Douala') < 6 then
    return jsonb_build_object('etablissements', 0, 'envoyes', 0, 'trop_tot', true, 'envois_distribues', distribues);
  end if;
  for e in select c.etablissement_id from public.relances_config c join public.etablissements x on x.id = c.etablissement_id
            where c.actif and x.suspendu_le is null and (c.derniere_execution is null or c.derniere_execution < jour)
              and public._offre_inclut(c.etablissement_id, 'finances')
            for update of c skip locked
  loop
    update public.relances_config set derniere_execution = jour where etablissement_id = e.etablissement_id;
    begin
      perform public._relances_planifier(e.etablissement_id, jour, 'Envoi automatique');
      envoyes := envoyes + coalesce((public._relances_executer(e.etablissement_id, jour, 'Envoi automatique')->>'envoyes')::int, 0);
      n := n + 1;
    exception when others then
      echecs := echecs + 1;
      perform public._courrier_ecole_journal(e.etablissement_id, null, 'echec', jsonb_build_object('erreur', left(sqlerrm, 300), 'etape', 'quotidienne'), 'Envoi automatique');
    end;
  end loop;
  return jsonb_build_object('etablissements', n, 'envoyes', envoyes, 'echecs', echecs, 'envois_distribues', distribues);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------------------------------------------------------
revoke execute on function public._ia_parents_ouverte(uuid), public._api_parent(text, text), public._parent_finances(uuid, uuid),
  public._parent_emploi_du_temps(uuid, uuid), public._oauth_emettre_parent(uuid, uuid, text), public._session_parent_ephemere(uuid, uuid),
  public._fin_session_ephemere(text), public._ia_brouillon_contenu(text, uuid, jsonb), public._ia_parents_actifs(uuid),
  public._hote_parent_autorise(text), public._ia_parents_menage(), public._tranches_situation(uuid, date, uuid) from public, anon, authenticated;
revoke execute on function public.api_parent(text, text, jsonb), public.parent_ia_etat(text), public.parent_ia_creer_cle(text, text),
  public.parent_ia_revoquer(text, uuid), public.parent_ia_brouillon(text, uuid, boolean, text, text),
  public.oauth_autoriser_parent(text, text, text, text, text), public.oauth_info_client_parent(text, text) from public;
grant execute on function public.api_parent(text, text, jsonb), public.parent_ia_etat(text), public.parent_ia_creer_cle(text, text),
  public.parent_ia_revoquer(text, uuid), public.parent_ia_brouillon(text, uuid, boolean, text, text),
  public.oauth_autoriser_parent(text, text, text, text, text), public.oauth_info_client_parent(text, text) to anon, authenticated;
