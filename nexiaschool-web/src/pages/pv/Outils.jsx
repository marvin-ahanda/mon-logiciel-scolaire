// Éléments communs des volets « PV et rapports » : référentiel partagé, filtres (cycle, section, niveau, classe),
// choix des périodes, contrôles de complétude, commentaire et barre de génération (PDF, Excel, CSV) avec numéro unique.
import { createContext, useContext, useState } from "react"
import { Alerte } from "../../composants/Communs.jsx"
import { image, nomDeFichier } from "../../lib/bulletinPdf.js"
import { signaturesEnService } from "../../lib/signatures.js"
import { texteControle } from "../../lib/pv/textes.js"
import { rpc } from "../../supabase.js"
import { useSession } from "../../Session.jsx"
import { t } from "../../i18n.jsx"

export const ContextePv = createContext(null)
export const useReferencePv = () => useContext(ContextePv)

/** Filtres en cascade : cycle → section → niveau → classe(s). valeur = { cycle, section, niveau } */
export function Filtres({ valeur, onChange, champs = ["cycle", "section", "niveau"], cycleObligatoire = false }) {
  const ref = useReferencePv()
  const classes = ref.classes.filter((c) => (!valeur.cycle || c.cycleId === valeur.cycle) && (!valeur.section || c.section_id === valeur.section))
  const niveaux = [...new Set(classes.map((c) => c.niveauLibelle).filter(Boolean))]
  const choisir = (k, v) => onChange({ ...valeur, [k]: v, ...(k === "cycle" ? { niveau: "" } : {}) })
  return (
    <>
      {champs.includes("cycle") && ref.cycles.length > 0 && (
        <div className="col-sm-6 col-lg-3"><label className="form-label small mb-1">{t("Cycle")}</label>
          <select className="form-select form-select-sm" value={valeur.cycle || ""} onChange={(e) => choisir("cycle", e.target.value)}>
            <option value="">{cycleObligatoire ? t("Choisir un cycle…") : t("Tous les cycles")}</option>{ref.cycles.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></div>)}
      {champs.includes("section") && ref.sections.length > 0 && (
        <div className="col-sm-6 col-lg-3"><label className="form-label small mb-1">{t("Section")}</label>
          <select className="form-select form-select-sm" value={valeur.section || ""} onChange={(e) => choisir("section", e.target.value)}>
            <option value="">{t("Toutes les sections")}</option>{ref.sections.map((s) => <option key={s.id} value={s.id}>{s.libelle}</option>)}</select></div>)}
      {champs.includes("niveau") && niveaux.length > 0 && (
        <div className="col-sm-6 col-lg-3"><label className="form-label small mb-1">{t("Niveau")}</label>
          <select className="form-select form-select-sm" value={valeur.niveau || ""} onChange={(e) => choisir("niveau", e.target.value)}>
            <option value="">{t("Tous les niveaux")}</option>{niveaux.map((n) => <option key={n} value={n}>{n}</option>)}</select></div>)}
    </>
  )
}

/** Classes retenues par les filtres. */
export const classesFiltrees = (classes, f) => classes.filter((c) => (!f.cycle || c.cycleId === f.cycle) && (!f.section || c.section_id === f.section)
  && (!f.niveau || c.niveauLibelle === f.niveau))

/** Choix d'une période (liste déroulante). */
export function ChoixPeriode({ valeur, onChange, libelle = t("Période"), vide = t("Période…"), exclure = null }) {
  const { periodes } = useReferencePv()
  return (
    <div className="col-sm-6 col-lg-3"><label className="form-label small mb-1">{libelle}</label>
      <select className="form-select form-select-sm" value={valeur || ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">{vide}</option>{periodes.filter((p) => p.code !== exclure).map((p) => <option key={p.code} value={p.code}>{p.libelle}</option>)}</select></div>
  )
}

/** Cases à cocher pour une liste (matières, élèves, périodes) avec « tout / rien ». */
export function Coches({ titre, elements, choisis, onChange, hauteur = 180 }) {
  const tous = elements.length > 0 && elements.every((e) => choisis.has(e.id))
  const basculer = (id) => { const s = new Set(choisis); if (s.has(id)) s.delete(id); else s.add(id); onChange(s) }
  return (
    <fieldset className="pv-coches">
      <legend className="small fw-semibold d-flex justify-content-between align-items-center mb-1">
        <span>{titre} <span className="text-muted fw-normal">({choisis.size}/{elements.length})</span></span>
        <button type="button" className="btn btn-link btn-sm p-0" onClick={() => onChange(tous ? new Set() : new Set(elements.map((e) => e.id)))}>
          {tous ? t("Tout décocher") : t("Tout cocher")}</button>
      </legend>
      <div className="border rounded p-2 overflow-auto" style={{ maxHeight: hauteur }}>
        {elements.map((e) => (
          <div className="form-check small" key={e.id}>
            <input className="form-check-input" type="checkbox" id={`pv-${titre}-${e.id}`} checked={choisis.has(e.id)} onChange={() => basculer(e.id)} />
            <label className="form-check-label" htmlFor={`pv-${titre}-${e.id}`}>{e.libelle}</label>
          </div>))}
        {!elements.length && <span className="text-muted small">{t("Aucun élément.")}</span>}
      </div>
    </fieldset>
  )
}

/** Contrôles de complétude : ce qui bloque, ce qui avertit, et l'accord pour une génération partielle. */
export function Controles({ controle, accepte, onAccepter }) {
  if (!controle) return null
  if (controle.bloquants.length) return (
    <div className="alert alert-danger small" role="alert"><strong>{t("Génération impossible : données essentielles incomplètes.")}</strong>
      <ul className="mb-0">{controle.bloquants.map((b) => <li key={b.code}>{texteControle(b)}</li>)}</ul></div>)
  if (!controle.avertissements.length) return <div className="alert alert-success small py-2">{t("Données complètes pour cette sélection.")}</div>
  return (
    <div className="alert alert-warning small" role="alert">
      <strong>{t("Attention : données incomplètes.")}</strong>
      <ul className="mb-2">{controle.avertissements.map((a) => <li key={a.code}>{texteControle(a)}</li>)}</ul>
      {controle.partiel && (
        <div className="form-check"><input className="form-check-input" type="checkbox" id="pv-partiel" checked={accepte} onChange={(e) => onAccepter(e.target.checked)} />
          <label className="form-check-label" htmlFor="pv-partiel">{t("Générer quand même un PV partiel (l'avertissement figurera sur le document).")}</label></div>)}
    </div>
  )
}

/** Commentaire éditable de la direction, repris dans le document et le registre. */
export function Commentaire({ valeur, onChange, libelle = t("Commentaire de la direction (facultatif)") }) {
  return (
    <div className="mb-3"><label className="form-label small fw-semibold" htmlFor="pv-commentaire">{libelle}</label>
      <textarea id="pv-commentaire" className="form-control" rows={3} maxLength={8000} value={valeur} onChange={(e) => onChange(e.target.value)}
                placeholder={t("Observations, décisions, actions correctives…")} /></div>
  )
}

/** Logo, cachet (si l'établissement l'affiche) et en-tête pour les documents. */
export async function ressourcesDocument(session, reglages) {
  const [logo, signatures] = await Promise.all([
    image(session.logoUrl).catch(() => null),
    reglages.afficher_cachet ? signaturesEnService().catch(() => ({})) : {},
  ])
  return { logo, cachet: signatures.cachet || null }
}

/**
 * Barre de génération : choix du format puis génération numérotée (registre) et production du fichier.
 * produire({ format, reference, genereLe, ressources }) fabrique le fichier ; document = { type, titre, perimetre, partiel, avertissements, commentaire }.
 */
export function Generation({ document, produire, desactive = false, raison = "", formats = ["pdf", "xlsx", "csv"], libelle = t("Générer le PV") }) {
  const session = useSession()
  const ref = useReferencePv()
  const [format, setFormat] = useState(formats[0])
  const [etat, setEtat] = useState({ enCours: false, erreur: "", fait: null })
  async function generer() {
    setEtat({ enCours: true, erreur: "", fait: null })
    try {
      const reg = await rpc("pv_enregistrer", { p: { ...document, format } })
      const ressources = format === "pdf" ? await ressourcesDocument(session, ref.reglages) : {}
      await produire({ format, reference: reg.reference, genereLe: reg.genere_le, ressources })
      setEtat({ enCours: false, erreur: "", fait: reg.reference })
    } catch (e) { setEtat({ enCours: false, erreur: e.message, fait: null }) }
  }
  const NOMS = { pdf: t("PDF (impression)"), xlsx: t("Excel (.xlsx)"), csv: t("CSV") }
  return (
    <div className="pv-generation border-top pt-3">
      <div className="d-flex flex-wrap align-items-center gap-2">
        <div className="btn-group btn-group-sm" role="group" aria-label={t("Format de sortie")}>
          {formats.map((f) => <button key={f} type="button" className={`btn ${format === f ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setFormat(f)}>{NOMS[f]}</button>)}
        </div>
        <button type="button" className="btn btn-success" disabled={desactive || etat.enCours} onClick={generer}>
          {etat.enCours ? t("Génération…") : libelle}</button>
        {desactive && raison && <span className="small text-muted">{raison}</span>}
      </div>
      {/* retour toujours visible : succès (fichier téléchargé) ou erreur */}
      <Alerte type="success" onFermer={() => setEtat((e) => ({ ...e, fait: null }))}>{etat.fait && t("Document n° {v0} généré et inscrit au registre : le fichier ({v1}) a été téléchargé — vérifiez vos téléchargements.", { v0: etat.fait, v1: format.toUpperCase() })}</Alerte>
      <Alerte onFermer={() => setEtat((e) => ({ ...e, erreur: "" }))}>{etat.erreur && t("Document non produit : {v0}", { v0: etat.erreur })}</Alerte>
    </div>
  )
}

export const nomFichierPv = (...parties) => nomDeFichier(...parties.filter(Boolean))

/** Contexte des documents (en-tête, signataires, lieu). */
export function contexteDocument(session, ref, { titre, sousTitre, reference, genereLe, ressources, commentaire = "" }) {
  return {
    etablissement: session.etablissement || {}, logo: ressources?.logo || null, cachet: ressources?.cachet || null,
    signataires: ref.reglages.signataires, lieu: session.etablissement?.ville || "", titre, sousTitre, reference, genereLe, commentaire,
  }
}
