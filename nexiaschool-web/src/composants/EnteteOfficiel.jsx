// En-tête officiel du bulletin : saisie des champs (création de l'établissement et Paramètres → Établissement).
// Rien n'est imposé : chaque établissement (primaire, secondaire, supérieur, tout pays) remplit ce qui le concerne ;
// une ligne vide n'apparaît pas sur le bulletin. Colonne de gauche : langue principale ; colonne de droite : seconde langue.
import { t } from "../i18n.jsx"
import { CHAMPS_ENTETE } from "../lib/enteteBulletin.js"

/** [clé (langue principale), clé (seconde langue), libellé, exemple FR, exemple EN, longueur maximale] */
export const LIGNES_ENTETE = [
  ["entete_pays", "entete_pays_en", "Pays", "RÉPUBLIQUE DU CAMEROUN", "REPUBLIC OF CAMEROON", 120],
  ["entete_devise_pays", "entete_devise_pays_en", "Devise du pays", "Paix - Travail - Patrie", "Peace - Work - Fatherland", 120],
  ["entete_ministere", "entete_ministere_en", "Ministère de tutelle", "MINISTÈRE DES ENSEIGNEMENTS SECONDAIRES", "MINISTRY OF SECONDARY EDUCATION", 160],
  ["entete_delegation", "entete_delegation_en", "Délégation ou autorité régionale", "DÉLÉGATION RÉGIONALE DU CENTRE", "REGIONAL DELEGATION FOR THE CENTRE", 160],
]
export { CHAMPS_ENTETE }

/** Valeurs initiales de l'en-tête à partir d'un établissement (chaînes vides par défaut). */
export const valeursEntete = (e = {}) => Object.fromEntries(CHAMPS_ENTETE.map((k) => [k, e[k] || ""]))

export function ChampsEntete({ valeurs, onChange, idPrefixe = "entete" }) {
  const maj = (k, v) => onChange({ ...valeurs, [k]: v })
  return (
    <fieldset className="champs-entete">
      <legend className="h6 mb-1">{t("En-tête officiel du bulletin")}</legend>
      <p className="small text-muted mb-2">{t("Affiché en haut à gauche (langue principale) et en haut à droite (traduction). Remplissez seulement ce qui concerne votre établissement : une ligne vide n'apparaît pas.")}</p>
      <div className="row g-2 small fw-semibold text-muted d-none d-md-flex"><div className="col-md-6">{t("À gauche (langue principale)")}</div><div className="col-md-6">{t("À droite (traduction, ex. anglais)")}</div></div>
      {LIGNES_ENTETE.map(([fr, en, lib, exFr, exEn, max]) => (
        <div className="row g-2 mb-2" key={fr}>
          <div className="col-md-6"><label className="form-label small mb-0" htmlFor={`${idPrefixe}-${fr}`}>{t(lib)}</label>
            <input className="form-control form-control-sm" id={`${idPrefixe}-${fr}`} maxLength={max} placeholder={t("ex. {v0}", { v0: exFr })}
                   value={valeurs[fr]} onChange={(e) => maj(fr, e.target.value)} /></div>
          <div className="col-md-6"><label className="form-label small mb-0" htmlFor={`${idPrefixe}-${en}`}>{t("{v0} (traduction)", { v0: t(lib) })}</label>
            <input className="form-control form-control-sm" id={`${idPrefixe}-${en}`} maxLength={max} placeholder={t("ex. {v0}", { v0: exEn })}
                   value={valeurs[en]} onChange={(e) => maj(en, e.target.value)} /></div>
        </div>))}
      <div className="mb-1"><label className="form-label small mb-0" htmlFor={`${idPrefixe}-specialisation`}>{t("Spécialisation de l'établissement (sous le nom et la devise)")}</label>
        <input className="form-control form-control-sm" id={`${idPrefixe}-specialisation`} maxLength={200} placeholder={t("ex. Enseignement général & technique · Bilingue")}
               value={valeurs.specialisation} onChange={(e) => maj("specialisation", e.target.value)} /></div>
    </fieldset>
  )
}
