-- SmartEval : réponses plus longues acceptées (réponse courte : 1 000 caractères, plusieurs mots ;
-- réponse longue / paragraphe : 20 000 caractères).
create or replace function public.smarteval_soumettre(p_jeton text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  e public.evaluations; q jsonb; v jsonb; rep jsonb := '{}'::jsonb; det jsonb := '[]'::jsonb;
  v_nom text := left(btrim(coalesce(p ->> 'nom', '')), 100); v_prenom text := left(btrim(coalesce(p ->> 'prenom', '')), 100);
  v_classe uuid; v_classe_lib text; v_ident text; v_num int; v_ins uuid; v_n int;
  nb int; ok boolean; corrigible boolean; pts numeric; tot numeric := 0; obt numeric := 0; acorr int := 0; vide boolean; x int; so record;
begin
  if coalesce(p_jeton, '') !~ '^[A-Za-z0-9_-]{20,40}$' then raise exception 'Lien invalide.' using errcode = 'P0001'; end if;
  if p is null or jsonb_typeof(p) <> 'object' or pg_column_size(p) > 1000000 then raise exception 'Formulaire invalide.' using errcode = 'P0001'; end if;
  select * into e from public.evaluations where id = (public._smarteval_par_jeton(p_jeton)).id for update;
  if e.id is null then raise exception 'Lien invalide : cette évaluation n''existe pas.' using errcode = 'P0001'; end if;
  if now() < e.publiee_le or now() > e.ferme_le then
    raise exception 'Cette évaluation est close : les réponses ne sont plus acceptées.' using errcode = 'P0001';
  end if;
  if v_nom = '' or v_prenom = '' then raise exception 'Indiquez votre nom et votre prénom.' using errcode = 'P0001'; end if;
  begin v_classe := (p ->> 'classe_id')::uuid; exception when others then v_classe := null; end;
  if v_classe is null or not v_classe = any (e.classes) then raise exception 'Choisissez votre classe.' using errcode = 'P0001'; end if;
  select libelle into v_classe_lib from public.classes where id = v_classe;
  v_ident := public._normaliser(v_nom) || '|' || public._normaliser(v_prenom) || '|' || v_classe;
  if exists (select 1 from public.soumissions where evaluation_id = e.id and identite = v_ident) then
    raise exception 'Vous avez déjà envoyé votre formulaire pour cette évaluation.' using errcode = 'P0001';
  end if;
  select count(*) into v_n from public.soumissions where evaluation_id = e.id;
  if v_n >= 3000 then raise exception 'Nombre maximal de réponses atteint pour cette évaluation.' using errcode = 'P0001'; end if;

  for q in select * from jsonb_array_elements(e.questions) loop
    v := (p -> 'reponses') -> (q ->> 'id');
    nb := jsonb_array_length(q -> 'options');
    -- contrôle et mise en forme de la réponse
    if v is null or jsonb_typeof(v) = 'null' then v := null;
    elsif q ->> 'type' in ('courte', 'paragraphe') then
      v := case when jsonb_typeof(v) in ('string', 'number') and btrim(v #>> '{}') <> ''
                then to_jsonb(left(btrim(v #>> '{}'), case when q ->> 'type' = 'courte' then 1000 else 20000 end)) end;
    elsif q ->> 'type' in ('choix', 'liste') then
      v := case when jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric) and (v #>> '{}')::numeric between 0 and nb - 1 then v end;
    elsif q ->> 'type' = 'cases' then
      if jsonb_typeof(v) <> 'array' then v := null;
      else
        select coalesce(jsonb_agg(distinct (z #>> '{}')::int order by (z #>> '{}')::int), '[]'::jsonb) into v
          from jsonb_array_elements(v) z where jsonb_typeof(z) = 'number' and (z #>> '{}')::numeric = trunc((z #>> '{}')::numeric) and (z #>> '{}')::numeric between 0 and nb - 1;
        if jsonb_array_length(v) = 0 then v := null; end if;
      end if;
    elsif q ->> 'type' = 'echelle' then
      v := case when jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric)
                 and (v #>> '{}')::numeric between (q #>> '{echelle,min}')::numeric and (q #>> '{echelle,max}')::numeric then v end;
    end if;
    vide := v is null;
    if vide and coalesce((q ->> 'obligatoire')::boolean, false) then
      raise exception 'La question « % » est obligatoire.', left(q ->> 'intitule', 80) using errcode = 'P0001';
    end if;
    if not vide then rep := rep || jsonb_build_object(q ->> 'id', v); end if;
    -- correction
    pts := coalesce((q ->> 'points')::numeric, 0);
    corrigible := pts > 0 and ((q ->> 'type' in ('choix', 'liste', 'cases') and jsonb_array_length(q -> 'bonnes') > 0)
                               or (q ->> 'type' = 'courte' and jsonb_array_length(q -> 'acceptees') > 0));
    ok := null;
    if corrigible then
      tot := tot + pts;
      if vide then ok := false;
      elsif q ->> 'type' in ('choix', 'liste') then ok := (q -> 'bonnes') @> jsonb_build_array((v #>> '{}')::int);
      elsif q ->> 'type' = 'cases' then ok := (q -> 'bonnes') @> v and v @> (q -> 'bonnes');
      else ok := exists (select 1 from jsonb_array_elements_text(q -> 'acceptees') a where public._smarteval_norm(a) = public._smarteval_norm(v #>> '{}'));
      end if;
      if ok then obt := obt + pts; end if;
    elsif q ->> 'type' in ('paragraphe', 'courte') and pts > 0 and not vide then
      acorr := acorr + 1;
    end if;
    det := det || jsonb_build_object('id', q ->> 'id', 'correct', ok, 'obtenu', case when corrigible then case when ok then pts else 0 end end,
                                     'max', case when corrigible then pts end, 'a_corriger', not corrigible and q ->> 'type' in ('paragraphe', 'courte') and pts > 0 and not vide);
  end loop;

  -- élève reconnu dans la classe (nom et prénom, dans un sens ou dans l'autre) : sert à l'analyse
  select min(i.id::text)::uuid, count(*) into v_ins, x from public.inscriptions i join public.eleves el on el.id = i.eleve_id
   where i.classe_id = v_classe and i.exercice_id = e.exercice_id
     and (public._normaliser(el.nom || el.prenom) = public._normaliser(v_nom || v_prenom)
       or public._normaliser(el.nom || el.prenom) = public._normaliser(v_prenom || v_nom));
  if x <> 1 then v_ins := null; end if;

  select coalesce(max(numero), 0) + 1 into v_num from public.soumissions where evaluation_id = e.id;
  insert into public.soumissions (evaluation_id, etablissement_id, numero, nom, prenom, classe_id, classe, inscription_id, identite,
                                  reponses, details, points, total, note20, a_corriger)
  values (e.id, e.etablissement_id, v_num, upper(v_nom), v_prenom, v_classe, v_classe_lib, v_ins, v_ident, rep, det,
          case when tot > 0 then obt end, case when tot > 0 then tot end, case when tot > 0 then round(obt / tot * 20, 2) end, acorr)
  returning numero, soumis_le, nom, prenom, classe into so;
  return jsonb_build_object('numero', so.numero, 'recu', upper(substr(md5(e.id::text || so.numero), 1, 4)) || '-' || lpad(so.numero::text, 4, '0'),
                            'soumis_le', so.soumis_le, 'nom', so.nom, 'prenom', so.prenom, 'classe', so.classe, 'evaluation', e.titre);
end $$;

alter function public.smarteval_soumettre(text, jsonb) set plan_cache_mode = force_custom_plan;
