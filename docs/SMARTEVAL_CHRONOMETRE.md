# SmartEval — durée individuelle de composition (chronomètre)

Migration `0056_smarteval_chronometre.sql`. Fonctionne pour SmartEval d'établissement et SmartEval indépendant (Découverte et offres payantes), sans nouveau crédit.

## Principe
- L'enseignant fixe, avant publication, une durée par élève (15 min à 3 h proposées, ou durée personnalisée de 1 min à 12 h), stockée en secondes (`chrono_secondes`, `null` = pas de chronomètre). Option « Soumettre automatiquement les réponses à l'expiration du temps » (`chrono_auto`, activée par défaut).
- L'échéance générale du lien (`ferme_le`) est conservée : **échéance individuelle = min(début + durée, ferme_le)**. Si l'enseignant clôture plus tôt, les compositions en cours s'arrêtent à la clôture (`_smarteval_borner`). Aucun démarrage après la fermeture.
- Sans durée, SmartEval fonctionne exactement comme avant (formulaire direct, `smarteval_soumettre` inchangé).

## Tentatives (`smarteval_tentatives`)
Une ligne par élève et par évaluation (unicité évaluation + identité ; l'absence de ligne = « Non commencé »). Champs : début, durée, échéance, réponses sauvegardées, dernière sauvegarde, soumission, statut `en_cours` / `soumise` / `expiree`, numéro de copie. Le jeton secret de la tentative (48 caractères) et le code de reprise (8 caractères) ne sont conservés que sous forme d'empreinte SHA-256. Table inaccessible directement (RLS, aucun droit).

## Fonctions
| Fonction | Rôle | Accès |
|---|---|---|
| `smarteval_chrono_definir(id, secondes, auto)` | réglage (brouillon seulement, contrôle 60–43 200 s) | auteur |
| `smarteval_formulaire(jeton)` | évaluation chronométrée : présentation seulement (durée, nombre de questions, documents) ; questions et documents cachés avant le démarrage | public |
| `smarteval_demarrer(jeton, identité)` | verrouille l'évaluation, vérifie ouverture, identité, doublon, quota (les compositions en cours comptent), crée la tentative à l'heure du serveur ; renvoie questions, échéance, `maintenant`, jeton et code | public |
| `smarteval_reprendre(jeton, tentative \| identité + code)` | reprise après actualisation, fermeture ou changement d'appareil (le code change le jeton : l'ancien appareil ne peut plus écrire) ; clôture la tentative si le temps est écoulé | public |
| `smarteval_sauver(jeton, tentative, réponses)` | sauvegarde ; refusée après l'échéance (la copie est alors clôturée avec les réponses déjà enregistrées) | public |
| `smarteval_soumettre(jeton, {tentative, réponses})` | soumission anticipée ou à l'échéance, idempotente ; après l'échéance, les réponses envoyées sont ignorées | public |
| `smarteval_expirer()` | clôture des tentatives expirées (élève déconnecté) ; appelée chaque heure par le Worker `maintien` et à chaque consultation du suivi | public (sans effet hors des tentatives échues) |
| `smarteval_tentatives(id)` | suivi : élève, début, durée, échéance, soumission, temps utilisé, statut | auteur |

La copie est créée par `_smarteval_finaliser` avec la correction existante (`_smarteval_corriger`) et le rapprochement des élèves inscrits ; heure officielle = heure d'envoi, ou échéance en cas d'expiration. Aucune tolérance après l'échéance : seules comptent les réponses enregistrées par le serveur avant l'échéance.

## Côté élève (`CompositionChronometree.jsx`)
Identification → page de présentation (avertissement obligatoire) → « COMMENCER L'ÉVALUATION » → composition avec chronomètre HH:MM:SS fixe en haut (orange sous 10 min, rouge sous 5 min, avis à 10, 5 et 1 min), sauvegarde automatique (« Sauvegarde en cours », « Réponses sauvegardées », « Connexion perdue… »), bouton « Soumettre mon évaluation » avec confirmation, verrouillage et soumission automatique à zéro, nouvel essai tant que le réseau manque.
Le temps affiché vient de l'échéance du serveur corrigée du décalage mesuré (`maintenant`) : l'horloge de l'appareil n'est jamais crue. Hors ligne : les réponses sont gardées sur l'appareil et renvoyées au retour du réseau, **acceptées seulement si elles arrivent avant l'échéance**.

## Côté enseignant
Section « Durée individuelle de composition » dans les deux éditeurs ; tableau « Compositions chronométrées » dans les résultats (statuts En cours / Soumis / Temps écoulé ; « Non commencé » = élèves absents de la liste, aucun participant fictif).

## Limites connues
- Deux homonymes de la même classe partagent une identité (règle existante de SmartEval).
- La duplication d'une évaluation indépendante ne recopie pas la durée : à régler de nouveau avant publication.
- Un élève qui perd son appareil et son code de reprise ne peut pas reprendre (le temps continue ; la copie sera soumise automatiquement avec ses réponses déjà sauvegardées).
