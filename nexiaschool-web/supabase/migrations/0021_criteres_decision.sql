-- Décisions de fin de période (bulletins) : critères d'admission en classe supérieure, de rattrapage (fin d'année),
-- de redoublement et d'exclusion, fixés par l'administration pour chaque trimestre et pour la fin d'année.
-- Un critère réunit des conditions (toutes doivent être remplies) sur la moyenne et la situation disciplinaire ;
-- plusieurs critères pour une même décision s'additionnent (l'un OU l'autre).
-- Ordre d'examen : exclusion, redoublement, rattrapage, admission ; la première décision dont un critère est rempli
-- est proposée sur le bulletin. Bornes « min » incluses (≥), bornes « max » exclues (<).

create table if not exists public.criteres_decision (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null default public.etab_courant() references public.etablissements (id) on delete cascade,
  periode text not null check (periode in ('t1', 't2', 't3', 'a')),
  decision text not null check (decision in ('admis', 'rattrapage', 'redouble', 'exclu')),
  ordre smallint not null default 0,
  libelle text not null default '' check (char_length(libelle) <= 80),
  moyenne_min numeric(4, 2) check (moyenne_min between 0 and 20),
  moyenne_max numeric(4, 2) check (moyenne_max between 0 and 20),
  discipline_min numeric(4, 2) check (discipline_min between 0 and 20),
  discipline_max numeric(4, 2) check (discipline_max between 0 and 20),
  heures_nj_min smallint check (heures_nj_min between 0 and 2000),
  heures_nj_max smallint check (heures_nj_max between 0 and 2000),
  retards_min smallint check (retards_min between 0 and 1000),
  sanction_id uuid,
  sanctions_min smallint check (sanctions_min between 1 and 100),
  maj timestamptz not null default now(),
  maj_par uuid,
  check (decision <> 'rattrapage' or periode = 'a'),
  check ((sanction_id is null) = (sanctions_min is null)),
  check (moyenne_min is null or moyenne_max is null or moyenne_min < moyenne_max),
  check (discipline_min is null or discipline_max is null or discipline_min < discipline_max),
  check (heures_nj_min is null or heures_nj_max is null or heures_nj_min < heures_nj_max),
  foreign key (sanction_id, etablissement_id) references public.sanctions (id, etablissement_id) on delete cascade
);
create index if not exists criteres_decision_etab on public.criteres_decision (etablissement_id, periode);

alter table public.criteres_decision enable row level security;
create policy "lecture par le personnel de l'établissement" on public.criteres_decision for select to authenticated
  using (etablissement_id = (select public.etab_courant()));
revoke all on public.criteres_decision from anon, authenticated;
grant select on public.criteres_decision to authenticated;          -- écriture : fonction réservée à l'administration

-- Valeur numérique d'un champ JSON : nombre, ou texte « 9,5 » / « 9.5 » ; null si vide ; erreur si illisible
create or replace function public._num_critere(c jsonb, k text, n int) returns numeric
language plpgsql immutable set search_path = '' as $$
declare v text := replace(btrim(coalesce(c ->> k, '')), ',', '.');
begin
  if v = '' then return null; end if;
  if v !~ '^\d+(\.\d+)?$' then raise exception 'Critère % : valeur numérique attendue.', n using errcode = 'P0001'; end if;
  return v::numeric;
end $$;

/**
 * Remplace les critères d'une période (administration uniquement).
 * p_criteres : [{ decision, libelle?, moyenne_min?, moyenne_max?, discipline_min?, discipline_max?, heures_nj_min?, heures_nj_max?,
 *                 retards_min?, sanction_id?, sanctions_min? }]
 */
create or replace function public.enregistrer_criteres_decision(p_periode text, p_criteres jsonb) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_etab uuid := public._exiger_admin(); c jsonb; n int := 0;
  num jsonb := '{}'::jsonb;
  noms text[] := array['moyenne_min', 'moyenne_max', 'discipline_min', 'discipline_max', 'heures_nj_min', 'heures_nj_max', 'retards_min', 'sanctions_min'];
  k text;
begin
  if p_periode is null or p_periode not in ('t1', 't2', 't3', 'a') then raise exception 'Période invalide.' using errcode = '22023'; end if;
  if p_criteres is null or jsonb_typeof(p_criteres) <> 'array' or jsonb_array_length(p_criteres) > 40 then
    raise exception 'Liste de critères invalide (40 au plus).' using errcode = '22023';
  end if;
  delete from public.criteres_decision where etablissement_id = v_etab and periode = p_periode;
  for c in select * from jsonb_array_elements(p_criteres) loop
    n := n + 1;
    if coalesce(c ->> 'decision', '') not in ('admis', 'rattrapage', 'redouble', 'exclu') then
      raise exception 'Critère % : décision inconnue.', n using errcode = 'P0001';
    end if;
    if c ->> 'decision' = 'rattrapage' and p_periode <> 'a' then
      raise exception 'Le rattrapage ne se décide qu''en fin d''année.' using errcode = 'P0001';
    end if;
    foreach k in array noms loop perform public._num_critere(c, k, n); end loop;
    if (public._num_critere(c, 'moyenne_min', n)) >= (public._num_critere(c, 'moyenne_max', n)) then
      raise exception 'Critère % : la moyenne minimale doit être inférieure à la moyenne maximale.', n using errcode = 'P0001';
    end if;
    if (public._num_critere(c, 'discipline_min', n)) >= (public._num_critere(c, 'discipline_max', n)) then
      raise exception 'Critère % : la note de discipline minimale doit être inférieure à la maximale.', n using errcode = 'P0001';
    end if;
    if (public._num_critere(c, 'heures_nj_min', n)) >= (public._num_critere(c, 'heures_nj_max', n)) then
      raise exception 'Critère % : le nombre d''heures minimal doit être inférieur au maximal.', n using errcode = 'P0001';
    end if;
    if (nullif(c ->> 'sanction_id', '') is null) <> (nullif(c ->> 'sanctions_min', '') is null) then
      raise exception 'Critère % : choisissez la sanction et le nombre de fois.', n using errcode = 'P0001';
    end if;
    insert into public.criteres_decision (etablissement_id, periode, decision, ordre, libelle, moyenne_min, moyenne_max, discipline_min, discipline_max,
                                          heures_nj_min, heures_nj_max, retards_min, sanction_id, sanctions_min, maj_par)
    values (v_etab, p_periode, c ->> 'decision', n, left(btrim(coalesce(c ->> 'libelle', '')), 80),
            public._num_critere(c, 'moyenne_min', n), public._num_critere(c, 'moyenne_max', n),
            public._num_critere(c, 'discipline_min', n), public._num_critere(c, 'discipline_max', n),
            public._num_critere(c, 'heures_nj_min', n)::smallint, public._num_critere(c, 'heures_nj_max', n)::smallint,
            public._num_critere(c, 'retards_min', n)::smallint, nullif(c ->> 'sanction_id', '')::uuid,
            public._num_critere(c, 'sanctions_min', n)::smallint, auth.uid());
  end loop;
  return n;
end $$;

revoke execute on function public.enregistrer_criteres_decision(text, jsonb), public._num_critere(jsonb, text, int) from public, anon, authenticated;
grant execute on function public.enregistrer_criteres_decision(text, jsonb) to authenticated;
