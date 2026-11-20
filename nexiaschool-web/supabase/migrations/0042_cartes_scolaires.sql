-- Cartes scolaires : modèle et contenu configurables, cachet et signature numériques du chef d'établissement,
-- émission par lot (code de vérification par carte), suspension, révocation, régénération, vérification publique.
--
-- Politique de sécurité des cachets et signatures :
--  * Stockage : compartiment privé « signatures », un dossier par établissement ; fichiers jamais remplacés
--    (chaque import crée un nouveau fichier, l'ancien est conservé pour l'historique) ; aucun accès public.
--  * Accès restreint : lecture, import et révocation réservés à l'administration de l'établissement (ni enseignants,
--    ni surveillants, ni comptables, ni parents) ; l'application les lit par adresses temporaires.
--  * Journalisation : import, remplacement, révocation, chaque émission de cartes (qui, quand, combien).
--  * Réutilisation abusive : chaque carte enregistre le cachet et la signature utilisés ; sur la carte, ils sont
--    recouverts d'un filigrane portant le code de la carte (une copie découpée reste rattachée à sa carte) ;
--    la vérification par QR code signale toute carte signée avec une signature révoquée.
--  * Révocation : une signature ou un cachet révoqué n'est plus utilisé ; les cartes qui le portent apparaissent
--    « signature révoquée » à la vérification jusqu'à leur régénération.

-- ---------------------------------------------------------------------------------------------------------
-- Fonctionnalité réglable par établissement (comprise dans toutes les offres)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._fonctions_reglables() returns text[]
language sql immutable set search_path = '' as $$
  select array['notes', 'appel', 'bulletins', 'excel_base', 'plafonds',
               'discipline', 'finances', 'decisions', 'qr', 'excel', 'smarteval', 'edt', 'parents', 'statistiques', 'ia',
               'distinctions', 'cartes']
$$;

create or replace function public.offre_requise(p_fonction text) returns text
language sql immutable set search_path = '' as $$
  select case p_fonction
    when 'notes'      then 'decouverte'
    when 'appel'      then 'decouverte'
    when 'bulletins'  then 'decouverte'
    when 'excel_base' then 'decouverte'
    when 'plafonds'   then 'pro'           -- effectifs illimités (élèves et personnel)
    when 'discipline' then 'essentiel'
    when 'finances'   then 'essentiel'
    when 'decisions'  then 'essentiel'
    when 'qr'         then 'essentiel'
    when 'excel'      then 'essentiel'
    when 'smarteval'  then 'pro'
    when 'edt'        then 'pro'
    when 'parents'    then 'pro'
    when 'statistiques' then 'pro'
    when 'ia'         then 'premium'
    when 'distinctions' then 'decouverte'  -- récompenses et distinctions : toutes les offres
    when 'cartes'     then 'decouverte'    -- cartes scolaires : toutes les offres
    else 'premium' end
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Compartiment privé des cachets et signatures (PNG uniquement : tout import est converti dans le navigateur)
-- ---------------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('signatures', 'signatures', false, 524288, array['image/png'])
on conflict (id) do update set public = false, file_size_limit = 524288, allowed_mime_types = array['image/png'];

create policy "signatures : lecture par l'administration" on storage.objects for select to authenticated
  using (bucket_id = 'signatures' and (storage.foldername(name))[1] = (select public.etab_courant())::text and (select public.est_admin()));
create policy "signatures : ajout par l'administration" on storage.objects for insert to authenticated
  with check (bucket_id = 'signatures' and (storage.foldername(name))[1] = (select public.etab_courant())::text and (select public.est_admin()));
-- ni remplacement ni suppression : l'historique des cachets et signatures est conservé

-- ---------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.cartes_config (
  etablissement_id uuid primary key default public.etab_courant() references public.etablissements (id) on delete cascade,
  modele text not null default 'classique' check (modele in ('classique', 'minimaliste', 'premium', 'academique', 'dynamique')),
  couleur text not null default '#1F3A68' check (couleur ~ '^#[0-9a-fA-F]{6}$'),
  couleur2 text not null default '#C9A227' check (couleur2 ~ '^#[0-9a-fA-F]{6}$'),
  champs jsonb not null default '{}'::jsonb check (jsonb_typeof(champs) = 'object'),     -- éléments affichés (true / false)
  textes jsonb not null default '{}'::jsonb check (jsonb_typeof(textes) = 'object' and pg_column_size(textes) < 4000),
  expire_le date,                                                                         -- vide : fin de l'année scolaire
  verification_paiement boolean not null default false,  -- le QR code indique aussi « à jour de pension » (contrôle d'accès)
  maj timestamptz not null default now(),
  maj_par uuid
);
alter table public.cartes_config enable row level security;
create policy "administration" on public.cartes_config for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));

create table if not exists public.signatures_etablissement (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  type text not null check (type in ('cachet', 'signature')),
  chemin text not null,
  empreinte text not null check (empreinte ~ '^[0-9a-f]{64}$'),
  statut text not null default 'active' check (statut in ('active', 'remplacee', 'revoquee')),
  ajoute_par uuid, ajoute_le timestamptz not null default now(),
  revoque_par uuid, revoque_le timestamptz,
  motif text not null default '' check (char_length(motif) <= 300),
  check (chemin ~ ('^' || etablissement_id::text || '/(cachet|signature)-[0-9]+\.png$')),
  unique (id, etablissement_id)
);
create unique index if not exists signatures_une_active on public.signatures_etablissement (etablissement_id, type) where statut = 'active';
alter table public.signatures_etablissement enable row level security;
create policy "administration" on public.signatures_etablissement for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));

create table if not exists public.cartes_scolaires (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null,
  inscription_id uuid not null,
  eleve_id uuid not null,
  exercice_id uuid not null,
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{12}$'),
  version smallint not null default 1,
  statut text not null default 'active' check (statut in ('active', 'suspendue', 'revoquee', 'remplacee')),
  empreinte text not null check (empreinte ~ '^[0-9a-f]{64}$'),           -- contenu imprimé (nom, classe, photo…)
  eleve text not null,
  classe text not null default '',
  cachet_id uuid references public.signatures_etablissement (id),
  signature_id uuid references public.signatures_etablissement (id),
  emise_le timestamptz not null default now(),
  emise_par uuid,
  expire_le date not null,
  statut_le timestamptz,
  motif text not null default '' check (char_length(motif) <= 300),
  foreign key (inscription_id, etablissement_id) references public.inscriptions (id, etablissement_id) on delete cascade,
  foreign key (eleve_id, etablissement_id) references public.eleves (id, etablissement_id) on delete cascade,
  foreign key (exercice_id, etablissement_id) references public.exercices (id, etablissement_id) on delete cascade
);
create unique index if not exists cartes_une_en_cours on public.cartes_scolaires (inscription_id) where statut in ('active', 'suspendue');
create index if not exists cartes_etab on public.cartes_scolaires (etablissement_id);
alter table public.cartes_scolaires enable row level security;
create policy "administration" on public.cartes_scolaires for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));

create table if not exists public.cartes_journal (
  id bigint generated always as identity primary key,
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  carte_id uuid,
  action text not null,
  motif text not null default '',
  details jsonb not null default '{}'::jsonb,
  par uuid,
  le timestamptz not null default now()
);
create index if not exists cartes_journal_etab on public.cartes_journal (etablissement_id, le desc);
alter table public.cartes_journal enable row level security;
create policy "administration" on public.cartes_journal for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.est_admin()));

revoke all on public.cartes_config, public.signatures_etablissement, public.cartes_scolaires, public.cartes_journal from anon, authenticated;
grant select on public.cartes_config, public.signatures_etablissement, public.cartes_scolaires, public.cartes_journal to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Fonctions
-- ---------------------------------------------------------------------------------------------------------
create or replace function public._cartes_admin() returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._exiger_admin();
begin
  perform public._exiger_offre(v_etab, 'cartes');
  return v_etab;
end $$;

create or replace function public._cartes_journaliser(p_etab uuid, p_carte uuid, p_action text, p_motif text, p_details jsonb)
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.cartes_journal (etablissement_id, carte_id, action, motif, details, par)
  values (p_etab, p_carte, p_action, coalesce(p_motif, ''), coalesce(p_details, '{}'::jsonb), auth.uid())
$$;

/** p = { modele, couleur, couleur2, champs, textes, expire_le, verification_paiement } */
create or replace function public.cartes_config_enregistrer(p jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._cartes_admin();
begin
  insert into public.cartes_config (etablissement_id, modele, couleur, couleur2, champs, textes, expire_le, verification_paiement, maj, maj_par)
  values (v_etab, coalesce(p->>'modele', 'classique'), coalesce(p->>'couleur', '#1F3A68'), coalesce(p->>'couleur2', '#C9A227'),
          coalesce(p->'champs', '{}'::jsonb), coalesce(p->'textes', '{}'::jsonb), nullif(p->>'expire_le', '')::date,
          coalesce((p->>'verification_paiement')::boolean, false), now(), auth.uid())
  on conflict (etablissement_id) do update set modele = excluded.modele, couleur = excluded.couleur, couleur2 = excluded.couleur2,
    champs = excluded.champs, textes = excluded.textes, expire_le = excluded.expire_le, verification_paiement = excluded.verification_paiement,
    maj = now(), maj_par = auth.uid();
  perform public._cartes_journaliser(v_etab, null, 'configuration', '', jsonb_build_object('modele', p->>'modele'));
exception
  when check_violation then raise exception 'Réglage refusé : vérifiez le modèle et les couleurs (format #RRGGBB).' using errcode = 'P0001';
  when invalid_datetime_format or datetime_field_overflow then raise exception 'Date d''expiration invalide.' using errcode = 'P0001';
end $$;

/** Enregistre un cachet ou une signature déjà déposé dans le compartiment privé ; l'ancien est remplacé (conservé). */
create or replace function public.signature_enregistrer(p_type text, p_chemin text, p_empreinte text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._cartes_admin(); v_id uuid; ancien uuid;
begin
  if p_type not in ('cachet', 'signature') then raise exception 'Type inconnu.' using errcode = 'P0001'; end if;
  if p_chemin !~ ('^' || v_etab::text || '/' || p_type || '-[0-9]+\.png$') then raise exception 'Fichier refusé.' using errcode = 'P0001'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'signatures' and name = p_chemin) then
    raise exception 'Image introuvable : recommencez l''import.' using errcode = 'P0001'; end if;
  update public.signatures_etablissement set statut = 'remplacee' where etablissement_id = v_etab and type = p_type and statut = 'active'
    returning id into ancien;
  insert into public.signatures_etablissement (etablissement_id, type, chemin, empreinte, ajoute_par)
  values (v_etab, p_type, p_chemin, lower(p_empreinte), auth.uid()) returning id into v_id;
  perform public._cartes_journaliser(v_etab, null, p_type || '_importe', '', jsonb_build_object('id', v_id, 'remplace', ancien));
  return jsonb_build_object('id', v_id);
exception when check_violation then raise exception 'Empreinte de l''image invalide.' using errcode = 'P0001';
end $$;

/** Révoque un cachet ou une signature (vol, départ du chef d'établissement…) : il n'est plus utilisé, les cartes qui le portent sont signalées. */
create or replace function public.signature_revoquer(p_id uuid, p_motif text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._cartes_admin(); s public.signatures_etablissement;
begin
  if char_length(btrim(coalesce(p_motif, ''))) < 3 then raise exception 'Indiquez le motif de la révocation.' using errcode = 'P0001'; end if;
  update public.signatures_etablissement set statut = 'revoquee', revoque_par = auth.uid(), revoque_le = now(), motif = left(btrim(p_motif), 300)
   where id = p_id and etablissement_id = v_etab and statut <> 'revoquee' returning * into s;
  if s.id is null then raise exception 'Cachet ou signature introuvable (ou déjà révoqué).' using errcode = 'P0001'; end if;
  perform public._cartes_journaliser(v_etab, null, s.type || '_revoque', btrim(p_motif), jsonb_build_object('id', s.id,
    'cartes_concernees', (select count(*) from public.cartes_scolaires where (cachet_id = s.id or signature_id = s.id) and statut in ('active', 'suspendue'))));
end $$;

/**
 * Émet les cartes de l'exercice actif. p_cartes = [{ inscription_id, empreinte }] (empreinte : contenu imprimé).
 * Une carte en cours est réutilisée si rien n'a changé (contenu, cachet, signature) ; sinon (ou si p_forcer) elle est
 * remplacée par une nouvelle version, l'ancienne devenant « remplacée ». Une carte suspendue n'est pas réimprimée.
 * Renvoie [{ inscription_id, code, version, expire_le, statut, nouvelle }].
 */
create or replace function public.cartes_emettre(p_cartes jsonb, p_forcer boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._cartes_admin(); ex public.exercices; cachet uuid; sig uuid; fin date; x jsonb; i record; c public.cartes_scolaires;
        resultat jsonb := '[]'::jsonb; nouvelles int := 0; reprises int := 0; essais int; v_code text;
begin
  select * into ex from public.exercices where etablissement_id = v_etab and actif;
  if ex.id is null then raise exception 'Activez d''abord un exercice.' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_cartes, '[]'::jsonb)) <> 'array' or jsonb_array_length(p_cartes) > 3000 then
    raise exception 'Liste invalide (3000 cartes au plus par envoi).' using errcode = 'P0001'; end if;
  select id into cachet from public.signatures_etablissement where etablissement_id = v_etab and type = 'cachet' and statut = 'active';
  select id into sig from public.signatures_etablissement where etablissement_id = v_etab and type = 'signature' and statut = 'active';
  select coalesce(cc.expire_le, make_date(split_part(ex.libelle, '-', 2)::int, 8, 31)) into fin
    from (select 1) z left join public.cartes_config cc on cc.etablissement_id = v_etab;
  for x in select * from jsonb_array_elements(p_cartes) loop
    if coalesce(x->>'empreinte', '') !~ '^[0-9a-f]{64}$' then raise exception 'Empreinte de carte invalide.' using errcode = 'P0001'; end if;
    select ins.id, ins.eleve_id, c2.libelle classe, btrim(el.nom || ' ' || el.prenom) eleve into i
      from public.inscriptions ins join public.eleves el on el.id = ins.eleve_id join public.classes c2 on c2.id = ins.classe_id
     where ins.id = nullif(x->>'inscription_id', '')::uuid and ins.etablissement_id = v_etab and ins.exercice_id = ex.id;
    continue when i.id is null;
    select * into c from public.cartes_scolaires where inscription_id = i.id and statut in ('active', 'suspendue') for update;
    if c.id is not null and c.statut = 'suspendue' and not coalesce(p_forcer, false) then
      resultat := resultat || jsonb_build_object('inscription_id', i.id, 'code', c.code, 'version', c.version, 'expire_le', c.expire_le, 'statut', 'suspendue', 'nouvelle', false);
      continue;
    end if;
    if c.id is not null and not coalesce(p_forcer, false) and c.empreinte = x->>'empreinte' and c.cachet_id is not distinct from cachet
       and c.signature_id is not distinct from sig and c.expire_le = fin then
      resultat := resultat || jsonb_build_object('inscription_id', i.id, 'code', c.code, 'version', c.version, 'expire_le', c.expire_le, 'statut', 'active', 'nouvelle', false);
      reprises := reprises + 1;
      continue;
    end if;
    if c.id is not null then
      update public.cartes_scolaires set statut = 'remplacee', statut_le = now(), motif = 'Régénération' where id = c.id;
    end if;
    essais := 0;
    loop
      begin
        v_code := public._code_bulletin();
        insert into public.cartes_scolaires (etablissement_id, inscription_id, eleve_id, exercice_id, code, version, empreinte, eleve, classe,
                                             cachet_id, signature_id, emise_par, expire_le)
        values (v_etab, i.id, i.eleve_id, ex.id, v_code, coalesce(c.version, 0) + 1, x->>'empreinte', i.eleve, i.classe, cachet, sig, auth.uid(), fin);
        exit;
      exception when unique_violation then essais := essais + 1; if essais > 5 then raise; end if;
      end;
    end loop;
    resultat := resultat || jsonb_build_object('inscription_id', i.id, 'code', v_code, 'version', coalesce(c.version, 0) + 1, 'expire_le', fin, 'statut', 'active', 'nouvelle', true);
    nouvelles := nouvelles + 1;
  end loop;
  perform public._cartes_journaliser(v_etab, null, 'emission', '', jsonb_build_object('nouvelles', nouvelles, 'reimprimees', reprises,
    'forcee', coalesce(p_forcer, false), 'cachet', cachet, 'signature', sig));
  return resultat;
end $$;

/** Suspendre (réversible), réactiver ou révoquer (définitif) une carte ; motif obligatoire pour suspendre ou révoquer. */
create or replace function public.carte_changer_statut(p_carte uuid, p_statut text, p_motif text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_etab uuid := public._cartes_admin(); c public.cartes_scolaires;
begin
  select * into c from public.cartes_scolaires where id = p_carte and etablissement_id = v_etab for update;
  if c.id is null then raise exception 'Carte introuvable.' using errcode = 'P0001'; end if;
  if c.statut in ('revoquee', 'remplacee') then raise exception 'Cette carte n''est plus en circulation : régénérez une nouvelle carte.' using errcode = 'P0001'; end if;
  if p_statut not in ('active', 'suspendue', 'revoquee') then raise exception 'Statut inconnu.' using errcode = 'P0001'; end if;
  if p_statut <> 'active' and char_length(btrim(coalesce(p_motif, ''))) < 3 then raise exception 'Indiquez le motif.' using errcode = 'P0001'; end if;
  update public.cartes_scolaires set statut = p_statut, statut_le = now(), motif = left(btrim(coalesce(p_motif, '')), 300) where id = c.id;
  perform public._cartes_journaliser(v_etab, c.id, case p_statut when 'active' then 'reactivation' when 'suspendue' then 'suspension' else 'revocation' end,
    btrim(coalesce(p_motif, '')), jsonb_build_object('eleve', c.eleve, 'code', c.code));
end $$;

/** Élève en règle de pension à ce jour (même règle que les Finances : montants échus couverts par les paiements) ; null si les frais ne sont pas configurés. */
create or replace function public._en_regle(p_inscription uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with i as (select ins.id, ins.exercice_id, case when ins.nouveau then f.pension_nouveaux else f.pension_anciens end pension
               from public.inscriptions ins join public.frais_scolarite f on f.exercice_id = ins.exercice_id where ins.id = p_inscription),
       tot as (select sum(e.montant) t from public.echeances e join i on e.exercice_id = i.exercice_id),
       du as (select coalesce(sum(e.montant + case when e.rang = 0 then i.pension - tot.t else 0 end), 0) d
                from public.echeances e join i on e.exercice_id = i.exercice_id cross join tot
               where e.date_limite < (now() at time zone 'Africa/Douala')::date),
       paye as (select coalesce(sum(p.montant), 0) p from public.paiements p where p.inscription_id = p_inscription)
  select case when (select count(*) from i) = 0 then null else (select p from paye) >= (select d from du) end
$$;

/**
 * Vérification publique (QR code) : aucune donnée sensible (ni matricule, ni date de naissance, ni photo, ni montant).
 * statut : valide | suspendue | revoquee | remplacee | expiree | non_inscrit | signature_revoquee
 */
create or replace function public.verifier_carte(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.cartes_scolaires; e public.etablissements; inscrit boolean; sig_rev boolean; st text; cfg public.cartes_config;
begin
  select * into c from public.cartes_scolaires where code = upper(btrim(coalesce(p_code, '')));
  if c.id is null then return null; end if;
  select * into e from public.etablissements where id = c.etablissement_id;
  select * into cfg from public.cartes_config where etablissement_id = c.etablissement_id;
  inscrit := exists (select 1 from public.inscriptions ins join public.exercices x on x.id = ins.exercice_id and x.actif where ins.eleve_id = c.eleve_id);
  sig_rev := exists (select 1 from public.signatures_etablissement s where s.id in (c.cachet_id, c.signature_id) and s.statut = 'revoquee');
  st := case when c.statut <> 'active' then c.statut
             when c.expire_le < (now() at time zone 'Africa/Douala')::date then 'expiree'
             when not inscrit then 'non_inscrit'
             when sig_rev then 'signature_revoquee'
             else 'valide' end;
  return jsonb_build_object(
    'etablissement', jsonb_build_object('nom', e.nom, 'ville', e.ville, 'telephone', e.telephone, 'site_web', e.site_web, 'actif', e.suspendu_le is null),
    'carte', jsonb_build_object('eleve', c.eleve, 'classe', c.classe, 'annee', (select libelle from public.exercices where id = c.exercice_id),
      'version', c.version, 'emise_le', c.emise_le, 'expire_le', c.expire_le, 'statut', st, 'statut_le', c.statut_le,
      'paiement', case when st = 'valide' and coalesce(cfg.verification_paiement, false)
                       then case public._en_regle(c.inscription_id) when true then 'a_jour' when false then 'non_en_regle' end end));
end $$;

revoke execute on function public._cartes_admin(), public._cartes_journaliser(uuid, uuid, text, text, jsonb), public._en_regle(uuid) from public, anon, authenticated;
revoke execute on function public.cartes_config_enregistrer(jsonb), public.signature_enregistrer(text, text, text), public.signature_revoquer(uuid, text),
  public.cartes_emettre(jsonb, boolean), public.carte_changer_statut(uuid, text, text) from public, anon;
grant execute on function public.cartes_config_enregistrer(jsonb), public.signature_enregistrer(text, text, text), public.signature_revoquer(uuid, text),
  public.cartes_emettre(jsonb, boolean), public.carte_changer_statut(uuid, text, text) to authenticated;
grant execute on function public.verifier_carte(text) to anon, authenticated;
