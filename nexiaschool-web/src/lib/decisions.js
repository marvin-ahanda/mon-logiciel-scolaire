// Décisions de fin de période proposées sur les bulletins, d'après les critères fixés par l'administration
// (Paramètres → Décisions de fin de période). Voir supabase/migrations/0021_criteres_decision.sql.
import { MOYENNE_REUSSITE } from "./calculs.js"

/** Ordre d'examen : la décision la plus lourde d'abord. */
export const PRIORITE = ["exclu", "redouble", "rattrapage", "admis"]

/** Libellés par défaut (fin d'année / fin de trimestre) ; l'administration peut les remplacer critère par critère. */
export const LIBELLES_ANNEE = { admis: "Admis(e) en classe supérieure", rattrapage: "Admis(e) au rattrapage", redouble: "Redouble", exclu: "Exclu(e)" }
export const LIBELLES_TRIMESTRE = { admis: "Travail satisfaisant", redouble: "Risque de redoublement", exclu: "Exclu(e)" }
export const SANS_DECISION = "À l'appréciation du conseil de classe"

export const libelleParDefaut = (decision, periode) => (periode === "a" ? LIBELLES_ANNEE : LIBELLES_TRIMESTRE)[decision] || ""

const nombre = (v) => (v === null || v === undefined || v === "" ? null : Number(v))

/**
 * Un critère est rempli quand toutes ses conditions renseignées le sont.
 * situation = { moyenne, conduite: { nj, retards, note }, sanctions: Map(sanction_id -> nombre) }
 */
export function critereRempli(c, { moyenne, conduite, sanctions }) {
  const verif = (valeur, min, max) => {
    min = nombre(min); max = nombre(max)
    if (min === null && max === null) return true
    if (valeur === null || valeur === undefined) return false
    return (min === null || valeur >= min) && (max === null || valeur < max)
  }
  return verif(moyenne, c.moyenne_min, c.moyenne_max)
    && verif(conduite?.note ?? null, c.discipline_min, c.discipline_max)
    && verif(conduite?.nj ?? 0, c.heures_nj_min, c.heures_nj_max)
    && verif(conduite?.retards ?? 0, c.retards_min, null)
    && (!c.sanction_id || (sanctions?.get(c.sanction_id) || 0) >= Number(c.sanctions_min))
}

/**
 * Décision proposée pour une période (« t1 », « t2 », « t3 » ou « a ») : { decision, libelle } ou null.
 * Sans critère fixé : fin d'année = moyenne ≥ 10 admis(e), sinon redouble ; trimestre = pas de décision.
 * Critères fixés mais aucun rempli : fin d'année = « À l'appréciation du conseil de classe » ; trimestre = pas de mention.
 */
export function decisionProposee(criteres, periode, situation) {
  if (!["t1", "t2", "t3", "a"].includes(periode)) return null
  const liste = (criteres || []).filter((c) => c.periode === periode)
  if (!liste.length) {
    if (periode !== "a" || situation.moyenne === null || situation.moyenne === undefined) return null
    const d = situation.moyenne >= MOYENNE_REUSSITE ? "admis" : "redouble"
    return { decision: d, libelle: LIBELLES_ANNEE[d] }
  }
  for (const d of PRIORITE) {
    const c = liste.filter((x) => x.decision === d).sort((a, b) => a.ordre - b.ordre).find((x) => critereRempli(x, situation))
    if (c) return { decision: d, libelle: c.libelle || libelleParDefaut(d, periode) }
  }
  return periode === "a" ? { decision: null, libelle: SANS_DECISION } : null
}

/** Nombre de sanctions de chaque type reçues sur une période, par inscription : Map(inscription -> Map(sanction -> n)). */
export function sanctionsParEleve(incidents, sequencesPeriode) {
  const seqs = new Set(sequencesPeriode.map((s) => s.id)), m = new Map()
  for (const x of incidents || []) {
    const sid = x.infractions?.sanction_id
    if (!sid || !seqs.has(x.sequence_id)) continue
    if (!m.has(x.inscription_id)) m.set(x.inscription_id, new Map())
    const s = m.get(x.inscription_id); s.set(sid, (s.get(sid) || 0) + 1)
  }
  return m
}

/** Description lisible d'un critère : « moyenne ≥ 10 et heures d'absence non justifiées < 30 ». */
export function resumeCritere(c, nomSanction = () => "", t = (x, v) => x.replace(/\{(\w+)\}/g, (_, k) => v[k])) {
  const p = []
  const n = (v) => String(v).replace(".", ",")
  if (nombre(c.moyenne_min) !== null) p.push(t("moyenne ≥ {v0}", { v0: n(c.moyenne_min) }))
  if (nombre(c.moyenne_max) !== null) p.push(t("moyenne < {v0}", { v0: n(c.moyenne_max) }))
  if (nombre(c.discipline_min) !== null) p.push(t("note de discipline ≥ {v0}", { v0: n(c.discipline_min) }))
  if (nombre(c.discipline_max) !== null) p.push(t("note de discipline < {v0}", { v0: n(c.discipline_max) }))
  if (nombre(c.heures_nj_min) !== null) p.push(t("absences non justifiées ≥ {v0} h", { v0: c.heures_nj_min }))
  if (nombre(c.heures_nj_max) !== null) p.push(t("absences non justifiées < {v0} h", { v0: c.heures_nj_max }))
  if (nombre(c.retards_min) !== null) p.push(t("retards ≥ {v0}", { v0: c.retards_min }))
  if (c.sanction_id) p.push(t("« {v0} » reçu(e) au moins {v1} fois", { v0: nomSanction(c.sanction_id), v1: c.sanctions_min }))
  return p.length ? p.join(t(" et ", {})) : t("tous les élèves (aucune condition)", {})
}
