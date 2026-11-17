-- Page Abonnement : indique pour chaque paiement si son reçu est parti par e-mail (sinon la page demande un nouvel envoi).
create or replace function public.mon_abonnement() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_etab uuid := public.etab_courant(); e public.etablissements;
begin
  if v_etab is null or not public.est_admin() then raise exception 'Réservé à l''administrateur de l''établissement.' using errcode = '42501'; end if;
  select * into e from public.etablissements where id = v_etab;
  return jsonb_build_object(
    'offre', e.offre, 'periode', e.offre_periodicite, 'expire_le', e.offre_expire_le, 'effective', public._offre_effective(v_etab),
    'tarifs', public.tarifs_offres(),
    'paiements', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'offre', p.offre, 'periode', p.periode, 'montant', p.montant,
        'statut', p.statut, 'cree_le', p.cree_le, 'paye_le', p.paye_le, 'fin', p.fin, 'numero_recu', p.numero_recu,
        'recu_envoye', p.recu_envoye_le is not null) order by p.cree_le desc)
      from (select * from public.paiements_abonnement where etablissement_id = v_etab order by cree_le desc limit 20) p), '[]'::jsonb));
end $$;
