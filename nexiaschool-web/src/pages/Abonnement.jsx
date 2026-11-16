// Abonnement de l'établissement (administrateur) : offre en cours, échéance, paiement ou renouvellement par SasPay,
// historique des paiements. Au retour de la page SasPay (?paiement=…), le paiement est revérifié côté serveur.
import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { date, dateHeure } from "../lib/format.js"
import { NOMS_OFFRES } from "../lib/offres.js"
import { recuPdf } from "../lib/recuPdf.js"
import { useSession } from "../Session.jsx"
import { rpc, supabase } from "../supabase.js"
import { locale, t } from "../i18n.jsx"

const fcfa = (n) => `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(Number(n || 0)).replace(/[  ]/g, " ")} FCFA`
const STATUTS = { en_attente: ["En attente", "warning"], paye: ["Payé", "success"], echoue: ["Échoué", "danger"], annule: ["Annulé", "secondary"] }

async function appeler(action, corps) {
  const { data, error } = await supabase.functions.invoke(`paiement/${action}`, { body: corps })
  if (error) {
    let message = error.message
    try { message = (await error.context?.json())?.erreur || message } catch { /* réponse illisible */ }
    throw new Error(message)
  }
  return data
}

export default function Abonnement() {
  const { recharger } = useSession()
  const [params, setParams] = useSearchParams()
  const [a, erreur, relire] = useDonnees(() => rpc("mon_abonnement"), [])
  const [choix, setChoix] = useState({ offre: "pro", periode: "mensuel" })
  const [msg, setMsg] = useState({}), [occupe, setOccupe] = useState(false)

  // retour de SasPay : vérification du paiement, puis mise à jour des droits de la session
  const retour = params.get("paiement")
  useEffect(() => {
    if (!retour) return
    setOccupe(true); setMsg({ info: t("Vérification du paiement auprès de SasPay…") })
    appeler("verifier", { paiement_id: retour }).then((r) => {
      const p = (r.paiements || []).find((x) => x.id === retour)
      const etat = p?.statut || r.abonnement?.paiements?.find((x) => x.id === retour)?.statut
      if (etat === "paye") setMsg({ ok: t("Paiement reçu : votre offre est active jusqu'au {v0}.", { v0: date(r.abonnement?.expire_le) }) })
      else if (etat === "annule") setMsg({ erreur: t("Paiement annulé : aucun montant n'a été débité.") })
      else if (etat === "echoue") setMsg({ erreur: t("Le paiement a échoué. Vous pouvez réessayer.") })
      else setMsg({ info: t("Paiement en cours de confirmation. Cette page se met à jour dès que SasPay le confirme.") })
      relire(); recharger()
    }).catch((e) => setMsg({ erreur: e.message })).finally(() => { setOccupe(false); setParams({}, { replace: true }) })
  }, [retour]) // eslint-disable-line react-hooks/exhaustive-deps

  // paiement resté en attente (page fermée trop tôt) : nouvelle vérification à l'ouverture de la page
  useEffect(() => {
    if (retour || !a?.paiements?.some((p) => p.statut === "en_attente")) return
    appeler("verifier", {}).then((r) => { if (r.paiements?.some((p) => p.statut === "paye")) { relire(); recharger() } }).catch(() => {})
  }, [a?.paiements?.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!a) return <Chargement />
  const tarifs = Object.fromEntries((a.tarifs || []).map((x) => [x.offre, x]))
  const montant = tarifs[choix.offre]?.[choix.periode]
  const expire = a.expire_le ? new Date(a.expire_le) : null
  const actif = a.effective !== "decouverte"
  const jours = expire ? Math.ceil((expire - Date.now()) / 86400000) : null
  const renouvellement = actif && a.offre === choix.offre

  const telechargerRecu = async (id) => {
    setMsg({})
    try { await recuPdf(await rpc("recu_paiement", { p_id: id })) } catch (e) { setMsg({ erreur: e.message }) }
  }

  const payer = async () => {
    setOccupe(true); setMsg({})
    try {
      const base = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}`
      const r = await appeler("creer", { offre: choix.offre, periode: choix.periode, retour: `${base}/abonnement` })
      window.location.assign(r.url)
    } catch (e) { setMsg({ erreur: e.message }); setOccupe(false) }
  }

  return (
    <div className="container-fluid px-0" style={{ maxWidth: 980 }}>
      <h1 className="h3 mb-3">{t("Abonnement")}</h1>
      <Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      <Alerte type="info">{msg.info}</Alerte>
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte>

      <div className="card mb-4"><div className="card-body">
        <h2 className="h5">{t("Offre actuelle")}</h2>
        <p className="fs-5 mb-1"><strong>{t(NOMS_OFFRES[a.effective])}</strong>
          {actif && <span className="text-muted fs-6"> · {t(a.periode === "annuel" ? "paiement annuel" : "paiement mensuel")}</span>}</p>
        {actif && expire && <p className={`mb-0 ${jours <= 7 ? "text-danger fw-semibold" : "text-muted"}`}>
          {t("Active jusqu'au {v0} ({v1} jours restants).", { v0: date(expire), v1: Math.max(jours, 0) })}{" "}
          {t("Sans renouvellement, l'établissement repasse automatiquement en offre Découverte à cette date ; ses données sont conservées.")}</p>}
        {!actif && a.offre !== "decouverte" && <p className="text-danger mb-0">{t("Votre offre {v0} a expiré le {v1} : renouvelez-la pour retrouver ses fonctionnalités.", { v0: t(NOMS_OFFRES[a.offre]), v1: date(expire) })}</p>}
        {!actif && a.offre === "decouverte" && <p className="text-muted mb-0">{t("Offre gratuite : jusqu'à 50 élèves et 10 comptes du personnel.")}</p>}
      </div></div>

      <div className="card mb-4"><div className="card-body">
        <h2 className="h5">{actif ? t("Renouveler ou changer d'offre") : t("Choisir une offre")}</h2>
        <div className="row g-3 align-items-end">
          <div className="col-md-5">
            <label className="form-label" htmlFor="ab-offre">{t("Offre")}</label>
            <select id="ab-offre" className="form-select" value={choix.offre} onChange={(e) => setChoix({ ...choix, offre: e.target.value })}>
              {["essentiel", "pro", "premium"].map((o) => <option key={o} value={o}>{t(NOMS_OFFRES[o])} — {fcfa(tarifs[o]?.mensuel)} {t("par mois")}</option>)}
            </select>
          </div>
          <div className="col-md-4">
            <span className="form-label d-block">{t("Période")}</span>
            <div className="btn-group w-100" role="group" aria-label={t("Période de paiement")}>
              {[["mensuel", t("1 mois")], ["annuel", t("1 an (2 mois offerts)")]].map(([v, l]) => (
                <button key={v} type="button" className={`btn ${choix.periode === v ? "btn-primary" : "btn-outline-primary"}`} aria-pressed={choix.periode === v}
                        onClick={() => setChoix({ ...choix, periode: v })}>{l}</button>))}
            </div>
          </div>
          <div className="col-md-3 d-grid">
            <button type="button" className="btn btn-success" disabled={occupe || !montant} onClick={payer}>
              {occupe ? t("Patientez…") : t("Payer {v0}", { v0: fcfa(montant) })}</button>
          </div>
        </div>
        <p className="small text-muted mt-3 mb-0">
          {renouvellement ? t("Renouvellement : la nouvelle période s'ajoute à la date d'échéance actuelle, sans perdre de jours.")
                          : t("La nouvelle offre est active dès la confirmation du paiement, pour la période choisie.")}{" "}
          {t("Paiement sécurisé par SasPay (mobile money ou carte) : vous êtes redirigé vers sa page de paiement, puis ramené ici.")}{" "}
          {t("Un reçu est envoyé par e-mail à chaque paiement et reste téléchargeable ci-dessous.")}</p>
      </div></div>

      <h2 className="h5">{t("Historique des paiements")}</h2>
      {!a.paiements.length ? <p className="text-muted">{t("Aucun paiement pour le moment.")}</p> : (
        <div className="table-responsive"><table className="table table-sm align-middle">
          <thead><tr><th>{t("Date")}</th><th>{t("Offre")}</th><th>{t("Période")}</th><th className="text-end">{t("Montant")}</th><th>{t("Statut")}</th><th>{t("Valable jusqu'au")}</th><th>{t("Reçu")}</th></tr></thead>
          <tbody>{a.paiements.map((p) => {
            const [lib, coul] = STATUTS[p.statut] || [p.statut, "secondary"]
            return <tr key={p.id}><td>{dateHeure(p.cree_le)}</td><td>{t(NOMS_OFFRES[p.offre])}</td><td>{t(p.periode === "annuel" ? "1 an" : "1 mois")}</td>
              <td className="text-end">{fcfa(p.montant)}</td><td><span className={`badge text-bg-${coul}`}>{t(lib)}</span></td><td>{p.fin ? date(p.fin) : "—"}</td>
              <td>{p.numero_recu ? <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => telechargerRecu(p.id)}
                aria-label={t("Télécharger le reçu {v0}", { v0: p.numero_recu })}>{t("Télécharger")}</button> : "—"}</td></tr>
          })}</tbody>
        </table></div>)}
    </div>
  )
}
