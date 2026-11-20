// Récompenses et distinctions : éligibilité d'après les critères configurés par l'établissement (Paramètres →
// Récompenses et distinctions), puis sélection (tous les éligibles, ou les meilleurs par classe, niveau, cycle ou
// établissement, à la moyenne ou à la progression). Voir supabase/migrations/0041_distinctions.sql.
import { arrondi } from "./calculs.js"

/** Catégories proposées (le nom affiché reste libre). */
export const CATEGORIES = {
  tableau_honneur: "Tableau d'honneur", felicitations: "Félicitations", encouragements: "Encouragements",
  mention_tb: "Mention très bien", mention_b: "Mention bien", prix_excellence: "Prix d'excellence",
  major_classe: "Meilleur élève de la classe", major_etablissement: "Meilleur élève de l'établissement",
  meilleure_progression: "Meilleure progression", specifique: "Distinction propre à l'établissement",
}
export const PERIODICITES = { sequence: "Séquence", trimestre: "Trimestre", perso: "Période personnalisée (semestre…)", annee: "Année scolaire" }
export const PORTEES = { classe: "par classe", niveau: "par niveau", cycle: "par cycle", etablissement: "dans tout l'établissement" }
export const MODELES = { classique: "Classique institutionnel", moderne: "Moderne à bandeau", prestige: "Prestige (cadre orné)", epure: "Épuré minimaliste" }

const n = (v) => (v === null || v === undefined || v === "" ? null : Number(v))

/** La classe de l'élève fait-elle partie des élèves concernés ? cible = { classes, niveaux, cycles, sections } (vide = tous). */
export function dansCible(cible, classe) {
  const c = cible || {}
  const ok = (liste, valeur) => !Array.isArray(liste) || !liste.length || liste.map(String).includes(String(valeur ?? ""))
  return ok(c.classes, classe.id) && ok(c.niveaux, classe.niveau) && ok(c.cycles, classe.cycle) && ok(c.sections, classe.section_id)
}

/** Moyenne retenue : celle des élèves classés (ou, si l'établissement l'accepte, aussi celle des non classés). */
export const moyenneRetenue = (criteres, s) => (criteres?.classe_requise === false ? (s.moyenne ?? s.moyenneNonClassee ?? null) : (s.moyenne ?? null))

/** Progression par rapport à la période précédente (points), ou null. */
export function progression(s) {
  const m = s.moyenne ?? s.moyenneNonClassee, p = s.precedente
  return m === null || m === undefined || p === null || p === undefined ? null : arrondi(m - p)
}

/**
 * Vérifie les critères pour un élève. s = { moyenne, moyenneNonClassee, lignes: [{ code, matiere, note, groupe }],
 * groupes: [{ groupe, moyenne }], conduite: { nj, retards, note, sanctions }, paiement: { en_regle, solde } | null, precedente }.
 * Renvoie la liste des conditions non remplies (vide = éligible).
 */
export function conditionsManquantes(criteres, s) {
  const c = criteres || {}, manque = []
  const m = moyenneRetenue(c, s)
  if (n(c.moyenne_min) !== null && !(m !== null && m >= n(c.moyenne_min))) manque.push("moyenne_min")
  if (n(c.moyenne_max) !== null && !(m !== null && m < n(c.moyenne_max))) manque.push("moyenne_max")
  if (n(c.moyenne_min) === null && n(c.moyenne_max) === null && c.classe_requise !== false && m === null) manque.push("classe")
  if (n(c.note_min_toutes) !== null) {
    const notes = (s.lignes || []).map((l) => l.note).filter((x) => x !== null && x !== undefined)
    if (!notes.length || notes.some((x) => x < n(c.note_min_toutes))) manque.push("note_min_toutes")
  }
  for (const x of c.matieres || []) {
    if (n(x.min) === null) continue
    const l = (s.lignes || []).find((y) => String(y.code).toLowerCase() === String(x.code).toLowerCase())
    if (!l || l.note === null || l.note === undefined || l.note < n(x.min)) manque.push(`matiere:${x.code}`)
  }
  for (const x of c.groupes || []) {
    if (n(x.min) === null) continue
    const g = (s.groupes || []).find((y) => Number(y.groupe) === Number(x.groupe))
    if (!g || g.moyenne === null || g.moyenne === undefined || g.moyenne < n(x.min)) manque.push(`groupe:${x.groupe}`)
  }
  const cd = s.conduite || {}
  if (n(c.nj_max) !== null && (cd.nj ?? 0) > n(c.nj_max)) manque.push("nj_max")
  if (n(c.retards_max) !== null && (cd.retards ?? 0) > n(c.retards_max)) manque.push("retards_max")
  if (n(c.discipline_min) !== null && !(cd.note !== null && cd.note !== undefined && cd.note >= n(c.discipline_min))) manque.push("discipline_min")
  if (c.sans_sanction && (cd.sanctions ?? 0) > 0) manque.push("sans_sanction")
  if (c.paiement === "en_regle" && !(s.paiement && s.paiement.en_regle)) manque.push("paiement")
  if (c.paiement === "solde" && !(s.paiement && s.paiement.solde)) manque.push("paiement")
  if (n(c.progression_min) !== null) { const p = progression(s); if (p === null || p < n(c.progression_min)) manque.push("progression_min") }
  return manque
}

/** Clé de regroupement selon la portée de la sélection. */
function groupe(portee, classe) {
  if (portee === "classe") return `c:${classe.id}`
  if (portee === "niveau") return `n:${classe.niveau || classe.libelle}`
  if (portee === "cycle") return `y:${classe.cycle ?? ""}`
  return "e"
}

/**
 * Présélection : situations = [{ inscriptionId, eleve, classe: { id, libelle, niveau, cycle, section_id }, … }].
 * Renvoie [{ situation, valeurs: { moyenne, rang, progression, classe } }] trié par classe puis par mérite.
 * Mode « meilleurs » : les N premiers de chaque groupe (classe, niveau, cycle ou établissement), ex æquo inclus.
 */
export function preselection(distinction, situations) {
  const c = distinction.criteres || {}, sel = distinction.selection || { mode: "seuils" }
  const par = sel.par === "progression" ? "progression" : "moyenne"
  const valeur = (s) => (par === "progression" ? progression(s) : moyenneRetenue(c, s))
  let retenus = situations.filter((s) => dansCible(distinction.cible, s.classe) && conditionsManquantes(c, s).length === 0)
  if (sel.mode === "meilleurs") {
    retenus = retenus.filter((s) => valeur(s) !== null)
    const groupes = new Map()
    for (const s of retenus) { const k = groupe(sel.portee || "classe", s.classe); if (!groupes.has(k)) groupes.set(k, []); groupes.get(k).push(s) }
    const nombre = Math.max(1, Number(sel.nombre) || 1)
    retenus = [...groupes.values()].flatMap((g) => {
      const tries = [...g].sort((a, b) => valeur(b) - valeur(a))
      const seuil = tries[Math.min(nombre, tries.length) - 1] ? valeur(tries[Math.min(nombre, tries.length) - 1]) : null
      return tries.filter((s) => seuil !== null && valeur(s) >= seuil)      // ex æquo au dernier rang inclus
    })
  }
  return retenus
    .map((s) => ({ situation: s, valeurs: { moyenne: s.moyenne ?? s.moyenneNonClassee ?? null, rang: s.rang ?? null, progression: progression(s), classe: s.classe.libelle } }))
    .sort((a, b) => String(a.situation.classe.libelle).localeCompare(String(b.situation.classe.libelle), "fr")
      || (valeur(b.situation) ?? -99) - (valeur(a.situation) ?? -99))
}

/** Période précédente (pour la progression) : séquence ou trimestre précédent, période personnalisée précédente ; null sinon. */
export function periodePrecedente(periode, toutes) {
  const idx = toutes.findIndex((p) => p.code === periode.code)
  if (idx <= 0) return null
  const prec = toutes[idx - 1]
  return prec.type === periode.type ? prec : null
}

/** Remplace les variables {eleve}, {classe}… d'un texte de certificat. */
export function remplirTexte(modele, variables) {
  return String(modele || "").replace(/\{(\w+)\}/g, (tout, k) => (variables[k] === undefined || variables[k] === null ? "" : String(variables[k])))
}

/** Description lisible des critères (t : traduction). */
export function resumeCriteres(c, t = (x, v) => x.replace(/\{(\w+)\}/g, (_, k) => v?.[k] ?? "")) {
  const p = [], v = (x) => String(x).replace(".", ",")
  c = c || {}
  if (n(c.moyenne_min) !== null) p.push(t("moyenne ≥ {v0}", { v0: v(c.moyenne_min) }))
  if (n(c.moyenne_max) !== null) p.push(t("moyenne < {v0}", { v0: v(c.moyenne_max) }))
  if (n(c.note_min_toutes) !== null) p.push(t("aucune note < {v0}", { v0: v(c.note_min_toutes) }))
  for (const x of c.matieres || []) if (n(x.min) !== null) p.push(t("{v0} ≥ {v1}", { v0: x.code, v1: v(x.min) }))
  for (const x of c.groupes || []) if (n(x.min) !== null) p.push(t("groupe {v0} ≥ {v1}", { v0: x.groupe, v1: v(x.min) }))
  if (n(c.nj_max) !== null) p.push(t("absences non justifiées ≤ {v0} h", { v0: c.nj_max }))
  if (n(c.retards_max) !== null) p.push(t("retards ≤ {v0}", { v0: c.retards_max }))
  if (n(c.discipline_min) !== null) p.push(t("note de discipline ≥ {v0}", { v0: v(c.discipline_min) }))
  if (c.sans_sanction) p.push(t("aucune sanction", {}))
  if (c.paiement === "en_regle") p.push(t("en règle de pension", {}))
  if (c.paiement === "solde") p.push(t("pension soldée", {}))
  if (n(c.progression_min) !== null) p.push(t("progression ≥ {v0} pt", { v0: v(c.progression_min) }))
  return p.length ? p.join(" · ") : t("aucune condition", {})
}
