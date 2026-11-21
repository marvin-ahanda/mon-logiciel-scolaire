-- Nouveau modèle commercial des établissements (novembre 2026).
--  * Deux formules seulement : Découverte (gratuite, limitée dans le temps et en effectif, fonctions de base) et Premium
--    (TOUTES les fonctionnalités de l'application, présentes et futures). Le prix dépend uniquement de l'effectif souscrit :
--    prix par élève × capacité, avec un minimum annuel ; validité de 12 mois à compter du paiement.
--  * La capacité compte les élèves INSCRITS dans l'année scolaire concernée (contrôle verrouillé sur public.inscriptions :
--    ajout individuel, import, API, hors ligne, transition d'année… aucune route ne peut le contourner).
--  * Augmentation de capacité en cours d'abonnement (on paie la différence, l'échéance est conservée), renouvellement
--    (capacité conservée ou modifiée), historique complet ; activation uniquement après paiement vérifié côté serveur.
--  * Paramètres commerciaux centralisés dans public.config_commerciale (une seule ligne, modifiable par la console).
--  * Une adresse e-mail ne bénéficie qu'une seule fois d'une offre gratuite (établissement ou SmartEval).
--  * Anciens abonnements (Essentiel, Pro, Premium mensuels/annuels) : conservés jusqu'à leur échéance, avec TOUTES les
--    fonctionnalités et sans limite d'effectif ; aucun paiement n'est déclenché, aucune donnée n'est supprimée.

-- ---------------------------------------------------------------------------------------------------------
-- 1. Configuration commerciale centralisée (une seule source de vérité)
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.config_commerciale (
  id boolean primary key default true check (id),
  -- Établissements
  etab_prix_eleve integer not null default 500 check (etab_prix_eleve > 0),                     -- FCFA par élève et par an
  etab_minimum_annuel integer not null default 50000 check (etab_minimum_annuel >= 0),          -- FCFA
  etab_duree_mois integer not null default 12 check (etab_duree_mois between 1 and 24),
  etab_grace_jours integer not null default 7 check (etab_grace_jours between 0 and 60),         -- accès complet après l'échéance
  etab_renouvellement_jours integer not null default 60 check (etab_renouvellement_jours between 0 and 365),
  etab_capacite_max integer not null default 20000 check (etab_capacite_max > 0),
  decouverte_max_eleves integer not null default 50 check (decouverte_max_eleves >= 0),
  decouverte_max_personnel integer not null default 10 check (decouverte_max_personnel >= 1),
  decouverte_duree_jours integer not null default 120 check (decouverte_duree_jours between 1 and 3650),
  fonctions_gratuites text[] not null default array['notes', 'appel', 'bulletins', 'excel_base', 'distinctions', 'cartes', 'parcours', 'pv'],
  -- SmartEval enseignant indépendant
  se_prix_annuel integer not null default 5000 check (se_prix_annuel > 0),
  se_credits_inclus integer not null default 10 check (se_credits_inclus between 1 and 1000),
  se_duree_mois integer not null default 12 check (se_duree_mois between 1 and 24),
  se_renouvellement_jours integer not null default 30 check (se_renouvellement_jours between 0 and 365),
  se_decouverte_evaluations integer not null default 1 check (se_decouverte_evaluations between 0 and 100),
  se_decouverte_soumissions integer not null default 2 check (se_decouverte_soumissions between 0 and 1000),
  se_decouverte_duree_jours integer not null default 30 check (se_decouverte_duree_jours between 1 and 3650),
  se_soumissions_max integer not null default 150 check (se_soumissions_max between 1 and 3000),
  se_pack_actif boolean not null default true,
  se_pack_credits integer not null default 5 check (se_pack_credits between 1 and 1000),
  se_pack_prix integer not null default 2000 check (se_pack_prix > 0),
  -- SmartEval groupe d'enseignants d'un même département (une matière / discipline)
  groupe_actif boolean not null default true,
  groupe_prix_annuel integer not null default 15000 check (groupe_prix_annuel > 0),            -- FCFA par groupe et par an
  groupe_membres_max integer not null default 20 check (groupe_membres_max between 2 and 500),  -- administrateur compris
  groupe_credits_membre integer not null default 10 check (groupe_credits_membre between 1 and 1000),
  maj timestamptz not null default now(),
  maj_par uuid
);
insert into public.config_commerciale (id) values (true) on conflict (id) do nothing;
alter table public.config_commerciale enable row level security;
revoke all on public.config_commerciale from public, anon, authenticated;     -- lecture par les fonctions, écriture par la console

create or replace function public._config() returns public.config_commerciale
language sql stable security definer set search_path = '' as $$ select * from public.config_commerciale where id $$;
revoke execute on function public._config() from public, anon, authenticated;

/** Montant annuel d'un établissement pour une capacité donnée (minimum annuel appliqué). */
create or replace function public._montant_etablissement(p_capacite integer) returns integer
language sql stable security definer set search_path = '' as $$
  select greatest((select etab_minimum_annuel from public.config_commerciale where id), p_capacite * (select etab_prix_eleve from public.config_commerciale where id))
$$;
revoke execute on function public._montant_etablissement(integer) from public, anon, authenticated;

/** Tarifs publics (page d'accueil, pages de tarification, abonnements) : seules les valeurs utiles sont exposées. */
create or replace function public.offres_publiques() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'devise', 'XAF',
    'etablissement', jsonb_build_object('prix_eleve', c.etab_prix_eleve, 'minimum_annuel', c.etab_minimum_annuel,
      'capacite_minimum', ceil(c.etab_minimum_annuel::numeric / c.etab_prix_eleve)::int, 'duree_mois', c.etab_duree_mois, 'capacite_max', c.etab_capacite_max, 'renouvellement_jours', c.etab_renouvellement_jours,
      'decouverte', jsonb_build_object('max_eleves', c.decouverte_max_eleves, 'max_personnel', c.decouverte_max_personnel, 'duree_jours', c.decouverte_duree_jours,
                                       'fonctions', to_jsonb(c.fonctions_gratuites))),
    'smarteval', jsonb_build_object('prix_annuel', c.se_prix_annuel, 'credits', c.se_credits_inclus, 'duree_mois', c.se_duree_mois,
      'soumissions_max', c.se_soumissions_max, 'renouvellement_jours', c.se_renouvellement_jours,
      'decouverte', jsonb_build_object('evaluations', c.se_decouverte_evaluations, 'soumissions', c.se_decouverte_soumissions, 'duree_jours', c.se_decouverte_duree_jours),
      'pack', case when c.se_pack_actif then jsonb_build_object('credits', c.se_pack_credits, 'prix', c.se_pack_prix) end,
      'groupe', case when c.groupe_actif then jsonb_build_object('prix_annuel', c.groupe_prix_annuel, 'membres_max', c.groupe_membres_max,
                                                                  'credits_membre', c.groupe_credits_membre) end))
  from public.config_commerciale c where c.id
$$;
grant execute on function public.offres_publiques() to anon, authenticated;

/** Console : lecture et modification de la configuration commerciale (propriétaire de la plateforme uniquement). */
create or replace function public.console_config_commerciale() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exiger_proprietaire();
  return (select to_jsonb(c) - 'id' from public.config_commerciale c where c.id);
end $$;

create or replace function public.console_definir_config(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c public.config_commerciale; n public.config_commerciale;
begin
  perform public._exiger_proprietaire();
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'Configuration invalide.' using errcode = '22023'; end if;
  select * into c from public.config_commerciale where id for update;
  n := jsonb_populate_record(c, p - 'id' - 'maj' - 'maj_par');
  if exists (select 1 from unnest(n.fonctions_gratuites) f where f <> all (public._fonctions_reglables())) then
    raise exception 'Fonction inconnue dans la liste des fonctions gratuites.' using errcode = '22023';
  end if;
  update public.config_commerciale set
    etab_prix_eleve = n.etab_prix_eleve, etab_minimum_annuel = n.etab_minimum_annuel, etab_duree_mois = n.etab_duree_mois,
    etab_grace_jours = n.etab_grace_jours, etab_renouvellement_jours = n.etab_renouvellement_jours, etab_capacite_max = n.etab_capacite_max,
    decouverte_max_eleves = n.decouverte_max_eleves, decouverte_max_personnel = n.decouverte_max_personnel, decouverte_duree_jours = n.decouverte_duree_jours,
    fonctions_gratuites = n.fonctions_gratuites,
    se_prix_annuel = n.se_prix_annuel, se_credits_inclus = n.se_credits_inclus, se_duree_mois = n.se_duree_mois, se_renouvellement_jours = n.se_renouvellement_jours,
    se_decouverte_evaluations = n.se_decouverte_evaluations, se_decouverte_soumissions = n.se_decouverte_soumissions,
    se_decouverte_duree_jours = n.se_decouverte_duree_jours, se_soumissions_max = n.se_soumissions_max,
    se_pack_actif = n.se_pack_actif, se_pack_credits = n.se_pack_credits, se_pack_prix = n.se_pack_prix,
    groupe_actif = n.groupe_actif, groupe_prix_annuel = n.groupe_prix_annuel, groupe_membres_max = n.groupe_membres_max,
    groupe_credits_membre = n.groupe_credits_membre, maj = now(), maj_par = auth.uid()
   where id;
  perform public._journal_plateforme('config_commerciale', 'NexIA', p);
  return public.console_config_commerciale();
exception when check_violation or invalid_text_representation or datatype_mismatch then
  raise exception 'Valeur invalide dans la configuration (montants positifs, durées et limites dans les bornes prévues).' using errcode = '22023';
end $$;
revoke execute on function public.console_config_commerciale(), public.console_definir_config(jsonb) from public, anon;
grant execute on function public.console_config_commerciale(), public.console_definir_config(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 2. Une seule offre gratuite par adresse e-mail (établissement ou SmartEval)
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.essais_gratuits (
  empreinte text not null,                       -- SHA-256 de l'adresse normalisée (l'adresse elle-même n'est pas conservée ici)
  produit text not null check (produit in ('etablissement', 'smarteval')),
  debut timestamptz not null default now(),
  fin timestamptz not null,
  primary key (empreinte, produit)
);
alter table public.essais_gratuits enable row level security;
revoke all on public.essais_gratuits from public, anon, authenticated;

/** Empreinte d'une adresse e-mail normalisée : minuscules, sans « +étiquette », points ignorés chez Gmail. */
create or replace function public._email_empreinte(p_email text) returns text
language plpgsql immutable set search_path = '' as $$
declare e text := lower(btrim(coalesce(p_email, ''))); l text; d text;
begin
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return null; end if;
  l := split_part(e, '@', 1); d := split_part(e, '@', 2);
  l := split_part(l, '+', 1);
  if d in ('gmail.com', 'googlemail.com') then l := replace(l, '.', ''); d := 'gmail.com'; end if;
  return encode(extensions.digest(l || '@' || d, 'sha256'), 'hex');
end $$;
revoke execute on function public._email_empreinte(text) from public, anon, authenticated;

/** Enregistre une offre gratuite ; renvoie false si l'adresse en a déjà bénéficié (aucune nouvelle offre gratuite). */
create or replace function public._essai_gratuit(p_email text, p_produit text, p_jours integer) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v text := public._email_empreinte(p_email);
begin
  if v is null then return true; end if;              -- comptes techniques sans adresse réelle : sans objet
  if exists (select 1 from public.essais_gratuits where empreinte = v and produit = p_produit) then return false; end if;
  insert into public.essais_gratuits (empreinte, produit, fin) values (v, p_produit, now() + make_interval(days => p_jours));
  return true;
end $$;
revoke execute on function public._essai_gratuit(text, text, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Établissements : période de découverte, abonnements par période, historique
-- ---------------------------------------------------------------------------------------------------------
alter table public.etablissements add column if not exists decouverte_fin timestamptz;

-- établissements existants : ceux en Découverte commencent leur période de découverte maintenant ; les autres l'ont « consommée »
update public.etablissements set decouverte_fin = case when offre = 'decouverte'
    then now() + make_interval(days => (select decouverte_duree_jours from public.config_commerciale where id)) else now() end
 where decouverte_fin is null;

/** Nouvel établissement : période de découverte, sauf si l'adresse du fondateur en a déjà bénéficié. */
create or replace function public._etab_decouverte() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_jours int := (select decouverte_duree_jours from public.config_commerciale where id); v_email text;
begin
  if new.decouverte_fin is not null then return new; end if;
  select email into v_email from auth.users where id = auth.uid();
  new.decouverte_fin := case when public._essai_gratuit(v_email, 'etablissement', v_jours) then now() + make_interval(days => v_jours) else now() end;
  return new;
end $$;
revoke execute on function public._etab_decouverte() from public, anon, authenticated;
drop trigger if exists etab_decouverte on public.etablissements;
create trigger etab_decouverte before insert on public.etablissements for each row execute function public._etab_decouverte();

-- Périodes d'abonnement Premium (une ligne par période payée : souscription ou renouvellement ; l'augmentation de capacité
-- met à jour la période en cours). Les anciens abonnements n'ont pas de période : capacité illimitée jusqu'à leur échéance.
create table if not exists public.abonnements_etablissement (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  debut timestamptz not null,
  fin timestamptz not null check (fin > debut),
  capacite integer not null check (capacite > 0),
  montant_paye integer not null default 0 check (montant_paye >= 0),
  annee text not null default '',                            -- année scolaire indicative (ex. 2026-2027)
  cree_le timestamptz not null default now()
);
create index if not exists abonnements_etablissement_etab on public.abonnements_etablissement (etablissement_id, debut desc);

create table if not exists public.abonnements_historique (
  id bigint generated always as identity primary key,
  etablissement_id uuid references public.etablissements (id) on delete cascade,
  compte_id uuid,                                            -- enseignant indépendant (migration 0052)
  type text not null check (type in ('souscription', 'renouvellement', 'extension', 'credits', 'groupe', 'console', 'migration')),
  capacite_avant integer,
  capacite_apres integer,
  montant integer,
  paiement_id uuid,
  debut timestamptz,
  fin timestamptz,
  details jsonb not null default '{}'::jsonb,
  le timestamptz not null default now()
);
create index if not exists abonnements_historique_etab on public.abonnements_historique (etablissement_id, le desc);

alter table public.abonnements_etablissement enable row level security;
alter table public.abonnements_historique enable row level security;
revoke all on public.abonnements_etablissement, public.abonnements_historique from public, anon, authenticated;
grant select on public.abonnements_etablissement, public.abonnements_historique to authenticated;
create policy "administration" on public.abonnements_etablissement for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));
create policy "administration" on public.abonnements_historique for select to authenticated
  using (etablissement_id is not null and etablissement_id = (select public.etab_courant()) and (select public.est_admin()));

/** Année scolaire indicative d'une date (rentrée en septembre). */
create or replace function public._annee_scolaire(p timestamptz) returns text
language sql stable set search_path = '' as $$
  select case when extract(month from p at time zone 'Africa/Douala') >= 9
              then extract(year from p at time zone 'Africa/Douala')::int || '-' || (extract(year from p at time zone 'Africa/Douala')::int + 1)
              else (extract(year from p at time zone 'Africa/Douala')::int - 1) || '-' || extract(year from p at time zone 'Africa/Douala')::int end
$$;

/** Période Premium en cours (délai de grâce compris), la plus récente commencée. */
create or replace function public._periode_etablissement(p_etab uuid) returns public.abonnements_etablissement
language sql stable security definer set search_path = '' as $$
  select a.* from public.abonnements_etablissement a
   where a.etablissement_id = p_etab and a.debut <= now()
     and now() < a.fin + make_interval(days => (select etab_grace_jours from public.config_commerciale where id))
   order by a.debut desc limit 1
$$;
revoke execute on function public._periode_etablissement(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 4. Droits : Découverte (fonctions de base) ou Premium (toutes les fonctions) ; « expirée » : consultation et renouvellement
-- ---------------------------------------------------------------------------------------------------------
/** Formule en vigueur : 'premium', 'decouverte' ou 'expiree'.
 *  Premium : abonnement payé (ou ancien abonnement, ou attribution par la plateforme) non échu, délai de grâce compris. */
create or replace function public._offre_effective(p_etab uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select case
      when e.offre in ('essentiel', 'pro', 'premium')
           and (e.offre_expire_le is null or e.offre_expire_le + make_interval(days => (select etab_grace_jours from public.config_commerciale where id)) > now())
        then 'premium'
      when e.decouverte_fin is null or e.decouverte_fin > now() then 'decouverte'
      else 'expiree' end
    from public.etablissements e where e.id = p_etab), 'decouverte')
$$;

create or replace function public._rang_offre(p_offre text) returns int
language sql immutable set search_path = '' as $$
  select case p_offre when 'expiree' then 0 when 'decouverte' then 1 when 'essentiel' then 2 when 'pro' then 3 when 'premium' then 4 else 1 end
$$;

/** Fonction gratuite (configuration) ou Premium. Toute fonction nouvelle est Premium par défaut, donc incluse dans Premium. */
create or replace function public.offre_requise(p_fonction text) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_fonction = any ((public._config()).fonctions_gratuites) then 'decouverte' else 'premium' end
$$;

create or replace function public._libelle_offre(p_offre text) returns text
language sql immutable set search_path = '' as $$
  select case p_offre when 'premium' then 'Premium' when 'expiree' then 'expirée' when 'essentiel' then 'Premium' when 'pro' then 'Premium' else 'Découverte' end
$$;

create or replace function public._exiger_offre(p_etab uuid, p_fonction text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_offre text;
begin
  if p_etab is null or public._offre_inclut(p_etab, p_fonction) then return; end if;
  v_offre := public._offre_effective(p_etab);
  if v_offre = 'expiree' then
    raise exception 'Votre abonnement (ou votre période de découverte) est terminé : vos données restent consultables. Souscrivez à l''offre Premium pour continuer à les modifier.'
      using errcode = 'P0001', hint = 'offre:premium';
  end if;
  if public._rang_offre(v_offre) >= public._rang_offre(public.offre_requise(p_fonction)) then
    raise exception 'Cette fonctionnalité est momentanément désactivée pour votre établissement. Contactez NexIA pour la réactiver.'
      using errcode = 'P0001', hint = 'offre:desactivee';
  end if;
  raise exception 'Cette fonctionnalité fait partie de l''offre Premium : toutes les fonctionnalités, au tarif de votre effectif.'
    using errcode = 'P0001', hint = 'offre:premium';
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 5. Capacité d'élèves : inscriptions de l'année scolaire concernée
-- ---------------------------------------------------------------------------------------------------------
/** Capacité en vigueur (null = illimitée) : période payée en cours ; ancien abonnement ou dérogation : illimitée ;
 *  Découverte : plafond configuré ; expirée : aucune nouvelle inscription. */
create or replace function public._capacite_eleves(p_etab uuid) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare v_offre text := public._offre_effective(p_etab); a public.abonnements_etablissement;
begin
  if exists (select 1 from public.fonctions_etablissement d where d.etablissement_id = p_etab and d.fonction = 'plafonds' and d.active
              and (d.fin is null or d.fin > now())) then return null; end if;
  if v_offre = 'premium' then
    a := public._periode_etablissement(p_etab);
    return a.capacite;                                                            -- null : ancien abonnement ou attribution manuelle
  end if;
  if v_offre = 'decouverte' then return (select decouverte_max_eleves from public.config_commerciale where id); end if;
  return 0;
end $$;
revoke execute on function public._capacite_eleves(uuid) from public, anon, authenticated;

/** Contrôle verrouillé : aucune inscription au-delà de la capacité (deux ajouts simultanés ne la dépassent pas). */
create or replace function public._controle_capacite() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_cap int; v_n int; v_offre text;
begin
  if tg_op = 'UPDATE' and new.exercice_id = old.exercice_id and new.etablissement_id = old.etablissement_id then return new; end if;
  v_cap := public._capacite_eleves(new.etablissement_id);
  if v_cap is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('capacite:' || new.etablissement_id::text || ':' || new.exercice_id::text));
  select count(*) into v_n from public.inscriptions where etablissement_id = new.etablissement_id and exercice_id = new.exercice_id;
  if v_n >= v_cap then
    v_offre := public._offre_effective(new.etablissement_id);
    if v_offre = 'expiree' then
      raise exception 'Votre abonnement est arrivé à échéance : renouvelez-le pour inscrire de nouveaux élèves. Vos données restent consultables.'
        using errcode = 'P0001', hint = 'capacite';
    end if;
    raise exception 'Vous avez atteint la limite d''élèves autorisée par votre abonnement actuel (% élèves). Pour inscrire de nouveaux élèves, veuillez augmenter la capacité de votre abonnement.', v_cap
      using errcode = 'P0001', hint = 'capacite';
  end if;
  return new;
end $$;
revoke execute on function public._controle_capacite() from public, anon, authenticated;
drop trigger if exists capacite_inscriptions on public.inscriptions;
create trigger capacite_inscriptions before insert or update of exercice_id, etablissement_id on public.inscriptions
  for each row execute function public._controle_capacite();

-- les élèves sans inscription (prospects, anciens élèves) ne comptent plus : l'ancien plafond sur la table eleves est retiré
drop trigger if exists plafond_eleves on public.eleves;

/** Comptes du personnel : limite de la Découverte (et d'un établissement expiré) ; aucune limite en Premium. */
create or replace function public._controle_plafond() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_offre text := public._offre_effective(new.etablissement_id); v_max int; v_n int;
begin
  if tg_table_name <> 'personnels' or v_offre = 'premium' or public._offre_inclut(new.etablissement_id, 'plafonds') then return new; end if;
  v_max := (select decouverte_max_personnel from public.config_commerciale where id);
  perform pg_advisory_xact_lock(hashtext('plafond:personnels:' || new.etablissement_id::text));
  select count(*) into v_n from public.personnels where etablissement_id = new.etablissement_id;
  if v_n >= v_max then
    raise exception 'L''offre Découverte est limitée à % comptes du personnel. Passez à l''offre Premium pour en créer davantage.', v_max
      using errcode = 'P0001', hint = 'offre:premium';
  end if;
  return new;
end $$;

/** État de l'abonnement, pour tout membre du personnel de l'établissement (capacité, élèves inscrits, places restantes). */
create or replace function public.etat_abonnement() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); e public.etablissements; a public.abonnements_etablissement; c public.config_commerciale := public._config();
        v_cap int; v_actifs int; v_ex uuid; v_offre text;
begin
  if v_etab is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  select * into e from public.etablissements where id = v_etab;
  v_offre := public._offre_effective(v_etab);
  a := public._periode_etablissement(v_etab);
  v_cap := public._capacite_eleves(v_etab);
  select id into v_ex from public.exercices where etablissement_id = v_etab and actif;
  select count(*) into v_actifs from public.inscriptions where etablissement_id = v_etab and exercice_id = v_ex;
  return jsonb_build_object(
    'offre', v_offre, 'capacite', v_cap, 'eleves_actifs', v_actifs, 'places_restantes', case when v_cap is null then null else greatest(v_cap - v_actifs, 0) end,
    'expire_le', case when v_offre = 'premium' then e.offre_expire_le end, 'decouverte_fin', e.decouverte_fin,
    'ancien_abonnement', v_offre = 'premium' and a.id is null,
    'periode', case when a.id is not null then jsonb_build_object('id', a.id, 'debut', a.debut, 'fin', a.fin, 'capacite', a.capacite,
                                                                  'montant_paye', a.montant_paye, 'annee', a.annee) end,
    'grace', a.id is not null and now() >= a.fin,
    'renouvelable', v_offre <> 'premium' or e.offre_expire_le is null
                    or e.offre_expire_le - make_interval(days => c.etab_renouvellement_jours) <= now(),
    'renouvellement_programme', exists (select 1 from public.abonnements_etablissement x where x.etablissement_id = v_etab and x.debut > now()));
end $$;
revoke execute on function public.etat_abonnement() from public, anon;
grant execute on function public.etat_abonnement() to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 6. Paiements : produits (établissement, enseignant indépendant, crédits, groupe) sur la table existante
-- ---------------------------------------------------------------------------------------------------------
alter table public.paiements_abonnement alter column etablissement_id drop not null;
alter table public.paiements_abonnement add column if not exists produit text
  check (produit in ('etab_abonnement', 'etab_extension', 'se_abonnement', 'se_credits', 'se_groupe'));
alter table public.paiements_abonnement add column if not exists quantite integer check (quantite > 0);
alter table public.paiements_abonnement add column if not exists compte_id uuid references auth.users (id) on delete set null;
alter table public.paiements_abonnement add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.paiements_abonnement drop constraint if exists paiements_abonnement_offre_check;
alter table public.paiements_abonnement add constraint paiements_abonnement_offre_check
  check (offre in ('essentiel', 'pro', 'premium', 'smarteval', 'credits', 'groupe'));
alter table public.paiements_abonnement drop constraint if exists paiements_abonnement_periode_check;
alter table public.paiements_abonnement add constraint paiements_abonnement_periode_check check (periode in ('mensuel', 'annuel', 'aucune'));
alter table public.paiements_abonnement drop constraint if exists paiements_abonnement_proprietaire;
alter table public.paiements_abonnement add constraint paiements_abonnement_proprietaire check (num_nonnulls(etablissement_id, compte_id) = 1);
create index if not exists paiements_abonnement_compte on public.paiements_abonnement (compte_id, cree_le desc) where compte_id is not null;
drop policy if exists paiements_abonnement_compte on public.paiements_abonnement;
create policy paiements_abonnement_compte on public.paiements_abonnement for select to authenticated using (compte_id = (select auth.uid()));

/** Ancienne fonction de paiement par offre (Essentiel / Pro / Premium mensuel) : retirée. */
create or replace function public.paiement_preparer(p_offre text, p_periode text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  raise exception 'Les anciennes formules ne sont plus proposées : choisissez l''offre Premium au tarif de votre effectif.' using errcode = 'P0001';
end $$;

/** Limite anti-répétition : 10 demandes en attente par heure et par propriétaire. */
create or replace function public._paiement_limite(p_etab uuid, p_compte uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select count(*) from public.paiements_abonnement where statut = 'en_attente' and cree_le > now() - interval '1 hour'
        and ((p_etab is not null and etablissement_id = p_etab) or (p_compte is not null and compte_id = p_compte))) >= 10 then
    raise exception 'Trop de paiements en attente : réessayez dans quelques minutes.' using errcode = 'P0001';
  end if;
end $$;
revoke execute on function public._paiement_limite(uuid, uuid) from public, anon, authenticated;

/**
 * Prépare un paiement d'établissement (administrateur). Montant calculé ICI, jamais repris du navigateur.
 * p = { produit: 'etab_abonnement' | 'etab_extension', capacite }
 *  - etab_abonnement : souscription ou renouvellement (capacité conservée ou modifiée) ; 12 mois à compter du paiement,
 *    ou de l'échéance en cours si l'on renouvelle avant (aucun jour perdu) ;
 *  - etab_extension : augmentation de capacité de la période en cours : on paie la différence, l'échéance est conservée.
 */
create or replace function public._paiement_preparer_etablissement(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); c public.config_commerciale := public._config(); e public.etablissements; a public.abonnements_etablissement;
        v_cap int; v_montant int; v_id uuid; v_email text; v_libelle text; v_produit text := p ->> 'produit';
begin
  if v_etab is null or not public.est_admin() then
    raise exception 'Seul l''administrateur de l''établissement peut payer l''abonnement.' using errcode = '42501';
  end if;
  begin v_cap := (p ->> 'capacite')::int; exception when others then v_cap := null; end;
  if v_cap is null or v_cap < 1 or v_cap > c.etab_capacite_max then
    raise exception 'Effectif invalide : de 1 à % élèves.', c.etab_capacite_max using errcode = 'P0001';
  end if;
  perform public._paiement_limite(v_etab, null);
  select * into e from public.etablissements where id = v_etab;
  if v_produit = 'etab_abonnement' then
    if public._offre_effective(v_etab) = 'premium' and e.offre_expire_le is not null
       and e.offre_expire_le - make_interval(days => c.etab_renouvellement_jours) > now() then
      raise exception 'Votre abonnement est en cours jusqu''au % : le renouvellement sera possible % jours avant l''échéance. Pour inscrire plus d''élèves, augmentez la capacité.',
        to_char(e.offre_expire_le at time zone 'Africa/Douala', 'DD/MM/YYYY'), c.etab_renouvellement_jours using errcode = 'P0001';
    end if;
    if exists (select 1 from public.abonnements_etablissement x where x.etablissement_id = v_etab and x.debut > now()) then
      raise exception 'Un renouvellement est déjà payé et commencera à l''échéance actuelle.' using errcode = 'P0001';
    end if;
    v_montant := public._montant_etablissement(v_cap);
    v_libelle := format('NexIA School Premium — %s élèves — 12 mois', v_cap);
  elsif v_produit = 'etab_extension' then
    a := public._periode_etablissement(v_etab);
    if a.id is null or now() >= a.fin then
      raise exception 'Aucun abonnement Premium en cours : souscrivez d''abord (ou renouvelez) votre abonnement.' using errcode = 'P0001';
    end if;
    if v_cap <= a.capacite then
      raise exception 'La nouvelle capacité doit dépasser la capacité actuelle (% élèves). Une diminution se fait au renouvellement.', a.capacite using errcode = 'P0001';
    end if;
    v_montant := public._montant_etablissement(v_cap) - a.montant_paye;
    if v_montant <= 0 then
      -- le montant déjà payé (minimum annuel) couvre la nouvelle capacité : augmentation immédiate, sans paiement
      update public.abonnements_etablissement set capacite = v_cap where id = a.id;
      insert into public.abonnements_historique (etablissement_id, type, capacite_avant, capacite_apres, montant, debut, fin, details)
      values (v_etab, 'extension', a.capacite, v_cap, 0, a.debut, a.fin, jsonb_build_object('couvert_par_minimum', true));
      return jsonb_build_object('gratuit', true, 'capacite', v_cap);
    end if;
    v_libelle := format('NexIA School Premium — capacité portée de %s à %s élèves', a.capacite, v_cap);
  else
    raise exception 'Produit inconnu.' using errcode = 'P0001';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into public.paiements_abonnement (etablissement_id, offre, periode, montant, demande_par, produit, quantite, details)
  values (v_etab, 'premium', case when v_produit = 'etab_abonnement' then 'annuel' else 'aucune' end, v_montant, auth.uid(), v_produit, v_cap,
          jsonb_build_object('libelle', v_libelle, 'periode_id', a.id, 'capacite_avant', coalesce(a.capacite, public._capacite_eleves(v_etab))))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'montant', v_montant, 'devise', 'XAF', 'produit', v_produit, 'libelle', v_libelle,
                            'client', e.nom, 'email', coalesce(v_email, ''));
end $$;
revoke execute on function public._paiement_preparer_etablissement(jsonb) from public, anon, authenticated;

/** Point d'entrée unique de préparation d'un paiement (appelé par la fonction serveur « paiement » avec le jeton de l'utilisateur). */
create or replace function public.paiement_preparer_produit(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'Demande invalide.' using errcode = '22023'; end if;
  if coalesce(p ->> 'produit', '') like 'etab_%' then return public._paiement_preparer_etablissement(p); end if;
  if coalesce(p ->> 'produit', '') like 'se_%' then return public._paiement_preparer_enseignant(p); end if;
  raise exception 'Produit inconnu.' using errcode = 'P0001';
end $$;
revoke execute on function public.paiement_preparer_produit(jsonb) from public, anon;
grant execute on function public.paiement_preparer_produit(jsonb) to authenticated;

/** Activation d'un paiement d'établissement vérifié (appelée par _paiement_valider, verrou posé). Renvoie { debut, fin, ... }. */
create or replace function public._activer_etablissement(p public.paiements_abonnement) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c public.config_commerciale := public._config(); e public.etablissements; a public.abonnements_etablissement; v_debut timestamptz; v_fin timestamptz;
        v_cap int; v_avant int;
begin
  select * into e from public.etablissements where id = p.etablissement_id for update;
  if p.produit = 'etab_abonnement' then
    v_avant := public._capacite_eleves(e.id);
    -- renouvellement avant l'échéance : la nouvelle période commence à l'échéance (aucun jour perdu) ; sinon au paiement
    v_debut := case when public._offre_effective(e.id) = 'premium' and e.offre_expire_le is not null and e.offre_expire_le > now() then e.offre_expire_le else now() end;
    v_fin := v_debut + make_interval(months => c.etab_duree_mois);
    -- le minimum annuel couvre au moins (minimum / prix) élèves
    v_cap := greatest(p.quantite, floor(c.etab_minimum_annuel::numeric / c.etab_prix_eleve)::int);
    insert into public.abonnements_etablissement (etablissement_id, debut, fin, capacite, montant_paye, annee)
    values (e.id, v_debut, v_fin, v_cap, p.montant, public._annee_scolaire(v_debut));
    update public.etablissements set offre = 'premium', offre_periodicite = 'annuel', offre_expire_le = v_fin where id = e.id;
    insert into public.abonnements_historique (etablissement_id, type, capacite_avant, capacite_apres, montant, paiement_id, debut, fin)
    values (e.id, case when v_debut > now() or v_avant is not null and exists (select 1 from public.abonnements_etablissement x where x.etablissement_id = e.id and x.debut < v_debut)
                       then 'renouvellement' else 'souscription' end, v_avant, v_cap, p.montant, p.id, v_debut, v_fin);
    return jsonb_build_object('debut', v_debut, 'fin', v_fin, 'capacite', v_cap);
  end if;
  -- extension : période en cours (celle de la préparation, sinon la période en cours)
  select * into a from public.abonnements_etablissement where id = nullif(p.details ->> 'periode_id', '')::uuid and etablissement_id = e.id for update;
  if a.id is null then a := public._periode_etablissement(e.id); end if;
  if a.id is null then
    -- période échue entre-temps : le paiement reste acquis, la capacité est portée sur la prochaine souscription par l'administration
    insert into public.abonnements_historique (etablissement_id, type, capacite_apres, montant, paiement_id, details)
    values (e.id, 'extension', p.quantite, p.montant, p.id, jsonb_build_object('a_traiter', 'aucune période en cours à l''activation'));
    return jsonb_build_object('debut', now(), 'fin', now(), 'a_traiter', true);
  end if;
  update public.abonnements_etablissement set capacite = greatest(capacite, p.quantite), montant_paye = montant_paye + p.montant where id = a.id;
  insert into public.abonnements_historique (etablissement_id, type, capacite_avant, capacite_apres, montant, paiement_id, debut, fin)
  values (e.id, 'extension', a.capacite, greatest(a.capacite, p.quantite), p.montant, p.id, a.debut, a.fin);
  return jsonb_build_object('debut', a.debut, 'fin', a.fin, 'capacite', greatest(a.capacite, p.quantite));
end $$;
revoke execute on function public._activer_etablissement(public.paiements_abonnement) from public, anon, authenticated;

/**
 * Serveur : paiement confirmé par SasPay (montant et devise vérifiés par la fonction « paiement »). Idempotent : un deuxième
 * appel (webhook répété, retour du client) ne réactive rien. Anciens paiements (sans produit) : comportement d'origine.
 */
create or replace function public._paiement_valider(p_id uuid, p_transaction text, p_montant numeric) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare p public.paiements_abonnement; e public.etablissements; v_debut timestamptz; v_fin timestamptz; v_recu text; r jsonb;
begin
  select * into p from public.paiements_abonnement where id = p_id for update;
  if not found then raise exception 'Paiement introuvable.' using errcode = 'P0001'; end if;
  if p.statut = 'paye' then return jsonb_build_object('statut', 'paye', 'fin', p.fin, 'numero_recu', p.numero_recu, 'deja', true); end if;
  if p.statut <> 'en_attente' then raise exception 'Paiement déjà clos (%).', p.statut using errcode = 'P0001'; end if;
  if p_montant is null or p_montant < p.montant then
    raise exception 'Montant payé (%) inférieur au montant dû (%).', p_montant, p.montant using errcode = 'P0001';
  end if;
  v_recu := public._numero_recu(now());
  if p.produit is null then
    select * into e from public.etablissements where id = p.etablissement_id for update;
    v_debut := case when e.offre = p.offre and e.offre_expire_le is not null and e.offre_expire_le > now() then e.offre_expire_le else now() end;
    v_fin := v_debut + case p.periode when 'annuel' then interval '1 year' else interval '1 month' end;
    update public.etablissements set offre = p.offre, offre_periodicite = p.periode, offre_expire_le = v_fin where id = e.id;
    r := jsonb_build_object('debut', v_debut, 'fin', v_fin);
  elsif p.produit like 'etab_%' then
    r := public._activer_etablissement(p);
  else
    r := public._activer_enseignant(p);
  end if;
  update public.paiements_abonnement set statut = 'paye', paye_le = now(), transaction_id = p_transaction, numero_recu = v_recu,
         debut = (r ->> 'debut')::timestamptz, fin = (r ->> 'fin')::timestamptz where id = p.id;
  insert into public.journal_plateforme (auteur, action, cible, details)
  values (p.demande_par, 'paiement', coalesce((select nom from public.etablissements where id = p.etablissement_id), 'Enseignant indépendant'),
          jsonb_build_object('produit', coalesce(p.produit, p.offre), 'quantite', p.quantite, 'montant', p.montant, 'fin', r ->> 'fin', 'recu', v_recu));
  return r || jsonb_build_object('statut', 'paye', 'offre', p.offre, 'numero_recu', v_recu);
end $$;
revoke execute on function public._paiement_valider(uuid, text, numeric) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public._paiement_valider(uuid, text, numeric) to service_role;
  end if;
end $$;

/** Administrateur : état de l'abonnement, périodes, historique et derniers paiements (page Abonnement). */
create or replace function public.mon_abonnement() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant();
begin
  if v_etab is null or not public.est_admin() then raise exception 'Réservé à l''administrateur de l''établissement.' using errcode = '42501'; end if;
  return public.etat_abonnement() || jsonb_build_object(
    'tarifs', public.offres_publiques(),
    'periodes', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'debut', a.debut, 'fin', a.fin, 'capacite', a.capacite, 'montant_paye', a.montant_paye,
        'annee', a.annee) order by a.debut desc) from public.abonnements_etablissement a where a.etablissement_id = v_etab), '[]'::jsonb),
    'historique', coalesce((select jsonb_agg(jsonb_build_object('type', h.type, 'capacite_avant', h.capacite_avant, 'capacite_apres', h.capacite_apres,
        'montant', h.montant, 'le', h.le, 'fin', h.fin) order by h.le desc) from (select * from public.abonnements_historique where etablissement_id = v_etab
        order by le desc limit 50) h), '[]'::jsonb),
    'paiements', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'offre', p.offre, 'produit', p.produit, 'quantite', p.quantite,
        'libelle', p.details ->> 'libelle', 'periode', p.periode, 'montant', p.montant, 'statut', p.statut, 'cree_le', p.cree_le, 'paye_le', p.paye_le,
        'fin', p.fin, 'numero_recu', p.numero_recu) order by p.cree_le desc)
      from (select * from public.paiements_abonnement where etablissement_id = v_etab order by cree_le desc limit 30) p), '[]'::jsonb));
end $$;

/** Paiements de la personne connectée (établissement administré ou compte enseignant) : identifiants à revérifier. */
create or replace function public.mes_paiements() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'statut', p.statut, 'paye_le', p.paye_le) order by p.cree_le desc), '[]'::jsonb)
    from (select * from public.paiements_abonnement x
           where (x.compte_id = auth.uid()) or (public.est_admin() and x.etablissement_id = public.etab_courant())
           order by x.cree_le desc limit 30) p
$$;
revoke execute on function public.mes_paiements() from public, anon;
grant execute on function public.mes_paiements() to authenticated;

/** Contenu du reçu : établissement ou enseignant indépendant. */
create or replace function public._recu_contenu(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'numero', p.numero_recu, 'code', p.code_verif, 'date', p.paye_le, 'offre', p.offre, 'produit', p.produit, 'libelle', p.details ->> 'libelle',
    'quantite', p.quantite, 'periode', p.periode, 'montant', p.montant, 'devise', p.devise,
    'debut', p.debut, 'fin', p.fin, 'transaction', p.transaction_id, 'fournisseur', p.fournisseur,
    'etablissement', case when e.id is not null then jsonb_build_object('nom', e.nom, 'ville', e.ville, 'adresse', e.adresse, 'telephone', e.telephone)
                          else jsonb_build_object('nom', coalesce(nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), ''), u.email, 'Enseignant'),
                                                  'ville', '', 'adresse', coalesce(u.email, ''), 'telephone', '') end)
  from public.paiements_abonnement p left join public.etablissements e on e.id = p.etablissement_id left join auth.users u on u.id = p.compte_id
  where p.id = p_id and p.statut = 'paye' and p.numero_recu is not null
$$;

/** Reçu d'un paiement : administrateur de l'établissement ou titulaire du compte enseignant. */
create or replace function public.recu_paiement(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  if not exists (select 1 from public.paiements_abonnement where id = p_id
                  and (compte_id = auth.uid() or (public.est_admin() and etablissement_id = public.etab_courant()))) then
    raise exception 'Paiement introuvable.' using errcode = 'P0001';
  end if;
  r := public._recu_contenu(p_id);
  if r is null then raise exception 'Aucun reçu : ce paiement n''est pas validé.' using errcode = 'P0001'; end if;
  return r;
end $$;

create or replace function public.verifier_recu(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('numero', p.numero_recu, 'date', p.paye_le, 'offre', p.offre, 'libelle', p.details ->> 'libelle', 'periode', p.periode,
           'montant', p.montant, 'devise', p.devise, 'debut', p.debut, 'fin', p.fin,
           'etablissement', coalesce(e.nom, 'Enseignant indépendant'), 'ville', coalesce(e.ville, ''))
  from public.paiements_abonnement p left join public.etablissements e on e.id = p.etablissement_id
  where p.code_verif = upper(btrim(coalesce(p_code, ''))) and p.statut = 'paye' and length(btrim(coalesce(p_code, ''))) = 20
$$;

-- Rappels de fin d'abonnement : établissements Premium (anciens et nouveaux abonnements)
create or replace function public._rappels_a_envoyer() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('etablissement_id', e.id, 'etablissement', e.nom, 'offre', 'premium', 'echeance', e.offre_expire_le,
           'jours', public._jours_restants(e.offre_expire_le), 'emails', a.emails)), '[]'::jsonb)
  from public.etablissements e
  join lateral (select array_agg(distinct u.email) emails from public.personnels pe join auth.users u on u.id = pe.id
                 where pe.etablissement_id = e.id and pe.role = 'admin' and pe.actif and u.email is not null and u.email not like '%.invalid') a on a.emails is not null
  where e.offre <> 'decouverte' and e.offre_expire_le is not null and e.offre_expire_le > now()
    and public._jours_restants(e.offre_expire_le) between 0 and 5
    and not exists (select 1 from public.abonnements_etablissement x where x.etablissement_id = e.id and x.debut >= e.offre_expire_le)
    and not exists (select 1 from public.rappels_abonnement r where r.etablissement_id = e.id and r.echeance = e.offre_expire_le
                     and r.jours = public._jours_restants(e.offre_expire_le))
$$;

/** Console : attribution manuelle d'une formule (ancien fonctionnement conservé) + capacité éventuelle. */
create or replace function public.console_definir_offre(p_id uuid, p_offre text, p_periodicite text, p_expire_le timestamptz)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_nom text;
begin
  perform public._exiger_proprietaire();
  if p_offre not in ('decouverte', 'premium') then raise exception 'Formule inconnue (decouverte ou premium).' using errcode = 'P0001'; end if;
  update public.etablissements set offre = p_offre, offre_periodicite = coalesce(nullif(p_periodicite, ''), 'annuel'),
         offre_expire_le = case when p_offre = 'decouverte' then null else p_expire_le end
   where id = p_id returning nom into v_nom;
  if v_nom is null then raise exception 'Établissement introuvable.' using errcode = 'P0001'; end if;
  insert into public.abonnements_historique (etablissement_id, type, fin, details) values (p_id, 'console', p_expire_le, jsonb_build_object('offre', p_offre));
  perform public._journal_plateforme('offre', v_nom, json_build_object('offre', p_offre, 'expire_le', p_expire_le)::jsonb);
end $$;

-- Anciens abonnements : trace de la transition dans l'historique (aucun paiement, aucune donnée modifiée)
insert into public.abonnements_historique (etablissement_id, type, fin, details)
select e.id, 'migration', e.offre_expire_le, jsonb_build_object('ancienne_offre', e.offre, 'periodicite', e.offre_periodicite,
  'regle', 'Premium (toutes fonctionnalités, effectif illimité) jusqu''à l''échéance déjà payée')
  from public.etablissements e where e.offre in ('essentiel', 'pro', 'premium')
   and not exists (select 1 from public.abonnements_historique h where h.etablissement_id = e.id and h.type = 'migration');

-- anciennes formules ramenées à Premium (mêmes droits qu'avant ou davantage ; échéances conservées)
update public.etablissements set offre = 'premium' where offre in ('essentiel', 'pro');

/** Droits effectifs lus par l'application : ajoute l'offre en vigueur calculée par le serveur (délai de grâce compris). */
create or replace function public.mes_fonctions() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(f, public._offre_inclut(public.etab_courant(), f)), '{}'::jsonb)
           || jsonb_build_object('__offre', public._offre_effective(public.etab_courant()),
                                 '__offertes', coalesce((
                select jsonb_agg(jsonb_build_object('fonction', d.fonction, 'fin', d.fin) order by d.fonction)
                  from public.fonctions_etablissement d
                 where d.etablissement_id = public.etab_courant() and d.active and (d.fin is null or d.fin > now())
                   and public._rang_offre(public._offre_effective(d.etablissement_id)) < public._rang_offre(public.offre_requise(d.fonction))), '[]'::jsonb))
    from unnest(public._fonctions_reglables()) f
$$;
