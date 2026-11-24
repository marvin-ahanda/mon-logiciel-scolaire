// Page publique ouverte par le QR code d'un bulletin : établissement émetteur et résultats enregistrés.
import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { Chargement } from "../composants/Communs.jsx"
import { EDITEUR } from "../lib/editeur.js"
import { dateHeure, note } from "../lib/format.js"
import { siteAffiche } from "../lib/logo.js"
import { rpc } from "../supabase.js"
import { ChoixLangue, t } from "../i18n.jsx"

const Ligne = ({ libelle, children }) => (children || children === 0 ? <div className="row py-1 border-bottom"><div className="col-5 text-muted small">{libelle}</div><div className="col-7">{children}</div></div> : null)

const TYPES_DOC = { recu: "Reçu de paiement", contre_ecriture: "Annulation d'un paiement", facture: "Facture", bulletin_paie: "Bulletin de paie" }

/** Document financier : données minimales (initiales du bénéficiaire, numéro, date, statut ; aucun montant de salaire). */
function DocumentFinance({ doc, code }) {
  if (!doc) return (
    <div className="alert alert-danger verification-ko"><strong>{t("Code inconnu : {v0}", { v0: code.toUpperCase() })}</strong><br />
      {t("Aucun document financier portant ce code n'a été émis sur la plateforme NexIA School. Ce document n'est peut-être pas authentique.")}</div>)
  const valide = doc.statut === "valide"
  return <>
    <div className={`alert ${valide ? "alert-success verification-ok" : "alert-warning"} mb-3`}>
      <strong>{valide ? `✓ ${t("Document authentique")}` : t("Document annulé")}</strong><br />
      {valide ? t("Ce document a été émis par l'établissement ci-dessous. Comparez le numéro, la date et le montant avec le document papier.")
        : t("Ce document a été émis puis annulé par l'établissement : il n'a plus de valeur.")}</div>
    <div className="mb-3">
      <Ligne libelle={t("Document")}><strong>{t(TYPES_DOC[doc.type] || doc.type)}</strong></Ligne>
      <Ligne libelle={t("Établissement")}>{doc.etablissement}</Ligne>
      <Ligne libelle={t("Numéro")}>{doc.numero}</Ligne>
      <Ligne libelle={t("Date")}>{doc.date && new Date(`${doc.date}T00:00:00`).toLocaleDateString()}</Ligne>
      <Ligne libelle={t("Période")}>{doc.periode}</Ligne>
      <Ligne libelle={t("Bénéficiaire")}>{doc.beneficiaire}</Ligne>
      <Ligne libelle={t("Montant")}>{doc.montant != null && `${Number(doc.montant).toLocaleString()} FCFA`}</Ligne>
      <Ligne libelle={t("Code")}><code>{code.toUpperCase()}</code></Ligne>
    </div>
  </>
}

export default function Verifier() {
  const { code = "" } = useParams()
  const [etat, setEtat] = useState({ chargement: true })
  const finance = /^[0-9a-f]{32}$/i.test(code)
  useEffect(() => {
    (finance ? rpc("verifier_document_finance", { p_code: code }).then((doc) => ({ doc })) : rpc("verifier_bulletin", { p_code: code }))
      .then((v) => setEtat({ v }))
      .catch(() => setEtat({ erreur: true }))
  }, [code, finance])

  const e = etat.v?.etablissement, b = etat.v?.bulletin
  return (
    <div className="row justify-content-center mt-4 mt-md-5 mx-0 mb-4">
      <div className="col-sm-11 col-md-8 col-lg-6 col-xl-5">
        <div className="card shadow-sm">
          <div className="card-body p-4">
            <div className="d-flex align-items-center justify-content-between gap-2 mb-1">
              <h1 className="h4 mb-0 text-primary d-flex align-items-center gap-2"><img src={`${import.meta.env.BASE_URL}logo-nexia-192.png`} alt="" width="32" height="32" className="rounded-2" />NexIA School</h1>
              <ChoixLangue />
            </div>
            <p className="text-muted mb-3">{finance ? t("Vérification d'un document financier") : t("Vérification d'un bulletin scolaire")}</p>
            {etat.chargement && <Chargement />}
            {etat.erreur && <div className="alert alert-warning">{t("Vérification impossible pour le moment. Vérifiez votre connexion puis réessayez.")}</div>}
            {finance && etat.v && <DocumentFinance doc={etat.v.doc} code={code} />}
            {!etat.chargement && !etat.erreur && !finance && !etat.v && (
              <div className="alert alert-danger verification-ko">
                <strong>{t("Code inconnu : {v0}", { v0: code.toUpperCase() })}</strong><br />
                {t("Aucun bulletin portant ce code n'a été émis sur la plateforme NexIA School. Ce document n'est peut-être pas authentique.")}
              </div>)}
            {e && b && <>
              <div className="alert alert-success verification-ok mb-3">
                <strong>✓ {t("Bulletin authentique")}</strong><br />
                {t("Ce bulletin a été émis par l'établissement ci-dessous sur la plateforme NexIA School. Comparez les résultats avec le document papier : s'ils diffèrent, le document a été modifié.")}
              </div>
              <h2 className="h6 text-uppercase text-muted mt-3">{t("Établissement émetteur")}</h2>
              <div className="mb-3">
                <Ligne libelle={t("Nom")}><strong>{e.nom}</strong>{!e.actif && <span className="badge text-bg-secondary ms-2">{t("compte suspendu")}</span>}</Ligne>
                <Ligne libelle={t("Devise")}>{e.devise && <em>{e.devise}</em>}</Ligne>
                <Ligne libelle={t("Adresse")}>{[e.adresse, e.ville].filter(Boolean).join(", ")}</Ligne>
                <Ligne libelle={t("Téléphone")}>{e.telephone}</Ligne>
                <Ligne libelle={t("Site web")}>{e.site_web && <a href={e.site_web} target="_blank" rel="noopener noreferrer">{siteAffiche(e.site_web)}</a>}</Ligne>
                <Ligne libelle={t("Chef d'établissement")}>{e.nom_chef}</Ligne>
              </div>
              <h2 className="h6 text-uppercase text-muted">{t("Bulletin")}</h2>
              <div className="mb-3">
                <Ligne libelle={t("Élève")}><strong>{b.eleve}</strong></Ligne>
                <Ligne libelle={t("Matricule")}>{b.matricule}</Ligne>
                <Ligne libelle={t("Classe")}>{b.classe}</Ligne>
                <Ligne libelle={t("Année scolaire")}>{b.annee}</Ligne>
                <Ligne libelle={t("Période")}>{b.periode}</Ligne>
                <Ligne libelle={t("Moyenne")}><strong>{b.moyenne === null ? "NC" : `${note(Number(b.moyenne))} / 20`}</strong></Ligne>
                <Ligne libelle={t("Rang")}>{b.rang ? `${b.rang} / ${b.classes}` : t("non classé")}</Ligne>
                <Ligne libelle={t("Appréciation")}>{b.appreciation && t(b.appreciation)}</Ligne>
                <Ligne libelle={t("Émis le")}>{dateHeure(b.emis_le)}</Ligne>
                <Ligne libelle={t("Code")}><code>{code.toUpperCase()}</code></Ligne>
              </div>
            </>}
            <p className="small text-muted mb-0">{t("Bulletins sécurisés par NexIA School, plateforme de gestion scolaire")} · <a href={EDITEUR.site}>{EDITEUR.site.replace(/^https?:\/\//, "")}</a></p>
          </div>
        </div>
        <p className="small text-center text-muted mt-3"><Link to="/">{t("Accueil")}</Link> · <Link to="/confidentialite">{t("Confidentialité")}</Link></p>
      </div>
    </div>
  )
}
