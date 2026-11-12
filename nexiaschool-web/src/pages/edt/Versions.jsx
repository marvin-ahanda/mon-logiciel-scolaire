// Versions enregistrées : liste, consultation, comparaison, officialisation, publication, renommage, suppression.
import { useMemo, useState } from "react"
import { t, locale } from "../../i18n.jsx"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { useSession } from "../../Session.jsx"
import { rpc } from "../../supabase.js"
import { completerConfig } from "../../lib/edt/modele.js"
import { comparer, libellePeriode } from "../../lib/edt/vues.js"
import Visionneuse from "./Visionneuse.jsx"

const STATUTS = { provisoire: ["Provisoire", "text-bg-secondary"], officiel: ["Officielle", "text-bg-success"], archive: ["Archivée", "text-bg-light"] }
const date = (d) => (d ? new Date(d).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" }) : "")

export default function Versions({ exercice, reprendre }) {
  const { etablissement } = useSession()
  const [liste, erreur, recharger] = useDonnees(() => rpc("edt_versions", { p_exercice: exercice.id }), [exercice.id])
  const [ouverte, setOuverte] = useState(null), [autre, setAutre] = useState(null)
  const [msg, setMsg] = useState({}), [occupe, setOccupe] = useState(false)

  async function ouvrir(id) {
    setMsg({}); setAutre(null)
    try { setOuverte(await rpc("edt_lire", { p_id: id })) } catch (e) { setMsg({ erreur: e.message }) }
  }
  async function action(f, ok) {
    setMsg({}); setOccupe(true)
    try { await f(); setMsg({ ok }); recharger(); if (ouverte) setOuverte(await rpc("edt_lire", { p_id: ouverte.id }).catch(() => null)) }
    catch (e) { setMsg({ erreur: e.message }) } finally { setOccupe(false) }
  }
  async function comparerAvec(id) {
    if (!id) return setAutre(null)
    try { setAutre(await rpc("edt_lire", { p_id: id })) } catch (e) { setMsg({ erreur: e.message }) }
  }
  const cfgOuverte = useMemo(() => (ouverte ? completerConfig(ouverte.config) : null), [ouverte])
  const diff = useMemo(() => (ouverte && autre ? comparer(completerConfig(autre.config), autre.grille, cfgOuverte, ouverte.grille) : null), [ouverte, autre, cfgOuverte])

  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!liste) return <Chargement />
  return (
    <>
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      {!liste.length ? <div className="alert alert-info">{t("Aucune version enregistrée pour l'année {v0}. Générez un emploi du temps puis enregistrez-le (étape 7).", { v0: exercice.libelle })}</div> : (
        <div className="table-responsive mb-3"><table className="table table-sm align-middle small bg-white">
          <thead><tr><th>{t("N°")}</th><th>{t("Nom")}</th><th>{t("Période")}</th><th>{t("Statut")}</th><th>{t("Heures")}</th><th>{t("Enregistrée le")}</th><th>{t("Par")}</th><th /></tr></thead>
          <tbody>{liste.map((v) => (
            <tr key={v.id} className={ouverte?.id === v.id ? "table-primary" : ""}>
              <td>{v.numero}</td><td>{v.nom}</td><td>{libellePeriode(v.periode)}</td>
              <td><span className={`badge ${STATUTS[v.statut][1]}`}>{t(STATUTS[v.statut][0])}</span>{v.publie && <span className="badge text-bg-info ms-1">{t("Publiée")}</span>}</td>
              <td>{v.bilan?.heures ?? ""}</td><td>{date(v.cree_le)}</td><td>{v.auteur || ""}</td>
              <td className="text-end text-nowrap">
                <button type="button" className="btn btn-sm btn-outline-primary me-1" onClick={() => ouvrir(v.id)}>{t("Ouvrir")}</button>
                {v.statut !== "officiel" && <button type="button" className="btn btn-sm btn-outline-success me-1" disabled={occupe}
                  onClick={() => confirm(t("Rendre officielle la version « {v0} » ? L'actuelle version officielle de cette période sera archivée.", { v0: v.nom })) && action(() => rpc("edt_officialiser", { p_id: v.id }), t("Version rendue officielle."))}>{t("Rendre officielle")}</button>}
                {v.statut === "officiel" && <button type="button" className="btn btn-sm btn-outline-info me-1" disabled={occupe}
                  onClick={() => action(() => rpc("edt_publier", { p_id: v.id, p_publie: !v.publie }), v.publie ? t("Publication retirée.") : t("Version publiée : le personnel peut la consulter."))}>{v.publie ? t("Retirer la publication") : t("Publier")}</button>}
                <button type="button" className="btn btn-sm btn-outline-secondary me-1" disabled={occupe} onClick={() => {
                  const n = prompt(t("Nouveau nom de la version :"), v.nom); if (n && n.trim()) action(() => rpc("edt_renommer", { p_id: v.id, p_nom: n.trim() }), t("Version renommée."))
                }}>{t("Renommer")}</button>
                {v.statut !== "officiel" && <button type="button" className="btn btn-sm btn-outline-danger" disabled={occupe}
                  onClick={() => confirm(t("Supprimer définitivement la version « {v0} » ?", { v0: v.nom })) && action(async () => { await rpc("edt_supprimer", { p_id: v.id }); if (ouverte?.id === v.id) setOuverte(null) }, t("Version supprimée."))}>{t("Supprimer")}</button>}
              </td>
            </tr>))}</tbody>
        </table></div>)}
      {ouverte && cfgOuverte && (
        <div className="card card-body">
          <div className="d-flex flex-wrap justify-content-between gap-2 align-items-center mb-3 no-print">
            <h3 className="h5 mb-0">{t("Version n° {v0} — {v1}", { v0: ouverte.numero, v1: ouverte.nom })} <span className={`badge ${STATUTS[ouverte.statut][1]}`}>{t(STATUTS[ouverte.statut][0])}</span></h3>
            <div className="d-flex flex-wrap gap-2 align-items-center">
              <label className="small text-muted" htmlFor="v-comp">{t("Comparer avec")}</label>
              <select className="form-select form-select-sm w-auto" id="v-comp" value={autre?.id || ""} onChange={(e) => comparerAvec(e.target.value)}>
                <option value="">—</option>{liste.filter((v) => v.id !== ouverte.id).map((v) => <option key={v.id} value={v.id}>{t("N° {v0}", { v0: v.numero })} — {v.nom}</option>)}</select>
              {ouverte.config?.source && <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => confirm(t("Reprendre les données de cette version dans l'assistant ? Le brouillon en cours sera remplacé.")) && reprendre(ouverte.config.source)}>{t("Reprendre dans l'assistant")}</button>}
            </div>
          </div>
          {diff && (diff.classes.length
            ? <div className="alert alert-warning small no-print">{t("{v0} case(s) diffèrent de la version n° {v1}, surlignées ci-dessous :", { v0: diff.cases.size, v1: autre.numero })} {diff.classes.slice(0, 12).map((c) => `${c.classe} (${c.n})`).join(", ")}{diff.classes.length > 12 ? "…" : ""}</div>
            : <div className="alert alert-info small no-print">{t("Aucune différence avec la version n° {v0}.", { v0: autre.numero })}</div>)}
          <Visionneuse key={ouverte.id} cfg={cfgOuverte} grille={ouverte.grille} surbrillance={diff?.cases}
                       entete={{ etablissement: etablissement.nom, annee: ouverte.exercice, periode: ouverte.periode, version: ouverte.nom }} />
        </div>)}
    </>
  )
}
