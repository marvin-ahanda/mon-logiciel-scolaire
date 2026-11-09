// Lettre d'un parent à l'établissement, présentée comme une lettre administrative (usage camerounais) :
// expéditeur en haut à gauche, lieu et date en haut à droite, destinataire, objet, appel, corps, formule de politesse, signature.
import { lettre } from "../lib/courrier.js"
import { t } from "../i18n.jsx"

export default function Lettre({ courrier, etablissement, className = "" }) {
  const l = lettre(courrier, etablissement)
  return (
    <article className={`lettre ${className}`} aria-label={t("Lettre : {v0}", { v0: l.objet })}>
      <div className="lettre-haut">
        <div className="lettre-expediteur">{l.expediteur.map((x, k) => <div key={k} className={k === 0 ? "fw-semibold text-uppercase" : ""}>{x}</div>)}</div>
        <div className="lettre-lieu">{l.lieuDate}</div>
      </div>
      <div className="lettre-destinataire">{l.destinataire.map((x, k) => <div key={k} className={k === 1 ? "fw-semibold" : ""}>{x}</div>)}</div>
      <div className="lettre-objet"><span className="fw-bold text-decoration-underline">{t("Objet")}</span> : <span className="fw-semibold">{l.objet}</span></div>
      {l.reference && <div className="lettre-reference">{t("Réf. : {v0}", { v0: l.reference })}</div>}
      <p className="lettre-appel">{l.appel}</p>
      <p className="lettre-paragraphe">{l.introduction}</p>
      {l.corps.map((x, k) => <p key={k} className="lettre-paragraphe">{x}</p>)}
      <p className="lettre-paragraphe">{l.formule}</p>
      <div className="lettre-signature">{l.signature.map((x, k) => <div key={k} className={k === 0 ? "fw-semibold" : "small"}>{x}</div>)}</div>
    </article>
  )
}
