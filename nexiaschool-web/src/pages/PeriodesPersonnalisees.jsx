// Paramètres → Exercices et séquences : périodes personnalisées (ex. semestres), regroupements de séquences
// utilisables pour les distinctions et les procès-verbaux.
import { useState } from "react"
import { Alerte, useDonnees } from "../composants/Communs.jsx"
import { rpc, supabase, verifier } from "../supabase.js"
import { t } from "../i18n.jsx"

export default function PeriodesPersonnalisees() {
  const [liste, erreur, recharger] = useDonnees(async () => verifier(await supabase.from("periodes_personnalisees").select("*").order("ordre")), [])
  const [f, setF] = useState({ id: null, libelle: "", sequences: [] }), [msg, setMsg] = useState("")
  async function enregistrer(e) {
    e.preventDefault(); setMsg("")
    try { await rpc("periode_perso_enregistrer", { p_id: f.id, p_libelle: f.libelle, p_sequences: f.sequences }); setF({ id: null, libelle: "", sequences: [] }); recharger() }
    catch (x) { setMsg(x.message) }
  }
  async function supprimer(p) {
    if (!confirm(t("Supprimer la période « {v0} » ?", { v0: p.libelle }))) return
    try { await rpc("periode_perso_supprimer", { p_id: p.id }); recharger() } catch (x) { setMsg(x.message) }
  }
  const basculer = (n) => setF({ ...f, sequences: f.sequences.includes(n) ? f.sequences.filter((x) => x !== n) : [...f.sequences, n].sort() })
  return (
    <div className="card mb-3 periodes-personnalisees"><div className="card-body">
      <h2 className="h6">{t("Périodes personnalisées (semestres…)")}</h2>
      <p className="small text-muted">{t("Regroupez des séquences pour créer vos propres périodes, par exemple « Semestre 1 » = séquences 1, 2 et 3. Elles servent aux distinctions et aux procès-verbaux.")}</p>
      <Alerte onFermer={() => setMsg("")}>{msg || erreur}</Alerte>
      {(liste || []).length > 0 && <ul className="list-unstyled mb-2">{liste.map((p) => (
        <li key={p.id} className="d-flex flex-wrap align-items-center gap-2 py-1 border-bottom">
          <strong>{p.libelle}</strong><span className="small text-muted">{t("séquences {v0}", { v0: p.sequences.join(", ") })}</span>
          <button className="btn btn-sm btn-link ms-auto" onClick={() => setF({ id: p.id, libelle: p.libelle, sequences: p.sequences.map(Number) })}>{t("Modifier")}</button>
          <button className="btn btn-sm btn-link text-danger" onClick={() => supprimer(p)}>{t("Supprimer")}</button></li>))}</ul>}
      <form className="d-flex flex-wrap gap-2 align-items-center" onSubmit={enregistrer}>
        <input className="form-control form-control-sm" style={{ maxWidth: 200 }} required maxLength={60} placeholder={t("ex. Semestre 1")} value={f.libelle}
          onChange={(e) => setF({ ...f, libelle: e.target.value })} aria-label={t("Nom de la période")} />
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <label key={n} className="form-check form-check-inline small mb-0"><input type="checkbox" className="form-check-input" checked={f.sequences.includes(n)} onChange={() => basculer(n)} /> {t("Séq. {v0}", { v0: n })}</label>))}
        <button className="btn btn-sm btn-primary" disabled={!f.sequences.length}>{f.id ? t("Enregistrer") : t("Ajouter")}</button>
        {f.id && <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setF({ id: null, libelle: "", sequences: [] })}>{t("Annuler")}</button>}
      </form>
    </div></div>
  )
}
