-- Import du fichier Excel complet : ajout des notes (feuille « Notes » : matricule, code matière, séquence, note sur 20).
-- Les notes visent l'année active (ou celle créée par l'import) ; tout est vérifié avant d'écrire, et l'import reste tout ou rien.

create or replace function public.importer_ecole(p jsonb) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_etab uuid := public._exiger_admin();
  v_ex uuid; v_annee text; l jsonb; v_id uuid; v_classe uuid; v_section uuid; v_matiere uuid; v_ens uuid; v_code text;
  n jsonb := '{}'::jsonb; codes jsonb := '[]'::jsonb; existant boolean; ligne int;
  c_sec int := 0; m_sec int := 0; c_cla int := 0; m_cla int := 0; c_mat int := 0; m_mat int := 0;
  c_per int := 0; e_per int := 0; c_pro int := 0; m_pro int := 0; c_ele int := 0; m_ele int := 0; annee_creee boolean := false;
  c_not int := 0; m_not int := 0; pb record;
begin
  if jsonb_typeof(p) <> 'object' then raise exception 'Fichier illisible.' using errcode = 'P0001'; end if;
  if jsonb_array_length(coalesce(p -> 'eleves', '[]')) > 5000 or jsonb_array_length(coalesce(p -> 'programme', '[]')) > 5000
     or jsonb_array_length(coalesce(p -> 'classes', '[]')) > 300 or jsonb_array_length(coalesce(p -> 'matieres', '[]')) > 300
     or jsonb_array_length(coalesce(p -> 'sections', '[]')) > 50 or jsonb_array_length(coalesce(p -> 'personnels', '[]')) > 300
     or jsonb_array_length(coalesce(p -> 'notes', '[]')) > 200000 then
    raise exception 'Fichier trop volumineux (5000 élèves, 300 classes, 300 matières, 300 membres du personnel, 200 000 notes au plus).' using errcode = 'P0001';
  end if;

  -- Année scolaire : l'exercice actif, sinon celle indiquée (créée et activée, avec ses six séquences)
  select id, libelle into v_ex, v_annee from public.exercices where etablissement_id = v_etab and actif;
  if v_ex is null and (jsonb_array_length(coalesce(p -> 'eleves', '[]')) > 0 or jsonb_array_length(coalesce(p -> 'programme', '[]')) > 0
                     or jsonb_array_length(coalesce(p -> 'notes', '[]')) > 0) then
    v_annee := btrim(coalesce(p ->> 'annee', ''));
    if v_annee !~ '^[0-9]{4}-[0-9]{4}$' or split_part(v_annee, '-', 2)::int <> split_part(v_annee, '-', 1)::int + 1 then
      raise exception 'Indiquez l''année scolaire (par exemple 2026-2027) : aucune année n''est encore active.' using errcode = 'P0001';
    end if;
    select id into v_ex from public.exercices where etablissement_id = v_etab and libelle = v_annee;
    if v_ex is null then
      insert into public.exercices (etablissement_id, libelle, actif) values (v_etab, v_annee, true) returning id into v_ex;
      annee_creee := true;
    else
      update public.exercices set actif = true where id = v_ex;
    end if;
  end if;

  -- Sections
  ligne := 0;
  for l in select * from jsonb_array_elements(coalesce(p -> 'sections', '[]')) loop
    ligne := ligne + 1;
    if char_length(btrim(coalesce(l ->> 'libelle', ''))) not between 1 and 60 then
      raise exception 'Feuille Sections, ligne % : nom de section manquant ou trop long.', ligne using errcode = 'P0001';
    end if;
    select id into v_id from public.sections where etablissement_id = v_etab and public._normaliser(libelle) = public._normaliser(l ->> 'libelle');
    if v_id is null then
      insert into public.sections (etablissement_id, libelle, ordre) values (v_etab, btrim(l ->> 'libelle'), coalesce((l ->> 'ordre')::int, 0));
      c_sec := c_sec + 1;
    else
      update public.sections set ordre = coalesce((l ->> 'ordre')::int, ordre) where id = v_id;
      m_sec := m_sec + 1;
    end if;
  end loop;

  -- Classes
  ligne := 0;
  for l in select * from jsonb_array_elements(coalesce(p -> 'classes', '[]')) loop
    ligne := ligne + 1;
    if char_length(btrim(coalesce(l ->> 'libelle', ''))) not between 1 and 50 then
      raise exception 'Feuille Classes, ligne % : nom de classe manquant ou trop long.', ligne using errcode = 'P0001';
    end if;
    v_section := null;
    if btrim(coalesce(l ->> 'section', '')) <> '' then
      select id into v_section from public.sections where etablissement_id = v_etab and public._normaliser(libelle) = public._normaliser(l ->> 'section');
      if v_section is null then
        raise exception 'Classe « % » : section « % » inconnue.', l ->> 'libelle', l ->> 'section' using errcode = 'P0001';
      end if;
    end if;
    select id into v_id from public.classes where etablissement_id = v_etab and public._normaliser(libelle) = public._normaliser(l ->> 'libelle');
    if v_id is null then
      insert into public.classes (etablissement_id, libelle, niveau, ordre, section_id, cycle)
      values (v_etab, btrim(l ->> 'libelle'), left(btrim(coalesce(l ->> 'niveau', '')), 50), coalesce((l ->> 'ordre')::int, 0), v_section, (l ->> 'cycle')::smallint);
      c_cla := c_cla + 1;
    else
      update public.classes set niveau = coalesce(nullif(left(btrim(coalesce(l ->> 'niveau', '')), 50), ''), niveau),
             ordre = coalesce((l ->> 'ordre')::int, ordre), section_id = coalesce(v_section, section_id),
             cycle = coalesce((l ->> 'cycle')::smallint, cycle)
       where id = v_id;
      m_cla := m_cla + 1;
    end if;
  end loop;

  -- Matières
  for l in select * from jsonb_array_elements(coalesce(p -> 'matieres', '[]')) loop
    if char_length(btrim(coalesce(l ->> 'code', ''))) not between 1 and 15 or char_length(btrim(coalesce(l ->> 'libelle', ''))) not between 1 and 100 then
      raise exception 'Feuille Matières : code (15 caractères au plus) et nom obligatoires (« % »).', coalesce(l ->> 'code', l ->> 'libelle') using errcode = 'P0001';
    end if;
    select id into v_id from public.matieres where etablissement_id = v_etab and upper(code) = upper(btrim(l ->> 'code'));
    if v_id is null then
      insert into public.matieres (etablissement_id, code, libelle) values (v_etab, upper(btrim(l ->> 'code')), btrim(l ->> 'libelle'));
      c_mat := c_mat + 1;
    else
      update public.matieres set libelle = btrim(l ->> 'libelle') where id = v_id;
      m_mat := m_mat + 1;
    end if;
  end loop;

  -- Personnel : les membres déjà présents ne sont pas modifiés ; les nouveaux reçoivent un code personnel
  for l in select * from jsonb_array_elements(coalesce(p -> 'personnels', '[]')) loop
    if char_length(btrim(coalesce(l ->> 'nom', ''))) not between 1 and 150 then
      raise exception 'Feuille Personnel : nom manquant.' using errcode = 'P0001';
    end if;
    if coalesce(l ->> 'role', '') not in ('admin', 'enseignant', 'surveillant', 'comptable') then
      raise exception 'Personnel « % » : rôle inconnu.', public._libelle(l ->> 'nom', l ->> 'prenom') using errcode = 'P0001';
    end if;
    select id into v_id from public.personnels
     where etablissement_id = v_etab
       and ((btrim(coalesce(l ->> 'matricule', '')) <> '' and matricule <> '' and public._normaliser(matricule) = public._normaliser(l ->> 'matricule'))
            or public._normaliser(public._libelle(nom, prenom)) = public._normaliser(public._libelle(l ->> 'nom', l ->> 'prenom')))
     limit 1;
    if v_id is not null then
      e_per := e_per + 1;
      continue;
    end if;
    if (select count(*) from public.personnels where etablissement_id = v_etab) >= 300 then
      raise exception 'Nombre maximal de comptes atteint (300).' using errcode = 'P0001';
    end if;
    v_id := gen_random_uuid(); v_code := public._generer_code(6);
    perform public._creer_compte_auth(v_id);
    insert into public.personnels (id, etablissement_id, nom, prenom, role, matricule, telephone, code_hash)
    values (v_id, v_etab, upper(btrim(l ->> 'nom')), btrim(coalesce(l ->> 'prenom', '')), l ->> 'role',
            left(btrim(coalesce(l ->> 'matricule', '')), 30), left(btrim(coalesce(l ->> 'telephone', '')), 30), public._hacher(v_code));
    codes := codes || jsonb_build_object('nom', public._libelle(l ->> 'nom', l ->> 'prenom'), 'role', l ->> 'role', 'code', v_code);
    c_per := c_per + 1;
  end loop;

  -- Matières par classe (coefficient, groupe, enseignant facultatif)
  for l in select * from jsonb_array_elements(coalesce(p -> 'programme', '[]')) loop
    select id into v_classe from public.classes where etablissement_id = v_etab and public._normaliser(libelle) = public._normaliser(l ->> 'classe');
    select id into v_matiere from public.matieres where etablissement_id = v_etab and upper(code) = upper(btrim(coalesce(l ->> 'matiere', '')));
    if v_classe is null or v_matiere is null then
      raise exception 'Matières par classe : classe « % » ou matière « % » inconnue.', l ->> 'classe', l ->> 'matiere' using errcode = 'P0001';
    end if;
    if coalesce((l ->> 'coefficient')::int, 0) not between 1 and 20 or coalesce((l ->> 'groupe')::int, 1) not between 1 and 3 then
      raise exception 'Matières par classe (« % », « % ») : coefficient de 1 à 20 et groupe de 1 à 3.', l ->> 'classe', l ->> 'matiere' using errcode = 'P0001';
    end if;
    v_ens := null;
    if btrim(coalesce(l ->> 'enseignant', '')) <> '' then
      v_ens := public._personnel_designe(v_etab, l ->> 'enseignant');
      if v_ens is null then
        raise exception 'Matières par classe (« % », « % ») : enseignant « % » introuvable dans le personnel.', l ->> 'classe', l ->> 'matiere', l ->> 'enseignant'
          using errcode = 'P0001';
      end if;
    end if;
    existant := exists (select 1 from public.attributions where exercice_id = v_ex and classe_id = v_classe and matiere_id = v_matiere);
    insert into public.attributions (etablissement_id, exercice_id, classe_id, matiere_id, enseignant_id, coefficient, groupe)
    values (v_etab, v_ex, v_classe, v_matiere, v_ens, (l ->> 'coefficient')::int, coalesce((l ->> 'groupe')::int, 1))
    on conflict (exercice_id, classe_id, matiere_id) do update
      set coefficient = excluded.coefficient, groupe = excluded.groupe,
          enseignant_id = coalesce(excluded.enseignant_id, public.attributions.enseignant_id);
    if existant then m_pro := m_pro + 1; else c_pro := c_pro + 1; end if;
  end loop;

  -- Élèves et inscription dans leur classe pour l'année
  for l in select * from jsonb_array_elements(coalesce(p -> 'eleves', '[]')) loop
    if char_length(btrim(coalesce(l ->> 'matricule', ''))) not between 1 and 30 or char_length(btrim(coalesce(l ->> 'nom', ''))) not between 1 and 100
       or coalesce(l ->> 'sexe', '') not in ('M', 'F') then
      raise exception 'Élève « % » : matricule, nom et sexe (M ou F) obligatoires.', coalesce(l ->> 'matricule', l ->> 'nom') using errcode = 'P0001';
    end if;
    existant := exists (select 1 from public.eleves where etablissement_id = v_etab and matricule = btrim(l ->> 'matricule'));
    insert into public.eleves (etablissement_id, matricule, nom, prenom, sexe, date_naissance, lieu_naissance, telephone_parent)
    values (v_etab, btrim(l ->> 'matricule'), upper(btrim(l ->> 'nom')), left(btrim(coalesce(l ->> 'prenom', '')), 100), l ->> 'sexe',
            nullif(l ->> 'date_naissance', '')::date, left(btrim(coalesce(l ->> 'lieu_naissance', '')), 100), left(btrim(coalesce(l ->> 'telephone_parent', '')), 30))
    on conflict (etablissement_id, matricule) do update set nom = excluded.nom, prenom = excluded.prenom, sexe = excluded.sexe,
      date_naissance = coalesce(excluded.date_naissance, public.eleves.date_naissance),
      lieu_naissance = case when excluded.lieu_naissance <> '' then excluded.lieu_naissance else public.eleves.lieu_naissance end,
      telephone_parent = case when excluded.telephone_parent <> '' then excluded.telephone_parent else public.eleves.telephone_parent end
    returning id into v_id;
    if existant then m_ele := m_ele + 1; else c_ele := c_ele + 1; end if;
    if btrim(coalesce(l ->> 'classe', '')) <> '' then
      select id into v_classe from public.classes where etablissement_id = v_etab and public._normaliser(libelle) = public._normaliser(l ->> 'classe');
      if v_classe is null then
        raise exception 'Élève « % » : classe « % » inconnue.', l ->> 'matricule', l ->> 'classe' using errcode = 'P0001';
      end if;
      insert into public.inscriptions (etablissement_id, exercice_id, classe_id, eleve_id, redoublant, nouveau)
      values (v_etab, v_ex, v_classe, v_id, coalesce((l ->> 'redoublant')::boolean, false), coalesce((l ->> 'nouveau')::boolean, true))
      on conflict (exercice_id, eleve_id) do update set classe_id = excluded.classe_id,
        redoublant = case when l ? 'redoublant' then excluded.redoublant else public.inscriptions.redoublant end,
        nouveau = case when l ? 'nouveau' then excluded.nouveau else public.inscriptions.nouveau end;
    end if;
  end loop;

  -- Notes sur 20 de l'année active : [matricule, code matière, séquence, note], d'un seul tenant (tout est contrôlé avant d'écrire)
  if jsonb_array_length(coalesce(p -> 'notes', '[]')) > 0 then
    select x.* into pb from (
      select n.ligne, n.matricule, n.code, n.numero, n.valeur,
             case when e.id is null then 'élève inconnu'
                  when i.id is null then 'élève sans classe cette année'
                  when m.id is null then 'matière inconnue'
                  when a.id is null then 'matière non enseignée dans la classe de l''élève'
                  when s.id is null then 'séquence de 1 à 6 attendue'
                  when s.verrouillee then 'séquence verrouillée'
                  when n.valeur is null or n.valeur not between 0 and 20 then 'note de 0 à 20 attendue'
                  when count(*) over (partition by i.id, a.id, s.id) > 1 then 'note en double (même élève, matière et séquence)' end as probleme
        from (select o::int as ligne, btrim(v ->> 0) as matricule, upper(btrim(v ->> 1)) as code,
                     case when v ->> 2 ~ '^\s*[0-9]{1,2}\s*$' then (v ->> 2)::int end as numero,
                     case when v ->> 3 ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then round((v ->> 3)::numeric, 2) end as valeur
                from jsonb_array_elements(p -> 'notes') with ordinality as t(v, o)) n
        left join public.eleves e on e.etablissement_id = v_etab and e.matricule = n.matricule
        left join public.inscriptions i on i.eleve_id = e.id and i.exercice_id = v_ex
        left join public.matieres m on m.etablissement_id = v_etab and upper(m.code) = n.code
        left join public.attributions a on a.exercice_id = v_ex and a.classe_id = i.classe_id and a.matiere_id = m.id
        left join public.sequences s on s.exercice_id = v_ex and s.numero = n.numero) x
     where x.probleme is not null order by x.ligne limit 1;
    if found then
      raise exception 'Notes, élève « % », matière « % », séquence % : %.', pb.matricule, pb.code, coalesce(pb.numero::text, '?'), pb.probleme
        using errcode = 'P0001';
    end if;
    with n as (
      select btrim(v ->> 0) as matricule, upper(btrim(v ->> 1)) as code, (v ->> 2)::int as numero, round((v ->> 3)::numeric, 2) as valeur
        from jsonb_array_elements(p -> 'notes') as t(v)),
    r as (
      insert into public.notes (etablissement_id, inscription_id, attribution_id, sequence_id, valeur)
      select v_etab, i.id, a.id, s.id, n.valeur
        from n join public.eleves e on e.etablissement_id = v_etab and e.matricule = n.matricule
               join public.inscriptions i on i.eleve_id = e.id and i.exercice_id = v_ex
               join public.matieres m on m.etablissement_id = v_etab and upper(m.code) = n.code
               join public.attributions a on a.exercice_id = v_ex and a.classe_id = i.classe_id and a.matiere_id = m.id
               join public.sequences s on s.exercice_id = v_ex and s.numero = n.numero
      on conflict (inscription_id, attribution_id, sequence_id) do update set valeur = excluded.valeur
        where public.notes.valeur is distinct from excluded.valeur
      returning (xmax = 0) as cree)
    select count(*) filter (where cree), count(*) filter (where not cree) into c_not, m_not from r;
  end if;

  return json_build_object('annee', v_annee, 'annee_creee', annee_creee,
    'sections', json_build_object('crees', c_sec, 'modifies', m_sec), 'classes', json_build_object('crees', c_cla, 'modifies', m_cla),
    'matieres', json_build_object('crees', c_mat, 'modifies', m_mat), 'personnels', json_build_object('crees', c_per, 'existants', e_per),
    'programme', json_build_object('crees', c_pro, 'modifies', m_pro), 'eleves', json_build_object('crees', c_ele, 'modifies', m_ele),
    'notes', json_build_object('crees', c_not, 'modifies', m_not),
    'codes', codes);
end $$;

revoke execute on function public.importer_ecole(jsonb) from public, anon, authenticated;
grant execute on function public.importer_ecole(jsonb) to authenticated;
