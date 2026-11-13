import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { chargerClasse, resultatsPeriode } from "../lib/donneesClasse.js"
import { analyserEcole, chargerExistant, cumulerBilan, decouperImport, exporterListe, lieuRemarque, lireListe, LISTES, REMARQUES, ROLES_IMPORT } from "../lib/ecoleExcel.js"
import { telechargerClasseur } from "../lib/excel.js"
import { comparerNoms, nomComplet } from "../lib/format.js"
import { periodes } from "../lib/periodes.js"
import { useSession } from "../Session.jsx"
import { Verrou } from "../composants/Offre.jsx"
import { rpc, supabase, verifier } from "../supabase.js"
import { t, locale } from "../i18n.jsx"

// Ordre d'affichage des cartes, et contenu de chaque liste
const ORDRE = ["eleves", "classes", "matieres", "personnels", "programme", "notes"]
const CONTENU = {
  eleves: "Matricule, nom et prénom, sexe, date et lieu de naissance, contact du parent, classe, redoublant (Oui / Non), nouvel élève (Oui / Non).",
  classes: "Classe, niveau, section, cycle (1 ou 2) et ordre d'affichage. Une section qui n'existe pas encore est créée automatiquement.",
  matieres: "Code et nom de chaque matière.",
  personnels: "Matricule, nom et prénom, fonction (Administration, Enseignant, Surveillant général, Comptable / caissier), téléphone, poste ou spécialité. Chaque nouveau membre reçoit un code personnel.",
  programme: "Classe, code et nom de la matière, coefficient (1 à 20), groupe (1 à 3) et matricule de l'enseignant qui la dispense.",
  notes: "Classe, séquence, matricule et nom de l'élève, code de la matière et note sur 20. Une note vide est ignorée ; une note déjà enregistrée est remplacée.",
}

/** Points complétés automatiquement ou mis de côté, avec l'endroit où les reprendre. */
function Remarques({ remarques }) {
  return (
    <ul className="small mb-0 liste-remarques">{remarques.map((r) => { const lieu = lieuRemarque(r.code); return (
      <li key={r.code} className="mb-1"><strong>{r.n}</strong> {t(REMARQUES[r.code][0])}
        {r.exemples.length > 0 && <span className="text-muted"> — {r.exemples.join(", ")}{r.n > r.exemples.length ? "…" : ""}</span>}
        {r.lignes.length > 0 && <span className="text-muted"> ({t("lignes")} {r.lignes.join(", ")}{r.n > r.lignes.length ? "…" : ""})</span>}
        {lieu && <> → <Link to={lieu[0]}>{t(lieu[1])}</Link></>}</li>) })}</ul>
  )
}

/** Résumé du fichier avant validation, selon la liste importée. */
function Resume({ cle, r }) {
  const ligne = (libelle, valeur, detail) => (
    <tr><th scope="row" className="fw-normal">{libelle}</th><td className="text-end fw-semibold text-nowrap">{valeur}</td><td className="text-muted small">{detail}</td></tr>)
  const parClasse = r.parClasse.filter((c) => (cle === "eleves" ? c.eleves : cle === "notes" ? c.notes : c.matieres))
  return (
    <>
      <table className="table table-sm align-middle mb-3 resume-import"><tbody>
        {r.annee && ["eleves", "programme"].includes(cle) && ligne(t("Année scolaire"), r.annee, r.anneeACreer ? t("sera créée et activée") : t("année active"))}
        {cle === "eleves" && ligne(t("Élèves"), r.eleves.total, t("{v0} nouveau(x), {v1} mis à jour · {v2} garçon(s), {v3} fille(s){v4}",
          { v0: r.eleves.nouveaux, v1: r.eleves.misAJour, v2: r.eleves.garcons, v3: r.eleves.filles,
            v4: r.eleves.sansClasse ? t(" · {v0} sans classe", { v0: r.eleves.sansClasse }) : "" }))}
        {cle === "classes" && ligne(t("Classes"), r.classes.total, t("{v0} nouvelle(s)", { v0: r.classes.nouvelles }))}
        {cle === "classes" && r.sections.total > 0 && ligne(t("Sections"), r.sections.total, t("{v0} nouvelle(s), créée(s) avec les classes", { v0: r.sections.nouvelles }))}
        {cle === "matieres" && ligne(t("Matières"), r.matieres.total, t("{v0} nouvelle(s)", { v0: r.matieres.nouvelles }))}
        {cle === "personnels" && ligne(t("Personnel"), r.personnels.total, t("{v0} nouveau(x){v1} · {v2} déjà présent(s) : nom, fonction et code inchangés, téléphone et poste mis à jour", {
          v0: r.personnels.nouveaux, v1: r.personnels.parRole.length ? ` (${r.personnels.parRole.map(([role, n]) => `${t(ROLES_IMPORT[role])} : ${n}`).join(", ")})` : "",
          v2: r.personnels.existants }))}
        {cle === "programme" && ligne(t("Matières par classe"), r.programme, t("coefficient, groupe et enseignant"))}
        {cle === "notes" && ligne(t("Notes"), r.notes.total, [
          r.notes.total ? t("{v0} élève(s) · séquence(s) {v1}", { v0: r.notes.eleves, v1: r.notes.sequences.join(", ") }) : "",
          r.notes.autresAnnees ? t("{v0} note(s) d'une autre année ignorée(s)", { v0: r.notes.autresAnnees }) : "",
          r.notes.vides ? t("{v0} case(s) vide(s) ignorée(s)", { v0: r.notes.vides }) : ""].filter(Boolean).join(" · "))}
      </tbody></table>
      {["eleves", "programme", "notes"].includes(cle) && parClasse.length > 0 && (<>
        <h3 className="h6">{t("Par classe")}</h3>
        <div className="table-responsive border rounded" style={{ maxHeight: 300 }}><table className="table table-sm mb-0 small">
          <thead className="table-light"><tr><th>{t("Classe")}</th>
            {cle === "eleves" && <><th className="text-end">{t("Élèves du fichier")}</th><th className="text-end">{t("Garçons")}</th><th className="text-end">{t("Filles")}</th></>}
            {cle === "programme" && <><th className="text-end">{t("Matières")}</th><th className="text-end">{t("Total des coefficients")}</th></>}
            {cle === "notes" && <th className="text-end">{t("Notes")}</th>}</tr></thead>
          <tbody>{parClasse.map((c) => (
            <tr key={c.classe}><td>{c.classe}</td>
              {cle === "eleves" && <><td className="text-end">{c.eleves}</td><td className="text-end">{c.garcons}</td><td className="text-end">{c.filles}</td></>}
              {cle === "programme" && <><td className="text-end">{c.matieres}</td><td className="text-end">{c.coefficients}</td></>}
              {cle === "notes" && <td className="text-end">{c.notes}</td>}</tr>))}</tbody>
        </table></div></>)}
    </>
  )
}

function Validation({ cle, analyse, envoi, progression, onValider, onFermer }) {
  const { resume: r, erreurs } = analyse
  useEffect(() => {
    const echap = (x) => x.key === "Escape" && !envoi && onFermer()
    document.addEventListener("keydown", echap); return () => document.removeEventListener("keydown", echap)
  }, [envoi, onFermer])
  return (
    <>
      <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="titre-validation">
        <div className="modal-dialog modal-lg modal-dialog-scrollable"><div className="modal-content">
          <div className="modal-header">
            <h2 className="modal-title h5" id="titre-validation">{erreurs.length ? t("Rien à importer") : t("Vérifiez puis validez l'import")} — {t(LISTES[cle].titre)}</h2>
            <button type="button" className="btn-close" aria-label={t("Fermer")} disabled={envoi} onClick={onFermer} />
          </div>
          <div className="modal-body">
            <p className="small text-muted mb-2">{t("Fichier : {v0}", { v0: analyse.fichier })}</p>
            {erreurs.length > 0 && (
              <div className="alert alert-danger">
                <ul className="small mb-0 liste-erreurs">{erreurs.map((e, k) => <li key={k}>{e.message}</li>)}</ul>
              </div>)}
            {analyse.remarques.length > 0 && (
              <div className="alert alert-warning">
                {!erreurs.length && <p className="fw-semibold mb-2">{t("Le fichier sera importé. Ces points ont été complétés automatiquement ou mis de côté : vous pourrez les reprendre après l'import, à l'endroit indiqué.")}</p>}
                <Remarques remarques={analyse.remarques} />
              </div>)}
            <h3 className="h6">{t("Résumé")}</h3>
            <Resume cle={cle} r={r} />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" disabled={envoi} onClick={onFermer}>{t("Annuler")}</button>
            <button type="button" className="btn btn-success" disabled={erreurs.length > 0 || envoi} onClick={onValider}>
              {envoi ? t("Enregistrement… {v0} %", { v0: progression }) : t("Valider l'import")}</button>
          </div>
        </div></div>
      </div>
      <div className="modal-backdrop show" />
    </>
  )
}

function Bilan({ cle, r, onFermer }) {
  const imprimer = () => {
    document.body.classList.add("impression-ciblee")
    const fin = () => { document.body.classList.remove("impression-ciblee"); window.removeEventListener("afterprint", fin) }
    window.addEventListener("afterprint", fin); window.print()
  }
  const n = (o) => t("{v0} créé(s), {v1} mis à jour", { v0: o?.crees || 0, v1: o?.modifies || 0 })
  return (
    <div className="mt-3">
      <div className="alert alert-success py-2">
        <p className="fw-semibold mb-1">{r.interruption ? t("Import interrompu : voici ce qui a déjà été enregistré.") : t("Import terminé.")}</p>
        <ul className="small mb-0">
          {r.annee_creee && <li>{t("Année scolaire {v0} créée et activée.", { v0: r.annee })}</li>}
          {cle === "eleves" && <li>{t("Élèves : {v0}", { v0: n(r.eleves) })}</li>}
          {cle === "classes" && <li>{t("Classes : {v0}", { v0: n(r.classes) })}{r.sections?.crees > 0 && <> · {t("Sections : {v0}", { v0: n(r.sections) })}</>}</li>}
          {cle === "matieres" && <li>{t("Matières : {v0}", { v0: n(r.matieres) })}</li>}
          {cle === "personnels" && <li>{t("Personnel : {v0} créé(s), {v1} déjà présent(s)", { v0: r.personnels?.crees || 0, v1: r.personnels?.existants || 0 })}</li>}
          {cle === "programme" && <li>{t("Matières par classe : {v0}", { v0: n(r.programme) })}</li>}
          {cle === "notes" && <li>{t("Notes : {v0}", { v0: n(r.notes) })}</li>}
        </ul>
      </div>
      {r.remarques?.length > 0 && (
        <div className="alert alert-warning py-2 a-completer-import">
          <p className="fw-semibold mb-1">{t("À compléter maintenant :")}</p>
          <Remarques remarques={r.remarques} />
        </div>)}
      {r.codes?.length > 0 && (
        <div className="card border-warning zone-impression">
          <div className="card-body">
            <h3 className="h6">{t("Codes personnels du nouveau personnel")}</h3>
            <p className="small text-danger no-print">{t("Notez ou imprimez ces codes maintenant : ils ne seront plus jamais affichés. Chacun pourra se connecter avec le nom de l'établissement, le code de l'établissement et son code personnel.")}</p>
            <table className="table table-sm mb-2"><thead><tr><th>{t("Nom")}</th><th>{t("Fonction")}</th><th>{t("Code personnel")}</th></tr></thead>
              <tbody>{r.codes.map((c) => <tr key={c.nom + c.code}><td>{c.nom}</td><td>{t(ROLES_IMPORT[c.role])}</td><td className="font-monospace fw-bold">{c.code}</td></tr>)}</tbody></table>
            <div className="d-flex gap-2 no-print">
              <button type="button" className="btn btn-primary" onClick={imprimer}>{t("Imprimer les codes")}</button>
              <button type="button" className="btn btn-outline-secondary" onClick={onFermer}>{t("J'ai noté les codes")}</button>
            </div>
          </div>
        </div>)}
      {!r.codes?.length && <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onFermer}>{t("Fermer")}</button>}
    </div>
  )
}

/** Une liste : import (contrôle, résumé, enregistrement par lots) et export au même format. */
// Listes ouvertes à toutes les offres ; les autres (personnel, programme, notes) : import / export complet, offre Essentiel
const LISTES_LIBRES = ["eleves", "classes", "matieres"]

function CarteListe({ cle, ref_, annee, onMaj }) {
  const { exercice, estAdmin, profil, recharger, aOffre } = useSession()
  const verrou = !LISTES_LIBRES.includes(cle) && !aOffre("excel")
  const [analyse, setAnalyse] = useState(null), [bilan, setBilan] = useState(null), [msg, setMsg] = useState({})
  const [occupe, setOccupe] = useState(""), [progression, setProgression] = useState(0)
  const [classeId, setClasseId] = useState(""), [code, setCode] = useState(""), [sequence, setSequence] = useState("")
  const seulement = cle === "notes" && !estAdmin ? profil.id : null
  const classes = cle === "notes" ? ref_.classesNotes : ref_.classes
  const codes = [...new Map(ref_.attributions.filter((a) => !classeId || a.classe_id === classeId).map((a) => [a.matieres.code, a.matieres])).values()]
    .sort((a, b) => comparerNoms(a.libelle, b.libelle))

  async function importer(fichier) {
    setMsg({}); setBilan(null); setOccupe("lecture")
    try {
      const [lu, existant] = await Promise.all([lireListe(fichier, cle), chargerExistant(exercice, { seulement })])
      setAnalyse({ fichier: fichier.name, ...analyserEcole(lu, existant, annee.trim()) })
    } catch (x) { setMsg({ erreur: x.message }) } finally { setOccupe("") }
  }

  async function valider() {
    setOccupe("envoi"); setProgression(0)
    const etapes = decouperImport(analyse.donnees).filter((e) => Object.entries(e).some(([k, v]) => k !== "annee" && v.length))
    let total = null
    try {
      for (let k = 0; k < etapes.length; k++) {
        total = cumulerBilan(total, await rpc(cle === "notes" ? "importer_notes" : "importer_ecole", { p: etapes[k] }))
        setProgression(Math.round(((k + 1) / etapes.length) * 100))
      }
      setAnalyse(null); setBilan({ ...(total || {}), remarques: analyse.remarques })
    } catch (x) {
      setAnalyse(null)
      if (!total) setMsg({ erreur: t("Rien n'a été enregistré : {v0}", { v0: x.message }) })
      else {
        setBilan({ ...total, interruption: true, remarques: analyse.remarques })
        setMsg({ erreur: t("L'enregistrement s'est interrompu ({v0}). Ce qui précède est enregistré : réimportez le même fichier pour terminer, rien ne sera dupliqué.", { v0: x.message }) })
      }
    } finally { setOccupe(""); recharger().catch(() => {}); onMaj() }
  }

  async function exporter() {
    setMsg({}); setOccupe("export")
    try {
      const suffixe = [classes.find((c) => c.id === classeId)?.libelle, code, sequence && `S${sequence}`].filter(Boolean).join("-")
      const n = await exporterListe(cle, { exercice, classeId, code, sequence, seulement }, suffixe)
      setMsg({ ok: t("{v0} ligne(s) exportée(s).", { v0: n }) })
    } catch (x) { setMsg({ erreur: t("Export impossible : {v0}", { v0: x.message }) }) } finally { setOccupe("") }
  }

  const besoinAnnee = ["programme", "notes"].includes(cle) && !exercice
  const carte = (
      <div className="card h-100 carte-liste" data-liste={cle}>
        <div className="card-header fw-semibold">{t(LISTES[cle].titre)}</div>
        <div className="card-body">
          <Alerte>{msg.erreur}</Alerte><Alerte type="success">{msg.ok}</Alerte>
          <p className="small text-muted">{t(CONTENU[cle])}</p>
          {besoinAnnee && cle === "notes" ? <div className="alert alert-warning py-2 small">{t("Aucune année scolaire active.")}</div> : (<>
            {["eleves", "programme", "notes"].includes(cle) && (
              <div className="row g-2 mb-2">
                <div className={cle === "notes" ? "col-sm-4" : "col-sm-12"}>
                  <select className="form-select form-select-sm" value={classeId} onChange={(e) => { setClasseId(e.target.value); setCode("") }} aria-label={t("Classe")}>
                    <option value="">{t("Toutes les classes")}</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></div>
                {cle === "notes" && <>
                  <div className="col-sm-4"><select className="form-select form-select-sm" value={code} onChange={(e) => setCode(e.target.value)} aria-label={t("Matière")}>
                    <option value="">{t("Toutes les matières")}</option>{codes.map((m) => <option key={m.code} value={m.code}>{m.libelle}</option>)}</select></div>
                  <div className="col-sm-4"><select className="form-select form-select-sm" value={sequence} onChange={(e) => setSequence(e.target.value)} aria-label={t("Séquence")}>
                    <option value="">{t("Toutes les séquences")}</option>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{t("Séquence {v0}", { v0: n })}</option>)}</select></div>
                </>}
              </div>)}
            <div className="d-flex flex-wrap gap-2">
              <label className={`btn btn-primary btn-sm mb-0 ${occupe ? "disabled" : ""}`}>
                {occupe === "lecture" ? t("Lecture du fichier…") : t("Importer…")}
                <input type="file" hidden accept=".xlsx" disabled={!!occupe} onChange={(e) => { e.target.files[0] && importer(e.target.files[0]); e.target.value = "" }} />
              </label>
              <button type="button" className="btn btn-outline-primary btn-sm" disabled={!!occupe} onClick={exporter}>
                {occupe === "export" ? t("Préparation du fichier…") : t("Exporter")}</button>
            </div>
            {cle === "notes" && <p className="small text-muted mt-2 mb-0">{t("L'export liste chaque élève avec une case Note à remplir : choisissez une classe, une matière et une séquence pour obtenir un fichier léger, puis réimportez-le.")}</p>}
          </>)}
          {bilan && <Bilan cle={cle} r={bilan} onFermer={() => setBilan(null)} />}
        </div>
      </div>
  )
  return (
    <div className="col-xl-6">
      {verrou ? <Verrou fonction="excel">{carte}</Verrou> : carte}
      {analyse && <Validation cle={cle} analyse={analyse} envoi={occupe === "envoi"} progression={progression} onValider={valider} onFermer={() => setAnalyse(null)} />}
    </div>
  )
}

function Carte({ titre, children }) {
  return <div className="col-xl-6"><div className="card h-100"><div className="card-header fw-semibold">{t(titre)}</div><div className="card-body">{children}</div></div></div>
}

// --- Export des résultats ----------------------------------------------------------------------------------
function ExportResultats({ ref_ }) {
  const { exercice } = useSession()
  const [classeId, setClasseId] = useState(""), [code, setCode] = useState(""), [msg, setMsg] = useState(""), [envoi, setEnvoi] = useState(false)
  async function exporter() {
    setMsg(""); setEnvoi(true)
    try {
      const classe = ref_.classesResultats.find((c) => c.id === classeId), periode = ref_.periodes.find((p) => p.code === code)
      const donnees = await chargerClasse(classe, exercice)
      const { resultats, stats } = resultatsPeriode(donnees, periode)
      const n = donnees.attributions.length
      const lignes = [...resultats].sort((a, b) => (a.rang ?? 1e9) - (b.rang ?? 1e9)).map((r) => [
        r.rang ? `${r.rang}${r.exAequo ? t(" ex") : ""}` : t("NC"), r.eleve.matricule, nomComplet(r.eleve), ...r.lignes.map((l) => l.note),
        r.totalCoef, r.totalPoints, r.moyenne ?? r.moyenneNonClassee, t(r.appreciation)])
      lignes.push([], ["", "", t("Moyenne de la classe"), ...Array(n).fill(null), null, null, stats.moyenneClasse],
                  ["", "", t("Taux de réussite (%)"), ...Array(n).fill(null), null, null, stats.tauxReussite])
      await telechargerClasseur([{ titre: `${classe.libelle} ${periode.libelle}`, lignes,
        entetes: [t("Rang"), "Matricule", t("Élève"), ...donnees.attributions.map((a) => `${a.code} (coef. ${a.coefficient})`), t("Total coef."), t("Total points"), t("Moyenne"), t("Appréciation")] }],
        `resultats-${classe.libelle}-${periode.code}`)
    } catch (x) { setMsg(x.message) } finally { setEnvoi(false) }
  }
  return (
    <Carte titre={t("Résultats")}>
      <Alerte>{msg}</Alerte>
      <p className="small text-muted">{t(
        "Classement d'une classe pour une séquence, un trimestre ou l'année, avec les notes de chaque matière."
      )}</p>
      <div className="row g-2">
        <div className="col-md-5"><select className="form-select" value={classeId} onChange={(e) => setClasseId(e.target.value)} aria-label={t("Classe")}>
          <option value="">{t("Classe…")}</option>{ref_.classesResultats.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></div>
        <div className="col-md-4"><select className="form-select" value={code} onChange={(e) => setCode(e.target.value)} aria-label={t("Période")}>
          <option value="">{t("Période…")}</option>{ref_.periodes.map((p) => <option key={p.code} value={p.code}>{p.libelle}</option>)}</select></div>
        <div className="col-md-3"><button className="btn btn-outline-primary w-100" disabled={!classeId || !code || envoi} onClick={exporter}>{envoi ? "…" : t("Exporter")}</button></div>
      </div>
    </Carte>
  );
}

/** Ce qui reste à compléter dans l'établissement (après un import incomplet, par exemple), avec l'endroit où le faire. */
function ACompleter({ c }) {
  const points = [
    [c.sexe, "élève(s) dont le sexe est à préciser", "/eleves?filtre=a-completer", "Élèves → À compléter"],
    [c.provisoires, "élève(s) avec un matricule provisoire (PROV-…)", "/eleves?filtre=a-completer", "Élèves → À compléter"],
    [c.sansNom, "élève(s) sans nom", "/eleves?filtre=a-completer", "Élèves → À compléter"],
    [c.nonInscrits, "élève(s) inscrit(s) dans aucune classe cette année", "/eleves?filtre=a-completer", "Élèves → À compléter"],
    [c.classesVides, "classe(s) sans niveau, section ni cycle", "/parametres/classes", "Paramètres → Classes"],
    [c.sansEnseignant, "matière(s) par classe sans enseignant", "/parametres/coefficients", "Paramètres → Matières par classe"],
  ].filter(([n]) => n > 0)
  if (!points.length) return null
  return (
    <div className="alert alert-warning py-2 mb-3 panneau-a-completer">
      <p className="fw-semibold mb-1">{t("Informations à compléter")}</p>
      <ul className="small mb-0">{points.map(([n, texte, lien, lieu]) => (
        <li key={texte}><strong>{n}</strong> {t(texte)} → <Link to={lien}>{t(lieu)}</Link></li>))}</ul>
    </div>
  )
}

async function compterACompleter(exercice) {
  const nb = async (q) => { const { count, error } = await q; if (error) throw error; return count || 0 }
  const tete = (table) => supabase.from(table).select("id", { count: "exact", head: true })
  const [sexe, provisoires, sansNom, eleves, inscrits, classes, sansEnseignant] = await Promise.all([
    nb(tete("eleves").is("sexe", null)), nb(tete("eleves").like("matricule", "PROV-%")), nb(tete("eleves").eq("nom", "À COMPLÉTER")),
    nb(tete("eleves")), exercice ? nb(tete("inscriptions").eq("exercice_id", exercice.id)) : 0,
    supabase.from("classes").select("niveau, section_id, cycle").then(verifier),
    exercice ? nb(tete("attributions").eq("exercice_id", exercice.id).is("enseignant_id", null)) : 0,
  ])
  return { sexe, provisoires, sansNom, nonInscrits: exercice ? Math.max(0, eleves - inscrits) : 0,
           classesVides: classes.filter((x) => !x.niveau && !x.section_id && !x.cycle).length, sansEnseignant }
}

export default function Excel() {
  const { exercice, estAdmin, profil } = useSession()
  const [annee, setAnnee] = useState(() => { const d = new Date(), a = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1; return `${a}-${a + 1}` })
  const [ref_, erreur, rafraichir] = useDonnees(async () => {
    const classes = verifier(await supabase.from("classes").select("*").order("ordre").order("libelle"))
    if (!exercice) return { classes, classesNotes: [], attributions: [], sequences: [], periodes: [], classesResultats: [], aCompleter: estAdmin ? await compterACompleter(null) : null }
    let q = supabase.from("attributions").select("id, classe_id, classes(libelle, ordre), matieres(code, libelle)").eq("exercice_id", exercice.id)
    if (!estAdmin) q = q.eq("enseignant_id", profil.id)
    const attributions = verifier(await q).sort((a, b) => a.classes.ordre - b.classes.ordre || comparerNoms(a.classes.libelle, b.classes.libelle) || comparerNoms(a.matieres.libelle, b.matieres.libelle))
    const sequences = verifier(await supabase.from("sequences").select("*").eq("exercice_id", exercice.id).order("numero"))
    const siennes = new Set(attributions.map((a) => a.classe_id))
    const classesSiennes = estAdmin ? classes : classes.filter((c) => siennes.has(c.id))
    return { classes, classesNotes: classesSiennes, attributions, sequences, periodes: periodes(sequences), classesResultats: classesSiennes,
             aCompleter: estAdmin ? await compterACompleter(exercice) : null }
  }, [exercice?.id])
  return (
    <>
      <h1 className="h3 mb-2">{t("Import et export Excel")}</h1>
      <p className="text-muted small mb-3">{t("Chaque liste s'importe et s'exporte séparément. Le fichier exporté sert de modèle, mais un fichier en désordre ou incomplet est aussi accepté : ce qui manque est complété au mieux et vous est signalé, avec l'endroit où le reprendre.")}
        {estAdmin && <> {t("Pour une nouvelle école : classes, matières, personnel, matières par classe, élèves, puis notes.")}</>}</p>
      {estAdmin && !exercice && (
        <div className="mb-3" style={{ maxWidth: 360 }}>
          <label className="form-label small mb-1" htmlFor="annee-import">{t("Année scolaire à créer (pour les élèves et les matières par classe)")}</label>
          <input id="annee-import" className="form-control form-control-sm" value={annee} onChange={(e) => setAnnee(e.target.value)} placeholder="2026-2027" />
        </div>)}
      {ref_?.aCompleter && <ACompleter c={ref_.aCompleter} />}
      {!ref_ ? <><Alerte>{erreur}</Alerte><Chargement /></> : (
        <div className="row g-3">
          {ORDRE.filter((cle) => estAdmin || cle === "notes").map((cle) => <CarteListe key={cle} cle={cle} ref_={ref_} annee={annee} onMaj={rafraichir} />)}
          {exercice && <ExportResultats ref_={ref_} />}
        </div>)}
    </>
  )
}
