// Page publique ouverte par le QR code d'un reçu de paiement NexIA School : le reçu est-il authentique, et que dit-il ?
import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { Chargement } from "../composants/Communs.jsx"
import { EDITEUR } from "../lib/editeur.js"
import { date, dateHeure } from "../lib/format.js"
import { NOMS_OFFRES } from "../lib/offres.js"
import { rpc } from "../supabase.js"
import { ChoixLangue, locale, t } from "../i18n.jsx"

const fcfa = (n) => `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(Number(n || 0)).replace(/[  ]/g, " ")} FCFA`
const Ligne = ({ libelle, children }) => <div className="row py-1 border-bottom"><div className="col-5 text-muted small">{libelle}</div><div className="col-7">{children}</div></div>

export default function VerifierRecu() {
  const { code = "" } = useParams()
  const [etat, setEtat] = useState({ chargement: true })
  useEffect(() => {
    rpc("verifier_recu", { p_code: code }).then((v) => setEtat({ v })).catch(() => setEtat({ erreur: true }))
  }, [code])
  const r = etat.v
  return (
    <div className="row justify-content-center mt-4 mt-md-5 mx-0 mb-4">
      <div className="col-sm-11 col-md-8 col-lg-6 col-xl-5">
        <div className="card shadow-sm">
          <div className="card-body p-4">
            <div className="d-flex align-items-center justify-content-between gap-2 mb-1">
              <h1 className="h4 mb-0 text-primary d-flex align-items-center gap-2"><img src={`${import.meta.env.BASE_URL}logo-nexia-192.png`} alt="" width="32" height="32" className="rounded-2" />NexIA School</h1>
              <ChoixLangue />
            </div>
            <p className="text-muted mb-3">{t("Vérification d'un reçu de paiement")}</p>
            {etat.chargement && <Chargement />}
            {etat.erreur && <div className="alert alert-warning">{t("Vérification impossible pour le moment. Vérifiez votre connexion puis réessayez.")}</div>}
            {!etat.chargement && !etat.erreur && !r && (
              <div className="alert alert-danger verification-ko">
                <strong>{t("Code inconnu : {v0}", { v0: code.toUpperCase() })}</strong><br />
                {t("Aucun reçu portant ce code n'a été émis par NexIA School. Ce document n'est pas authentique.")}
              </div>)}
            {r && <>
              <div className="alert alert-success verification-ok mb-3">
                <strong>✓ {t("Reçu authentique")}</strong><br />
                {t("Ce reçu a bien été émis par NexIA School pour le paiement ci-dessous. Comparez avec le document : si un montant, une date ou un nom diffère, le document a été modifié.")}
              </div>
              <div className="mb-3">
                <Ligne libelle={t("Reçu")}><strong>{r.numero}</strong></Ligne>
                <Ligne libelle={t("Date du paiement")}>{dateHeure(r.date)}</Ligne>
                <Ligne libelle={t("Établissement")}><strong>{r.etablissement}</strong>{r.ville ? ` · ${r.ville}` : ""}</Ligne>
                <Ligne libelle={t("Offre")}>{t(NOMS_OFFRES[r.offre] || r.offre)} ({r.periode === "annuel" ? t("1 an") : t("1 mois")})</Ligne>
                <Ligne libelle={t("Période couverte")}>{t("du")} {date(r.debut)} {t("au")} {date(r.fin)}</Ligne>
                <Ligne libelle={t("Montant payé")}><strong>{fcfa(r.montant)}</strong></Ligne>
                <Ligne libelle={t("Code")}><code>{code.toUpperCase()}</code></Ligne>
              </div>
            </>}
            <p className="small text-muted mb-0">{t("Reçus sécurisés par NexIA School")} · <a href={EDITEUR.site}>{EDITEUR.site.replace(/^https?:\/\//, "")}</a></p>
          </div>
        </div>
        <p className="small text-center text-muted mt-3"><Link to="/">{t("Accueil")}</Link> · <Link to="/confidentialite">{t("Confidentialité")}</Link></p>
      </div>
    </div>
  )
}
