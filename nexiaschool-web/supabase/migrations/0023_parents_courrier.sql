-- Espace parents, publication des bulletins et courrier des parents.
--  * Connexion d'un parent : nom + code de l'établissement (jeton d'appareil existant), puis nom et prénom de l'élève
--    (dans n'importe quel ordre) et son matricule exact ; session propre au parent (jeton nxp_…, 30 jours), sans compte.
--  * Le parent ne voit que son enfant : dossier disciplinaire daté, bulletins publiés par l'administration, ses courriers.
--  * Bulletins : l'administration publie, classe par classe et période par période, une copie figée de chaque bulletin ;
--    le parent ne reçoit que celle de son enfant (jamais les notes des autres élèves).
--  * Courrier : réclamation, audience, suggestion (administration), moratoire des frais d'écolage (administration et
--    service financier), demande d'absence (surveillants généraux, à défaut l'administration). Chaque courrier est
--    numéroté, archivé ; les destinataires sont prévenus (bulle), répondent ; le parent est prévenu de la réponse.
--  * Moratoire accordé : signalé dans les listes des élèves non en règle (Finances) jusqu'à la date convenue.

-- ---------------------------------------------------------------------------------------------------------
-- Sessions des parents
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.sessions_parents (
  id uuid primary key default gen_random_uuid(),
  jeton_hash text not null unique,
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  eleve_id uuid not null references public.eleves (id) on delete cascade,
  cree_le timestamptz not null default now(),
  expire_le timestamptz not null,
  derniere_utilisation timestamptz
);
create index if not exists sessions_parents_eleve on public.sessions_parents (eleve_id);
alter table public.sessions_parents enable row level security;
revoke all on public.sessions_parents from anon, authenticated;

/** Connexion d'un parent. Renvoie { jeton, eleve, classe, etablissement } ou { erreur }. */
create or replace function public.parent_connexion(p_jeton text, p_eleve text, p_matricule text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare
  v_etab uuid := public._etab_du_jeton(p_jeton);
  v_cle text; v_t record; v_el record; v_n int; v_session text; attente int;
  v_nom text := public._normaliser(p_eleve);
begin
  if v_etab is null then return json_build_object('erreur', 'jeton'); end if;
  if btrim(coalesce(p_matricule, '')) = '' or v_nom = '' then return json_build_object('erreur', 'Indiquez le nom et le prénom de l''élève, puis son matricule.'); end if;
  v_cle := 'parent:' || v_etab || ':' || upper(btrim(p_matricule));
  select * into v_t from public.tentatives where cle = v_cle;
  if v_t.bloque_jusqu_a > now() then
    attente := ceil(extract(epoch from (v_t.bloque_jusqu_a - now())) / 60);
    return json_build_object('erreur', format('Trop d''essais erronés : réessayez dans %s min.', attente));
  end if;
  select e.id, e.nom, e.prenom, c.libelle as classe, count(*) over () as n into v_el
    from public.eleves e
    join public.inscriptions i on i.eleve_id = e.id
    join public.exercices x on x.id = i.exercice_id and x.actif
    join public.classes c on c.id = i.classe_id
   where e.etablissement_id = v_etab and upper(btrim(e.matricule)) = upper(btrim(p_matricule))
     and (public._normaliser(e.nom || e.prenom) = v_nom or public._normaliser(e.prenom || e.nom) = v_nom)
   limit 1;
  if v_el.id is null then
    insert into public.tentatives as t (cle, echecs, maj) values (v_cle, 1, now())
    on conflict (cle) do update set echecs = case when t.maj < now() - interval '1 hour' then 1 else t.echecs + 1 end, maj = now()
    returning echecs into v_n;
    if v_n >= 5 then
      update public.tentatives set echecs = 0, bloque_jusqu_a = now() + interval '15 minutes' where cle = v_cle;
      return json_build_object('erreur', 'Élève introuvable. Après 5 essais erronés, l''accès est bloqué pendant 15 min.');
    end if;
    return json_build_object('erreur', 'Élève introuvable : vérifiez le nom, le prénom et le matricule (il doit être exact).');
  end if;
  delete from public.tentatives where cle = v_cle;
  v_session := 'nxp_' || encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.sessions_parents (jeton_hash, etablissement_id, eleve_id, expire_le)
  values (encode(extensions.digest(v_session, 'sha256'), 'hex'), v_etab, v_el.id, now() + interval '30 days');
  delete from public.sessions_parents where expire_le < now();
  return json_build_object('jeton', v_session, 'eleve', btrim(upper(v_el.nom) || ' ' || v_el.prenom), 'classe', v_el.classe,
                           'etablissement', (select nom from public.etablissements where id = v_etab));
end $$;

-- Session valide : établissement, élève et son inscription de l'exercice actif
create or replace function public._parent_session(p_session text)
returns table (etab uuid, eleve uuid, inscription uuid, exercice uuid, classe uuid)
language plpgsql volatile security definer set search_path = '' as $$
declare s record;
begin
  select sp.id, sp.etablissement_id, sp.eleve_id into s from public.sessions_parents sp
    join public.etablissements e on e.id = sp.etablissement_id and e.suspendu_le is null
   where sp.jeton_hash = encode(extensions.digest(coalesce(p_session, ''), 'sha256'), 'hex') and sp.expire_le > now();
  if s.id is null then raise exception 'Session expirée : reconnectez-vous.' using errcode = '28000'; end if;
  update public.sessions_parents set derniere_utilisation = now()
   where id = s.id and (derniere_utilisation is null or derniere_utilisation < now() - interval '5 minutes');
  return query select s.etablissement_id, s.eleve_id, i.id, i.exercice_id, i.classe_id
    from public.inscriptions i join public.exercices x on x.id = i.exercice_id and x.actif where i.eleve_id = s.eleve_id;
  if not found then raise exception 'L''élève n''est pas inscrit pour l''année en cours.' using errcode = '28000'; end if;
end $$;

create or replace function public.parent_deconnexion(p_session text) returns void
language sql volatile security definer set search_path = '' as $$
  delete from public.sessions_parents where jeton_hash = encode(extensions.digest(coalesce(p_session, ''), 'sha256'), 'hex')
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Publication des bulletins (copies figées, par classe et par période)
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.publications_bulletins (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  exercice_id uuid not null references public.exercices (id) on delete cascade,
  classe_id uuid not null references public.classes (id) on delete cascade,
  periode text not null check (periode ~ '^(s[1-6]|t[1-3]|a)$'),
  periode_libelle text not null,
  commun jsonb not null default '{}'::jsonb,
  eleves smallint not null default 0,
  publie_le timestamptz not null default now(),
  publie_par uuid references public.personnels (id) on delete set null,
  unique (exercice_id, classe_id, periode)
);
create table if not exists public.bulletins_publies (
  publication_id uuid not null references public.publications_bulletins (id) on delete cascade,
  inscription_id uuid not null references public.inscriptions (id) on delete cascade,
  contenu jsonb not null,
  primary key (publication_id, inscription_id)
);
alter table public.publications_bulletins enable row level security;
alter table public.bulletins_publies enable row level security;
create policy "lecture par le personnel" on public.publications_bulletins for select to authenticated using (etablissement_id = (select public.etab_courant()));
revoke all on public.publications_bulletins, public.bulletins_publies from anon, authenticated;
grant select (id, etablissement_id, exercice_id, classe_id, periode, periode_libelle, eleves, publie_le, publie_par) on public.publications_bulletins to authenticated;

/**
 * Publication (ou mise à jour) des bulletins d'une classe pour une période : administration uniquement.
 * p = { classe_id, periode, periode_libelle, commun: { en-tête, statistiques… }, bulletins: [{ inscription_id, contenu }] }
 */
create or replace function public.publier_bulletins(p jsonb) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin(); v_ex uuid; v_cl uuid := nullif(p ->> 'classe_id', '')::uuid; v_pub uuid; n int;
begin
  select id into v_ex from public.exercices where etablissement_id = v_etab and actif;
  if v_ex is null then raise exception 'Aucun exercice actif.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.classes where id = v_cl and etablissement_id = v_etab) then raise exception 'Classe introuvable.' using errcode = 'P0001'; end if;
  if coalesce(p ->> 'periode', '') !~ '^(s[1-6]|t[1-3]|a)$' then raise exception 'Période invalide.' using errcode = '22023'; end if;
  if jsonb_typeof(p -> 'bulletins') <> 'array' or jsonb_array_length(p -> 'bulletins') = 0 then raise exception 'Aucun bulletin à publier.' using errcode = 'P0001'; end if;
  insert into public.publications_bulletins (etablissement_id, exercice_id, classe_id, periode, periode_libelle, commun, publie_par)
  values (v_etab, v_ex, v_cl, p ->> 'periode', left(coalesce(p ->> 'periode_libelle', p ->> 'periode'), 60), coalesce(p -> 'commun', '{}'::jsonb), auth.uid())
  on conflict (exercice_id, classe_id, periode) do update set commun = excluded.commun, periode_libelle = excluded.periode_libelle,
         publie_le = now(), publie_par = auth.uid()
  returning id into v_pub;
  delete from public.bulletins_publies where publication_id = v_pub;
  insert into public.bulletins_publies (publication_id, inscription_id, contenu)
  select v_pub, i.id, b -> 'contenu' from jsonb_array_elements(p -> 'bulletins') b
    join public.inscriptions i on i.id = (b ->> 'inscription_id')::uuid and i.classe_id = v_cl and i.exercice_id = v_ex;
  get diagnostics n = row_count;
  update public.publications_bulletins set eleves = n where id = v_pub;
  return json_build_object('publication', v_pub, 'eleves', n);
end $$;

create or replace function public.retirer_publication(p_classe uuid, p_periode text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin();
begin
  delete from public.publications_bulletins pb using public.exercices x
   where x.id = pb.exercice_id and x.actif and pb.etablissement_id = v_etab and pb.classe_id = p_classe and pb.periode = p_periode;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Courrier des parents
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.courriers (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  numero integer not null,
  reference text not null,
  inscription_id uuid references public.inscriptions (id) on delete set null,
  eleve_id uuid references public.eleves (id) on delete set null,
  eleve text not null,
  classe text not null default '',
  matricule text not null default '',
  parent_nom text not null check (char_length(btrim(parent_nom)) between 2 and 120),
  parent_qualite text not null check (parent_qualite in ('pere', 'mere', 'tuteur', 'tutrice')),
  parent_telephone text not null default '' check (char_length(parent_telephone) <= 30),
  ville text not null default '' check (char_length(ville) <= 80),
  objet text not null check (objet in ('reclamation', 'audience', 'suggestion', 'moratoire', 'absence')),
  precision_objet text not null default '' check (char_length(precision_objet) <= 150),
  details jsonb not null default '{}'::jsonb,
  message text not null check (char_length(btrim(message)) between 10 and 8000),
  envoye_le timestamptz not null default now(),
  unique (etablissement_id, numero)
);
create index if not exists courriers_etab on public.courriers (etablissement_id, envoye_le desc);
create index if not exists courriers_eleve on public.courriers (eleve_id);

create table if not exists public.courrier_reponses (
  id uuid primary key default gen_random_uuid(),
  courrier_id uuid not null references public.courriers (id) on delete cascade,
  auteur_id uuid references public.personnels (id) on delete set null,
  auteur text not null,
  fonction text not null default '',
  message text not null check (char_length(btrim(message)) between 2 and 8000),
  moratoire_accorde boolean,
  moratoire_jusqu_au date,
  envoye_le timestamptz not null default now(),
  lu_parent_le timestamptz,
  check (moratoire_accorde is not true or moratoire_jusqu_au is not null)
);
create index if not exists courrier_reponses_courrier on public.courrier_reponses (courrier_id, envoye_le);

create table if not exists public.courriers_lus (
  personnel_id uuid not null references public.personnels (id) on delete cascade,
  courrier_id uuid not null references public.courriers (id) on delete cascade,
  lu_le timestamptz not null default now(),
  primary key (personnel_id, courrier_id)
);
alter table public.courriers enable row level security;
alter table public.courrier_reponses enable row level security;
alter table public.courriers_lus enable row level security;
revoke all on public.courriers, public.courrier_reponses, public.courriers_lus from anon, authenticated;

-- Qui consulte (archives) : administration = tout ; surveillant général = demandes d'absence ; comptable = moratoires
create or replace function public._courrier_visible(p_objet text, p_role text) returns boolean
language sql immutable set search_path = '' as $$
  select p_role = 'admin' or (p_role = 'surveillant' and p_objet = 'absence') or (p_role = 'comptable' and p_objet = 'moratoire')
$$;

-- Qui est prévenu (bulle) : réclamation, audience, suggestion → administration ; moratoire → administration et
-- service financier ; absence → surveillants généraux (l'administration s'il n'y en a aucun)
create or replace function public._courrier_destinataire(p_objet text, p_role text, p_etab uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_objet
    when 'moratoire' then p_role in ('admin', 'comptable')
    when 'absence' then p_role = 'surveillant' or (p_role = 'admin' and not exists (
      select 1 from public.personnels where etablissement_id = p_etab and role = 'surveillant' and actif))
    else p_role = 'admin' end
$$;

create or replace function public._mon_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.personnels p join public.etablissements e on e.id = p.etablissement_id
   where p.id = auth.uid() and p.actif and e.suspendu_le is null
$$;

create or replace function public._courrier_json(c public.courriers, p_personnel uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'reference', c.reference, 'eleve', c.eleve, 'classe', c.classe, 'matricule', c.matricule,
    'parent_nom', c.parent_nom, 'parent_qualite', c.parent_qualite, 'parent_telephone', c.parent_telephone, 'ville', c.ville,
    'objet', c.objet, 'precision_objet', c.precision_objet, 'details', c.details, 'message', c.message, 'envoye_le', c.envoye_le,
    'lu', p_personnel is null or exists (select 1 from public.courriers_lus l where l.courrier_id = c.id and l.personnel_id = p_personnel),
    'reponses', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'auteur', r.auteur, 'fonction', r.fonction, 'message', r.message,
        'moratoire_accorde', r.moratoire_accorde, 'moratoire_jusqu_au', r.moratoire_jusqu_au, 'envoye_le', r.envoye_le, 'lu_parent_le', r.lu_parent_le)
        order by r.envoye_le) from public.courrier_reponses r where r.courrier_id = c.id), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Espace parent (lien public avec session parent)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.parent_portail(p_session text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s record;
begin
  select * into s from public._parent_session(p_session);
  return jsonb_build_object(
    'etablissement', (select jsonb_build_object('nom', e.nom, 'ville', e.ville, 'adresse', e.adresse, 'telephone', e.telephone,
                        'devise', e.devise, 'nom_chef', e.nom_chef, 'site_web', e.site_web) from public.etablissements e where e.id = s.etab),
    'eleve', (select jsonb_build_object('nom', el.nom, 'prenom', el.prenom, 'matricule', el.matricule, 'sexe', el.sexe,
                'date_naissance', el.date_naissance, 'classe', c.libelle, 'annee', x.libelle)
                from public.eleves el, public.classes c, public.exercices x where el.id = s.eleve and c.id = s.classe and x.id = s.exercice),
    'sequences', (select coalesce(jsonb_agg(jsonb_build_object('id', sq.id, 'numero', sq.numero, 'trimestre', sq.trimestre) order by sq.numero), '[]'::jsonb)
                    from public.sequences sq where sq.exercice_id = s.exercice),
    'absences', (select coalesce(jsonb_agg(jsonb_build_object('date', a.date, 'sequence_id', a.sequence_id, 'non_justifiees', a.heures_non_justifiees,
                    'justifiees', a.heures_justifiees, 'motif', a.motif) order by a.date desc), '[]'::jsonb) from public.absences a where a.inscription_id = s.inscription),
    'retards', (select coalesce(jsonb_agg(jsonb_build_object('date', r.date, 'sequence_id', r.sequence_id) order by r.date desc), '[]'::jsonb)
                  from public.retards r where r.inscription_id = s.inscription),
    'incidents', (select coalesce(jsonb_agg(jsonb_build_object('date', i.date, 'sequence_id', i.sequence_id, 'infraction', f.libelle,
                    'sanction', sa.libelle, 'points', sa.points_perdus, 'observation', i.observation) order by i.date desc), '[]'::jsonb)
                    from public.incidents i join public.infractions f on f.id = i.infraction_id join public.sanctions sa on sa.id = f.sanction_id
                   where i.inscription_id = s.inscription),
    'bareme', (select jsonb_build_object('note_max', b.note_max, 'points_par_retard', b.points_par_retard, 'points_par_heure', b.points_par_heure)
                 from public.parametres_discipline b where b.exercice_id = s.exercice),
    'bulletins', (select coalesce(jsonb_agg(jsonb_build_object('periode', pb.periode, 'libelle', pb.periode_libelle, 'publie_le', pb.publie_le)
                    order by pb.publie_le), '[]'::jsonb)
                    from public.publications_bulletins pb join public.bulletins_publies bp on bp.publication_id = pb.id and bp.inscription_id = s.inscription),
    'courriers', (select coalesce(jsonb_agg(public._courrier_json(c, null) order by c.envoye_le desc), '[]'::jsonb)
                    from public.courriers c where c.eleve_id = s.eleve and c.etablissement_id = s.etab),
    'reponses_non_lues', (select count(*) from public.courrier_reponses r join public.courriers c on c.id = r.courrier_id
                           where c.eleve_id = s.eleve and r.lu_parent_le is null));
end $$;

create or replace function public.parent_bulletin(p_session text, p_periode text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s record; r jsonb;
begin
  select * into s from public._parent_session(p_session);
  select jsonb_build_object('commun', pb.commun, 'contenu', bp.contenu, 'periode', pb.periode, 'libelle', pb.periode_libelle, 'publie_le', pb.publie_le) into r
    from public.publications_bulletins pb join public.bulletins_publies bp on bp.publication_id = pb.id and bp.inscription_id = s.inscription
   where pb.periode = p_periode;
  if r is null then raise exception 'Ce bulletin n''est pas encore publié par l''établissement.' using errcode = 'P0001'; end if;
  return r;
end $$;

/** p = { parent_nom, parent_qualite, parent_telephone, ville, objet, precision_objet, details: { du, au, jusqu_au, montant }, message } */
create or replace function public.parent_envoyer_courrier(p_session text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s record; v_num int; v_ref text; c public.courriers; v_el record; v_details jsonb := '{}'::jsonb; d1 date; d2 date;
begin
  select * into s from public._parent_session(p_session);
  if coalesce(p ->> 'objet', '') not in ('reclamation', 'audience', 'suggestion', 'moratoire', 'absence') then
    raise exception 'Choisissez l''objet de votre courrier.' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p ->> 'parent_nom', ''))) < 2 then raise exception 'Indiquez votre nom et votre prénom.' using errcode = 'P0001'; end if;
  if coalesce(p ->> 'parent_qualite', '') not in ('pere', 'mere', 'tuteur', 'tutrice') then raise exception 'Précisez votre lien avec l''élève.' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p ->> 'message', ''))) < 10 then raise exception 'Votre message est trop court (10 caractères au moins).' using errcode = 'P0001'; end if;
  if (select count(*) from public.courriers where eleve_id = s.eleve and envoye_le > now() - interval '1 day') >= 10 then
    raise exception 'Vous avez déjà envoyé 10 courriers aujourd''hui : réessayez demain.' using errcode = 'P0001';
  end if;
  begin
    if p ->> 'objet' = 'absence' then
      d1 := nullif(p #>> '{details,du}', '')::date; d2 := coalesce(nullif(p #>> '{details,au}', '')::date, d1);
      if d1 is null then raise exception 'Indiquez la date (ou les dates) de l''absence.' using errcode = 'P0001'; end if;
      if d2 < d1 then raise exception 'La date de fin de l''absence précède la date de début.' using errcode = 'P0001'; end if;
      v_details := jsonb_build_object('du', d1, 'au', d2);
    elsif p ->> 'objet' = 'moratoire' then
      d1 := nullif(p #>> '{details,jusqu_au}', '')::date;
      if d1 is null then raise exception 'Indiquez la date jusqu''à laquelle vous sollicitez le moratoire.' using errcode = 'P0001'; end if;
      v_details := jsonb_build_object('jusqu_au', d1) || case when nullif(p #>> '{details,montant}', '') is not null
                   then jsonb_build_object('montant', round((p #>> '{details,montant}')::numeric)) else '{}'::jsonb end;
    end if;
  exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
    raise exception 'Date ou montant invalide.' using errcode = 'P0001';
  end;
  select e2.nom, e2.prenom, e2.matricule, c2.libelle as classe into v_el from public.eleves e2, public.classes c2 where e2.id = s.eleve and c2.id = s.classe;
  perform pg_advisory_xact_lock(hashtext('courrier:' || s.etab));
  select coalesce(max(numero), 0) + 1 into v_num from public.courriers where etablissement_id = s.etab;
  v_ref := 'C' || to_char(now() at time zone 'Africa/Douala', 'YYYY') || '-' || lpad(v_num::text, 4, '0');
  insert into public.courriers (etablissement_id, numero, reference, inscription_id, eleve_id, eleve, classe, matricule, parent_nom, parent_qualite,
                                parent_telephone, ville, objet, precision_objet, details, message)
  values (s.etab, v_num, v_ref, s.inscription, s.eleve, btrim(upper(v_el.nom) || ' ' || v_el.prenom), v_el.classe, v_el.matricule,
          left(btrim(p ->> 'parent_nom'), 120), p ->> 'parent_qualite', left(btrim(coalesce(p ->> 'parent_telephone', '')), 30),
          left(btrim(coalesce(p ->> 'ville', '')), 80), p ->> 'objet', left(btrim(coalesce(p ->> 'precision_objet', '')), 150), v_details,
          left(btrim(p ->> 'message'), 8000))
  returning * into c;
  return jsonb_build_object('reference', c.reference, 'envoye_le', c.envoye_le, 'objet', c.objet);
end $$;

create or replace function public.parent_marquer_reponses_lues(p_session text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare s record;
begin
  select * into s from public._parent_session(p_session);
  update public.courrier_reponses r set lu_parent_le = now() from public.courriers c
   where c.id = r.courrier_id and c.eleve_id = s.eleve and r.lu_parent_le is null;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Courrier côté établissement
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.courrier_liste() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); v_role text := public._mon_role();
begin
  if v_etab is null or v_role is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(public._courrier_json(c, auth.uid()) || jsonb_build_object('destinataire', public._courrier_destinataire(c.objet, v_role, v_etab))
            order by c.envoye_le desc)
     from public.courriers c where c.etablissement_id = v_etab and public._courrier_visible(c.objet, v_role)), '[]'::jsonb);
end $$;

create or replace function public.courrier_marquer_lu(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); v_role text := public._mon_role();
begin
  insert into public.courriers_lus (personnel_id, courrier_id)
  select auth.uid(), c.id from public.courriers c
   where c.etablissement_id = v_etab and (p_id is null or c.id = p_id)
     and (public._courrier_destinataire(c.objet, v_role, v_etab) or (p_id is not null and public._courrier_visible(c.objet, v_role)))
  on conflict do nothing;
end $$;

-- Bulle : courriers qui me sont adressés et que je n'ai pas encore lus
create or replace function public.courrier_notifications() returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object('non_lus', count(*))
    from public.courriers c
   where c.etablissement_id = public.etab_courant() and public._courrier_destinataire(c.objet, public._mon_role(), c.etablissement_id)
     and not exists (select 1 from public.courriers_lus l where l.courrier_id = c.id and l.personnel_id = auth.uid())
$$;

/** Réponse à un courrier ; moratoire : accorde (true/false) et date limite convenue (administration ou service financier). */
create or replace function public.courrier_repondre(p_id uuid, p_message text, p_moratoire_accorde boolean, p_jusqu_au date) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); v_role text := public._mon_role(); c public.courriers; v_auteur text; r public.courrier_reponses;
begin
  select * into c from public.courriers where id = p_id and etablissement_id = v_etab;
  if c.id is null or not public._courrier_visible(c.objet, v_role) then raise exception 'Courrier introuvable.' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p_message, ''))) < 2 then raise exception 'Écrivez votre réponse.' using errcode = 'P0001'; end if;
  if c.objet <> 'moratoire' and p_moratoire_accorde is not null then raise exception 'Décision de moratoire réservée aux demandes de moratoire.' using errcode = 'P0001'; end if;
  if p_moratoire_accorde and p_jusqu_au is null then raise exception 'Indiquez la date jusqu''à laquelle le moratoire est accordé.' using errcode = 'P0001'; end if;
  select btrim(p.nom || ' ' || p.prenom) into v_auteur from public.personnels p where p.id = auth.uid();
  insert into public.courrier_reponses (courrier_id, auteur_id, auteur, fonction, message, moratoire_accorde, moratoire_jusqu_au)
  values (c.id, auth.uid(), v_auteur, case v_role when 'admin' then 'Administration' when 'surveillant' then 'Surveillant général'
                                              when 'comptable' then 'Service financier' else '' end,
          left(btrim(p_message), 8000), p_moratoire_accorde, case when p_moratoire_accorde then p_jusqu_au end)
  returning * into r;
  insert into public.courriers_lus (personnel_id, courrier_id) values (auth.uid(), c.id) on conflict do nothing;
  return jsonb_build_object('id', r.id, 'envoye_le', r.envoye_le);
end $$;

-- Moratoires accordés encore en cours (dernière décision de l'établissement pour chaque élève), pour les Finances
create or replace function public.moratoires_actifs() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('inscription_id', x.inscription_id, 'jusqu_au', x.moratoire_jusqu_au, 'reference', x.reference)), '[]'::jsonb)
    from (select distinct on (c.inscription_id) c.inscription_id, c.reference, r.moratoire_accorde, r.moratoire_jusqu_au
            from public.courriers c join public.courrier_reponses r on r.courrier_id = c.id
           where c.etablissement_id = public.etab_courant() and c.objet = 'moratoire' and r.moratoire_accorde is not null
             and public._mon_role() in ('admin', 'comptable')
           order by c.inscription_id, r.envoye_le desc) x
   where x.moratoire_accorde and x.moratoire_jusqu_au >= (now() at time zone 'Africa/Douala')::date
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------------------------------------
revoke execute on function public.parent_connexion(text, text, text), public._parent_session(text), public.parent_deconnexion(text),
  public.publier_bulletins(jsonb), public.retirer_publication(uuid, text), public._courrier_visible(text, text),
  public._courrier_destinataire(text, text, uuid), public._mon_role(), public._courrier_json(public.courriers, uuid),
  public.parent_portail(text), public.parent_bulletin(text, text), public.parent_envoyer_courrier(text, jsonb), public.parent_marquer_reponses_lues(text),
  public.courrier_liste(), public.courrier_marquer_lu(uuid), public.courrier_notifications(), public.courrier_repondre(uuid, text, boolean, date),
  public.moratoires_actifs() from public, anon, authenticated;
grant execute on function public.parent_connexion(text, text, text), public.parent_deconnexion(text), public.parent_portail(text),
  public.parent_bulletin(text, text), public.parent_envoyer_courrier(text, jsonb), public.parent_marquer_reponses_lues(text) to anon, authenticated;
grant execute on function public.publier_bulletins(jsonb), public.retirer_publication(uuid, text), public.courrier_liste(), public.courrier_marquer_lu(uuid),
  public.courrier_notifications(), public.courrier_repondre(uuid, text, boolean, date), public.moratoires_actifs() to authenticated;
