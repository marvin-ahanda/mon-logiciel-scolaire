-- Performance RLS (advisor auth_rls_initplan) : auth.uid() était réévalué pour chaque ligne dans quatre politiques.
-- On l'enveloppe dans (select auth.uid()) : PostgreSQL l'évalue une seule fois par requête. Même sens, plus rapide à grande échelle.

drop policy if exists "ses clés, ou toutes pour l'administration" on public.cles_api;
create policy "ses clés, ou toutes pour l'administration" on public.cles_api for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (personnel_id = (select auth.uid()) or (select public.est_admin())));

drop policy if exists "journal : le sien, ou tout pour l'administration" on public.journal_api;
create policy "journal : le sien, ou tout pour l'administration" on public.journal_api for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (personnel_id = (select auth.uid()) or (select public.est_admin())));

drop policy if exists "ses applications, ou toutes pour l'administration" on public.jetons_oauth;
create policy "ses applications, ou toutes pour l'administration" on public.jetons_oauth for select to authenticated
  using (etablissement_id = (select public.etab_courant()) and (personnel_id = (select auth.uid()) or (select public.est_admin())));

drop policy if exists "annulation" on public.paiements;
create policy "annulation" on public.paiements for delete to authenticated
  using (etablissement_id = (select public.etab_courant()) and (select public.peut_finance())
         and ((select public.est_admin()) or (saisi_par = (select auth.uid()) and cree_le > now() - interval '24 hours')));
