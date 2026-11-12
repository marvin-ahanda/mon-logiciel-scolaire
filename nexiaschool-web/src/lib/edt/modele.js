// Emploi du temps — modèle de données commun à l'interface, au moteur (Web Worker), aux exports et aux tests.
// Aucune dépendance au navigateur ni à React : ce module est chargé tel quel dans le Web Worker et dans les tests.
//
// Configuration (enregistrée dans le brouillon puis dans chaque version) :
// {
//   horaires: { jours: [1..7] (1 = lundi), debut: "07:30", fin: "15:30", duree: 55,
//               periodes: [{ debut, fin }],                                  // générées puis modifiables
//               pauses: [{ id, libelle, type: "pause"|"midi"|"interruption", debut, fin, jours: [] }] },  // jours vides = tous
//   salles: [{ id, nom, type }],                                             // copie des salles de l'établissement
//   enseignants: [{ cle, nom, prenom, matricule, personnel_id, jours: [], creneaux: [{ debut, fin }],
//                   max_jour, max_consecutives, max_semaine, jours_preferes: [] }],
//   affectations: [{ id, enseignant, classe_id, classe, discipline, matiere_id, volume }],
//   classes: { [classe_id]: { libelle, max_jour, max_consecutives, interdits: ["j-p"], matin: [discipline],
//                             salles: { [discipline]: type }, permanences: { heures, jours: [], debut, fin, eviter_extremites } } },
//   generales: { enseignant: { max_jour, max_consecutives, max_semaine, disponibilites: "strictes"|"preferences" },
//                classe: { max_jour, max_consecutives }, priorites: { [critere]: "haute"|"moyenne"|"faible"|"ignoree" } }
// }
// Grille (résultat) : [{ c: classe_id, j: jour (1..7), p: période (0..), a: id d'affectation | null (permanence), s: salle_id | null }]

export const JOURS = [[1, "Lundi"], [2, "Mardi"], [3, "Mercredi"], [4, "Jeudi"], [5, "Vendredi"], [6, "Samedi"], [7, "Dimanche"]]
export const NOM_JOUR = Object.fromEntries(JOURS)
export const TYPES_PAUSE = [["pause", "Pause / récréation"], ["midi", "Pause de midi"], ["interruption", "Interruption (pas de cours)"]]
export const PRIORITES = [["haute", "Élevée", 100], ["moyenne", "Moyenne", 10], ["faible", "Faible", 1], ["ignoree", "Ignorée", 0]]
export const POIDS = Object.fromEntries(PRIORITES.map(([k, , p]) => [k, p]))
/** Critères souples (contraintes de confort), du plus au moins important par défaut. */
export const CRITERES = [
  ["trous_classes", "Éviter les heures creuses des classes", "haute"],
  ["repetitions", "Éviter qu'une matière revienne deux fois dans la même journée (hors heures groupées)", "haute"],
  ["repartition", "Répartir les heures d'une matière sur la semaine", "haute"],
  ["disponibilites", "Respecter les disponibilités des enseignants (si elles sont de simples souhaits)", "haute"],
  ["trous_enseignants", "Éviter les heures creuses des enseignants", "moyenne"],
  ["fragmentation", "Regrouper les cours d'un enseignant sur peu de jours", "moyenne"],
  ["equilibre", "Équilibrer la charge des classes d'un jour à l'autre", "moyenne"],
  ["matin", "Placer le matin les matières choisies", "moyenne"],
  ["preferences", "Respecter les jours préférés des enseignants", "faible"],
  ["permanences", "Placer les permanences en début ou en fin de demi-journée", "faible"],
]
export const PERMANENCE = "Permanence"

// --- Heures -----------------------------------------------------------------------------------------------------
/** « 07:30 », « 7h30 », « 7 h », « 7.30 » -> 450 (minutes) ; null si illisible. */
export function minutes(v) {
  if (v === null || v === undefined) return null
  if (typeof v === "number" && Number.isFinite(v)) {
    // heure Excel (fraction de jour) : 0,3125 -> 07:30
    if (v >= 0 && v < 1) return Math.round(v * 1440)
    return null
  }
  if (v instanceof Date && !isNaN(v)) return v.getUTCHours() * 60 + v.getUTCMinutes()
  const m = String(v).trim().toLowerCase().match(/^(\d{1,2})\s*(?:[:h.]\s*(\d{1,2})?)?\s*(?:min)?$/)
  if (!m) return null
  const h = +m[1], mi = m[2] === undefined ? 0 : +m[2]
  if (h > 23 || mi > 59) return null
  return h * 60 + mi
}
/** 450 -> « 07:30 » */
export const hm = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`
/** 450 -> « 7h30 » (affichage) */
export const hAffiche = (n) => `${Math.floor(n / 60)}h${String(n % 60).padStart(2, "0")}`

// --- Configuration par défaut -------------------------------------------------------------------------------------
export function configParDefaut() {
  const horaires = {
    jours: [1, 2, 3, 4, 5], debut: "07:30", fin: "15:30", duree: 55,
    pauses: [
      { id: "p1", libelle: "Récréation", type: "pause", debut: "10:15", fin: "10:30", jours: [] },
      { id: "p2", libelle: "Pause de midi", type: "midi", debut: "12:20", fin: "13:00", jours: [] },
    ],
    periodes: [],
  }
  horaires.periodes = genererPeriodes(horaires)
  return {
    horaires, salles: [], enseignants: [], affectations: [], classes: {},
    generales: {
      enseignant: { max_jour: 6, max_consecutives: 4, max_semaine: 30, disponibilites: "strictes" },
      classe: { max_jour: 8, max_consecutives: 2 },
      priorites: Object.fromEntries(CRITERES.map(([k, , p]) => [k, p])),
    },
  }
}

/** Complète une configuration (ancien brouillon, import) avec les valeurs par défaut, sans rien écraser. */
export function completerConfig(c) {
  const d = configParDefaut()
  const x = { ...d, ...(c || {}) }
  x.horaires = { ...d.horaires, ...(c?.horaires || {}) }
  x.generales = {
    enseignant: { ...d.generales.enseignant, ...(c?.generales?.enseignant || {}) },
    classe: { ...d.generales.classe, ...(c?.generales?.classe || {}) },
    priorites: { ...d.generales.priorites, ...(c?.generales?.priorites || {}) },
  }
  x.salles = Array.isArray(x.salles) ? x.salles : []
  x.enseignants = Array.isArray(x.enseignants) ? x.enseignants : []
  x.affectations = Array.isArray(x.affectations) ? x.affectations : []
  x.classes = x.classes && typeof x.classes === "object" ? x.classes : {}
  return x
}

/**
 * Périodes de cours de la journée : de l'heure de début à l'heure de fin, par tranches de la durée choisie ;
 * une période ne chevauche jamais une pause qui s'applique à tous les jours (elle reprend à la fin de la pause).
 */
export function genererPeriodes(h) {
  const debut = minutes(h.debut), fin = minutes(h.fin), duree = Number(h.duree)
  if (debut === null || fin === null || !(duree >= 10 && duree <= 240) || fin <= debut) return []
  const pauses = (h.pauses || []).filter((p) => !(p.jours || []).length).map((p) => [minutes(p.debut), minutes(p.fin)])
    .filter(([a, b]) => a !== null && b !== null && b > a).sort((a, b) => a[0] - b[0])
  const res = []
  let t = debut
  while (t + duree <= fin && res.length < 16) {
    const gene = pauses.find(([a, b]) => t < b && t + duree > a)
    if (gene) { t = Math.max(t, gene[1]); continue }
    res.push({ debut: hm(t), fin: hm(t + duree) })
    t += duree
  }
  return res
}

/** « Prénom(s) » -> « prenoms » (casse, accents, espaces et ponctuation ignorés). */
export const normaliserTexte = (s) => String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "")

/** Message à traduire par l'interface : { k: texte français (clé de traduction), v: variables }. */
export const t = (k, v) => ({ k, v })

/** Erreurs de saisie des horaires (étape 1). */
export function erreursHoraires(h) {
  const e = []
  if (!h.jours?.length) e.push(t("Choisissez au moins un jour de fonctionnement."))
  const d = minutes(h.debut), f = minutes(h.fin)
  if (d === null || f === null) e.push(t("Heures de début et de fin invalides (format hh:mm)."))
  else if (f <= d) e.push(t("L'heure de fin doit suivre l'heure de début."))
  if (!(Number(h.duree) >= 10 && Number(h.duree) <= 240)) e.push(t("La durée d'une heure de cours doit être comprise entre 10 et 240 minutes."))
  const per = (h.periodes || []).map((p) => [minutes(p.debut), minutes(p.fin)])
  if (!per.length) e.push(t("Aucune période de cours : vérifiez les heures de début, de fin et la durée."))
  if (per.length > 16) e.push(t("Seize périodes au plus par jour."))
  per.forEach(([a, b], i) => {
    if (a === null || b === null || b <= a) e.push(t("Période {v0} : heures invalides.", { v0: i + 1 }))
    else if (i > 0 && per[i - 1][1] !== null && a < per[i - 1][1]) e.push(t("Période {v0} : elle commence avant la fin de la période {v1}.", { v0: i + 1, v1: i }))
  })
  ;(h.pauses || []).forEach((p) => {
    const a = minutes(p.debut), b = minutes(p.fin)
    if (a === null || b === null || b <= a) e.push(t("« {v0} » : heures invalides.", { v0: p.libelle || "Pause" }))
  })
  return e
}

// --- Grille horaire ------------------------------------------------------------------------------------------------
/**
 * Structure de calcul de la semaine :
 *  jours [n° de jour], P (périodes par jour), ouvert[d][p], contigu[d][p] (p et p+1 s'enchaînent sans pause de midi
 *  ni interruption), matin[d][p], debutDemi[d][p] / finDemi[d][p] (première / dernière période d'une demi-journée).
 * L'index d'un créneau est s = d * P + p (d = rang du jour dans la semaine).
 */
export function semaine(horaires) {
  const jours = [...(horaires.jours || [])].sort((a, b) => a - b)
  const per = (horaires.periodes || []).map((p) => ({ debut: minutes(p.debut), fin: minutes(p.fin) }))
  const P = per.length
  const pauses = (horaires.pauses || []).map((x) => ({ ...x, a: minutes(x.debut), b: minutes(x.fin) })).filter((x) => x.a !== null && x.b > x.a)
  const ouvert = [], contigu = [], matin = [], debutDemi = [], finDemi = []
  for (const j of jours) {
    const du = pauses.filter((x) => !(x.jours || []).length || x.jours.includes(j))
    const midi = du.filter((x) => x.type === "midi").sort((a, b) => a.a - b.a)[0]
    const limiteMatin = midi ? midi.a : 750
    const o = per.map((q) => !du.some((x) => q.debut < x.b && q.fin > x.a))
    // deux périodes s'enchaînent si aucune pause de midi ni interruption ne les sépare (une récréation ne les sépare pas)
    const c = per.map((q, p) => p + 1 < P && o[p] && o[p + 1]
      && !du.some((x) => (x.type === "midi" || x.type === "interruption") && x.a >= q.fin && x.b <= per[p + 1].debut))
    ouvert.push(o); contigu.push(c)
    matin.push(per.map((q) => q.fin <= limiteMatin))
    debutDemi.push(o.map((v, p) => v && (p === 0 || !c[p - 1])))
    finDemi.push(o.map((v, p) => v && !c[p]))
  }
  return { jours, P, per, ouvert, contigu, matin, debutDemi, finDemi, S: jours.length * P }
}

export const cleCreneau = (j, p) => `${j}-${p}`

/** Lignes de la grille d'affichage : périodes et pauses communes à tous les jours, dans l'ordre horaire. */
export function lignesGrille(horaires) {
  const lignes = (horaires.periodes || []).map((p, i) => ({ type: "periode", p: i, debut: minutes(p.debut), fin: minutes(p.fin), libelle: `${hAffiche(minutes(p.debut))} – ${hAffiche(minutes(p.fin))}` }))
  for (const x of horaires.pauses || []) {
    if ((x.jours || []).length) continue
    const a = minutes(x.debut), b = minutes(x.fin)
    if (a === null || b === null) continue
    if (lignes.some((l) => l.type === "periode" && l.debut < b && l.fin > a)) continue   // pause qui ferme une période : affichée dans la case
    lignes.push({ type: "pause", genre: x.type, debut: a, fin: b, libelle: `${hAffiche(a)} – ${hAffiche(b)}`, nom: x.libelle || "Pause" })
  }
  return lignes.sort((a, b) => a.debut - b.debut || (a.type === "pause" ? -1 : 1))
}

/** Pause ou interruption qui ferme la période p du jour j (pour l'affichage des cases fermées), ou null. */
export function fermeture(horaires, j, p) {
  const q = horaires.periodes?.[p]; if (!q) return null
  const a = minutes(q.debut), b = minutes(q.fin)
  if (!(horaires.jours || []).includes(j)) return { libelle: "Fermé", type: "interruption" }
  return (horaires.pauses || []).find((x) => (!(x.jours || []).length || x.jours.includes(j)) && a < minutes(x.fin) && b > minutes(x.debut)) || null
}

// --- Enseignants et cours ------------------------------------------------------------------------------------------
export const nomEnseignant = (e) => (e ? [e.nom, e.prenom].filter(Boolean).join(" ") : "")

/** Réglage d'un enseignant : valeur propre, sinon réglage général. */
export function reglageEnseignant(cfg, e, k) {
  const v = e?.[k]
  return v === null || v === undefined || v === "" ? cfg.generales.enseignant[k] : Number(v)
}
export function reglageClasse(cfg, classeId, k) {
  const v = cfg.classes?.[classeId]?.[k]
  return v === null || v === undefined || v === "" ? cfg.generales.classe[k] : Number(v)
}

/** Type de salle exigé pour une discipline dans une classe (salle spécialisée), ou "". */
export const typeSalle = (cfg, classeId, discipline) => cfg.classes?.[classeId]?.salles?.[discipline] || ""

/** Le créneau (jour j, période p) est-il dans les disponibilités déclarées de l'enseignant ? */
export function disponible(cfg, e, j, p) {
  if (!e) return true
  if ((e.jours || []).length && !e.jours.includes(j)) return false
  if ((e.creneaux || []).length) {
    const q = cfg.horaires.periodes[p]; const a = minutes(q.debut), b = minutes(q.fin)
    return e.creneaux.some((c) => minutes(c.debut) <= a && minutes(c.fin) >= b)
  }
  return true
}

/** La permanence peut-elle se tenir sur ce créneau (jours, plage horaire) ? */
export function permanencePossible(cfg, classeId, j, p) {
  const pm = cfg.classes?.[classeId]?.permanences
  if (!pm) return true
  if ((pm.jours || []).length && !pm.jours.includes(j)) return false
  const q = cfg.horaires.periodes[p]; const a = minutes(q.debut), b = minutes(q.fin)
  if (pm.debut && minutes(pm.debut) !== null && a < minutes(pm.debut)) return false
  if (pm.fin && minutes(pm.fin) !== null && b > minutes(pm.fin)) return false
  return true
}

/** Classes concernées : celles des affectations, puis celles qui n'ont que des permanences. */
export function classesDe(cfg) {
  const vues = new Map()
  for (const a of cfg.affectations) if (!vues.has(a.classe_id)) vues.set(a.classe_id, a.classe || cfg.classes?.[a.classe_id]?.libelle || "")
  for (const [id, c] of Object.entries(cfg.classes || {})) if (!vues.has(id) && Number(c.permanences?.heures) > 0) vues.set(id, c.libelle || "")
  return [...vues].map(([id, libelle]) => ({ id, libelle })).sort((a, b) => a.libelle.localeCompare(b.libelle, "fr", { numeric: true }))
}

/**
 * Cours à placer (une heure = une unité) : [{ id, a (affectation), cls, ens (clé enseignant | null), disc, type ("cours"|"perm"), salle (type exigé) }].
 */
export function coursAPlacer(cfg) {
  const res = []
  for (const a of cfg.affectations) {
    for (let k = 0; k < Number(a.volume); k++) {
      res.push({ id: res.length, a: a.id, cls: a.classe_id, ens: a.enseignant, disc: a.discipline, type: "cours", salle: typeSalle(cfg, a.classe_id, a.discipline) })
    }
  }
  for (const c of classesDe(cfg)) {
    const n = Number(cfg.classes?.[c.id]?.permanences?.heures) || 0
    for (let k = 0; k < n; k++) res.push({ id: res.length, a: null, cls: c.id, ens: null, disc: PERMANENCE, type: "perm", salle: "" })
  }
  return res
}

/** Récapitulatif des affectations : enseignants, classes, heures. */
export function recapitulatif(cfg) {
  const ens = new Map(), cls = new Map()
  for (const a of cfg.affectations) {
    ens.set(a.enseignant, (ens.get(a.enseignant) || 0) + Number(a.volume))
    cls.set(a.classe_id, (cls.get(a.classe_id) || 0) + Number(a.volume))
  }
  return { enseignants: ens.size, classes: cls.size, heures: [...ens.values()].reduce((s, v) => s + v, 0), parEnseignant: ens, parClasse: cls }
}

/** Petit générateur pseudo-aléatoire déterministe (mulberry32). */
export function aleatoire(graine) {
  let a = graine >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
/** Empreinte numérique stable d'un texte (graine reproductible à partir des données). */
export function empreinte(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
