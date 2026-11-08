// SmartEval : analyse des soumissions d'une évaluation digitalisée (taux de réussite, questions, notions, profils d'élèves).
// Module autonome (aucune dépendance) : copié à l'identique dans supabase/functions/mcp/smarteval.js pour le serveur MCP.

export const SEUIL_REUSSITE = 10           // note /20 à partir de laquelle l'élève a réussi l'évaluation
export const SEUIL_NOTION = 50             // % de réussite sous lequel une notion est « à revoir » pour un élève

const arrondi = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d)
const pourcent = (n, total) => (total ? arrondi((100 * n) / total, 1) : null)
const SANS_NOTION = "Sans notion précisée"

/** Questions corrigées automatiquement : options ou réponses acceptées, avec des points. */
export const estCorrigible = (q) => Number(q.points) > 0 &&
  ((["choix", "cases", "liste"].includes(q.type) && (q.bonnes || []).length > 0) || (q.type === "courte" && (q.acceptees || []).length > 0))

/** Réponse lisible : texte des options choisies plutôt que leur numéro. */
export function reponseTexte(q, v) {
  if (v === null || v === undefined || v === "") return ""
  if (q.type === "choix" || q.type === "liste") return q.options?.[v] ?? String(v)
  if (q.type === "cases") return (Array.isArray(v) ? v : [v]).map((i) => q.options?.[i] ?? String(i)).join(" ; ")
  return String(v)
}

/** Réponse attendue, lisible. */
export function attenduTexte(q) {
  if (["choix", "cases", "liste"].includes(q.type)) return (q.bonnes || []).map((i) => q.options?.[i]).filter(Boolean).join(" ; ")
  if (q.type === "courte") return (q.acceptees || []).join(" / ")
  return ""
}

/**
 * Analyse complète d'une évaluation : evaluation = { questions, soumissions: [{ nom, prenom, classe, matricule, note20, reponses, details }] }
 */
export function analyserEvaluation(evaluation) {
  const questions = evaluation.questions || [], soumissions = evaluation.soumissions || []
  const notees = soumissions.filter((s) => s.note20 !== null && s.note20 !== undefined).map((s) => Number(s.note20))
  const reussis = notees.filter((n) => n >= SEUIL_REUSSITE).length
  const tries = [...notees].sort((a, b) => a - b)
  const synthese = {
    soumissions: soumissions.length,
    moyenne: notees.length ? arrondi(notees.reduce((a, b) => a + b, 0) / notees.length) : null,
    mediane: tries.length ? arrondi(tries.length % 2 ? tries[(tries.length - 1) / 2] : (tries[tries.length / 2 - 1] + tries[tries.length / 2]) / 2) : null,
    plus_haute: tries.length ? tries[tries.length - 1] : null,
    plus_basse: tries.length ? tries[0] : null,
    reussis, taux_reussite: pourcent(reussis, notees.length),
    reponses_a_apprecier: soumissions.reduce((a, s) => a + (Number(s.a_corriger) || 0), 0),
  }
  const detail = (s, q) => (s.details || []).find((d) => d.id === q.id) || {}

  const parQuestion = questions.map((q, k) => {
    const corrigible = estCorrigible(q)
    const reponses = soumissions.map((s) => s.reponses?.[q.id]).filter((v) => v !== undefined && v !== null && v !== "")
    const justes = corrigible ? soumissions.filter((s) => detail(s, q).correct === true).length : null
    const repartition = ["choix", "liste", "cases", "echelle"].includes(q.type)
      ? (q.type === "echelle" ? Array.from({ length: q.echelle.max - q.echelle.min + 1 }, (_, i) => String(q.echelle.min + i)) : q.options)
        .map((libelle, i) => ({ reponse: libelle, nombre: reponses.filter((v) => (Array.isArray(v) ? v.includes(q.type === "echelle" ? i + q.echelle.min : i) : Number(v) === (q.type === "echelle" ? i + q.echelle.min : i))).length,
          bonne: (q.bonnes || []).includes(i) }))
      : null
    const erreurs = q.type === "courte" && corrigible
      ? Object.entries(soumissions.filter((s) => detail(s, q).correct === false && s.reponses?.[q.id]).reduce((m, s) => {
          const v = String(s.reponses[q.id]).trim().toLowerCase(); m[v] = (m[v] || 0) + 1; return m }, {}))
          .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reponse, nombre]) => ({ reponse, nombre }))
      : null
    return { numero: k + 1, id: q.id, intitule: q.intitule, type: q.type, notion: q.notion || "", points: Number(q.points) || 0, corrigible,
      attendu: attenduTexte(q), repondu: reponses.length, justes, taux_reussite: corrigible ? pourcent(justes, soumissions.length) : null,
      ...(repartition ? { repartition } : {}), ...(erreurs ? { erreurs_frequentes: erreurs } : {}) }
  })

  // Réussite par notion : questions corrigées regroupées par notion
  const notions = [...new Set(questions.filter(estCorrigible).map((q) => q.notion || SANS_NOTION))]
  const tauxEleve = (s, notion) => {
    const qs = questions.filter((q) => estCorrigible(q) && (q.notion || SANS_NOTION) === notion)
    const max = qs.reduce((a, q) => a + Number(q.points), 0), obt = qs.reduce((a, q) => a + (detail(s, q).correct ? Number(q.points) : 0), 0)
    return max ? pourcent(obt, max) : null
  }
  const nomEleve = (s) => `${s.nom} ${s.prenom}`.trim()
  const parNotion = notions.map((notion) => {
    const taux = soumissions.map((s) => ({ s, t: tauxEleve(s, notion) }))
    const moyenne = taux.length ? arrondi(taux.reduce((a, x) => a + x.t, 0) / taux.length, 1) : null
    return { notion, questions: questions.filter((q) => estCorrigible(q) && (q.notion || SANS_NOTION) === notion).length, taux_reussite: moyenne,
      eleves_en_difficulte: taux.filter((x) => x.t < SEUIL_NOTION).map((x) => nomEleve(x.s)),
      eleves_a_l_aise: taux.filter((x) => x.t === 100).map((x) => nomEleve(x.s)) }
  }).sort((a, b) => (a.taux_reussite ?? 101) - (b.taux_reussite ?? 101))

  const eleves = soumissions.map((s) => {
    const parN = Object.fromEntries(notions.map((n) => [n, tauxEleve(s, n)]))
    return { numero: s.numero, eleve: nomEleve(s), classe: s.classe, matricule: s.matricule || null, note20: s.note20 === null || s.note20 === undefined ? null : Number(s.note20),
      reussi: s.note20 === null || s.note20 === undefined ? null : Number(s.note20) >= SEUIL_REUSSITE, soumis_le: s.soumis_le,
      reussite_par_notion: parN, notions_a_revoir: notions.filter((n) => parN[n] !== null && parN[n] < SEUIL_NOTION),
      notions_maitrisees: notions.filter((n) => parN[n] === 100), reponses_a_apprecier: Number(s.a_corriger) || 0 }
  }).sort((a, b) => (b.note20 ?? -1) - (a.note20 ?? -1))

  return { synthese, par_question: parQuestion, par_notion: parNotion, eleves }
}

/** Copies lisibles des élèves : chaque question avec la réponse donnée, la réponse attendue et le résultat. */
export function copiesEleves(evaluation) {
  const questions = evaluation.questions || []
  return (evaluation.soumissions || []).map((s) => ({
    numero: s.numero, eleve: `${s.nom} ${s.prenom}`.trim(), classe: s.classe, matricule: s.matricule || null, note20: s.note20, soumis_le: s.soumis_le,
    reponses: questions.map((q, k) => {
      const d = (s.details || []).find((x) => x.id === q.id) || {}
      return { question: k + 1, notion: q.notion || "", intitule: q.intitule, reponse: reponseTexte(q, s.reponses?.[q.id]),
        attendu: attenduTexte(q), resultat: d.correct === true ? "juste" : d.correct === false ? "faux" : d.a_corriger ? "à apprécier" : "non noté",
        points: d.max ? `${d.obtenu}/${d.max}` : null }
    }),
  }))
}
