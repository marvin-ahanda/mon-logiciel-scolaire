-- SmartEval : documents supports (corpus, texte, carte, schéma…) joints à une évaluation et téléchargeables par les élèves.
--  * fichiers PDF, images (JPG, PNG, WebP) ou textes Word / OpenDocument ; 10 Mo au plus chacun ; 3 documents au plus par évaluation ;
--  * rangés dans le compartiment privé « smarteval », sous « <établissement>/<auteur>/… » : chacun ne dépose que dans son dossier ;
--  * lus par le personnel de l'établissement, et par les élèves (visiteurs du lien) tant que l'évaluation est ouverte.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('smarteval', 'smarteval', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.oasis.opendocument.text'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

alter table public.evaluations add column if not exists supports jsonb not null default '[]'::jsonb;
alter table public.evaluations drop constraint if exists evaluations_supports_check;
alter table public.evaluations add constraint evaluations_supports_check check (jsonb_typeof(supports) = 'array' and jsonb_array_length(supports) <= 3);

-- Un document support d'une évaluation ouverte : lisible par les élèves qui ont le lien
create or replace function public._smarteval_support_ouvert(p_nom text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.evaluations e
                  where e.jeton is not null and now() between e.publiee_le and e.ferme_le
                    and e.supports @> jsonb_build_array(jsonb_build_object('chemin', p_nom)))
$$;
revoke execute on function public._smarteval_support_ouvert(text) from public;
grant execute on function public._smarteval_support_ouvert(text) to anon, authenticated;

drop policy if exists "smarteval : lecture par le personnel" on storage.objects;
drop policy if exists "smarteval : lecture par les élèves (évaluation ouverte)" on storage.objects;
drop policy if exists "smarteval : dépôt dans son dossier" on storage.objects;
drop policy if exists "smarteval : suppression dans son dossier" on storage.objects;
create policy "smarteval : lecture par le personnel" on storage.objects for select to authenticated
  using (bucket_id = 'smarteval' and (storage.foldername(name))[1] = (select public.etab_courant())::text);
create policy "smarteval : lecture par les élèves (évaluation ouverte)" on storage.objects for select to anon
  using (bucket_id = 'smarteval' and public._smarteval_support_ouvert(name));
create policy "smarteval : dépôt dans son dossier" on storage.objects for insert to authenticated
  with check (bucket_id = 'smarteval' and (storage.foldername(name))[1] = (select public.etab_courant())::text
              and (storage.foldername(name))[2] = (select auth.uid())::text);
create policy "smarteval : suppression dans son dossier" on storage.objects for delete to authenticated
  using (bucket_id = 'smarteval' and (storage.foldername(name))[1] = (select public.etab_courant())::text
         and (storage.foldername(name))[2] = (select auth.uid())::text);

-- Contrôle des documents déclarés : déposés par l'auteur, dans son dossier, au plus 3 ; nom affiché nettoyé
create or replace function public._smarteval_supports(p jsonb, p_etab uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb; v jsonb := '[]'::jsonb; v_chemin text;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return '[]'::jsonb; end if;
  if jsonb_array_length(p) > 3 then raise exception 'Trois documents supports au plus par évaluation.' using errcode = 'P0001'; end if;
  for s in select * from jsonb_array_elements(p) loop
    v_chemin := coalesce(s ->> 'chemin', '');
    if v_chemin not like p_etab::text || '/' || auth.uid()::text || '/%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'smarteval' and o.name = v_chemin) then
      raise exception 'Document support introuvable : déposez-le de nouveau.' using errcode = 'P0001';
    end if;
    v := v || jsonb_build_array(jsonb_build_object('chemin', v_chemin,
           'nom', left(coalesce(nullif(btrim(s ->> 'nom'), ''), 'document'), 120),
           'type', left(coalesce(s ->> 'type', ''), 100),
           'taille', case when (s ->> 'taille') ~ '^\d{1,9}$' then (s ->> 'taille')::int end));
  end loop;
  return v;
end $$;
revoke execute on function public._smarteval_supports(jsonb, uuid) from public, anon, authenticated;

-- Évaluation complète : les documents supports accompagnent l'évaluation (enseignant, élèves, IA)
create or replace function public._smarteval_json(e public.evaluations, p_corriges boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', e.id, 'titre', e.titre, 'consignes', e.consignes, 'competence', e.competence,
    'matiere_id', e.matiere_id, 'matiere', m.libelle, 'sequence_id', e.sequence_id, 'sequence', s.numero, 'trimestre', s.trimestre,
    'annee', x.libelle, 'classes', (select jsonb_agg(jsonb_build_object('id', c.id, 'libelle', c.libelle) order by c.ordre, c.libelle)
                                       from public.classes c where c.id = any (e.classes)),
    'questions', case when p_corriges then e.questions
                      else (select coalesce(jsonb_agg(q - 'bonnes' - 'acceptees' order by o), '[]'::jsonb) from jsonb_array_elements(e.questions) with ordinality t(q, o)) end,
    'supports', e.supports,
    'entete', e.entete, 'duree_valeur', e.duree_valeur, 'duree_unite', e.duree_unite,
    'jeton', case when p_corriges then e.jeton end, 'publiee_le', e.publiee_le, 'ferme_le', e.ferme_le,
    'statut', public._smarteval_statut(e), 'cree_le', e.cree_le,
    'auteur', (select btrim(p.nom || ' ' || p.prenom) from public.personnels p where p.id = e.auteur_id))
  from public.matieres m, public.sequences s, public.exercices x
  where m.id = e.matiere_id and s.id = e.sequence_id and x.id = e.exercice_id
$$;

/**
 * Enregistre (crée ou modifie) une évaluation non publiée — ouvert à tout personnel, sans préalable IA.
 * p = { id?, titre, consignes, competence, matiere_id, classes: [uuid], questions: [...], supports: [{ chemin, nom, type, taille }] }
 */
create or replace function public.smarteval_enregistrer(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_etab uuid := public.etab_courant(); v_id uuid := nullif(p ->> 'id', '')::uuid; e public.evaluations; s record;
  v_classes uuid[]; v_mat uuid := nullif(p ->> 'matiere_id', '')::uuid; v_q jsonb; v_sup jsonb; v_libre boolean := public._smarteval_libre(auth.uid());
begin
  if v_etab is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  select * into s from public._smarteval_sequence(v_etab);
  if s.id is null then raise exception 'Aucune séquence en cours : toutes les séquences sont verrouillées.' using errcode = 'P0001'; end if;
  if btrim(coalesce(p ->> 'titre', '')) = '' then raise exception 'Donnez un titre à l''évaluation.' using errcode = 'P0001'; end if;
  if btrim(coalesce(p ->> 'competence', '')) = '' then raise exception 'Indiquez la compétence visée.' using errcode = 'P0001'; end if;
  if v_mat is null or not exists (select 1 from public.attributions where matiere_id = v_mat and exercice_id = s.exercice_id
                                     and (v_libre or enseignant_id = auth.uid())) then
    raise exception 'Choisissez une matière du programme de cette année.' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct a.classe_id), '{}') into v_classes from public.attributions a
   where a.matiere_id = v_mat and a.exercice_id = s.exercice_id and (v_libre or a.enseignant_id = auth.uid())
     and a.classe_id::text in (select jsonb_array_elements_text(coalesce(p -> 'classes', '[]'::jsonb)));
  if cardinality(v_classes) = 0 then raise exception 'Choisissez au moins une classe.' using errcode = 'P0001'; end if;
  v_q := public._smarteval_questions(p -> 'questions');
  v_sup := public._smarteval_supports(p -> 'supports', v_etab);
  if v_id is null then
    insert into public.evaluations (etablissement_id, auteur_id, exercice_id, sequence_id, matiere_id, classes, titre, consignes, competence, questions, supports)
    values (v_etab, auth.uid(), s.exercice_id, s.id, v_mat, v_classes, left(btrim(p ->> 'titre'), 150), left(coalesce(p ->> 'consignes', ''), 3000),
            left(btrim(p ->> 'competence'), 600), v_q, v_sup)
    returning id into v_id;
  else
    e := public._smarteval_mienne(v_id);
    if e.jeton is not null then raise exception 'Évaluation déjà publiée : elle ne peut plus être modifiée.' using errcode = 'P0001'; end if;
    update public.evaluations set sequence_id = s.id, exercice_id = s.exercice_id, matiere_id = v_mat, classes = v_classes,
           titre = left(btrim(p ->> 'titre'), 150), consignes = left(coalesce(p ->> 'consignes', ''), 3000),
           competence = left(btrim(p ->> 'competence'), 600), questions = v_q, supports = v_sup, modifie_le = now()
     where id = v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- Suppression d'une évaluation : renvoie ses documents supports, que l'application retire ensuite du stockage
drop function if exists public.smarteval_supprimer(uuid);
create function public.smarteval_supprimer(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare e public.evaluations;
begin
  e := public._smarteval_mienne(p_id);
  delete from public.evaluations where id = e.id;
  return e.supports;
end $$;
revoke execute on function public.smarteval_supprimer(uuid) from public, anon;
grant execute on function public.smarteval_supprimer(uuid) to authenticated;
