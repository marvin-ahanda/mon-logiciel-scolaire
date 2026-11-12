// Jeu d'essai réaliste pour les tests du moteur : un collège-lycée avec plusieurs dizaines d'enseignants.
// (Utilisé seulement par les tests automatisés ; aucune donnée réelle.)
import { aleatoire, configParDefaut } from "./modele.js"

const MATIERES = [["Mathématiques", 5], ["Français", 5], ["Anglais", 4], ["Histoire-Géographie", 3], ["SVT", 3], ["PCT", 3],
  ["Informatique", 2], ["EPS", 2], ["ECM", 1], ["Espagnol", 2]]

/** n classes, enseignants de 12 à 18 h, certains disponibles 3 ou 4 jours seulement. */
export function etablissementEssai({ classes = 20, graine = 7, permanences = 0, salleInfo = true, maxEns = 18 } = {}) {
  const r = aleatoire(graine)
  const cfg = configParDefaut()
  const cls = Array.from({ length: classes }, (_, i) => ({ id: `c${i + 1}`, libelle: `${["6e", "5e", "4e", "3e", "2nde"][i % 5]} ${String.fromCharCode(65 + Math.floor(i / 5))}` }))
  const enseignants = [], affectations = []
  let n = 0
  for (const [matiere, h] of MATIERES) {
    let courant = null, charge = 0
    for (const c of cls) {
      if (!courant || charge + h > maxEns) {
        n++
        const jours = r() < 0.3 ? [1, 2, 3, 4, 5].filter(() => r() < 0.85).slice(0, 4) : []
        courant = { cle: `e${n}`, nom: `Enseignant${n}`, prenom: matiere.slice(0, 3), matricule: `M${n}`, personnel_id: null,
                    jours: jours.length >= 3 ? jours : [], creneaux: [], jours_preferes: [] }
        enseignants.push(courant); charge = 0
      }
      affectations.push({ id: `a${affectations.length + 1}`, enseignant: courant.cle, classe_id: c.id, classe: c.libelle, discipline: matiere, matiere_id: null, volume: h })
      charge += h
    }
  }
  cfg.enseignants = enseignants
  cfg.affectations = affectations
  cfg.classes = Object.fromEntries(cls.map((c) => [c.id, { libelle: c.libelle, matin: ["Mathématiques", "Français"],
    salles: salleInfo ? { Informatique: "Informatique" } : {}, permanences: { heures: permanences, jours: [], debut: "", fin: "" } }]))
  cfg.salles = salleInfo ? [{ id: "s1", nom: "Salle info 1", type: "Informatique" }, { id: "s2", nom: "Salle info 2", type: "Informatique" }] : []
  return cfg
}
