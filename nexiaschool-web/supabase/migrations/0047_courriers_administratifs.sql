-- Courriers administratifs aux parents (rubrique Courrier, administration). S'appuie sur le courrier de l'école posé avec
-- les relances (0046 : courriers_ecole, lecture, accusé, réponse, journal) et ajoute :
--  * les envois (un courrier pour un élève ou un lot) : sujet (réunion, fermeture, évènement, mesure disciplinaire,
--    convocation, information pédagogique, rappel, décision, communication générale), modèle avec variables, pièce jointe PDF,
--    planification, confirmation de lecture activable courrier par courrier ;
--  * le ciblage : élèves choisis, ou groupe (classes, niveaux, cycles, sections, statut de paiement, sexe, nouveaux / anciens,
--    redoublants) ; protection contre l'envoi au mauvais groupe : l'aperçu donne le nombre et une empreinte des destinataires,
--    l'envoi exige ce nombre (saisi par l'administration) et cette empreinte (refus si le groupe a changé) ;
--  * les modèles de courriers ; le renvoi d'un courrier en échec ; la recherche dans l'historique (écran).
-- Les comptables ne voient plus que les relances et courriers finaux ; les courriers administratifs restent à l'administration.

-- ---------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------
alter table public.courriers_ecole drop constraint if exists courriers_ecole_categorie_check;
alter table public.courriers_ecole add constraint courriers_ecole_categorie_check check (categorie in ('relance', 'final', 'administratif'));
alter table public.courriers_ecole_journal drop constraint if exists courriers_ecole_journal_action_check;
alter table public.courriers_ecole_journal add constraint courriers_ecole_journal_action_check check (action in ('configuration', 'exclusion', 'creation',
  'modification', 'programmation', 'envoi', 'echec', 'annulation', 'lecture', 'accuse', 'reponse', 'validation', 'refus', 'renvoi', 'modele', 'piece'));

create table if not exists public.courriers_modeles (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  nom text not null check (char_length(btrim(nom)) between 2 and 80),
  sujet text not null default 'general',
  objet text not null check (char_length(btrim(objet)) between 3 and 200),
  corps text not null check (char_length(btrim(corps)) between 10 and 8000),
  maj timestamptz not null default now(),
  maj_par uuid references public.personnels (id) on delete set null,
  unique (etablissement_id, nom)
);

create table if not exists public.courriers_pieces (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  nom text not null check (char_length(btrim(nom)) between 1 and 150),
  taille integer not null check (taille between 1 and 2097152),               -- 2 Mo au plus
  donnees bytea not null,
  cree_le timestamptz not null default now(),
  cree_par uuid references public.personnels (id) on delete set null
);

create table if not exists public.courriers_envois (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  sujet text not null check (sujet in ('reunion', 'fermeture', 'evenement', 'discipline', 'convocation', 'pedagogie', 'rappel', 'decision', 'general')),
  objet text not null check (char_length(btrim(objet)) between 3 and 200),
  corps text not null check (char_length(btrim(corps)) between 10 and 8000),       -- modèle (variables non remplies)
  ciblage jsonb not null check (jsonb_typeof(ciblage) = 'object'),
  description_cible text not null default '' check (char_length(description_cible) <= 400),
  piece_id uuid references public.courriers_pieces (id) on delete set null,
  confirmation_lecture boolean not null default false,
  statut text not null check (statut in ('programme', 'envoye', 'annule')),
  programme_le timestamptz not null default now(),
  destinataires integer not null default 0,
  motif text not null default '' check (char_length(motif) <= 300),
  cree_par uuid references public.personnels (id) on delete set null,
  cree_par_nom text not null default '',
  cree_le timestamptz not null default now(),
  envoye_le timestamptz
);
create index if not exists courriers_envois_etab on public.courriers_envois (etablissement_id, cree_le desc);
create index if not exists courriers_envois_programmes on public.courriers_envois (statut, programme_le) where statut = 'programme';

alter table public.courriers_ecole add column if not exists envoi_id uuid references public.courriers_envois (id) on delete set null;
create index if not exists courriers_ecole_envoi on public.courriers_ecole (envoi_id);

alter table public.courriers_modeles enable row level security;
alter table public.courriers_pieces enable row level security;
alter table public.courriers_envois enable row level security;
create policy "administration" on public.courriers_modeles for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));
create policy "administration" on public.courriers_pieces for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));
create policy "administration" on public.courriers_envois for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));
revoke all on public.courriers_modeles, public.courriers_pieces, public.courriers_envois from anon, authenticated;
grant select on public.courriers_modeles, public.courriers_envois to authenticated;
grant select (id, etablissement_id, nom, taille, cree_le, cree_par) on public.courriers_pieces to authenticated;   -- le contenu passe par une fonction

-- Visibilité : la comptabilité voit les relances et courriers finaux ; l'administration voit tout
drop policy if exists "comptabilité" on public.courriers_ecole;
create policy "comptabilité ou administration" on public.courriers_ecole for select to authenticated
  using (etablissement_id = (select public.etab_courant())
         and ((select public.est_admin()) or ((select public.peut_finance()) and categorie in ('relance', 'final'))));
drop policy if exists "comptabilité" on public.courriers_ecole_reponses;
create policy "comptabilité ou administration" on public.courriers_ecole_reponses for select to authenticated
  using (exists (select 1 from public.courriers_ecole c where c.id = courrier_id and c.etablissement_id = (select public.etab_courant())
                   and ((select public.est_admin()) or ((select public.peut_finance()) and c.categorie in ('relance', 'final')))));
drop policy if exists "comptabilité" on public.courriers_ecole_journal;
create policy "comptabilité ou administration" on public.courriers_ecole_journal for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and ((select public.est_admin()) or ((select public.peut_finance())
         and ((courrier_id is null and action not in ('modele', 'piece') and not (details ? 'envoi'))      -- évènements généraux des relances
              or exists (select 1 from public.courriers_ecole c where c.id = courrier_id and c.categorie in ('relance', 'final'))))));

-- ---------------------------------------------------------------------------------------------------------
-- Outils
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._courriers_admin_droit() returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin();
begin
  perform public._exiger_offre(v_etab, 'parents');
  return v_etab;
end $$;

/** Destinataires d'un ciblage (exercice actif) : mode « eleves » (inscriptions choisies) ou « groupe » (filtres combinés). */
create or replace function public._courriers_cibles(p_etab uuid, c jsonb)
returns table (inscription_id uuid, eleve_id uuid, nom text, prenom text, matricule text, classe_id uuid, classe text)
language sql stable security definer set search_path = '' as $$
  with ex as (select id from public.exercices where etablissement_id = p_etab and actif),
  jour as (select public._aujourdhui() d),
  sit as (select t.inscription_id, sum(t.reste) filter (where t.date_limite < (select d from jour)) echu, sum(t.reste) reste
            from public._tranches_situation(p_etab, (select d from jour)) t group by t.inscription_id),
  liste as (select i.id, i.eleve_id, e.nom, e.prenom, e.matricule, e.sexe, i.nouveau, i.redoublant, cl.id classe_id, cl.libelle classe, cl.niveau,
                   cl.section_id, coalesce(n.cycle_id::text, case when cl.cycle is not null then 'ancien:' || cl.cycle end, '') cycle
              from public.inscriptions i join ex on ex.id = i.exercice_id
              join public.eleves e on e.id = i.eleve_id join public.classes cl on cl.id = i.classe_id
              left join public.niveaux n on n.id = cl.niveau_id)
  select l.id, l.eleve_id, l.nom, l.prenom, l.matricule, l.classe_id, l.classe from liste l left join sit s on s.inscription_id = l.id
   where case when c->>'mode' = 'eleves'
              then l.id::text in (select jsonb_array_elements_text(coalesce(c->'inscriptions', '[]'::jsonb)))
              else (jsonb_array_length(coalesce(c->'classes', '[]')) = 0 or l.classe_id::text in (select jsonb_array_elements_text(c->'classes')))
               and (jsonb_array_length(coalesce(c->'niveaux', '[]')) = 0 or l.niveau in (select jsonb_array_elements_text(c->'niveaux')))
               and (jsonb_array_length(coalesce(c->'cycles', '[]')) = 0 or l.cycle in (select jsonb_array_elements_text(c->'cycles')))
               and (jsonb_array_length(coalesce(c->'sections', '[]')) = 0 or l.section_id::text in (select jsonb_array_elements_text(c->'sections')))
               and (coalesce(c->>'sexe', '') = '' or l.sexe = c->>'sexe')
               and (coalesce(c->>'anciennete', '') = '' or l.nouveau = (c->>'anciennete' = 'nouveau'))
               and (coalesce(c->>'redoublant', '') = '' or l.redoublant = (c->>'redoublant')::boolean)
               and (coalesce(c->>'paiement', '') = ''
                    or (c->>'paiement' = 'non_en_regle' and coalesce(s.echu, 0) > 0)
                    or (c->>'paiement' = 'en_regle' and coalesce(s.echu, 0) = 0)
                    or (c->>'paiement' = 'solde' and s.inscription_id is not null and coalesce(s.reste, 0) = 0))
          end
$$;

/** Variables d'un courrier pour un élève. */
create or replace function public._courriers_variables(p_etab uuid, p_insc uuid, p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'eleve', public._libelle(e.nom, e.prenom), 'nom', upper(e.nom), 'prenom', e.prenom, 'matricule', e.matricule, 'classe', cl.libelle, 'niveau', cl.niveau,
    'parent', 'Parents de ' || public._libelle(e.nom, e.prenom), 'etablissement', et.nom, 'date', to_char(p_date, 'DD/MM/YYYY'),
    'annee', x.libelle,
    'montant_du', public._montant(coalesce((select sum(t.reste) from public._tranches_situation(p_etab, p_date) t where t.inscription_id = p_insc and t.date_limite < p_date), 0)),
    'reste_total', public._montant(coalesce((select sum(t.reste) from public._tranches_situation(p_etab, p_date) t where t.inscription_id = p_insc), 0)),
    'echeance', coalesce((select t.libelle || ' (' || to_char(t.date_limite, 'DD/MM/YYYY') || ')' from public._tranches_situation(p_etab, p_date) t
                           where t.inscription_id = p_insc and t.reste > 0 order by t.rang limit 1), ''))
    from public.inscriptions i join public.eleves e on e.id = i.eleve_id join public.classes cl on cl.id = i.classe_id
    join public.exercices x on x.id = i.exercice_id join public.etablissements et on et.id = i.etablissement_id
   where i.id = p_insc
$$;

/** Distribue les envois programmés dont l'heure est venue (appelée à l'ouverture des écrans, chez les parents et chaque matin).
 *  Le texte est rendu de nouveau au moment de l'envoi : montants et échéances sont ceux du jour de l'envoi. */
create or replace function public._courriers_admin_liberer(p_etab uuid default null) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare e record; n int := 0; jour date := public._aujourdhui();
begin
  for e in select * from public.courriers_envois where statut = 'programme' and programme_le <= now() and (p_etab is null or etablissement_id = p_etab)
            for update skip locked loop
    update public.courriers_ecole c set
      objet = left(public._remplir(e.objet, public._courriers_variables(e.etablissement_id, c.inscription_id, jour)), 200),
      corps = left(public._remplir(e.corps, public._courriers_variables(e.etablissement_id, c.inscription_id, jour)), 8000)
     where c.envoi_id = e.id and c.statut = 'programme' and c.inscription_id is not null;
    update public.courriers_ecole set statut = case when inscription_id is null then 'echoue' else 'envoye' end,
      envoye_le = case when inscription_id is null then null else now() end,
      erreur = case when inscription_id is null then 'Élève retiré de l''établissement avant l''envoi' else '' end
     where envoi_id = e.id and statut = 'programme';
    update public.courriers_envois set statut = 'envoye', envoye_le = now() where id = e.id;
    perform public._courrier_ecole_journal(e.etablissement_id, c.id, case when c.statut = 'envoye' then 'envoi' else 'echec' end, jsonb_build_object('envoi', e.id), 'Envoi programmé')
       from public.courriers_ecole c where c.envoi_id = e.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Modèles et pièces jointes
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.courrier_modele_enregistrer(p jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._courriers_admin_droit(); v_id uuid;
begin
  v_id := nullif(p->>'id', '')::uuid;
  if coalesce(p->>'sujet', 'general') not in ('reunion', 'fermeture', 'evenement', 'discipline', 'convocation', 'pedagogie', 'rappel', 'decision', 'general') then
    raise exception 'Sujet de courrier inconnu.' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.courriers_modeles (etablissement_id, nom, sujet, objet, corps, maj_par)
    values (v_etab, btrim(p->>'nom'), coalesce(p->>'sujet', 'general'), btrim(p->>'objet'), btrim(p->>'corps'), auth.uid()) returning id into v_id;
  else
    update public.courriers_modeles set nom = btrim(p->>'nom'), sujet = coalesce(p->>'sujet', 'general'), objet = btrim(p->>'objet'), corps = btrim(p->>'corps'),
      maj = now(), maj_par = auth.uid() where id = v_id and etablissement_id = v_etab;
    if not found then raise exception 'Modèle introuvable.' using errcode = 'P0001'; end if;
  end if;
  perform public._courrier_ecole_journal(v_etab, null, 'modele', jsonb_build_object('modele', v_id, 'nom', btrim(p->>'nom')));
  return v_id;
exception
  when unique_violation then raise exception 'Un modèle porte déjà ce nom.' using errcode = 'P0001';
  when check_violation or not_null_violation then raise exception 'Modèle : nom (2 à 80 caractères), objet (3 à 200) et texte (10 à 8 000) obligatoires.' using errcode = '22023';
  when invalid_text_representation then raise exception 'Modèle introuvable.' using errcode = 'P0001';
end $$;

create or replace function public.courrier_modele_supprimer(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._courriers_admin_droit();
begin
  delete from public.courriers_modeles where id = p_id and etablissement_id = v_etab;
  if not found then raise exception 'Modèle introuvable.' using errcode = 'P0001'; end if;
  perform public._courrier_ecole_journal(v_etab, null, 'modele', jsonb_build_object('modele', p_id, 'supprime', true));
end $$;

/** Pièce jointe PDF (2 Mo au plus), envoyée en base64 ; contenu vérifié (signature %PDF-). */
create or replace function public.courrier_piece_ajouter(p_nom text, p_base64 text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._courriers_admin_droit(); d bytea; v_id uuid;
begin
  if char_length(coalesce(p_base64, '')) > 2900000 then raise exception 'Pièce jointe trop volumineuse (2 Mo au plus).' using errcode = '22023'; end if;
  begin d := decode(coalesce(p_base64, ''), 'base64');
  exception when others then raise exception 'Pièce jointe illisible.' using errcode = '22023'; end;
  if octet_length(d) = 0 or octet_length(d) > 2097152 then raise exception 'Pièce jointe trop volumineuse (2 Mo au plus).' using errcode = '22023'; end if;
  if substring(d from 1 for 5) <> '\x255044462d'::bytea then raise exception 'La pièce jointe doit être un fichier PDF.' using errcode = '22023'; end if;
  insert into public.courriers_pieces (etablissement_id, nom, taille, donnees, cree_par)
  values (v_etab, left(btrim(coalesce(nullif(p_nom, ''), 'document.pdf')), 150), octet_length(d), d, auth.uid()) returning id into v_id;
  perform public._courrier_ecole_journal(v_etab, null, 'piece', jsonb_build_object('piece', v_id, 'nom', left(p_nom, 150), 'taille', octet_length(d)));
  return v_id;
end $$;

create or replace function public.courrier_piece_lire(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public._courriers_admin_droit();
begin
  return (select jsonb_build_object('nom', nom, 'donnees', encode(donnees, 'base64')) from public.courriers_pieces where id = p_id and etablissement_id = v_etab);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Aperçu, envoi, annulation, renvoi, lectures
-- ---------------------------------------------------------------------------------------------------------

/** Aperçu des destinataires : nombre, empreinte (à renvoyer à l'envoi), répartition par classe et premiers noms. */
create or replace function public.courrier_admin_apercu(p_ciblage jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public._courriers_admin_droit();
begin
  if jsonb_typeof(p_ciblage) is distinct from 'object' then raise exception 'Ciblage invalide.' using errcode = '22023'; end if;
  return (select jsonb_build_object('nombre', count(*), 'empreinte', md5(coalesce(string_agg(x.inscription_id::text, ',' order by x.inscription_id), '')),
      'classes', (select coalesce(jsonb_agg(jsonb_build_object('classe', y.classe, 'nombre', y.n) order by y.classe), '[]'::jsonb)
                    from (select z.classe, count(*) n from public._courriers_cibles(v_etab, p_ciblage) z group by z.classe) y),
      'exemples', (select coalesce(jsonb_agg(jsonb_build_object('inscription_id', w.inscription_id, 'eleve', public._libelle(w.nom, w.prenom), 'classe', w.classe)), '[]'::jsonb)
                     from (select * from public._courriers_cibles(v_etab, p_ciblage) order by classe, nom, prenom limit 12) w))
    from public._courriers_cibles(v_etab, p_ciblage) x);
end $$;

/** Envoi (immédiat ou programmé) d'un courrier administratif à un ou plusieurs parents.
 *  p = { sujet, objet, corps, ciblage, description_cible, piece_id, confirmation_lecture, programme_le,
 *        confirmation: { nombre, empreinte } }  — le nombre et l'empreinte doivent correspondre aux destinataires actuels. */
create or replace function public.courrier_admin_envoyer(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._courriers_admin_droit(); ids uuid[]; nb int; emp text; v_envoi uuid; debut int; n int := 0; x record; v jsonb; quand timestamptz;
  statut text; jour date; v_nom text;
begin
  if char_length(btrim(coalesce(p->>'objet', ''))) not between 3 and 200 or char_length(btrim(coalesce(p->>'corps', ''))) not between 10 and 8000 then
    raise exception 'Objet (3 à 200 caractères) et texte (10 à 8 000) obligatoires.' using errcode = '22023';
  end if;
  if jsonb_typeof(p->'ciblage') is distinct from 'object' then raise exception 'Ciblage invalide.' using errcode = '22023'; end if;
  -- destinataires figés une seule fois : le contrôle (nombre, empreinte) et l'envoi portent exactement sur la même liste
  select coalesce(array_agg(z.inscription_id order by z.inscription_id), '{}') into ids from public._courriers_cibles(v_etab, p->'ciblage') z;
  nb := cardinality(ids); emp := md5(coalesce(array_to_string(ids, ','), ''));
  if nb = 0 then raise exception 'Aucun destinataire ne correspond à ce ciblage.' using errcode = 'P0001'; end if;
  if nb > 5000 then raise exception 'Trop de destinataires pour un seul envoi (5 000 au plus).' using errcode = 'P0001'; end if;
  -- protection contre l'envoi au mauvais groupe
  if coalesce(p->'confirmation'->>'nombre', '') <> nb::text then
    raise exception 'Confirmation incorrecte : saisissez le nombre exact de destinataires (%).', nb using errcode = 'P0001';
  end if;
  if coalesce(p->'confirmation'->>'empreinte', '') <> emp then
    raise exception 'Le groupe de destinataires a changé depuis l''aperçu : vérifiez-le de nouveau avant d''envoyer.' using errcode = 'P0001';
  end if;
  quand := greatest(coalesce(nullif(p->>'programme_le', '')::timestamptz, now()), now());
  if quand > now() + interval '120 days' then raise exception 'Planification à 120 jours au plus.' using errcode = '22023'; end if;
  statut := case when quand > now() + interval '1 minute' then 'programme' else 'envoye' end;
  jour := (quand at time zone 'Africa/Douala')::date;
  if nullif(p->>'piece_id', '') is not null and not exists (select 1 from public.courriers_pieces where id = (p->>'piece_id')::uuid and etablissement_id = v_etab) then
    raise exception 'Pièce jointe introuvable.' using errcode = 'P0001';
  end if;
  select public._libelle(nom, prenom) into v_nom from public.personnels where id = auth.uid();
  insert into public.courriers_envois (etablissement_id, sujet, objet, corps, ciblage, description_cible, piece_id, confirmation_lecture, statut, programme_le,
                                       destinataires, cree_par, cree_par_nom, envoye_le)
  values (v_etab, coalesce(nullif(p->>'sujet', ''), 'general'), btrim(p->>'objet'), btrim(p->>'corps'), p->'ciblage', left(coalesce(p->>'description_cible', ''), 400),
          nullif(p->>'piece_id', '')::uuid, coalesce((p->>'confirmation_lecture')::boolean, false), statut, quand, nb, auth.uid(), coalesce(v_nom, ''),
          case when statut = 'envoye' then now() end)
  returning id into v_envoi;
  debut := public._courrier_ecole_numeros(v_etab, 0);
  for x in select i.id inscription_id, i.eleve_id, e.nom, e.prenom, cl.libelle classe
             from public.inscriptions i join public.eleves e on e.id = i.eleve_id join public.classes cl on cl.id = i.classe_id
            where i.id = any (ids) order by cl.libelle, e.nom, e.prenom loop
    v := public._courriers_variables(v_etab, x.inscription_id, jour);
    insert into public.courriers_ecole (etablissement_id, numero, reference, categorie, inscription_id, eleve_id, eleve, classe, cle, statut, programme_pour,
                                        objet, corps, modele_force, envoye_le, cree_par, envoi_id)
    values (v_etab, debut + n, 'CE-' || to_char(jour, 'YYYY') || '-' || lpad((debut + n)::text, 6, '0'), 'administratif', x.inscription_id, x.eleve_id,
            public._libelle(x.nom, x.prenom), x.classe, 'admin:' || v_envoi || ':' || x.inscription_id, statut, jour,
            left(public._remplir(btrim(p->>'objet'), v), 200), left(public._remplir(btrim(p->>'corps'), v), 8000), true,
            case when statut = 'envoye' then now() end, auth.uid(), v_envoi);
    n := n + 1;
  end loop;
  perform public._courrier_ecole_journal(v_etab, null, case when statut = 'envoye' then 'envoi' else 'programmation' end,
    jsonb_build_object('envoi', v_envoi, 'destinataires', n, 'programme_le', quand));
  return jsonb_build_object('envoi_id', v_envoi, 'destinataires', n, 'statut', statut, 'programme_le', quand);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
  raise exception 'Date de planification ou pièce jointe invalide.' using errcode = '22023';
end $$;

/** Annulation d'un envoi programmé (avant l'heure d'envoi). */
create or replace function public.courrier_admin_annuler(p_envoi uuid, p_motif text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._courriers_admin_droit();
begin
  if char_length(btrim(coalesce(p_motif, ''))) < 3 then raise exception 'Indiquez le motif de l''annulation.' using errcode = 'P0001'; end if;
  update public.courriers_envois set statut = 'annule', motif = left(btrim(p_motif), 300)
   where id = p_envoi and etablissement_id = v_etab and statut = 'programme' and programme_le > now();
  if not found then raise exception 'Seul un envoi programmé, avant son heure, peut être annulé.' using errcode = 'P0001'; end if;
  update public.courriers_ecole set statut = 'annule', motif = left(btrim(p_motif), 300) where envoi_id = p_envoi and statut = 'programme';
  perform public._courrier_ecole_journal(v_etab, null, 'annulation', jsonb_build_object('envoi', p_envoi, 'motif', left(btrim(p_motif), 300)));
end $$;

/** Renvoi d'un courrier en échec (élève retiré puis réinscrit, incident) : courrier administratif renvoyé tout de suite ;
 *  relance reprogrammée pour aujourd'hui (la situation est revérifiée à l'exécution). */
create or replace function public.courrier_ecole_renvoyer(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); c public.courriers_ecole; v_insc uuid;
begin
  select * into c from public.courriers_ecole where id = p_id and etablissement_id = v_etab and statut = 'echoue';
  if c.id is null then raise exception 'Seul un courrier en échec peut être renvoyé.' using errcode = 'P0001'; end if;
  if c.categorie = 'administratif' then perform public._courriers_admin_droit(); else perform public._relances_droit(); end if;
  -- élève réinscrit entre-temps : le courrier suit son inscription de l'année en cours
  v_insc := coalesce((select i.id from public.inscriptions i where i.id = c.inscription_id),
                     (select i.id from public.inscriptions i join public.exercices x on x.id = i.exercice_id and x.actif
                       where i.eleve_id = c.eleve_id and i.etablissement_id = v_etab));
  if v_insc is null then
    raise exception 'L''élève n''est plus inscrit : le courrier ne peut pas être renvoyé.' using errcode = 'P0001';
  end if;
  if c.categorie = 'relance' then
    update public.courriers_ecole set statut = 'programme', programme_pour = public._aujourdhui(), erreur = '', inscription_id = v_insc where id = c.id;
  else
    update public.courriers_ecole set statut = 'envoye', envoye_le = now(), erreur = '', inscription_id = v_insc where id = c.id;
  end if;
  perform public._courrier_ecole_journal(v_etab, c.id, 'renvoi', '{}'::jsonb);
end $$;

/** Activer ou désactiver la confirmation de lecture d'un envoi (même après l'envoi). */
create or replace function public.courrier_admin_confirmation(p_envoi uuid, p_actif boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._courriers_admin_droit();
begin
  update public.courriers_envois set confirmation_lecture = coalesce(p_actif, false) where id = p_envoi and etablissement_id = v_etab;
  if not found then raise exception 'Envoi introuvable.' using errcode = 'P0001'; end if;
  perform public._courrier_ecole_journal(v_etab, null, 'configuration', jsonb_build_object('envoi', p_envoi, 'confirmation_lecture', coalesce(p_actif, false)));
end $$;

/** Élèves dont le parent a ouvert le courrier (et accusé réception), pour un envoi dont la confirmation de lecture est activée. */
create or replace function public.courrier_admin_lectures(p_envoi uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public._courriers_admin_droit();
begin
  if not exists (select 1 from public.courriers_envois where id = p_envoi and etablissement_id = v_etab and confirmation_lecture) then
    raise exception 'Activez d''abord la confirmation de lecture de ce courrier.' using errcode = 'P0001';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'eleve', c.eleve, 'classe', c.classe, 'statut', c.statut, 'lu_le', c.lu_le, 'accuse_le', c.accuse_le,
      'reponses', (select count(*) from public.courriers_ecole_reponses r where r.courrier_id = c.id and r.auteur = 'parent'))
      order by c.lu_le is null, c.classe, c.eleve), '[]'::jsonb)
    from public.courriers_ecole c where c.envoi_id = p_envoi and c.etablissement_id = v_etab);
end $$;

/** À l'ouverture de l'écran : distribue les envois dont l'heure est venue. */
create or replace function public.courriers_admin_liberer() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._courriers_admin_droit();
begin
  return public._courriers_admin_liberer(v_etab);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Fonctions existantes étendues
-- ---------------------------------------------------------------------------------------------------------

-- Annuler / modifier / répondre : un courrier administratif reste à l'administration
create or replace function public.courrier_ecole_annuler(p_id uuid, p_motif text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._relances_droit();
begin
  if char_length(btrim(coalesce(p_motif, ''))) < 3 then raise exception 'Indiquez le motif de l''annulation.' using errcode = 'P0001'; end if;
  update public.courriers_ecole set statut = 'annule', motif = left(btrim(p_motif), 300)
   where id = p_id and etablissement_id = v_etab and statut in ('programme', 'a_valider') and categorie in ('relance', 'final');
  if not found then raise exception 'Seul un envoi programmé ou en attente de validation peut être annulé.' using errcode = 'P0001'; end if;
  perform public._courrier_ecole_journal(v_etab, p_id, 'annulation', jsonb_build_object('motif', left(btrim(p_motif), 300)));
end $$;

create or replace function public.courrier_ecole_modifier(p_id uuid, p_objet text, p_corps text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._relances_droit();
begin
  if char_length(btrim(coalesce(p_objet, ''))) not between 3 and 200 or char_length(btrim(coalesce(p_corps, ''))) not between 10 and 8000 then
    raise exception 'Objet (3 à 200 caractères) et texte (10 à 8 000) obligatoires.' using errcode = '22023';
  end if;
  update public.courriers_ecole set objet = btrim(p_objet), corps = btrim(p_corps), modele_force = true
   where id = p_id and etablissement_id = v_etab and statut = 'programme' and categorie = 'relance';
  if not found then raise exception 'Seul un envoi programmé peut être modifié (un courrier final en attente se recrée).' using errcode = 'P0001'; end if;
  perform public._courrier_ecole_journal(v_etab, p_id, 'modification', '{}'::jsonb);
end $$;

create or replace function public.courrier_ecole_repondre(p_id uuid, p_message text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); v_cat text;
begin
  select categorie into v_cat from public.courriers_ecole where id = p_id and etablissement_id = v_etab and statut = 'envoye';
  if v_cat is null then raise exception 'Courrier introuvable.' using errcode = 'P0001'; end if;
  if v_cat = 'administratif' then perform public._courriers_admin_droit(); else perform public._relances_droit(); end if;
  insert into public.courriers_ecole_reponses (courrier_id, auteur, auteur_id, auteur_nom, message)
  values (p_id, 'ecole', auth.uid(), coalesce((select public._libelle(nom, prenom) from public.personnels where id = auth.uid()), ''), btrim(p_message));
  perform public._courrier_ecole_journal(v_etab, p_id, 'reponse', jsonb_build_object('auteur', 'ecole'));
exception when check_violation then raise exception 'Message de 2 à 4 000 caractères.' using errcode = '22023';
end $$;

-- Espace parents : distribue d'abord les envois programmés échus ; sujet, pièce jointe, confirmation demandée
create or replace function public.parent_courriers_ecole(p_session text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s record;
begin
  select * into s from public._parent_session(p_session);
  perform public._courriers_admin_liberer(s.etab);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'reference', c.reference, 'categorie', c.categorie, 'sujet', ev.sujet,
      'objet', c.objet, 'corps', c.corps, 'envoye_le', c.envoye_le, 'lu_le', c.lu_le, 'accuse_le', c.accuse_le,
      'piece', (select pc.nom from public.courriers_pieces pc where pc.id = ev.piece_id),
      'confirmation', c.categorie <> 'administratif' or coalesce(ev.confirmation_lecture, false),
      'reponses', (select coalesce(jsonb_agg(jsonb_build_object('auteur', r.auteur, 'auteur_nom', case when r.auteur = 'ecole' then r.auteur_nom else '' end,
                     'message', r.message, 'envoye_le', r.envoye_le) order by r.envoye_le), '[]'::jsonb)
                     from public.courriers_ecole_reponses r where r.courrier_id = c.id)) order by c.envoye_le desc), '[]'::jsonb)
    from public.courriers_ecole c left join public.courriers_envois ev on ev.id = c.envoi_id
   where c.eleve_id = s.eleve and c.etablissement_id = s.etab and c.statut = 'envoye');
end $$;

/** Lecture et accusé de réception par le parent. L'ouverture est toujours notée (pastille « nouveau » de l'espace parents ;
 *  l'administration ne voit la liste des ouvertures que si elle active la confirmation de lecture) ; l'accusé « J'ai pris
 *  connaissance » n'est accepté que si l'établissement l'a demandé (relances, courrier final, ou envoi avec confirmation). */
create or replace function public.parent_courrier_ecole_marquer(p_session text, p_id uuid, p_accuse boolean default false) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare s record; c public.courriers_ecole; v_conf boolean;
begin
  select * into s from public._parent_session(p_session);
  select * into c from public.courriers_ecole where id = p_id and eleve_id = s.eleve and etablissement_id = s.etab and statut = 'envoye';
  if c.id is null then raise exception 'Courrier introuvable.' using errcode = 'P0001'; end if;
  v_conf := c.categorie <> 'administratif' or coalesce((select confirmation_lecture from public.courriers_envois where id = c.envoi_id), false);
  if c.lu_le is null then
    update public.courriers_ecole set lu_le = now() where id = c.id;
    perform public._courrier_ecole_journal(s.etab, c.id, 'lecture', '{}'::jsonb, 'Parent');
  end if;
  if p_accuse and v_conf and c.accuse_le is null then
    update public.courriers_ecole set accuse_le = now() where id = c.id;
    perform public._courrier_ecole_journal(s.etab, c.id, 'accuse', '{}'::jsonb, 'Parent');
  end if;
end $$;

/** Pièce jointe d'un courrier reçu par le parent (base64). */
create or replace function public.parent_courrier_piece(p_session text, p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s record;
begin
  select * into s from public._parent_session(p_session);
  return (select jsonb_build_object('nom', pc.nom, 'donnees', encode(pc.donnees, 'base64'))
    from public.courriers_ecole c join public.courriers_envois ev on ev.id = c.envoi_id join public.courriers_pieces pc on pc.id = ev.piece_id
   where c.id = p_id and c.eleve_id = s.eleve and c.etablissement_id = s.etab and c.statut = 'envoye');
end $$;

-- Exécution quotidienne : relances (0046) et distribution des envois programmés de tous les établissements
create or replace function public.relances_quotidiennes() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare e record; jour date := public._aujourdhui(); n int := 0; envoyes int := 0; echecs int := 0; distribues int;
begin
  distribues := public._courriers_admin_liberer(null);
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
revoke execute on function public._courriers_admin_droit(), public._courriers_cibles(uuid, jsonb), public._courriers_variables(uuid, uuid, date),
  public._courriers_admin_liberer(uuid) from public, anon, authenticated;
revoke execute on function public.courrier_modele_enregistrer(jsonb), public.courrier_modele_supprimer(uuid), public.courrier_piece_ajouter(text, text),
  public.courrier_piece_lire(uuid), public.courrier_admin_apercu(jsonb), public.courrier_admin_envoyer(jsonb), public.courrier_admin_annuler(uuid, text),
  public.courrier_ecole_renvoyer(uuid), public.courrier_admin_confirmation(uuid, boolean), public.courrier_admin_lectures(uuid),
  public.courriers_admin_liberer() from public, anon;
grant execute on function public.courrier_modele_enregistrer(jsonb), public.courrier_modele_supprimer(uuid), public.courrier_piece_ajouter(text, text),
  public.courrier_piece_lire(uuid), public.courrier_admin_apercu(jsonb), public.courrier_admin_envoyer(jsonb), public.courrier_admin_annuler(uuid, text),
  public.courrier_ecole_renvoyer(uuid), public.courrier_admin_confirmation(uuid, boolean), public.courrier_admin_lectures(uuid),
  public.courriers_admin_liberer() to authenticated;
revoke execute on function public.parent_courrier_piece(text, uuid) from public;
grant execute on function public.parent_courrier_piece(text, uuid) to anon, authenticated;
