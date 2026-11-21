// Abonnement de l'enseignant indépendant : offre, crédits, échéance, souscription ou renouvellement (12 mois), pack de crédits,
// abonnement de groupe (la matière du département est demandée avant le paiement), paiements et reçus.
// Montants fixés par le serveur (configuration commerciale) ; activation uniquement après paiement vérifié.
import { useState } from "react"
import { Alerte } from "../../composants/Communs.jsx"
import { date, dateHeure } from "../../lib/format.js"
import { fcfa, payer, STATUTS, useRetourPaiement } from "../../lib/paiement.js"
import { recuPdf } from "../../lib/recuPdf.js"
import { useSession } from "../../Session.jsx"
import { rpc } from "../../supabase.js"
import { t } from "../../i18n.jsx"
import { NOMS_OFFRES_SE } from "./EspaceEnseignant.jsx"

const CHEMIN = "/enseignant/abonnement"

function Offre({ titre, prix, points, bouton, desactive, aide, onClick, occupe, children }) {
  return (
    <div className="col-md-4"><div className="card h-100 shadow-sm offre-se"><div className="card-body d-flex flex-column">
      <h3 className="h6 mb-1">{titre}</h3>
      <div className="fs-4 fw-bold mb-2">{prix}</div>
      <ul className="small ps-3 flex-grow-1">{points.map((p) => <li key={p}>{p}</li>)}</ul>
      {children}
      <button type="button" className="btn btn-primary" disabled={desactive || occupe} onClick={onClick}>{occupe ? t("Patientez…") : bouton}</button>
      {aide && <div className="form-text">{aide}</div>}
    </div></div></div>
  )
}

export default function AbonnementEnseignant() {
  const { enseignant, recharger } = useSession()
  const { compte, offre: o, tarifs, paiements, groupe } = enseignant
  const se = tarifs.smarteval
  const [msg, setMsg] = useRetourPaiement(paiements.some((p) => p.statut === "en_attente"), () => recharger())
  const [occupe, setOccupe] = useState(""), [matiere, setMatiere] = useState(""), [nomGroupe, setNomGroupe] = useState("")
  const membre = compte.type === "groupe"
  const adminGroupe = compte.role_groupe === "admin"

  async function acheter(produit, extra = {}) {
    setOccupe(produit); setMsg({})
    try { await payer(produit, CHEMIN, extra) } catch (x) { setMsg({ erreur: x.message }); setOccupe("") }
  }
  const telechargerRecu = async (id) => {
    setMsg({})
    try { await recuPdf(await rpc("recu_paiement", { p_id: id })) } catch (e) { setMsg({ erreur: e.message }) }
  }
  const finProche = o.fin && new Date(o.fin) - Date.now() <= (se.renouvellement_jours || 30) * 864e5

  return (
    <div style={{ maxWidth: 1000 }}>
      <h1 className="h3 mb-3">{t("Mon abonnement")}</h1>
      <Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      <Alerte type="info">{msg.info}</Alerte>
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte>

      <div className="card mb-4"><div className="card-body">
        <h2 className="h5 mb-1">{t("Offre actuelle")}</h2>
        <p className="fs-4 fw-bold mb-1">{t(NOMS_OFFRES_SE[o.offre])}</p>
        {o.fin && <p className="text-muted mb-1">{t("Valable jusqu'au {v0}.", { v0: date(o.fin) })}</p>}
        <p className="mb-1">{t("Crédits : {v0} utilisé(s) sur {v1} — {v2} restant(s).", { v0: o.credits_utilises, v1: o.credits_total, v2: o.credits_restants })}</p>
        <p className="small text-muted mb-0">{t("1 crédit = 1 évaluation publiée. Brouillons et modifications gratuits ; une suppression ne restitue pas le crédit ; une duplication publiée utilise un crédit. Les crédits non utilisés ne sont pas reportés sur la période suivante. Réponses par évaluation : {v0} au maximum.", { v0: o.soumissions_max })}</p>
        {groupe && <p className="small mt-2 mb-0">{t("Groupe « {v0} » — matière : {v1} — {v2} membre(s) sur {v3}.", { v0: groupe.nom, v1: groupe.matiere, v2: groupe.membres, v3: groupe.membres_max })}</p>}
      </div></div>

      {membre ? <div className="alert alert-light border">{t("Votre accès est couvert par l'abonnement de votre groupe. Pour toute question, adressez-vous à l'administrateur du groupe.")}</div> : (
        <div className="row g-3 mb-4">
          {!groupe && <Offre titre={t("SmartEval Enseignant")} prix={`${fcfa(se.prix_annuel)} / ${t("an")}`}
            points={[t("{v0} évaluations publiées par période de 12 mois", { v0: se.credits }), t("{v0} réponses par évaluation", { v0: se.soumissions_max }),
                     t("Correction automatique, analyse par votre IA, anonymisation")]}
            bouton={o.offre === "enseignant" ? t("Renouveler pour 12 mois") : t("Souscrire")} occupe={occupe === "se_abonnement"}
            desactive={o.offre === "enseignant" && !finProche}
            aide={o.offre === "enseignant" ? (finProche ? t("La nouvelle période commence à l'échéance actuelle, sans perdre de jours.") : t("Le renouvellement s'ouvre {v0} jours avant l'échéance.", { v0: se.renouvellement_jours || 30 })) : t("Valable 12 mois à compter de la souscription.")}
            onClick={() => acheter("se_abonnement")} />}
          {se.pack && !groupe && <Offre titre={t("Pack de crédits")} prix={fcfa(se.pack.prix)}
            points={[t("{v0} évaluations supplémentaires", { v0: se.pack.credits }), t("Valables jusqu'à la fin de votre période en cours")]}
            bouton={t("Acheter un pack")} desactive={o.offre !== "enseignant"} occupe={occupe === "se_credits"}
            aide={o.offre !== "enseignant" ? t("Réservé aux abonnés SmartEval Enseignant.") : ""} onClick={() => acheter("se_credits")} />}
          {se.groupe && (!groupe || adminGroupe) && <Offre titre={t("SmartEval Groupe (département)")} prix={`${fcfa(se.groupe.prix_annuel)} / ${t("an")}`}
            points={[t("Jusqu'à {v0} enseignants d'une même matière ou discipline", { v0: se.groupe.membres_max }),
                     t("{v0} évaluations publiées par enseignant et par période", { v0: se.groupe.credits_membre }),
                     t("Un code de groupe, un code personnel par collègue"), t("Évaluations d'une autre matière refusées")]}
            bouton={groupe ? t("Renouveler l'abonnement du groupe") : t("Souscrire pour mon département")} occupe={occupe === "se_groupe"}
            desactive={!groupe && matiere.trim().length < 2}
            onClick={() => acheter("se_groupe", groupe ? {} : { matiere: matiere.trim(), nom: nomGroupe.trim() })}>
            {!groupe && <>
              <label className="form-label small mb-1" htmlFor="g-matiere">{t("Matière ou discipline du département")} <span className="text-danger">*</span></label>
              <input id="g-matiere" className="form-control form-control-sm mb-2" maxLength={80} value={matiere} onChange={(e) => setMatiere(e.target.value)} placeholder={t("ex. Mathématiques")} />
              <label className="form-label small mb-1" htmlFor="g-nom">{t("Nom du groupe (facultatif)")}</label>
              <input id="g-nom" className="form-control form-control-sm mb-2" maxLength={120} value={nomGroupe} onChange={(e) => setNomGroupe(e.target.value)} placeholder={t("ex. Département de mathématiques, Lycée de …")} />
            </>}
          </Offre>}
        </div>)}
      <p className="small text-muted">{t("Paiement sécurisé par SasPay (mobile money ou carte). Un reçu est envoyé par e-mail à chaque paiement. Tous les abonnements payants sont valables 12 mois à compter de la souscription.")}</p>

      <h2 className="h5">{t("Historique des paiements")}</h2>
      {!paiements.length ? <p className="text-muted">{t("Aucun paiement pour le moment.")}</p> : (
        <div className="table-responsive"><table className="table table-sm align-middle">
          <thead><tr><th>{t("Date")}</th><th>{t("Objet")}</th><th className="text-end">{t("Montant")}</th><th>{t("Statut")}</th><th>{t("Valable jusqu'au")}</th><th>{t("Reçu")}</th></tr></thead>
          <tbody>{paiements.map((p) => {
            const [lib, coul] = STATUTS[p.statut] || [p.statut, "secondary"]
            return <tr key={p.id}><td>{dateHeure(p.cree_le)}</td><td>{p.libelle}</td><td className="text-end">{fcfa(p.montant)}</td>
              <td><span className={`badge text-bg-${coul}`}>{t(lib)}</span></td><td>{p.fin ? date(p.fin) : "—"}</td>
              <td>{p.numero_recu ? <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => telechargerRecu(p.id)}>{t("Télécharger")}</button> : "—"}</td></tr>
          })}</tbody>
        </table></div>)}
    </div>
  )
}
