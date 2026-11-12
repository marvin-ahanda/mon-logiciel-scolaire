// État du parcours de génération (brouillon) et configuration du moteur qui en découle.
// Le brouillon garde les données sources (horaires, lignes du fichier importé, réglages) ; la configuration du moteur
// est toujours recalculée à partir d'elles : revenir en arrière ne perd rien, et une correction se propage partout.
import { completerConfig, configParDefaut, empreinte, NOM_JOUR } from "./modele.js"

export function etatInitial() {
  const d = configParDefaut()
  return { horaires: d.horaires, periodesPerso: false, fichier: "", lignes: [], reglagesEnseignants: {}, classes: {}, generales: d.generales, resultat: null, nom: "" }
}

/** Reprise d'un brouillon (ou d'une version enregistrée) : valeurs manquantes complétées. */
export function reprendreEtat(donnees) {
  const d = etatInitial()
  if (!donnees || typeof donnees !== "object") return d
  const c = completerConfig({ horaires: donnees.horaires, generales: donnees.generales })
  return { ...d, ...donnees, horaires: c.horaires, generales: c.generales, lignes: Array.isArray(donnees.lignes) ? donnees.lignes : [],
    reglagesEnseignants: donnees.reglagesEnseignants || {}, classes: donnees.classes || {} }
}

/**
 * Configuration du moteur : horaires, salles de l'établissement, enseignants et affectations validés,
 * réglages individuels, contraintes des classes concernées.
 */
export function construireConfig(etat, salles, validation) {
  const affectations = validation?.ok ? validation.affectations : []
  const libelles = new Map(affectations.map((a) => [a.classe_id, a.classe]))
  const classes = {}
  for (const [id, c] of Object.entries(etat.classes || {})) {
    if (!libelles.has(id) && !(Number(c?.permanences?.heures) > 0)) continue
    classes[id] = { ...c, libelle: libelles.get(id) || c.libelle || "" }
  }
  const enseignants = (validation?.ok ? validation.enseignants : []).map(({ lignes: _, ...e }) => {
    const r = etat.reglagesEnseignants?.[e.cle] || {}
    return { ...e, max_jour: r.max_jour ?? null, max_consecutives: r.max_consecutives ?? null, max_semaine: r.max_semaine ?? null, jours_preferes: r.jours_preferes || [] }
  })
  return completerConfig({
    horaires: etat.horaires, generales: etat.generales,
    salles: (salles || []).map((s) => ({ id: s.id, nom: s.nom, type: s.type || "" })),
    enseignants, affectations, classes,
  })
}

/** Empreinte de la configuration : un résultat de génération n'est valable que pour la configuration qui l'a produit. */
export const signature = (cfg) => empreinte(JSON.stringify(cfg))

/**
 * Applique la réponse de l'utilisateur à une question (étapes 5 et 6) aux données sources du brouillon :
 * disponibilités et volumes dans les lignes importées, maximums dans les réglages. Rien n'est modifié sans réponse.
 */
export function repondre(etat, validation, q, valeur) {
  const x = structuredClone(etat)
  if (q.cible?.enseignant) {
    if (q.champ === "jours") {
      const numeros = new Set(validation.enseignants.find((e) => e.cle === q.cible.enseignant)?.lignes || [])
      const texte = [...valeur].sort().map((j) => NOM_JOUR[j]).join(", ")
      for (const l of x.lignes) if (numeros.has(l.numero)) l.valeurs.jours = texte
    } else {
      const r = (x.reglagesEnseignants[q.cible.enseignant] ||= {})
      r[q.champ] = Number(valeur)
    }
  } else if (q.cible?.classe) {
    const c = (x.classes[q.cible.classe] ||= {})
    if (q.champ === "permanences.heures") c.permanences = { ...(c.permanences || {}), heures: Number(valeur) }
    else c[q.champ] = Number(valeur)
  } else if (q.cible?.affectation) {
    const numero = validation.affectations.find((a) => a.id === q.cible.affectation)?.ligne
    const l = x.lignes.find((y) => y.numero === numero)
    if (l && q.champ === "volume") l.valeurs.volume = String(valeur)
  }
  x.resultat = null
  return x
}
