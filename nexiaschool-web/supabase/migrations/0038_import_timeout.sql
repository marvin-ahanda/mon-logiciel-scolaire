-- Imports lourds sans blocage : les fonctions d'import reçoivent leur propre délai (statement_timeout) généreux,
-- indépendant du délai par défaut du rôle appelant (plus court pour « anon »/« authenticated »). Un import est
-- massivement ensembliste (une seule requête d'insertion) et reste de l'ordre de quelques secondes même au maximum
-- (5000 élèves ≈ 2,3 s, 200 000 notes ≈ quelques secondes), mais ce délai garantit qu'il ne sera jamais interrompu,
-- y compris quand une IA l'appelle via MCP (rôle « anon », délai par défaut très court).

do $$
declare f text;
begin
  foreach f in array array[
    'public.importer_ecole(jsonb)',
    'public.importer_notes(jsonb)',
    'public.importer_eleves(jsonb)',
    'public._enregistrer_notes(uuid, uuid, jsonb, uuid)',
    'public.api_importer(text, jsonb)'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('alter function %s set statement_timeout = %L', f, '120s');
    end if;
  end loop;
end $$;
