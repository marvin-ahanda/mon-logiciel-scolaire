-- Import Excel des élèves en une seule transaction (tout ou rien), réservé à l'administration.
-- p_lignes : [{ matricule, nom, prenom, sexe, date_naissance, lieu_naissance, telephone_parent, classe_id }]
-- Création ou mise à jour selon le matricule ; inscription (ou changement de classe) dans l'exercice actif.
create or replace function public.importer_eleves(p_lignes jsonb)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare
  v_etab uuid := public._exiger_admin();
  v_ex uuid := (select id from public.exercices where etablissement_id = v_etab and actif);
  l jsonb; v_eleve uuid; v_classe uuid; crees int := 0; modifies int := 0; existant boolean;
begin
  if jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) > 3000 then
    raise exception 'Import limité à 3000 lignes.' using errcode = 'P0001';
  end if;
  for l in select * from jsonb_array_elements(p_lignes) loop
    existant := exists (select 1 from public.eleves where etablissement_id = v_etab and matricule = btrim(l ->> 'matricule'));
    insert into public.eleves (etablissement_id, matricule, nom, prenom, sexe, date_naissance, lieu_naissance, telephone_parent)
    values (v_etab, btrim(l ->> 'matricule'), upper(btrim(l ->> 'nom')), btrim(coalesce(l ->> 'prenom', '')), l ->> 'sexe',
            nullif(l ->> 'date_naissance', '')::date, btrim(coalesce(l ->> 'lieu_naissance', '')), btrim(coalesce(l ->> 'telephone_parent', '')))
    on conflict (etablissement_id, matricule) do update set nom = excluded.nom, prenom = excluded.prenom, sexe = excluded.sexe,
      date_naissance = coalesce(excluded.date_naissance, public.eleves.date_naissance),
      lieu_naissance = case when excluded.lieu_naissance <> '' then excluded.lieu_naissance else public.eleves.lieu_naissance end,
      telephone_parent = case when excluded.telephone_parent <> '' then excluded.telephone_parent else public.eleves.telephone_parent end
    returning id into v_eleve;
    if existant then modifies := modifies + 1; else crees := crees + 1; end if;
    v_classe := nullif(l ->> 'classe_id', '')::uuid;
    if v_classe is not null then
      if v_ex is null then raise exception 'Aucun exercice actif : impossible d''inscrire les élèves dans une classe.' using errcode = 'P0001'; end if;
      insert into public.inscriptions (etablissement_id, exercice_id, classe_id, eleve_id)
      values (v_etab, v_ex, v_classe, v_eleve)          -- clé composite : la classe doit appartenir à l'établissement
      on conflict (exercice_id, eleve_id) do update set classe_id = excluded.classe_id;
    end if;
  end loop;
  return json_build_object('crees', crees, 'modifies', modifies);
end $$;

revoke execute on function public.importer_eleves(jsonb) from public, anon, authenticated;
grant execute on function public.importer_eleves(jsonb) to authenticated;
