// Chargement des données des PV : structure de l'établissement (cycles, niveaux, sections, classes), périodes, réglages,
// puis résultats classe par classe (mêmes calculs que les bulletins), absences, finances et distinctions.
// Toutes les lectures passent par la sécurité des lignes de la base : chacun ne lit que ce que son rôle autorise.
import { supabase, toutCharger, verifier, rpc } from "../../supabase.js"
import { t } from "../../i18n.jsx"
import { chargerClasse, resultatsPeriode } from "../donneesClasse.js"
import { bilansPeriode, chargerDiscipline } from "../donneesDiscipline.js"
import { periodes as listePeriodes } from "../periodes.js"
import { periodePrecedente } from "../distinctions.js"
import { reglagesPv } from "./moteur.js"

const facultatif = (requete) => requete.then(verifier).catch(() => [])

/** Cycle d'une classe : celui de son niveau (Paramètres → Parcours), sinon l'ancien cycle 1 / 2 des finances. */
export function structurer(classes, { niveaux = [], cycles = [], sections = [] } = {}) {
  const niveauDe = new Map(niveaux.map((n) => [n.id, n]))
  const cycleDe = new Map(cycles.map((c) => [c.id, c]))
  const sectionDe = new Map(sections.map((s) => [s.id, s]))
  return classes.map((c) => {
    const niveau = niveauDe.get(c.niveau_id)
    const cycle = niveau?.cycle_id ? cycleDe.get(niveau.cycle_id) : null
    const ancien = c.cycle === 1 ? t("Premier cycle") : c.cycle === 2 ? t("Second cycle") : ""
    return {
      ...c,
      cycleId: cycle ? cycle.id : c.cycle ? `ancien:${c.cycle}` : "",
      cycleLibelle: cycle ? cycle.libelle : ancien,
      cycleOrdre: cycle ? cycle.ordre ?? 0 : c.cycle ?? 99,
      niveauLibelle: niveau?.libelle || c.niveau || "",
      sectionLibelle: sectionDe.get(c.section_id)?.libelle || "",
    }
  })
}

/** Cycles présents parmi les classes, dans l'ordre. */
export function cyclesDe(classes) {
  const m = new Map()
  for (const c of classes) if (c.cycleId && !m.has(c.cycleId)) m.set(c.cycleId, { id: c.cycleId, libelle: c.cycleLibelle, ordre: c.cycleOrdre })
  return [...m.values()].sort((a, b) => a.ordre - b.ordre || a.libelle.localeCompare(b.libelle, "fr"))
}

/** Référentiel commun aux quatre PV. */
export async function chargerReferencePv(exercice) {
  const [classes, niveaux, cycles, sections, sequences, perso, reglages, exercices] = await Promise.all([
    supabase.from("classes").select("*").order("ordre").order("libelle").then(verifier),
    facultatif(supabase.from("niveaux").select("id, libelle, cycle_id, ordre").order("ordre")),
    facultatif(supabase.from("cycles").select("id, libelle, ordre").order("ordre")),
    facultatif(supabase.from("sections").select("id, libelle, ordre").order("ordre")),
    exercice ? supabase.from("sequences").select("*").eq("exercice_id", exercice.id).order("numero").then(verifier) : [],
    facultatif(supabase.from("periodes_personnalisees").select("*").order("ordre")),
    supabase.from("pv_reglages").select("*").maybeSingle().then(verifier).catch(() => null),
    facultatif(supabase.from("exercices").select("id, libelle, actif").order("libelle", { ascending: false })),
  ])
  const structurees = structurer(classes, { niveaux, cycles, sections })
  return {
    classes: structurees, cycles: cyclesDe(structurees), sections, niveaux, sequences,
    periodes: listePeriodes(sequences, perso), reglages: reglagesPv(reglages), reglagesBruts: reglages, exercices,
  }
}

/** Exécute les tâches avec au plus `n` en parallèle (connexions lentes : on ne sature pas le réseau). */
async function parLots(elements, n, tache) {
  const resultats = new Array(elements.length)
  let suivant = 0
  await Promise.all(Array.from({ length: Math.min(n, elements.length) }, async () => {
    while (suivant < elements.length) { const k = suivant++; resultats[k] = await tache(elements[k], k) }
  }))
  return resultats
}

/** Situation financière (à jour ou non) de chaque inscription, si le rôle et l'offre le permettent ; sinon null. */
export async function chargerFinances() {
  try {
    const f = await rpc("finance_eleves", { p_classe: null })
    return new Map((f?.eleves || []).map((e) => [e.inscription_id, { en_regle: !!e.en_regle, reste: Number(e.reste ?? 0) }]))
  } catch { return null }
}

/**
 * Données d'un ensemble de classes pour une période : résultats, absences, moyennes de la période précédente.
 * Renvoie [{ classe, donnees, attributions, resultats, bilans, precedentes, finances }].
 */
export async function chargerGroupe(classes, exercice, periode, { toutes = [], finances = null, avancement = () => {} } = {}) {
  let fait = 0
  const prec = periodePrecedente(periode, toutes)
  const lots = await parLots(classes, 3, async (classe) => {
    const donnees = await chargerClasse(classe, exercice)
    avancement(++fait, classes.length)
    return { classe, donnees }
  })
  const ids = lots.flatMap((l) => l.donnees.eleves.map((e) => e.inscriptionId))
  const discipline = await chargerDiscipline(ids, exercice).catch(() => null)
  return lots.map(({ classe, donnees }) => {
    const insc = donnees.eleves.map((e) => e.inscriptionId)
    const res = resultatsPeriode(donnees, periode)
    const precedentes = prec
      ? new Map(resultatsPeriode(donnees, prec).resultats.map((r) => [r.inscriptionId, r.moyenne ?? r.moyenneNonClassee ?? null]))
      : new Map()
    return {
      classe, donnees, attributions: donnees.attributions, resultats: res.resultats, stats: res.stats, entetes: res.entetes,
      bilans: discipline ? bilansPeriode(discipline, insc, periode, donnees.sequences) : new Map(),
      precedentes, finances, discipline,
    }
  })
}

/** Recalcule un groupe déjà chargé pour une autre période (courbes d'évolution, comparaison de périodes) sans recharger. */
export function recalculerGroupe(groupe, periode, toutes = []) {
  const prec = periodePrecedente(periode, toutes)
  return groupe.map((g) => {
    const insc = g.donnees.eleves.map((e) => e.inscriptionId)
    const res = resultatsPeriode(g.donnees, periode)
    return {
      ...g, resultats: res.resultats, stats: res.stats, entetes: res.entetes,
      bilans: g.discipline ? bilansPeriode(g.discipline, insc, periode, g.donnees.sequences) : new Map(),
      precedentes: prec ? new Map(resultatsPeriode(g.donnees, prec).resultats.map((r) => [r.inscriptionId, r.moyenne ?? r.moyenneNonClassee ?? null])) : new Map(),
    }
  })
}

/** Distinctions publiées par inscription (noms), décisions de passage validées et commentaires des PV individuels. */
export async function chargerComplementsIndividuels(inscriptionIds, periodeCode) {
  const morceaux = []
  for (let k = 0; k < inscriptionIds.length; k += 150) morceaux.push(inscriptionIds.slice(k, k + 150))
  const parMorceaux = async (table, colonnes, filtre = (q) => q) => (await Promise.all(morceaux.map((ids) =>
    toutCharger(() => filtre(supabase.from(table).select(colonnes).in("inscription_id", ids))).catch(() => [])))).flat()
  const [attribuees, sessions, distinctions, decisions, commentaires, publies] = await Promise.all([
    parMorceaux("distinctions_attribuees", "inscription_id, session_id, retenu, revoque_le, code"),
    facultatif(supabase.from("distinctions_sessions").select("id, statut, periode_libelle, configuration, distinction_id")),
    facultatif(supabase.from("distinctions").select("id, nom")),
    parMorceaux("decisions_passage", "inscription_id, decision, mention, statut"),
    parMorceaux("pv_commentaires", "inscription_id, periode, commentaire, auteur, auteur_id, fonction, maj", (q) => q.eq("periode", periodeCode)),
    parMorceaux("pv_individuels_publies", "inscription_id, periode, publie_le", (q) => q.eq("periode", periodeCode)),
  ])
  const nomDistinction = new Map(distinctions.map((d) => [d.id, d.nom]))
  const session = new Map(sessions.map((s) => [s.id, s]))
  const distinctionsPar = new Map()
  for (const a of attribuees) {
    const s = session.get(a.session_id)
    if (!a.retenu || a.revoque_le || !a.code || s?.statut !== "publiee") continue
    const libelle = `${s.configuration?.nom || nomDistinction.get(s.distinction_id) || ""}${s.periode_libelle ? ` (${s.periode_libelle})` : ""}`
    distinctionsPar.set(a.inscription_id, [...(distinctionsPar.get(a.inscription_id) || []), libelle])
  }
  return {
    distinctions: distinctionsPar,
    decisions: new Map(decisions.filter((d) => d.statut === "validee" && d.mention).map((d) => [d.inscription_id, d.mention])),
    commentaires: commentaires.reduce((m, c) => m.set(c.inscription_id, [...(m.get(c.inscription_id) || []), c]), new Map()),
    publies: new Map(publies.map((p) => [p.inscription_id, p.publie_le])),
  }
}
