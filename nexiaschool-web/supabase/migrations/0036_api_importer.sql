-- MCP : appliquer un document à l'espace de l'établissement (import tolérant).
-- L'IA lit un fichier, une photo ou un tableau, en extrait les données structurées, puis appelle cet outil.
-- On réutilise importer_ecole (déjà testé, tolérant, « tout ou rien ») : il exige l'administration (_exiger_admin),
-- donc une clé API dont le propriétaire n'est pas admin est refusée automatiquement. _api_contexte(.., true) impose
-- en plus le droit d'écriture de la clé et place l'identité du propriétaire (auth.uid, etab_courant, est_admin).

create or replace function public.api_importer(p_cle text, p jsonb) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare c record; r json;
begin
  select * into c from public._api_contexte(p_cle, true);
  if jsonb_typeof(p) <> 'object' then raise exception 'Données illisibles : un objet est attendu.' using errcode = 'P0001'; end if;
  r := public.importer_ecole(p);
  perform public._api_journal(c.etab, c.personnel, c.source, 'importer', jsonb_build_object(
    'eleves', jsonb_array_length(coalesce(p -> 'eleves', '[]')), 'classes', jsonb_array_length(coalesce(p -> 'classes', '[]')),
    'matieres', jsonb_array_length(coalesce(p -> 'matieres', '[]')), 'sections', jsonb_array_length(coalesce(p -> 'sections', '[]')),
    'personnels', jsonb_array_length(coalesce(p -> 'personnels', '[]')), 'programme', jsonb_array_length(coalesce(p -> 'programme', '[]')),
    'notes', jsonb_array_length(coalesce(p -> 'notes', '[]'))));
  return r;
end $$;
revoke execute on function public.api_importer(text, jsonb) from public, anon, authenticated;
grant execute on function public.api_importer(text, jsonb) to anon;
