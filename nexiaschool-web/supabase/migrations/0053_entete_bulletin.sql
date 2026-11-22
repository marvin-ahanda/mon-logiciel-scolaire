-- En-tête officiel du bulletin et professeur principal de chaque classe.
--  * En-tête à gauche (langue principale) et à droite (seconde langue) : pays, devise du pays, ministère de tutelle,
--    délégation / autorité régionale. Champs libres et facultatifs : ils conviennent à tout établissement (primaire,
--    secondaire, supérieur), dans tout pays ; une ligne vide n'est pas affichée.
--  * Sous le logo : nom, devise et spécialisation de l'établissement (ex. « Enseignement général & technique · Bilingue »).
--  * Professeur principal d'une classe : un membre du personnel du même établissement (affiché sur le bulletin).

alter table public.etablissements
  add column if not exists entete_pays text not null default '' check (char_length(entete_pays) <= 120),
  add column if not exists entete_devise_pays text not null default '' check (char_length(entete_devise_pays) <= 120),
  add column if not exists entete_ministere text not null default '' check (char_length(entete_ministere) <= 160),
  add column if not exists entete_delegation text not null default '' check (char_length(entete_delegation) <= 160),
  add column if not exists entete_pays_en text not null default '' check (char_length(entete_pays_en) <= 120),
  add column if not exists entete_devise_pays_en text not null default '' check (char_length(entete_devise_pays_en) <= 120),
  add column if not exists entete_ministere_en text not null default '' check (char_length(entete_ministere_en) <= 160),
  add column if not exists entete_delegation_en text not null default '' check (char_length(entete_delegation_en) <= 160),
  add column if not exists specialisation text not null default '' check (char_length(specialisation) <= 200);

-- lecture par le personnel ; modification par l'administration (règle RLS existante sur etablissements)
grant select (entete_pays, entete_devise_pays, entete_ministere, entete_delegation, entete_pays_en, entete_devise_pays_en,
              entete_ministere_en, entete_delegation_en, specialisation) on public.etablissements to authenticated;
grant update (entete_pays, entete_devise_pays, entete_ministere, entete_delegation, entete_pays_en, entete_devise_pays_en,
              entete_ministere_en, entete_delegation_en, specialisation) on public.etablissements to authenticated;

-- Professeur principal : obligatoirement un membre du personnel du même établissement ; retiré si le compte est supprimé
alter table public.classes add column if not exists professeur_principal_id uuid;
alter table public.classes drop constraint if exists classes_professeur_principal;
alter table public.classes add constraint classes_professeur_principal foreign key (professeur_principal_id, etablissement_id)
  references public.personnels (id, etablissement_id) on delete set null (professeur_principal_id);
create index if not exists classes_professeur_principal on public.classes (professeur_principal_id) where professeur_principal_id is not null;
