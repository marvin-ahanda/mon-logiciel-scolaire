-- Bulletins : QR code anti-fraude propre à chaque bulletin.
-- Chaque bulletin affiché ou imprimé est enregistré avec un code aléatoire (12 caractères, ~60 bits) et les
-- résultats qu'il porte. Le QR code mène à /verifier/<code> : toute personne qui le scanne voit l'établissement
-- émetteur et les résultats enregistrés, et peut les comparer avec le papier.
-- Un même bulletin (même élève, même période, même contenu) garde son code ; si les notes changent, un nouveau
-- code est créé et l'ancien reste valable pour la version imprimée auparavant.

create table if not exists public.bulletins_emis (
  code text primary key check (code ~ '^[A-HJ-NP-Z2-9]{12}$'),
  etablissement_id uuid not null references public.etablissements (id) on delete cascade,
  inscription_id uuid not null references public.inscriptions (id) on delete cascade,
  periode text not null check (periode ~ '^(s[1-6]|t[1-3]|a)$'),
  periode_libelle text not null check (char_length(periode_libelle) between 1 and 60),
  empreinte text not null check (empreinte ~ '^[0-9a-f]{64}$'),
  eleve text not null,
  matricule text not null default '',
  classe text not null,
  annee text not null,
  moyenne numeric(5, 2) check (moyenne between 0 and 20),
  rang smallint check (rang > 0),
  classes smallint check (classes >= 0),
  effectif smallint check (effectif >= 0),
  appreciation text not null default '' check (char_length(appreciation) <= 60),
  emis_le timestamptz not null default now(),
  emis_par uuid references auth.users (id) on delete set null,
  unique (inscription_id, periode, empreinte)
);
create index if not exists bulletins_emis_etab on public.bulletins_emis (etablissement_id);
-- Aucune règle d'accès direct : lecture et écriture passent uniquement par les fonctions ci-dessous.
alter table public.bulletins_emis enable row level security;

create or replace function public._code_bulletin() returns text
language sql volatile set search_path = '' as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 32) + 1, 1), '' order by i)
    from (select extensions.gen_random_bytes(12) as b) x, generate_series(0, 11) as i
$$;

/**
 * p = { periode: "t1", periode_libelle: "Trimestre 1",
 *       bulletins: [{ inscription_id, empreinte, moyenne, rang, classes, effectif, appreciation }] }
 * Renvoie { "<inscription_id>": "<code>" }. Réservé au personnel actif ; seulement les élèves de son établissement.
 */
create or replace function public.emettre_bulletins(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_etab uuid := public.etab_courant();
  v_periode text := p ->> 'periode';
  v_libelle text := left(btrim(coalesce(p ->> 'periode_libelle', '')), 60);
  v_resultat jsonb := '{}'::jsonb;
  b jsonb;
  v_ins record;
  v_code text;
begin
  if v_etab is null then raise exception 'Accès refusé.' using errcode = '42501'; end if;
  if v_periode is null or v_periode !~ '^(s[1-6]|t[1-3]|a)$' then raise exception 'Période invalide.' using errcode = '22023'; end if;
  if v_libelle = '' then v_libelle := v_periode; end if;
  if jsonb_typeof(p -> 'bulletins') <> 'array' or jsonb_array_length(p -> 'bulletins') > 300 then
    raise exception 'Liste de bulletins invalide (300 au plus).' using errcode = '22023';
  end if;
  for b in select * from jsonb_array_elements(p -> 'bulletins') loop
    select i.id, btrim(e.nom || ' ' || coalesce(e.prenom, '')) as eleve, coalesce(e.matricule, '') as matricule,
           c.libelle as classe, x.libelle as annee
      into v_ins
      from public.inscriptions i
      join public.eleves e on e.id = i.eleve_id
      join public.classes c on c.id = i.classe_id
      join public.exercices x on x.id = i.exercice_id
     where i.id = (b ->> 'inscription_id')::uuid and i.etablissement_id = v_etab;
    if v_ins.id is null then continue; end if;
    if coalesce(b ->> 'empreinte', '') !~ '^[0-9a-f]{64}$' then continue; end if;
    select code into v_code from public.bulletins_emis
     where inscription_id = v_ins.id and periode = v_periode and empreinte = b ->> 'empreinte';
    if v_code is null then
      loop
        v_code := public._code_bulletin();
        begin
          insert into public.bulletins_emis (code, etablissement_id, inscription_id, periode, periode_libelle, empreinte,
                                             eleve, matricule, classe, annee, moyenne, rang, classes, effectif, appreciation, emis_par)
          values (v_code, v_etab, v_ins.id, v_periode, v_libelle, b ->> 'empreinte', v_ins.eleve, v_ins.matricule, v_ins.classe, v_ins.annee,
                  (b ->> 'moyenne')::numeric, nullif(b ->> 'rang', '')::smallint, nullif(b ->> 'classes', '')::smallint,
                  nullif(b ->> 'effectif', '')::smallint, left(coalesce(b ->> 'appreciation', ''), 60), auth.uid())
          on conflict (inscription_id, periode, empreinte) do nothing;
          exit;
        exception when unique_violation then null;    -- code déjà pris (très improbable) : on en tire un autre
        end;
      end loop;
      select code into v_code from public.bulletins_emis
       where inscription_id = v_ins.id and periode = v_periode and empreinte = b ->> 'empreinte';
    end if;
    v_resultat := v_resultat || jsonb_build_object(v_ins.id::text, v_code);
    v_code := null;
  end loop;
  return v_resultat;
end $$;

/** Vérification publique d'un bulletin à partir du code de son QR code. null si le code est inconnu. */
create or replace function public.verifier_bulletin(p_code text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'etablissement', jsonb_build_object('nom', e.nom, 'ville', e.ville, 'adresse', e.adresse, 'telephone', e.telephone,
                                        'devise', e.devise, 'site_web', e.site_web, 'nom_chef', e.nom_chef,
                                        'actif', e.suspendu_le is null),
    'bulletin', jsonb_build_object('eleve', b.eleve, 'matricule', b.matricule, 'classe', b.classe, 'annee', b.annee,
                                   'periode', b.periode_libelle, 'moyenne', b.moyenne, 'rang', b.rang, 'classes', b.classes,
                                   'effectif', b.effectif, 'appreciation', b.appreciation, 'emis_le', b.emis_le))
    from public.bulletins_emis b join public.etablissements e on e.id = b.etablissement_id
   where b.code = upper(btrim(coalesce(p_code, '')))
$$;

revoke all on table public.bulletins_emis from anon, authenticated;
revoke execute on function public._code_bulletin(), public.emettre_bulletins(jsonb), public.verifier_bulletin(text) from public, anon, authenticated;
grant execute on function public.emettre_bulletins(jsonb) to authenticated;
grant execute on function public.verifier_bulletin(text) to anon, authenticated;
