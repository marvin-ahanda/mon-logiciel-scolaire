// PV par cycle et PV général de l'établissement : même moteur, deux portées. Pourcentages, tableaux, graphiques de
// répartition, courbes d'évolution, comparaisons (autre période, autre année), synthèse automatique et commentaire.
import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Alerte } from "../../composants/Communs.jsx"
import { chargerFinances, chargerGroupe, recalculerGroupe } from "../../lib/pv/donnees.js"
import { comparer, pointEvolution, pvGroupe } from "../../lib/pv/moteur.js"
import { pvGroupePdf } from "../../lib/pv/pdf.js"
import { feuillesPvGroupe, telechargerCsv, telechargerExcel } from "../../lib/pv/export.js"
import { syntheseGroupe } from "../../lib/pv/textes.js"
import { periodes as listePeriodes } from "../../lib/periodes.js"
import { nomComplet, note, pourcentage } from "../../lib/format.js"
import { supabase, verifier } from "../../supabase.js"
import { useSession } from "../../Session.jsx"
import { t } from "../../i18n.jsx"
import { Barres, Courbes, libelleSeuil, Tuiles } from "./Graphiques.jsx"
import { ChoixPeriode, classesFiltrees, Commentaire, contexteDocument, Filtres, Generation, nomFichierPv, useReferencePv } from "./Outils.jsx"

const ecartTexte = (e) => (e === null || e === undefined ? "—" : `${e > 0 ? "+" : ""}${note(e)}`)

/** mode : « cycle » ou « etablissement ». */
export default function PvGroupe({ mode }) {
  const ref = useReferencePv()
  const session = useSession()
  const [params] = useSearchParams()
  const [filtres, setFiltres] = useState({ cycle: params.get("cycle") || "", section: params.get("section") || "", niveau: "" })
  const [periodeCode, setPeriodeCode] = useState(params.get("periode") || "")
  const [comparaison, setComparaison] = useState({ type: "aucune", periode: "", exercice: "" })
  const [options, setOptions] = useState({ parEnseignant: false, sexe: ref.reglages.repartition_sexe, finances: true, evolution: true })
  const [etat, setEtat] = useState({ enCours: false, avancement: "", erreur: "", resultat: null })
  const periode = ref.periodes.find((p) => p.code === periodeCode)
  const classes = classesFiltrees(ref.classes, mode === "cycle" ? filtres : { ...filtres, cycle: "", niveau: "" })
  const cycle = ref.cycles.find((c) => c.id === filtres.cycle)
  const pret = periode && classes.length && (mode !== "cycle" || cycle)
  const autresExercices = ref.exercices.filter((x) => x.id !== session.exercice?.id)

  async function preparer() {
    setEtat({ enCours: true, avancement: "", erreur: "", resultat: null })
    try {
      const finances = options.finances ? await chargerFinances() : null
      const avancement = (fait, total) => setEtat((e) => ({ ...e, avancement: t("Classe {v0} sur {v1}…", { v0: fait, v1: total }) }))
      const groupe = await chargerGroupe(classes, session.exercice, periode, { toutes: ref.periodes, finances, avancement })
      const pv = pvGroupe(groupe, ref.reglages, { parEnseignant: options.parEnseignant })
      const evolution = options.evolution ? ref.periodes.filter((p) => p.type === "sequence")
        .map((p) => pointEvolution(p.libelle, pvGroupe(recalculerGroupe(groupe, p, ref.periodes), ref.reglages)))
        .filter((p) => p.moyenne !== null) : []
      let comp = null, libelleComparaison = ""
      if (comparaison.type === "periode" && comparaison.periode) {
        const p2 = ref.periodes.find((p) => p.code === comparaison.periode)
        comp = comparer(pv, pvGroupe(recalculerGroupe(groupe, p2, ref.periodes), ref.reglages, { parEnseignant: options.parEnseignant }))
        libelleComparaison = p2.libelle
      } else if (comparaison.type === "annee" && comparaison.exercice) {
        const ex = ref.exercices.find((x) => x.id === comparaison.exercice)
        const sequences = verifier(await supabase.from("sequences").select("*").eq("exercice_id", ex.id).order("numero"))
        const p2 = listePeriodes(sequences, []).find((p) => p.code === periode.code) || (periode.type === "perso" ? periode : null)
        if (!p2) throw new Error(t("La période choisie n'existe pas pour l'année {v0}.", { v0: ex.libelle }))
        const autre = await chargerGroupe(classes, ex, p2, { avancement })
        comp = comparer(pv, pvGroupe(autre, ref.reglages, { parEnseignant: options.parEnseignant }))
        libelleComparaison = `${periode.libelle} ${ex.libelle}`
      }
      setEtat({ enCours: false, avancement: "", erreur: "", resultat: { pv, evolution, comparaison: comp, libelleComparaison, periode, classes, cycle, options } })
    } catch (e) { setEtat({ enCours: false, avancement: "", erreur: e.message, resultat: null }) }
  }

  const titre = mode === "cycle" ? t("PV par cycle") : t("PV général de l'établissement")
  return (
    <section aria-labelledby="pv-groupe-titre">
      <h2 className="h5" id="pv-groupe-titre">{titre}</h2>
      <p className="text-muted small">{mode === "cycle"
        ? t("Performances globales d'un cycle : par classe, par matière et, si vous le souhaitez, par enseignant ; pourcentages, graphiques, comparaisons.")
        : t("Vision globale pour la direction : effectifs, présence, réussite, difficultés, progression, pensions, évolution et comparaisons entre classes, cycles et périodes.")}</p>
      <div className="row g-2 mb-2">
        <Filtres valeur={filtres} onChange={setFiltres} champs={mode === "cycle" ? ["cycle", "section", "niveau"] : ["section"]} />
        <ChoixPeriode valeur={periodeCode} onChange={setPeriodeCode} />
      </div>
      {mode === "cycle" && !ref.cycles.length && <div className="alert alert-info small">{t("Aucun cycle défini : créez vos cycles dans Paramètres → Parcours, ou indiquez le cycle des classes dans Paramètres.")}</div>}
      <div className="row g-2 mb-2 align-items-end">
        <div className="col-sm-6 col-lg-3"><label className="form-label small mb-1">{t("Comparer avec")}</label>
          <select className="form-select form-select-sm" value={comparaison.type} onChange={(e) => setComparaison({ ...comparaison, type: e.target.value })}>
            <option value="aucune">{t("Aucune comparaison")}</option><option value="periode">{t("Une autre période")}</option>
            {autresExercices.length > 0 && <option value="annee">{t("La même période d'une autre année")}</option>}</select></div>
        {comparaison.type === "periode" && <ChoixPeriode libelle={t("Période de comparaison")} valeur={comparaison.periode} exclure={periodeCode}
          onChange={(v) => setComparaison({ ...comparaison, periode: v })} />}
        {comparaison.type === "annee" && (
          <div className="col-sm-6 col-lg-3"><label className="form-label small mb-1">{t("Année scolaire")}</label>
            <select className="form-select form-select-sm" value={comparaison.exercice} onChange={(e) => setComparaison({ ...comparaison, exercice: e.target.value })}>
              <option value="">{t("Année…")}</option>{autresExercices.map((x) => <option key={x.id} value={x.id}>{x.libelle}</option>)}</select></div>)}
      </div>
      {comparaison.type === "periode" && <p className="small text-muted">{t("Pour mesurer l'effet d'une action corrective, comparez la période qui la suit à celle qui la précède.")}</p>}
      <div className="d-flex flex-wrap gap-3 small mb-3">
        {[["parEnseignant", t("Détail par enseignant")], ["sexe", t("Répartition filles / garçons")], ["finances", t("Situation des pensions")], ["evolution", t("Courbes d'évolution (séquences)")]].map(([k, l]) => (
          <div className="form-check" key={k}><input className="form-check-input" type="checkbox" id={`pvg-${k}`} checked={options[k]}
            onChange={(e) => setOptions({ ...options, [k]: e.target.checked })} /><label className="form-check-label" htmlFor={`pvg-${k}`}>{l}</label></div>))}
      </div>
      <button type="button" className="btn btn-primary mb-3" disabled={!pret || etat.enCours} onClick={preparer}>
        {etat.enCours ? (etat.avancement || t("Calcul en cours…")) : t("Préparer le PV ({v0} classe(s))", { v0: classes.length })}</button>
      {!pret && <p className="text-muted small">{mode === "cycle" ? t("Choisissez un cycle et une période.") : t("Choisissez une période.")}</p>}
      <Alerte>{etat.erreur}</Alerte>
      {etat.resultat && <Resultat mode={mode} r={etat.resultat} titre={titre} />}
    </section>
  )
}

function Resultat({ mode, r, titre }) {
  const ref = useReferencePv()
  const session = useSession()
  const [commentaire, setCommentaire] = useState("")
  const [tousDifficulte, setTousDifficulte] = useState(false)
  const { pv } = r, g = pv.global
  const portee = mode === "cycle" ? r.cycle?.libelle : session.etablissement?.nom
  const sousTitre = `${portee || ""} · ${r.periode.libelle} · ${session.exercice?.libelle || ""}`
  const titreComplet = `${titre} — ${sousTitre}`
  const synthese = syntheseGroupe(pv, { comparaison: r.comparaison, libelleComparaison: r.libelleComparaison })

  async function produire({ format, reference, genereLe, ressources }) {
    const nom = nomFichierPv(mode === "cycle" ? t("pv-cycle") : t("pv-etablissement"), portee, r.periode.code, reference)
    const feuilles = () => feuillesPvGroupe(pv, { titre: `${titreComplet} · ${reference}`, evolution: r.evolution, comparaison: r.comparaison, libelleComparaison: r.libelleComparaison })
    if (format === "xlsx") return telechargerExcel(feuilles(), nom)
    if (format === "csv") return telechargerCsv(feuilles(), nom)
    return pvGroupePdf(pv, { ...contexteDocument(session, ref, { titre, sousTitre, reference, genereLe, ressources, commentaire }),
      type: mode, evolution: r.evolution, comparaison: r.comparaison, libelleComparaison: r.libelleComparaison, sexe: r.options.sexe }, nom)
  }

  return (
    <div className="pv-resultat">
      <Tuiles elements={[
        { libelle: t("Effectif"), valeur: g.effectif, aide: r.options.sexe ? t("{v0} G · {v1} F", { v0: g.garcons, v1: g.filles }) : null },
        { libelle: t("Moyenne générale"), valeur: g.moyenne === null ? "—" : note(g.moyenne) },
        { libelle: t("Réussite"), valeur: pourcentage(g.tauxReussite), ton: "succes", aide: libelleSeuil(pv.seuil) },
        { libelle: t("En difficulté"), valeur: pourcentage(g.tauxDifficulte), ton: "alerte", aide: t("{v0} élève(s)", { v0: g.enDifficulte }) },
        { libelle: t("Présence"), valeur: pourcentage(g.tauxPresence), aide: t("{v0} h NJ", { v0: g.heuresNJ }) },
        g.financeConnue ? { libelle: t("À jour (pension)"), valeur: pourcentage(g.tauxAJour), aide: t("{v0} non à jour", { v0: pourcentage(g.tauxInsolvables) }) }
          : { libelle: t("Progression"), valeur: pourcentage(g.tauxProgression), aide: t("{v0} en régression", { v0: pourcentage(g.tauxRegression) }) },
      ]} />
      {g.financeConnue > 0 && <p className="small text-muted">{t("Progression : {v0} des élèves ; régression : {v1}.", { v0: pourcentage(g.tauxProgression), v1: pourcentage(g.tauxRegression) })}</p>}
      {mode === "etablissement" && (
        <div className="row g-3">
          {[[t("Par cycle"), pv.parCycle], [t("Par niveau"), pv.parNiveau], [t("Par section"), pv.parSection]].filter(([, l]) => l.length > 1).map(([titreT, liste]) => (
            <div className="col-lg-4" key={titreT}><h3 className="h6">{titreT}</h3>
              <table className="table table-sm small"><thead><tr><th></th><th className="text-end">{t("Effectif")}</th><th className="text-end">{t("Moyenne")}</th><th className="text-end">{t("Réussite")}</th></tr></thead>
                <tbody>{liste.map((x) => <tr key={x.cle}><td>{x.libelle || "—"}</td><td className="text-end">{x.effectif}</td><td className="text-end">{x.moyenne === null ? "—" : note(x.moyenne)}</td>
                  <td className="text-end">{pourcentage(x.tauxReussite)}</td></tr>)}</tbody></table></div>))}
        </div>)}
      <h3 className="h6">{t("Par classe")}</h3>
      <div className="table-responsive mb-3"><table className="table table-sm table-hover small align-middle">
        <thead className="table-light"><tr><th>{t("Classe")}</th><th className="text-end">{t("Effectif")}</th>{r.options.sexe && <><th className="text-end">{t("G")}</th><th className="text-end">{t("F")}</th></>}
          <th className="text-end">{t("Moyenne")}</th><th className="text-end">{t("Réussite")}</th><th className="text-end">{t("Échec")}</th>
          {r.options.sexe && <><th className="text-end">{t("Réussite G")}</th><th className="text-end">{t("Réussite F")}</th></>}
          <th className="text-end">{t("Absentéisme")}</th>{g.financeConnue > 0 && <th className="text-end">{t("À jour")}</th>}
          {r.comparaison && <th className="text-end">{t("Écart")}</th>}</tr></thead>
        <tbody>{pv.parClasse.map((c) => {
          const comp = r.comparaison?.classes.find((x) => x.classe.id === c.classe.id)
          return (
            <tr key={c.classe.id}><td>{c.classe.libelle}</td><td className="text-end">{c.effectif}</td>{r.options.sexe && <><td className="text-end">{c.garcons}</td><td className="text-end">{c.filles}</td></>}
              <td className="text-end">{c.moyenne === null ? "—" : note(c.moyenne)}</td><td className="text-end">{pourcentage(c.tauxReussite)}</td><td className="text-end">{pourcentage(c.tauxEchec)}</td>
              {r.options.sexe && <><td className="text-end">{pourcentage(c.reussiteGarcons)}</td><td className="text-end">{pourcentage(c.reussiteFilles)}</td></>}
              <td className="text-end">{pourcentage(c.tauxAbsenteisme)}</td>{g.financeConnue > 0 && <td className="text-end">{pourcentage(c.tauxAJour)}</td>}
              {r.comparaison && <td className={`text-end ${comp?.ecart > 0 ? "text-success" : comp?.ecart < 0 ? "text-danger" : ""}`}>{ecartTexte(comp?.ecart)}</td>}</tr>)
        })}</tbody></table></div>
      <div className="row g-3">
        <div className="col-lg-6"><Barres titre={t("Taux de réussite par classe")} seuil={50} elements={pv.parClasse.map((c) => ({ libelle: c.classe.libelle, valeur: c.tauxReussite }))} /></div>
        <div className="col-lg-6"><Barres titre={t("Répartition des moyennes")} elements={pv.repartition.map((x) => ({ libelle: x.libelle, valeur: x.pourcentage }))} /></div>
        <div className="col-lg-6"><Barres titre={t("Taux de réussite par matière")} seuil={50} elements={pv.parMatiere.map((m) => ({ libelle: m.matiere, valeur: m.tauxReussite }))} /></div>
        {r.evolution.length > 1 && (
          <div className="col-lg-6">
            <Courbes titre={t("Évolution de la moyenne générale")} libelles={r.evolution.map((p) => p.libelle)} series={[{ nom: t("Moyenne générale"), valeurs: r.evolution.map((p) => p.moyenne) }]} />
            <Courbes titre={t("Évolution du taux de réussite")} max={100} libelles={r.evolution.map((p) => p.libelle)} series={[{ nom: t("Taux de réussite (%)"), valeurs: r.evolution.map((p) => p.tauxReussite) }]} />
          </div>)}
      </div>
      {pv.parEnseignant && (
        <><h3 className="h6">{t("Par enseignant")}</h3>
          <div className="table-responsive mb-3"><table className="table table-sm small"><thead className="table-light"><tr><th>{t("Enseignant")}</th><th>{t("Matières")}</th><th>{t("Classes")}</th>
            <th className="text-end">{t("Moyenne")}</th><th className="text-end">{t("Réussite")}</th></tr></thead>
            <tbody>{pv.parEnseignant.map((e) => <tr key={e.enseignant} className={pv.aSuivre.enseignants.includes(e) ? "table-warning" : ""}><td>{e.enseignant}</td><td>{e.matieres.join(", ")}</td>
              <td>{e.classes.join(", ")}</td><td className="text-end">{e.moyenne === null ? "—" : note(e.moyenne)}</td><td className="text-end">{pourcentage(e.tauxReussite)}</td></tr>)}</tbody></table></div></>)}
      {r.comparaison && (
        <><h3 className="h6">{t("Comparaison avec {v0}", { v0: r.libelleComparaison })}</h3>
          <table className="table table-sm small" style={{ maxWidth: 640 }}><thead><tr><th></th><th className="text-end">{t("Actuel")}</th><th className="text-end">{r.libelleComparaison}</th><th className="text-end">{t("Écart")}</th></tr></thead>
            <tbody>{r.comparaison.global.map((x) => <tr key={x.cle}><td>{t(LIBELLES_INDICATEURS[x.cle])}</td><td className="text-end">{x.courant === null || x.courant === undefined ? "—" : note(x.courant)}</td>
              <td className="text-end">{x.reference === null || x.reference === undefined ? "—" : note(x.reference)}</td><td className="text-end">{ecartTexte(x.ecart)}</td></tr>)}</tbody></table></>)}
      <div className="row g-3">
        <div className="col-lg-6"><h3 className="h6">{t("Meilleures performances")}</h3>
          <ol className="small">{pv.meilleures.map((x, k) => <li key={k}>{nomComplet(x.eleve)} ({x.classe.libelle}) : <strong>{note(x.moyenne)}</strong></li>)}</ol></div>
        <div className="col-lg-6"><h3 className="h6">{t("Élèves en difficulté ({v0})", { v0: pv.enDifficulte.length })}</h3>
          <ul className="small">{(tousDifficulte ? pv.enDifficulte : pv.enDifficulte.slice(0, 15)).map((x, k) => <li key={k}>{nomComplet(x.eleve)} ({x.classe.libelle}) : {note(x.moyenne)}</li>)}</ul>
          {pv.enDifficulte.length > 15 && <button type="button" className="btn btn-link btn-sm p-0" onClick={() => setTousDifficulte(!tousDifficulte)}>{tousDifficulte ? t("Réduire") : t("Voir tout")}</button>}</div>
      </div>
      {(pv.aSuivre.matieres.length > 0 || pv.aSuivre.enseignants.length > 0) && (
        <div className="alert alert-warning small"><strong>{t("À suivre (réussite sous {v0}) :", { v0: pourcentage(pv.aSuivre.seuil) })}</strong>{" "}
          {[...pv.aSuivre.matieres.map((m) => m.matiere), ...pv.aSuivre.enseignants.map((e) => e.enseignant)].join(", ")}</div>)}
      <div className="pv-synthese mb-3"><h3 className="h6">{t("Synthèse")}</h3><ul className="small mb-0">{synthese.map((s, k) => <li key={k}>{s}</li>)}</ul></div>
      <Commentaire valeur={commentaire} onChange={setCommentaire} />
      <Generation produire={produire} document={{ type: mode, titre: titreComplet, commentaire, partiel: false, avertissements: [],
        perimetre: { cycle: r.cycle?.id || null, cycle_libelle: r.cycle?.libelle || null, periode: r.periode.code, classes: r.classes.length,
          comparaison: r.libelleComparaison || null, options: r.options } }} />
    </div>
  )
}

const LIBELLES_INDICATEURS = { effectif: "Effectif", moyenne: "Moyenne générale", tauxReussite: "Réussite (%)", tauxEchec: "Échec (%)", tauxDifficulte: "En difficulté (%)",
  tauxAbsenteisme: "Absentéisme (%)", tauxProgression: "Progression (%)", tauxAJour: "À jour de pension (%)" }
