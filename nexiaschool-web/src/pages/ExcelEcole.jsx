import { useEffect, useState } from "react"
import { Alerte } from "../composants/Communs.jsx"
import { analyserEcole, chargerExistant, exporterEcole, lireEcole, modeleEcole, ROLES_IMPORT } from "../lib/ecoleExcel.js"
import { useSession } from "../Session.jsx"
import { rpc } from "../supabase.js"
import { t } from "../i18n.jsx"

/** Année scolaire proposée par défaut : à partir d'août, l'année qui commence. */
function anneeParDefaut() {
  const d = new Date(), a = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1
  return `${a}-${a + 1}`
}

function Validation({ analyse, envoi, onValider, onFermer }) {
  const { resume: r, erreurs } = analyse
  useEffect(() => {
    const echap = (x) => x.key === "Escape" && !envoi && onFermer()
    document.addEventListener("keydown", echap); return () => document.removeEventListener("keydown", echap)
  }, [envoi, onFermer])
  const ligne = (libelle, valeur, detail) => (
    <tr><th scope="row" className="fw-normal">{libelle}</th><td className="text-end fw-semibold text-nowrap">{valeur}</td><td className="text-muted small">{detail}</td></tr>)
  return (
    <>
      <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="titre-validation">
        <div className="modal-dialog modal-lg modal-dialog-scrollable"><div className="modal-content">
          <div className="modal-header">
            <h2 className="modal-title h5" id="titre-validation">{erreurs.length ? t("Fichier à corriger") : t("Vérifiez puis validez l'import")}</h2>
            <button type="button" className="btn-close" aria-label={t("Fermer")} disabled={envoi} onClick={onFermer} />
          </div>
          <div className="modal-body">
            <p className="small text-muted mb-2">{t("Fichier : {v0}", { v0: analyse.fichier })}</p>
            {erreurs.length > 0 && (
              <div className="alert alert-danger">
                <p className="fw-semibold mb-2">{t("{v0} erreur(s) : rien ne sera enregistré tant qu'elles ne sont pas corrigées.", { v0: erreurs.length })}</p>
                <ul className="small mb-0 liste-erreurs">{erreurs.slice(0, 200).map((e, k) => (
                  <li key={k}>{e.feuille && <strong>{e.feuille}</strong>}{e.ligne ? t(", ligne {v0}", { v0: e.ligne }) : ""}{e.feuille ? " : " : ""}{e.message}</li>))}
                  {erreurs.length > 200 && <li>…</li>}</ul>
              </div>)}
            <h3 className="h6">{t("Résumé")}</h3>
            <table className="table table-sm align-middle mb-3 resume-import"><tbody>
              {r.annee && ligne(t("Année scolaire"), r.annee, r.anneeACreer ? t("sera créée et activée") : t("année active"))}
              {ligne(t("Élèves"), r.eleves.total, t("{v0} nouveau(x), {v1} mis à jour · {v2} garçon(s), {v3} fille(s){v4}",
                { v0: r.eleves.nouveaux, v1: r.eleves.misAJour, v2: r.eleves.garcons, v3: r.eleves.filles,
                  v4: r.eleves.sansClasse ? t(" · {v0} sans classe", { v0: r.eleves.sansClasse }) : "" }))}
              {ligne(t("Personnel"), r.personnels.total, t("{v0} nouveau(x){v1} · {v2} déjà présent(s), non modifié(s)", {
                v0: r.personnels.nouveaux, v1: r.personnels.parRole.length ? ` (${r.personnels.parRole.map(([role, n]) => `${t(ROLES_IMPORT[role])} : ${n}`).join(", ")})` : "",
                v2: r.personnels.existants }))}
              {ligne(t("Sections"), r.sections.total, t("{v0} nouvelle(s)", { v0: r.sections.nouvelles }))}
              {ligne(t("Classes"), r.classes.total, t("{v0} nouvelle(s)", { v0: r.classes.nouvelles }))}
              {ligne(t("Matières"), r.matieres.total, t("{v0} nouvelle(s)", { v0: r.matieres.nouvelles }))}
              {ligne(t("Matières par classe"), r.programme, t("coefficient, groupe et enseignant"))}
            </tbody></table>
            {r.parClasse.length > 0 && (<>
              <h3 className="h6">{t("Par classe")}</h3>
              <div className="table-responsive border rounded" style={{ maxHeight: 300 }}><table className="table table-sm mb-0 small">
                <thead className="table-light"><tr><th>{t("Classe")}</th><th className="text-end">{t("Élèves du fichier")}</th><th className="text-end">{t("Garçons")}</th>
                  <th className="text-end">{t("Filles")}</th><th className="text-end">{t("Matières")}</th><th className="text-end">{t("Total des coefficients")}</th></tr></thead>
                <tbody>{r.parClasse.map((c) => (
                  <tr key={c.classe}><td>{c.classe}</td><td className="text-end">{c.eleves}</td><td className="text-end">{c.garcons}</td><td className="text-end">{c.filles}</td>
                    <td className="text-end">{c.matieres}</td><td className="text-end">{c.coefficients}</td></tr>))}</tbody>
              </table></div></>)}
            {r.ignorees.length > 0 && <p className="small text-muted mt-2 mb-0">{t("Feuilles ignorées (non reconnues) : {v0}", { v0: r.ignorees.join(", ") })}</p>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" disabled={envoi} onClick={onFermer}>{t("Annuler")}</button>
            <button type="button" className="btn btn-success" disabled={erreurs.length > 0 || envoi} onClick={onValider}>
              {envoi ? t("Enregistrement…") : t("Valider l'import")}</button>
          </div>
        </div></div>
      </div>
      <div className="modal-backdrop show" />
    </>
  )
}

function Bilan({ r, onFermer }) {
  const imprimer = () => {
    document.body.classList.add("impression-ciblee")
    const fin = () => { document.body.classList.remove("impression-ciblee"); window.removeEventListener("afterprint", fin) }
    window.addEventListener("afterprint", fin); window.print()
  }
  const n = (o, a, b) => t("{v0} créé(s), {v1} mis à jour", { v0: o[a], v1: o[b] })
  return (
    <div className="mt-3">
      <div className="alert alert-success">
        <p className="fw-semibold mb-1">{t("Import terminé : les données sont rangées dans leurs rubriques.")}</p>
        <ul className="small mb-0">
          {r.annee_creee && <li>{t("Année scolaire {v0} créée et activée.", { v0: r.annee })}</li>}
          <li>{t("Élèves : {v0}", { v0: n(r.eleves, "crees", "modifies") })}</li>
          <li>{t("Personnel : {v0} créé(s), {v1} déjà présent(s)", { v0: r.personnels.crees, v1: r.personnels.existants })}</li>
          <li>{t("Classes : {v0}", { v0: n(r.classes, "crees", "modifies") })} · {t("Sections : {v0}", { v0: n(r.sections, "crees", "modifies") })}</li>
          <li>{t("Matières : {v0}", { v0: n(r.matieres, "crees", "modifies") })} · {t("Matières par classe : {v0}", { v0: n(r.programme, "crees", "modifies") })}</li>
        </ul>
      </div>
      {r.codes.length > 0 && (
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
      {!r.codes.length && <button type="button" className="btn btn-outline-secondary" onClick={onFermer}>{t("Fermer")}</button>}
    </div>
  )
}

/** Import du fichier Excel complet de l'établissement et export de toutes ses données (administration). */
export default function ExcelEcole() {
  const { exercice, etablissement, recharger } = useSession()
  const [annee, setAnnee] = useState(anneeParDefaut())
  const [analyse, setAnalyse] = useState(null), [bilan, setBilan] = useState(null)
  const [msg, setMsg] = useState({}), [occupe, setOccupe] = useState(""), [envoi, setEnvoi] = useState(false)

  async function analyser(fichier) {
    setMsg({}); setBilan(null); setOccupe("lecture")
    try {
      const [lu, existant] = await Promise.all([lireEcole(fichier), chargerExistant(exercice, etablissement)])
      setAnalyse({ fichier: fichier.name, ...analyserEcole(lu, existant, annee.trim()) })
    } catch (x) { setMsg({ erreur: x.message }) } finally { setOccupe("") }
  }

  async function valider() {
    setEnvoi(true)
    try {
      const r = await rpc("importer_ecole", { p: analyse.donnees })
      setAnalyse(null); setBilan(r)
      await recharger()        // année scolaire éventuellement créée
    } catch (x) { setAnalyse(null); setMsg({ erreur: t("Rien n'a été enregistré : {v0}", { v0: x.message }) }) } finally { setEnvoi(false) }
  }

  async function exporter() {
    setMsg({}); setOccupe("export")
    try {
      const r = await exporterEcole(etablissement)
      setMsg({ ok: t("Export terminé : {v0} feuilles, {v1} élève(s), {v2} note(s).", { v0: r.feuilles, v1: r.eleves, v2: r.notes }) })
    } catch (x) { setMsg({ erreur: t("Export impossible : {v0}", { v0: x.message }) }) } finally { setOccupe("") }
  }

  return (
    <div className="col-12">
      <div className="card border-primary-subtle">
        <div className="card-header fw-semibold">{t("École complète")}</div>
        <div className="card-body">
          <Alerte>{msg.erreur}</Alerte><Alerte type="success">{msg.ok}</Alerte>
          <div className="row g-4">
            <div className="col-lg-7">
              <h2 className="h6">{t("Importer le fichier complet de l'école")}</h2>
              <p className="small text-muted">{t("Un seul fichier Excel pour tout installer : sections, classes, matières avec leurs coefficients et groupes, personnel et rôles, élèves avec leur classe, leur sexe, leur date de naissance et le contact du parent. Un résumé vous est présenté avant tout enregistrement.")}</p>
              {!exercice && (
                <div className="mb-2" style={{ maxWidth: 260 }}>
                  <label className="form-label small mb-1" htmlFor="annee-import">{t("Année scolaire à créer")}</label>
                  <input id="annee-import" className="form-control form-control-sm" value={annee} onChange={(e) => setAnnee(e.target.value)} placeholder="2026-2027" />
                </div>)}
              <div className="d-flex flex-wrap gap-2">
                <label className={`btn btn-primary mb-0 ${occupe ? "disabled" : ""}`}>
                  {occupe === "lecture" ? t("Lecture du fichier…") : t("Importer le fichier complet…")}
                  <input type="file" hidden accept=".xlsx" disabled={!!occupe} onChange={(e) => { e.target.files[0] && analyser(e.target.files[0]); e.target.value = "" }} />
                </label>
                <button type="button" className="btn btn-outline-secondary" onClick={() => modeleEcole().catch((x) => setMsg({ erreur: x.message }))}>
                  {t("Télécharger le modèle complet")}</button>
              </div>
            </div>
            <div className="col-lg-5 border-start-lg">
              <h2 className="h6">{t("Exporter toutes les données")}</h2>
              <p className="small text-muted">{t("Un classeur Excel avec toutes les données de l'école, rangées par rubrique : élèves, personnel, classes, matières, notes, discipline, frais et paiements. Utile pour une sauvegarde ou si vous quittez NexIA School : vos données vous appartiennent.")}</p>
              <button type="button" className="btn btn-outline-primary" disabled={!!occupe} onClick={exporter}>
                {occupe === "export" ? t("Préparation du fichier…") : t("Exporter toutes les données")}</button>
            </div>
          </div>
          {bilan && <Bilan r={bilan} onFermer={() => setBilan(null)} />}
        </div>
      </div>
      {analyse && <Validation analyse={analyse} envoi={envoi} onValider={valider} onFermer={() => setAnalyse(null)} />}
    </div>
  )
}
