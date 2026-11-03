import { useState } from "react"
import { NavLink, Route, Routes } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import ChoixClassePeriode from "../composants/ChoixClassePeriode.jsx"
import { chargerClasse, resultatsPeriode } from "../lib/donneesClasse.js"
import { date, note } from "../lib/format.js"
import { periodes } from "../lib/periodes.js"
import { SEXES, effectifsSexeAge, resume, statistiquesClasse } from "../lib/statistiques.js"
import { useSession } from "../Session.jsx"
import { supabase, toutCharger, verifier } from "../supabase.js"

const pct = (v) => (v === null || v === undefined ? "—" : `${note(v)} %`)
const n2 = (v) => (v === null || v === undefined ? "—" : note(v))

function CellulesResume({ r }) {
  if (!r.n) return <><td className="text-end">0</td><td colSpan={5} className="text-end text-muted">—</td></>
  return <><td className="text-end">{r.n}</td><td className="text-end">{n2(r.moyenne)}</td><td className="text-end">{n2(r.min)}</td>
    <td className="text-end">{n2(r.max)}</td><td className="text-end">{r.reussite}</td><td className="text-end">{pct(r.taux)}</td></>
}
const ENTETES_RESUME = ["Nombre", "Moyenne", "Min", "Max", "≥ 10", "Réussite"]

export default function Statistiques() {
  const onglet = ({ isActive }) => "nav-link" + (isActive ? " active" : "")
  return (
    <>
      <h1 className="h3 mb-3 no-print">Statistiques</h1>
      <ul className="nav nav-tabs mb-3 no-print flex-nowrap overflow-auto">
        <li className="nav-item"><NavLink className={onglet} to="/statistiques" end>Par classe</NavLink></li>
        <li className="nav-item"><NavLink className={onglet} to="/statistiques/comparaison">Comparaison des classes</NavLink></li>
        <li className="nav-item"><NavLink className={onglet} to="/statistiques/effectifs">Effectifs par sexe et âge</NavLink></li>
      </ul>
      <Routes>
        <Route index element={<ChoixClassePeriode>{(c, p) => <ParClasse key={c.id + p.code} classe={c} periode={p} />}</ChoixClassePeriode>} />
        <Route path="comparaison" element={<Comparaison />} />
        <Route path="effectifs" element={<Effectifs />} />
      </Routes>
    </>
  )
}

// --- Par classe --------------------------------------------------------------------------------------------
function ParClasse({ classe, periode }) {
  const { exercice } = useSession()
  const [donnees, erreur] = useDonnees(() => chargerClasse(classe, exercice), [classe.id])
  if (!donnees) return <><Alerte>{erreur}</Alerte><Chargement /></>
  const { resultats, stats } = resultatsPeriode(donnees, periode)
  const s = statistiquesClasse(resultats, donnees.attributions)
  const maxi = Math.max(1, ...s.repartition.map((l) => l.total))
  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-2">
        <h2 className="h5 m-0">{classe.libelle} — {periode.libelle} ({exercice.libelle})</h2>
        <button className="btn btn-outline-secondary btn-sm no-print" onClick={() => window.print()}>Imprimer</button>
      </div>
      <div className="row g-2 mb-3">
        {[["Moyennes calculées", `${s.global.n} / ${stats.effectif}`], ["Moyenne de classe", n2(s.global.moyenne)],
          ["Plus forte / plus faible", `${n2(s.global.max)} / ${n2(s.global.min)}`], ["Moyennes ≥ 10", s.global.reussite], ["Taux de réussite", pct(s.global.taux)]].map(([l, v]) => (
          <div className="col-6 col-md" key={l}><div className="card"><div className="card-body py-2"><div className="small text-muted">{l}</div><strong>{v}</strong></div></div></div>))}
      </div>
      <div className="row g-3 mb-3">
        <div className="col-lg-6"><div className="card h-100"><div className="card-body">
          <h3 className="h6">Répartition des moyennes</h3>
          {s.global.n ? (
            <div className="histogramme" role="img" aria-label="Histogramme : nombre d'élèves par tranche de moyenne (détail dans le tableau)">
              {s.repartition.map((l) => (
                <div className="histo-col" key={l.libelle} title={`${l.libelle} : ${l.total} élève(s) (${pct(l.pourcentage)})`}>
                  <span className="histo-valeur">{l.total || ""}</span>
                  <div className="histo-barre" style={{ height: `${(100 * l.total) / maxi}%` }} />
                  <span className="histo-libelle">{l.libelle}</span>
                </div>))}
            </div>) : <p className="text-muted">Aucune moyenne calculée pour cette période.</p>}
        </div></div></div>
        <div className="col-lg-6"><div className="card h-100"><div className="table-responsive"><table className="table table-sm mb-0">
          <thead className="table-light"><tr><th>Moyenne</th>{SEXES.map(([k, l]) => <th key={k} className="text-end">{l}</th>)}<th className="text-end">Total</th><th className="text-end">%</th></tr></thead>
          <tbody>{s.repartition.map((l) => <tr key={l.libelle}><td>{l.libelle}</td>{SEXES.map(([k]) => <td key={k} className="text-end">{l.parSexe[k]}</td>)}
            <td className="text-end fw-semibold">{l.total}</td><td className="text-end">{l.pourcentage === null ? "—" : note(l.pourcentage)}</td></tr>)}</tbody>
        </table></div></div></div>
      </div>
      <div className="card mb-3"><div className="card-header fw-semibold">Résultats par sexe</div><div className="table-responsive"><table className="table table-sm mb-0">
        <thead className="table-light"><tr><th />{ENTETES_RESUME.map((e) => <th key={e} className="text-end">{e}</th>)}</tr></thead>
        <tbody>{SEXES.map(([k, l]) => <tr key={k}><td>{l}</td><CellulesResume r={s.parSexe[k]} /></tr>)}
          <tr className="fw-semibold"><td>Ensemble</td><CellulesResume r={s.global} /></tr></tbody>
      </table></div></div>
      <div className="card"><div className="card-header fw-semibold">Statistiques par matière</div><div className="table-responsive"><table className="table table-sm table-hover mb-0">
        <thead className="table-light"><tr><th>Matière</th><th>Enseignant</th><th className="text-end">Coef.</th>{ENTETES_RESUME.map((e) => <th key={e} className="text-end">{e === "Nombre" ? "Notes" : e}</th>)}
          <th className="text-end">Moy. garçons</th><th className="text-end">Moy. filles</th></tr></thead>
        <tbody>{s.matieres.map((m) => <tr key={m.attribution.id}><td>{m.attribution.matiere}</td><td className="small">{m.attribution.enseignant || "—"}</td>
          <td className="text-end">{m.attribution.coefficient}</td><CellulesResume r={m.tous} />
          <td className="text-end">{n2(m.parSexe.M.moyenne)}</td><td className="text-end">{n2(m.parSexe.F.moyenne)}</td></tr>)}
          {!s.matieres.length && <tr><td colSpan={11} className="text-center text-muted py-3">Aucune matière attribuée à cette classe.</td></tr>}</tbody>
      </table></div></div>
      <p className="small text-muted mt-2">Seules les moyennes des élèves classés sont prises en compte. Réussite : moyenne ou note ≥ 10.</p>
    </>
  )
}

// --- Comparaison des classes -------------------------------------------------------------------------------
function Comparaison() {
  const { exercice } = useSession()
  const [code, setCode] = useState("")
  const [ref_] = useDonnees(async () => !exercice ? null : ({
    classes: verifier(await supabase.from("classes").select("*").order("ordre").order("libelle")),
    periodes: periodes(verifier(await supabase.from("sequences").select("*").eq("exercice_id", exercice.id).order("numero"))),
  }), [exercice?.id])
  const periode = ref_?.periodes.find((p) => p.code === (code || ref_.periodes[0]?.code))
  const [resultat, erreur] = useDonnees(async () => {
    if (!ref_ || !periode) return null
    const lignes = [], parNiveau = new Map()
    for (const classe of ref_.classes) {                       // une classe après l'autre : charge modérée pour le plan Free
      const d = await chargerClasse(classe, exercice)
      if (!d.eleves.length) continue
      const { resultats } = resultatsPeriode(d, periode)
      const moyennes = resultats.map((r) => r.moyenne).filter((m) => m !== null)
      lignes.push({ classe, effectif: resultats.length, ...resume(moyennes) })
      const niveau = classe.niveau || "Sans niveau"
      parNiveau.set(niveau, [...(parNiveau.get(niveau) || []), ...moyennes])
    }
    const niveaux = [...parNiveau].map(([niveau, m]) => ({ niveau, ...resume(m) }))
    return { lignes, niveaux, etablissement: resume([...parNiveau.values()].flat()) }
  }, [ref_, periode?.code])

  if (!exercice) return <div className="alert alert-warning">Aucun exercice actif.</div>
  if (!ref_) return <Chargement />
  return (
    <>
      <select className="form-select mb-3 no-print" style={{ maxWidth: 320 }} value={periode?.code || ""} onChange={(e) => setCode(e.target.value)} aria-label="Période">
        {ref_.periodes.map((p) => <option key={p.code} value={p.code}>{p.libelle}</option>)}</select>
      <Alerte>{erreur}</Alerte>
      {!resultat ? <Chargement texte="Calcul des résultats de toutes les classes…" /> : !resultat.lignes.length ? <p className="text-muted">Aucun élève inscrit pour cet exercice.</p> : (
        <>
          <h2 className="h5">{periode.libelle} ({exercice.libelle}) — moyenne générale par classe <span className="small text-muted fw-normal">(échelle de 0 à 20)</span></h2>
          <div className="card mb-3"><div className="card-body"><div className="barres-h" role="img" aria-label="Moyenne générale de chaque classe (détail dans le tableau)">
            {resultat.lignes.map((l) => (
              <div className="barre-h" key={l.classe.id} title={`${l.classe.libelle} : moyenne ${n2(l.moyenne)}, réussite ${pct(l.taux)} (${l.n} classés sur ${l.effectif})`}>
                <span className="barre-h-libelle">{l.classe.libelle}</span>
                <span className="barre-h-piste"><span className="barre-h-trace" style={{ width: `${(100 * (l.moyenne || 0)) / 20}%` }} /></span>
                <span className="barre-h-valeur">{n2(l.moyenne)}</span>
              </div>))}
          </div></div></div>
          <div className="card"><div className="table-responsive"><table className="table table-sm table-hover mb-0">
            <thead className="table-light"><tr><th>Classe</th><th className="text-end">Effectif</th>{ENTETES_RESUME.map((e) => <th key={e} className="text-end">{e === "Nombre" ? "Classés" : e}</th>)}</tr></thead>
            <tbody>{resultat.lignes.map((l) => <tr key={l.classe.id}><td>{l.classe.libelle}</td><td className="text-end">{l.effectif}</td><CellulesResume r={l} /></tr>)}</tbody>
            <tbody className="table-group-divider">{resultat.niveaux.map((n) => <tr key={n.niveau} className="text-muted"><td>Niveau {n.niveau}</td><td /><CellulesResume r={n} /></tr>)}
              <tr className="fw-semibold"><td>Établissement</td><td /><CellulesResume r={resultat.etablissement} /></tr></tbody>
          </table></div></div>
        </>
      )}
    </>
  )
}

// --- Effectifs par sexe et âge -----------------------------------------------------------------------------
function Effectifs() {
  const { exercice } = useSession()
  const [d, erreur] = useDonnees(async () => {
    if (!exercice) return null
    const classes = verifier(await supabase.from("classes").select("*").order("ordre").order("libelle"))
    const inscriptions = await toutCharger(() => supabase.from("inscriptions").select("classe_id, eleves(sexe, date_naissance)").eq("exercice_id", exercice.id))
    return effectifsSexeAge(classes, inscriptions, exercice.libelle)
  }, [exercice?.id])
  if (!exercice) return <div className="alert alert-warning">Aucun exercice actif.</div>
  if (!d) return <><Alerte>{erreur}</Alerte><Chargement /></>
  const tg = d.lignes.reduce((s, l) => s + l.garcons, 0), tf = d.lignes.reduce((s, l) => s + l.filles, 0)
  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-2">
        <h2 className="h5 m-0">Effectifs {exercice.libelle} — âge au {date(d.ref)}</h2>
        <button className="btn btn-outline-secondary btn-sm no-print" onClick={() => window.print()}>Imprimer</button>
      </div>
      {!d.lignes.length ? <p className="text-muted">Aucun élève inscrit pour cet exercice.</p> : (
        <div className="card"><div className="table-responsive"><table className="table table-sm table-bordered mb-0 text-center align-middle">
          <thead className="table-light">
            <tr><th rowSpan={2} className="text-start">Classe</th>{d.colonnes.map((a) => <th key={a} colSpan={2}>{a === "inconnu" ? "Âge inconnu" : `${a} ans`}</th>)}<th colSpan={3}>Total</th></tr>
            <tr>{d.colonnes.map((a) => [<th key={a + "g"} className="small">G</th>, <th key={a + "f"} className="small">F</th>])}<th className="small">G</th><th className="small">F</th><th className="small">G+F</th></tr>
          </thead>
          <tbody>{d.lignes.map((l) => <tr key={l.classe.id}><td className="text-start">{l.classe.libelle}</td>
            {l.cellules.map(([g, f], k) => [<td key={k + "g"}>{g || ""}</td>, <td key={k + "f"}>{f || ""}</td>])}
            <td>{l.garcons}</td><td>{l.filles}</td><td className="fw-semibold">{l.garcons + l.filles}</td></tr>)}</tbody>
          <tfoot className="fw-semibold table-light"><tr><td className="text-start">Total</td>{d.totaux.map(([g, f], k) => [<td key={k + "g"}>{g}</td>, <td key={k + "f"}>{f}</td>])}
            <td>{tg}</td><td>{tf}</td><td>{tg + tf}</td></tr></tfoot>
        </table></div></div>)}
      <p className="small text-muted mt-2">G : garçons, F : filles. L'âge est calculé au 1er janvier de l'année scolaire.</p>
    </>
  )
}
