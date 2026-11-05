import { useEffect, useState } from "react"
import { initiales, preparerLogo } from "../lib/logo.js"
import { t } from "../i18n.jsx"

/** Logo de l'établissement dans une bulle ronde (initiales si aucun logo). taille en pixels. */
export function BulleLogo({ url, nom, taille = 34, className = "" }) {
  return (
    <span className={`bulle-logo ${className}`} style={{ width: taille, height: taille, fontSize: Math.round(taille * 0.38) }}
          title={nom} aria-hidden={url ? undefined : true}>
      {url ? <img src={url} alt={`Logo ${nom || ""}`.trim()} /> : initiales(nom)}
    </span>
  )
}

/**
 * Choix du logo : aperçu, bouton « Choisir », bouton « Retirer ».
 * url : logo actuel (ou null) ; onChoix(blob préparé | null) ; erreur affichée sous le champ.
 */
export function ChoixLogo({ url, onChoix, desactive = false, id = "logo" }) {
  const [apercu, setApercu] = useState(null), [erreur, setErreur] = useState(""), [prep, setPrep] = useState(false)
  useEffect(() => () => apercu && URL.revokeObjectURL(apercu), [apercu])
  async function choisir(e) {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (!f) return
    setErreur(""); setPrep(true)
    try {
      const blob = await preparerLogo(f)
      setApercu(URL.createObjectURL(blob)); onChoix(blob)
    } catch (err) { setErreur(err.message) } finally { setPrep(false) }
  }
  const affiche = apercu || url
  return (
    <div className="d-flex align-items-center gap-3">
      {affiche ? <img src={affiche} alt={t("Aperçu du logo")} className="apercu-logo" /> : <div className="apercu-logo vide">{t("Aucun logo")}</div>}
      <div>
        <label className={`btn btn-outline-primary btn-sm mb-1 ${desactive || prep ? "disabled" : ""}`} htmlFor={id}>
          {prep ? t("Préparation…") : affiche ? t("Changer le logo") : t("Importer le logo")}</label>
        <input id={id} type="file" accept="image/png,image/jpeg,image/webp" className="visually-hidden" onChange={choisir} disabled={desactive || prep} />
        {affiche && <button type="button" className="btn btn-link btn-sm text-danger d-block p-0" disabled={desactive}
                            onClick={() => { setApercu(null); setErreur(""); onChoix(null) }}>{t("Retirer le logo")}</button>}
        <div className="form-text">{t(
          "PNG (fond transparent conseillé), JPEG ou WEBP. Réduit automatiquement à 512 px."
        )}</div>
        {erreur && <div className="text-danger small" role="alert">{erreur}</div>}
      </div>
    </div>
  );
}
