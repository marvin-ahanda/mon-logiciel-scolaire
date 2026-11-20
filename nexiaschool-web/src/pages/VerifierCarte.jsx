// Page publique ouverte par le QR code d'une carte scolaire : validité de la carte, établissement émetteur.
// Aucune donnée sensible : ni matricule, ni date de naissance, ni photo, ni montant.
import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { Chargement } from "../composants/Communs.jsx"
import { EDITEUR } from "../lib/editeur.js"
import { date, dateHeure } from "../lib/format.js"
import { siteAffiche } from "../lib/logo.js"
import { rpc } from "../supabase.js"
import { ChoixLangue, t } from "../i18n.jsx"

const Ligne = ({ libelle, children }) => (children || children === 0 ? <div className="row py-1 border-bottom"><div className="col-5 text-muted small">{libelle}</div><div className="col-7">{children}</div></div> : null)
const ETATS = {
  valide: ["success", "✓ Carte valide", "Cette carte a été délivrée par l'établissement ci-dessous et elle est en cours de validité."],
  suspendue: ["warning", "Carte suspendue", "L'établissement a suspendu cette carte (perte, sanction…). Elle ne doit pas être acceptée pour le moment."],
  revoquee: ["danger", "✗ Carte révoquée", "L'établissement a définitivement annulé cette carte. Elle n'est plus valable."],
  remplacee: ["danger", "✗ Carte remplacée", "Une nouvelle carte a été délivrée à cet élève ; celle-ci n'est plus valable."],
  expiree: ["danger", "✗ Carte expirée", "La date de validité de cette carte est dépassée."],
  non_inscrit: ["danger", "✗ Élève non inscrit", "Cet élève n'est plus inscrit dans l'établissement pour l'année en cours."],
  signature_revoquee: ["danger", "✗ Signature révoquée", "Cette carte porte une signature ou un cachet que l'établissement a révoqué. Elle doit être remplacée."],
}

export default function VerifierCarte() {
  const { code = "" } = useParams()
  const [etat, setEtat] = useState({ chargement: true })
  useEffect(() => { rpc("verifier_carte", { p_code: code }).then((v) => setEtat({ v })).catch(() => setEtat({ erreur: true })) }, [code])
  const e = etat.v?.etablissement, c = etat.v?.carte, s = c && (ETATS[c.statut] || ETATS.revoquee)
  return (
    <div className="row justify-content-center mt-4 mt-md-5 mx-0 mb-4">
      <div className="col-sm-11 col-md-8 col-lg-6 col-xl-5">
        <div className="card shadow-sm"><div className="card-body p-4">
          <div className="d-flex align-items-center justify-content-between gap-2 mb-1">
            <h1 className="h4 mb-0 text-primary d-flex align-items-center gap-2"><img src={`${import.meta.env.BASE_URL}logo-nexia-192.png`} alt="" width="32" height="32" className="rounded-2" />NexIA School</h1>
            <ChoixLangue />
          </div>
          <p className="text-muted mb-3">{t("Vérification d'une carte scolaire")}</p>
          {etat.chargement && <Chargement />}
          {etat.erreur && <div className="alert alert-warning">{t("Vérification impossible pour le moment. Vérifiez votre connexion puis réessayez.")}</div>}
          {!etat.chargement && !etat.erreur && !etat.v && <div className="alert alert-danger verification-ko">
            <strong>{t("Code inconnu : {v0}", { v0: code.toUpperCase() })}</strong><br />
            {t("Aucune carte portant ce code n'a été délivrée sur la plateforme NexIA School. Cette carte n'est peut-être pas authentique.")}</div>}
          {e && c && <>
            <div className={`alert alert-${s[0]} ${c.statut === "valide" ? "verification-ok" : "verification-ko"} mb-3`} data-statut={c.statut}>
              <strong>{t(s[1])}</strong><br />{t(s[2])}
              {c.paiement && <div className="mt-2 fw-semibold">{c.paiement === "a_jour" ? `✓ ${t("À jour de pension")}` : `⚠ ${t("Pas à jour de pension")}`}</div>}
            </div>
            <h2 className="h6 text-uppercase text-muted">{t("Carte")}</h2>
            <div className="mb-3">
              <Ligne libelle={t("Élève")}><strong>{c.eleve}</strong></Ligne>
              <Ligne libelle={t("Classe")}>{c.classe}</Ligne>
              <Ligne libelle={t("Année scolaire")}>{c.annee}</Ligne>
              <Ligne libelle={t("Émise le")}>{date(c.emise_le)}</Ligne>
              <Ligne libelle={t("Valable jusqu'au")}>{date(c.expire_le)}</Ligne>
              {c.statut_le && c.statut !== "valide" && <Ligne libelle={t("Depuis le")}>{dateHeure(c.statut_le)}</Ligne>}
              <Ligne libelle={t("Code")}><code>{code.toUpperCase()}</code>{c.version > 1 && <span className="text-muted small"> · v{c.version}</span>}</Ligne>
            </div>
            <h2 className="h6 text-uppercase text-muted">{t("Établissement émetteur")}</h2>
            <div className="mb-3">
              <Ligne libelle={t("Nom")}><strong>{e.nom}</strong>{!e.actif && <span className="badge text-bg-secondary ms-2">{t("compte suspendu")}</span>}</Ligne>
              <Ligne libelle={t("Ville")}>{e.ville}</Ligne>
              <Ligne libelle={t("Téléphone")}>{e.telephone}</Ligne>
              <Ligne libelle={t("Site web")}>{e.site_web && <a href={e.site_web} target="_blank" rel="noopener noreferrer">{siteAffiche(e.site_web)}</a>}</Ligne>
            </div>
            <p className="small text-muted">{t("Par respect de la vie privée, cette page n'affiche ni le matricule, ni la date de naissance, ni la photo de l'élève : comparez avec la carte présentée.")}</p>
          </>}
          <p className="small text-muted mb-0">{t("Cartes sécurisées par NexIA School, plateforme de gestion scolaire")} · <a href={EDITEUR.site}>{EDITEUR.site.replace(/^https?:\/\//, "")}</a></p>
        </div></div>
        <p className="small text-center text-muted mt-3"><Link to="/">{t("Accueil")}</Link> · <Link to="/confidentialite">{t("Confidentialité")}</Link></p>
      </div>
    </div>
  )
}
