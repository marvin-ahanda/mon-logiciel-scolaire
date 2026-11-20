-- Relances de paiement et insolvabilité (rubrique Finances : administration et comptabilité / caisse).
--  * Paliers configurables (J-10 rappel amical … jour J notification de contrôle) : les messages annoncent un CONTRÔLE et une
--    mesure administrative POSSIBLE selon les règles de l'établissement, jamais un renvoi.
--  * Identification à une date donnée des élèves réellement insolvables (même règle de calcul que la situation financière :
--    pension de la catégorie, échéancier, paiements imputés dans l'ordre des échéances).
--  * Exclusions : bourse, exonération, accord de paiement, paiement en attente, et moratoire accordé par courrier.
--  * Envois planifiés, exécutés chaque jour (Worker Cloudflare) ou à la demande ; anti-doublon ; annulation avant exécution.
--  * Courrier final (renvoi effectif) rédigé à la main, validé par l'administration ou une personne autorisée avant envoi.
--  * Courrier de l'école vers les parents (socle réutilisable par les courriers administratifs) : seul le parent de l'élève
--    concerné le voit dans l'espace de son enfant ; lecture, accusé de réception, réponse. Journal de chaque action.

-- ---------------------------------------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._relances_droit() returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant();
begin
  if not public.peut_finance() then raise exception 'Réservé à l''administration et à la comptabilité.' using errcode = '42501'; end if;
  perform public._exiger_offre(v_etab, 'finances');
  return v_etab;
end $$;

create or replace function public._aujourdhui() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Africa/Douala')::date $$;

-- ---------------------------------------------------------------------------------------------------------
-- Configuration des relances (par établissement)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._relances_paliers_defaut() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_array(
    jsonb_build_object('jours', 10, 'titre', 'Rappel amical', 'objet', 'Rappel : échéance « {tranche} » le {date_limite}',
      'texte', E'Madame, Monsieur,\n\nNous vous rappelons amicalement que l''échéance « {tranche} » des frais de scolarité de {eleve} ({classe}) arrive le {date_limite}. Le montant restant à régler est de {montant} FCFA.\n\nSi vous avez déjà effectué ce paiement, merci de ne pas tenir compte de ce message.\n\nLa comptabilité — {etablissement}'),
    jsonb_build_object('jours', 7, 'titre', 'Rappel de l''échéance', 'objet', 'Échéance « {tranche} » dans {jours} jours',
      'texte', E'Madame, Monsieur,\n\nL''échéance « {tranche} » des frais de scolarité de {eleve} ({classe}) est fixée au {date_limite}, dans {jours} jours. Montant restant à régler : {montant} FCFA.\n\nNous vous remercions de bien vouloir régulariser la situation avant cette date.\n\nLa comptabilité — {etablissement}'),
    jsonb_build_object('jours', 5, 'titre', 'Avertissement de contrôle', 'objet', 'Contrôle des frais de scolarité le {date_limite}',
      'texte', E'Madame, Monsieur,\n\nUn contrôle du paiement des frais de scolarité sera effectué le {date_limite}. À ce jour, il reste {montant} FCFA à régler pour l''échéance « {tranche} » de {eleve} ({classe}).\n\nLes élèves dont la situation ne serait pas régularisée pourraient faire l''objet d''une mesure administrative, selon les règles de l''établissement.\n\nLa comptabilité — {etablissement}'),
    jsonb_build_object('jours', 4, 'titre', 'Avertissement de contrôle', 'objet', 'Contrôle des frais de scolarité dans {jours} jours',
      'texte', E'Madame, Monsieur,\n\nNous vous rappelons qu''un contrôle du paiement des frais de scolarité aura lieu le {date_limite}. Montant restant pour {eleve} ({classe}) : {montant} FCFA (échéance « {tranche} »).\n\nSans régularisation, l''élève pourrait faire l''objet d''une mesure administrative, selon les règles de l''établissement.\n\nLa comptabilité — {etablissement}'),
    jsonb_build_object('jours', 3, 'titre', 'Dernier avertissement avant contrôle', 'objet', 'Dernier avertissement avant le contrôle du {date_limite}',
      'texte', E'Madame, Monsieur,\n\nDernier avertissement avant le contrôle du {date_limite} : il reste {montant} FCFA à régler pour l''échéance « {tranche} » de {eleve} ({classe}).\n\nLes élèves dont la situation ne serait pas régularisée pourraient faire l''objet d''une mesure administrative, selon les règles de l''établissement.\n\nLa comptabilité — {etablissement}'),
    jsonb_build_object('jours', 2, 'titre', 'Avertissement final', 'objet', 'Avertissement final : contrôle le {date_limite}',
      'texte', E'Madame, Monsieur,\n\nLe contrôle du paiement des frais de scolarité aura lieu dans {jours} jours, le {date_limite}. Montant restant pour {eleve} ({classe}) : {montant} FCFA.\n\nNous vous invitons à régulariser la situation sans délai ; à défaut, une mesure administrative pourrait être envisagée selon les règles de l''établissement.\n\nLa comptabilité — {etablissement}'),
    jsonb_build_object('jours', 1, 'titre', 'Dernier rappel', 'objet', 'Dernier rappel : contrôle demain',
      'texte', E'Madame, Monsieur,\n\nLe contrôle du paiement des frais de scolarité a lieu demain, le {date_limite}. Il reste {montant} FCFA à régler pour {eleve} ({classe}).\n\nLa comptabilité — {etablissement}'),
    jsonb_build_object('jours', 0, 'titre', 'Notification de contrôle', 'objet', 'Contrôle des frais de scolarité ce jour',
      'texte', E'Madame, Monsieur,\n\nLe contrôle du paiement des frais de scolarité a lieu ce jour, {date_limite}. Notre registre indique qu''il reste {montant} FCFA à régler pour {eleve} ({classe}) au titre de l''échéance « {tranche} ».\n\nLa situation de l''élève sera examinée selon les règles de l''établissement. Si vous avez effectué ce paiement, merci de présenter votre reçu à la comptabilité.\n\nLa comptabilité — {etablissement}'))
$$;

create table if not exists public.relances_config (
  etablissement_id uuid primary key default public.etab_courant() references public.etablissements (id) on delete cascade,
  actif boolean not null default false,                                   -- envoi automatique quotidien
  paliers jsonb not null default public._relances_paliers_defaut(),
  validation_requise boolean not null default true,                       -- courrier final validé avant envoi
  validateurs text not null default 'admin' check (validateurs in ('admin', 'admin_comptable')),
  derniere_execution date,
  maj timestamptz not null default now(),
  maj_par uuid references public.personnels (id) on delete set null,
  check (jsonb_typeof(paliers) = 'array' and jsonb_array_length(paliers) <= 10)
);

-- Exclusions des relances (bourse, exonération, accord de paiement, paiement en attente)
create table if not exists public.finance_exclusions (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  inscription_id uuid not null references public.inscriptions (id) on delete cascade,
  type text not null check (type in ('bourse', 'exoneration', 'accord', 'paiement_attente')),
  motif text not null default '' check (char_length(motif) <= 300),
  du date not null,
  jusqu_au date,
  cree_par uuid references public.personnels (id) on delete set null,
  cree_le timestamptz not null default now(),
  check (jusqu_au is null or jusqu_au >= du)
);
create index if not exists finance_exclusions_inscription on public.finance_exclusions (inscription_id);

-- ---------------------------------------------------------------------------------------------------------
-- Courrier de l'école vers les parents (relances, courrier final ; socle des courriers administratifs)
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.courriers_ecole (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  numero integer not null,
  reference text not null,
  categorie text not null check (categorie in ('relance', 'final')),
  inscription_id uuid references public.inscriptions (id) on delete set null,
  eleve_id uuid not null references public.eleves (id) on delete cascade,
  eleve text not null,
  classe text not null default '',
  echeance_id uuid references public.echeances (id) on delete set null,
  palier smallint check (palier between 0 and 60),                      -- J-n de la relance
  cle text unique,                                                        -- anti-doublon (relance : élève, échéance, palier)
  statut text not null check (statut in ('programme', 'a_valider', 'envoye', 'echoue', 'annule', 'refuse')),
  programme_pour date,
  objet text check (char_length(objet) <= 200),
  corps text check (char_length(corps) <= 8000),
  modele_force boolean not null default false,                            -- texte modifié à la main avant envoi
  envoye_le timestamptz,
  lu_le timestamptz,
  accuse_le timestamptz,
  erreur text not null default '',
  motif text not null default '' check (char_length(motif) <= 300),       -- annulation ou refus
  cree_par uuid references public.personnels (id) on delete set null,
  cree_le timestamptz not null default now(),
  valide_par uuid references public.personnels (id) on delete set null,
  valide_le timestamptz,
  unique (etablissement_id, numero)
);
create index if not exists courriers_ecole_etab on public.courriers_ecole (etablissement_id, statut, programme_pour);
create index if not exists courriers_ecole_eleve on public.courriers_ecole (eleve_id);

create table if not exists public.courriers_ecole_reponses (
  id uuid primary key default gen_random_uuid(),
  courrier_id uuid not null references public.courriers_ecole (id) on delete cascade,
  auteur text not null check (auteur in ('parent', 'ecole')),
  auteur_id uuid references public.personnels (id) on delete set null,
  auteur_nom text not null default '',
  message text not null check (char_length(btrim(message)) between 2 and 4000),
  envoye_le timestamptz not null default now(),
  lu_le timestamptz
);
create index if not exists courriers_ecole_reponses_courrier on public.courriers_ecole_reponses (courrier_id, envoye_le);

create table if not exists public.courriers_ecole_journal (
  id bigint generated always as identity primary key,
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  courrier_id uuid references public.courriers_ecole (id) on delete cascade,
  action text not null check (action in ('configuration', 'exclusion', 'creation', 'modification', 'programmation', 'envoi', 'echec',
    'annulation', 'lecture', 'accuse', 'reponse', 'validation', 'refus')),
  acteur text not null default '',
  details jsonb not null default '{}'::jsonb,
  le timestamptz not null default now()
);
create index if not exists courriers_ecole_journal_etab on public.courriers_ecole_journal (etablissement_id, le desc);

alter table public.relances_config enable row level security;
alter table public.finance_exclusions enable row level security;
alter table public.courriers_ecole enable row level security;
alter table public.courriers_ecole_reponses enable row level security;
alter table public.courriers_ecole_journal enable row level security;
create policy "comptabilité" on public.relances_config for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.peut_finance()));
create policy "comptabilité" on public.finance_exclusions for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.peut_finance()));
create policy "comptabilité" on public.courriers_ecole for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.peut_finance()));
create policy "comptabilité" on public.courriers_ecole_reponses for select to authenticated
  using (exists (select 1 from public.courriers_ecole c where c.id = courrier_id and c.etablissement_id = (select public.etab_courant()))
         and (select public.peut_finance()));
create policy "comptabilité" on public.courriers_ecole_journal for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.peut_finance()));
revoke all on public.relances_config, public.finance_exclusions, public.courriers_ecole, public.courriers_ecole_reponses,
  public.courriers_ecole_journal from anon, authenticated;
grant select on public.relances_config, public.finance_exclusions, public.courriers_ecole, public.courriers_ecole_reponses,
  public.courriers_ecole_journal to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Outils internes
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._courrier_ecole_journal(p_etab uuid, p_courrier uuid, p_action text, p_details jsonb default '{}'::jsonb,
  p_acteur text default null) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.courriers_ecole_journal (etablissement_id, courrier_id, action, acteur, details)
  values (p_etab, p_courrier, p_action,
          coalesce(p_acteur, (select public._libelle(p.nom, p.prenom) from public.personnels p where p.id = auth.uid()), 'Système'),
          coalesce(p_details, '{}'::jsonb))
$$;

/** Situation de chaque inscription de l'exercice actif, échéance par échéance, à une date donnée (paiements faits jusqu'à
 *  cette date imputés dans l'ordre des échéances ; même règle que finance_eleves). */
create or replace function public._tranches_situation(p_etab uuid, p_date date)
returns table (inscription_id uuid, eleve_id uuid, echeance_id uuid, rang smallint, libelle text, date_limite date, montant bigint, paye bigint, reste bigint)
language sql stable security definer set search_path = '' as $$
  with ex as (select x.id from public.exercices x where x.etablissement_id = p_etab and x.actif),
  f as (select fs.* from public.frais_scolarite fs join ex on ex.id = fs.exercice_id),
  ech as (select e.* from public.echeances e join ex on ex.id = e.exercice_id),
  tot as (select sum(montant) total, count(*) n from ech),
  ins as (select i.id, i.eleve_id, case when i.nouveau then f.pension_nouveaux else f.pension_anciens end pension
            from public.inscriptions i join ex on ex.id = i.exercice_id cross join f),
  pay as (select p.inscription_id, sum(p.montant) paye from public.paiements p
           where p.etablissement_id = p_etab and p.date_paiement <= p_date group by p.inscription_id),
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

/** Motif d'exclusion des relances à une date (bourse, exonération, accord, paiement en attente, moratoire accordé), ou null. */
create or replace function public._relance_exclusion(p_insc uuid, p_date date) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select x.type from public.finance_exclusions x where x.inscription_id = p_insc and x.du <= p_date
        and (x.jusqu_au is null or x.jusqu_au >= p_date) order by x.cree_le desc limit 1),
    (select 'moratoire' from (select distinct on (c.inscription_id) r.moratoire_accorde, r.moratoire_jusqu_au
                                from public.courriers c join public.courrier_reponses r on r.courrier_id = c.id
                               where c.inscription_id = p_insc and c.objet = 'moratoire' and r.moratoire_accorde is not null
                               order by c.inscription_id, r.envoye_le desc) m
      where m.moratoire_accorde and m.moratoire_jusqu_au >= p_date))
$$;

/** Remplace {variable} dans un modèle. */
create or replace function public._remplir(p_modele text, p_vars jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare k text; v text; r text := coalesce(p_modele, '');
begin
  for k, v in select key, value from jsonb_each_text(coalesce(p_vars, '{}'::jsonb)) loop
    r := replace(r, '{' || k || '}', coalesce(v, ''));
  end loop;
  return r;
end $$;

create or replace function public._montant(p numeric) returns text
language sql immutable set search_path = '' as $$ select replace(to_char(coalesce(p, 0), 'FM999G999G999G999'), ',', ' ') $$;

/** Numéros des courriers de l'école : CE-AAAA-000001, séquence par établissement. Réserve n numéros consécutifs. */
create or replace function public._courrier_ecole_numeros(p_etab uuid, p_n integer) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare debut integer;
begin
  perform pg_advisory_xact_lock(hashtext('courrier_ecole:' || p_etab::text));
  select coalesce(max(numero), 0) + 1 into debut from public.courriers_ecole where etablissement_id = p_etab;
  return debut;
end $$;

/** Texte d'une relance pour un élève et une échéance, d'après le palier configuré. */
create or replace function public._relance_rendu(p_etab uuid, p_palier jsonb, p_insc uuid, p_echeance uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s record; el record; v jsonb;
begin
  select * into s from public._tranches_situation(p_etab, p_date) t where t.inscription_id = p_insc and t.echeance_id = p_echeance;
  select e.nom, e.prenom, e.matricule, c.libelle classe into el
    from public.inscriptions i join public.eleves e on e.id = i.eleve_id join public.classes c on c.id = i.classe_id where i.id = p_insc;
  v := jsonb_build_object('eleve', public._libelle(el.nom, el.prenom), 'classe', el.classe, 'matricule', el.matricule, 'tranche', s.libelle,
    'montant', public._montant(s.reste), 'date_limite', to_char(s.date_limite, 'DD/MM/YYYY'), 'jours', (s.date_limite - p_date)::text,
    'etablissement', (select nom from public.etablissements where id = p_etab));
  return jsonb_build_object('objet', left(public._remplir(p_palier->>'objet', v), 200), 'corps', left(public._remplir(p_palier->>'texte', v), 8000),
                            'reste', s.reste);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Planification et exécution
-- ---------------------------------------------------------------------------------------------------------

/** Programme les relances des 14 prochains jours pour les élèves insolvables (anti-doublon : élève × échéance × palier). */
create or replace function public._relances_planifier(p_etab uuid, p_date date, p_acteur text default null) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare cfg public.relances_config; n integer := 0; debut integer; r record;
begin
  select * into cfg from public.relances_config where etablissement_id = p_etab;
  if cfg.etablissement_id is null then return 0; end if;
  debut := public._courrier_ecole_numeros(p_etab, 0);
  for r in
    select t.inscription_id, t.eleve_id, t.echeance_id, t.date_limite, (pl->>'jours')::int jours,
           public._libelle(e.nom, e.prenom) eleve, c.libelle classe
      from public._tranches_situation(p_etab, p_date) t
      cross join jsonb_array_elements(cfg.paliers) pl
      join public.inscriptions i on i.id = t.inscription_id join public.eleves e on e.id = t.eleve_id join public.classes c on c.id = i.classe_id
     where t.reste > 0
       -- paliers des 14 prochains jours, et ceux des 10 derniers jours encore utiles (activation tardive, journée manquée) :
       -- l'exécution n'enverra que le plus récent ; rien après la date limite (le courrier final est rédigé à la main)
       and t.date_limite - (pl->>'jours')::int between p_date - 10 and p_date + 14
       and t.date_limite >= p_date
       and public._relance_exclusion(t.inscription_id, p_date) is null
       and not exists (select 1 from public.courriers_ecole x
                        where x.cle = 'relance:' || t.inscription_id || ':' || t.echeance_id || ':' || (pl->>'jours'))
     order by t.date_limite, e.nom
  loop
    insert into public.courriers_ecole (etablissement_id, numero, reference, categorie, inscription_id, eleve_id, eleve, classe, echeance_id, palier,
                                        cle, statut, programme_pour, cree_par)
    values (p_etab, debut + n, 'CE-' || to_char(p_date, 'YYYY') || '-' || lpad((debut + n)::text, 6, '0'), 'relance', r.inscription_id, r.eleve_id,
            r.eleve, r.classe, r.echeance_id, r.jours, 'relance:' || r.inscription_id || ':' || r.echeance_id || ':' || r.jours,
            'programme', r.date_limite - r.jours, auth.uid())
    on conflict (cle) do nothing;
    if found then n := n + 1; end if;
  end loop;
  if n > 0 then perform public._courrier_ecole_journal(p_etab, null, 'programmation', jsonb_build_object('nombre', n, 'date', p_date), p_acteur); end if;
  return n;
end $$;

/** Envoie les relances programmées dues à la date : vérifie de nouveau la situation (réglée ou exclue : annulée), n'envoie
 *  que le palier le plus récent quand plusieurs sont en retard pour la même échéance. */
create or replace function public._relances_executer(p_etab uuid, p_date date, p_acteur text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare cfg public.relances_config; x record; envoyes int := 0; annules int := 0; echecs int := 0; rendu jsonb; v_palier jsonb; exclu text;
begin
  select * into cfg from public.relances_config where etablissement_id = p_etab;
  for x in
    select c.*, row_number() over (partition by c.inscription_id, c.echeance_id order by c.programme_pour desc) rang
      from public.courriers_ecole c
     where c.etablissement_id = p_etab and c.categorie = 'relance' and c.statut = 'programme' and c.programme_pour <= p_date
     order by c.programme_pour
  loop
    begin
      if x.rang > 1 then
        update public.courriers_ecole set statut = 'annule', motif = 'Remplacée par un rappel plus récent' where id = x.id;
        perform public._courrier_ecole_journal(p_etab, x.id, 'annulation', jsonb_build_object('motif', 'remplacee'), coalesce(p_acteur, 'Système'));
        annules := annules + 1; continue;
      end if;
      if x.inscription_id is null then raise exception 'Inscription supprimée'; end if;
      exclu := public._relance_exclusion(x.inscription_id, p_date);
      rendu := null;
      v_palier := (select pl from jsonb_array_elements(cfg.paliers) pl where (pl->>'jours')::int = x.palier limit 1);
      if exclu is null and v_palier is not null then rendu := public._relance_rendu(p_etab, v_palier, x.inscription_id, x.echeance_id, p_date); end if;
      if exclu is not null or v_palier is null or coalesce((rendu->>'reste')::bigint, 0) <= 0 then
        update public.courriers_ecole set statut = 'annule',
          motif = case when exclu is not null then 'Élève exclu des relances (' || exclu || ')' when v_palier is null then 'Palier retiré de la configuration'
                       else 'Échéance réglée' end where id = x.id;
        perform public._courrier_ecole_journal(p_etab, x.id, 'annulation', jsonb_build_object('motif', coalesce(exclu, case when v_palier is null then 'palier' else 'reglee' end)),
                                               coalesce(p_acteur, 'Système'));
        annules := annules + 1; continue;
      end if;
      update public.courriers_ecole set statut = 'envoye', envoye_le = now(),
        objet = case when modele_force then objet else rendu->>'objet' end, corps = case when modele_force then corps else rendu->>'corps' end
       where id = x.id;
      perform public._courrier_ecole_journal(p_etab, x.id, 'envoi', jsonb_build_object('palier', x.palier), coalesce(p_acteur, 'Système'));
      envoyes := envoyes + 1;
    exception when others then
      update public.courriers_ecole set statut = 'echoue', erreur = left(sqlerrm, 300) where id = x.id;
      perform public._courrier_ecole_journal(p_etab, x.id, 'echec', jsonb_build_object('erreur', left(sqlerrm, 300)), coalesce(p_acteur, 'Système'));
      echecs := echecs + 1;
    end;
  end loop;
  return jsonb_build_object('envoyes', envoyes, 'annules', annules, 'echecs', echecs);
end $$;

/** Exécution quotidienne pour tous les établissements dont l'envoi automatique est actif (appelée par le Worker planifié).
 *  Une seule exécution par jour et par établissement, pas avant 6 h (heure de Douala) ; un établissement en erreur
 *  n'empêche pas les autres (erreur journalisée) ; ne renvoie que des compteurs. */
create or replace function public.relances_quotidiennes() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare e record; jour date := public._aujourdhui(); n int := 0; envoyes int := 0; echecs int := 0;
begin
  if extract(hour from now() at time zone 'Africa/Douala') < 6 then return jsonb_build_object('etablissements', 0, 'envoyes', 0, 'trop_tot', true); end if;
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
  return jsonb_build_object('etablissements', n, 'envoyes', envoyes, 'echecs', echecs);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Fonctions de la comptabilité
-- ---------------------------------------------------------------------------------------------------------

/** Configuration : actif et paliers (comptabilité) ; validation du courrier final (administration seulement).
 *  p = { actif, paliers: [{ jours, titre, objet, texte }] | "defaut", validation_requise, validateurs } */
create or replace function public.relances_configurer(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._relances_droit(); r public.relances_config;
  -- « defaut » : rétablit les 8 paliers par défaut
  pl jsonb := case when p->>'paliers' = 'defaut' then public._relances_paliers_defaut() else p->'paliers' end;
begin
  if pl is not null and pl <> 'null'::jsonb then
    if jsonb_typeof(pl) <> 'array' or jsonb_array_length(pl) > 10 then raise exception 'Paliers : 10 au plus.' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_array_elements(pl) x where (x->>'jours') !~ '^[0-9]{1,2}$' or (x->>'jours')::int > 60
                 or char_length(btrim(coalesce(x->>'titre', ''))) not between 1 and 80 or char_length(btrim(coalesce(x->>'objet', ''))) not between 1 and 200
                 or char_length(btrim(coalesce(x->>'texte', ''))) not between 10 and 4000) then
      raise exception 'Palier invalide : jours de 0 à 60, titre, objet et texte (10 à 4 000 caractères) obligatoires.' using errcode = '22023';
    end if;
    if (select count(distinct x->>'jours') from jsonb_array_elements(pl) x) <> jsonb_array_length(pl) then
      raise exception 'Deux paliers ne peuvent pas avoir le même nombre de jours.' using errcode = '22023';
    end if;
  end if;
  if (p ? 'validation_requise' or p ? 'validateurs') and not public.est_admin() then
    raise exception 'Seule l''administration règle la validation du courrier final.' using errcode = '42501';
  end if;
  insert into public.relances_config (etablissement_id) values (v_etab) on conflict (etablissement_id) do nothing;
  update public.relances_config set
    actif = coalesce((p->>'actif')::boolean, actif),
    paliers = case when pl is null or pl = 'null'::jsonb then paliers
                   else (select jsonb_agg(jsonb_build_object('jours', (x->>'jours')::int, 'titre', btrim(x->>'titre'), 'objet', btrim(x->>'objet'),
                                                              'texte', btrim(x->>'texte')) order by (x->>'jours')::int desc) from jsonb_array_elements(pl) x) end,
    validation_requise = coalesce((p->>'validation_requise')::boolean, validation_requise),
    validateurs = coalesce(nullif(p->>'validateurs', ''), validateurs),
    maj = now(), maj_par = auth.uid()
   where etablissement_id = v_etab returning * into r;
  perform public._courrier_ecole_journal(v_etab, null, 'configuration', jsonb_build_object('actif', r.actif, 'paliers', jsonb_array_length(r.paliers),
    'validation_requise', r.validation_requise, 'validateurs', r.validateurs));
  return to_jsonb(r);
exception when check_violation or invalid_text_representation then raise exception 'Configuration invalide.' using errcode = '22023';
end $$;

/** Élèves concernés à une date : échéances non réglées (échues ou à venir dans l'horizon des paliers) et exclusions. */
create or replace function public.relances_insolvables(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public._relances_droit(); jour date := coalesce(p_date, public._aujourdhui()); horizon int;
begin
  select coalesce(max((x->>'jours')::int), 10) into horizon
    from public.relances_config c, jsonb_array_elements(c.paliers) x where c.etablissement_id = v_etab;
  return (select coalesce(jsonb_agg(jsonb_build_object('inscription_id', s.inscription_id, 'eleve', public._libelle(e.nom, e.prenom), 'matricule', e.matricule,
      'classe', c.libelle, 'classe_id', c.id, 'exclusion', public._relance_exclusion(s.inscription_id, jour),
      'tranches', s.tranches, 'reste', s.reste, 'echu', s.echu) order by c.ordre, c.libelle, e.nom, e.prenom), '[]'::jsonb)
    from (select t.inscription_id, t.eleve_id, sum(t.reste) reste, sum(t.reste) filter (where t.date_limite < jour) echu,
                 jsonb_agg(jsonb_build_object('echeance_id', t.echeance_id, 'libelle', t.libelle, 'date_limite', t.date_limite, 'reste', t.reste,
                                              'echue', t.date_limite < jour) order by t.rang) tranches
            from public._tranches_situation(v_etab, jour) t
           where t.reste > 0 and t.date_limite <= jour + coalesce(horizon, 10)
           group by t.inscription_id, t.eleve_id) s
    join public.eleves e on e.id = s.eleve_id join public.inscriptions i on i.id = s.inscription_id join public.classes c on c.id = i.classe_id);
end $$;

/** Planification à la demande (comptabilité). */
create or replace function public.relances_planifier(p_date date default null) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._relances_droit();
begin
  insert into public.relances_config (etablissement_id) values (v_etab) on conflict (etablissement_id) do nothing;
  return public._relances_planifier(v_etab, coalesce(p_date, public._aujourdhui()));
end $$;

/** Exécution à la demande des relances dues aujourd'hui (comptabilité). */
create or replace function public.relances_executer() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._relances_droit();
begin
  return public._relances_executer(v_etab, public._aujourdhui());
end $$;

/** Annulation d'un envoi programmé (ou d'un courrier final en attente de validation), avant exécution. */
create or replace function public.courrier_ecole_annuler(p_id uuid, p_motif text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._relances_droit();
begin
  if char_length(btrim(coalesce(p_motif, ''))) < 3 then raise exception 'Indiquez le motif de l''annulation.' using errcode = 'P0001'; end if;
  update public.courriers_ecole set statut = 'annule', motif = left(btrim(p_motif), 300)
   where id = p_id and etablissement_id = v_etab and statut in ('programme', 'a_valider');
  if not found then raise exception 'Seul un envoi programmé ou en attente de validation peut être annulé.' using errcode = 'P0001'; end if;
  perform public._courrier_ecole_journal(v_etab, p_id, 'annulation', jsonb_build_object('motif', left(btrim(p_motif), 300)));
end $$;

/** Modification du texte d'un envoi programmé (il ne sera plus généré automatiquement). Un courrier final en attente de
 *  validation ne se modifie pas : le valideur doit valider exactement le texte qu'il a lu (l'annuler et le recréer). */
create or replace function public.courrier_ecole_modifier(p_id uuid, p_objet text, p_corps text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._relances_droit();
begin
  if char_length(btrim(coalesce(p_objet, ''))) not between 3 and 200 or char_length(btrim(coalesce(p_corps, ''))) not between 10 and 8000 then
    raise exception 'Objet (3 à 200 caractères) et texte (10 à 8 000) obligatoires.' using errcode = '22023';
  end if;
  update public.courriers_ecole set objet = btrim(p_objet), corps = btrim(p_corps), modele_force = true
   where id = p_id and etablissement_id = v_etab and statut = 'programme';
  if not found then raise exception 'Seul un envoi programmé peut être modifié (un courrier final en attente se recrée).' using errcode = 'P0001'; end if;
  perform public._courrier_ecole_journal(v_etab, p_id, 'modification', '{}'::jsonb);
end $$;

/** Exclusion d'un élève des relances. */
create or replace function public.relances_exclure(p_inscription uuid, p_type text, p_motif text, p_du date, p_jusqu_au date) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._relances_droit(); v_id uuid;
begin
  if not exists (select 1 from public.inscriptions where id = p_inscription and etablissement_id = v_etab) then
    raise exception 'Élève introuvable.' using errcode = 'P0001';
  end if;
  insert into public.finance_exclusions (etablissement_id, inscription_id, type, motif, du, jusqu_au, cree_par)
  values (v_etab, p_inscription, p_type, left(btrim(coalesce(p_motif, '')), 300), coalesce(p_du, public._aujourdhui()), p_jusqu_au, auth.uid())
  returning id into v_id;
  perform public._courrier_ecole_journal(v_etab, null, 'exclusion', jsonb_build_object('inscription_id', p_inscription, 'type', p_type, 'jusqu_au', p_jusqu_au));
  return v_id;
exception when check_violation then raise exception 'Exclusion invalide : type inconnu ou dates incohérentes.' using errcode = '22023';
end $$;

/** Fin d'une exclusion : elle s'arrête la veille (historique conservé) ; une exclusion qui n'a pas encore commencé ou commence
 *  aujourd'hui est retirée (le journal en garde la trace). */
create or replace function public.relances_fin_exclusion(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._relances_droit(); v_insc uuid;
begin
  delete from public.finance_exclusions where id = p_id and etablissement_id = v_etab and du >= public._aujourdhui() returning inscription_id into v_insc;
  if v_insc is null then
    update public.finance_exclusions set jusqu_au = public._aujourdhui() - 1
     where id = p_id and etablissement_id = v_etab returning inscription_id into v_insc;
  end if;
  if v_insc is null then raise exception 'Exclusion introuvable.' using errcode = 'P0001'; end if;
  perform public._courrier_ecole_journal(v_etab, null, 'exclusion', jsonb_build_object('inscription_id', v_insc, 'fin', true));
end $$;

/** Courrier final (mesure effective), rédigé à la main pour un ou plusieurs élèves ; à valider avant envoi si l'établissement
 *  l'exige. Variables : {eleve} {classe} {matricule} {montant} {etablissement}. p = { inscriptions: [uuid], objet, corps } */
create or replace function public.courrier_final_creer(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._relances_droit(); cfg public.relances_config; debut int; n int := 0; x record; v jsonb; statut text;
  objet text := btrim(coalesce(p->>'objet', '')); corps text := btrim(coalesce(p->>'corps', '')); jour date := public._aujourdhui(); v_id uuid; ids uuid[] := '{}';
begin
  if char_length(objet) not between 3 and 200 or char_length(corps) not between 20 and 8000 then
    raise exception 'Objet (3 à 200 caractères) et texte (20 à 8 000) obligatoires.' using errcode = '22023';
  end if;
  if jsonb_typeof(p->'inscriptions') <> 'array' or jsonb_array_length(p->'inscriptions') = 0 or jsonb_array_length(p->'inscriptions') > 500 then
    raise exception 'Choisissez de 1 à 500 élèves.' using errcode = '22023';
  end if;
  insert into public.relances_config (etablissement_id) values (v_etab) on conflict (etablissement_id) do nothing;
  select * into cfg from public.relances_config where etablissement_id = v_etab;
  statut := case when cfg.validation_requise then 'a_valider' else 'envoye' end;
  debut := public._courrier_ecole_numeros(v_etab, 0);
  for x in select distinct i.id, i.eleve_id, e.nom, e.prenom, e.matricule, c.libelle classe,
                  (select sum(t.reste) from public._tranches_situation(v_etab, jour) t where t.inscription_id = i.id and t.date_limite <= jour) du
             from jsonb_array_elements_text(p->'inscriptions') a
             join public.inscriptions i on i.id = a.value::uuid and i.etablissement_id = v_etab
             join public.eleves e on e.id = i.eleve_id join public.classes c on c.id = i.classe_id
  loop
    -- garde-fou : seulement un élève réellement insolvable (échéance échue non réglée) et non exclu des relances
    if coalesce(x.du, 0) <= 0 then
      raise exception 'Courrier final impossible pour % : aucune échéance échue non réglée.', public._libelle(x.nom, x.prenom) using errcode = 'P0001';
    end if;
    if public._relance_exclusion(x.id, jour) is not null then
      raise exception 'Courrier final impossible pour % : élève exclu des relances (%).', public._libelle(x.nom, x.prenom), public._relance_exclusion(x.id, jour)
        using errcode = 'P0001';
    end if;
    v := jsonb_build_object('eleve', public._libelle(x.nom, x.prenom), 'classe', x.classe, 'matricule', x.matricule,
                            'montant', public._montant(coalesce(x.du, 0)), 'etablissement', (select nom from public.etablissements where id = v_etab));
    insert into public.courriers_ecole (etablissement_id, numero, reference, categorie, inscription_id, eleve_id, eleve, classe, cle, statut,
                                        objet, corps, modele_force, envoye_le, cree_par, programme_pour)
    values (v_etab, debut + n, 'CE-' || to_char(jour, 'YYYY') || '-' || lpad((debut + n)::text, 6, '0'), 'final', x.id, x.eleve_id,
            public._libelle(x.nom, x.prenom), x.classe, 'final:' || x.id || ':' || md5(objet || corps) || ':' || jour, statut,
            left(public._remplir(objet, v), 200), left(public._remplir(corps, v), 8000), true,
            case when statut = 'envoye' then now() end, auth.uid(), jour)
    on conflict (cle) do nothing returning id into v_id;
    if v_id is not null then
      n := n + 1; ids := ids || v_id;
      perform public._courrier_ecole_journal(v_etab, v_id, 'creation', jsonb_build_object('categorie', 'final', 'statut', statut));
      if statut = 'envoye' then perform public._courrier_ecole_journal(v_etab, v_id, 'envoi', '{}'::jsonb); end if;
    end if;
    v_id := null;
  end loop;
  if n = 0 then raise exception 'Ce courrier a déjà été créé aujourd''hui pour ces élèves.' using errcode = 'P0001'; end if;
  return jsonb_build_object('crees', n, 'statut', statut, 'ids', to_jsonb(ids));
end $$;

/** Validation (ou refus motivé) des courriers finaux en attente : administration, ou un comptable autre que l'auteur si
 *  l'établissement l'autorise. */
create or replace function public.courrier_final_valider(p_ids uuid[], p_accepter boolean, p_motif text default '') returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._relances_droit(); cfg public.relances_config; v_role text := public._mon_role(); n int := 0; x record;
begin
  select * into cfg from public.relances_config where etablissement_id = v_etab;
  if v_role <> 'admin' and coalesce(cfg.validateurs, 'admin') <> 'admin_comptable' then
    raise exception 'Seule l''administration valide le courrier final.' using errcode = '42501';
  end if;
  if not p_accepter and char_length(btrim(coalesce(p_motif, ''))) < 3 then raise exception 'Indiquez le motif du refus.' using errcode = 'P0001'; end if;
  for x in select * from public.courriers_ecole where id = any (coalesce(p_ids, '{}')) and etablissement_id = v_etab and statut = 'a_valider' loop
    if v_role <> 'admin' and x.cree_par = auth.uid() then
      raise exception 'Un courrier ne peut pas être validé par la personne qui l''a rédigé.' using errcode = '42501';
    end if;
    if p_accepter then
      update public.courriers_ecole set statut = 'envoye', envoye_le = now(), valide_par = auth.uid(), valide_le = now() where id = x.id;
      perform public._courrier_ecole_journal(v_etab, x.id, 'validation', '{}'::jsonb);
      perform public._courrier_ecole_journal(v_etab, x.id, 'envoi', '{}'::jsonb);
    else
      update public.courriers_ecole set statut = 'refuse', motif = left(btrim(p_motif), 300), valide_par = auth.uid(), valide_le = now() where id = x.id;
      perform public._courrier_ecole_journal(v_etab, x.id, 'refus', jsonb_build_object('motif', left(btrim(p_motif), 300)));
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

/** Réponse de l'école à la réponse d'un parent. */
create or replace function public.courrier_ecole_repondre(p_id uuid, p_message text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._relances_droit();
begin
  if not exists (select 1 from public.courriers_ecole where id = p_id and etablissement_id = v_etab and statut = 'envoye') then
    raise exception 'Courrier introuvable.' using errcode = 'P0001';
  end if;
  insert into public.courriers_ecole_reponses (courrier_id, auteur, auteur_id, auteur_nom, message)
  values (p_id, 'ecole', auth.uid(), coalesce((select public._libelle(nom, prenom) from public.personnels where id = auth.uid()), ''), btrim(p_message));
  perform public._courrier_ecole_journal(v_etab, p_id, 'reponse', jsonb_build_object('auteur', 'ecole'));
exception when check_violation then raise exception 'Message de 2 à 4 000 caractères.' using errcode = '22023';
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Espace parents : seuls les courriers de l'enfant, envoyés
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.parent_courriers_ecole(p_session text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s record;
begin
  select * into s from public._parent_session(p_session);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'reference', c.reference, 'objet', c.objet, 'corps', c.corps, 'envoye_le', c.envoye_le,
      'lu_le', c.lu_le, 'accuse_le', c.accuse_le,
      'reponses', (select coalesce(jsonb_agg(jsonb_build_object('auteur', r.auteur, 'auteur_nom', case when r.auteur = 'ecole' then r.auteur_nom else '' end,
                     'message', r.message, 'envoye_le', r.envoye_le) order by r.envoye_le), '[]'::jsonb)
                     from public.courriers_ecole_reponses r where r.courrier_id = c.id)) order by c.envoye_le desc), '[]'::jsonb)
    from public.courriers_ecole c
   where c.eleve_id = s.eleve and c.etablissement_id = s.etab and c.statut = 'envoye');
end $$;

/** Lecture (première ouverture) ou accusé de réception (« J'ai pris connaissance ») par le parent. */
create or replace function public.parent_courrier_ecole_marquer(p_session text, p_id uuid, p_accuse boolean default false) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare s record; c public.courriers_ecole;
begin
  select * into s from public._parent_session(p_session);
  select * into c from public.courriers_ecole where id = p_id and eleve_id = s.eleve and etablissement_id = s.etab and statut = 'envoye';
  if c.id is null then raise exception 'Courrier introuvable.' using errcode = 'P0001'; end if;
  if c.lu_le is null then
    update public.courriers_ecole set lu_le = now() where id = c.id;
    perform public._courrier_ecole_journal(s.etab, c.id, 'lecture', '{}'::jsonb, 'Parent');
  end if;
  if p_accuse and c.accuse_le is null then
    update public.courriers_ecole set accuse_le = now() where id = c.id;
    perform public._courrier_ecole_journal(s.etab, c.id, 'accuse', '{}'::jsonb, 'Parent');
  end if;
end $$;

create or replace function public.parent_courrier_ecole_repondre(p_session text, p_id uuid, p_message text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare s record; c public.courriers_ecole;
begin
  select * into s from public._parent_session(p_session);
  select * into c from public.courriers_ecole where id = p_id and eleve_id = s.eleve and etablissement_id = s.etab and statut = 'envoye';
  if c.id is null then raise exception 'Courrier introuvable.' using errcode = 'P0001'; end if;
  if (select count(*) from public.courriers_ecole_reponses where courrier_id = c.id and auteur = 'parent') >= 10 then
    raise exception 'Nombre maximal de réponses atteint pour ce courrier : contactez l''établissement.' using errcode = 'P0001';
  end if;
  insert into public.courriers_ecole_reponses (courrier_id, auteur, message) values (c.id, 'parent', btrim(coalesce(p_message, '')));
  if c.lu_le is null then update public.courriers_ecole set lu_le = now() where id = c.id; end if;
  perform public._courrier_ecole_journal(s.etab, c.id, 'reponse', jsonb_build_object('auteur', 'parent'), 'Parent');
exception when check_violation then raise exception 'Message de 2 à 4 000 caractères.' using errcode = '22023';
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------------------------------------------------------
revoke execute on function public._relances_droit(), public._courrier_ecole_journal(uuid, uuid, text, jsonb, text), public._tranches_situation(uuid, date),
  public._relance_exclusion(uuid, date), public._courrier_ecole_numeros(uuid, integer), public._relance_rendu(uuid, jsonb, uuid, uuid, date),
  public._relances_planifier(uuid, date, text), public._relances_executer(uuid, date, text) from public, anon, authenticated;
revoke execute on function public.relances_configurer(jsonb), public.relances_insolvables(date), public.relances_planifier(date), public.relances_executer(),
  public.courrier_ecole_annuler(uuid, text), public.courrier_ecole_modifier(uuid, text, text), public.relances_exclure(uuid, text, text, date, date),
  public.relances_fin_exclusion(uuid), public.courrier_final_creer(jsonb), public.courrier_final_valider(uuid[], boolean, text),
  public.courrier_ecole_repondre(uuid, text) from public, anon;
grant execute on function public.relances_configurer(jsonb), public.relances_insolvables(date), public.relances_planifier(date), public.relances_executer(),
  public.courrier_ecole_annuler(uuid, text), public.courrier_ecole_modifier(uuid, text, text), public.relances_exclure(uuid, text, text, date, date),
  public.relances_fin_exclusion(uuid), public.courrier_final_creer(jsonb), public.courrier_final_valider(uuid[], boolean, text),
  public.courrier_ecole_repondre(uuid, text) to authenticated;
revoke execute on function public.parent_courriers_ecole(text), public.parent_courrier_ecole_marquer(text, uuid, boolean),
  public.parent_courrier_ecole_repondre(text, uuid, text), public.relances_quotidiennes() from public;
grant execute on function public.parent_courriers_ecole(text), public.parent_courrier_ecole_marquer(text, uuid, boolean),
  public.parent_courrier_ecole_repondre(text, uuid, text) to anon, authenticated;
-- exécution quotidienne : appelée par le Worker planifié avec la clé publique (idempotente, une fois par jour, compteurs seulement)
grant execute on function public.relances_quotidiennes() to anon;
