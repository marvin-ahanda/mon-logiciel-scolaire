// Parcours et orientation : décision de passage proposée pour chaque élève et mention officielle du bulletin annuel.
// La proposition part de la décision de fin d'année (critères de l'établissement), applique les règles de passage
// du niveau (et de la série) de l'élève, en tenant compte de l'orientation acceptée (choix de série ou demande).
// Rien n'est enregistré sans validation humaine. Voir supabase/migrations/0043_parcours_orientation.sql.

export const DECISIONS = {
  promu: "Promu(e)", redoublant: "Redoublant(e)", admis_sous_condition: "Admis(e) sous condition", oriente: "Orienté(e)",
  transfere: "Transféré(e)", change_cycle: "Changement de cycle", change_serie: "Changement de série",
  attente_conseil: "En attente du conseil de classe", sortant: "Sortant(e)", abandon: "Abandon", exclu: "Exclu(e)",
  attente_reinscription: "En attente de réinscription", diplome: "Fin de cycle / diplômé(e)",
}

/** Mentions par défaut (modifiables par l'établissement) ; {destination} = classe, ou niveau + série, ou filière. */
export const MENTIONS_DEFAUT = {
  promu: "Promu(e) en {destination}", redoublant: "Redoublant(e)", admis_sous_condition: "Admis(e) sous condition",
  oriente: "Orienté(e) vers {destination}", transfere: "Transféré(e) vers {destination}", change_cycle: "Promu(e) en {destination}",
  change_serie: "Admis(e) en {destination}", attente_conseil: "Décision du conseil de classe en attente", sortant: "Sortant(e)",
  abandon: "Abandon", exclu: "Exclu(e)", attente_reinscription: "En attente de réinscription", diplome: "Fin de cycle",
}
export const TYPES_REGLE = { promotion: "Promotion (même filière)", changement_cycle: "Changement de cycle", orientation: "Orientation (choix de série)", passerelle: "Passerelle (autre filière, langue ou enseignement technique)" }
export const SOUS_SYSTEMES = { general: "Enseignement général", technique: "Enseignement technique", anglophone: "Anglophone", bilingue: "Bilingue", autre: "Autre" }

const DECISION_DE_REGLE = { promotion: "promu", changement_cycle: "change_cycle", orientation: "promu", passerelle: "oriente" }

/** Libellé de destination : la classe si elle est connue, sinon niveau + série (forme courte), sinon la filière. */
export function libelleDestination({ classe, niveau, serie, filiere } = {}) {
  if (classe?.libelle) return classe.libelle
  const ns = [niveau?.libelle, serie?.code || serie?.libelle].filter(Boolean).join(" ")
  return ns || filiere?.libelle || ""
}

/** Mention officielle d'une décision. modeles : mentions propres à l'établissement ; modeleRegle : mention de la règle appliquée. */
export function mentionDe(decision, destination, { modeles = {}, modeleRegle = "", t = (x) => x } = {}) {
  let m = modeleRegle || modeles[decision] || t(MENTIONS_DEFAUT[decision] || "")
  if (!destination) m = m.replace(/\s*(en|vers|in|to|into)\s*\{destination\}/i, "").replace(/\{destination\}/g, "")
  return m.replace(/\{destination\}/g, destination).replace(/\s+/g, " ").trim()
}

const n = (v) => (v === null || v === undefined || v === "" ? null : Number(v))

/** Conditions d'une règle remplies ? conditions = { moyenne_min, matieres: [{ code, min }], decision: "admis" | "rattrapage" | "tous" } */
export function conditionsRemplies(conditions, s) {
  const c = conditions || {}
  const d = c.decision || "admis"
  if (d === "admis" && s.decisionFin !== "admis") return false
  if (d === "rattrapage" && !["admis", "rattrapage"].includes(s.decisionFin)) return false
  if (n(c.moyenne_min) !== null && !(s.moyenne !== null && s.moyenne !== undefined && s.moyenne >= n(c.moyenne_min))) return false
  for (const x of c.matieres || []) {
    if (n(x.min) === null) continue
    const l = (s.lignes || []).find((y) => String(y.code).toLowerCase() === String(x.code).toLowerCase())
    if (!l || l.note === null || l.note === undefined || l.note < n(x.min)) return false
  }
  return true
}

/**
 * Proposition pour un élève. s = { niveauId, serieId, classeId, moyenne, decisionFin ("admis" | "rattrapage" | "redouble" | "exclu" | null),
 * lignes: [{ code, note }], orientation: { serie_id, filiere_id, niveau_id, classe_id } | null }
 * regles = règles actives de l'établissement. Renvoie { decision, niveau_destination_id, serie_destination_id, filiere_destination_id,
 * classe_destination_id, regle_id, raison, choix: [règles possibles] }.
 */
export function proposer(s, regles, { niveaux = [] } = {}) {
  const base = { niveau_destination_id: null, serie_destination_id: null, filiere_destination_id: null, classe_destination_id: null, regle_id: null, choix: [] }
  if (s.decisionFin === "exclu") return { ...base, decision: "exclu", raison: "Critères d'exclusion remplis" }
  if (s.decisionFin === "redouble") return { ...base, decision: "redoublant", niveau_destination_id: s.niveauId, serie_destination_id: s.serieId, raison: "Critères de redoublement remplis" }
  if (!s.niveauId) return { ...base, decision: "attente_conseil", raison: "Classe sans niveau rattaché" }
  const possibles = regles.filter((r) => r.active !== false && r.niveau_origine_id === s.niveauId && (!r.serie_origine_id || r.serie_origine_id === s.serieId))
    .sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0))
  const remplies = possibles.filter((r) => conditionsRemplies(r.conditions, s))
  const o = s.orientation
  const correspond = (r) => o && ((o.serie_id && r.serie_destination_id === o.serie_id) || (!o.serie_id && o.filiere_id && r.filiere_destination_id === o.filiere_id)
    || (!o.serie_id && !o.filiere_id && o.niveau_id && r.niveau_destination_id === o.niveau_id))
  let regle = null, raison = ""
  if (o) {
    regle = remplies.find(correspond)
    if (!regle && possibles.some(correspond)) {
      return { ...base, decision: s.decisionFin === "rattrapage" ? "admis_sous_condition" : "attente_conseil", choix: remplies,
        raison: "Orientation acceptée, mais conditions d'accès à la série non remplies" }
    }
  }
  if (!regle) {
    const libres = remplies.filter((r) => !r.sur_demande)
    regle = libres[0] || null
    if (libres.length > 1) raison = "Plusieurs destinations possibles : vérifiez le choix"
  }
  if (!regle) {
    if (s.decisionFin === "rattrapage") return { ...base, decision: "admis_sous_condition", choix: remplies, raison: "Rattrapage" }
    if (!possibles.length && niveaux.find((x) => x.id === s.niveauId)?.fin_de_cycle && s.decisionFin === "admis")
      return { ...base, decision: "diplome", raison: "Fin de cycle" }
    return { ...base, decision: "attente_conseil", choix: remplies, raison: possibles.length ? "Conditions des règles de passage non remplies" : "Aucune règle de passage pour ce niveau" }
  }
  const classes = regle.classes_destination || []
  return {
    decision: s.decisionFin === "rattrapage" ? "admis_sous_condition" : DECISION_DE_REGLE[regle.type] || "promu",
    niveau_destination_id: regle.niveau_destination_id, serie_destination_id: regle.serie_destination_id || null,
    filiere_destination_id: regle.filiere_destination_id || null,
    classe_destination_id: o?.classe_id && (!classes.length || classes.includes(o.classe_id)) ? o.classe_id : classes.length === 1 ? classes[0] : null,
    regle_id: regle.id, choix: remplies, raison: raison || (o ? "Orientation acceptée" : "Règle de passage"),
  }
}
